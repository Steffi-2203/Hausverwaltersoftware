// Verteilerschlüssel (Distribution Keys)
export type DistributionKeyType = 
  | 'qm' // Quadratmeter
  | 'mea' // Miteigentumsanteile
  | 'personen' // Personenanzahl
  | 'heizung_verbrauch' // Heizungsverbrauch
  | 'wasser_verbrauch' // Wasserverbrauch
  | 'lift_wohnung' // Liftkosten Wohnung
  | 'lift_geschaeft' // Liftkosten Geschäft
  | 'muell' // Müllentsorgung
  | 'strom_allgemein' // Allgemeinstrom
  | 'versicherung' // Versicherung
  | 'hausbetreuung' // Hausbetreuung
  | 'garten' // Gartenpflege
  | 'schneeraeumung' // Schneeräumung
  | 'kanal' // Kanalgebühren
  | 'grundsteuer' // Grundsteuer
  | 'verwaltung' // Verwaltungskosten
  | 'ruecklage' // Rücklage
  | 'sonstiges_1' // Sonstiges 1
  | 'sonstiges_2' // Sonstiges 2
  | 'sonstiges_3'; // Sonstiges 3

export interface DistributionKey {
  id: DistributionKeyType;
  name: string;
  unit: string;
  description?: string;
}

// Einheitentyp
export type UnitType = 'wohnung' | 'geschaeft' | 'garage' | 'stellplatz' | 'lager' | 'sonstiges';

// Mieterstatus
export type TenantStatus = 'aktiv' | 'leerstand' | 'beendet';

// Liegenschaft (Property)
export interface Property {
  id: string;
  name: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  buildingYear?: number;
  totalUnits: number;
  totalQm: number;
  totalMea: number;
  // Betriebskosten pro Einheitentyp (in Prozent)
  bkAnteilWohnung: number; // 10%
  bkAnteilGeschaeft: number; // 20%
  bkAnteilGarage: number; // 20%
  heizungAnteilWohnung: number; // 20%
  heizungAnteilGeschaeft: number; // 20%
  // Gesamtbetriebskosten
  betriebskostenGesamt: number;
  heizungskostenGesamt: number;
  // Dokumente
  documents?: PropertyDocument[];
  createdAt: Date;
  updatedAt: Date;
}

// Einheit (Unit)
export interface Unit {
  id: string;
  propertyId: string;
  topNummer: string; // Top-Nummer z.B. "Top 1", "Top 2a"
  type: UnitType;
  floor?: number;
  qm: number;
  mea: number; // Miteigentumsanteile in Promille
  // Verteilerschlüssel-Werte
  distributionValues: Record<DistributionKeyType, number>;
  // Aktueller Mieter
  currentTenantId?: string;
  // Status
  status: TenantStatus;
  // Dokumente
  documents?: UnitDocument[];
  createdAt: Date;
  updatedAt: Date;
}

// Mieter (Tenant)
export interface Tenant {
  id: string;
  unitId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  // Mietdaten
  mietbeginn: Date;
  mietende?: Date;
  kaution: number;
  kautionBezahlt: boolean;
  // Monatliche Miete
  grundmiete: number;
  betriebskostenVorschuss: number;
  heizungskostenVorschuss: number;
  // SEPA Lastschrift
  sepaMandat: boolean;
  iban?: string;
  bic?: string;
  mandatReference?: string;
  // Status
  status: TenantStatus;
  createdAt: Date;
  updatedAt: Date;
}

// Dokumente
export interface PropertyDocument {
  id: string;
  propertyId: string;
  name: string;
  type: 'energieausweis' | 'grundbuch' | 'bauplan' | 'versicherung' | 'sonstiges';
  fileUrl: string;
  uploadedAt: Date;
}

export interface UnitDocument {
  id: string;
  unitId: string;
  name: string;
  type: 'mietvertrag' | 'plan' | 'mietanbot' | 'uebergabe' | 'sonstiges';
  fileUrl: string;
  uploadedAt: Date;
}

// Vorschreibung (Monthly Invoice)
export interface MonthlyInvoice {
  id: string;
  tenantId: string;
  unitId: string;
  year: number;
  month: number;
  grundmiete: number;
  betriebskosten: number;
  heizungskosten: number;
  gesamtbetrag: number;
  ust: number; // Umsatzsteuer
  status: 'offen' | 'bezahlt' | 'teilbezahlt' | 'ueberfaellig';
  faelligAm: Date;
  bezahltAm?: Date;
  createdAt: Date;
}

// Zahlungseingang (Payment)
export interface Payment {
  id: string;
  tenantId: string;
  invoiceId?: string;
  betrag: number;
  zahlungsart: 'sepa' | 'ueberweisung' | 'bar' | 'sonstiges';
  referenz?: string; // Top-Nummer für automatische Zuordnung
  eingangsDatum: Date;
  buchungsDatum: Date;
  createdAt: Date;
}

// Betriebskostenabrechnung
export interface OperatingCostSettlement {
  id: string;
  propertyId: string;
  year: number;
  status: 'entwurf' | 'berechnet' | 'versendet' | 'abgeschlossen';
  gesamtkosten: number;
  createdAt: Date;
  updatedAt: Date;
}

// Dashboard-Statistiken
export interface DashboardStats {
  totalProperties: number;
  totalUnits: number;
  occupiedUnits: number;
  vacantUnits: number;
  totalTenants: number;
  monthlyRevenue: number;
  monthlyBetriebskosten: number;
  openInvoices: number;
  overdueAmount: number;
}
