import { db } from "../db";
import { monthlyInvoices, tenants, units, properties, messages } from "@shared/schema";
import { eq, and, lt, or, isNull, inArray } from "drizzle-orm";
import { sendEmail } from "../lib/resend";
import { roundMoney } from "@shared/utils";
import { format, differenceInDays, addDays } from "date-fns";
import { de } from "date-fns/locale";

interface DunningLevel {
  level: 0 | 1 | 2 | 3;
  name: string;
  daysOverdue: number;
  fee: number;
  interestRate: number;
}

const DUNNING_LEVELS: DunningLevel[] = [
  { level: 0, name: "Offen", daysOverdue: 0, fee: 0, interestRate: 0 },
  { level: 1, name: "Zahlungserinnerung", daysOverdue: 14, fee: 0, interestRate: 0 },
  { level: 2, name: "1. Mahnung", daysOverdue: 30, fee: 5, interestRate: 0.04 },
  { level: 3, name: "2. Mahnung", daysOverdue: 45, fee: 10, interestRate: 0.04 },
];

/**
 * Audit-Befund M2: Verzugszinsen und Mahnspesen wurden pauschal für alle
 * Mieter gleich berechnet. Österreichische Rechtslage unterscheidet:
 *  - Verbrauchergeschäfte: 4 % p.a. gesetzlicher Verzugszins (§ 1000 ABGB)
 *  - Unternehmergeschäfte: 9,2 Prozentpunkte über Basiszinssatz (§ 456 UGB)
 *    zzgl. pauschaler Betreibungskostenersatz von 40 EUR (§ 458 UGB)
 * Der Basiszinssatz ist konfigurierbar, weil er sich halbjährlich ändert.
 */
const ABGB_INTEREST_RATE = 0.04;
const UGB_MARKUP = 0.092;
const UGB_LUMP_SUM_FEE = 40;

/** Basiszinssatz laut OeNB, per ENV überschreibbar (z. B. BASE_INTEREST_RATE=0.0353). */
function getBaseInterestRate(): number {
  const raw = Number(process.env.BASE_INTEREST_RATE);
  return Number.isFinite(raw) ? raw : 0.0353;
}

/** Gewerbeeinheiten gelten als Unternehmergeschäft. */
function isBusinessTenant(unitType: string | null | undefined): boolean {
  return unitType === 'geschaeft' || unitType === 'lager';
}

interface DunningAction {
  invoiceId: string;
  tenantId: string;
  tenantEmail: string;
  tenantName: string;
  propertyName: string;
  unitNumber: string;
  currentLevel: number;
  newLevel: number;
  amount: number;
  fee: number;
  interest: number;
  totalDue: number;
}

export class AutomatedDunningService {
  private calculateInterest(amount: number, daysOverdue: number, business = false): number {
    if (daysOverdue <= 14) return 0;
    const yearFraction = daysOverdue / 365;
    const rate = business ? getBaseInterestRate() + UGB_MARKUP : ABGB_INTEREST_RATE;
    // roundMoney: dezimalsichere kaufmännische Rundung (statt Float-Math.round)
    return roundMoney(amount * rate * yearFraction);
  }

  /** Mahnspesen: Verbraucher nur angemessene Stufenspesen, Unternehmer zzgl. 40 EUR Pauschale. */
  private calculateFee(level: DunningLevel, business: boolean): number {
    if (!business) return level.fee;
    return level.level >= 2 ? roundMoney(level.fee + UGB_LUMP_SUM_FEE) : level.fee;
  }

  private getDunningLevel(daysOverdue: number): DunningLevel {
    for (let i = DUNNING_LEVELS.length - 1; i >= 0; i--) {
      if (daysOverdue >= DUNNING_LEVELS[i].daysOverdue) {
        return DUNNING_LEVELS[i];
      }
    }
    return DUNNING_LEVELS[0];
  }

  async checkOverdueInvoices(organizationId: string): Promise<DunningAction[]> {
    const today = new Date();
    
    const overdueInvoices = await db.select({
      invoice: monthlyInvoices,
      tenant: tenants,
      unit: units,
      property: properties,
    })
      .from(monthlyInvoices)
      .innerJoin(tenants, eq(monthlyInvoices.tenantId, tenants.id))
      .innerJoin(units, eq(tenants.unitId, units.id))
      .innerJoin(properties, eq(units.propertyId, properties.id))
      .where(and(
        eq(properties.organizationId, organizationId),
        or(
          eq(monthlyInvoices.status, 'offen'),
          eq(monthlyInvoices.status, 'teilbezahlt'),
          eq(monthlyInvoices.status, 'ueberfaellig')
        ),
        lt(monthlyInvoices.faelligAm, today.toISOString())
      ));

    const actions: DunningAction[] = [];

    for (const row of overdueInvoices) {
      const dueDate = new Date(row.invoice.faelligAm!);
      const daysOverdue = differenceInDays(today, dueDate);
      
      if (daysOverdue <= 0) continue;

      const currentLevel = row.invoice.mahnstufe || 0;
      const newDunningLevel = this.getDunningLevel(daysOverdue);
      
      if (newDunningLevel.level > currentLevel && row.tenant.email) {
        const invoiceTotal = Number(row.invoice.gesamtbetrag) || 0;
        const paidAmount = Number(row.invoice.paidAmount) || 0;
        const amount = roundMoney(invoiceTotal - paidAmount);
        const business = isBusinessTenant(row.unit.type as string | null);
        const interest = this.calculateInterest(amount, daysOverdue, business);
        const fee = this.calculateFee(newDunningLevel, business);
        
        actions.push({
          invoiceId: row.invoice.id,
          tenantId: row.tenant.id,
          tenantEmail: row.tenant.email,
          tenantName: `${row.tenant.firstName || ''} ${row.tenant.lastName || ''}`.trim(),
          propertyName: row.property.name || '',
          unitNumber: row.unit.topNummer || '',
          currentLevel,
          newLevel: newDunningLevel.level,
          amount,
          fee,
          interest,
          totalDue: roundMoney(amount + fee + interest),
        });
      }
    }

    return actions;
  }

  async processAutomatedDunning(organizationId: string, sendEmails: boolean = false): Promise<{
    processed: number;
    escalated: number;
    emailsSent: number;
    actions: DunningAction[];
  }> {
    const actions = await this.checkOverdueInvoices(organizationId);
    let emailsSent = 0;

    for (const action of actions) {
      // Org-Scope (Defense-in-Depth zu RLS): monthly_invoices hat keine
      // organization_id — kanonische Kette wie im RLS-Modell:
      // invoice.unit_id → unit → property. Eine fremde invoiceId trifft 0 Zeilen.
      await db.update(monthlyInvoices)
        .set({ 
          mahnstufe: action.newLevel,
          status: 'ueberfaellig',
        })
        .where(and(
          eq(monthlyInvoices.id, action.invoiceId),
          inArray(
            monthlyInvoices.unitId,
            db.select({ id: units.id })
              .from(units)
              .innerJoin(properties, eq(units.propertyId, properties.id))
              .where(eq(properties.organizationId, organizationId))
          )
        ));

      if (sendEmails && action.tenantEmail) {
        try {
          const levelInfo = DUNNING_LEVELS.find(l => l.level === action.newLevel)!;
          const subject = `${levelInfo.name} - Offener Betrag für ${action.propertyName}`;
          
          const body = this.generateDunningEmail(action, levelInfo);
          
          await sendEmail({
            to: action.tenantEmail,
            subject,
            html: body,
          });

          await db.insert(messages).values({
            id: crypto.randomUUID(),
            organizationId,
            tenantId: action.tenantId,
            type: 'dunning',
            subject,
            body,
            status: 'sent',
            sentAt: new Date(),
          });

          emailsSent++;
        } catch (error) {
          console.error(`Failed to send dunning email to ${action.tenantEmail}:`, error);
        }
      }
    }

    return {
      processed: actions.length,
      escalated: actions.filter(a => a.newLevel > a.currentLevel).length,
      emailsSent,
      actions,
    };
  }

  private generateDunningEmail(action: DunningAction, level: DunningLevel): string {
    const dueDate = addDays(new Date(), level.level === 3 ? 7 : 14);
    const dueDateStr = format(dueDate, 'dd.MM.yyyy', { locale: de });

    const templates = {
      1: `
        <h2>Zahlungserinnerung</h2>
        <p>Sehr geehrte(r) ${action.tenantName},</p>
        <p>wir möchten Sie freundlich daran erinnern, dass für Ihre Wohnung in der ${action.propertyName} (${action.unitNumber}) noch ein offener Betrag besteht:</p>
        <p><strong>Offener Betrag: ${this.formatCurrency(action.amount)}</strong></p>
        <p>Bitte überweisen Sie diesen Betrag bis zum ${dueDateStr}.</p>
        <p>Falls Sie bereits gezahlt haben, betrachten Sie diese Erinnerung als gegenstandslos.</p>
        <p>Mit freundlichen Grüßen,<br>Ihre Hausverwaltung</p>
      `,
      2: `
        <h2>1. Mahnung</h2>
        <p>Sehr geehrte(r) ${action.tenantName},</p>
        <p>leider haben wir trotz unserer Zahlungserinnerung noch keinen Zahlungseingang für Ihre Wohnung in der ${action.propertyName} (${action.unitNumber}) feststellen können.</p>
        <p><strong>Offener Betrag: ${this.formatCurrency(action.amount)}</strong></p>
        <p><strong>Mahngebühr: ${this.formatCurrency(action.fee)}</strong></p>
        <p><strong>Verzugszinsen (§ 1333 ABGB): ${this.formatCurrency(action.interest)}</strong></p>
        <p><strong>Gesamtbetrag: ${this.formatCurrency(action.totalDue)}</strong></p>
        <p>Bitte begleichen Sie den Gesamtbetrag bis zum ${dueDateStr}.</p>
        <p>Mit freundlichen Grüßen,<br>Ihre Hausverwaltung</p>
      `,
      3: `
        <h2>2. Mahnung - Letzte Aufforderung vor rechtlichen Schritten</h2>
        <p>Sehr geehrte(r) ${action.tenantName},</p>
        <p>trotz unserer bisherigen Mahnungen ist der offene Betrag für Ihre Wohnung in der ${action.propertyName} (${action.unitNumber}) noch nicht beglichen worden.</p>
        <p><strong>Offener Betrag: ${this.formatCurrency(action.amount)}</strong></p>
        <p><strong>Mahngebühr: ${this.formatCurrency(action.fee)}</strong></p>
        <p><strong>Verzugszinsen (§ 1333 ABGB): ${this.formatCurrency(action.interest)}</strong></p>
        <p><strong>Gesamtbetrag: ${this.formatCurrency(action.totalDue)}</strong></p>
        <p><strong style="color: red;">Dies ist die letzte Mahnung vor Einleitung rechtlicher Schritte.</strong></p>
        <p>Sollte der Betrag nicht bis zum ${dueDateStr} auf unserem Konto eingehen, werden wir ohne weitere Vorwarnung ein gerichtliches Mahnverfahren einleiten.</p>
        <p>Mit freundlichen Grüßen,<br>Ihre Hausverwaltung</p>
      `,
    };

    return templates[action.newLevel as 1 | 2 | 3] || templates[1];
  }

  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('de-AT', { 
      style: 'currency', 
      currency: 'EUR' 
    }).format(amount);
  }
}

export const automatedDunningService = new AutomatedDunningService();
