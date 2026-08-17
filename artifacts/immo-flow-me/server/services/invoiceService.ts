import { db } from "../db";
import { 
  tenants, 
  units, 
  monthlyInvoices, 
  invoiceLines,
  payments, 
  propertyManagers 
} from "@shared/schema";
import { eq, and, inArray, gte, lte } from "drizzle-orm";
import { writeAudit } from "../lib/auditLog";
import type { Tenant } from "@shared/schema";
import { roundMoney } from "@shared/utils";

interface InvoiceLine {
  invoiceId: string;
  expenseType: string;
  description: string;
  netAmount: string;
  vatRate: number;
  grossAmount: string;
  allocationReference: string;
}

interface CarryForward {
  vortragMiete: number;
  vortragBk: number;
  vortragHk: number;
  vortragSonstige: number;
  credit?: number;
}

interface VatRates {
  ustSatzMiete: number;
  ustSatzBk: number;
  ustSatzHeizung: number;
}

interface InvoiceData {
  tenantId: string;
  unitId: string | null;
  year: number;
  month: number;
  grundmiete: number;
  betriebskosten: number;
  heizungskosten: number;
  gesamtbetrag: number;
  ust: number;
  ustSatzMiete: number;
  ustSatzBk: number;
  ustSatzHeizung: number;
  status: "offen" | "bezahlt" | "teilbezahlt" | "ueberfaellig";
  faelligAm: string;
  vortragMiete: number;
  vortragBk: number;
  vortragHk: number;
  vortragSonstige: number;
}

interface GenerateInvoicesResult {
  success: boolean;
  created: number;
  skipped: number;
  carryForwardsCalculated: number;
  invoices: any[];
  message: string;
}

export class InvoiceService {
  getVatRates(unitType: string): VatRates {
    const isCommercial = ['geschaeft', 'garage', 'stellplatz', 'lager'].includes(unitType?.toLowerCase() || '');
    return {
      ustSatzMiete: isCommercial ? 20 : 10,
      ustSatzBk: isCommercial ? 20 : 10,
      ustSatzHeizung: 20,
    };
  }

  calculateVatFromGross(grossAmount: number, vatRate: number): number {
    if (vatRate === 0) return 0;
    return grossAmount - (grossAmount / (1 + vatRate / 100));
  }

  async calculateTenantCarryForward(tenantId: string, year: number): Promise<CarryForward & { credit?: number }> {
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

    const sollMiete = prevYearInvoices.reduce((s, inv) => s + Number(inv.grundmiete || 0), 0);
    const sollBk = prevYearInvoices.reduce((s, inv) => s + Number(inv.betriebskosten || 0), 0);
    const sollHk = prevYearInvoices.reduce((s, inv) => s + Number(inv.heizungskosten || 0), 0);
    const sollGesamt = roundMoney(sollMiete + sollBk + sollHk);

    const istGesamt = roundMoney(prevYearPayments.reduce((s, p) => s + Number(p.betrag || 0), 0));
    const diff = roundMoney(istGesamt - sollGesamt);

    if (diff > 0) {
      return { vortragMiete: 0, vortragBk: 0, vortragHk: 0, vortragSonstige: 0, credit: diff };
    }

    let remainingPayment = istGesamt;
    const paidBk = Math.min(remainingPayment, sollBk);
    remainingPayment = roundMoney(remainingPayment - paidBk);
    const paidHk = Math.min(remainingPayment, sollHk);
    remainingPayment = roundMoney(remainingPayment - paidHk);
    const paidMiete = Math.min(remainingPayment, sollMiete);
    remainingPayment = roundMoney(remainingPayment - paidMiete);

    return {
      vortragMiete: roundMoney(Math.max(0, sollMiete - paidMiete)),
      vortragBk: roundMoney(Math.max(0, sollBk - paidBk)),
      vortragHk: roundMoney(Math.max(0, sollHk - paidHk)),
      vortragSonstige: 0,
    };
  }

  buildInvoiceData(
    tenant: typeof tenants.$inferSelect,
    unitType: string,
    year: number,
    month: number,
    dueDate: string,
    carryForward: CarryForward
  ): InvoiceData {
    const vatRates = this.getVatRates(unitType);
    
    const grundmiete = roundMoney(Number(tenant.grundmiete) || 0);
    const betriebskosten = roundMoney(Number(tenant.betriebskostenVorschuss) || 0);
    const heizungskosten = roundMoney(Number(tenant.heizkostenVorschuss) || 0);
    
    const ustMiete = roundMoney(this.calculateVatFromGross(grundmiete, vatRates.ustSatzMiete));
    const ustBk = roundMoney(this.calculateVatFromGross(betriebskosten, vatRates.ustSatzBk));
    const ustHeizung = roundMoney(this.calculateVatFromGross(heizungskosten, vatRates.ustSatzHeizung));
    const ust = roundMoney(ustMiete + ustBk + ustHeizung);

    const vortragGesamt = roundMoney(carryForward.vortragMiete + carryForward.vortragBk + 
                         carryForward.vortragHk + carryForward.vortragSonstige);
    
    const gesamtbetrag = roundMoney(grundmiete + betriebskosten + heizungskosten + vortragGesamt);

    return {
      tenantId: tenant.id,
      unitId: tenant.unitId,
      year,
      month,
      grundmiete,
      betriebskosten,
      heizungskosten,
      gesamtbetrag,
      ust,
      ustSatzMiete: vatRates.ustSatzMiete,
      ustSatzBk: vatRates.ustSatzBk,
      ustSatzHeizung: vatRates.ustSatzHeizung,
      status: "offen",
      faelligAm: dueDate,
      vortragMiete: roundMoney(carryForward.vortragMiete),
      vortragBk: roundMoney(carryForward.vortragBk),
      vortragHk: roundMoney(carryForward.vortragHk),
      vortragSonstige: roundMoney(carryForward.vortragSonstige),
    };
  }

  buildInvoiceLines(
    invoiceId: string,
    tenant: Tenant,
    vatRates: VatRates,
    month: number,
    year: number
  ): InvoiceLine[] {
    const lines: InvoiceLine[] = [];
    const monthName = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 
                       'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'][month - 1];

    const grundmiete = Number(tenant.grundmiete) || 0;
    if (grundmiete > 0) {
      const netMiete = grundmiete / (1 + vatRates.ustSatzMiete / 100);
      lines.push({
        invoiceId,
        expenseType: 'grundmiete',
        description: `Nettomiete ${monthName} ${year}`,
        netAmount: roundMoney(netMiete).toString(),
        vatRate: vatRates.ustSatzMiete,
        grossAmount: grundmiete.toString(),
        allocationReference: 'MRG §15',
      });
    }

    const bk = Number(tenant.betriebskostenVorschuss) || 0;
    if (bk > 0) {
      const netBk = bk / (1 + vatRates.ustSatzBk / 100);
      lines.push({
        invoiceId,
        expenseType: 'betriebskosten',
        description: `BK-Vorschuss ${monthName} ${year}`,
        netAmount: roundMoney(netBk).toString(),
        vatRate: vatRates.ustSatzBk,
        grossAmount: bk.toString(),
        allocationReference: 'MRG §21',
      });
    }

    const hk = Number(tenant.heizkostenVorschuss) || 0;
    if (hk > 0) {
      const netHk = hk / (1 + vatRates.ustSatzHeizung / 100);
      lines.push({
        invoiceId,
        expenseType: 'heizkosten',
        description: `HK-Vorschuss ${monthName} ${year}`,
        netAmount: roundMoney(netHk).toString(),
        vatRate: vatRates.ustSatzHeizung,
        grossAmount: hk.toString(),
        allocationReference: 'HeizKG',
      });
    }

    const wasser = Number(tenant.wasserkostenVorschuss) || 0;
    if (wasser > 0) {
      const netWasser = wasser / (1 + 10 / 100);
      lines.push({
        invoiceId,
        expenseType: 'wasserkosten',
        description: `Wasserkosten-Vorschuss ${monthName} ${year}`,
        netAmount: roundMoney(netWasser).toString(),
        vatRate: 10,
        grossAmount: wasser.toString(),
        allocationReference: 'MRG §21',
      });
    }

    const sonstigeKosten = tenant.sonstigeKosten as Record<string, { betrag: number; ust: number; schluessel?: string }> | null;
    if (sonstigeKosten && typeof sonstigeKosten === 'object') {
      for (const [key, value] of Object.entries(sonstigeKosten)) {
        if (value && value.betrag > 0) {
          const betrag = Number(value.betrag);
          const ust = Number(value.ust) || 10;
          const netBetrag = betrag / (1 + ust / 100);
          lines.push({
            invoiceId,
            expenseType: 'sonstige',
            description: `${key} ${monthName} ${year}`,
            netAmount: roundMoney(netBetrag).toString(),
            vatRate: ust,
            grossAmount: betrag.toString(),
            allocationReference: value.schluessel || 'Vereinbarung',
          });
        }
      }
    }

    return lines;
  }

  buildVacancyInvoiceData(
    unit: typeof units.$inferSelect,
    year: number,
    month: number,
    dueDate: string
  ): Omit<InvoiceData, 'tenantId'> & { tenantId: null; isVacancy: boolean } {
    const vatRates = this.getVatRates(unit.type || 'wohnung');
    
    const betriebskosten = roundMoney(Number(unit.leerstandBk) || 0);
    const heizungskosten = roundMoney(Number(unit.leerstandHk) || 0);
    
    const ustBk = roundMoney(this.calculateVatFromGross(betriebskosten, vatRates.ustSatzBk));
    const ustHeizung = roundMoney(this.calculateVatFromGross(heizungskosten, vatRates.ustSatzHeizung));
    const ust = roundMoney(ustBk + ustHeizung);
    
    const gesamtbetrag = roundMoney(betriebskosten + heizungskosten);

    return {
      tenantId: null,
      unitId: unit.id,
      year,
      month,
      grundmiete: 0,
      betriebskosten,
      heizungskosten,
      gesamtbetrag,
      ust,
      ustSatzMiete: vatRates.ustSatzMiete,
      ustSatzBk: vatRates.ustSatzBk,
      ustSatzHeizung: vatRates.ustSatzHeizung,
      status: "offen",
      faelligAm: dueDate,
      isVacancy: true,
      vortragMiete: 0,
      vortragBk: 0,
      vortragHk: 0,
      vortragSonstige: 0,
    };
  }

  buildVacancyInvoiceLines(
    invoiceId: string,
    unit: typeof units.$inferSelect,
    month: number,
    year: number
  ): InvoiceLine[] {
    const lines: InvoiceLine[] = [];
    const monthName = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 
                       'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'][month - 1];
    const vatRates = this.getVatRates(unit.type || 'wohnung');

    const bk = Number(unit.leerstandBk) || 0;
    if (bk > 0) {
      const netBk = bk / (1 + vatRates.ustSatzBk / 100);
      lines.push({
        invoiceId,
        expenseType: 'betriebskosten',
        description: `BK Leerstand ${unit.topNummer} ${monthName} ${year}`,
        netAmount: roundMoney(netBk).toString(),
        vatRate: vatRates.ustSatzBk,
        grossAmount: bk.toString(),
        allocationReference: 'MRG §21 Leerstand',
      });
    }

    const hk = Number(unit.leerstandHk) || 0;
    if (hk > 0) {
      const netHk = hk / (1 + vatRates.ustSatzHeizung / 100);
      lines.push({
        invoiceId,
        expenseType: 'heizkosten',
        description: `HK Leerstand ${unit.topNummer} ${monthName} ${year}`,
        netAmount: roundMoney(netHk).toString(),
        vatRate: vatRates.ustSatzHeizung,
        grossAmount: hk.toString(),
        allocationReference: 'HeizKG Leerstand',
      });
    }

    return lines;
  }

  async generateMonthlyInvoices(
    userId: string, 
    year: number, 
    month: number
  ): Promise<GenerateInvoicesResult> {
    const isJanuary = month === 1;

    const managedProperties = await db.select({ propertyId: propertyManagers.propertyId })
      .from(propertyManagers)
      .where(eq(propertyManagers.userId, userId));

    if (!managedProperties.length) {
      return { 
        success: true, 
        message: "No managed properties found", 
        created: 0, 
        skipped: 0, 
        carryForwardsCalculated: 0, 
        invoices: [] 
      };
    }

    const propertyIds = managedProperties.map(p => p.propertyId);

    const unitsData = await db.select()
      .from(units)
      .where(inArray(units.propertyId, propertyIds));

    if (!unitsData.length) {
      return { 
        success: true, 
        message: "No units found", 
        created: 0, 
        skipped: 0, 
        carryForwardsCalculated: 0, 
        invoices: [] 
      };
    }

    const unitIds = unitsData.map(u => u.id);
    const unitTypeMap = new Map(unitsData.map(u => [u.id, u.type || 'wohnung']));
    const unitMap = new Map(unitsData.map(u => [u.id, u]));

    const tenantsData = await db.select()
      .from(tenants)
      .where(and(
        inArray(tenants.unitId, unitIds),
        eq(tenants.status, 'aktiv')
      ));

    const dueDate = new Date(year, month - 1, 5);
    const dueDateStr = dueDate.toISOString().split('T')[0];

    // Find existing invoices for this month (both tenant and vacancy)
    const existingInvoices = await db.select({ 
      tenantId: monthlyInvoices.tenantId,
      unitId: monthlyInvoices.unitId,
      isVacancy: monthlyInvoices.isVacancy
    })
      .from(monthlyInvoices)
      .where(and(
        eq(monthlyInvoices.year, year),
        eq(monthlyInvoices.month, month)
      ));

    const existingTenantIds = new Set(existingInvoices.filter(inv => inv.tenantId).map(inv => inv.tenantId));
    const existingVacancyUnitIds = new Set(existingInvoices.filter(inv => inv.isVacancy).map(inv => inv.unitId));
    
    const tenantsToInvoice = tenantsData.filter(t => !existingTenantIds.has(t.id));
    const occupiedUnitIds = new Set(tenantsData.map(t => t.unitId));
    
    // Find vacant units with leerstand costs that need invoices
    const vacantUnitsToInvoice = unitsData.filter(u => 
      u.status === 'leerstand' && 
      !occupiedUnitIds.has(u.id) &&
      !existingVacancyUnitIds.has(u.id) &&
      ((Number(u.leerstandBk) || 0) > 0 || (Number(u.leerstandHk) || 0) > 0)
    );

    if (!tenantsToInvoice.length && !vacantUnitsToInvoice.length) {
      return { 
        success: true, 
        message: `All invoices already exist for ${month}/${year}`,
        created: 0,
        skipped: tenantsData.length + vacantUnitsToInvoice.length,
        carryForwardsCalculated: 0,
        invoices: []
      };
    }

    const carryForwardMap = new Map<string, CarryForward>();
    if (isJanuary) {
      for (const tenant of tenantsToInvoice) {
        const carryForward = await this.calculateTenantCarryForward(tenant.id, year);
        carryForwardMap.set(tenant.id, carryForward);
      }
    }

    const tenantMap = new Map(tenantsToInvoice.map(t => [t.id, t]));
    
    // Build tenant invoices
    const tenantInvoicesToCreate = tenantsToInvoice.map(tenant => {
      const unitType = unitTypeMap.get(tenant.unitId || '') || 'wohnung';
      const carryForward = carryForwardMap.get(tenant.id) || {
        vortragMiete: 0, vortragBk: 0, vortragHk: 0, vortragSonstige: 0,
      };
      const data = this.buildInvoiceData(tenant, unitType, year, month, dueDateStr, carryForward);
      return {
        ...data,
        isVacancy: false,
        grundmiete: String(data.grundmiete),
        betriebskosten: String(data.betriebskosten),
        heizungskosten: String(data.heizungskosten),
        gesamtbetrag: String(data.gesamtbetrag),
        ust: String(data.ust),
        vortragMiete: String(data.vortragMiete),
        vortragBk: String(data.vortragBk),
        vortragHk: String(data.vortragHk),
        vortragSonstige: String(data.vortragSonstige),
      };
    });

    // Build vacancy invoices
    const vacancyInvoicesToCreate = vacantUnitsToInvoice.map(unit => {
      const data = this.buildVacancyInvoiceData(unit, year, month, dueDateStr);
      return {
        ...data,
        grundmiete: String(data.grundmiete),
        betriebskosten: String(data.betriebskosten),
        heizungskosten: String(data.heizungskosten),
        gesamtbetrag: String(data.gesamtbetrag),
        ust: String(data.ust),
        vortragMiete: String(data.vortragMiete),
        vortragBk: String(data.vortragBk),
        vortragHk: String(data.vortragHk),
        vortragSonstige: String(data.vortragSonstige),
      };
    });

    const createdInvoices = await db.transaction(async (tx) => {
      const allInserted: (typeof monthlyInvoices.$inferSelect)[] = [];

      // Insert tenant invoices
      if (tenantInvoicesToCreate.length > 0) {
        const inserted = await tx.insert(monthlyInvoices)
          .values(tenantInvoicesToCreate)
          .onConflictDoNothing()
          .returning();
        allInserted.push(...inserted);
      }

      // Insert vacancy invoices
      if (vacancyInvoicesToCreate.length > 0) {
        const inserted = await tx.insert(monthlyInvoices)
          .values(vacancyInvoicesToCreate)
          .onConflictDoNothing()
          .returning();
        allInserted.push(...inserted);
      }

      // Build invoice lines
      const allLines: typeof invoiceLines.$inferInsert[] = [];
      
      for (const invoice of allInserted) {
        if (invoice.isVacancy) {
          // Vacancy invoice lines
          const unit = unitMap.get(invoice.unitId)!;
          const lines = this.buildVacancyInvoiceLines(invoice.id, unit, month, year);
          allLines.push(...lines);
        } else if (invoice.tenantId) {
          // Tenant invoice lines
          const tenant = tenantMap.get(invoice.tenantId)!;
          const unitType = unitTypeMap.get(invoice.unitId || '') || 'wohnung';
          const vatRates = this.getVatRates(unitType);
          const lines = this.buildInvoiceLines(invoice.id, tenant, vatRates, month, year);
          allLines.push(...lines);
        }
      }

      for (let i = 0; i < allLines.length; i += 500) {
        const batch = allLines.slice(i, i + 500);
        if (batch.length > 0) {
          await tx.insert(invoiceLines).values(batch);
        }
      }

      await writeAudit(tx, userId, 'monthly_invoices', 'bulk', 'bulk_create', null, {
        createdCount: allInserted.length,
        tenantInvoices: tenantInvoicesToCreate.length,
        vacancyInvoices: vacancyInvoicesToCreate.length,
        month,
        year,
        invoiceIds: allInserted.map(inv => inv.id),
      });

      return allInserted;
    });

    const tenantCount = createdInvoices.filter(inv => !inv.isVacancy).length;
    const vacancyCount = createdInvoices.filter(inv => inv.isVacancy).length;
    const totalSkipped = existingTenantIds.size + existingVacancyUnitIds.size;

    return { 
      success: true, 
      message: `Erstellt: ${tenantCount} Mieter-Vorschreibungen, ${vacancyCount} Leerstand-Vorschreibungen für ${month}/${year}`,
      created: createdInvoices.length,
      skipped: totalSkipped,
      carryForwardsCalculated: isJanuary ? carryForwardMap.size : 0,
      invoices: createdInvoices
    };
  }

  async getInvoiceSummary(tenantId: string, year: number): Promise<{
    totalSoll: number;
    totalIst: number;
    saldo: number;
    invoiceCount: number;
  }> {
    const yearInvoices = await db.select()
      .from(monthlyInvoices)
      .where(and(
        eq(monthlyInvoices.tenantId, tenantId),
        eq(monthlyInvoices.year, year)
      ));

    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    
    const yearPayments = await db.select()
      .from(payments)
      .where(and(
        eq(payments.tenantId, tenantId),
        gte(payments.buchungsDatum, startDate),
        lte(payments.buchungsDatum, endDate)
      ));

    const totalSoll = yearInvoices.reduce((sum, inv) => sum + Number(inv.gesamtbetrag || 0), 0);
    const totalIst = yearPayments.reduce((sum, p) => sum + Number(p.betrag || 0), 0);

    return {
      totalSoll: roundMoney(totalSoll),
      totalIst: roundMoney(totalIst),
      saldo: roundMoney(totalSoll - totalIst),
      invoiceCount: yearInvoices.length
    };
  }
}

export const invoiceService = new InvoiceService();
