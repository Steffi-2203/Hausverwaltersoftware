/**
 * Zentrale SOLL/IST-Berechnung für Reports
 * 
 * Diese Utility-Funktion wird von sowohl der UI (Reports.tsx) als auch
 * dem PDF-Export (reportPdfExport.ts) verwendet, um konsistente Berechnungen
 * zu gewährleisten.
 * 
 * BRUTTO-Berechnung: Verwendet gesamtbetrag für alle SOLL-Werte
 * MRG-Allokation: BK → HK → Miete Priorität bei Unterzahlung
 */

export interface TenantSollIstResult {
  tenantId: string;
  tenantName: string;
  unitId: string;
  unitName: string;        // Für UI-Kompatibilität
  unitNummer: string;      // Für PDF-Kompatibilität
  propertyName: string;
  sollBk: number;
  sollHk: number;
  sollMiete: number;
  sollBetrag: number;      // BRUTTO-Gesamt
  sollGesamt: number;      // Alias für UI-Kompatibilität
  istBk: number;
  istHk: number;
  istMiete: number;
  habenBetrag: number;     // IST-Gesamt
  istGesamt: number;       // Alias für UI-Kompatibilität
  saldo: number;
  diffBk: number;          // sollBk - istBk
  diffHk: number;          // sollHk - istHk
  diffMiete: number;       // sollMiete - istMiete
  diffGesamt: number;      // sollGesamt - istGesamt
  ueberzahlung: number;
  paymentCount: number;
  daysOverdue: number;
  isVacancy?: boolean;
}

export interface InvoiceData {
  id: string;
  tenantId?: string;
  tenant_id?: string;
  unitId?: string;
  unit_id?: string;
  year: number;
  month: number;
  grundmiete?: number | string;
  betriebskosten?: number | string;
  heizungskosten?: number | string;
  gesamtbetrag?: number | string;
  ustSatzBk?: number;
  ust_satz_bk?: number;
  ustSatzHeizung?: number;
  ust_satz_heizung?: number;
  ustSatzMiete?: number;
  ust_satz_miete?: number;
  isVacancy?: boolean;
  is_vacancy?: boolean;
  paidAmount?: number | string;
  paid_amount?: number | string;
}

export interface PaymentData {
  id: string;
  tenantId?: string;
  tenant_id?: string;
  amount?: number | string;
  betrag?: number | string;
  paymentDate?: string;
  payment_date?: string;
  buchungsdatum?: string;
}

export interface TenantData {
  id: string;
  firstName?: string;
  first_name?: string;
  lastName?: string;
  last_name?: string;
  vorname?: string;
  nachname?: string;
  unitId?: string;
  unit_id?: string;
  grundmiete?: number | string;
  betriebskostenVorschuss?: number | string;
  betriebskosten_vorschuss?: number | string;
  heizungskostenVorschuss?: number | string;
  heizungskosten_vorschuss?: number | string;
  mietbeginn?: string;
  mietende?: string | null;
  deletedAt?: string | null;
  deleted_at?: string | null;
}

export interface UnitData {
  id: string;
  propertyId?: string;
  property_id?: string;
  top_nummer?: string;
  topNummer?: string;
}

export interface PropertyData {
  id: string;
  name: string;
}

export interface CalculationParams {
  tenants: TenantData[];
  units: UnitData[];
  properties: PropertyData[];
  invoices: InvoiceData[];
  payments: PaymentData[];
  selectedYear: number;
  periodStartMonth: number;
  periodEndMonth: number;
  selectedPropertyId?: string;
}

/**
 * Berechnet SOLL/IST für alle Mieter und Leerstände
 * 
 * @returns Array von TenantSollIstResult für jeden Mieter und Leerstand
 */
export function calculateTenantSollIst(params: CalculationParams): TenantSollIstResult[] {
  const {
    tenants,
    units,
    properties,
    invoices,
    payments,
    selectedYear,
    periodStartMonth,
    periodEndMonth,
    selectedPropertyId
  } = params;

  const results: TenantSollIstResult[] = [];
  const monthCount = periodEndMonth - periodStartMonth + 1;

  // Filter units by property if specified
  const targetUnits = selectedPropertyId && selectedPropertyId !== 'all'
    ? units.filter(u => (u.propertyId || u.property_id) === selectedPropertyId)
    : units;

  const targetUnitIds = new Set(targetUnits.map(u => u.id));

  // Filter active tenants for target units
  const activeTenants = tenants.filter(t => {
    const unitId = t.unitId || t.unit_id;
    if (!unitId || !targetUnitIds.has(unitId)) return false;
    if (t.deletedAt || t.deleted_at) return false;
    
    // Check if tenant was active during the period
    const mietbeginn = t.mietbeginn ? new Date(t.mietbeginn) : null;
    const mietende = t.mietende ? new Date(t.mietende) : null;
    const periodStart = new Date(selectedYear, periodStartMonth - 1, 1);
    const periodEnd = new Date(selectedYear, periodEndMonth, 0);

    if (mietbeginn && mietbeginn > periodEnd) return false;
    if (mietende && mietende < periodStart) return false;
    
    return true;
  });

  // Filter payments for the period
  const periodPayments = payments.filter(p => {
    const dateStr = p.paymentDate || p.payment_date || p.buchungsdatum;
    if (!dateStr) return false;
    const date = new Date(dateStr);
    return date.getFullYear() === selectedYear &&
           date.getMonth() + 1 >= periodStartMonth &&
           date.getMonth() + 1 <= periodEndMonth;
  });

  // Process each tenant
  for (const tenant of activeTenants) {
    const tenantId = tenant.id;
    const unitId = tenant.unitId || tenant.unit_id;
    const unit = targetUnits.find(u => u.id === unitId);
    const propertyId = unit?.propertyId || unit?.property_id;
    const property = properties.find(p => p.id === propertyId);

    // Get tenant's invoices for the period
    const tenantInvoices = invoices.filter(inv => {
      const invTenantId = inv.tenantId || inv.tenant_id;
      const isVacancy = inv.isVacancy || inv.is_vacancy;
      return invTenantId === tenantId &&
             !isVacancy &&
             inv.year === selectedYear &&
             inv.month >= periodStartMonth &&
             inv.month <= periodEndMonth;
    });

    // Calculate SOLL (BRUTTO from gesamtbetrag)
    let sollBk = 0;
    let sollHk = 0;
    let sollMiete = 0;
    let sollBetrag = 0;

    if (tenantInvoices.length > 0) {
      // BRUTTO-Gesamt aus gesamtbetrag
      sollBetrag = tenantInvoices.reduce((sum, inv) => 
        sum + Number(inv.gesamtbetrag || 0), 0);

      // Komponenten mit USt
      tenantInvoices.forEach(inv => {
        const mieteNetto = Number(inv.grundmiete || 0);
        const bkNetto = Number(inv.betriebskosten || 0);
        const hkNetto = Number(inv.heizungskosten || 0);

        const ustSatzBk = Number(inv.ustSatzBk ?? inv.ust_satz_bk ?? 10);
        const ustSatzHk = Number(inv.ustSatzHeizung ?? inv.ust_satz_heizung ?? 20);
        const ustSatzMiete = Number(inv.ustSatzMiete ?? inv.ust_satz_miete ?? 10);

        sollBk += bkNetto * (1 + ustSatzBk / 100);
        sollHk += hkNetto * (1 + ustSatzHk / 100);
        sollMiete += mieteNetto * (1 + ustSatzMiete / 100);
      });

      // Reconciliation
      const komponentenSumme = sollBk + sollHk + sollMiete;
      if (komponentenSumme > 0 && Math.abs(komponentenSumme - sollBetrag) > 0.01) {
        const factor = sollBetrag / komponentenSumme;
        sollBk *= factor;
        sollHk *= factor;
        sollMiete *= factor;
      }
    } else {
      // Fallback to tenant fields * monthCount
      const mieteNetto = Number(tenant.grundmiete || 0) * monthCount;
      const bkNetto = Number(tenant.betriebskostenVorschuss || tenant.betriebskosten_vorschuss || 0) * monthCount;
      const hkNetto = Number(tenant.heizungskostenVorschuss || tenant.heizungskosten_vorschuss || 0) * monthCount;
      
      sollMiete = mieteNetto * 1.10;
      sollBk = bkNetto * 1.10;
      sollHk = hkNetto * 1.20;
      sollBetrag = sollMiete + sollBk + sollHk;
    }

    // Calculate IST from payments
    const tenantPayments = periodPayments.filter(p => 
      (p.tenantId || p.tenant_id) === tenantId);
    const habenBetrag = tenantPayments.reduce((sum, p) => 
      sum + Number(p.amount || p.betrag || 0), 0);

    // IST-Berechnung mit MRG-Allokation
    let istBk = 0;
    let istHk = 0;
    let istMiete = 0;

    if (sollBetrag > 0.01 && habenBetrag >= sollBetrag - 0.01) {
      // Voll bezahlt: IST = SOLL
      istBk = sollBk;
      istHk = sollHk;
      istMiete = sollMiete;
    } else if (habenBetrag < 0.01) {
      // Keine Zahlung: IST = 0
      istBk = 0;
      istHk = 0;
      istMiete = 0;
    } else {
      // Unterzahlung: MRG-Allokation BK → HK → Miete
      let remaining = habenBetrag;
      
      istBk = Math.min(remaining, sollBk);
      remaining -= istBk;
      
      istHk = Math.min(remaining, sollHk);
      remaining -= istHk;
      
      istMiete = Math.min(remaining, sollMiete);
    }

    const saldo = sollBetrag - habenBetrag;
    const ueberzahlung = saldo < 0 ? Math.abs(saldo) : 0;

    const tenantName = `${tenant.vorname || tenant.firstName || tenant.first_name || ''} ${tenant.nachname || tenant.lastName || tenant.last_name || ''}`.trim() || 'N/A';

    const unitName = unit?.top_nummer || unit?.topNummer || 'N/A';
    const istGesamt = istBk + istHk + istMiete;

    results.push({
      tenantId,
      tenantName,
      unitId: unitId || '',
      unitName,
      unitNummer: unitName,
      propertyName: property?.name || 'N/A',
      sollBk,
      sollHk,
      sollMiete,
      sollBetrag,
      sollGesamt: sollBetrag,
      istBk,
      istHk,
      istMiete,
      habenBetrag,
      istGesamt,
      saldo,
      diffBk: sollBk - istBk,
      diffHk: sollHk - istHk,
      diffMiete: sollMiete - istMiete,
      diffGesamt: sollBetrag - istGesamt,
      ueberzahlung,
      paymentCount: tenantPayments.length,
      daysOverdue: 0,
      isVacancy: false
    });
  }

  // Process vacancies (Leerstand)
  const vacancyInvoices = invoices.filter(inv => {
    const isVacancy = inv.isVacancy || inv.is_vacancy;
    const unitId = inv.unitId || inv.unit_id;
    return isVacancy &&
           unitId &&
           targetUnitIds.has(unitId) &&
           inv.year === selectedYear &&
           inv.month >= periodStartMonth &&
           inv.month <= periodEndMonth;
  });

  // Group by unit
  const vacancyByUnit = new Map<string, InvoiceData[]>();
  vacancyInvoices.forEach(inv => {
    const unitId = (inv.unitId || inv.unit_id) as string;
    if (!vacancyByUnit.has(unitId)) {
      vacancyByUnit.set(unitId, []);
    }
    vacancyByUnit.get(unitId)!.push(inv);
  });

  // Create vacancy entries
  vacancyByUnit.forEach((unitVacancyInvoices, unitId) => {
    const unit = targetUnits.find(u => u.id === unitId);
    const propertyId = unit?.propertyId || unit?.property_id;
    const property = properties.find(p => p.id === propertyId);

    // SOLL BRUTTO aus gesamtbetrag
    const sollBetrag = unitVacancyInvoices.reduce((sum, inv) => 
      sum + Number(inv.gesamtbetrag || 0), 0);

    // Komponenten mit USt
    let sollBk = unitVacancyInvoices.reduce((sum, inv) => {
      const netto = Number(inv.betriebskosten || 0);
      const ustSatz = Number(inv.ustSatzBk ?? inv.ust_satz_bk ?? 10);
      return sum + netto * (1 + ustSatz / 100);
    }, 0);
    let sollHk = unitVacancyInvoices.reduce((sum, inv) => {
      const netto = Number(inv.heizungskosten || 0);
      const ustSatz = Number(inv.ustSatzHeizung ?? inv.ust_satz_heizung ?? 20);
      return sum + netto * (1 + ustSatz / 100);
    }, 0);

    // Reconciliation
    const komponentenSumme = sollBk + sollHk;
    if (komponentenSumme > 0 && Math.abs(komponentenSumme - sollBetrag) > 0.01) {
      const factor = sollBetrag / komponentenSumme;
      sollBk *= factor;
      sollHk *= factor;
    }

    // IST aus paid_amount
    const habenBetrag = unitVacancyInvoices.reduce((sum, inv) => 
      sum + Number(inv.paidAmount ?? inv.paid_amount ?? 0), 0);

    // Proportionale Verteilung
    const istBk = sollBetrag > 0 ? (sollBk / sollBetrag) * habenBetrag : 0;
    const istHk = sollBetrag > 0 ? (sollHk / sollBetrag) * habenBetrag : 0;
    const istGesamt = istBk + istHk;

    const saldo = sollBetrag - habenBetrag;
    const unitName = unit?.top_nummer || unit?.topNummer || '-';

    results.push({
      tenantId: `vacancy-${unitId}`,
      tenantName: `Leerstand (${unitVacancyInvoices.length} Mon.)`,
      unitId,
      unitName,
      unitNummer: unitName,
      propertyName: property?.name || '-',
      sollBk,
      sollHk,
      sollMiete: 0,
      sollBetrag,
      sollGesamt: sollBetrag,
      istBk,
      istHk,
      istMiete: 0,
      habenBetrag,
      istGesamt,
      saldo,
      diffBk: sollBk - istBk,
      diffHk: sollHk - istHk,
      diffMiete: 0,
      diffGesamt: sollBetrag - istGesamt,
      ueberzahlung: 0,
      paymentCount: 0,
      daysOverdue: 0,
      isVacancy: true
    });
  });

  return results;
}

/**
 * Berechnet Summen aus TenantSollIstResult Array
 */
export function calculateSollIstTotals(results: TenantSollIstResult[]) {
  return results.reduce((acc, detail) => ({
    sollBk: acc.sollBk + detail.sollBk,
    sollHk: acc.sollHk + detail.sollHk,
    sollMiete: acc.sollMiete + detail.sollMiete,
    sollGesamt: acc.sollGesamt + detail.sollBetrag,
    istBk: acc.istBk + detail.istBk,
    istHk: acc.istHk + detail.istHk,
    istMiete: acc.istMiete + detail.istMiete,
    istGesamt: acc.istGesamt + detail.habenBetrag,
    diffBk: acc.diffBk + (detail.sollBk - detail.istBk),
    diffHk: acc.diffHk + (detail.sollHk - detail.istHk),
    diffMiete: acc.diffMiete + (detail.sollMiete - detail.istMiete),
    diffGesamt: acc.diffGesamt + detail.saldo
  }), {
    sollBk: 0, sollHk: 0, sollMiete: 0, sollGesamt: 0,
    istBk: 0, istHk: 0, istMiete: 0, istGesamt: 0,
    diffBk: 0, diffHk: 0, diffMiete: 0, diffGesamt: 0
  });
}
