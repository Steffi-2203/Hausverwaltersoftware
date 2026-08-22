import { Router, Request, Response } from "express";
import { db } from "../db";
import { eq, sql, and, inArray, desc, isNull, count } from "drizzle-orm";
import * as schema from "@shared/schema";
import { insertPaymentSchema, insertTransactionSchema, insertMonthlyInvoiceSchema } from "@shared/schema";
import { storage } from "../storage";
import { decryptIbanRows, decryptField, encryptField } from "../lib/fieldEncryption";
import { isAuthenticated, requireRole, requireMutationAccess, getUserRoles, getProfileFromSession, isTester, maskPersonalData, snakeToCamel, parsePagination } from "./helpers";
import { verifyTransactionOwnership, verifyInvoiceOwnership, verifyPaymentOwnership, verifyTenantOwnership, verifyUnitOwnership, verifyCategoryOwnership, verifyPropertyOwnership } from "../lib/ownershipCheck";
import { paymentService } from "../services/paymentService";
import { idempotencyMiddleware } from "../middleware/idempotency";
import { billingService } from "../services/billing.service";
import { parseCamt053 } from "../services/camt053Service";
import { generateVorschreibungPdf, type VorschreibungData } from "../services/pdfService";
import { applyInvoiceStatusRules } from "../lib/invoiceStatusRules";
import { roundMoney } from "@shared/utils";
import { createHash } from "crypto";
import { resolveCamtPayment } from "../services/camtPaymentResolutionService";
import { requireIncomingBankPayment } from "../services/bankPaymentEligibility";

const router = Router();

/**
 * Cross-Org-/Integritäts-Schutz: eine Zahlung darf nur mit einer Rechnung
 * verknüpft werden, die zum selben Mieter gehört. Damit ist automatisch auch
 * die Org-Grenze erzwungen (Mieter wurde zuvor gegen die Session-Org geprüft).
 */
async function verifyInvoiceBelongsToTenant(invoiceId: string, tenantId: string): Promise<boolean> {
  const rows = await db.select({ id: schema.monthlyInvoices.id })
    .from(schema.monthlyInvoices)
    .where(and(
      eq(schema.monthlyInvoices.id, invoiceId),
      eq(schema.monthlyInvoices.tenantId, tenantId),
    ))
    .limit(1);
  return rows.length > 0;
}

// ===== Payments CRUD =====

router.get("/api/payments", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const orgId = profile?.organizationId;
    if (!orgId) return res.json({ data: [], pagination: { page: 1, limit: 100, total: 0 } });

    const { page, limit, offset } = parsePagination(req);

    const tenantIdsSq = db.select({ id: schema.tenants.id }).from(schema.tenants)
      .innerJoin(schema.units, eq(schema.tenants.unitId, schema.units.id))
      .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
      .where(and(
        eq(schema.properties.organizationId, orgId),
        isNull(schema.properties.deletedAt),
        isNull(schema.units.deletedAt),
        isNull(schema.tenants.deletedAt)
      ));

    const whereCondition = inArray(schema.payments.tenantId, tenantIdsSq);

    const [payments, [{ total }]] = await Promise.all([
      db.select().from(schema.payments)
        .where(whereCondition)
        .orderBy(desc(schema.payments.buchungsDatum))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(schema.payments)
        .where(whereCondition),
    ]);

    const roles = await getUserRoles(req);
    const items = isTester(roles) ? maskPersonalData(payments) : payments;
    res.json({ data: items, pagination: { page, limit, total } });
  } catch (error) {
    console.error("Payments error:", error);
    res.status(500).json({ error: "Failed to fetch payments" });
  }
});

router.post("/api/payments", isAuthenticated, requireRole('property_manager', 'finance'), idempotencyMiddleware, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const normalizedBody = snakeToCamel(req.body);
    const validationResult = insertPaymentSchema.safeParse(normalizedBody);
    if (!validationResult.success) {
      return res.status(400).json({ error: "Validation failed", details: validationResult.error.flatten() });
    }
    const tenant = await storage.getTenant(validationResult.data.tenantId);
    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    const unit = await storage.getUnit(tenant.unitId);
    if (!unit) {
      return res.status(403).json({ error: "Access denied - unit not found" });
    }
    const property = await storage.getProperty(unit.propertyId);
    if (!property || property.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    // Cross-Org-Schutz auch für invoice_id: Die Rechnung muss zum Mieter der
    // Zahlung gehören — sonst könnte eine Zahlung der eigenen Org mit einer
    // fremden Rechnung verknüpft werden (Datenintegritäts-/Isolationsleck).
    if (validationResult.data.invoiceId) {
      const invoiceOk = await verifyInvoiceBelongsToTenant(validationResult.data.invoiceId, validationResult.data.tenantId);
      if (!invoiceOk) {
        return res.status(403).json({ error: "Access denied - invoice does not belong to tenant" });
      }
    }
    const payment = await storage.createPayment(validationResult.data);

    try {
      const { createFinancialAuditEntry } = await import("../services/auditHashService");
      await createFinancialAuditEntry({
        action: "payment_created",
        entityType: "payment",
        entityId: payment.id,
        organizationId: profile?.organizationId,
        userId: profile?.userId,
        data: {
          tenantId: payment.tenantId,
          amount: payment.betrag,
          type: payment.paymentType,
          propertyId: property.id,
          buchungsDatum: payment.buchungsDatum,
          verwendungszweck: payment.verwendungszweck,
        },
      });
    } catch {}
    
    let allocationWarning: string | undefined;
    try {
      await paymentService.allocatePayment({
        paymentId: payment.id,
        tenantId: payment.tenantId,
        amount: Number(payment.betrag),
        bookingDate: payment.buchungsDatum,
        paymentType: payment.paymentType || 'ueberweisung',
        reference: payment.verwendungszweck || undefined,
        organizationId: profile?.organizationId,
      });
    } catch (allocError: any) {
      // Audit-Befund Z1: Fehlgeschlagene Zuordnung nicht still verschlucken.
      // Die Zahlung ist gespeichert, aber die Rechnungen wurden nicht aktualisiert.
      // Wir protokollieren den Fehler und signalisieren ihn dem Frontend,
      // damit der Verwalter manuell eingreifen kann.
      const msg = (allocError as Error)?.message || String(allocError);
      console.error("[Payment] Zahlungszuordnung fehlgeschlagen:", msg, { paymentId: payment.id });
      allocationWarning = `Zahlung gespeichert, Zuordnung fehlgeschlagen: ${msg}`;
    }

    res.json({ ...payment, allocationWarning });
  } catch (error) {
    console.error("Create payment error:", error);
    res.status(500).json({ error: "Failed to create payment" });
  }
});

router.patch("/api/payments/:id", isAuthenticated, requireRole('property_manager', 'finance'), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const existingPayment = await storage.getPayment(req.params.id);
    if (!existingPayment) {
      return res.status(404).json({ error: "Payment not found" });
    }
    const tenant = await storage.getTenant(existingPayment.tenantId);
    if (!tenant) {
      return res.status(403).json({ error: "Access denied - tenant not found" });
    }
    const unit = await storage.getUnit(tenant.unitId);
    if (!unit) {
      return res.status(403).json({ error: "Access denied - unit not found" });
    }
    const property = await storage.getProperty(unit.propertyId);
    if (!property || property.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    const normalizedBody = snakeToCamel(req.body);
    const validationResult = insertPaymentSchema.partial().safeParse(normalizedBody);
    if (!validationResult.success) {
      return res.status(400).json({ error: "Validation failed", details: validationResult.error.flatten() });
    }
    // Unveränderliche Kernfelder (DB-Trigger trg_payments_core_immutable):
    // betrag und buchungsDatum sind nach dem Anlegen nicht mehr änderbar.
    // Vorab-Prüfung liefert 422 mit Storno-Hinweis statt eines generischen 500.
    const IMMUTABLE_FIELDS = ['betrag', 'buchungsDatum'] as const;
    const attemptedImmutable = IMMUTABLE_FIELDS.filter(
      (f) => validationResult.data[f] !== undefined,
    );
    if (attemptedImmutable.length > 0) {
      return res.status(422).json({
        error: "Betrag und Buchungsdatum können nach dem Anlegen nicht mehr geändert werden. Bitte eine Gegenbuchung (Storno) erfassen.",
        code: "PAYMENT_IMMUTABLE_FIELD",
        fields: attemptedImmutable,
      });
    }
    // Cross-Org-Schutz für invoice_id auch beim Update (siehe POST):
    // die Rechnung muss zum (ggf. unveränderten) Mieter der Zahlung gehören.
    if (validationResult.data.invoiceId) {
      const targetTenantId = validationResult.data.tenantId ?? existingPayment.tenantId;
      const invoiceOk = await verifyInvoiceBelongsToTenant(validationResult.data.invoiceId, targetTenantId);
      if (!invoiceOk) {
        return res.status(403).json({ error: "Access denied - invoice does not belong to tenant" });
      }
    }
    const payment = await storage.updatePayment(req.params.id, validationResult.data);
    res.json(payment);
  } catch (error: any) {
    // Fallback: DB-Trigger P0001 ("unveränderlich") — greift wenn ein Feld
    // über einen anderen Pfad (z.B. Drizzle-Typen-Coercion) doch die DB erreicht.
    const msg: string = error?.message ?? error?.cause?.message ?? '';
    const code: string = error?.code ?? error?.cause?.code ?? '';
    if (code === 'P0001' && msg.includes('unveränderlich')) {
      return res.status(422).json({
        error: "Betrag und Buchungsdatum können nach dem Anlegen nicht mehr geändert werden. Bitte eine Gegenbuchung (Storno) erfassen.",
        code: "PAYMENT_IMMUTABLE_FIELD",
      });
    }
    res.status(500).json({ error: "Failed to update payment" });
  }
});

// Payments sind unveränderliche Buchungssätze — Löschen ist nicht zulässig.
// Korrekturen müssen per Storno/Gegenbuchung erfasst werden.
// Ein BEFORE DELETE Trigger auf DB-Ebene (trg_payments_delete_blocked) sorgt
// zusätzlich für Schutz bei direktem DB-Zugriff.
router.delete("/api/payments/:id", isAuthenticated, requireRole('property_manager', 'finance'), (_req, res) => {
  return res.status(405).json({
    error: "Zahlungen können nicht gelöscht werden. Korrekturen bitte per Storno/Gegenbuchung erfassen.",
    code: "PAYMENT_DELETE_NOT_ALLOWED",
  });
});

router.get("/api/payments/:id", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const payment = await storage.getPayment(req.params.id);
    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }
    const tenant = await storage.getTenant(payment.tenantId);
    if (tenant) {
      const unit = await storage.getUnit(tenant.unitId);
      if (unit) {
        const property = await storage.getProperty(unit.propertyId);
        if (property && property.organizationId !== profile?.organizationId) {
          return res.status(403).json({ error: "Access denied" });
        }
      }
    }
    const roles = await getUserRoles(req);
    res.json(isTester(roles) ? maskPersonalData(payment) : payment);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch payment" });
  }
});

// ===== Transactions CRUD =====

router.get("/api/transactions", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const orgId = profile?.organizationId;
    if (!orgId) return res.json({ data: [], pagination: { page: 1, limit: 100, total: 0 } });

    const { page, limit, offset } = parsePagination(req);

    const bankAccountIdsSq = db.select({ id: schema.bankAccounts.id }).from(schema.bankAccounts)
      .where(eq(schema.bankAccounts.organizationId, orgId));

    const whereCondition = inArray(schema.transactions.bankAccountId, bankAccountIdsSq);

    const [txnRows, [{ total }]] = await Promise.all([
      db.select({
        transaction: schema.transactions,
        propertyId: schema.bankAccounts.propertyId,
      }).from(schema.transactions)
        .leftJoin(schema.bankAccounts, eq(schema.transactions.bankAccountId, schema.bankAccounts.id))
        .where(whereCondition)
        .orderBy(desc(schema.transactions.transactionDate))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(schema.transactions)
        .where(whereCondition),
    ]);

    const transactions = txnRows.map(row => ({
      ...row.transaction,
      partnerIban: decryptField(row.transaction.partnerIban),
      property_id: row.propertyId,
    }));

    const roles = await getUserRoles(req);
    const items = isTester(roles) ? maskPersonalData(transactions) : transactions;
    res.json({ data: items, pagination: { page, limit, total } });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

router.post("/api/transactions", isAuthenticated, requireRole('property_manager', 'finance'), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const normalizedBody = snakeToCamel(req.body);
    const validationResult = insertTransactionSchema.safeParse(normalizedBody);
    if (!validationResult.success) {
      return res.status(400).json({ error: "Validation failed", details: validationResult.error.flatten() });
    }
    if (validationResult.data.bankAccountId) {
      const bankAccount = await storage.getBankAccount(validationResult.data.bankAccountId);
      if (!bankAccount || bankAccount.organizationId !== profile?.organizationId) {
        return res.status(403).json({ error: "Access denied" });
      }
    }
    const transaction = await storage.createTransaction(validationResult.data);
    res.json(transaction);
  } catch (error) {
    console.error("Create transaction error:", error);
    res.status(500).json({ error: "Failed to create transaction" });
  }
});

router.get("/api/transactions/:id", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const transaction = await storage.getTransaction(req.params.id);
    if (!transaction) {
      return res.status(404).json({ error: "Transaction not found" });
    }
    if (transaction.bankAccountId) {
      const bankAccount = await storage.getBankAccount(transaction.bankAccountId);
      if (bankAccount && bankAccount.organizationId !== profile?.organizationId) {
        return res.status(403).json({ error: "Access denied" });
      }
    }
    const roles = await getUserRoles(req);
    res.json(isTester(roles) ? maskPersonalData(transaction) : transaction);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch transaction" });
  }
});

router.delete("/api/transactions/:id", isAuthenticated, requireRole('property_manager', 'finance'), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const orgId = profile?.organizationId;
    if (!orgId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });
    // SECURITY: verify transaction ownership before deletion
    const isOwned = await verifyTransactionOwnership(req.params.id, orgId);
    if (!isOwned) return res.status(403).json({ error: "Transaktion gehört nicht zur Organisation" });
    await storage.deleteTransactionSplits(req.params.id);
    await storage.deleteExpensesByTransactionId(req.params.id);
    await storage.deleteTransaction(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete transaction" });
  }
});

// ===== Transaction Auto-Match =====

router.post("/api/transactions/auto-match", isAuthenticated, requireRole('property_manager', 'finance'), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const orgId = profile?.organizationId;
    if (!orgId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });

    const { transactionIds } = req.body;
    const ids: string[] = Array.isArray(transactionIds) ? transactionIds : [transactionIds];

    for (const txId of ids) {
      const isOwned = await verifyTransactionOwnership(txId, orgId);
      if (!isOwned) return res.status(403).json({ error: "Transaktion gehört nicht zur Organisation" });
    }

    const tenants = await storage.getTenantsByOrganization(orgId);
    const units = await storage.getUnitsByOrganization(orgId);
    const properties = await db.select().from(schema.properties)
      .where(and(eq(schema.properties.organizationId, orgId), isNull(schema.properties.deletedAt)));
    const categories = await storage.getAccountCategories(orgId);

    const openInvoices = await db.select().from(schema.monthlyInvoices)
      .where(and(
        inArray(schema.monthlyInvoices.unitId, units.map(u => u.id)),
        sql`${schema.monthlyInvoices.status} != 'bezahlt'`
      ));

    const results: any[] = [];

    for (const txId of ids) {
      const transaction = await storage.getTransaction(txId);
      if (!transaction || transaction.isMatched) continue;

      const suggestions: any = {};
      const txAmount = Math.abs(Number(transaction.amount));
      const txRef = (transaction.reference || '').toLowerCase();
      const txBooking = (transaction.bookingText || '').toLowerCase();
      const txPartnerName = (transaction.partnerName || '').toLowerCase();
      const txPartnerIban = (transaction.partnerIban || '').replace(/\s/g, '').toUpperCase();

      let matchedTenant: any = null;
      let tenantConfidence = 0;
      let tenantReason = '';

      for (const tenant of tenants) {
        const tenantIban = (tenant.iban || '').replace(/\s/g, '').toUpperCase();
        const tenantName = `${tenant.firstName} ${tenant.lastName}`.toLowerCase();
        const tenantLastName = tenant.lastName.toLowerCase();

        if (txPartnerIban && tenantIban && txPartnerIban === tenantIban) {
          if (95 > tenantConfidence) {
            matchedTenant = tenant;
            tenantConfidence = 95;
            tenantReason = 'IBAN-Übereinstimmung';
          }
        }

        if (tenantConfidence < 95) {
          const searchText = `${txRef} ${txBooking} ${txPartnerName}`;
          if (searchText.includes(tenantName) && tenantName.length > 3) {
            if (70 > tenantConfidence) {
              matchedTenant = tenant;
              tenantConfidence = 70;
              tenantReason = 'Name in Referenztext gefunden';
            }
          } else if (searchText.includes(tenantLastName) && tenantLastName.length > 3) {
            if (60 > tenantConfidence) {
              matchedTenant = tenant;
              tenantConfidence = 60;
              tenantReason = 'Nachname in Referenztext gefunden';
            }
          }
        }
      }

      if (matchedTenant) {
        suggestions.tenant = {
          id: matchedTenant.id,
          name: `${matchedTenant.firstName} ${matchedTenant.lastName}`,
          confidence: tenantConfidence,
          reason: tenantReason,
        };

        const unit = units.find(u => u.id === matchedTenant.unitId);
        if (unit) {
          suggestions.unit = {
            id: unit.id,
            topNummer: unit.topNummer,
            confidence: Math.min(tenantConfidence, 90),
            reason: 'Über Mieterzuordnung',
          };

          const property = properties.find(p => p.id === unit.propertyId);
          if (property) {
            suggestions.property = {
              id: property.id,
              name: property.name,
              confidence: Math.min(tenantConfidence, 90),
              reason: 'Über Einheitenzuordnung',
            };
          }
        }
      }

      if (!suggestions.unit) {
        const searchText = `${txRef} ${txBooking} ${txPartnerName}`;
        for (const unit of units) {
          if (unit.topNummer && searchText.includes(unit.topNummer.toLowerCase())) {
            suggestions.unit = {
              id: unit.id,
              topNummer: unit.topNummer,
              confidence: 50,
              reason: 'Top-Nr. in Buchungstext gefunden',
            };
            const property = properties.find(p => p.id === unit.propertyId);
            if (property) {
              suggestions.property = {
                id: property.id,
                name: property.name,
                confidence: 50,
                reason: 'Über Einheitenzuordnung',
              };
            }
            break;
          }
        }
      }

      if (!suggestions.property) {
        const searchText = `${txRef} ${txBooking} ${txPartnerName}`;
        for (const property of properties) {
          if (property.name && searchText.includes(property.name.toLowerCase()) && property.name.length > 3) {
            suggestions.property = {
              id: property.id,
              name: property.name,
              confidence: 50,
              reason: 'Liegenschaftsname in Buchungstext gefunden',
            };
            break;
          }
        }
      }

      if (matchedTenant) {
        const tenantInvoices = openInvoices.filter(inv => inv.tenantId === matchedTenant.id);
        for (const inv of tenantInvoices) {
          const invAmount = Math.abs(Number(inv.gesamtbetrag));
          if (Math.abs(txAmount - invAmount) < 0.01) {
            suggestions.invoice = {
              id: inv.id,
              invoiceNumber: `${inv.year}/${String(inv.month).padStart(2, '0')}`,
              confidence: 85,
              reason: 'Betrag + Mieter stimmen überein',
            };
            break;
          }
        }
        if (!suggestions.invoice) {
          for (const inv of tenantInvoices) {
            const invAmount = Math.abs(Number(inv.gesamtbetrag));
            if (Math.abs(txAmount - invAmount) < 5) {
              suggestions.invoice = {
                id: inv.id,
                invoiceNumber: `${inv.year}/${String(inv.month).padStart(2, '0')}`,
                confidence: 65,
                reason: 'Betrag ähnlich + Mieter stimmt überein',
              };
              break;
            }
          }
        }
      } else {
        for (const inv of openInvoices) {
          const invAmount = Math.abs(Number(inv.gesamtbetrag));
          if (Math.abs(txAmount - invAmount) < 0.01 && txAmount > 0) {
            const invTenant = tenants.find(t => t.id === inv.tenantId);
            suggestions.invoice = {
              id: inv.id,
              invoiceNumber: `${inv.year}/${String(inv.month).padStart(2, '0')}`,
              confidence: 80,
              reason: 'Betragsübereinstimmung',
            };
            if (invTenant && !suggestions.tenant) {
              suggestions.tenant = {
                id: invTenant.id,
                name: `${invTenant.firstName} ${invTenant.lastName}`,
                confidence: 75,
                reason: 'Über Rechnungszuordnung',
              };
              const unit = units.find(u => u.id === invTenant.unitId);
              if (unit) {
                suggestions.unit = {
                  id: unit.id,
                  topNummer: unit.topNummer,
                  confidence: 70,
                  reason: 'Über Mieterzuordnung',
                };
                const property = properties.find(p => p.id === unit.propertyId);
                if (property) {
                  suggestions.property = {
                    id: property.id,
                    name: property.name,
                    confidence: 70,
                    reason: 'Über Einheitenzuordnung',
                  };
                }
              }
            }
            break;
          }
        }
      }

      const bookingLower = txBooking + ' ' + txRef;
      const categoryPatterns: { pattern: RegExp; categoryName: string }[] = [
        { pattern: /miete|mieteinnahm|grundmiete/i, categoryName: 'Mieteinnahmen' },
        { pattern: /betriebskosten|bk[- ]vorschuss/i, categoryName: 'Betriebskosten' },
        { pattern: /heizung|heizkosten|hk[- ]vorschuss/i, categoryName: 'Heizkosten' },
        { pattern: /kaution|sicherheit/i, categoryName: 'Kaution' },
        { pattern: /versicherung|polizze/i, categoryName: 'Versicherung' },
        { pattern: /reparatur|instandhaltung|sanierung/i, categoryName: 'Instandhaltung' },
        { pattern: /strom|energie|gas/i, categoryName: 'Strom/Energie' },
        { pattern: /wasser|abwasser|kanal/i, categoryName: 'Wasser/Abwasser' },
        { pattern: /müll|abfall|entsorgung/i, categoryName: 'Müllabfuhr' },
        { pattern: /steuer|grundsteuer|abgabe/i, categoryName: 'Grundsteuer' },
        { pattern: /verwaltung|hausverwaltung/i, categoryName: 'Verwaltung' },
        { pattern: /lift|aufzug/i, categoryName: 'Liftkosten' },
        { pattern: /garten|grünfläche/i, categoryName: 'Gartenpflege' },
        { pattern: /reinigung|hausbetreu/i, categoryName: 'Hausbetreuung' },
      ];

      for (const { pattern, categoryName } of categoryPatterns) {
        if (pattern.test(bookingLower)) {
          const matchingCat = categories.find(c => c.name.toLowerCase().includes(categoryName.toLowerCase()));
          suggestions.category = {
            id: matchingCat?.id || null,
            name: categoryName,
            confidence: matchingCat ? 60 : 50,
            reason: 'Buchungstext-Muster',
          };
          break;
        }
      }

      if (Object.keys(suggestions).length > 0) {
        results.push({ transactionId: txId, suggestions });
      } else {
        results.push({ transactionId: txId, suggestions: {} });
      }
    }

    res.json(results);
  } catch (error) {
    console.error("Auto-match error:", error);
    res.status(500).json({ error: "Fehler bei der automatischen Zuordnung" });
  }
});

router.post("/api/transactions/apply-match", isAuthenticated, requireRole('property_manager', 'finance'), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const orgId = profile?.organizationId;
    if (!orgId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });

    const { transactionId, tenantId, unitId, propertyId, categoryId, invoiceId } = req.body;
    if (!transactionId) return res.status(400).json({ error: "Transaktions-ID erforderlich" });

    const txOwned = await verifyTransactionOwnership(transactionId, orgId);
    if (!txOwned) return res.status(403).json({ error: "Transaktion gehört nicht zur Organisation" });

    if (tenantId) {
      const tenantOwned = await verifyTenantOwnership(tenantId, orgId);
      if (!tenantOwned) return res.status(403).json({ error: "Mieter gehört nicht zur Organisation" });
    }
    if (unitId) {
      const unitOwned = await verifyUnitOwnership(unitId, orgId);
      if (!unitOwned) return res.status(403).json({ error: "Einheit gehört nicht zur Organisation" });
    }
    if (invoiceId) {
      const invoiceOwned = await verifyInvoiceOwnership(invoiceId, orgId);
      if (!invoiceOwned) return res.status(403).json({ error: "Rechnung gehört nicht zur Organisation" });
    }
    if (categoryId) {
      const catOwned = await verifyCategoryOwnership(categoryId, orgId);
      if (!catOwned) return res.status(403).json({ error: "Kategorie gehört nicht zur Organisation" });
    }

    const transaction = await storage.getTransaction(transactionId);
    if (!transaction) return res.status(404).json({ error: "Transaktion nicht gefunden" });

    if (invoiceId && tenantId) {
      // The bank transaction UUID is also the stable payment key. Retrying the
      // same manual CAMT match therefore re-enters the locked, idempotent
      // allocation path instead of creating a second payment.
      const allocation = await paymentService.allocatePayment({
        paymentId: transactionId,
        tenantId,
        invoiceId,
        // Reject debits before a payment row/allocation can be created.
        amount: requireIncomingBankPayment(transaction.amount),
        bookingDate: transaction.transactionDate,
        paymentType: 'ueberweisung',
        reference: transaction.reference || transaction.bookingText || 'Manuelle Bankzuordnung',
        transactionId,
        organizationId: orgId,
        userId: profile?.userId,
      });
      if (!allocation.success) {
        return res.status(409).json({ error: "Zahlung konnte nicht vollständig zugeordnet werden" });
      }
      if (unitId || categoryId) {
        await db.update(schema.transactions)
          .set({
            ...(unitId ? { matchedUnitId: unitId } : {}),
            ...(categoryId ? { categoryId } : {}),
          })
          .where(and(eq(schema.transactions.id, transactionId), eq(schema.transactions.organizationId, orgId)));
      }
      return res.json({ success: true, transactionId, allocation });
    }
    if (invoiceId && !tenantId) {
      return res.status(400).json({ error: "Für die Rechnungszuordnung ist ein Mieter erforderlich" });
    }

    // Category-only matching has no receivable allocation. It remains an
    // explicit accounting classification, not a misleading payment match.
    const updateData: any = { isMatched: true, reconciliationStatus: "matched" };
    if (tenantId) updateData.matchedTenantId = tenantId;
    if (unitId) updateData.matchedUnitId = unitId;
    if (categoryId) updateData.categoryId = categoryId;
    await db.update(schema.transactions)
      .set(updateData)
      .where(and(eq(schema.transactions.id, transactionId), eq(schema.transactions.organizationId, orgId)));

    res.json({ success: true, transactionId });
  } catch (error) {
    console.error("Apply match error:", error);
    res.status(500).json({ error: "Fehler beim Anwenden der Zuordnung" });
  }
});

// ====== PAYMENT ALLOCATIONS (Zahlungszuordnungen) ======

router.get("/api/payments/:paymentId/allocations", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });
    const isOwner = await verifyPaymentOwnership(req.params.paymentId, profile.organizationId);
    if (!isOwner) return res.status(403).json({ error: "Zugriff verweigert" });
    const allocations = await storage.getPaymentAllocationsByPayment(req.params.paymentId);
    res.json(allocations);
  } catch (error) {
    console.error("Get payment allocations error:", error);
    res.status(500).json({ error: "Failed to fetch payment allocations" });
  }
});

router.get("/api/invoices/:invoiceId/allocations", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });
    const isOwner = await verifyInvoiceOwnership(req.params.invoiceId, profile.organizationId);
    if (!isOwner) return res.status(403).json({ error: "Zugriff verweigert" });
    const allocations = await storage.getPaymentAllocationsByInvoice(req.params.invoiceId);
    res.json(allocations);
  } catch (error) {
    console.error("Get invoice allocations error:", error);
    res.status(500).json({ error: "Failed to fetch invoice allocations" });
  }
});

router.post("/api/payment-allocations", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
  try {
    const validatedData = schema.insertPaymentAllocationSchema.parse(req.body);
    // Cross-Org-Schutz: Payment UND Invoice müssen zur Session-Org gehören,
    // und die Rechnung muss zum Mieter der Zahlung gehören (sonst könnte eine
    // eigene Zahlung mit einer fremden Rechnung verknüpft werden).
    const profile = await getProfileFromSession(req);
    const orgId = profile?.organizationId;
    if (!orgId) return res.status(403).json({ error: "Access denied" });
    const [paymentOk, invoiceOk] = await Promise.all([
      verifyPaymentOwnership(validatedData.paymentId, orgId),
      verifyInvoiceOwnership(validatedData.invoiceId, orgId),
    ]);
    if (!paymentOk || !invoiceOk) {
      return res.status(403).json({ error: "Access denied" });
    }
    const payment = await storage.getPayment(validatedData.paymentId);
    if (!payment || !(await verifyInvoiceBelongsToTenant(validatedData.invoiceId, payment.tenantId))) {
      return res.status(403).json({ error: "Access denied - invoice does not belong to payment tenant" });
    }
    // The allocation ledger is append-only and now has a source-pair unique
    // key. A repeated client submission is therefore an idempotent success,
    // not a 500 from the database constraint.
    const existing = (await storage.getPaymentAllocationsByPayment(validatedData.paymentId))
      .find((item: any) => item.invoiceId === validatedData.invoiceId);
    if (existing) {
      return res.status(201).json(existing);
    }
    const allocation = await storage.createPaymentAllocation(validatedData);
    res.status(201).json(allocation);
  } catch (error: any) {
    console.error("Create payment allocation error:", error);
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: "Validation error", details: error.errors });
    }
    res.status(500).json({ error: "Failed to create payment allocation" });
  }
});

// Zahlungszuordnungen sind unveränderliche Ledger-Einträge (Append-Only).
// Ein DB-seitiger BEFORE DELETE Trigger (trg_payment_allocations_immutable)
// verhindert direkte Löschungen auf Datenbankebene.
// Korrekte fachliche Vorgehensweise: Gegenbuchung anlegen (Storno-Allocation).
router.delete("/api/payment-allocations/:id", isAuthenticated, requireRole("property_manager", "finance"), async (_req: any, res) => {
  res.status(410).json({
    error: "Zahlungszuordnungen sind unveränderliche Ledger-Einträge und können nicht gelöscht werden.",
    hint: "Für eine Korrektur bitte eine Gegenbuchung (Storno-Allocation) anlegen.",
  });
});

// ===== Invoices CRUD =====

router.get("/api/invoices", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const orgId = profile?.organizationId;
    if (!orgId) return res.json({ data: [], pagination: { page: 1, limit: 100, total: 0 } });

    const { page, limit, offset } = parsePagination(req);
    const { year, month } = req.query;

    const unitIdsSq = db.select({ id: schema.units.id }).from(schema.units)
      .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
      .where(and(
        eq(schema.properties.organizationId, orgId),
        isNull(schema.properties.deletedAt),
        isNull(schema.units.deletedAt)
      ));

    const conditions: any[] = [inArray(schema.monthlyInvoices.unitId, unitIdsSq)];
    if (year) conditions.push(eq(schema.monthlyInvoices.year, parseInt(year as string)));
    if (year && month) conditions.push(eq(schema.monthlyInvoices.month, parseInt(month as string)));

    const whereCondition = and(...conditions);

    const [invoices, [{ total }]] = await Promise.all([
      db.select().from(schema.monthlyInvoices)
        .where(whereCondition)
        .orderBy(desc(schema.monthlyInvoices.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(schema.monthlyInvoices)
        .where(whereCondition),
    ]);

    const invoiceIds = invoices.map((invoice) => invoice.id);
    const dunningLines = invoiceIds.length > 0
      ? await db.select({
        invoiceId: schema.invoiceLines.invoiceId,
        amount: schema.invoiceLines.amount,
      })
        .from(schema.invoiceLines)
        .where(and(
          inArray(schema.invoiceLines.invoiceId, invoiceIds),
          inArray(schema.invoiceLines.lineType, ['mahnstufe_fee', 'verzugszinsen']),
        ))
      : [];
    const dunningChargesByInvoice = new Map<string, number>();
    for (const line of dunningLines) {
      dunningChargesByInvoice.set(
        line.invoiceId,
        roundMoney((dunningChargesByInvoice.get(line.invoiceId) || 0) + Number(line.amount)),
      );
    }

    const invoicesWithDunningCharges = invoices.map((invoice) => {
      const dunningCharges = dunningChargesByInvoice.get(invoice.id) || 0;
      return {
        ...invoice,
        gesamtbetrag: roundMoney(Number(invoice.gesamtbetrag || 0) + dunningCharges),
        dunningCharges,
      };
    });
    const roles = await getUserRoles(req);
    const items = isTester(roles) ? maskPersonalData(invoicesWithDunningCharges) : invoicesWithDunningCharges;
    res.json({ data: items, pagination: { page, limit, total } });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch invoices" });
  }
});

router.get("/api/invoices/:id", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const invoice = await storage.getInvoice(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }
    const unit = await storage.getUnit(invoice.unitId);
    if (unit) {
      const property = await storage.getProperty(unit.propertyId);
      if (property && property.organizationId !== profile?.organizationId) {
        return res.status(403).json({ error: "Access denied" });
      }
    }
    const lines = await db.select().from(schema.invoiceLines)
      .where(eq(schema.invoiceLines.invoiceId, invoice.id));
    const dunningCharges = roundMoney(lines
      .filter((line) => line.lineType === 'mahnstufe_fee' || line.lineType === 'verzugszinsen')
      .reduce((total, line) => total + Number(line.amount), 0));
    const invoiceWithDunningCharges = {
      ...invoice,
      gesamtbetrag: roundMoney(Number(invoice.gesamtbetrag || 0) + dunningCharges),
      dunningCharges,
      invoiceLines: lines,
    };
    const roles = await getUserRoles(req);
    res.json(isTester(roles) ? maskPersonalData(invoiceWithDunningCharges) : invoiceWithDunningCharges);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch invoice" });
  }
});

router.get("/api/invoices/:id/pdf", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const invoice = await storage.getInvoice(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const unit = await storage.getUnit(invoice.unitId);
    if (!unit) {
      return res.status(404).json({ error: "Unit not found" });
    }

    const property = await storage.getProperty(unit.propertyId);
    if (!property || property.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const org = profile?.organizationId
      ? await storage.getOrganization(profile.organizationId)
      : null;

    let tenant = null;
    if (invoice.tenantId) {
      tenant = await storage.getTenant(invoice.tenantId);
    }

    const lines = await db.select().from(schema.invoiceLines)
      .where(eq(schema.invoiceLines.invoiceId, invoice.id));

    const MONATSNAMEN = [
      '', 'Jaenner', 'Februar', 'Maerz', 'April', 'Mai', 'Juni',
      'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
    ];

    const positionen: VorschreibungData['positionen'] = [];

    if (lines.length > 0) {
      for (const line of lines) {
        const netto = Number(line.amount) || 0;
        const taxRate = line.taxRate || 0;
        const ust = Math.round(netto * taxRate) / 100;
        positionen.push({
          bezeichnung: line.description || line.lineType || 'Position',
          netto,
          ustSatz: taxRate,
          ust,
          brutto: netto + ust,
        });
      }
    } else {
      const grundmiete = Number(invoice.grundmiete) || 0;
      const bk = Number(invoice.betriebskosten) || 0;
      const hk = Number(invoice.heizungskosten) || 0;
      const wk = Number(invoice.wasserkosten) || 0;
      const ustMiete = invoice.ustSatzMiete || 10;
      const ustBk = invoice.ustSatzBk || 10;
      const ustHeizung = invoice.ustSatzHeizung || 20;
      const ustWasser = invoice.ustSatzWasser || 10;

      if (grundmiete > 0) {
        const ust = Math.round(grundmiete * ustMiete) / 100;
        positionen.push({ bezeichnung: 'Grundmiete', netto: grundmiete, ustSatz: ustMiete, ust, brutto: grundmiete + ust });
      }
      if (bk > 0) {
        const ust = Math.round(bk * ustBk) / 100;
        positionen.push({ bezeichnung: 'Betriebskosten', netto: bk, ustSatz: ustBk, ust, brutto: bk + ust });
      }
      if (hk > 0) {
        const ust = Math.round(hk * ustHeizung) / 100;
        positionen.push({ bezeichnung: 'Heizkosten', netto: hk, ustSatz: ustHeizung, ust, brutto: hk + ust });
      }
      if (wk > 0) {
        const ust = Math.round(wk * ustWasser) / 100;
        positionen.push({ bezeichnung: 'Wasserkosten', netto: wk, ustSatz: ustWasser, ust, brutto: wk + ust });
      }
    }

    const gesamtNetto = positionen.reduce((s, p) => s + p.netto, 0);
    const gesamtUst = positionen.reduce((s, p) => s + p.ust, 0);
    const gesamtBrutto = positionen.reduce((s, p) => s + p.brutto, 0);

    const monatName = MONATSNAMEN[invoice.month] || `Monat ${invoice.month}`;

    const vorschreibungData: VorschreibungData = {
      hausverwaltung: {
        name: org?.name || 'Hausverwaltung',
        address: [org?.address, org?.postalCode, org?.city].filter(Boolean).join(', ') || '',
        tel: org?.phone || undefined,
        email: org?.email || undefined,
      },
      mieter: {
        name: tenant ? `${tenant.firstName || ''} ${tenant.lastName || ''}`.trim() : 'Leerstand',
        address: `${property.address}, ${property.postalCode} ${property.city}`,
      },
      liegenschaft: property.name || '',
      einheit: unit.topNummer || '',
      monat: `${monatName} ${invoice.year}`,
      year: invoice.year,
      month: invoice.month,
      faelligkeitsdatum: invoice.faelligAm || `01.${String(invoice.month).padStart(2, '0')}.${invoice.year}`,
      positionen,
      gesamtNetto,
      gesamtUst,
      gesamtBrutto,
      bankverbindung: org?.iban ? {
        iban: org.iban,
        bic: org.bic || '',
        bank: org.name || '',
      } : undefined,
      rechnungsnummer: `VS-${invoice.year}-${String(invoice.month).padStart(2, '0')}-${invoice.id.substring(0, 8).toUpperCase()}`,
    };

    const pdfBuffer = await generateVorschreibungPdf(vorschreibungData);

    const filename = `Vorschreibung_${invoice.year}_${String(invoice.month).padStart(2, '0')}_${unit.topNummer || 'unit'}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    console.error("Generate invoice PDF error:", error);
    res.status(500).json({ error: "Failed to generate invoice PDF" });
  }
});

router.post("/api/invoices", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const normalizedBody = snakeToCamel(req.body);
    const validationResult = insertMonthlyInvoiceSchema.safeParse(normalizedBody);
    if (!validationResult.success) {
      return res.status(400).json({ error: "Validation failed", details: validationResult.error.flatten() });
    }
    const tenant = await storage.getTenant(validationResult.data.tenantId);
    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    const unit = await storage.getUnit(tenant.unitId);
    if (!unit) {
      return res.status(403).json({ error: "Access denied - unit not found" });
    }
    const property = await storage.getProperty(unit.propertyId);
    if (!property || property.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    const invoice = await storage.createInvoice(validationResult.data);

    try {
      const { createFinancialAuditEntry } = await import("../services/auditHashService");
      await createFinancialAuditEntry({
        action: "invoice_created",
        entityType: "invoice",
        entityId: invoice.id,
        organizationId: profile?.organizationId,
        userId: profile?.userId,
        data: {
          tenantId: invoice.tenantId,
          amount: invoice.gesamtBetrag,
          period: invoice.abrechnungsZeitraum,
          propertyId: property.id,
          unitId: unit.id,
          invoiceType: invoice.rechnungsTyp,
        },
      });
    } catch {}

    res.json(invoice);
  } catch (error) {
    console.error("Create invoice error:", error);
    res.status(500).json({ error: "Failed to create invoice" });
  }
});

router.patch("/api/invoices/:id", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const existingInvoice = await storage.getInvoice(req.params.id);
    if (!existingInvoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }
    const tenant = await storage.getTenant(existingInvoice.tenantId);
    if (!tenant) {
      return res.status(403).json({ error: "Access denied - tenant not found" });
    }
    const unit = await storage.getUnit(tenant.unitId);
    if (!unit) {
      return res.status(403).json({ error: "Access denied - unit not found" });
    }
    const property = await storage.getProperty(unit.propertyId);
    if (!property || property.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    const normalizedBody = snakeToCamel(req.body);
    const validationResult = insertMonthlyInvoiceSchema.partial().safeParse(normalizedBody);
    if (!validationResult.success) {
      return res.status(400).json({ error: "Validation failed", details: validationResult.error.flatten() });
    }
    // Beim Zuruecksetzen auf 'offen'/'ueberfaellig' paid_amount immer auf null setzen,
    // damit vollbezahlte Vorschreibungen nicht im offenen Saldo erscheinen.
    const updateData = applyInvoiceStatusRules(validationResult.data);
    const invoice = await storage.updateInvoice(req.params.id, updateData);
    res.json(invoice);
  } catch (error) {
    res.status(500).json({ error: "Failed to update invoice" });
  }
});

router.delete("/api/invoices/:id", isAuthenticated, requireRole("property_manager", "finance"), async (req, res) => {
  try {
    await storage.deleteInvoice(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete invoice" });
  }
});

router.post("/api/invoices/dry-run", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const { period, units: unitIds } = req.body;
    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ error: "Invalid period format. Use YYYY-MM" });
    }

    const [yearStr, monthStr] = period.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    let tenants = await storage.getTenantsByOrganization(profile.organizationId);
    const activeTenants = tenants.filter(t => t.status === "aktiv");

    const filteredTenants = unitIds && Array.isArray(unitIds) && unitIds.length > 0
      ? activeTenants.filter(t => t.unitId && unitIds.includes(t.unitId))
      : activeTenants;

    const preview = [];
    for (const tenant of filteredTenants) {
      if (!tenant.unitId) continue;

      const unit = await storage.getUnit(tenant.unitId);
      if (!unit) continue;

      const property = await storage.getProperty(unit.propertyId);
      if (!property) continue;

      const grundmiete = Number(tenant.grundmiete || 0);
      const bkVorschuss = Number(tenant.betriebskostenVorschuss || 0);
      const hkVorschuss = Number(tenant.heizkostenVorschuss || 0);

      const unitType = (unit.type || "wohnung").toLowerCase();
      const isCommercial = unitType.includes("geschäft") || unitType.includes("gewerbe") || unitType.includes("büro");
      const isParking = unitType.includes("stellplatz") || unitType.includes("garage") || unitType.includes("parkplatz");
      const mietUst = isCommercial || isParking ? 20 : 10;

      const mieteBrutto = grundmiete * (1 + mietUst / 100);
      const bkBrutto = bkVorschuss * 1.10;
      const hkBrutto = hkVorschuss * 1.20;
      const totalBrutto = mieteBrutto + bkBrutto + hkBrutto;

      preview.push({
        tenantId: tenant.id,
        tenantName: `${tenant.firstName} ${tenant.lastName}`,
        unitId: unit.id,
        unitNumber: unit.unitNumber,
        propertyId: property.id,
        propertyName: property.name,
        year,
        month,
        grundmieteNetto: grundmiete,
        grundmieteBrutto: mieteBrutto,
        mietUst,
        bkNetto: bkVorschuss,
        bkBrutto,
        hkNetto: hkVorschuss,
        hkBrutto,
        totalBrutto,
        dueDate: new Date(year, month - 1, 5).toISOString().split("T")[0]
      });
    }

    res.json({
      success: true,
      dryRun: true,
      period,
      count: preview.length,
      totalBrutto: preview.reduce((sum, p) => sum + p.totalBrutto, 0),
      preview
    });
  } catch (error) {
    console.error("Dry-run invoice error:", error);
    res.status(500).json({ error: "Failed to generate invoice preview" });
  }
});

// ===== Generate Monthly Invoices =====

router.post("/api/functions/generate-monthly-invoices", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const { year, month } = req.body;
    const currentDate = new Date();
    const targetYear = year || currentDate.getFullYear();
    const targetMonth = month || (currentDate.getMonth() + 1);

    const tenants = await storage.getTenantsByOrganization(profile.organizationId);
    const activeTenants = tenants.filter(t => t.status === 'aktiv');
    const vacancyTenants = tenants.filter(t => t.status === 'leerstand');

    const allTenants = [...activeTenants, ...vacancyTenants];
    const unitIds = [...new Set(allTenants.map(t => t.unitId).filter(Boolean))];
    const unitMap = new Map<string, any>();
    const propertyMap = new Map<string, any>();
    for (const uid of unitIds) {
      const unit = await storage.getUnit(uid);
      if (unit) {
        unitMap.set(uid, unit);
        if (!propertyMap.has(unit.propertyId)) {
          const prop = await storage.getProperty(unit.propertyId);
          if (prop) propertyMap.set(unit.propertyId, prop);
        }
      }
    }

    const existingInvoiceSet = new Set<string>();
    for (const tenant of allTenants) {
      const existingInvoices = await storage.getInvoicesByTenant(tenant.id);
      if (existingInvoices.some(inv => inv.month === targetMonth && inv.year === targetYear)) {
        existingInvoiceSet.add(tenant.id);
      }
    }

    const createdInvoices = [];
    const errors: string[] = [];

    for (const tenant of activeTenants) {
      try {
        if (existingInvoiceSet.has(tenant.id)) continue;

        const unit = unitMap.get(tenant.unitId);
        if (!unit) continue;

        const property = propertyMap.get(unit.propertyId);
        if (!property) continue;

        const grundmiete = Number(tenant.grundmiete || 0);
        const grundmieteUstSatz = 10;
        
        let betriebskostenTotal = 0;
        let heizungskostenTotal = 0;
        let wasserkostenTotal = 0;
        let ust10Total = 0;
        let ust20Total = 0;
        let hasSonstigeKosten = false;
        
        if (tenant.sonstigeKosten && typeof tenant.sonstigeKosten === 'object') {
          const positions = tenant.sonstigeKosten as Record<string, { betrag?: number | string; ust?: number }>;
          const keys = Object.keys(positions);
          hasSonstigeKosten = keys.length > 0;
          
          console.log(`[INVOICE-GEN] Mieter ${tenant.firstName} ${tenant.lastName}: sonstigeKosten gefunden mit ${keys.length} Positionen:`, JSON.stringify(positions));
          
          const heizungKeywords = ['heiz', 'hk', 'zentralheizung', 'fernwärme', 'wärme', 'heizung', 'heizk'];
          const wasserKeywords = ['wasser', 'kaltwasser', 'warmwasser', 'ww', 'kw', 'abwasser', 'kanal'];
          
          for (const [key, item] of Object.entries(positions)) {
            if (item && item.betrag !== undefined) {
              const betrag = typeof item.betrag === 'string' ? parseFloat(item.betrag) : Number(item.betrag);
              if (!isNaN(betrag)) {
                const keyLower = key.toLowerCase();
                const isHeizung = heizungKeywords.some(kw => keyLower.includes(kw));
                const isWasser = wasserKeywords.some(kw => keyLower.includes(kw));
                const isMahnkosten = keyLower.includes('mahn') || keyLower.includes('verzug');
                
                let ustSatz: number;
                if (item.ust !== undefined) {
                  ustSatz = Number(item.ust);
                } else if (isMahnkosten) {
                  ustSatz = 0;
                } else if (isHeizung) {
                  ustSatz = 20;
                } else {
                  ustSatz = 10;
                }
                
                const ustBetrag = betrag * ustSatz / 100;
                
                if (isHeizung) {
                  heizungskostenTotal += betrag;
                } else if (isWasser) {
                  wasserkostenTotal += betrag;
                } else {
                  betriebskostenTotal += betrag;
                }
                
                if (ustSatz === 20) {
                  ust20Total += ustBetrag;
                } else if (ustSatz === 10) {
                  ust10Total += ustBetrag;
                }
              }
            }
          }
        }
        
        const grundmieteUst = grundmiete * grundmieteUstSatz / 100;
        ust10Total += grundmieteUst;
        
        const betriebskosten = hasSonstigeKosten ? betriebskostenTotal : Number(tenant.betriebskostenVorschuss || 0);
        const heizungskosten = hasSonstigeKosten ? heizungskostenTotal : Number(tenant.heizkostenVorschuss || 0);
        const wasserkosten = hasSonstigeKosten ? wasserkostenTotal : Number(tenant.wasserkostenVorschuss || 0);
        
        console.log(`[INVOICE-GEN] Mieter ${tenant.firstName} ${tenant.lastName}: Kategorisiert -> BK=${betriebskosten}, HK=${heizungskosten}, Wasser=${wasserkosten}, USt10=${ust10Total.toFixed(2)}, USt20=${ust20Total.toFixed(2)}`);
        
        if (!hasSonstigeKosten) {
          ust10Total = (grundmiete + betriebskosten + wasserkosten) * 0.10;
          ust20Total = heizungskosten * 0.20;
        }
        
        const totalUst = ust10Total + ust20Total;
        const nettoGesamt = grundmiete + betriebskosten + heizungskosten + wasserkosten;
        const gesamtbetrag = nettoGesamt + totalUst;

        const faelligAm = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`;

        const invoiceData = {
          tenantId: tenant.id,
          unitId: tenant.unitId,
          month: targetMonth,
          year: targetYear,
          grundmiete: String(grundmiete),
          betriebskosten: String(betriebskosten),
          heizungskosten: String(heizungskosten),
          wasserkosten: String(wasserkosten),
          ust: String(totalUst.toFixed(2)),
          gesamtbetrag: String(gesamtbetrag.toFixed(2)),
          faelligAm,
          status: 'offen' as const,
          vortragMiete: '0',
          vortragBk: '0',
          vortragHk: '0',
        };

        console.log(`[INVOICE-GEN] Erstelle Vorschreibung für ${tenant.firstName} ${tenant.lastName}: Miete=${grundmiete}, BK=${betriebskosten}, HK=${heizungskosten}, Wasser=${wasserkosten}, USt=${totalUst.toFixed(2)}, Gesamt=${gesamtbetrag.toFixed(2)}`);
        
        const newInvoice = await storage.createInvoice(invoiceData);
        createdInvoices.push(newInvoice);
      } catch (err) {
        errors.push(`Fehler bei Mieter ${tenant.firstName} ${tenant.lastName}: ${err}`);
      }
    }

    for (const tenant of vacancyTenants) {
      try {
        if (existingInvoiceSet.has(tenant.id)) continue;

        const unit = unitMap.get(tenant.unitId);
        if (!unit) continue;

        const bk = Number(unit.leerstandBk || tenant.betriebskostenVorschuss || 0);
        const hk = Number(unit.leerstandHk || tenant.heizkostenVorschuss || 0);
        if (bk === 0 && hk === 0) continue;

        const ust10 = bk * 0.10;
        const ust20 = hk * 0.20;
        const totalUst = ust10 + ust20;
        const gesamtbetrag = bk + hk + totalUst;
        const faelligAm = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`;

        const invoiceData = {
          tenantId: tenant.id,
          unitId: tenant.unitId,
          month: targetMonth,
          year: targetYear,
          grundmiete: '0',
          betriebskosten: String(bk),
          heizungskosten: String(hk),
          wasserkosten: '0',
          ust: String(totalUst.toFixed(2)),
          gesamtbetrag: String(gesamtbetrag.toFixed(2)),
          faelligAm,
          status: 'offen' as const,
          vortragMiete: '0',
          vortragBk: '0',
          vortragHk: '0',
          isVacancy: true,
        };

        const newInvoice = await storage.createInvoice(invoiceData);
        createdInvoices.push(newInvoice);
      } catch (err) {
        errors.push(`Leerstand-Fehler bei Einheit ${tenant.unitId}: ${err}`);
      }
    }

    res.json({
      success: true,
      created: createdInvoices.length,
      skipped: (activeTenants.length + vacancyTenants.length) - createdInvoices.length - errors.length,
      errors: errors.length,
      errorDetails: errors,
    });
  } catch (error) {
    console.error('Generate invoices error:', error);
    res.status(500).json({ error: "Vorschreibungen konnten nicht erstellt werden" });
  }
});

// ===== Billing Generate =====

router.post("/api/billing/generate", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const { year, month, propertyIds, dryRun } = req.body;
    
    const currentDate = new Date();
    const targetYear = year || currentDate.getFullYear();
    const targetMonth = month || (currentDate.getMonth() + 1);

    let finalPropertyIds = propertyIds;
    if (!finalPropertyIds || !Array.isArray(finalPropertyIds) || finalPropertyIds.length === 0) {
      const allProps = await storage.getPropertiesByOrganization(profile.organizationId);
      finalPropertyIds = allProps.map(p => p.id);
    }

    const result = await billingService.generateMonthlyInvoices({
      userId: profile.userId,
      organizationId: profile.organizationId,
      propertyIds: finalPropertyIds,
      year: targetYear,
      month: targetMonth,
      dryRun: dryRun ?? false
    });

    res.json(result);
  } catch (error) {
    console.error("Billing generate error:", error);
    res.status(500).json({ error: "Failed to generate invoices" });
  }
});

// ===== Invoice Payments =====

router.get("/api/invoices/:invoiceId/payments", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });
    const isOwner = await verifyInvoiceOwnership(req.params.invoiceId, profile.organizationId);
    if (!isOwner) return res.status(403).json({ error: "Zugriff verweigert" });
    const payments = await storage.getPaymentsByInvoice(req.params.invoiceId);
    const roles = await getUserRoles(req);
    res.json(isTester(roles) ? maskPersonalData(payments) : payments);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch invoice payments" });
  }
});

// ===== Bank Accounts CRUD =====

router.get("/api/bank-accounts", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const accounts = await storage.getBankAccountsByOrganization(profile?.organizationId);
    const roles = await getUserRoles(req);
    res.json(isTester(roles) ? maskPersonalData(accounts) : accounts);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch bank accounts" });
  }
});

router.get("/api/bank-accounts/:id", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const account = await storage.getBankAccount(req.params.id);
    if (!account) return res.status(404).json({ error: "Bank account not found" });
    // SECURITY: org-scope check — prevent cross-tenant IBAN/balance read
    if (account.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    const roles = await getUserRoles(req);
    res.json(isTester(roles) ? maskPersonalData(account) : account);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch bank account" });
  }
});

router.post("/api/bank-accounts", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "No organization" });
    
    const { account_name, bank_name, opening_balance, opening_balance_date, property_id, iban, bic } = req.body;
    
    const account = await storage.createBankAccount({
      organizationId: profile.organizationId,
      accountName: account_name,
      bankName: bank_name || null,
      openingBalance: opening_balance?.toString() || '0',
      openingBalanceDate: opening_balance_date || null,
      propertyId: property_id || null,
      iban: iban || null,
      bic: bic || null,
    });
    res.status(201).json(account);
  } catch (error) {
    console.error('Create bank account error:', error);
    res.status(500).json({ error: "Failed to create bank account" });
  }
});

router.patch("/api/bank-accounts/:id", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const account = await storage.getBankAccount(req.params.id);
    if (!account) return res.status(404).json({ error: "Bank account not found" });
    if (account.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    const { account_name, bank_name, opening_balance, opening_balance_date, property_id, iban, bic } = req.body;
    
    const updateData: any = {};
    if (account_name !== undefined) updateData.accountName = account_name;
    if (bank_name !== undefined) updateData.bankName = bank_name;
    if (opening_balance !== undefined) updateData.openingBalance = opening_balance?.toString();
    if (opening_balance_date !== undefined) updateData.openingBalanceDate = opening_balance_date;
    if (property_id !== undefined) updateData.propertyId = property_id;
    if (iban !== undefined) updateData.iban = iban;
    if (bic !== undefined) updateData.bic = bic;
    
    const updated = await storage.updateBankAccount(req.params.id, updateData, profile?.organizationId ?? undefined);
    res.json(updated);
  } catch (error) {
    console.error('Update bank account error:', error);
    res.status(500).json({ error: "Failed to update bank account" });
  }
});

router.delete("/api/bank-accounts/:id", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const account = await storage.getBankAccount(req.params.id);
    if (!account) return res.status(404).json({ error: "Bank account not found" });
    if (account.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    await storage.deleteBankAccount(req.params.id, profile?.organizationId ?? undefined);
    res.status(204).send();
  } catch (error) {
    console.error('Delete bank account error:', error);
    res.status(500).json({ error: "Failed to delete bank account" });
  }
});

router.get("/api/bank-accounts/:id/balance", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const account = await storage.getBankAccount(req.params.id);
    if (!account) return res.status(404).json({ error: "Bank account not found" });
    if (account.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    const asOfDate = req.query.as_of_date as string | undefined;
    const balance = await storage.getBankAccountBalance(req.params.id, asOfDate);
    res.json({ balance });
  } catch (error) {
    console.error('Get bank balance error:', error);
    res.status(500).json({ error: "Failed to calculate bank balance" });
  }
});

router.get("/api/bank-accounts/:id/transactions", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    // SECURITY: verify bank account belongs to caller's org before listing transactions
    const account = await storage.getBankAccount(req.params.id);
    if (!account) return res.status(404).json({ error: "Bank account not found" });
    if (account.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    const transactions = await storage.getTransactionsByBankAccount(req.params.id);
    const roles = await getUserRoles(req);
    res.json(isTester(roles) ? maskPersonalData(transactions) : transactions);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

router.get("/api/bank-accounts/:id/plausibility-report", isAuthenticated, async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const account = await storage.getBankAccount(req.params.id);
    
    if (!account) {
      return res.status(404).json({ error: "Bankkonto nicht gefunden" });
    }
    if (account.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Zugriff verweigert" });
    }
    
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    
    const allTransactions = await storage.getTransactionsByBankAccount(req.params.id);
    const yearTransactions = allTransactions.filter(tx => {
      const txDate = tx.transactionDate;
      if (!txDate) return false;
      const txDateParsed = new Date(txDate);
      const startDateParsed = new Date(startDate);
      const endDateParsed = new Date(endDate);
      return txDateParsed >= startDateParsed && txDateParsed <= endDateParsed;
    });
    
    let totalIncome = 0;
    let totalExpenses = 0;
    
    for (const tx of yearTransactions) {
      const amount = Number(tx.amount) || 0;
      if (amount > 0) {
        totalIncome += amount;
      } else {
        totalExpenses += Math.abs(amount);
      }
    }
    
    const openingBalanceDate = account.openingBalanceDate;
    let openingBalance = 0;
    
    if (openingBalanceDate === startDate) {
      openingBalance = Number(account.openingBalance) || 0;
    } else {
      const previousYearEnd = `${year - 1}-12-31`;
      openingBalance = await storage.getBankAccountBalance(req.params.id, previousYearEnd);
    }
    
    const closingBalance = await storage.getBankAccountBalance(req.params.id, endDate);
    
    const expectedClosingBalance = openingBalance + totalIncome - totalExpenses;
    
    const difference = Math.abs(closingBalance - expectedClosingBalance);
    const isPlausible = difference < 0.01;
    
    res.json({
      year,
      accountName: account.accountName,
      iban: account.iban,
      openingBalance,
      totalIncome,
      totalExpenses,
      expectedClosingBalance,
      actualClosingBalance: closingBalance,
      difference,
      isPlausible,
      transactionCount: yearTransactions.length,
      formula: `Anfangsbestand (${openingBalance.toFixed(2)} €) + Einnahmen (${totalIncome.toFixed(2)} €) - Ausgaben (${totalExpenses.toFixed(2)} €) = ${expectedClosingBalance.toFixed(2)} €`,
    });
  } catch (error) {
    console.error('Plausibility report error:', error);
    res.status(500).json({ error: "Fehler beim Erstellen des Plausibilitätsberichts" });
  }
});

router.post("/api/bank-accounts/:id/carry-over", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const account = await storage.getBankAccount(req.params.id);
    
    if (!account) {
      return res.status(404).json({ error: "Bankkonto nicht gefunden" });
    }
    if (account.organizationId !== profile?.organizationId) {
      return res.status(403).json({ error: "Zugriff verweigert" });
    }
    
    const { year, force } = req.body;
    if (!year || typeof year !== 'number') {
      return res.status(400).json({ error: "Jahr ist erforderlich" });
    }
    
    const newOpeningBalanceDate = `${year + 1}-01-01`;
    const existingDate = account.openingBalanceDate;
    const existingBalance = Number(account.openingBalance) || 0;
    
    if (existingDate && existingDate === newOpeningBalanceDate && !force) {
      return res.status(409).json({ 
        error: "Anfangsbestand existiert bereits",
        warning: `Es existiert bereits ein Anfangsbestand für 01.01.${year + 1} (${existingBalance.toFixed(2)} €). Senden Sie { force: true } um zu überschreiben.`,
        existingBalance,
        existingDate,
      });
    }
    
    const endDate = `${year}-12-31`;
    const closingBalance = await storage.getBankAccountBalance(req.params.id, endDate);
    
    const updated = await storage.updateBankAccount(req.params.id, {
      openingBalance: closingBalance.toString(),
      openingBalanceDate: newOpeningBalanceDate,
    }, profile?.organizationId ?? undefined);
    
    res.json({
      success: true,
      message: `Endbestand vom 31.12.${year} (${closingBalance.toFixed(2)} €) wurde als Anfangsbestand für 01.01.${year + 1} übertragen.`,
      previousBalance: closingBalance,
      newOpeningBalanceDate,
      account: updated,
      wasOverwritten: existingDate === newOpeningBalanceDate,
    });
  } catch (error) {
    console.error('Bank account carry-over error:', error);
    res.status(500).json({ error: "Fehler beim Jahresübertrag" });
  }
});

// ====== BANK RECONCILIATION (Bank-Abgleich) ======

router.post("/api/bank-reconciliation/match", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const orgId = profile?.organizationId;
    if (!orgId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });

    const { bankAccountId } = req.body;
    if (!bankAccountId) return res.status(400).json({ error: "bankAccountId ist erforderlich" });

    const account = await storage.getBankAccount(bankAccountId);
    if (!account || account.organizationId !== orgId) {
      return res.status(403).json({ error: "Zugriff verweigert" });
    }

    const allTransactions = await storage.getTransactionsByBankAccount(bankAccountId);
    const unmatchedTransactions = allTransactions.filter(tx => !tx.isMatched && Number(tx.amount) > 0);

    const allInvoices = await storage.getMonthlyInvoicesByOrganization(orgId);
    const openInvoices = allInvoices.filter(inv => inv.status !== 'bezahlt' && inv.status !== 'storniert' as any);

    const allTenants = await storage.getTenantsByOrganization(orgId);
    const allUnits = await storage.getUnitsByOrganization(orgId);
    const allProperties = await storage.getPropertiesByOrganization(orgId);

    const tenantMap = new Map(allTenants.map(t => [t.id, t]));
    const unitMap = new Map(allUnits.map(u => [u.id, u]));
    const propertyMap = new Map(allProperties.map(p => [p.id, p]));

    const proposals: any[] = [];

    for (const tx of unmatchedTransactions) {
      const txAmount = Number(tx.amount);
      const txIban = (tx.partnerIban || '').replace(/\s/g, '').toUpperCase();
      const txRef = `${tx.reference || ''} ${tx.bookingText || ''}`.toLowerCase();
      const matches: any[] = [];

      for (const inv of openInvoices) {
        const invAmount = Number(inv.gesamtbetrag);
        const tenant = inv.tenantId ? tenantMap.get(inv.tenantId) : null;
        const unit = inv.unitId ? unitMap.get(inv.unitId) : null;
        const property = unit?.propertyId ? propertyMap.get(unit.propertyId) : null;
        const tenantIban = (tenant?.iban || '').replace(/\s/g, '').toUpperCase();
        const tenantName = tenant ? `${tenant.firstName} ${tenant.lastName}` : 'Unbekannt';
        const invoiceNumber = `VS-${inv.year}-${String(inv.month).padStart(2, '0')}-${inv.id.substring(0, 8).toUpperCase()}`;

        const amountMatch = Math.abs(txAmount - invAmount) < 0.01;
        const ibanMatch = txIban.length > 10 && tenantIban.length > 10 && txIban === tenantIban;
        const refMatch = txRef.includes(invoiceNumber.toLowerCase()) ||
          txRef.includes(`${inv.year}/${String(inv.month).padStart(2, '0')}`) ||
          txRef.includes(inv.id.substring(0, 8).toLowerCase());

        let confidence = 0;
        let matchReason = '';

        if (ibanMatch && amountMatch) {
          confidence = 98;
          matchReason = 'IBAN + Betrag';
        } else if (amountMatch && refMatch) {
          confidence = 95;
          matchReason = 'Betrag + Referenz';
        } else if (amountMatch) {
          confidence = 95;
          matchReason = 'Exakter Betrag';
        } else if (refMatch) {
          confidence = 90;
          matchReason = 'Referenz/Verwendungszweck';
        }

        if (confidence > 0) {
          matches.push({
            invoiceId: inv.id,
            invoiceNumber,
            tenantId: tenant?.id || null,
            tenantName,
            unitId: unit?.id || null,
            unitTopNummer: unit?.topNummer || '',
            propertyName: property?.name || '',
            invoiceAmount: invAmount,
            confidence,
            matchReason,
          });
        }
      }

      if (matches.length === 0) {
        const tenantInvoiceGroups = new Map<string, { total: number; invoices: any[] }>();
        for (const inv of openInvoices) {
          if (!inv.tenantId) continue;
          const tenant = tenantMap.get(inv.tenantId);
          const tenantIban = (tenant?.iban || '').replace(/\s/g, '').toUpperCase();
          if (txIban.length > 10 && tenantIban.length > 10 && txIban === tenantIban) {
            const group = tenantInvoiceGroups.get(inv.tenantId) || { total: 0, invoices: [] };
            const invAmount = Number(inv.gesamtbetrag);
            group.total += invAmount;
            const unit = inv.unitId ? unitMap.get(inv.unitId) : null;
            const property = unit?.propertyId ? propertyMap.get(unit.propertyId) : null;
            const invoiceNumber = `VS-${inv.year}-${String(inv.month).padStart(2, '0')}-${inv.id.substring(0, 8).toUpperCase()}`;
            group.invoices.push({
              invoiceId: inv.id,
              invoiceNumber,
              tenantId: inv.tenantId,
              tenantName: tenant ? `${tenant.firstName} ${tenant.lastName}` : 'Unbekannt',
              unitId: unit?.id || null,
              unitTopNummer: unit?.topNummer || '',
              propertyName: property?.name || '',
              invoiceAmount: invAmount,
              confidence: 75,
              matchReason: 'Teilbetrag (mehrere Rechnungen)',
            });
            tenantInvoiceGroups.set(inv.tenantId, group);
          }
        }
        for (const [, group] of tenantInvoiceGroups) {
          if (Math.abs(txAmount - group.total) < 0.01 && group.invoices.length > 1) {
            matches.push(...group.invoices);
          }
        }
      }

      if (matches.length > 0) {
        matches.sort((a: any, b: any) => b.confidence - a.confidence);
        const topConfidence = Math.max(...matches.map((match) => match.confidence));
        const topMatches = matches.filter((match) => match.confidence === topConfidence);
        // A score is only a suggestion. Several equally good candidates must
        // stay visibly unresolved until a human picks one.
        const resolution = topMatches.length === 1 ? "unique" : "ambiguous";
        proposals.push({
          transactionId: tx.id,
          transactionDate: tx.transactionDate,
          amount: txAmount,
          partnerName: tx.partnerName || '',
          partnerIban: tx.partnerIban || '',
          bookingText: tx.bookingText || '',
          matches,
          resolution,
          clarificationReason: resolution === "ambiguous"
            ? `${topMatches.length} gleichwertige Treffer – bitte Rechnung manuell wählen`
            : undefined,
        });
      }
    }

    res.json(proposals);
  } catch (error) {
    console.error('Bank reconciliation match error:', error);
    res.status(500).json({ error: "Fehler beim automatischen Abgleich" });
  }
});

router.post("/api/bank-reconciliation/apply", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const orgId = profile?.organizationId;
    if (!orgId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });

    const { actions } = req.body;
    if (!Array.isArray(actions) || actions.length === 0) {
      return res.status(400).json({ error: "Keine Aktionen angegeben" });
    }

    const results: any[] = [];
    const errors: string[] = [];

    for (const action of actions) {
      try {
        const { transactionId, invoiceId, tenantId, unitId } = action;

        const txOwned = await verifyTransactionOwnership(transactionId, orgId);
        if (!txOwned) {
          errors.push(`Transaktion ${transactionId}: gehört nicht zur Organisation`);
          continue;
        }
        const sourceTransaction = await storage.getTransaction(transactionId);
        if (!sourceTransaction || Number(sourceTransaction.amount) <= 0) {
          errors.push(`Transaktion ${transactionId}: kein buchbarer Zahlungseingang`);
          continue;
        }
        if (invoiceId) {
          const invOwned = await verifyInvoiceOwnership(invoiceId, orgId);
          if (!invOwned) {
            errors.push(`Transaktion ${transactionId}: Rechnung gehört nicht zur Organisation`);
            continue;
          }
        }
        if (tenantId) {
          const tenOwned = await verifyTenantOwnership(tenantId, orgId);
          if (!tenOwned) {
            errors.push(`Transaktion ${transactionId}: Mieter gehört nicht zur Organisation`);
            continue;
          }
        }

        // transactionId is deliberately also the payment id. The unique
        // transaction_id index plus the allocation service's row lock make a
        // repeated click or concurrent request return the original posting.
        const payment = await paymentService.allocatePayment({
          paymentId: transactionId,
          transactionId,
          tenantId,
          invoiceId,
          // Der Betrag stammt ausschließlich vom gespeicherten Bankumsatz,
          // nie aus dem (manipulierbaren) Browser-Request.
          amount: Number(sourceTransaction.amount),
          bookingDate: new Date().toISOString().split('T')[0],
          paymentType: 'ueberweisung',
          reference: `Bank-Abgleich: Transaktion ${transactionId}`,
          userId: profile?.userId,
          organizationId: orgId,
        });
        await db.update(schema.transactions)
          .set({ matchedUnitId: unitId || null })
          .where(and(eq(schema.transactions.id, transactionId), eq(schema.transactions.organizationId, orgId)));
        results.push({ transactionId, invoiceId, paymentId: transactionId, status: 'success', ...payment });
      } catch (err: any) {
        errors.push(`Transaktion ${action.transactionId}: ${err.message}`);
      }
    }

    res.json({ applied: results.length, errors: errors.length, results, errorDetails: errors });
  } catch (error) {
    console.error('Bank reconciliation apply error:', error);
    res.status(500).json({ error: "Fehler beim Übernehmen der Zuordnungen" });
  }
});

router.get("/api/bank-reconciliation/stats", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const orgId = profile?.organizationId;
    if (!orgId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });

    const allTransactions = await storage.getTransactionsByOrganization(orgId);
    const totalCount = allTransactions.length;
    const matchedCount = allTransactions.filter(tx => tx.isMatched).length;
    const unmatchedIncome = allTransactions.filter(tx => !tx.isMatched && Number(tx.amount) > 0);
    const unmatchedCount = unmatchedIncome.length;
    const unmatchedAmount = unmatchedIncome.reduce((sum, tx) => sum + Number(tx.amount), 0);
    const matchRate = totalCount > 0 ? Math.round((matchedCount / totalCount) * 100) : 0;

    res.json({
      totalTransactions: totalCount,
      matchedTransactions: matchedCount,
      unmatchedCount,
      unmatchedAmount,
      matchRate,
      lastReconciliation: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Bank reconciliation stats error:', error);
    res.status(500).json({ error: "Fehler beim Abrufen der Statistiken" });
  }
});

// ===== Bank Import (CAMT.053) =====

router.post("/api/bank-import/camt053", isAuthenticated, async (req: any, res) => {
  try {
    const xmlContent = typeof req.body === 'string' ? req.body : req.body?.xml || req.body?.content;
    if (!xmlContent || typeof xmlContent !== 'string') {
      return res.status(400).json({ error: "XML-Inhalt fehlt. Senden Sie den XML-Text als Body oder als { xml: '...' }" });
    }
    const result = parseCamt053(xmlContent);
    res.json(result);
  } catch (error: any) {
    console.error('CAMT.053 parse error:', error);
    res.status(400).json({ error: `CAMT.053 Parsing-Fehler: ${error.message || 'Unbekannter Fehler'}` });
  }
});

router.post("/api/bank-import/camt053/apply", isAuthenticated, requireMutationAccess(), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    const orgId = profile?.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Keine Organisation zugeordnet" });
    }

    const { accountIban, transactions: txns, bankAccountId } = req.body;
    if (!txns || !Array.isArray(txns) || txns.length === 0) {
      return res.status(400).json({ error: "Keine Transaktionen zum Importieren" });
    }

    let resolvedBankAccountId = bankAccountId;
    if (!resolvedBankAccountId && accountIban) {
      const orgBankAccounts = await storage.getBankAccountsByOrganization(orgId);
      const normalizedIban = accountIban.replace(/\s/g, '').toUpperCase();
      const matched = orgBankAccounts.find((ba: any) =>
        ba.iban && ba.iban.replace(/\s/g, '').toUpperCase() === normalizedIban
      );
      if (matched) {
        resolvedBankAccountId = matched.id;
      }
    }

    const created: any[] = [];
    const duplicateCount = { value: 0 };
    await db.transaction(async (importTx) => {
      for (const tx of txns) {
      const signedAmount = tx.creditDebit === 'DBIT'
        ? -Math.abs(tx.amount)
        : Math.abs(tx.amount);
      const importHash = createHash("sha256").update(JSON.stringify({
        accountIban: (accountIban || "").replace(/\s/g, "").toUpperCase(),
        bookingDate: tx.bookingDate || tx.valueDate || "",
        valueDate: tx.valueDate || "",
        amount: Number(signedAmount).toFixed(2),
        creditDebit: tx.creditDebit || "",
        endToEndId: tx.endToEndId || "",
        transactionId: tx.transactionId || "",
        remittanceInfo: tx.remittanceInfo || "",
        counterpartyName: tx.counterpartyName || "",
      })).digest("hex");

      const inserted: any = await importTx.execute(sql`
        INSERT INTO transactions (
          organization_id, bank_account_id, amount, transaction_date, booking_text,
          partner_name, partner_iban, reference, raw_data, import_hash,
          reconciliation_status, reconciliation_reason
        )
        VALUES (
          ${orgId}, ${resolvedBankAccountId || null}, ${signedAmount.toFixed(2)},
          ${tx.bookingDate || tx.valueDate}, ${tx.remittanceInfo || null},
          ${tx.counterpartyName || null}, ${encryptField(tx.counterpartyIban || null)},
          ${tx.endToEndId || tx.remittanceInfo || null},
          ${JSON.stringify({ ...tx, counterpartyIban: undefined, counterpartyBic: undefined })}::jsonb,
          ${importHash}, ${signedAmount > 0 ? "unmatched" : "ignored"},
          ${signedAmount > 0 ? "Noch keiner Forderung eindeutig zugeordnet" : "Ausgang bzw. keine Forderung"}
        )
        ON CONFLICT (organization_id, import_hash) WHERE import_hash IS NOT NULL
        DO NOTHING
        RETURNING *
      `);
      const row = inserted.rows?.[0];
      if (!row) {
        duplicateCount.value += 1;
        continue;
      }
      created.push({ ...row, partnerIban: decryptField(row.partner_iban) });
      }
    });

    // CAMT imports are never matched by "first suggestion". Exact amount is
    // sufficient only if it identifies exactly one still-open invoice.
    const automaticResults: any[] = [];
    for (const imported of created.filter((row) => Number(row.amount) > 0)) {
      const candidates: any = await db.execute(sql`
        SELECT mi.id, mi.tenant_id, mi.unit_id, mi.gesamtbetrag, COALESCE(mi.paid_amount, 0) AS paid_amount
        FROM monthly_invoices mi
        JOIN units u ON u.id = mi.unit_id
        JOIN properties p ON p.id = u.property_id
        WHERE p.organization_id = ${orgId}
          AND mi.status IN ('offen', 'teilbezahlt', 'ueberfaellig')
      `);
      const rows = (candidates.rows || []).map((candidate: any) => ({
        id: candidate.id,
        tenantId: candidate.tenant_id,
        unitId: candidate.unit_id,
        total: Number(candidate.gesamtbetrag),
        paid: Number(candidate.paid_amount),
      }));
      const reference = `${imported.reference || ""} ${imported.booking_text || ""}`.toLowerCase();
      const resolution = resolveCamtPayment(rows, Number(imported.amount), reference);
      if (resolution.status !== "matched") {
        const status = resolution.status;
        const reason = resolution.reason;
        await db.update(schema.transactions).set({
          reconciliationStatus: status,
          reconciliationReason: reason,
        }).where(and(eq(schema.transactions.id, imported.id), eq(schema.transactions.organizationId, orgId)));
        automaticResults.push({ transactionId: imported.id, status, reason });
        continue;
      }
      const candidate = resolution.candidate;
      try {
        const allocation = await paymentService.allocatePayment({
          paymentId: imported.id,
          transactionId: imported.id,
          tenantId: candidate.tenantId,
          invoiceId: candidate.id,
          amount: Number(imported.amount),
          bookingDate: imported.transaction_date,
          paymentType: "ueberweisung",
          reference: imported.reference || imported.booking_text || undefined,
          userId: profile?.userId,
          organizationId: orgId,
        });
        await db.update(schema.transactions).set({ matchedUnitId: candidate.unitId })
          .where(and(eq(schema.transactions.id, imported.id), eq(schema.transactions.organizationId, orgId)));
        automaticResults.push({ transactionId: imported.id, status: "matched", allocation });
      } catch (allocationError: any) {
        await db.update(schema.transactions).set({
          reconciliationStatus: "allocation_failed",
          reconciliationReason: allocationError.message || "Zahlung konnte nicht gebucht werden",
        }).where(and(eq(schema.transactions.id, imported.id), eq(schema.transactions.organizationId, orgId)));
        automaticResults.push({ transactionId: imported.id, status: "allocation_failed", reason: allocationError.message });
      }
    }

    if (resolvedBankAccountId) {
      const balance = await storage.getBankAccountBalance(resolvedBankAccountId);
      await storage.updateBankAccount(resolvedBankAccountId, {
        currentBalance: balance.toString(),
        lastSyncedAt: new Date(),
      }, orgId);
    }

    res.json({
      success: true,
      importedCount: created.length,
      duplicateCount: duplicateCount.value,
      bankAccountId: resolvedBankAccountId || null,
      transactions: created,
      reconciliation: automaticResults,
    });
  } catch (error: any) {
    console.error('CAMT.053 apply error:', error);
    res.status(500).json({ error: `Import-Fehler: ${error.message || 'Unbekannter Fehler'}` });
  }
});

// ===== Banking Sync - Transactions to Payments =====

router.post("/api/sync/transactions-to-payments", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
  try {
    const orgId = req.session.organizationId;
    
    const categories = await db.select()
      .from(schema.accountCategories)
      .where(eq(schema.accountCategories.organizationId, orgId));
    
    const incomeCategories = categories.filter(c => c.type === 'income');
    if (incomeCategories.length === 0) {
      return res.status(400).json({ error: "Keine Einnahmen-Kategorien gefunden" });
    }
    const incomeCategoryIds = incomeCategories.map(c => c.id);
    
    const transactions = await db.select()
      .from(schema.transactions)
      .where(inArray(schema.transactions.categoryId, incomeCategoryIds));
    
    const orgProperties = await db.select()
      .from(schema.properties)
      .where(eq(schema.properties.organizationId, orgId));
    const orgPropertyIds = orgProperties.map(p => p.id);
    
    const allUnits = await db.select().from(schema.units);
    const units = allUnits.filter(u => orgPropertyIds.includes(u.propertyId!));
    const orgUnitIds = units.map(u => u.id);
    
    const allTenants = decryptIbanRows(await db.select().from(schema.tenants));
    const tenants = allTenants.filter(t => orgUnitIds.includes(t.unitId!));
    const orgTenantIds = tenants.map(t => t.id);
    
    const allPayments = await db.select().from(schema.payments);
    const payments = allPayments.filter(p => orgTenantIds.includes(p.tenantId!));
    
    let synced = 0;
    let skipped = 0;
    
    for (const transaction of transactions) {
      if (Number(transaction.amount) <= 0) {
        skipped++;
        continue;
      }
      
      const existingPayment = payments.find(p => {
        const pTenantId = p.tenantId;
        const tTenantId = transaction.tenantId;
        return pTenantId === tTenantId &&
          Math.abs(Number(p.betrag) - Number(transaction.amount)) < 0.01 &&
          p.buchungsDatum === transaction.transactionDate;
      });
      
      if (existingPayment) {
        skipped++;
        continue;
      }
      
      let tenantId = transaction.tenantId;
      if (!tenantId && transaction.propertyId) {
        const propertyUnits = units.filter(u => u.propertyId === transaction.propertyId);
        const propertyTenants = tenants.filter(t => 
          propertyUnits.some(u => u.id === t.unitId)
        );
        if (propertyTenants.length === 1) {
          tenantId = propertyTenants[0].id;
        }
      }
      
      if (!tenantId) {
        skipped++;
        continue;
      }
      
      try {
        const [newPayment] = await db.insert(schema.payments).values({
          tenantId,
          betrag: String(transaction.amount),
          buchungsDatum: transaction.transactionDate || new Date().toISOString().split('T')[0],
          eingangsDatum: transaction.bookingDate || transaction.transactionDate,
          verwendungszweck: transaction.description || 'Mietzahlung',
          paymentType: 'ueberweisung',
          transactionId: transaction.id,
        }).returning();
        
        if (newPayment) {
          try {
            await paymentService.allocatePayment({
              paymentId: newPayment.id,
              tenantId: newPayment.tenantId,
              amount: Number(newPayment.betrag),
              bookingDate: newPayment.buchungsDatum || undefined,
              paymentType: newPayment.paymentType || 'ueberweisung',
              reference: newPayment.verwendungszweck || undefined,
              organizationId: orgId,
            });
          } catch (allocError) {
            console.error('Payment allocation error (non-critical):', allocError);
          }
        }
        
        synced++;
      } catch (error) {
        console.error('Failed to sync transaction to payment:', transaction.id, error);
      }
    }
    
    res.json({ synced, skipped, message: `${synced} Mieteinnahmen synchronisiert, ${skipped} übersprungen` });
  } catch (error) {
    console.error('Sync transactions to payments error:', error);
    res.status(500).json({ error: "Synchronisierung fehlgeschlagen" });
  }
});

router.post("/api/sync/payments-to-invoices", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
  try {
    const orgId = req.session.organizationId;
    
    const orgProperties = await db.select()
      .from(schema.properties)
      .where(eq(schema.properties.organizationId, orgId));
    const orgPropertyIds = orgProperties.map(p => p.id);
    
    if (orgPropertyIds.length === 0) {
      return res.json({ allocated: 0, message: "Keine Liegenschaften gefunden" });
    }
    
    const allUnits = await db.select().from(schema.units);
    const units = allUnits.filter(u => orgPropertyIds.includes(u.propertyId!));
    const orgUnitIds = units.map(u => u.id);
    
    const allTenants = decryptIbanRows(await db.select().from(schema.tenants));
    const tenants = allTenants.filter(t => orgUnitIds.includes(t.unitId!));
    const tenantIds = tenants.map(t => t.id);
    
    if (tenantIds.length === 0) {
      return res.json({ allocated: 0, message: "Keine Mieter gefunden" });
    }
    
    const payments = await db.select()
      .from(schema.payments)
      .where(inArray(schema.payments.tenantId, tenantIds));
    
    let allocated = 0;
    
    const paymentsByTenant = new Map<string, typeof payments>();
    for (const payment of payments) {
      if (!payment.tenantId) continue;
      const existing = paymentsByTenant.get(payment.tenantId) || [];
      existing.push(payment);
      paymentsByTenant.set(payment.tenantId, existing);
    }
    
    for (const [tenantId, tenantPayments] of paymentsByTenant) {
      tenantPayments.sort((a, b) => 
        new Date(a.buchungsDatum || '').getTime() - new Date(b.buchungsDatum || '').getTime()
      );
      
      for (const payment of tenantPayments) {
        try {
          await paymentService.allocatePayment({
            paymentId: payment.id,
            tenantId: payment.tenantId,
            amount: Number(payment.betrag),
            bookingDate: payment.buchungsDatum || undefined,
            paymentType: payment.paymentType || 'ueberweisung',
            reference: payment.verwendungszweck || undefined,
            organizationId: orgId,
          });
          allocated++;
        } catch (error) {
          console.error('Failed to allocate payment:', payment.id, error);
        }
      }
    }
    
    res.json({ 
      allocated, 
      total: payments.length,
      message: `${allocated} Zahlungen wurden Rechnungen zugeordnet` 
    });
  } catch (error) {
    console.error('Sync payments to invoices error:', error);
    res.status(500).json({ error: "Zuordnung fehlgeschlagen" });
  }
});

// ===== Integrity Check =====

router.get("/api/integrity/payment-allocations", isAuthenticated, requireRole('admin', 'finance'), async (req: any, res) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "Keine Organisation" });
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const [mismatchCount, mismatches, summary, allocSummary] = await Promise.all([
      db.execute(sql`
        SELECT COUNT(*) AS cnt
        FROM monthly_invoices mi
        JOIN units u ON u.id = mi.unit_id
        JOIN properties pr ON pr.id = u.property_id
        LEFT JOIN (
          SELECT invoice_id, ROUND(SUM(CAST(applied_amount AS numeric)), 2) AS total_allocated
          FROM payment_allocations GROUP BY invoice_id
        ) alloc ON alloc.invoice_id = mi.id
        WHERE pr.organization_id = ${profile.organizationId}
          AND (COALESCE(mi.paid_amount, 0) != COALESCE(alloc.total_allocated, 0)
               OR (mi.status = 'bezahlt' AND COALESCE(mi.paid_amount, 0) = 0)
               OR (mi.status = 'offen' AND COALESCE(mi.paid_amount, 0) > 0))
      `).then(r => Number(r.rows[0]?.cnt || 0)),
      db.execute(sql`
        SELECT mi.id, mi.tenant_id, mi.year, mi.month, mi.status,
          COALESCE(mi.paid_amount, 0) AS paid_amount,
          COALESCE(alloc.total_allocated, 0) AS allocation_sum,
          ROUND(COALESCE(mi.paid_amount, 0) - COALESCE(alloc.total_allocated, 0), 2) AS diff
        FROM monthly_invoices mi
        JOIN units u ON u.id = mi.unit_id
        JOIN properties pr ON pr.id = u.property_id
        LEFT JOIN (
          SELECT invoice_id, ROUND(SUM(CAST(applied_amount AS numeric)), 2) AS total_allocated
          FROM payment_allocations GROUP BY invoice_id
        ) alloc ON alloc.invoice_id = mi.id
        WHERE pr.organization_id = ${profile.organizationId}
          AND (COALESCE(mi.paid_amount, 0) != COALESCE(alloc.total_allocated, 0)
               OR (mi.status = 'bezahlt' AND COALESCE(mi.paid_amount, 0) = 0)
               OR (mi.status = 'offen' AND COALESCE(mi.paid_amount, 0) > 0))
        ORDER BY mi.year, mi.month
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute(sql`
        SELECT 
          COUNT(*) AS total_invoices,
          SUM(CASE WHEN status = 'bezahlt' THEN 1 ELSE 0 END) AS paid_count,
          SUM(CASE WHEN status = 'teilbezahlt' THEN 1 ELSE 0 END) AS partial_count,
          SUM(CASE WHEN status = 'offen' THEN 1 ELSE 0 END) AS open_count,
          ROUND(SUM(CAST(gesamtbetrag AS numeric)), 2) AS total_invoiced,
          ROUND(SUM(COALESCE(paid_amount, 0)), 2) AS total_paid
        FROM monthly_invoices mi
        JOIN units u ON u.id = mi.unit_id
        JOIN properties pr ON pr.id = u.property_id
        WHERE pr.organization_id = ${profile.organizationId}
      `),
      db.execute(sql`
        SELECT COUNT(*) AS allocation_count,
          ROUND(SUM(CAST(applied_amount AS numeric)), 2) AS total_allocated
        FROM payment_allocations pa
        JOIN monthly_invoices mi ON mi.id = pa.invoice_id
        JOIN units u ON u.id = mi.unit_id
        JOIN properties pr ON pr.id = u.property_id
        WHERE pr.organization_id = ${profile.organizationId}
      `)
    ]);

    res.json({
      healthy: mismatchCount === 0,
      mismatches: mismatches.rows,
      mismatchCount,
      pagination: { limit, offset, hasMore: offset + limit < mismatchCount },
      summary: summary.rows[0],
      allocations: allocSummary.rows[0],
    });
  } catch (error) {
    console.error("Integrity check error:", error);
    res.status(500).json({ error: "Integritätsprüfung fehlgeschlagen" });
  }
});

export default router;
