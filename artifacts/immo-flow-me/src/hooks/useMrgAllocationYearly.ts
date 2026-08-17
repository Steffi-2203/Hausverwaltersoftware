import { useMemo } from 'react';
import { useTenants } from './useTenants';
import { useUnits } from './useUnits';
import { useCombinedPayments } from './useCombinedPayments';
import { useInvoices } from './useInvoices';
import { getActiveTenantsForPeriod } from '@/utils/tenantFilterUtils';
import { TenantAllocation, calculateMrgAllocation } from './useMrgAllocation';

export interface MrgAllocationYearlyResult {
  allocations: TenantAllocation[];
  totals: {
    sollBk: number;
    sollHk: number;
    sollMiete: number;
    totalSoll: number;
    istBk: number;
    istHk: number;
    istMiete: number;
    totalIst: number;
    totalUnterzahlung: number;
    totalUeberzahlung: number;
    saldo: number;
    paymentCount: number;
  };
  isLoading: boolean;
}

/**
 * Hook für MRG-konforme SOLL/IST-Berechnung pro Mieter - KUMULIERT ÜBER GESAMTES JAHR
 * Berechnet SOLL basierend auf Anzahl der aktiven Monate pro Mieter
 */
export function useMrgAllocationYearly(
  selectedPropertyId: string = 'all',
  year: number,
  monthCount: number = 12 // Wieviele Monate des Jahres berücksichtigt werden sollen
): MrgAllocationYearlyResult {
  const { data: tenants, isLoading: tenantsLoading } = useTenants();
  const { data: units, isLoading: unitsLoading } = useUnits();
  const { data: combinedPayments, isLoading: paymentsLoading } = useCombinedPayments();
  const { data: invoices, isLoading: invoicesLoading } = useInvoices();

  const isLoading = tenantsLoading || unitsLoading || paymentsLoading || invoicesLoading;

  const result = useMemo(() => {
    if (!tenants || !units || !combinedPayments) {
      return {
        allocations: [],
        totals: {
          sollBk: 0, sollHk: 0, sollMiete: 0, totalSoll: 0,
          istBk: 0, istHk: 0, istMiete: 0, totalIst: 0,
          totalUnterzahlung: 0, totalUeberzahlung: 0, saldo: 0,
          paymentCount: 0,
        },
      };
    }

    const now = new Date();
    const dayOfMonth = now.getDate();

    // Filter units by property (support both camelCase and snake_case)
    const propertyUnitIds = selectedPropertyId === 'all'
      ? null
      : units.filter(u => (u.propertyId ?? u.property_id) === selectedPropertyId).map(u => u.id);

    const relevantUnits = propertyUnitIds
      ? units.filter(u => propertyUnitIds.includes(u.id))
      : units;

    // Sammle alle aktiven Mieter über alle relevanten Monate
    const tenantMonthMap = new Map<string, {
      tenant: typeof tenants[0];
      activeMonths: number;
    }>();

    for (let month = 1; month <= monthCount; month++) {
      const activeTenants = getActiveTenantsForPeriod(
        relevantUnits,
        tenants,
        selectedPropertyId,
        year,
        month
      );
      
      activeTenants.forEach(tenant => {
        const existing = tenantMonthMap.get(tenant.id);
        if (existing) {
          existing.activeMonths += 1;
        } else {
          tenantMonthMap.set(tenant.id, { tenant, activeMonths: 1 });
        }
      });
    }

    // Filter payments for the whole year (support both camelCase and snake_case)
    const yearPayments = combinedPayments.filter(p => {
      const date = new Date(p.date);
      const paymentYear = date.getFullYear();
      const paymentMonth = date.getMonth() + 1;
      
      if (paymentYear !== year || paymentMonth > monthCount) return false;
      
      // Filter by property if selected
      if (propertyUnitIds) {
        const paymentTenantId = p.tenantId ?? p.tenant_id;
        const tenant = tenants.find(t => t.id === paymentTenantId);
        const tenantUnitId = tenant?.unitId ?? tenant?.unit_id;
        return tenant && tenantUnitId && propertyUnitIds.includes(tenantUnitId);
      }
      return true;
    });

    const allocations: TenantAllocation[] = Array.from(tenantMonthMap.values()).map(({ tenant, activeMonths }) => {
      // SOLL: Summiere Vorschreibungen (monthlyInvoices) für den Mieter im gesamten Zeitraum
      // Verwende gesamtbetrag (brutto inkl. USt) für Saldo-Berechnung, da Mieter brutto zahlt
      const tenantInvoices = invoices?.filter(inv => 
        (inv.tenantId ?? inv.tenant_id) === tenant.id && 
        inv.year === year && 
        inv.month <= monthCount
      ) || [];
      
      let sollBk: number, sollHk: number, sollMiete: number;
      let totalSollBrutto: number; // Gesamtbetrag inkl. USt für Saldo
      
      if (tenantInvoices.length > 0) {
        // Summiere alle Vorschreibungen für den Zeitraum
        // Support both camelCase and snake_case invoice field names
        sollBk = tenantInvoices.reduce((sum, invoice) => {
          const inv = invoice as any;
          return sum + Number(inv.betriebskosten ?? inv.betriebskostenVorschuss ?? inv.betriebskosten_vorschuss ?? 0);
        }, 0);
        sollHk = tenantInvoices.reduce((sum, invoice) => {
          const inv = invoice as any;
          return sum + Number(inv.heizkosten ?? inv.heizkostenVorschuss ?? inv.heizkosten_vorschuss ?? inv.heizungskosten ?? inv.heizungskosten_vorschuss ?? 0);
        }, 0);
        sollMiete = tenantInvoices.reduce((sum, invoice) => 
          sum + Number((invoice as any).grundmiete || 0), 0);
        // WICHTIG: Verwende gesamtbetrag (brutto) für Saldo, da Zahlungen brutto sind
        totalSollBrutto = tenantInvoices.reduce((sum, invoice) => {
          const inv = invoice as any;
          return sum + Number(inv.gesamtbetrag ?? 0);
        }, 0);
      } else {
        // Fallback auf Mieter-Stammdaten × aktive Monate (support both camelCase and snake_case)
        const sollBkMonthly = Number(tenant.betriebskostenVorschuss ?? tenant.betriebskosten_vorschuss ?? 0);
        // Schema uses heizkostenVorschuss (without "ungs"), also support alternative spellings
        const sollHkMonthly = Number(tenant.heizkostenVorschuss ?? tenant.heizungskostenVorschuss ?? tenant.heizungskosten_vorschuss ?? 0);
        const sollMieteMonthly = Number(tenant.grundmiete || 0);
        
        sollBk = sollBkMonthly * activeMonths;
        sollHk = sollHkMonthly * activeMonths;
        sollMiete = sollMieteMonthly * activeMonths;
        // Fallback: Berechne Brutto mit geschätztem USt-Satz (10% auf alles)
        totalSollBrutto = (sollBk + sollHk + sollMiete) * 1.1;
      }
      
      const totalSoll = sollBk + sollHk + sollMiete;

      // IST = Summe aller Zahlungen des Mieters im Jahr
      const tenantPayments = yearPayments.filter(p => (p.tenantId ?? p.tenant_id) === tenant.id);
      const totalIst = tenantPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

      // MRG-konforme Aufteilung über das Jahr (mit Brutto-SOLL für korrekte Überzahlungsberechnung)
      const { istBk, istHk, istMiete, ueberzahlung, unterzahlung } = 
        calculateMrgAllocation(sollBk, sollHk, sollMiete, totalIst);

      // Differenzen
      const diffBk = sollBk - istBk;
      const diffHk = sollHk - istHk;
      const diffMiete = sollMiete - istMiete;

      // Saldo: SOLL (brutto) - IST = positiv = Unterzahlung, negativ = Überzahlung
      // WICHTIG: Verwende totalSollBrutto (gesamtbetrag inkl. USt), da Zahlungen brutto sind
      const saldo = totalSollBrutto - totalIst;

      // Days overdue: nur wenn wir im aktuellen Jahr sind
      const isCurrentYear = year === now.getFullYear();
      const daysOverdue = isCurrentYear && saldo > 0 ? Math.max(0, dayOfMonth - 5) : 0;

      // Determine Mahnstatus
      let mahnstatus: 'aktuell' | 'Zahlungserinnerung' | '1. Mahnung' | '2. Mahnung' = 'aktuell';
      if (daysOverdue > 30) mahnstatus = '2. Mahnung';
      else if (daysOverdue > 14) mahnstatus = '1. Mahnung';
      else if (daysOverdue > 0) mahnstatus = 'Zahlungserinnerung';

      // Status
      let status: 'vollstaendig' | 'teilbezahlt' | 'offen' | 'ueberzahlt' = 'offen';
      if (saldo < -0.01) {
        status = 'ueberzahlt';
      } else if (Math.abs(saldo) < 0.01 && totalIst > 0) {
        status = 'vollstaendig';
      } else if (totalIst > 0 && saldo > 0.01) {
        status = 'teilbezahlt';
      }

      const tenantUnitId = tenant.unitId ?? tenant.unit_id;
      const unit = units.find(u => u.id === tenantUnitId) || null;

      return {
        tenant: {
          id: tenant.id,
          first_name: tenant.firstName ?? tenant.first_name,
          last_name: tenant.lastName ?? tenant.last_name,
          unit_id: tenantUnitId,
          grundmiete: Number(tenant.grundmiete || 0),
          betriebskosten_vorschuss: Number(tenant.betriebskostenVorschuss ?? tenant.betriebskosten_vorschuss ?? 0),
          heizungskosten_vorschuss: Number(tenant.heizungskostenVorschuss ?? tenant.heizungskosten_vorschuss ?? 0),
          status: tenant.status,
          mietbeginn: tenant.mietbeginn,
          mietende: tenant.mietende,
        },
        unit: unit ? {
          id: unit.id,
          top_nummer: unit.topNummer ?? unit.top_nummer,
          type: unit.type,
          property_id: unit.propertyId ?? unit.property_id,
        } : null,
        sollBk,
        sollHk,
        sollMiete,
        totalSoll,
        istBk,
        istHk,
        istMiete,
        totalIst,
        diffBk,
        diffHk,
        diffMiete,
        ueberzahlung,
        unterzahlung,
        saldo,
        oldestOverdueDays: daysOverdue,
        mahnstatus,
        status,
      };
    });

    // ====== LEERSTAND (Vacancy) Berechnung ======
    // Basiert auf Leerstand-Vorschreibungen (is_vacancy=true) als Datenquelle
    const vacancyAllocations: TenantAllocation[] = [];
    
    // Gruppiere Leerstand-Vorschreibungen nach Unit
    const vacancyInvoicesByUnit = new Map<string, typeof invoices>();
    
    invoices?.forEach(inv => {
      if ((inv as any).isVacancy === true || (inv as any).is_vacancy === true) {
        const unitId = (inv as any).unitId ?? (inv as any).unit_id;
        if (unitId && inv.year === year && inv.month <= monthCount) {
          const existing = vacancyInvoicesByUnit.get(unitId) || [];
          existing.push(inv);
          vacancyInvoicesByUnit.set(unitId, existing);
        }
      }
    });
    
    // Für jede Einheit mit Leerstand-Vorschreibungen
    for (const [unitId, unitVacancyInvoices] of vacancyInvoicesByUnit) {
      const unit = relevantUnits.find(u => u.id === unitId);
      if (!unit) continue;
      
      const vacancyMonths = unitVacancyInvoices.length;
      
      // SOLL: Aus Leerstand-Vorschreibungen (keine Miete bei Leerstand)
      const sollBk = unitVacancyInvoices.reduce((sum, inv) => {
        const bk = Number((inv as any).betriebskosten ?? (inv as any).betriebskostenVorschuss ?? 0);
        return sum + bk;
      }, 0);
      const sollHk = unitVacancyInvoices.reduce((sum, inv) => {
        const hk = Number((inv as any).heizungskosten ?? (inv as any).heizkostenVorschuss ?? (inv as any).heizkosten ?? 0);
        return sum + hk;
      }, 0);
      const sollMiete = 0;
      const totalSoll = sollBk + sollHk;
      
      // IST: Nutze paid_amount aus monthly_invoices
      // Verteile proportional auf BK und HK basierend auf SOLL-Anteilen
      const totalPaid = unitVacancyInvoices.reduce((sum, inv) => {
        const paid = Number((inv as any).paidAmount ?? (inv as any).paid_amount ?? 0);
        return sum + paid;
      }, 0);
      
      // Proportionale Verteilung: Wenn BK 60% vom SOLL ist, dann 60% von IST zu BK
      const sollTotal = sollBk + sollHk;
      const istBk = sollTotal > 0 ? (sollBk / sollTotal) * totalPaid : 0;
      const istHk = sollTotal > 0 ? (sollHk / sollTotal) * totalPaid : 0;
      const istMiete = 0;
      const totalIst = istBk + istHk;
      
      const diffBk = sollBk - istBk;
      const diffHk = sollHk - istHk;
      const diffMiete = 0;
      const saldo = totalSoll - totalIst;
      const unterzahlung = saldo > 0 ? saldo : 0;
      const ueberzahlung = saldo < 0 ? Math.abs(saldo) : 0;
      
      const status = saldo > 0.01 ? 'offen' : saldo < -0.01 ? 'ueberzahlt' : 'vollstaendig';
      
      vacancyAllocations.push({
        tenant: {
          id: `vacancy-${unitId}`,
          first_name: 'Leerstand',
          last_name: `(${vacancyMonths} ${vacancyMonths === 1 ? 'Monat' : 'Monate'})`,
          unit_id: unitId,
          grundmiete: 0,
          betriebskosten_vorschuss: sollBk / Math.max(vacancyMonths, 1),
          heizungskosten_vorschuss: sollHk / Math.max(vacancyMonths, 1),
          status: 'leerstand',
          mietbeginn: null,
          mietende: null,
        },
        unit: {
          id: unit.id,
          top_nummer: (unit as any).topNummer ?? (unit as any).top_nummer,
          type: (unit as any).type,
          property_id: (unit as any).propertyId ?? (unit as any).property_id,
        },
        sollBk,
        sollHk,
        sollMiete,
        totalSoll,
        istBk,
        istHk,
        istMiete,
        totalIst,
        diffBk,
        diffHk,
        diffMiete,
        ueberzahlung,
        unterzahlung,
        saldo,
        oldestOverdueDays: 0,
        mahnstatus: null,
        status,
      });
    }
    
    // Fallback: Einheiten mit Leerstand-Kosten aber ohne Vorschreibungen
    // Zeige erwartete Kosten basierend auf mieterlosen Monaten
    for (const unit of relevantUnits) {
      const unitId = unit.id;
      
      // Skip if already processed via invoices
      if (vacancyInvoicesByUnit.has(unitId)) continue;
      
      const unitLeerstandBk = Number((unit as any).leerstandBk ?? (unit as any).leerstand_bk ?? 0);
      const unitLeerstandHk = Number((unit as any).leerstandHk ?? (unit as any).leerstand_hk ?? 0);
      
      // Skip units without vacancy costs configured
      if (unitLeerstandBk === 0 && unitLeerstandHk === 0) continue;
      
      // Finde alle Monate ohne aktiven Mieter
      let vacancyMonths = 0;
      for (let month = 1; month <= monthCount; month++) {
        const activeTenants = getActiveTenantsForPeriod(
          [unit],
          tenants,
          selectedPropertyId,
          year,
          month
        );
        if (activeTenants.length === 0) {
          vacancyMonths++;
        }
      }
      
      if (vacancyMonths === 0) continue;
      
      // SOLL: Erwartete Leerstand-Kosten (Vorschreibung fehlt noch)
      const sollBk = unitLeerstandBk * vacancyMonths;
      const sollHk = unitLeerstandHk * vacancyMonths;
      const sollMiete = 0;
      const totalSoll = sollBk + sollHk;
      
      // IST: 0 (keine Vorschreibung = keine Zahlung zuordenbar)
      const istBk = 0;
      const istHk = 0;
      const totalIst = 0;
      
      const saldo = totalSoll;
      
      vacancyAllocations.push({
        tenant: {
          id: `vacancy-${unitId}`,
          first_name: 'Leerstand',
          last_name: `(${vacancyMonths} Mon. - keine Vorschr.)`,
          unit_id: unitId,
          grundmiete: 0,
          betriebskosten_vorschuss: unitLeerstandBk,
          heizungskosten_vorschuss: unitLeerstandHk,
          status: 'leerstand',
          mietbeginn: null,
          mietende: null,
        },
        unit: {
          id: unit.id,
          top_nummer: (unit as any).topNummer ?? (unit as any).top_nummer,
          type: (unit as any).type,
          property_id: (unit as any).propertyId ?? (unit as any).property_id,
        },
        sollBk,
        sollHk,
        sollMiete,
        totalSoll,
        istBk,
        istHk,
        istMiete: 0,
        totalIst,
        diffBk: sollBk,
        diffHk: sollHk,
        diffMiete: 0,
        ueberzahlung: 0,
        unterzahlung: saldo,
        saldo,
        oldestOverdueDays: 0,
        mahnstatus: null,
        status: 'offen',
      });
    }
    
    // Combine tenant allocations with invoice-based vacancy allocations only
    // (Fallback estimated entries werden später zur Anzeige hinzugefügt)
    const invoiceBasedVacancies = vacancyAllocations.filter(v => 
      !v.tenant.last_name?.includes('keine Vorschr.')
    );
    const estimatedVacancies = vacancyAllocations.filter(v => 
      v.tenant.last_name?.includes('keine Vorschr.')
    );
    
    allocations.push(...invoiceBasedVacancies);

    // Sort by saldo descending (most underpayment first, then show overpayments)
    allocations.sort((a, b) => b.saldo - a.saldo);

    // Calculate totals (NUR aus Mieter + invoice-basierte Leerstand-Einträge)
    const totals = allocations.reduce((acc, a) => ({
      sollBk: acc.sollBk + a.sollBk,
      sollHk: acc.sollHk + a.sollHk,
      sollMiete: acc.sollMiete + a.sollMiete,
      totalSoll: acc.totalSoll + a.totalSoll,
      istBk: acc.istBk + a.istBk,
      istHk: acc.istHk + a.istHk,
      istMiete: acc.istMiete + a.istMiete,
      totalIst: acc.totalIst + a.totalIst,
      totalUnterzahlung: acc.totalUnterzahlung + a.unterzahlung,
      totalUeberzahlung: acc.totalUeberzahlung + a.ueberzahlung,
      saldo: acc.saldo + a.saldo,
      paymentCount: acc.paymentCount,
    }), {
      sollBk: 0, sollHk: 0, sollMiete: 0, totalSoll: 0,
      istBk: 0, istHk: 0, istMiete: 0, totalIst: 0,
      totalUnterzahlung: 0, totalUeberzahlung: 0, saldo: 0,
      paymentCount: yearPayments.length,
    });
    
    // Geschätzte Leerstand-Einträge am Ende hinzufügen (nicht in Totals enthalten)
    allocations.push(...estimatedVacancies);

    return { allocations, totals };
  }, [tenants, units, combinedPayments, selectedPropertyId, year, monthCount]);

  return { ...result, isLoading };
}
