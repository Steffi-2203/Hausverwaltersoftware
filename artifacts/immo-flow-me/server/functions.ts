import type { Request, Response, Express, NextFunction } from "express";
import { db } from "./db";
import { storage } from "./storage";
import { decryptIbanRows } from "./lib/fieldEncryption";
import { sendEmail } from "./lib/resend";
import OpenAI from "openai";
import { randomUUID } from "crypto";
import { invoiceService } from "./services/invoiceService";
import { ocrCircuitBreaker, CircuitOpenError } from "./services/circuitBreaker";

// OpenAI-Client via Replit AI Integrations (kein eigener API-Key erforderlich).
// AI_INTEGRATIONS_OPENAI_API_KEY und AI_INTEGRATIONS_OPENAI_BASE_URL werden
// automatisch durch Replit AI Integrations gesetzt.
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

import { isAuthenticated } from "./auth";
import {
  tenants,
  units,
  properties,
  propertyManagers,
  monthlyInvoices,
  payments,
  maintenanceContracts,
  maintenanceTasks,
  messages,
  expenses,
  settlements,
  settlementDetails,
  profiles,
  organizations,
} from "@shared/schema";
import { eq, and, inArray, gte, lte, sql, isNull } from "drizzle-orm";

interface CarryForward {
  vortrag_miete: number;
  vortrag_bk: number;
  vortrag_hk: number;
  vortrag_sonstige: number;
}

const getVatRates = (unitType: string) => {
  const isCommercial = ['geschaeft', 'garage', 'stellplatz', 'lager'].includes(unitType);
  return {
    ust_satz_miete: isCommercial ? 20 : 10,
    ust_satz_bk: isCommercial ? 20 : 10,
    ust_satz_heizung: 20,
  };
};

const calculateVatFromGross = (grossAmount: number, vatRate: number): number => {
  if (vatRate === 0) return 0;
  return grossAmount - (grossAmount / (1 + vatRate / 100));
};

async function calculateTenantCarryForward(
  tenantId: string,
  year: number
): Promise<CarryForward> {
  const previousYear = year - 1;
  
  const prevYearInvoices = await db.select()
    .from(monthlyInvoices)
    .where(and(
      eq(monthlyInvoices.tenantId, tenantId),
      eq(monthlyInvoices.year, previousYear)
    ));

  const startDate = `${previousYear}-01-01`;
  const endDate = `${previousYear}-12-31`;
  
  const prevYearPayments = await db.select()
    .from(payments)
    .where(and(
      eq(payments.tenantId, tenantId),
      gte(payments.buchungsDatum, startDate),
      lte(payments.buchungsDatum, endDate)
    ));

  const sollMiete = prevYearInvoices.reduce((sum, inv) => sum + Number(inv.grundmiete || 0), 0);
  const sollBk = prevYearInvoices.reduce((sum, inv) => sum + Number(inv.betriebskosten || 0), 0);
  const sollHk = prevYearInvoices.reduce((sum, inv) => sum + Number(inv.heizungskosten || 0), 0);
  const sollGesamt = sollMiete + sollBk + sollHk;

  const istGesamt = prevYearPayments.reduce((sum, p) => sum + Number(p.betrag || 0), 0);

  const differenz = sollGesamt - istGesamt;

  if (differenz <= 0) {
    if (differenz < 0) {
      return { vortrag_miete: differenz, vortrag_bk: 0, vortrag_hk: 0, vortrag_sonstige: 0 };
    }
    return { vortrag_miete: 0, vortrag_bk: 0, vortrag_hk: 0, vortrag_sonstige: 0 };
  }

  let remaining = istGesamt;
  const paidBk = Math.min(remaining, sollBk);
  remaining -= paidBk;
  const paidHk = Math.min(remaining, sollHk);
  remaining -= paidHk;
  const paidMiete = Math.min(remaining, sollMiete);

  return {
    vortrag_miete: Math.round(Math.max(0, sollMiete - paidMiete) * 100) / 100,
    vortrag_bk: Math.round(Math.max(0, sollBk - paidBk) * 100) / 100,
    vortrag_hk: Math.round(Math.max(0, sollHk - paidHk) * 100) / 100,
    vortrag_sonstige: 0,
  };
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  property_manager: "Hausverwalter",
  finance: "Buchhalter",
  viewer: "Betrachter",
  tester: "Tester",
};

const VALID_UST_RATES_AT = [0, 10, 13, 20];
const VALID_UST_RATES_DE = [0, 7, 19];
const ALL_VALID_RATES = [...new Set([...VALID_UST_RATES_AT, ...VALID_UST_RATES_DE])];

function formatCurrency(amount: number): string {
  return `€ ${amount.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function registerFunctionRoutes(app: Express) {
  
  app.post("/api/functions/generate-monthly-invoices", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user?.id) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const now = new Date();
      const year = req.body.year || now.getFullYear();
      const month = req.body.month || now.getMonth() + 1;

      const result = await invoiceService.generateMonthlyInvoices(user.id, year, month);
      res.json(result);
    } catch (error) {
      console.error("Error generating invoices:", error);
      res.status(500).json({ success: false, error: "Ein Fehler ist aufgetreten. Bitte kontaktieren Sie den Support." });
    }
  });

  app.post("/api/functions/send-invite", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { email, inviteToken, organizationName, role, baseUrl } = req.body;
      
      const registrationUrl = `${baseUrl}/register?invite=${inviteToken}`;
      const roleLabel = ROLE_LABELS[role] || role;

      const result = await sendEmail({
        to: email,
        subject: `Einladung zu ${organizationName}`,
        html: `
          <!DOCTYPE html>
          <html lang="de">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 24px;">ImmoFlowMe</h1>
            </div>
            
            <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
              <h2 style="color: #1f2937; margin-top: 0;">Sie wurden eingeladen!</h2>
              
              <p style="color: #4b5563;">
                Sie wurden eingeladen, der Organisation <strong>${organizationName}</strong> als <strong>${roleLabel}</strong> beizutreten.
              </p>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${registrationUrl}" 
                   style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                  Einladung annehmen
                </a>
              </div>
              
              <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">
                Diese Einladung ist 7 Tage gültig.
              </p>
            </div>
          </body>
          </html>
        `,
      });

      res.json(result);
    } catch (error) {
      console.error("Error in send-invite:", error);
      res.status(500).json({ error: "Ein Fehler ist aufgetreten." });
    }
  });

  app.post("/api/functions/send-dunning", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { 
        invoiceId, dunningLevel, tenantEmail, tenantName, 
        propertyName, unitNumber, amount, dueDate, invoiceMonth, invoiceYear 
      } = req.body;

      if (!tenantEmail) {
        return res.status(400).json({ error: "Keine E-Mail-Adresse für den Mieter hinterlegt" });
      }

      // Org-Scope (Defense-in-Depth zu RLS): organizationId aus der Session
      // ableiten, damit das spätere Update auf monthly_invoices explizit auf
      // die eigene Organisation eingegrenzt werden kann.
      const dunningProfile = await storage.getProfileById((req.session as any)?.userId);
      if (!dunningProfile?.organizationId) {
        return res.status(403).json({ error: "Keine Organisation gefunden" });
      }
      const dunningOrgId = dunningProfile.organizationId;

      const monthNames = [
        'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
        'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
      ];
      const monthName = monthNames[invoiceMonth - 1];
      const formattedAmount = amount.toLocaleString('de-AT', { minimumFractionDigits: 2 });
      const formattedDueDate = new Date(dueDate).toLocaleDateString('de-AT');

      let subject: string;
      let htmlContent: string;

      if (dunningLevel === 1) {
        subject = `Zahlungserinnerung - Miete ${monthName} ${invoiceYear}`;
        htmlContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Freundliche Zahlungserinnerung</h2>
            <p>Sehr geehrte/r ${tenantName},</p>
            <p>bei Durchsicht unserer Buchhaltung ist uns aufgefallen, dass die nachstehende Forderung noch offen ist:</p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <tr style="background: #f5f5f5;">
                <td style="padding: 10px; border: 1px solid #ddd;"><strong>Objekt</strong></td>
                <td style="padding: 10px; border: 1px solid #ddd;">${propertyName} - Top ${unitNumber}</td>
              </tr>
              <tr>
                <td style="padding: 10px; border: 1px solid #ddd;"><strong>Offener Betrag</strong></td>
                <td style="padding: 10px; border: 1px solid #ddd; color: #c00; font-weight: bold;">€ ${formattedAmount}</td>
              </tr>
            </table>
            <p>Wir bitten Sie, den offenen Betrag innerhalb der nächsten <strong>7 Tage</strong> zu überweisen.</p>
            <p>Mit freundlichen Grüßen,<br>Ihre Hausverwaltung</p>
          </div>
        `;
      } else {
        subject = `MAHNUNG - Miete ${monthName} ${invoiceYear}`;
        htmlContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #c00;">Mahnung</h2>
            <p>Sehr geehrte/r ${tenantName},</p>
            <p>trotz unserer Zahlungserinnerung ist die nachstehende Forderung weiterhin offen:</p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <tr style="background: #f5f5f5;">
                <td style="padding: 10px; border: 1px solid #ddd;"><strong>Objekt</strong></td>
                <td style="padding: 10px; border: 1px solid #ddd;">${propertyName} - Top ${unitNumber}</td>
              </tr>
              <tr>
                <td style="padding: 10px; border: 1px solid #ddd;"><strong>Offener Betrag</strong></td>
                <td style="padding: 10px; border: 1px solid #ddd; color: #c00; font-weight: bold;">€ ${formattedAmount}</td>
              </tr>
            </table>
            <p style="color: #c00; font-weight: bold;">
              Wir fordern Sie hiermit letztmalig auf, den offenen Betrag innerhalb von <strong>5 Tagen</strong> zu überweisen.
            </p>
            <p>Mit freundlichen Grüßen,<br>Ihre Hausverwaltung</p>
          </div>
        `;
      }

      const emailResponse = await sendEmail({
        to: tenantEmail,
        subject: subject,
        html: htmlContent,
      });

      // Typsicheres Update — Record<string,any> würde von Drizzle still ignoriert,
      // wenn die Spalten nicht im Schema stehen (Befund: mahnstufe wurde verworfen).
      const now = new Date();
      const dunningUpdate: Partial<typeof monthlyInvoices.$inferInsert> = {
        mahnstufe: dunningLevel,
        zahlungserinnerungAm: dunningLevel === 1 ? now : undefined,
        mahnungAm: dunningLevel > 1 ? now : undefined,
      };

      // monthly_invoices hat keine organization_id — kanonische Kette wie im
      // RLS-Modell: invoice.unit_id → unit → property. Fremde invoiceId trifft 0 Zeilen.
      await db.update(monthlyInvoices)
        .set(dunningUpdate)
        .where(and(
          eq(monthlyInvoices.id, invoiceId),
          inArray(
            monthlyInvoices.unitId,
            db.select({ id: units.id })
              .from(units)
              .innerJoin(properties, eq(units.propertyId, properties.id))
              .where(eq(properties.organizationId, dunningOrgId))
          )
        ));

      res.json({ 
        success: true, 
        message: dunningLevel === 1 ? 'Zahlungserinnerung versendet' : 'Mahnung versendet',
        emailId: (emailResponse as any).data?.id 
      });
    } catch (error) {
      console.error("Error in send-dunning:", error);
      res.status(500).json({ error: "Ein Fehler ist aufgetreten." });
    }
  });

  app.post("/api/functions/check-maintenance-reminders", async (req: Request, res: Response) => {
    const internalSecret = req.headers['x-internal-secret'];
    if (internalSecret !== process.env.INTERNAL_CRON_SECRET && process.env.INTERNAL_CRON_SECRET) {
      return res.status(403).json({ error: 'Forbidden - internal endpoint' });
    }
    try {
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];

      const contractsData = await db.select()
        .from(maintenanceContracts)
        .where(eq(maintenanceContracts.isActive, true));

      const contractsToRemind = contractsData.filter((contract) => {
        if (!contract.nextDueDate) return false;
        const dueDate = new Date(contract.nextDueDate);
        const reminderDate = new Date(dueDate);
        reminderDate.setDate(reminderDate.getDate() - (contract.reminderDays || 7));

        if (reminderDate > today) return false;

        if (contract.reminderSentAt) {
          const lastReminder = new Date(contract.reminderSentAt);
          const daysSinceReminder = Math.floor(
            (today.getTime() - lastReminder.getTime()) / (1000 * 60 * 60 * 24)
          );
          if (daysSinceReminder < 7) return false;
        }

        return true;
      });

      const results = { success: 0, failed: 0 };

      for (const contract of contractsToRemind) {
        try {
          const dueDate = new Date(contract.nextDueDate!);
          const isOverdue = dueDate < today;
          
          const subject = isOverdue
            ? `ÜBERFÄLLIG: ${contract.title}`
            : `Wartung fällig: ${contract.title}`;

          await db.insert(messages).values({
            organizationId: contract.organizationId,
            recipientType: "internal",
            messageType: "maintenance_reminder",
            subject,
            messageBody: `Wartungsvertrag erfordert Ihre Aufmerksamkeit: ${contract.title}`,
            status: "sent",
            sentAt: new Date(),
          });

          // Org-Scope (Defense-in-Depth zu RLS): interner Cron ohne Session,
          // daher self-consistent write auf die organization_id des zuvor
          // geladenen Vertrags. Fremde/gewanderte Datensätze treffen 0 Zeilen.
          await db.update(maintenanceContracts)
            .set({ reminderSentAt: new Date() })
            .where(and(
              eq(maintenanceContracts.id, contract.id),
              eq(maintenanceContracts.organizationId, contract.organizationId)
            ));

          if (isOverdue) {
            await db.insert(maintenanceTasks).values({
              organizationId: contract.organizationId,
              propertyId: contract.propertyId,
              title: `[ÜBERFÄLLIG] ${contract.title}`,
              description: `Wiederkehrende Wartung überfällig.`,
              category: "maintenance",
              priority: "urgent",
              dueDate: todayStr,
              status: "open",
            });
          }

          results.success++;
        } catch (err) {
          console.error(`Error processing contract ${contract.id}:`, err);
          results.failed++;
        }
      }

      res.json({ message: `Processed ${contractsToRemind.length} contracts`, results });
    } catch (error) {
      console.error("Error in check-maintenance-reminders:", error);
      res.status(500).json({ error: "Ein Fehler ist aufgetreten." });
    }
  });

  app.post("/api/functions/validate-invoice", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const invoiceData = req.body.daten || req.body;
      
      const report = {
        ist_valide: true,
        gefundene_fehler: [] as string[],
        vorgenommene_korrekturen: [] as string[],
        unsichere_felder: [] as { feld: string; grund: string }[],
        hinweise: [] as string[]
      };

      const corrected = { ...invoiceData };

      if (!corrected.lieferant || corrected.lieferant.trim() === '') {
        corrected.lieferant = 'UNSICHER - nicht erkannt';
        report.unsichere_felder.push({ feld: 'lieferant', grund: 'Nicht erkannt oder leer' });
      }

      if (!corrected.bruttobetrag || corrected.bruttobetrag <= 0) {
        report.gefundene_fehler.push('Pflichtfeld "bruttobetrag" fehlt');
        report.ist_valide = false;
      }

      if (corrected.bruttobetrag && corrected.ust_betrag && !corrected.nettobetrag) {
        corrected.nettobetrag = Math.round((corrected.bruttobetrag - corrected.ust_betrag) * 100) / 100;
        report.vorgenommene_korrekturen.push(`Nettobetrag berechnet: ${corrected.nettobetrag}€`);
      }

      if (corrected.ust_satz !== null && corrected.ust_satz !== undefined) {
        if (!ALL_VALID_RATES.includes(corrected.ust_satz)) {
          report.gefundene_fehler.push(`Ungewöhnlicher USt-Satz: ${corrected.ust_satz}%`);
          report.unsichere_felder.push({ feld: 'ust_satz', grund: `${corrected.ust_satz}% ist kein üblicher Steuersatz` });
        }
      }

      if (corrected.iban) {
        const cleanIban = corrected.iban.replace(/\s/g, '').toUpperCase();
        if (cleanIban.length < 15 || cleanIban.length > 34) {
          report.gefundene_fehler.push(`IBAN-Länge ungültig: ${cleanIban.length} Zeichen`);
        } else {
          corrected.iban = cleanIban;
        }
      }

      if (report.gefundene_fehler.length > 0) {
        report.ist_valide = false;
      }

      res.json({ korrigierte_daten: corrected, validierungsbericht: report });
    } catch (error) {
      console.error("Error in validate-invoice:", error);
      res.status(500).json({ error: "Ein Fehler ist aufgetreten." });
    }
  });

  app.get("/api/functions/export-user-data", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user?.id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const profile = await storage.getProfileByEmail(user.email);
      if (!profile?.organizationId) {
        return res.status(403).json({ error: 'No organization found' });
      }
      
      let organization = null;
      [organization] = await db.select()
        .from(organizations)
        .where(eq(organizations.id, profile.organizationId));

      const propertiesData = await db.select().from(properties)
        .where(eq(properties.organizationId, profile.organizationId));
      
      const propertyIds = propertiesData.map(p => p.id);
      
      const unitsData = propertyIds.length > 0 
        ? await db.select().from(units).where(inArray(units.propertyId, propertyIds))
        : [];
        
      const unitIds = unitsData.map(u => u.id);
      
      const tenantsData = decryptIbanRows(unitIds.length > 0
        ? await db.select().from(tenants).where(inArray(tenants.unitId, unitIds))
        : []);
        
      const tenantIds = tenantsData.map(t => t.id);
      
      const paymentsData = tenantIds.length > 0
        ? await db.select().from(payments).where(inArray(payments.tenantId, tenantIds))
        : [];
        
      const expensesData = propertyIds.length > 0
        ? await db.select().from(expenses).where(inArray(expenses.propertyId, propertyIds))
        : [];
        
      const invoicesData = tenantIds.length > 0
        ? await db.select().from(monthlyInvoices).where(inArray(monthlyInvoices.tenantId, tenantIds))
        : [];

      const exportData = {
        exportDate: new Date().toISOString(),
        user: {
          id: user.id,
          email: user.email,
        },
        profile: profile ? {
          fullName: profile.fullName,
          email: profile.email,
          createdAt: profile.createdAt,
        } : null,
        organization: organization,
        statistics: {
          propertiesCount: propertiesData.length,
          unitsCount: unitsData.length,
          tenantsCount: tenantsData.length,
          paymentsCount: paymentsData.length,
          expensesCount: expensesData.length,
          invoicesCount: invoicesData.length,
        },
        data: {
          properties: propertiesData,
          units: unitsData,
          tenants: tenantsData,
          payments: paymentsData,
          expenses: expensesData,
          invoices: invoicesData,
        },
      };

      res.json(exportData);
    } catch (error) {
      console.error('Export error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post("/api/functions/send-settlement-email", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const {
        settlementItemId,
        propertyName,
        propertyAddress,
        unitTopNummer,
        tenantName,
        tenantEmail,
        year,
        bkAnteil,
        hkAnteil,
        bkVorschuss,
        hkVorschuss,
        bkSaldo,
        hkSaldo,
        gesamtSaldo,
        isLeerstandBK,
        isLeerstandHK,
      } = req.body;

      if (!tenantEmail) {
        return res.json({ success: false, message: "No email provided" });
      }

      const saldoText = gesamtSaldo > 0 
        ? `eine <strong style="color: #dc2626;">Nachzahlung von ${formatCurrency(gesamtSaldo)}</strong>` 
        : gesamtSaldo < 0 
          ? `ein <strong style="color: #16a34a;">Guthaben von ${formatCurrency(Math.abs(gesamtSaldo))}</strong>`
          : "einen ausgeglichenen Saldo";

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><title>Betriebskostenabrechnung ${year}</title></head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #3b82f6; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0;">Betriebskostenabrechnung ${year}</h1>
          </div>
          <div style="background-color: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none;">
            <p>Sehr geehrte/r ${tenantName},</p>
            <p>anbei erhalten Sie die Betriebskostenabrechnung für das Jahr ${year}:</p>
            <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0; border: 1px solid #e5e7eb;">
              <p><strong>Liegenschaft:</strong> ${propertyName}</p>
              <p><strong>Adresse:</strong> ${propertyAddress}</p>
              <p><strong>Einheit:</strong> Top ${unitTopNummer}</p>
            </div>
            <p>Aus der Abrechnung ergibt sich für Sie ${saldoText}.</p>
            <p>Mit freundlichen Grüßen<br>Ihre Hausverwaltung</p>
          </div>
        </body>
        </html>
      `;

      const emailResponse = await sendEmail({
        to: tenantEmail,
        subject: `Betriebskostenabrechnung ${year} - ${propertyName} - Top ${unitTopNummer}`,
        html: htmlContent,
      });

      
      res.json({ success: true, emailId: (emailResponse as any).data?.id });
    } catch (error) {
      console.error("Error in send-settlement-email:", error);
      res.status(500).json({ error: "Ein Fehler ist aufgetreten." });
    }
  });

  app.post("/api/functions/send-message", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { recipientEmail, subject, messageBody } = req.body;

      const emailResponse = await sendEmail({
        to: recipientEmail,
        subject: subject,
        html: `<div style="font-family: Arial, sans-serif;">${messageBody}</div>`,
      });

      res.json({ success: true, emailId: (emailResponse as any).data?.id });
    } catch (error) {
      console.error("Error in send-message:", error);
      res.status(500).json({ error: "Ein Fehler ist aufgetreten." });
    }
  });

  app.delete("/api/functions/delete-account", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user?.id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      res.json({ success: true, message: "Account deletion requested. Please contact support." });
    } catch (error) {
      console.error("Error in delete-account:", error);
      res.status(500).json({ error: "Ein Fehler ist aufgetreten." });
    }
  });

  app.post("/api/functions/cron-generate-invoices", async (req: Request, res: Response) => {
    const internalSecret = req.headers['x-internal-secret'];
    if (internalSecret !== process.env.INTERNAL_CRON_SECRET && process.env.INTERNAL_CRON_SECRET) {
      return res.status(403).json({ error: 'Forbidden - internal endpoint' });
    }
    
    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;

      const allTenants = await db.select()
        .from(tenants)
        .where(eq(tenants.status, 'aktiv'));

      res.json({ 
        success: true, 
        message: `Cron job would generate invoices for ${allTenants.length} active tenants for ${month}/${year}` 
      });
    } catch (error) {
      console.error("Error in cron-generate-invoices:", error);
      res.status(500).json({ error: "Ein Fehler ist aufgetreten." });
    }
  });

  // OCR Invoice - Extract invoice data from image
  app.post("/api/functions/ocr-invoice", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { imageBase64, mimeType } = req.body;

      if (!imageBase64) {
        return res.status(400).json({ error: "Bild-Daten erforderlich" });
      }
      
      // Validate image type
      const validMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (mimeType && !validMimeTypes.includes(mimeType)) {
        return res.status(400).json({ error: "Nur Bilder werden unterstützt (JPEG, PNG, GIF, WebP)" });
      }
      
      // Basic payload size validation (max ~10MB base64)
      if (imageBase64.length > 10 * 1024 * 1024 * 1.37) {
        return res.status(400).json({ error: "Datei ist zu groß (max. 10MB)" });
      }

      const response = await ocrCircuitBreaker.execute(() => openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `Du bist ein Experte für österreichische Rechnungsanalyse. Extrahiere alle relevanten Daten aus der Rechnung und gib sie als JSON zurück.

Antworte NUR mit einem JSON-Objekt im folgenden Format:
{
  "lieferant": "Firmenname",
  "betrag": 123.45,
  "netto_betrag": 102.88,
  "datum": "2024-01-15",
  "rechnungsnummer": "RE-2024-001",
  "iban": "AT12 3456 7890 1234 5678",
  "ust_betrag": 20.57,
  "ust_satz": 20,
  "kategorie": "betriebskosten_umlagefaehig",
  "expense_type": "strom",
  "beschreibung": "Stromrechnung Jänner 2024",
  "leistungszeitraum_von": "2024-01-01",
  "leistungszeitraum_bis": "2024-01-31",
  "leistungsort_strasse": "Musterstraße 1",
  "leistungsort_plz": "1010",
  "leistungsort_stadt": "Wien",
  "validierung": {
    "ist_valide": true,
    "confidence_score": 0.92,
    "warnungen": [],
    "fehler": [],
    "korrekturen": [],
    "unsichere_felder": []
  }
}

confidence_score: 0.0–1.0. Setze ihn niedrig (< 0.7) wenn Felder unleserlich, abgeschnitten oder mehrdeutig sind. Setze 0.0 wenn die Pflichtfelder lieferant, betrag oder datum fehlen.
Kategorien: betriebskosten_umlagefaehig, betriebskosten_nicht_umlagefaehig, instandhaltung, verwaltung, sonstiges
Expense Types: strom, gas, wasser, heizung, muellabfuhr, hausreinigung, hausbetreuung, lift, versicherung, grundsteuer, kanalgebuehr, schornsteinfeger, winterdienst, gartenarbeit, reparatur, wartung, verwaltung, sonstiges`
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`,
                },
              },
              {
                type: "text",
                text: "Analysiere diese Rechnung und extrahiere alle Daten. Antworte nur mit dem JSON-Objekt.",
              },
            ],
          },
        ],
        max_tokens: 2000,
      }));

      const content = response.choices[0]?.message?.content || "";
      
      let data;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          data = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("Keine JSON-Daten in der Antwort");
        }
      } catch (parseError) {
        console.error("JSON parse error:", parseError);
        return res.status(500).json({ error: "Fehler beim Parsen der OCR-Ergebnisse" });
      }

      // needs_review: true bei niedrigem Confidence-Score oder fehlenden Pflichtfeldern
      const val = data.validierung ?? {};
      const confidenceScore = typeof val.confidence_score === 'number' ? val.confidence_score : 1.0;
      const needsReview =
        confidenceScore < 0.75 ||
        !data.betrag ||
        !data.datum ||
        !data.lieferant ||
        (val.fehler?.length ?? 0) > 0 ||
        (val.unsichere_felder?.length ?? 0) > 0;

      res.json({ data, needs_review: needsReview, ocrDocumentId: randomUUID() });
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        return res.status(503).json({
          error: error.message,
          retryAfter: error.retryAfterSec,
          circuitState: ocrCircuitBreaker.getStats(),
        });
      }
      console.error("Error in ocr-invoice:", error);
      res.status(500).json({ error: "OCR-Analyse fehlgeschlagen" });
    }
  });

  // OCR Invoice Text - Extract invoice data from OCR text
  app.post("/api/functions/ocr-invoice-text", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { ocrText } = req.body;

      if (!ocrText) {
        return res.status(400).json({ error: "OCR-Text erforderlich" });
      }

      const response = await ocrCircuitBreaker.execute(() => openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `Du bist ein Experte für österreichische Rechnungsanalyse. Analysiere den OCR-Text einer Rechnung und extrahiere alle relevanten Daten.

Antworte NUR mit einem JSON-Objekt im folgenden Format:
{
  "rechnungsart": "Rechnung",
  "lieferant": "Firmenname",
  "lieferant_uid": "ATU12345678",
  "empfaenger_uid": null,
  "rechnungsnummer": "RE-2024-001",
  "rechnungsdatum": "2024-01-15",
  "leistungszeitraum_von": "2024-01-01",
  "leistungszeitraum_bis": "2024-01-31",
  "nettobetrag": 102.88,
  "ust_satz": 20,
  "ust_betrag": 20.57,
  "bruttobetrag": 123.45,
  "zahlungsziel": "2024-02-15",
  "objekt": null,
  "einheit": null,
  "iban": "AT12 3456 7890 1234 5678",
  "bic": "GIBAATWWXXX",
  "kategorie": "betriebskosten_umlagefaehig",
  "expense_type": "strom",
  "reverse_charge": false,
  "steuerhinweis": null,
  "validierung": {
    "ist_valide": true,
    "confidence_score": 0.92,
    "warnungen": [],
    "fehler": [],
    "korrekturen": [],
    "unsichere_felder": [],
    "ust_pruefung": {
      "reverse_charge_erkannt": false,
      "uid_lieferant_valide": null,
      "uid_empfaenger_valide": null,
      "ust_satz_korrekt": true
    }
  }
}
confidence_score: 0.0–1.0. Setze ihn niedrig (< 0.7) wenn Felder unleserlich oder mehrdeutig sind. Setze 0.0 wenn lieferant, bruttobetrag oder rechnungsdatum fehlen.`
          },
          {
            role: "user",
            content: `Analysiere diesen Rechnungstext und extrahiere alle Daten:\n\n${ocrText}`,
          },
        ],
        max_tokens: 2000,
      }));

      const content = response.choices[0]?.message?.content || "";
      
      let data;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          data = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("Keine JSON-Daten in der Antwort");
        }
      } catch (parseError) {
        console.error("JSON parse error:", parseError);
        return res.status(500).json({ error: "Fehler beim Parsen der OCR-Ergebnisse" });
      }

      // needs_review: true bei niedrigem Confidence-Score oder fehlenden Pflichtfeldern
      const valT = data.validierung ?? {};
      const confidenceScoreT = typeof valT.confidence_score === 'number' ? valT.confidence_score : 1.0;
      const needsReviewT =
        confidenceScoreT < 0.75 ||
        !data.bruttobetrag ||
        !data.rechnungsdatum ||
        !data.lieferant ||
        (valT.fehler?.length ?? 0) > 0 ||
        (valT.unsichere_felder?.length ?? 0) > 0;

      res.json({ data, needs_review: needsReviewT, ocrDocumentId: randomUUID() });
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        return res.status(503).json({
          error: error.message,
          retryAfter: error.retryAfterSec,
          circuitState: ocrCircuitBreaker.getStats(),
        });
      }
      console.error("Error in ocr-invoice-text:", error);
      res.status(500).json({ error: "OCR-Analyse fehlgeschlagen" });
    }
  });

  // OCR Bank Statement - Extract bank statement data from image
  app.post("/api/functions/ocr-bank-statement", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { imageBase64, mimeType } = req.body;

      if (!imageBase64) {
        return res.status(400).json({ error: "Bild-Daten erforderlich" });
      }
      
      // Validate image type
      const validMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (mimeType && !validMimeTypes.includes(mimeType)) {
        return res.status(400).json({ error: "Nur Bilder werden unterstützt (JPEG, PNG, GIF, WebP). Für PDFs bitte erst in Bild konvertieren." });
      }
      
      // Basic payload size validation (max ~10MB base64)
      if (imageBase64.length > 10 * 1024 * 1024 * 1.37) {
        return res.status(400).json({ error: "Datei ist zu groß (max. 10MB)" });
      }

      const response = await ocrCircuitBreaker.execute(() => openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `Du bist ein Experte für Kontoauszugsanalyse. Extrahiere alle Buchungszeilen aus dem Kontoauszug.

Antworte NUR mit einem JSON-Objekt im folgenden Format:
{
  "kontoinhaber": "Max Mustermann",
  "iban": "AT12 3456 7890 1234 5678",
  "auszugsnummer": "2024/01",
  "zeitraum_von": "2024-01-01",
  "zeitraum_bis": "2024-01-31",
  "buchungen": [
    {
      "datum": "2024-01-15",
      "betrag": -123.45,
      "verwendungszweck": "Miete Jänner 2024",
      "auftraggeber_empfaenger": "Hans Mieter",
      "iban": "AT98 7654 3210 9876 5432",
      "buchungstext": "Dauerauftrag"
    }
  ],
  "validierung": {
    "ist_valide": true,
    "warnungen": [],
    "erkannte_zeilen": 5
  }
}

Wichtig:
- Einzahlungen sind positive Beträge
- Auszahlungen/Abbuchungen sind negative Beträge
- Datumsformat: YYYY-MM-DD`
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`,
                },
              },
              {
                type: "text",
                text: "Analysiere diesen Kontoauszug und extrahiere alle Buchungen. Antworte nur mit dem JSON-Objekt.",
              },
            ],
          },
        ],
        max_tokens: 4000,
      }));

      const content = response.choices[0]?.message?.content || "";
      
      let data;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          data = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("Keine JSON-Daten in der Antwort");
        }
      } catch (parseError) {
        console.error("JSON parse error:", parseError);
        return res.status(500).json({ error: "Fehler beim Parsen der OCR-Ergebnisse" });
      }

      res.json({ data });
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        return res.status(503).json({
          error: error.message,
          retryAfter: error.retryAfterSec,
          circuitState: ocrCircuitBreaker.getStats(),
        });
      }
      console.error("Error in ocr-bank-statement:", error);
      res.status(500).json({ error: "OCR-Analyse fehlgeschlagen" });
    }
  });
}
