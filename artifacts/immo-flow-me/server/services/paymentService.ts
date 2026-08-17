import { db } from "../db";
import { 
  payments, 
  monthlyInvoices, 
  tenants,
  units,
  properties,
  messages,
  transactions,
  auditLogs,
  paymentAllocations
} from "@shared/schema";
import { eq, and, gte, lte, desc, or, inArray, sql } from "drizzle-orm";
import { roundMoney } from "@shared/utils";
import { verifyTenantOwnership } from "../lib/ownershipCheck";

interface DunningLevel {
  level: 1 | 2 | 3;
  name: string;
  daysOverdue: number;
  fee: number;
}

interface DunningResult {
  tenantId: string;
  tenantName: string;
  email: string | null;
  outstandingAmount: number;
  dunningLevel: DunningLevel;
  overdueInvoices: Array<{
    id: string;
    month: number;
    year: number;
    amount: number;
    dueDate: string;
  }>;
}

const DUNNING_LEVELS: DunningLevel[] = [
  { level: 1, name: "Zahlungserinnerung", daysOverdue: 14, fee: 0 },
  { level: 2, name: "1. Mahnung", daysOverdue: 30, fee: 5 },
  { level: 3, name: "2. Mahnung", daysOverdue: 45, fee: 10 },
];

export class PaymentService {
  async allocatePayment(params: {
    paymentId: string;
    tenantId: string;
    amount: number;
    bookingDate?: string;
    paymentType?: string;
    reference?: string;
    userId?: string;
    organizationId?: string;
  }) {
    const { paymentId, tenantId, amount, bookingDate, paymentType = "ueberweisung", reference, userId, organizationId } = params;
    // Audit-Befund K2: ohne Organisationskontext keine Zuordnung —
    // vorher wurde die Eigentümerprüfung schlicht übersprungen.
    if (!organizationId) {
      throw new Error("Kein Organisationskontext — Zahlungszuordnung abgelehnt");
    }
    const isOwner = await verifyTenantOwnership(tenantId, organizationId);
    if (!isOwner) {
      throw new Error("Mieter gehört nicht zu dieser Organisation");
    }
    const roundedAmount = roundMoney(amount);

    return await db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO payments (id, tenant_id, invoice_id, betrag, buchungs_datum, payment_type, verwendungszweck, created_at)
        VALUES (${paymentId}, ${tenantId}, NULL, ${roundedAmount}, ${bookingDate ?? sql`now()::date`}, ${paymentType}, ${reference || null}, now())
        ON CONFLICT (id) DO NOTHING
      `);

      // Org-Scope (kanonische Kette wie im RLS-Modell): zusätzlich zur
      // org-verifizierten tenant_id muss die Rechnung über ihre EIGENE
      // unit_id → property zur Organisation gehören — bei inkonsistenten
      // Daten (Tenant und Invoice-Unit in verschiedenen Orgs) fail-closed.
      const invoices = await tx.execute(sql`
        SELECT mi.id, mi.gesamtbetrag, COALESCE(mi.paid_amount, 0) AS paid_amount
        FROM monthly_invoices mi
        JOIN units u ON mi.unit_id = u.id
        JOIN properties p ON u.property_id = p.id
        WHERE mi.tenant_id = ${tenantId}
          AND p.organization_id = ${organizationId}
          AND mi.status IN ('offen','teilbezahlt')
        ORDER BY mi.year, mi.month
        FOR UPDATE OF mi
      `).then(r => r.rows);

      let remaining = roundedAmount;
      let appliedTotal = 0;

      for (const inv of invoices) {
        if (remaining <= 0) break;

        const total = roundMoney(Number(inv.gesamtbetrag || 0));
        const paid = roundMoney(Number(inv.paid_amount || 0));
        const due = roundMoney(total - paid);
        if (due <= 0) continue;

        const apply = roundMoney(Math.min(remaining, due));
        const newPaid = roundMoney(paid + apply);
        remaining = roundMoney(remaining - apply);
        appliedTotal = roundMoney(appliedTotal + apply);

        const invId = inv.id as string;
        const newStatus = newPaid >= total ? "bezahlt" : newPaid > 0 ? "teilbezahlt" : "offen";

        // Optimistisches, voll parametrisiertes Update (versioniert) —
        // Org-Scope (Defense-in-Depth zu RLS): kanonische Unit-Chain der
        // Rechnung selbst (invoice.unit_id → unit → property → org),
        // fremde oder inkonsistente invId trifft 0 Zeilen.
        let optSuccess = false;
        for (let attempt = 0; attempt < 5 && !optSuccess; attempt++) {
          const cur: any = await tx.execute(sql`
            SELECT version FROM monthly_invoices WHERE id = ${invId}
          `);
          if (!cur.rows?.length) break;
          const oldVersion = Number(cur.rows[0].version || 1);
          const upd: any = await tx.execute(sql`
            UPDATE monthly_invoices
            SET paid_amount = ${newPaid}, status = ${newStatus},
                version = ${oldVersion + 1}, updated_at = now()
            WHERE id = ${invId} AND COALESCE(version, 1) = ${oldVersion}
              AND tenant_id = ${tenantId}
              AND unit_id IN (SELECT u.id FROM units u JOIN properties p ON u.property_id = p.id WHERE p.organization_id = ${organizationId})
          `);
          if ((upd.rowCount ?? 0) > 0) optSuccess = true;
        }

        if (!optSuccess) {
          // Org-Scope (Defense-in-Depth): auch der Fallback bleibt auf
          // tenant_id UND die kanonische Unit-Chain der Rechnung eingegrenzt.
          const fallbackRes: any = await tx.execute(sql`
            UPDATE monthly_invoices
            SET paid_amount = ${newPaid},
                status = CASE WHEN ${newPaid} >= ${total} THEN 'bezahlt' WHEN ${newPaid} > 0 THEN 'teilbezahlt' ELSE status END,
                version = COALESCE(version, 1) + 1,
                updated_at = now()
            WHERE id = ${inv.id} AND tenant_id = ${tenantId}
              AND unit_id IN (SELECT u.id FROM units u JOIN properties p ON u.property_id = p.id WHERE p.organization_id = ${organizationId})
          `);
          // Trifft auch der org-gebundene Fallback 0 Zeilen (z. B. parallele
          // Umhängung), darf KEINE Allokation gebucht werden → Rollback.
          if ((fallbackRes.rowCount ?? 0) === 0) {
            throw new Error("Rechnung nicht mehr im Organisationsbereich — Zuordnung abgebrochen");
          }
        }

        // Record payment allocation in payment_allocations table
        await tx.execute(sql`
          INSERT INTO payment_allocations (id, payment_id, invoice_id, applied_amount, allocation_type, created_at)
          VALUES (gen_random_uuid(), ${paymentId}, ${inv.id}, ${apply}, 'auto', now())
        `);

        await tx.execute(sql`
          INSERT INTO audit_logs (user_id, table_name, record_id, action, new_data, created_at)
          VALUES (${userId || null}, 'monthly_invoices', ${inv.id}, 'payment_allocated', ${JSON.stringify({ paymentId, applied: apply })}::jsonb, now())
        `);
      }

      let unapplied = remaining;
      if (unapplied > 0) {
        await tx.execute(sql`
          INSERT INTO transactions (id, organization_id, bank_account_id, amount, transaction_date, booking_text, created_at)
          VALUES (gen_random_uuid(), NULL, NULL, ${unapplied}, now()::date, ${'Überzahlung / Gutschrift für Tenant ' + tenantId}, now())
        `);

        // Org-Scope (Defense-in-Depth): payments hat keine organization_id —
        // Einschränkung auf den org-verifizierten tenant_id (das payment wurde
        // oben mit genau diesem tenant_id angelegt).
        await tx.execute(sql`
          UPDATE payments SET notizen = COALESCE(notizen, '') || ${' Überzahlung ' + unapplied.toFixed(2) + ' €'} WHERE id = ${paymentId} AND tenant_id = ${tenantId}
        `);
      }

      await tx.execute(sql`
        INSERT INTO audit_logs (user_id, table_name, record_id, action, new_data, created_at)
        VALUES (${userId || null}, 'payments', ${paymentId}, 'allocated', ${JSON.stringify({
          tenantId,
          paymentId,
          amount: roundedAmount,
          applied: appliedTotal,
          unapplied
        })}::jsonb, now())
      `);

      return {
        success: true,
        paymentId,
        applied: appliedTotal,
        unapplied,
      };
    });
  }

  async getTenantBalance(tenantId: string, year?: number) {
    const whereYear = year ? sql`AND year = ${year}` : sql``;
    const result = await db.execute(sql`
      SELECT COALESCE(SUM(gesamtbetrag),0) AS total_soll, COALESCE(SUM(paid_amount),0) AS total_ist
      FROM monthly_invoices
      WHERE tenant_id = ${tenantId} ${whereYear}
    `).then(r => r.rows[0]);

    const totalSoll = roundMoney(Number(result?.total_soll || 0));
    const totalIst = roundMoney(Number(result?.total_ist || 0));
    return { 
      totalSoll, 
      totalIst, 
      saldo: roundMoney(totalSoll - totalIst),
      sollGesamt: totalSoll,
      istGesamt: totalIst,
    };
  }

  getDunningLevel(daysOverdue: number): number {
    if (daysOverdue >= 45) return 3;
    if (daysOverdue >= 30) return 2;
    if (daysOverdue >= 14) return 1;
    return 0;
  }

  async recordDunningAction(params: { 
    tenantId: string; 
    level: number; 
    userId?: string; 
    note?: string 
  }) {
    const { tenantId, level, userId, note } = params;
    
    await db.execute(sql`
      INSERT INTO audit_logs (user_id, table_name, record_id, action, new_data, created_at)
      VALUES (${userId || null}, 'dunning', ${tenantId}, 'create', ${JSON.stringify({ level, note })}::jsonb, now())
    `);
    
    return { success: true, level };
  }

  async getTenantsForDunning(organizationId: string, minDaysOverdue: number = 14): Promise<DunningResult[]> {
    const today = new Date();
    const results: DunningResult[] = [];

    const orgTenants = await db
      .select({
        tenant: tenants,
        unit: units,
        property: properties,
      })
      .from(tenants)
      .leftJoin(units, eq(tenants.unitId, units.id))
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .where(eq(properties.organizationId, organizationId));

    for (const { tenant, unit, property } of orgTenants) {
      if (!tenant) continue;

      const overdueInvoices = await db
        .select()
        .from(monthlyInvoices)
        .where(
          and(
            eq(monthlyInvoices.tenantId, tenant.id),
            or(
              eq(monthlyInvoices.status, "offen"),
              eq(monthlyInvoices.status, "teilbezahlt"),
              eq(monthlyInvoices.status, "ueberfaellig")
            )
          )
        )
        .orderBy(monthlyInvoices.year, monthlyInvoices.month);

      const overdueDetails: DunningResult["overdueInvoices"] = [];
      let maxDaysOverdue = 0;
      let totalOutstanding = 0;

      for (const invoice of overdueInvoices) {
        if (!invoice.faelligAm) continue;

        const dueDate = new Date(invoice.faelligAm);
        const daysOverdue = Math.floor(
          (today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysOverdue >= minDaysOverdue) {
          const invoiceTotal = Number(invoice.gesamtbetrag) || 0;
          const paidAmount = Number((invoice as any).paidAmount ?? 0);
          const outstanding = roundMoney(invoiceTotal - paidAmount);

          if (outstanding > 0) {
            overdueDetails.push({
              id: invoice.id,
              month: invoice.month,
              year: invoice.year,
              amount: outstanding,
              dueDate: invoice.faelligAm,
            });
            totalOutstanding = roundMoney(totalOutstanding + outstanding);
            maxDaysOverdue = Math.max(maxDaysOverdue, daysOverdue);
          }
        }
      }

      if (overdueDetails.length > 0) {
        const dunningLevel =
          DUNNING_LEVELS.find((l) => maxDaysOverdue >= l.daysOverdue) ||
          DUNNING_LEVELS[0];

        results.push({
          tenantId: tenant.id,
          tenantName: `${tenant.firstName || ""} ${tenant.lastName || ""}`.trim(),
          email: tenant.email,
          outstandingAmount: totalOutstanding,
          dunningLevel,
          overdueInvoices: overdueDetails,
        });
      }
    }

    return results.sort((a, b) => b.outstandingAmount - a.outstandingAmount);
  }

  async sendDunningReminder(
    tenantId: string,
    dunningLevel: DunningLevel,
    userId: string
  ): Promise<{ success: boolean; messageId?: string }> {
    const tenant = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .then((r) => r[0]);

    if (!tenant || !tenant.email) {
      return { success: false };
    }

    const balance = await this.getTenantBalance(tenantId);
    const subject = `${dunningLevel.name} - Offener Betrag: €${balance.saldo.toFixed(2)}`;

    const body = `
Sehr geehrte/r ${tenant.firstName} ${tenant.lastName},

wir möchten Sie daran erinnern, dass folgende Beträge noch offen sind:

Offener Gesamtbetrag: €${balance.saldo.toFixed(2)}
${dunningLevel.fee > 0 ? `Mahngebühr: €${dunningLevel.fee.toFixed(2)}` : ""}

Bitte überweisen Sie den offenen Betrag innerhalb von 7 Tagen.

Mit freundlichen Grüßen,
Ihre Hausverwaltung
    `.trim();

    const [message] = await db
      .insert(messages)
      .values({
        recipientEmail: tenant.email,
        recipientType: "tenant",
        subject,
        messageBody: body,
        messageType: "dunning",
        status: "pending",
      })
      .returning();

    await this.recordDunningAction({
      tenantId,
      level: dunningLevel.level,
      userId,
      note: `${dunningLevel.name} versendet`,
    });

    return { success: true, messageId: message.id };
  }

  calculateInterest(
    principal: number,
    daysOverdue: number,
    annualRate: number = 4
  ): number {
    const dailyRate = annualRate / 365 / 100;
    return roundMoney(principal * dailyRate * daysOverdue);
  }
}

export const paymentService = new PaymentService();
