/**
 * Zentrale Utility-Funktionen für die Mieter-Filterung
 * Stellt sicher, dass SOLL-Berechnungen in allen Reports konsistent sind
 */

export interface TenantForFilter {
  id: string;
  unit_id?: string;
  unitId?: string;
  status: string;
  mietbeginn?: string | null;
  mietBeginn?: string | null;
  mietende?: string | null;
  mietEnde?: string | null;
  grundmiete?: number | string;
  grundMiete?: number | string;
  betriebskosten_vorschuss?: number | string;
  betriebskostenVorschuss?: number | string;
  heizungskosten_vorschuss?: number | string;
  heizungskostenVorschuss?: number | string;
  heizkostenVorschuss?: number | string;
  first_name?: string;
  firstName?: string;
  last_name?: string;
  lastName?: string;
  vorname?: string;
  nachname?: string;
}

interface UnitForFilter {
  id: string;
  property_id?: string;
  propertyId?: string;
}

// Helper to get unit_id from tenant (supports both formats)
function getTenantUnitId(t: TenantForFilter): string {
  return t.unit_id ?? t.unitId ?? '';
}

// Helper to get property_id from unit (supports both formats)
function getUnitPropertyId(u: UnitForFilter): string {
  return u.property_id ?? u.propertyId ?? '';
}

/**
 * Prüft ob ein Mieter im gegebenen Zeitraum für SOLL-Berechnungen relevant ist
 * 
 * Regeln:
 * - Mieter muss Status 'aktiv' ODER 'beendet' haben (nicht 'leerstand')
 * - Mietbeginn muss VOR oder IM Zeitraum liegen (Mieter mit späterem Mietbeginn werden ausgeschlossen)
 * - Bei 'beendet' Mietern: Mietende muss im oder nach dem Zeitraum liegen
 *   (damit ehemalige Mieter für historische Perioden berücksichtigt werden)
 */
export function isTenantActiveInPeriod(
  tenant: TenantForFilter,
  periodYear: number,
  periodMonth?: number // undefined = yearly
): boolean {
  // Normalize status (support various formats)
  const status = (tenant.status || '').toLowerCase().trim();
  
  // Leerstand/vacancy ist nie relevant
  if (status === 'leerstand' || status === 'vacancy' || status === 'inactive') return false;
  
  // Mietbeginn prüfen - Mieter ist nur relevant wenn Mietbeginn <= Ende des Zeitraums
  const mietbeginnStr = tenant.mietbeginn || tenant.mietBeginn;
  if (mietbeginnStr) {
    const mietbeginn = new Date(mietbeginnStr);
    if (!isNaN(mietbeginn.getTime())) {
      const mietbeginnYear = mietbeginn.getFullYear();
      const mietbeginnMonth = mietbeginn.getMonth() + 1;
      
      if (periodMonth === undefined) {
        // Yearly: Mietbeginn muss im Jahr oder früher sein
        if (mietbeginnYear > periodYear) return false;
      } else {
        // Monthly: Mietbeginn muss im Monat oder früher sein
        if (mietbeginnYear > periodYear) return false;
        if (mietbeginnYear === periodYear && mietbeginnMonth > periodMonth) return false;
      }
    }
  }
  
  // Aktive Mieter sind relevant (support various status values)
  if (status === 'aktiv' || status === 'active' || status === '') return true;
  
  // Beendete Mieter: Mietende muss im oder nach dem Zeitraum liegen
  const mietendeStr = tenant.mietende || tenant.mietEnde;
  if ((status === 'beendet' || status === 'ended' || status === 'terminated') && mietendeStr) {
    const mietende = new Date(mietendeStr);
    if (!isNaN(mietende.getTime())) {
      const mietendeYear = mietende.getFullYear();
      const mietendeMonth = mietende.getMonth() + 1;
      
      if (periodMonth === undefined) {
        // Yearly: Mietende muss im Jahr oder später sein
        return mietendeYear >= periodYear;
      } else {
        // Monthly: Mietende muss im Monat oder später sein
        if (mietendeYear > periodYear) return true;
        if (mietendeYear === periodYear && mietendeMonth >= periodMonth) return true;
        return false;
      }
    }
  }
  
  // Default: Mieter ohne expliziten Status als aktiv behandeln
  return true;
}

/**
 * Gibt alle relevanten Mieter pro Unit zurück, gefiltert nach Periode
 * 
 * Wichtig:
 * - Pro Unit kann nur EIN Mieter im Zeitraum aktiv gewesen sein
 * - Aktive UND beendete Mieter werden berücksichtigt (für historische Perioden)
 * - Mietbeginn muss VOR oder IM Zeitraum liegen (Mieter mit späterem Mietbeginn ausgeschlossen)
 * - Bei beendeten Mietern: Mietende muss im oder nach dem Zeitraum liegen
 * - Ein Mieter kann mehrere Units haben (z.B. Geschäft + Garage)
 */
export function getActiveTenantsForPeriod<T extends TenantForFilter>(
  units: UnitForFilter[],
  tenants: T[],
  propertyId: string | 'all',
  periodYear: number,
  periodMonth?: number
): T[] {
  // Filter Units nach Property (supports both property_id and propertyId)
  const relevantUnits = propertyId === 'all' 
    ? units 
    : units.filter(u => getUnitPropertyId(u) === propertyId);
  
  const relevantTenants: T[] = [];
  
  // Für jede Unit: Finde Mieter die im Zeitraum aktiv waren
  relevantUnits.forEach(unit => {
    // Alle Mieter dieser Unit die im Zeitraum aktiv waren (supports both unit_id and unitId)
    const unitTenants = tenants.filter(t => 
      getTenantUnitId(t) === unit.id && isTenantActiveInPeriod(t, periodYear, periodMonth)
    );
    
    // Normalerweise sollte nur ein Mieter pro Unit im Zeitraum aktiv sein
    // Bei Überschneidungen (sollte nicht passieren) nehmen wir den aktiven zuerst
    unitTenants.sort((a, b) => {
      if (a.status === 'aktiv' && b.status !== 'aktiv') return -1;
      if (a.status !== 'aktiv' && b.status === 'aktiv') return 1;
      return 0;
    });
    
    if (unitTenants.length > 0) {
      relevantTenants.push(unitTenants[0]);
    }
  });
  
  return relevantTenants;
}

/**
 * Berechnet die monatliche Gesamtmiete eines Mieters
 * Supports both camelCase and snake_case field names
 */
export function calculateMonthlyRent(tenant: TenantForFilter): number {
  const grundmiete = Number(tenant.grundmiete || 0);
  const bk = Number(tenant.betriebskosten_vorschuss ?? tenant.betriebskostenVorschuss ?? 0);
  // Schema uses heizkostenVorschuss (without "ungs"), also support alternative spellings
  const hk = Number(tenant.heizkostenVorschuss ?? tenant.heizungskosten_vorschuss ?? tenant.heizungskostenVorschuss ?? 0);
  return grundmiete + bk + hk;
}

/**
 * Helper to get tenant's first name (supports both formats)
 */
export function getTenantFirstName(tenant: TenantForFilter): string {
  return tenant.first_name ?? tenant.firstName ?? tenant.vorname ?? '';
}

/**
 * Helper to get tenant's last name (supports both formats)
 */
export function getTenantLastName(tenant: TenantForFilter): string {
  return tenant.last_name ?? tenant.lastName ?? tenant.nachname ?? '';
}

/**
 * Helper to get tenant's full name
 */
export function getTenantFullName(tenant: TenantForFilter): string {
  return `${getTenantFirstName(tenant)} ${getTenantLastName(tenant)}`.trim();
}
