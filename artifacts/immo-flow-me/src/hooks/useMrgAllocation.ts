import { useMemo } from 'react';
import { useTenants } from './useTenants';
import { useUnits } from './useUnits';
import { useCombinedPayments } from './useCombinedPayments';
import { getActiveTenantsForPeriod } from '@/utils/tenantFilterUtils';

/**
 * MRG-konforme Zahlungsaufteilung pro Mieter
 * Priorität: BK → HK → Miete
 */
export interface TenantAllocation {
  tenant: {
    id: string;
    first_name: string;
    last_name: string;
    unit_id: string;
    grundmiete: number;
    betriebskosten_vorschuss: number;
    heizungskosten_vorschuss: number;
    status: string;
    mietbeginn: string;
    mietende?: string | null;
  };
  unit: {
    id: string;
    top_nummer: string;
    type: string;
    property_id: string;
  } | null;
  // SOLL-Werte (aus Mieterstammdaten)
  sollBk: number;
  sollHk: number;
  sollMiete: number;
  totalSoll: number;
  // IST-Werte (MRG-konform aufgeteilt)
  istBk: number;
  istHk: number;
  istMiete: number;
  totalIst: number;
  // Differenzen
  diffBk: number;
  diffHk: number;
  diffMiete: number;
  // Saldo
  ueberzahlung: number;
  unterzahlung: number;
  saldo: number;  // positiv = Überzahlung, negativ = Unterzahlung
  // Mahnstatus
  oldestOverdueDays: number;
  mahnstatus: 'aktuell' | 'Zahlungserinnerung' | '1. Mahnung' | '2. Mahnung';
  // Status
  status: 'vollstaendig' | 'teilbezahlt' | 'offen' | 'ueberzahlt';
}

export interface MrgAllocationResult {
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
 * Berechnet MRG-konforme Zahlungsaufteilung für einen Mieter
 * Priorität: BK → HK → Miete
 */
export function calculateMrgAllocation(
  sollBk: number,
  sollHk: number,
  sollMiete: number,
  totalIst: number
): {
  istBk: number;
  istHk: number;
  istMiete: number;
  ueberzahlung: number;
  unterzahlung: number;
} {
  // MRG-konforme Aufteilung: BK → HK → Miete
  let remaining = totalIst;
  
  const istBk = Math.min(remaining, sollBk);
  remaining -= istBk;
  
  const istHk = Math.min(remaining, sollHk);
  remaining -= istHk;
  
  const istMiete = Math.min(remaining, sollMiete);
  remaining -= istMiete;
  
  // Überzahlung (wenn mehr gezahlt als Gesamt-SOLL)
  const ueberzahlung = remaining > 0 ? remaining : 0;
  
  // Unterzahlung pro Komponente
  const diffBk = sollBk - istBk;
  const diffHk = sollHk - istHk;
  const diffMiete = sollMiete - istMiete;
  const unterzahlung = diffBk + diffHk + diffMiete;
  
  return { istBk, istHk, istMiete, ueberzahlung, unterzahlung };
}

/**
 * Hook für MRG-konforme SOLL/IST-Berechnung pro Mieter
 * Wird von PaymentList.tsx, Reports.tsx und PDF-Exporten verwendet
 */
export function useMrgAllocation(
  selectedPropertyId: string = 'all',
  year: number,
  month: number
): MrgAllocationResult {
  const { data: tenants, isLoading: tenantsLoading } = useTenants();
  const { data: units, isLoading: unitsLoading } = useUnits();
  const { data: combinedPayments, isLoading: paymentsLoading } = useCombinedPayments();

  const isLoading = tenantsLoading || unitsLoading || paymentsLoading;

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

    // Filter units by property
    const propertyUnitIds = selectedPropertyId === 'all'
      ? null
      : units.filter(u => u.property_id === selectedPropertyId).map(u => u.id);

    const relevantUnits = propertyUnitIds
      ? units.filter(u => propertyUnitIds.includes(u.id))
      : units;

    // Get active tenants for the period
    const activeTenants = getActiveTenantsForPeriod(
      relevantUnits,
      tenants,
      selectedPropertyId,
      year,
      month
    );

    // Filter payments for this period
    const periodPayments = combinedPayments.filter(p => {
      const date = new Date(p.date);
      if (date.getFullYear() !== year || date.getMonth() + 1 !== month) return false;
      
      // Filter by property if selected
      if (propertyUnitIds) {
        const tenant = tenants.find(t => t.id === p.tenant_id);
        return tenant && propertyUnitIds.includes(tenant.unit_id);
      }
      return true;
    });

    const allocations: TenantAllocation[] = activeTenants.map((tenant: any) => {
      // SOLL from tenant data
      const sollBk = Number(tenant.betriebskosten_vorschuss || 0);
      const sollHk = Number(tenant.heizungskosten_vorschuss || 0);
      const sollMiete = Number(tenant.grundmiete || 0);
      const totalSoll = sollBk + sollHk + sollMiete;

      // IST from combined payments for this tenant and period
      const tenantPayments = periodPayments.filter(p => p.tenant_id === tenant.id);
      const totalIst = tenantPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

      // MRG-konforme Aufteilung
      const { istBk, istHk, istMiete, ueberzahlung, unterzahlung } = 
        calculateMrgAllocation(sollBk, sollHk, sollMiete, totalIst);

      // Differenzen
      const diffBk = sollBk - istBk;
      const diffHk = sollHk - istHk;
      const diffMiete = sollMiete - istMiete;

      // Saldo: positiv = Unterzahlung (offene Forderung), negativ = Überzahlung (Guthaben)
      // Standard österreichische Buchhaltung: Saldo = SOLL - IST
      const saldo = totalSoll - totalIst;

      // Days overdue: if we're past the 5th of the month and saldo is positive (underpayment)
      const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
      const daysOverdue = isCurrentMonth && saldo > 0 && dayOfMonth > 5 ? dayOfMonth - 5 : 0;

      // Determine Mahnstatus based on days overdue
      let mahnstatus: 'aktuell' | 'Zahlungserinnerung' | '1. Mahnung' | '2. Mahnung' = 'aktuell';
      if (daysOverdue > 30) {
        mahnstatus = '2. Mahnung';
      } else if (daysOverdue > 14) {
        mahnstatus = '1. Mahnung';
      } else if (daysOverdue > 0) {
        mahnstatus = 'Zahlungserinnerung';
      }

      // Status: basierend auf Saldo (positiv = Unterzahlung, negativ = Überzahlung)
      let status: 'vollstaendig' | 'teilbezahlt' | 'offen' | 'ueberzahlt' = 'offen';
      if (saldo < 0) {
        status = 'ueberzahlt';
      } else if (saldo === 0 && totalIst > 0) {
        status = 'vollstaendig';
      } else if (totalIst > 0 && saldo > 0) {
        status = 'teilbezahlt';
      }

      const unit = units.find(u => u.id === tenant.unit_id) || null;

      return {
        tenant: {
          id: tenant.id,
          first_name: tenant.first_name,
          last_name: tenant.last_name,
          unit_id: tenant.unit_id,
          grundmiete: tenant.grundmiete,
          betriebskosten_vorschuss: tenant.betriebskosten_vorschuss,
          heizungskosten_vorschuss: tenant.heizungskosten_vorschuss,
          status: tenant.status,
          mietbeginn: tenant.mietbeginn,
          mietende: tenant.mietende,
        },
        unit: unit ? {
          id: unit.id,
          top_nummer: unit.top_nummer,
          type: unit.type,
          property_id: unit.property_id,
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

    // Sort by saldo ascending (most debt first)
    allocations.sort((a, b) => a.saldo - b.saldo);

    // Calculate totals
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
      paymentCount: periodPayments.length,
    });

    return { allocations, totals };
  }, [tenants, units, combinedPayments, selectedPropertyId, year, month]);

  return { ...result, isLoading };
}

/**
 * Berechnet MRG-Aufteilung aus übergebenen Daten (für PDF-Export)
 * Ohne React-Hooks, kann direkt aufgerufen werden
 */
export function calculateMrgAllocationsFromData(
  activeTenants: {
    id: string;
    first_name: string;
    last_name: string;
    unit_id: string;
    grundmiete: number;
    betriebskosten_vorschuss: number;
    heizungskosten_vorschuss: number;
    status: string;
    mietbeginn: string;
    mietende?: string | null;
  }[],
  units: {
    id: string;
    top_nummer: string;
    type: string;
    property_id: string;
  }[],
  payments: {
    tenant_id: string;
    amount: number;
    date: string;
  }[],
  year: number,
  month: number
): TenantAllocation[] {
  const now = new Date();
  const dayOfMonth = now.getDate();

  return activeTenants.map(tenant => {
    const sollBk = Number(tenant.betriebskosten_vorschuss || 0);
    const sollHk = Number(tenant.heizungskosten_vorschuss || 0);
    const sollMiete = Number(tenant.grundmiete || 0);
    const totalSoll = sollBk + sollHk + sollMiete;

    const tenantPayments = payments.filter(p => p.tenant_id === tenant.id);
    const totalIst = tenantPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const { istBk, istHk, istMiete, ueberzahlung, unterzahlung } = 
      calculateMrgAllocation(sollBk, sollHk, sollMiete, totalIst);

    const diffBk = sollBk - istBk;
    const diffHk = sollHk - istHk;
    const diffMiete = sollMiete - istMiete;
    // Saldo: positiv = Unterzahlung (offene Forderung), negativ = Überzahlung
    const saldo = totalSoll - totalIst;

    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
    const daysOverdue = isCurrentMonth && saldo > 0 && dayOfMonth > 5 ? dayOfMonth - 5 : 0;

    let mahnstatus: 'aktuell' | 'Zahlungserinnerung' | '1. Mahnung' | '2. Mahnung' = 'aktuell';
    if (daysOverdue > 30) mahnstatus = '2. Mahnung';
    else if (daysOverdue > 14) mahnstatus = '1. Mahnung';
    else if (daysOverdue > 0) mahnstatus = 'Zahlungserinnerung';

    let status: 'vollstaendig' | 'teilbezahlt' | 'offen' | 'ueberzahlt' = 'offen';
    if (saldo < 0) status = 'ueberzahlt';
    else if (saldo === 0 && totalIst > 0) status = 'vollstaendig';
    else if (totalIst > 0 && saldo > 0) status = 'teilbezahlt';

    const unit = units.find(u => u.id === tenant.unit_id) || null;

    return {
      tenant: {
        id: tenant.id,
        first_name: tenant.first_name,
        last_name: tenant.last_name,
        unit_id: tenant.unit_id,
        grundmiete: tenant.grundmiete,
        betriebskosten_vorschuss: tenant.betriebskosten_vorschuss,
        heizungskosten_vorschuss: tenant.heizungskosten_vorschuss,
        status: tenant.status,
        mietbeginn: tenant.mietbeginn,
        mietende: tenant.mietende,
      },
      unit: unit ? {
        id: unit.id,
        top_nummer: unit.top_nummer,
        type: unit.type,
        property_id: unit.property_id,
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
  }).sort((a, b) => a.saldo - b.saldo);
}
