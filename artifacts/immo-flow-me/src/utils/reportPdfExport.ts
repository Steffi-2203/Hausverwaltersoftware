import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getActiveTenantsForPeriod } from './tenantFilterUtils';
import { calculateTenantSollIst, calculateSollIstTotals, type TenantSollIstResult } from './sollIstCalculation';

// Extend jsPDF type to include autoTable
declare module 'jspdf' {
  interface jsPDF {
    autoTable: typeof autoTable;
    lastAutoTable: { finalY: number };
  }
}

interface PropertyData {
  id: string;
  name: string;
  address: string;
  city: string;
  postal_code: string;
  total_qm: number;
  total_units: number;
}

interface UnitData {
  id: string;
  top_nummer: string;
  type: string;
  qm: number;
  mea: number;
  status: string;
  property_id: string;
}

interface TenantData {
  id: string;
  first_name: string;
  last_name: string;
  unit_id: string;
  grundmiete: number;
  betriebskosten_vorschuss: number;
  heizungskosten_vorschuss: number;
  status: string;
  mietbeginn: string | null;
  mietende?: string | null;
}

interface InvoiceData {
  id: string;
  tenant_id: string;
  unit_id: string;
  year: number;
  month: number;
  grundmiete: number;
  betriebskosten: number;
  heizungskosten: number;
  gesamtbetrag: number;
  ust: number;
  ust_satz_miete: number;
  ust_satz_bk: number;
  ust_satz_heizung: number;
}

interface ExpenseData {
  id: string;
  bezeichnung: string;
  betrag: number;
  category: string;
  expense_type: string;
  property_id: string;
  year: number;
  month: number;
  datum: string;
}

export interface PaymentData {
  id: string;
  tenant_id: string;
  betrag: number;
  eingangs_datum: string;
  buchungs_datum: string;
  invoice_id?: string | null;
}

export interface TransactionData {
  id: string;
  amount: number;
  transaction_date: string;
  category_id: string | null;
  property_id: string | null;
  unit_id: string | null;
  description: string | null;
  tenant_id?: string | null;
  bank_account_id?: string | null;
}

export interface CategoryData {
  id: string;
  name: string;
  type: string;
}

// Kategorien für Instandhaltung (mindern Rendite)
const INSTANDHALTUNG_CATEGORIES = ['Instandhaltung', 'Reparaturen'];

// Kategorien für Sonstige Kosten (weder umlagefähig noch renditemindernd)
const SONSTIGE_KOSTEN_CATEGORIES = ['Sonstige Kosten', 'Makler', 'Notar', 'Grundbuch', 'Finanzierung'];

// USt-Sätze pro Ausgabenkategorie (österreichische Regelung)
const CATEGORY_VAT_RATES: Record<string, number> = {
  // 20% Normalsteuersatz
  'Lift/Aufzug': 20,
  'Heizung': 20,
  'Strom Allgemein': 20,
  'Hausbetreuung/Reinigung': 20,
  'Gartenpflege': 20,
  'Schneeräumung': 20,
  'Verwaltungskosten': 20,
  'Instandhaltung': 20,
  'Reparaturen': 20,
  'Müllabfuhr': 20,
  'Sonstige Ausgaben': 20,
  
  // 10% ermäßigter Steuersatz
  'Wasser/Abwasser': 10,
  
  // 0% - Keine Vorsteuer
  'Versicherungen': 0,  // Versicherungssteuer ist keine Vorsteuer
  'Grundsteuer': 0,     // Keine USt auf Grundsteuer
};

const unitTypeLabels: Record<string, string> = {
  wohnung: 'Wohnung',
  geschaeft: 'Geschäft',
  garage: 'Garage',
  stellplatz: 'Stellplatz',
  lager: 'Lager',
  sonstiges: 'Sonstiges',
};

const monthNames = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

// Helper functions
const calculateNetFromGross = (gross: number, vatRate: number): number => {
  if (vatRate === 0) return gross;
  return gross / (1 + vatRate / 100);
};

const calculateVatFromGross = (gross: number, vatRate: number): number => {
  if (vatRate === 0) return 0;
  return gross - (gross / (1 + vatRate / 100));
};

const formatCurrency = (value: number): string => {
  return `€ ${value.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatPercent = (value: number): string => {
  return `${value.toFixed(1)}%`;
};

// PDF Helper
const addHeader = (doc: jsPDF, title: string, subtitle: string, propertyName?: string) => {
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, 20);
  
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(subtitle, 14, 28);
  
  if (propertyName) {
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Liegenschaft: ${propertyName}`, 14, 35);
    doc.setTextColor(0);
  }
  
  // Date
  doc.setFontSize(9);
  doc.setTextColor(128);
  doc.text(`Erstellt am: ${new Date().toLocaleDateString('de-AT')}`, doc.internal.pageSize.width - 14, 20, { align: 'right' });
  doc.setTextColor(0);
};

// ====== RENDITE REPORT ======
export const generateRenditeReport = (
  properties: PropertyData[],
  units: UnitData[],
  invoices: InvoiceData[],
  transactions: TransactionData[],
  categories: CategoryData[],
  selectedPropertyId: string,
  selectedYear: number,
  reportPeriod: 'monthly' | 'quarterly' | 'halfyearly' | 'yearly',
  selectedMonth?: number,
  expenses?: ExpenseData[]
) => {
  const doc = new jsPDF();
  const periodLabel = reportPeriod === 'yearly' 
    ? `Jahr ${selectedYear}` 
    : reportPeriod === 'quarterly'
    ? `Quartal ${selectedYear}`
    : reportPeriod === 'halfyearly'
    ? `Halbjahr ${selectedYear}`
    : `${monthNames[(selectedMonth || 1) - 1]} ${selectedYear}`;
  
  const selectedProperty = properties.find(p => p.id === selectedPropertyId);
  
  addHeader(
    doc, 
    'Renditereport', 
    periodLabel,
    selectedPropertyId !== 'all' ? selectedProperty?.name : 'Alle Liegenschaften'
  );

  // Filter properties
  const targetProperties = selectedPropertyId === 'all' ? properties : properties.filter(p => p.id === selectedPropertyId);

  // Get category IDs for income and maintenance
  const mieteinnahmenCategoryId = categories.find(c => c.name === 'Mieteinnahmen')?.id;
  const instandhaltungCategoryIds = categories
    .filter(c => INSTANDHALTUNG_CATEGORIES.includes(c.name))
    .map(c => c.id);
  
  // Calculate data per property
  const tableData = targetProperties.map(property => {
    const propertyUnits = units.filter(u => u.property_id === property.id);
    
    // Filter transactions for this property and period
    const propertyTransactions = transactions.filter(t => {
      const date = new Date(t.transaction_date);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const matchesProp = t.property_id === property.id;
      
      if (reportPeriod === 'yearly') {
        return matchesProp && year === selectedYear;
      }
      return matchesProp && year === selectedYear && month === selectedMonth;
    });

    // Calculate income from transactions
    const mieteinnahmen = propertyTransactions
      .filter(t => t.amount > 0 && t.category_id === mieteinnahmenCategoryId)
      .reduce((sum, t) => sum + Number(t.amount), 0);

    // Calculate maintenance costs from transactions
    const instandhaltungFromTransactions = propertyTransactions
      .filter(t => t.amount < 0 && instandhaltungCategoryIds.includes(t.category_id || ''))
      .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);

    // Calculate maintenance costs from expenses (Kosten & Belege)
    const propertyExpenses = (expenses || []).filter(e => {
      const date = new Date(e.datum);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const matchesProp = e.property_id === property.id;
      
      if (reportPeriod === 'yearly') {
        return matchesProp && year === selectedYear;
      }
      return matchesProp && year === selectedYear && month === selectedMonth;
    });
    
    const expenseTypeToInstandhaltung = ['reparatur', 'sanierung'];
    const instandhaltungFromExpenses = propertyExpenses
      .filter(e => e.category === 'instandhaltung' || expenseTypeToInstandhaltung.includes(e.expense_type))
      .reduce((sum, e) => sum + Number(e.betrag), 0);
    
    // Combined maintenance costs (Banking + Belege)
    const instandhaltung = instandhaltungFromTransactions + instandhaltungFromExpenses;

    // Nettoertrag = Mieteinnahmen - Instandhaltung (absoluter Wert, keine Division)
    const nettoertrag = mieteinnahmen - instandhaltung;
    const vacantUnits = propertyUnits.filter(u => u.status === 'leerstand').length;
    const occupancyRate = propertyUnits.length > 0 ? ((propertyUnits.length - vacantUnits) / propertyUnits.length) * 100 : 0;
    
    return [
      property.name,
      `${Number(property.total_qm).toLocaleString('de-AT')} m²`,
      property.total_units.toString(),
      formatCurrency(mieteinnahmen),
      formatCurrency(instandhaltung),
      formatCurrency(nettoertrag),
      formatPercent(occupancyRate),
    ];
  });

  // Total row
  const totalQm = targetProperties.reduce((sum, p) => sum + Number(p.total_qm), 0);
  const totalUnits = targetProperties.reduce((sum, p) => sum + p.total_units, 0);
  
  // Calculate totals from transactions
  const allPropertyIds = targetProperties.map(p => p.id);
  const allPeriodTransactions = transactions.filter(t => {
    const date = new Date(t.transaction_date);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const matchesProp = allPropertyIds.includes(t.property_id || '');
    
    if (reportPeriod === 'yearly') {
      return matchesProp && year === selectedYear;
    }
    return matchesProp && year === selectedYear && month === selectedMonth;
  });

  const totalMieteinnahmen = allPeriodTransactions
    .filter(t => t.amount > 0 && t.category_id === mieteinnahmenCategoryId)
    .reduce((sum, t) => sum + Number(t.amount), 0);
  const totalInstandhaltungFromTransactions = allPeriodTransactions
    .filter(t => t.amount < 0 && instandhaltungCategoryIds.includes(t.category_id || ''))
    .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
  
  // Total maintenance from expenses
  const allPeriodExpenses = (expenses || []).filter(e => {
    const date = new Date(e.datum);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const matchesProp = allPropertyIds.includes(e.property_id);
    
    if (reportPeriod === 'yearly') {
      return matchesProp && year === selectedYear;
    }
    return matchesProp && year === selectedYear && month === selectedMonth;
  });
  
  const expenseTypeToInstandhaltungTotal = ['reparatur', 'sanierung'];
  const totalInstandhaltungFromExpenses = allPeriodExpenses
    .filter(e => e.category === 'instandhaltung' || expenseTypeToInstandhaltungTotal.includes(e.expense_type))
    .reduce((sum, e) => sum + Number(e.betrag), 0);
  
  const totalInstandhaltung = totalInstandhaltungFromTransactions + totalInstandhaltungFromExpenses;
  const totalNettoertrag = totalMieteinnahmen - totalInstandhaltung;
  autoTable(doc, {
    startY: 45,
    head: [['Liegenschaft', 'Fläche', 'Einheiten', 'Mieteinnahmen', 'Instandhaltung', 'Nettoertrag', 'Belegung']],
    body: tableData,
    foot: [['Gesamt', `${totalQm.toLocaleString('de-AT')} m²`, totalUnits.toString(), formatCurrency(totalMieteinnahmen), formatCurrency(totalInstandhaltung), formatCurrency(totalNettoertrag), '-']],
    theme: 'striped',
    headStyles: { fillColor: [59, 130, 246], fontSize: 8 },
    footStyles: { fillColor: [229, 231, 235], textColor: [0, 0, 0], fontStyle: 'bold' },
    styles: { fontSize: 8 },
  });

  // Add explanation
  const y1 = (doc as any).lastAutoTable?.finalY || 150;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(100);
  doc.text('Hinweis: Nettoertrag = Mieteinnahmen - Instandhaltungskosten', 14, y1 + 10);
  doc.text('Instandhaltungskosten beinhalten Banking-Transaktionen und manuell erfasste Belege.', 14, y1 + 16);
  doc.text('Betriebskosten sind nicht enthalten, da diese auf die Mieter umgelegt werden.', 14, y1 + 22);
  doc.setTextColor(0);

  doc.save(`Renditereport_${periodLabel.replace(' ', '_')}.pdf`);
};

// ====== LEERSTAND REPORT ======
export const generateLeerstandReport = (
  properties: PropertyData[],
  units: UnitData[],
  tenants: TenantData[],
  selectedPropertyId: string,
  selectedYear: number
) => {
  const doc = new jsPDF();
  const selectedProperty = properties.find(p => p.id === selectedPropertyId);
  
  addHeader(
    doc, 
    'Leerstandsreport', 
    `Stand: ${new Date().toLocaleDateString('de-AT')}`,
    selectedPropertyId !== 'all' ? selectedProperty?.name : 'Alle Liegenschaften'
  );

  const targetUnits = selectedPropertyId === 'all' ? units : units.filter(u => u.property_id === selectedPropertyId);
  const vacantUnits = targetUnits.filter(u => u.status === 'leerstand');
  
  // Summary
  const vacancyRate = targetUnits.length > 0 ? (vacantUnits.length / targetUnits.length) * 100 : 0;
  const vacantQm = vacantUnits.reduce((sum, u) => sum + Number(u.qm), 0);
  const totalQm = targetUnits.reduce((sum, u) => sum + Number(u.qm), 0);
  
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Zusammenfassung', 14, 45);
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Leerstandsquote: ${formatPercent(vacancyRate)}`, 14, 53);
  doc.text(`Leerstehende Einheiten: ${vacantUnits.length} von ${targetUnits.length}`, 14, 60);
  doc.text(`Leerstehende Fläche: ${vacantQm.toLocaleString('de-AT')} m² von ${totalQm.toLocaleString('de-AT')} m²`, 14, 67);

  // Vacant units table
  if (vacantUnits.length > 0) {
    const tableData = vacantUnits.map(unit => {
      const property = properties.find(p => p.id === unit.property_id);
      return [
        property?.name || '-',
        `${unit.top_nummer}`,
        unitTypeLabels[unit.type] || unit.type,
        `${Number(unit.qm).toLocaleString('de-AT')} m²`,
        `${Number(unit.mea).toLocaleString('de-AT')}`,
      ];
    });

    autoTable(doc, {
      startY: 80,
      head: [['Liegenschaft', 'Einheit', 'Typ', 'Fläche', 'MEA']],
      body: tableData,
      theme: 'striped',
      headStyles: { fillColor: [245, 158, 11] },
    });
  } else {
    doc.setFontSize(11);
    doc.text('Keine leerstehenden Einheiten vorhanden.', 14, 80);
  }

  // Per property summary
  const targetProperties = selectedPropertyId === 'all' ? properties : properties.filter(p => p.id === selectedPropertyId);
  
  const propertyData = targetProperties.map(property => {
    const propUnits = targetUnits.filter(u => u.property_id === property.id);
    const propVacant = propUnits.filter(u => u.status === 'leerstand');
    const propVacancyRate = propUnits.length > 0 ? (propVacant.length / propUnits.length) * 100 : 0;
    const propVacantQm = propVacant.reduce((sum, u) => sum + Number(u.qm), 0);
    
    return [
      property.name,
      `${propVacant.length} / ${propUnits.length}`,
      formatPercent(propVacancyRate),
      `${propVacantQm.toLocaleString('de-AT')} m²`,
    ];
  });

  const lastY = (doc as any).lastAutoTable?.finalY || 90;
  
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Übersicht pro Liegenschaft', 14, lastY + 15);

  autoTable(doc, {
    startY: lastY + 20,
    head: [['Liegenschaft', 'Leerstand', 'Quote', 'Fläche leer']],
    body: propertyData,
    theme: 'striped',
    headStyles: { fillColor: [107, 114, 128] },
  });

  doc.save(`Leerstandsreport_${selectedYear}.pdf`);
};

// ====== UMSATZ REPORT ======
export const generateUmsatzReport = (
  properties: PropertyData[],
  units: UnitData[],
  tenants: TenantData[],
  invoices: InvoiceData[],
  payments: PaymentData[],
  transactions: TransactionData[],
  categories: CategoryData[],
  selectedPropertyId: string,
  selectedYear: number,
  reportPeriod: 'monthly' | 'quarterly' | 'halfyearly' | 'yearly',
  selectedMonth?: number,
  expenses?: ExpenseData[]
) => {
  const doc = new jsPDF('landscape');
  const periodLabel = reportPeriod === 'yearly' 
    ? `Jahr ${selectedYear}` 
    : reportPeriod === 'quarterly'
    ? `Quartal ${selectedYear}`
    : reportPeriod === 'halfyearly'
    ? `Halbjahr ${selectedYear}`
    : `${monthNames[(selectedMonth || 1) - 1]} ${selectedYear}`;
  
  const selectedProperty = properties.find(p => p.id === selectedPropertyId);
  
  addHeader(
    doc, 
    'Umsatzreport', 
    periodLabel,
    selectedPropertyId !== 'all' ? selectedProperty?.name : 'Alle Liegenschaften'
  );

  // Filter transactions for period - including unit-based property matching
  const periodTransactions = transactions.filter(t => {
    const date = new Date(t.transaction_date);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    
    // Property matching: direct OR via unit_id
    let matchesProp = selectedPropertyId === 'all';
    if (!matchesProp) {
      if (t.property_id === selectedPropertyId) {
        matchesProp = true;
      } else if (t.unit_id) {
        const unit = units.find(u => u.id === t.unit_id);
        matchesProp = unit?.property_id === selectedPropertyId;
      }
    }
    
    if (reportPeriod === 'yearly') {
      return matchesProp && year === selectedYear;
    }
    return matchesProp && year === selectedYear && month === selectedMonth;
  });

  // Filter expenses for period
  const periodExpenses = (expenses || []).filter(e => {
    const date = new Date(e.datum);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    
    const matchesProp = selectedPropertyId === 'all' || e.property_id === selectedPropertyId;
    
    if (reportPeriod === 'yearly') {
      return matchesProp && year === selectedYear;
    }
    return matchesProp && year === selectedYear && month === selectedMonth;
  });

  // Calculate totals from transactions
  const incomeTransactions = periodTransactions.filter(t => t.amount > 0);
  const expenseTransactions = periodTransactions.filter(t => t.amount < 0);
  
  const totalIncomeFromTransactions = incomeTransactions.reduce((sum, t) => sum + Number(t.amount), 0);
  const totalExpensesFromTransactions = expenseTransactions.reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
  
  // Calculate totals from expenses (Kosten & Belege)
  const totalExpensesFromCosts = periodExpenses.reduce((sum, e) => sum + Number(e.betrag), 0);
  
  const totalIncome = totalIncomeFromTransactions;
  const totalExpenses = totalExpensesFromTransactions + totalExpensesFromCosts;
  const netResult = totalIncome - totalExpenses;

  // Summary text
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Zusammenfassung', 14, 45);
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Einnahmen (Zahlungen): ${formatCurrency(totalIncomeFromTransactions)} (${incomeTransactions.length} Buchungen)`, 14, 53);
  doc.text(`Ausgaben (Banking): ${formatCurrency(totalExpensesFromTransactions)} (${expenseTransactions.length} Buchungen)`, 14, 60);
  doc.text(`Ausgaben (Kosten/Belege): ${formatCurrency(totalExpensesFromCosts)} (${periodExpenses.length} Belege)`, 14, 67);
  doc.setFont('helvetica', 'bold');
  doc.text(`Ergebnis: ${formatCurrency(netResult)}`, 14, 77);
  doc.setFont('helvetica', 'normal');

  // Combined table data: Transactions + Expenses
  interface ReportRow {
    date: Date;
    location: string;
    description: string;
    category: string;
    income: number;
    expense: number;
    source: 'transaction' | 'expense';
  }
  
  const allRows: ReportRow[] = [];
  
  // Add income transactions with tenant name
  incomeTransactions.forEach(t => {
    const unit = units.find(u => u.id === t.unit_id);
    const property = t.property_id 
      ? properties.find(p => p.id === t.property_id)
      : unit ? properties.find(p => p.id === unit.property_id) : null;
    const tenant = t.tenant_id ? tenants.find(tn => tn.id === t.tenant_id) : null;
    const category = categories.find(c => c.id === t.category_id);
    
    // Build description with tenant name
    let description = t.description || '-';
    if (tenant) {
      description = `${tenant.first_name} ${tenant.last_name}${t.description ? ` - ${t.description}` : ''}`;
    }
    
    const locationInfo = unit 
      ? `${property?.name || '-'} / Top ${unit.top_nummer}`
      : property?.name || '-';
    
    allRows.push({
      date: new Date(t.transaction_date),
      location: locationInfo,
      description,
      category: category?.name || 'Mieteinnahme',
      income: Number(t.amount),
      expense: 0,
      source: 'transaction'
    });
  });
  
  // Add expense transactions
  expenseTransactions.forEach(t => {
    const unit = units.find(u => u.id === t.unit_id);
    const property = t.property_id 
      ? properties.find(p => p.id === t.property_id)
      : unit ? properties.find(p => p.id === unit.property_id) : null;
    const category = categories.find(c => c.id === t.category_id);
    
    const locationInfo = unit 
      ? `${property?.name || '-'} / Top ${unit.top_nummer}`
      : property?.name || '-';
    
    allRows.push({
      date: new Date(t.transaction_date),
      location: locationInfo,
      description: t.description || '-',
      category: category?.name || 'Ausgabe',
      income: 0,
      expense: Math.abs(Number(t.amount)),
      source: 'transaction'
    });
  });
  
  // Add expenses from Kosten & Belege
  periodExpenses.forEach(e => {
    const property = properties.find(p => p.id === e.property_id);
    
    // Map expense_type to readable category
    const expenseTypeLabels: Record<string, string> = {
      'versicherung': 'Versicherung',
      'grundsteuer': 'Grundsteuer',
      'muellabfuhr': 'Müllabfuhr',
      'wasser_abwasser': 'Wasser/Abwasser',
      'heizung': 'Heizung',
      'strom_allgemein': 'Strom allgemein',
      'hausbetreuung': 'Hausbetreuung',
      'lift': 'Lift',
      'gartenpflege': 'Gartenpflege',
      'schneeraeumung': 'Schneeräumung',
      'verwaltung': 'Verwaltung',
      'ruecklage': 'Rücklage',
      'reparatur': 'Reparatur',
      'sanierung': 'Sanierung',
      'sonstiges': 'Sonstiges',
      'makler': 'Makler',
      'notar': 'Notar',
      'grundbuch': 'Grundbuchkosten',
      'finanzierung': 'Finanzierung'
    };
    
    allRows.push({
      date: new Date(e.datum),
      location: property?.name || '-',
      description: e.bezeichnung,
      category: expenseTypeLabels[e.expense_type] || e.expense_type,
      income: 0,
      expense: Number(e.betrag),
      source: 'expense'
    });
  });
  
  // Sort by date descending
  allRows.sort((a, b) => b.date.getTime() - a.date.getTime());

  // Build table
  const tableData = allRows.slice(0, 60).map(row => [
    row.date.toLocaleDateString('de-AT'),
    row.location,
    row.description,
    row.category,
    row.income > 0 ? formatCurrency(row.income) : '-',
    row.expense > 0 ? formatCurrency(row.expense) : '-',
  ]);

  autoTable(doc, {
    startY: 85,
    head: [['Datum', 'Liegenschaft', 'Beschreibung', 'Kategorie', 'Einnahme', 'Ausgabe']],
    body: tableData,
    foot: [['Summe', '', '', '', formatCurrency(totalIncome), formatCurrency(totalExpenses)]],
    theme: 'striped',
    headStyles: { fillColor: [16, 185, 129] },
    footStyles: { fillColor: [229, 231, 235], textColor: [0, 0, 0], fontStyle: 'bold' },
    styles: { fontSize: 8 },
    columnStyles: {
      2: { cellWidth: 60 }, // Description wider
    }
  });

  if (allRows.length > 60) {
    const y = (doc as any).lastAutoTable?.finalY || 200;
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`... und ${allRows.length - 60} weitere Einträge`, 14, y + 10);
    doc.setTextColor(0);
  }

  doc.save(`Umsatzreport_${periodLabel.replace(' ', '_')}.pdf`);
};

// ====== UST VORANMELDUNG ======
// USt-Sätze nach Einheitstyp (österreichische Regelung)
const getVatRatesForUnitType = (unitType: string): { miete: number; bk: number; heizung: number } => {
  switch (unitType) {
    case 'wohnung':
      return { miete: 10, bk: 10, heizung: 20 };
    case 'geschaeft':
    case 'stellplatz':
    case 'garage':
    case 'lager':
    default:
      return { miete: 20, bk: 20, heizung: 20 };
  }
};

export const generateUstVoranmeldung = (
  properties: PropertyData[],
  units: UnitData[],
  tenants: TenantData[],
  invoices: InvoiceData[],
  expenses: ExpenseData[],
  transactions: TransactionData[],
  categories: CategoryData[],
  selectedPropertyId: string,
  selectedYear: number,
  reportPeriod: 'monthly' | 'quarterly' | 'halfyearly' | 'yearly',
  selectedMonth?: number,
  selectedQuarter?: number,
  selectedHalfYear?: number
) => {
  const doc = new jsPDF();
  
  let periodLabel: string;
  let startMonth: number;
  let endMonth: number;
  
  switch (reportPeriod) {
    case 'monthly':
      periodLabel = `${monthNames[(selectedMonth || 1) - 1]} ${selectedYear}`;
      startMonth = selectedMonth || 1;
      endMonth = selectedMonth || 1;
      break;
    case 'quarterly':
      const quarter = selectedQuarter || 1;
      periodLabel = `Q${quarter}/${selectedYear} (${['Jan-Mär', 'Apr-Jun', 'Jul-Sep', 'Okt-Dez'][quarter - 1]})`;
      startMonth = (quarter - 1) * 3 + 1;
      endMonth = quarter * 3;
      break;
    case 'halfyearly':
      const halfYear = selectedHalfYear || 1;
      periodLabel = `${halfYear}. Halbjahr ${selectedYear} (${halfYear === 1 ? 'Jan-Jun' : 'Jul-Dez'})`;
      startMonth = halfYear === 1 ? 1 : 7;
      endMonth = halfYear === 1 ? 6 : 12;
      break;
    case 'yearly':
    default:
      periodLabel = `Jahr ${selectedYear}`;
      startMonth = 1;
      endMonth = 12;
      break;
  }
  
  const monthCount = endMonth - startMonth + 1;
  
  const selectedProperty = properties.find(p => p.id === selectedPropertyId);
  
  addHeader(
    doc, 
    'USt-Voranmeldung', 
    periodLabel,
    selectedPropertyId !== 'all' ? selectedProperty?.name : 'Alle Liegenschaften'
  );

  // ====== EINNAHMEN AUS MIETERDATEN (SOLL-BESTEUERUNG) ======
  // Verwendet zentrale Utility-Funktion für konsistente Filterlogik
  // - Nur EIN Mieter pro Unit
  // - Mietbeginn muss im oder vor dem Zeitraum liegen
  // - Beendete Mieter werden berücksichtigt wenn mietende im Zeitraum liegt
  
  const activeTenants = getActiveTenantsForPeriod(
    units,
    tenants,
    selectedPropertyId,
    selectedYear,
    reportPeriod === 'monthly' ? selectedMonth : undefined
  );
  
  // Berechne SOLL-Einnahmen aus Mieterdaten mit korrekten USt-Sätzen
  let bruttoGrundmiete = 0;
  let bruttoBk = 0;
  let bruttoHeizung = 0;
  let ustGrundmiete = 0;
  let ustBk = 0;
  let ustHeizung = 0;
  
  const mieteSaetze = new Set<number>();
  const bkSaetze = new Set<number>();
  const heizungSaetze = new Set<number>();
  
  activeTenants.forEach(tenant => {
    const unit = units.find(u => u.id === tenant.unit_id);
    const unitType = unit?.type || 'wohnung';
    const vatRates = getVatRatesForUnitType(unitType);
    
    const miete = Number(tenant.grundmiete || 0);
    const bk = Number(tenant.betriebskosten_vorschuss || 0);
    const heizung = Number(tenant.heizungskosten_vorschuss || 0);
    
    // Multiplikator für relevante Monate im Zeitraum berechnen
    let multiplier = 1;
    if (reportPeriod !== 'monthly') {
      // Berechne wie viele Monate der Mieter im gewählten Zeitraum aktiv war
      const mietbeginn = tenant.mietbeginn ? new Date(tenant.mietbeginn) : new Date(selectedYear, 0, 1);
      const mietende = tenant.mietende ? new Date(tenant.mietende) : new Date(selectedYear, 11, 31);
      
      // Tenant-Aktivitätszeitraum
      const tenantStartMonth = mietbeginn.getFullYear() < selectedYear ? 1 : mietbeginn.getMonth() + 1;
      const tenantEndMonth = mietende.getFullYear() > selectedYear ? 12 : mietende.getMonth() + 1;
      
      // Überlappung mit Berichtszeitraum berechnen
      const effectiveStart = Math.max(tenantStartMonth, startMonth);
      const effectiveEnd = Math.min(tenantEndMonth, endMonth);
      
      multiplier = Math.max(0, effectiveEnd - effectiveStart + 1);
    }
    
    bruttoGrundmiete += miete * multiplier;
    bruttoBk += bk * multiplier;
    bruttoHeizung += heizung * multiplier;
    
    ustGrundmiete += calculateVatFromGross(miete * multiplier, vatRates.miete);
    ustBk += calculateVatFromGross(bk * multiplier, vatRates.bk);
    ustHeizung += calculateVatFromGross(heizung * multiplier, vatRates.heizung);
    
    mieteSaetze.add(vatRates.miete);
    bkSaetze.add(vatRates.bk);
    heizungSaetze.add(vatRates.heizung);
  });

  const totalEinnahmen = bruttoGrundmiete + bruttoBk + bruttoHeizung;
  const totalUstEinnahmen = ustGrundmiete + ustBk + ustHeizung;
  
  const formatSatzSpanne = (saetze: Set<number>): string => {
    const arr = Array.from(saetze).sort((a, b) => a - b);
    if (arr.length === 0) return '-';
    if (arr.length === 1) return `${arr[0]}%`;
    return `${arr[0]}-${arr[arr.length - 1]}%`;
  };

  // ====== VORSTEUER AUS TRANSAKTIONEN ======
  // Filter transactions for period (mit Property-Match über unit_id)
  const periodTransactions = transactions.filter(t => {
    const date = new Date(t.transaction_date);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    
    // Period filter
    let periodMatch = false;
    if (reportPeriod === 'yearly') {
      periodMatch = year === selectedYear;
    } else {
      periodMatch = year === selectedYear && month === selectedMonth;
    }
    if (!periodMatch) return false;
    
    // Property filter (direkt ODER über unit_id)
    if (selectedPropertyId === 'all') return true;
    if (t.property_id === selectedPropertyId) return true;
    if (t.unit_id) {
      const unit = units.find(u => u.id === t.unit_id);
      return unit?.property_id === selectedPropertyId;
    }
    return false;
  });

  const expenseTransactions = periodTransactions.filter(t => t.amount < 0);

  // Ausgaben nach USt-Satz gruppieren (Transaktionen)
  const ausgaben20 = expenseTransactions.filter(t => {
    const catName = categories.find(c => c.id === t.category_id)?.name || '';
    return (CATEGORY_VAT_RATES[catName] ?? 20) === 20;
  });
  const ausgaben10 = expenseTransactions.filter(t => {
    const catName = categories.find(c => c.id === t.category_id)?.name || '';
    return CATEGORY_VAT_RATES[catName] === 10;
  });
  const ausgaben0 = expenseTransactions.filter(t => {
    const catName = categories.find(c => c.id === t.category_id)?.name || '';
    return CATEGORY_VAT_RATES[catName] === 0;
  });
  
  const brutto20Trans = ausgaben20.reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
  const brutto10Trans = ausgaben10.reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
  const brutto0Trans = ausgaben0.reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
  const totalAusgabenTrans = brutto20Trans + brutto10Trans + brutto0Trans;
  
  const vorsteuer20Trans = calculateVatFromGross(brutto20Trans, 20);
  const vorsteuer10Trans = calculateVatFromGross(brutto10Trans, 10);
  const vorsteuerTrans = vorsteuer20Trans + vorsteuer10Trans;

  // ====== VORSTEUER AUS EXPENSES (Kosten & Belege) ======
  // Mapping expense_type -> USt-Satz
  const EXPENSE_TYPE_VAT_RATES: Record<string, number> = {
    'heizung': 20,
    'strom_allgemein': 20,
    'wasser_abwasser': 10,
    'muellabfuhr': 20,
    'hausbetreuung': 20,
    'lift': 20,
    'gartenpflege': 20,
    'schneeraeumung': 20,
    'verwaltung': 20,
    'reparatur': 20,
    'sanierung': 20,
    'sonstiges': 20,
    'versicherung': 0, // Versicherungen sind umsatzsteuerfrei
    'grundsteuer': 0,  // Grundsteuer ist keine USt-pflichtige Leistung
    'ruecklage': 0,    // Rücklagen sind keine Ausgaben mit USt
    // Sonstige Kosten - meist 20%
    'makler': 20,
    'notar': 20,
    'grundbuch': 0,    // Gebühren, keine USt
    'finanzierung': 0, // Zinsen sind umsatzsteuerfrei
  };

  const periodExpenses = expenses.filter(exp => {
    const expYear = exp.year;
    const expMonth = exp.month;
    
    // Period filter
    if (reportPeriod === 'yearly') {
      if (expYear !== selectedYear) return false;
    } else {
      if (expYear !== selectedYear || expMonth !== selectedMonth) return false;
    }
    
    // Property filter
    if (selectedPropertyId === 'all') return true;
    return exp.property_id === selectedPropertyId;
  });

  // Expenses nach USt-Satz gruppieren
  const expenses20 = periodExpenses.filter(exp => (EXPENSE_TYPE_VAT_RATES[exp.expense_type] ?? 20) === 20);
  const expenses10 = periodExpenses.filter(exp => EXPENSE_TYPE_VAT_RATES[exp.expense_type] === 10);
  const expenses0 = periodExpenses.filter(exp => EXPENSE_TYPE_VAT_RATES[exp.expense_type] === 0);

  const brutto20Exp = expenses20.reduce((sum, exp) => sum + Number(exp.betrag || 0), 0);
  const brutto10Exp = expenses10.reduce((sum, exp) => sum + Number(exp.betrag || 0), 0);
  const brutto0Exp = expenses0.reduce((sum, exp) => sum + Number(exp.betrag || 0), 0);
  const totalAusgabenExp = brutto20Exp + brutto10Exp + brutto0Exp;

  const vorsteuer20Exp = calculateVatFromGross(brutto20Exp, 20);
  const vorsteuer10Exp = calculateVatFromGross(brutto10Exp, 10);
  const vorsteuerExp = vorsteuer20Exp + vorsteuer10Exp;

  // Kombinierte Vorsteuer
  const combinedVorsteuer = vorsteuerTrans + vorsteuerExp;
  const totalAusgabenGesamt = totalAusgabenTrans + totalAusgabenExp;

  // USt-Zahllast
  const vatLiability = totalUstEinnahmen - combinedVorsteuer;

  // Section 1: Einnahmen aus Mieterdaten (Soll)
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('1. Einnahmen aus Mieterdaten (Soll-Besteuerung)', 14, 50);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`${activeTenants.length} aktive Mieter im Zeitraum`, 14, 56);
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 60,
    head: [['Position', 'Brutto', 'USt-Satz', 'USt']],
    body: [
      ['Grundmiete', formatCurrency(bruttoGrundmiete), formatSatzSpanne(mieteSaetze), formatCurrency(ustGrundmiete)],
      ['Betriebskosten', formatCurrency(bruttoBk), formatSatzSpanne(bkSaetze), formatCurrency(ustBk)],
      ['Heizung', formatCurrency(bruttoHeizung), formatSatzSpanne(heizungSaetze), formatCurrency(ustHeizung)],
    ],
    foot: [['Gesamt Einnahmen', formatCurrency(totalEinnahmen), '', formatCurrency(totalUstEinnahmen)]],
    theme: 'plain',
    headStyles: { fillColor: [229, 231, 235], textColor: [0, 0, 0], fontStyle: 'bold' },
    footStyles: { fillColor: [219, 234, 254], textColor: [0, 0, 0], fontStyle: 'bold' },
    styles: { fontSize: 10 },
  });

  const y1 = (doc as any).lastAutoTable?.finalY || 100;

  // Section 2a: Vorsteuer aus Banking-Transaktionen
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('2. Vorsteuer aus Ausgaben', 14, y1 + 15);
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('2a. Banking-Transaktionen', 14, y1 + 25);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`${expenseTransactions.length} Buchungen im Zeitraum`, 14, y1 + 31);
  doc.setTextColor(0);

  autoTable(doc, {
    startY: y1 + 35,
    head: [['Position', 'Anzahl', 'Brutto', 'USt-Satz', 'Vorsteuer']],
    body: [
      ['Ausgaben (20% USt)', `${ausgaben20.length}`, formatCurrency(brutto20Trans), '20%', formatCurrency(vorsteuer20Trans)],
      ['Ausgaben (10% USt)', `${ausgaben10.length}`, formatCurrency(brutto10Trans), '10%', formatCurrency(vorsteuer10Trans)],
      ['Ausgaben (0% USt)', `${ausgaben0.length}`, formatCurrency(brutto0Trans), '0%', formatCurrency(0)],
    ],
    foot: [['Summe Transaktionen', `${expenseTransactions.length}`, formatCurrency(totalAusgabenTrans), '', formatCurrency(vorsteuerTrans)]],
    theme: 'plain',
    headStyles: { fillColor: [229, 231, 235], textColor: [0, 0, 0], fontStyle: 'bold' },
    footStyles: { fillColor: [243, 244, 246], textColor: [0, 0, 0], fontStyle: 'bold' },
    styles: { fontSize: 10 },
  });

  const y1a = (doc as any).lastAutoTable?.finalY || 150;

  // Section 2b: Vorsteuer aus Kosten & Belege (Expenses)
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('2b. Kosten & Belege', 14, y1a + 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`${periodExpenses.length} Belege im Zeitraum`, 14, y1a + 16);
  doc.setTextColor(0);

  autoTable(doc, {
    startY: y1a + 20,
    head: [['Position', 'Anzahl', 'Brutto', 'USt-Satz', 'Vorsteuer']],
    body: [
      ['Ausgaben (20% USt)', `${expenses20.length}`, formatCurrency(brutto20Exp), '20%', formatCurrency(vorsteuer20Exp)],
      ['Ausgaben (10% USt)', `${expenses10.length}`, formatCurrency(brutto10Exp), '10%', formatCurrency(vorsteuer10Exp)],
      ['Ausgaben (0% USt)', `${expenses0.length}`, formatCurrency(brutto0Exp), '0%', formatCurrency(0)],
    ],
    foot: [['Summe Belege', `${periodExpenses.length}`, formatCurrency(totalAusgabenExp), '', formatCurrency(vorsteuerExp)]],
    theme: 'plain',
    headStyles: { fillColor: [229, 231, 235], textColor: [0, 0, 0], fontStyle: 'bold' },
    footStyles: { fillColor: [243, 244, 246], textColor: [0, 0, 0], fontStyle: 'bold' },
    styles: { fontSize: 10 },
  });

  const y1b = (doc as any).lastAutoTable?.finalY || 200;

  // Gesamt Vorsteuer
  autoTable(doc, {
    startY: y1b + 5,
    body: [
      ['Gesamt Ausgaben', formatCurrency(totalAusgabenGesamt), 'Gesamt Vorsteuer', formatCurrency(combinedVorsteuer)],
    ],
    theme: 'plain',
    styles: { fontSize: 10, fontStyle: 'bold' },
    bodyStyles: { fillColor: [219, 234, 254] },
  });

  const y2 = (doc as any).lastAutoTable?.finalY || 150;

  // Section 3: Berechnung
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('3. USt-Berechnung', 14, y2 + 15);

  autoTable(doc, {
    startY: y2 + 20,
    body: [
      ['Umsatzsteuer (aus Einnahmen)', formatCurrency(totalUstEinnahmen)],
      ['./. Vorsteuer (aus Ausgaben)', formatCurrency(combinedVorsteuer)],
      [vatLiability >= 0 ? 'Zahllast an Finanzamt' : 'Gutschrift vom Finanzamt', formatCurrency(Math.abs(vatLiability))],
    ],
    theme: 'plain',
    bodyStyles: { fontSize: 11 },
    columnStyles: {
      0: { fontStyle: 'bold' },
      1: { halign: 'right' },
    },
  });

  const y3 = (doc as any).lastAutoTable?.finalY || 200;

  // Highlight box for result
  doc.setFillColor(vatLiability >= 0 ? 220 : 254, vatLiability >= 0 ? 252 : 226, vatLiability >= 0 ? 231 : 226);
  doc.roundedRect(14, y3 + 10, 180, 25, 3, 3, 'F');
  
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(vatLiability >= 0 ? 22 : 180, vatLiability >= 0 ? 163 : 83, vatLiability >= 0 ? 74 : 9);
  doc.text(
    vatLiability >= 0 
      ? `Zahllast: ${formatCurrency(vatLiability)}`
      : `Gutschrift: ${formatCurrency(Math.abs(vatLiability))}`,
    104,
    y3 + 25,
    { align: 'center' }
  );
  doc.setTextColor(0);

  // Due date for monthly
  if (reportPeriod === 'monthly' && selectedMonth) {
    const dueMonth = selectedMonth + 1 > 12 ? 1 : selectedMonth + 1;
    const dueYear = selectedMonth === 12 ? selectedYear + 1 : selectedYear;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(`Fällig bis: 15.${dueMonth.toString().padStart(2, '0')}.${dueYear}`, 104, y3 + 32, { align: 'center' });
    doc.setTextColor(0);
  }

  doc.save(`USt-Voranmeldung_${periodLabel.replace(' ', '_')}.pdf`);
};

// Interface for combined payments (from useCombinedPayments)
export interface CombinedPaymentData {
  id: string;
  tenant_id: string;
  amount: number;
  date: string;
  source: 'payments' | 'transactions';
}

// Interface for monthly invoices (Vorschreibungen)
export interface MonthlyInvoiceData {
  id: string;
  tenantId?: string;
  tenant_id?: string;
  unitId?: string;
  unit_id?: string;
  year: number;
  month: number;
  grundmiete: number | string;
  betriebskosten: number | string;
  heizungskosten: number | string;
  gesamtbetrag: number | string;
}

// ====== OFFENE POSTEN REPORT ======
export const generateOffenePostenReport = (
  properties: PropertyData[],
  units: UnitData[],
  tenants: TenantData[],
  combinedPayments: CombinedPaymentData[],
  selectedPropertyId: string,
  selectedYear: number,
  reportPeriod: 'monthly' | 'quarterly' | 'halfyearly' | 'yearly',
  selectedMonth: number,
  selectedQuarter?: number,
  selectedHalfYear?: number,
  monthlyInvoices?: MonthlyInvoiceData[]
) => {
  const doc = new jsPDF('landscape');
  const selectedProperty = properties.find(p => p.id === selectedPropertyId);
  
  // Calculate period range
  let periodLabel: string;
  let periodStartMonth: number;
  let periodEndMonth: number;
  
  switch (reportPeriod) {
    case 'monthly':
      periodLabel = `${monthNames[selectedMonth - 1]} ${selectedYear}`;
      periodStartMonth = selectedMonth;
      periodEndMonth = selectedMonth;
      break;
    case 'quarterly':
      const quarter = selectedQuarter || 1;
      periodLabel = `Q${quarter}/${selectedYear} (${['Jan-Mär', 'Apr-Jun', 'Jul-Sep', 'Okt-Dez'][quarter - 1]})`;
      periodStartMonth = (quarter - 1) * 3 + 1;
      periodEndMonth = quarter * 3;
      break;
    case 'halfyearly':
      const halfYear = selectedHalfYear || 1;
      periodLabel = `${halfYear}. Halbjahr ${selectedYear} (${halfYear === 1 ? 'Jan-Jun' : 'Jul-Dez'})`;
      periodStartMonth = halfYear === 1 ? 1 : 7;
      periodEndMonth = halfYear === 1 ? 6 : 12;
      break;
    case 'yearly':
    default:
      periodLabel = `Jahr ${selectedYear}`;
      periodStartMonth = 1;
      periodEndMonth = 12;
      break;
  }
  
  const monthCount = periodEndMonth - periodStartMonth + 1;
  
  addHeader(
    doc, 
    'Offene Posten Liste', 
    `Zeitraum: ${periodLabel} | Stand: ${new Date().toLocaleDateString('de-AT')}`,
    selectedPropertyId !== 'all' ? selectedProperty?.name : 'Alle Liegenschaften'
  );

  // Filter units
  const targetUnits = selectedPropertyId === 'all' ? units : units.filter(u => u.property_id === selectedPropertyId);
  
  // Get active tenants for these units - using central utility for consistent logic
  // WICHTIG: Nur EIN aktiver Mieter pro Unit, Mietbeginn wird NICHT geprüft
  const relevantTenants = getActiveTenantsForPeriod(
    targetUnits,
    tenants,
    selectedPropertyId,
    selectedYear,
    reportPeriod === 'monthly' ? selectedMonth : undefined
  );
  
  // Month multiplier uses the calculated monthCount
  const monthMultiplier = monthCount;

  // Calculate balance per tenant with MRG-konform allocation
  interface TenantBalance {
    tenantId: string;
    tenantName: string;
    unitId: string;
    unitNummer: string;
    propertyName: string;
    // SOLL-Werte
    sollBk: number;
    sollHk: number;
    sollMiete: number;
    sollBetrag: number;
    // IST-Werte (MRG-konform aufgeteilt)
    istBk: number;
    istHk: number;
    istMiete: number;
    habenBetrag: number;
    // Saldo
    saldo: number;
    ueberzahlung: number;
    paymentCount: number;
    daysOverdue: number;
  }

  const tenantBalances: TenantBalance[] = [];
  const today = new Date();

  // Calculate days since period start for overdue calculation
  const periodStart = reportPeriod === 'monthly'
    ? new Date(selectedYear, selectedMonth - 1, 1)
    : new Date(selectedYear, 0, 1);
  const daysSincePeriodStart = Math.max(0, Math.floor((today.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)));

  // Erweitert: Sammle ALLE Mieter mit Vorschreibungen im Zeitraum (inkl. ehemalige)
  const tenantsWithInvoicesIds = new Set<string>();
  (monthlyInvoices || []).forEach(inv => {
    const invTenantId = inv.tenantId || inv.tenant_id;
    if (invTenantId && 
        inv.year === selectedYear && 
        inv.month >= periodStartMonth && inv.month <= periodEndMonth &&
        !(inv as any).isVacancy && !(inv as any).is_vacancy) {
      // Prüfe Property-Filter
      const tenant = tenants.find(t => t.id === invTenantId);
      const unit = targetUnits.find(u => u.id === tenant?.unit_id);
      if (unit) {
        tenantsWithInvoicesIds.add(invTenantId);
      }
    }
  });
  
  // Kombiniere relevantTenants mit Mietern die Vorschreibungen haben
  const allRelevantTenantIds = new Set([
    ...relevantTenants.map(t => t.id),
    ...tenantsWithInvoicesIds
  ]);
  
  // WICHTIG: Zahlungsfilterung NACH Bestimmung aller relevanten Mieter
  // Filter combined payments by period and tenant (uses 'date' and 'amount' fields)
  const periodPayments = combinedPayments.filter(p => {
    // Support both camelCase and snake_case
    const pAny = p as any;
    const paymentTenantId = pAny.tenantId ?? pAny.tenant_id ?? p.tenant_id;
    if (!paymentTenantId || !allRelevantTenantIds.has(paymentTenantId)) return false;
    const paymentDate = new Date(p.date);
    const matchesYear = paymentDate.getFullYear() === selectedYear;
    const paymentMonth = paymentDate.getMonth() + 1;
    // Check if payment falls within the period range
    return matchesYear && paymentMonth >= periodStartMonth && paymentMonth <= periodEndMonth;
  });
  
  // Finde alle zu verarbeitenden Mieter
  const tenantsToProcess = Array.from(allRelevantTenantIds).map(tenantId => {
    const fromRelevant = relevantTenants.find(t => t.id === tenantId);
    if (fromRelevant) return fromRelevant;
    return tenants.find(t => t.id === tenantId) || null;
  }).filter((t): t is TenantData => t !== null);

  tenantsToProcess.forEach(tenant => {
    // Support both camelCase and snake_case for tenant_id
    const tenantPayments = periodPayments.filter(p => {
      const pAny = p as any;
      return (pAny.tenantId ?? pAny.tenant_id ?? p.tenant_id) === tenant.id;
    });
    
    // SOLL aus Vorschreibung (monthly_invoices) - bevorzugt über Mieter-Stammdaten
    // Filtere Vorschreibungen für diesen Mieter und den Zeitraum
    const tenantInvoices = (monthlyInvoices || []).filter(inv => {
      const invTenantId = inv.tenantId || inv.tenant_id;
      const matchesTenant = invTenantId === tenant.id;
      const matchesYear = inv.year === selectedYear;
      const matchesPeriod = inv.month >= periodStartMonth && inv.month <= periodEndMonth;
      return matchesTenant && matchesYear && matchesPeriod;
    });
    
    let sollBkNetto: number, sollHkNetto: number, sollMieteNetto: number, sollBetrag: number;
    let sollBk: number, sollHk: number, sollMiete: number; // BRUTTO-Werte
    // Österreichische USt-Sätze: BK 10%, HK 20%, Miete Wohnung 10%, Geschäft/Lager/Stellplatz 20%
    let ustSatzBk = 10, ustSatzHk = 20, ustSatzMiete = 10;
    
    // Ermittle Nutzungsart für Miete-USt (Wohnung=10%, Geschäft/Lager/Stellplatz=20%)
    const unit = targetUnits.find(u => u.id === tenant.unit_id);
    const nutzungsart = (unit as any)?.nutzungsart || (unit as any)?.usage_type || 'wohnung';
    const isGewerbe = ['geschaeft', 'gewerbe', 'lager', 'stellplatz', 'parkplatz', 'garage'].includes(nutzungsart.toLowerCase());
    const defaultMieteUst = isGewerbe ? 20 : 10;
    
    if (tenantInvoices.length > 0) {
      // SOLL aus Vorschreibungen - akkumuliere mit korrekten USt-Sätzen pro Rechnung
      sollBkNetto = 0; sollHkNetto = 0; sollMieteNetto = 0;
      sollBk = 0; sollHk = 0; sollMiete = 0;
      sollBetrag = 0;
      
      tenantInvoices.forEach(invoice => {
        const inv = invoice as any;
        // NETTO-Werte aus Rechnung
        const bkNetto = Number(inv.betriebskosten || 0);
        const hkNetto = Number(inv.heizungskosten || 0);
        const mieteNetto = Number(inv.grundmiete || 0);
        
        // USt-Sätze aus Rechnung (mit korrekten Defaults)
        const invUstBk = Number(inv.ustSatzBk ?? inv.ust_satz_bk ?? 10);
        const invUstHk = Number(inv.ustSatzHeizung ?? inv.ust_satz_heizung ?? 20);
        const invUstMiete = Number(inv.ustSatzMiete ?? inv.ust_satz_miete ?? defaultMieteUst);
        
        // Akkumuliere NETTO
        sollBkNetto += bkNetto;
        sollHkNetto += hkNetto;
        sollMieteNetto += mieteNetto;
        
        // Akkumuliere BRUTTO mit korrekten USt-Sätzen
        sollBk += bkNetto * (1 + invUstBk / 100);
        sollHk += hkNetto * (1 + invUstHk / 100);
        sollMiete += mieteNetto * (1 + invUstMiete / 100);
        
        // Merke USt-Sätze für IST-Berechnung (letzte Rechnung)
        ustSatzBk = invUstBk;
        ustSatzHk = invUstHk;
        ustSatzMiete = invUstMiete;
        
        sollBetrag += Number(inv.gesamtbetrag || 0);
      });
      
      // Reconciliation: Wenn Summe der Komponenten-BRUTTO von gesamtbetrag abweicht,
      // proportional anpassen (kann durch Rundung oder Sonderposten passieren)
      const komponentenSumme = sollBk + sollHk + sollMiete;
      if (komponentenSumme > 0 && Math.abs(komponentenSumme - sollBetrag) > 0.01) {
        const factor = sollBetrag / komponentenSumme;
        sollBk *= factor;
        sollHk *= factor;
        sollMiete *= factor;
      }
    } else {
      // Fallback: SOLL aus Mieter-Stammdaten (wenn keine Vorschreibung existiert)
      sollBkNetto = Number(tenant.betriebskosten_vorschuss || 0) * monthMultiplier;
      sollHkNetto = Number(tenant.heizungskosten_vorschuss || 0) * monthMultiplier;
      sollMieteNetto = Number(tenant.grundmiete || 0) * monthMultiplier;
      // Berechne BRUTTO mit österreichischen USt-Sätzen
      ustSatzMiete = defaultMieteUst; // Wohnung 10%, Gewerbe 20%
      sollBk = sollBkNetto * (1 + ustSatzBk / 100);  // 10%
      sollHk = sollHkNetto * (1 + ustSatzHk / 100);  // 20%
      sollMiete = sollMieteNetto * (1 + ustSatzMiete / 100);
      sollBetrag = sollBk + sollHk + sollMiete;
    }
    
    const sollBetragNetto = sollBkNetto + sollHkNetto + sollMieteNetto;
    
    // IST from combined payments (uses 'amount' field)
    const habenBetrag = tenantPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    
    // MRG-konforme Aufteilung: BK → HK → Miete (gegen NETTO-Werte intern)
    // Die Allokation erfolgt proportional zu den Netto-SOLL-Werten
    // BUCHHALTÄRISCH KORREKT: Wenn voll bezahlt (habenBetrag >= sollBetrag), 
    // dann IST = SOLL für jede Komponente (keine MRG-Allokation nötig)
    let istBk: number;
    let istHk: number;
    let istMiete: number;
    
    // WICHTIG: Nur als "voll bezahlt" behandeln wenn:
    // 1. Es gibt einen positiven SOLL-Betrag (sollBetrag > 0.01)
    // 2. Die Zahlung deckt mindestens den SOLL-Betrag
    if (sollBetrag > 0.01 && habenBetrag >= sollBetrag - 0.01) {
      // Voll bezahlt: IST = SOLL für alle Komponenten
      istBk = sollBk;
      istHk = sollHk;
      istMiete = sollMiete;
    } else if (habenBetrag < 0.01) {
      // KEINE Zahlung erfolgt: IST = 0 für alle Komponenten
      istBk = 0;
      istHk = 0;
      istMiete = 0;
    } else {
      // Unterzahlung: MRG-Allokation BK → HK → Miete auf NETTO-Basis
      let remaining = habenBetrag;
      const istBkNetto = Math.min(remaining, sollBkNetto);
      remaining -= istBkNetto;
      const istHkNetto = Math.min(remaining, sollHkNetto);
      remaining -= istHkNetto;
      const istMieteNetto = Math.min(remaining, sollMieteNetto);
      
      // IST BRUTTO für Anzeige: Anwendung der korrekten USt-Sätze auf die allozierten NETTO-Werte
      istBk = istBkNetto * (1 + ustSatzBk / 100);
      istHk = istHkNetto * (1 + ustSatzHk / 100);
      istMiete = istMieteNetto * (1 + ustSatzMiete / 100);
      
      // Reconciliation: IST-Komponenten-Summe sollte = habenBetrag sein
      const istKomponentenSumme = istBk + istHk + istMiete;
      if (istKomponentenSumme > 0 && Math.abs(istKomponentenSumme - habenBetrag) > 0.01) {
        const factor = habenBetrag / istKomponentenSumme;
        istBk *= factor;
        istHk *= factor;
        istMiete *= factor;
      }
    }
    
    // WICHTIG: Überzahlung basiert auf BRUTTO-SOLL, nicht auf NETTO
    // Damit wird der USt-Anteil nicht fälschlicherweise als Überzahlung gezählt
    const ueberzahlung = habenBetrag > sollBetrag ? habenBetrag - sollBetrag : 0;
    
    // WICHTIG: Saldo = SOLL (brutto) - IST, positiv = Unterzahlung, negativ = Überzahlung
    const saldo = sollBetrag - habenBetrag;

    // Days overdue: only if there's unpaid amount and we're past the period start
    const daysOverdue = saldo > 0 && daysSincePeriodStart > 0 ? daysSincePeriodStart : 0;

    // unit bereits oben ermittelt für Nutzungsart/USt
    const property = properties.find(p => p.id === unit?.property_id);

    // Include all tenants (not just those with SOLL > 0)
    tenantBalances.push({
      tenantId: tenant.id,
      tenantName: `${tenant.first_name} ${tenant.last_name}`,
      unitId: tenant.unit_id,
      unitNummer: unit?.top_nummer || '-',
      propertyName: property?.name || '-',
      sollBk,
      sollHk,
      sollMiete,
      sollBetrag,
      istBk,
      istHk,
      istMiete,
      habenBetrag,
      saldo,
      ueberzahlung,
      paymentCount: tenantPayments.length,
      daysOverdue,
    });
  });

  // ====== LEERSTAND (Vacancy) SUPPORT ======
  // Finde Leerstand-Vorschreibungen für den Zeitraum
  const vacancyInvoices = (monthlyInvoices || []).filter(inv => 
    (inv as any).isVacancy === true || (inv as any).is_vacancy === true
  );
  
  const periodVacancyInvoices = vacancyInvoices.filter(inv =>
    inv.year === selectedYear &&
    inv.month >= periodStartMonth && inv.month <= periodEndMonth
  );
  
  // Gruppiere nach Unit
  const vacancyByUnit = new Map<string, typeof periodVacancyInvoices>();
  periodVacancyInvoices.forEach(inv => {
    const unitId = (inv as any).unitId ?? (inv as any).unit_id;
    if (!unitId) return;
    
    // Filter by property if selected
    const unit = targetUnits.find(u => u.id === unitId);
    if (!unit) return;
    
    if (!vacancyByUnit.has(unitId)) {
      vacancyByUnit.set(unitId, []);
    }
    vacancyByUnit.get(unitId)!.push(inv);
  });
  
  // Erstelle Leerstand-Einträge
  vacancyByUnit.forEach((unitVacancyInvoices, unitId) => {
    const unit = targetUnits.find(u => u.id === unitId);
    const property = properties.find(p => p.id === unit?.property_id);
    
    // SOLL BRUTTO aus gesamtbetrag (konsistent mit normalen Mietern)
    const sollBetrag = unitVacancyInvoices.reduce((sum, inv) => 
      sum + Number((inv as any).gesamtbetrag ?? 0), 0);
    
    // SOLL Komponenten mit BRUTTO (NETTO + USt)
    let sollBk = unitVacancyInvoices.reduce((sum, inv) => {
      const netto = Number((inv as any).betriebskosten ?? 0);
      const ustSatz = Number((inv as any).ustSatzBk ?? (inv as any).ust_satz_bk ?? 10);
      return sum + netto * (1 + ustSatz / 100);
    }, 0);
    let sollHk = unitVacancyInvoices.reduce((sum, inv) => {
      const netto = Number((inv as any).heizungskosten ?? 0);
      const ustSatz = Number((inv as any).ustSatzHeizung ?? (inv as any).ust_satz_heizung ?? 20);
      return sum + netto * (1 + ustSatz / 100);
    }, 0);
    const sollMiete = 0;
    
    // Reconciliation: Komponenten an gesamtbetrag anpassen
    const komponentenSumme = sollBk + sollHk;
    if (komponentenSumme > 0 && Math.abs(komponentenSumme - sollBetrag) > 0.01) {
      const factor = sollBetrag / komponentenSumme;
      sollBk *= factor;
      sollHk *= factor;
    }
    
    // IST aus paid_amount
    const habenBetrag = unitVacancyInvoices.reduce((sum, inv) => 
      sum + Number((inv as any).paidAmount ?? (inv as any).paid_amount ?? 0), 0);
    
    // Proportionale Verteilung auf Komponenten
    const istBk = sollBetrag > 0 ? (sollBk / sollBetrag) * habenBetrag : 0;
    const istHk = sollBetrag > 0 ? (sollHk / sollBetrag) * habenBetrag : 0;
    const istMiete = 0;
    
    const saldo = sollBetrag - habenBetrag;
    
    tenantBalances.push({
      tenantId: `vacancy-${unitId}`,
      tenantName: `Leerstand (${unitVacancyInvoices.length} Mon.)`,
      unitId: unitId,
      unitNummer: unit?.top_nummer || '-',
      propertyName: property?.name || '-',
      sollBk,
      sollHk,
      sollMiete,
      sollBetrag,
      istBk,
      istHk,
      istMiete,
      habenBetrag,
      saldo,
      ueberzahlung: 0,
      paymentCount: 0,
      daysOverdue: 0,
    });
  });

  // Sort: Positive saldo (Unterzahlung) first, then by amount descending
  tenantBalances.sort((a, b) => {
    // First: underpayments (positive saldo)
    if (a.saldo > 0 && b.saldo <= 0) return -1;
    if (a.saldo <= 0 && b.saldo > 0) return 1;
    // Then by absolute amount
    return Math.abs(b.saldo) - Math.abs(a.saldo);
  });

  // Summary calculations
  const totalSollBk = tenantBalances.reduce((sum, t) => sum + t.sollBk, 0);
  const totalSollHk = tenantBalances.reduce((sum, t) => sum + t.sollHk, 0);
  const totalSollMiete = tenantBalances.reduce((sum, t) => sum + t.sollMiete, 0);
  const totalSoll = tenantBalances.reduce((sum, t) => sum + t.sollBetrag, 0);
  const totalIstBk = tenantBalances.reduce((sum, t) => sum + t.istBk, 0);
  const totalIstHk = tenantBalances.reduce((sum, t) => sum + t.istHk, 0);
  const totalIstMiete = tenantBalances.reduce((sum, t) => sum + t.istMiete, 0);
  const totalHaben = tenantBalances.reduce((sum, t) => sum + t.habenBetrag, 0);
  const totalSaldo = tenantBalances.reduce((sum, t) => sum + t.saldo, 0);
  const totalUeberzahlung = tenantBalances.reduce((sum, t) => sum + t.ueberzahlung, 0);
  const underpaidTenants = tenantBalances.filter(t => t.saldo > 0);
  const overpaidTenants = tenantBalances.filter(t => t.saldo < 0);
  const totalUnterzahlungAmount = underpaidTenants.reduce((sum, t) => sum + t.saldo, 0);

  // Summary text
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Soll: ${formatCurrency(totalSoll)} | Haben: ${formatCurrency(totalHaben)} | Saldo: ${formatCurrency(totalSaldo)}`, 14, 40);
  doc.text(`Unterzahlungen: ${formatCurrency(totalUnterzahlungAmount)} (${underpaidTenants.length} Mieter) | Überzahlungen: ${formatCurrency(totalUeberzahlung)} (${overpaidTenants.length} Mieter)`, 14, 46);

  // Table data with MRG-konform allocation
  const tableData = tenantBalances.map(tb => {
    // Status basiert NUR auf Saldo (nicht auf dem separaten ueberzahlung-Feld)
    // Saldo = BRUTTO-SOLL - IST: positiv = Unterzahlung, negativ = Überzahlung
    let statusLabel = 'Bezahlt';
    if (tb.saldo > 0.01) {
      statusLabel = 'Unterzahlung';
    } else if (tb.saldo < -0.01) {
      statusLabel = 'Überzahlung';
    }
    
    return [
      tb.propertyName,
      `${tb.unitNummer}`,
      tb.tenantName,
      // BK Soll/Ist
      formatCurrency(tb.sollBk),
      formatCurrency(tb.istBk),
      // HK Soll/Ist
      formatCurrency(tb.sollHk),
      formatCurrency(tb.istHk),
      // Miete Soll/Ist
      formatCurrency(tb.sollMiete),
      formatCurrency(tb.istMiete),
      // Status & Saldo
      statusLabel,
      formatCurrency(tb.saldo),
    ];
  });

  autoTable(doc, {
    startY: 52,
    head: [['Liegenschaft', 'Einheit', 'Mieter', 'BK Soll', 'BK Ist', 'HK Soll', 'HK Ist', 'Miete Soll', 'Miete Ist', 'Status', 'Saldo']],
    body: tableData,
    foot: [['Gesamt', '', '', formatCurrency(totalSollBk), formatCurrency(totalIstBk), formatCurrency(totalSollHk), formatCurrency(totalIstHk), formatCurrency(totalSollMiete), formatCurrency(totalIstMiete), '', formatCurrency(totalSaldo)]],
    theme: 'striped',
    headStyles: { fillColor: [239, 68, 68], fontSize: 7 },
    footStyles: { fillColor: [254, 226, 226], textColor: [0, 0, 0], fontStyle: 'bold' },
    styles: { fontSize: 7, cellPadding: 1.5 },
    columnStyles: {
      0: { cellWidth: 30 },  // Liegenschaft
      1: { cellWidth: 18 },  // Einheit
      2: { cellWidth: 30 },  // Mieter
      3: { cellWidth: 20, halign: 'right' },  // BK Soll
      4: { cellWidth: 20, halign: 'right' },  // BK Ist
      5: { cellWidth: 20, halign: 'right' },  // HK Soll
      6: { cellWidth: 20, halign: 'right' },  // HK Ist
      7: { cellWidth: 22, halign: 'right' },  // Miete Soll
      8: { cellWidth: 22, halign: 'right' },  // Miete Ist
      9: { cellWidth: 22 },  // Status
      10: { cellWidth: 22, halign: 'right' },  // Saldo
    },
    didParseCell: (data) => {
      // Style the Saldo column based on value
      if (data.section === 'body' && data.column.index === 10) {
        const saldoText = data.cell.text[0];
        if (saldoText) {
          const value = parseFloat(saldoText.replace('€ ', '').replace(/\./g, '').replace(',', '.'));
          if (value > 0) {
            data.cell.styles.textColor = [239, 68, 68]; // Red for underpayment
            data.cell.styles.fontStyle = 'bold';
          } else if (value < 0) {
            data.cell.styles.textColor = [34, 197, 94]; // Green for overpayment
            data.cell.styles.fontStyle = 'bold';
          }
        }
      }
      // Style Status column
      if (data.section === 'body' && data.column.index === 9) {
        const status = data.cell.text[0];
        if (status === 'Unterzahlung') {
          data.cell.styles.textColor = [239, 68, 68];
        } else if (status === 'Überzahlung') {
          data.cell.styles.textColor = [34, 197, 94];
        } else if (status === 'Bezahlt') {
          data.cell.styles.textColor = [22, 163, 74];
        }
      }
      // Color IST columns: grün wenn IST = SOLL (bezahlt), rot wenn IST < SOLL (Unterzahlung)
      if (data.section === 'body') {
        const row = data.row.index;
        const tb = tenantBalances[row];
        if (tb) {
          const isBezahlt = tb.saldo <= 0.01; // Voll bezahlt oder Überzahlung
          
          // BK Ist
          if (data.column.index === 4) {
            if (Math.abs(tb.sollBk - tb.istBk) <= 0.01 && tb.sollBk > 0) {
              data.cell.styles.textColor = [22, 163, 74]; // Grün für match
            } else if (tb.sollBk - tb.istBk > 0.01) {
              data.cell.styles.textColor = [239, 68, 68]; // Rot für Unterzahlung
            }
          }
          // HK Ist
          if (data.column.index === 6) {
            if (Math.abs(tb.sollHk - tb.istHk) <= 0.01 && tb.sollHk > 0) {
              data.cell.styles.textColor = [22, 163, 74]; // Grün für match
            } else if (tb.sollHk - tb.istHk > 0.01) {
              data.cell.styles.textColor = [239, 68, 68]; // Rot für Unterzahlung
            }
          }
          // Miete Ist
          if (data.column.index === 8) {
            if (Math.abs(tb.sollMiete - tb.istMiete) <= 0.01 && tb.sollMiete > 0) {
              data.cell.styles.textColor = [22, 163, 74]; // Grün für match
            } else if (tb.sollMiete - tb.istMiete > 0.01) {
              data.cell.styles.textColor = [239, 68, 68]; // Rot für Unterzahlung
            }
          }
          // Saldo bei Bezahlt auch grün
          if (data.column.index === 10 && isBezahlt) {
            data.cell.styles.textColor = [22, 163, 74]; // Grün
          }
        }
      }
    },
  });

  const fileName = reportPeriod === 'monthly'
    ? `Offene_Posten_${monthNames[selectedMonth - 1]}_${selectedYear}.pdf`
    : `Offene_Posten_${selectedYear}.pdf`;
  doc.save(fileName);
};

// ============ PLAUSIBILITY REPORT (Kontenabgleich) ============

interface BankAccountData {
  id: string;
  account_name: string;
  iban: string | null;
  bank_name: string | null;
  opening_balance: number | null;
  opening_balance_date: string | null;
}

export interface CombinedPaymentData {
  id: string;
  tenant_id: string;
  amount: number;
  date: string;
  source: 'payments' | 'transactions';
  description?: string;
}

interface PlausibilityReportData {
  bankAccounts: BankAccountData[];
  transactions: TransactionData[]; // For expenses (negative amounts)
  combinedPayments: CombinedPaymentData[]; // For income (from payments + transactions)
  properties: PropertyData[];
  units: UnitData[];
  tenants: TenantData[];
  categories: CategoryData[];
  selectedYear: number;
  startDate: string;
  endDate: string;
}

export const generatePlausibilityReport = (data: PlausibilityReportData) => {
  const doc = new jsPDF();
  const { bankAccounts, transactions, combinedPayments, properties, units, tenants, categories, selectedYear, startDate, endDate } = data;

  // Filter transactions for the period (for expenses)
  const periodTransactions = transactions.filter(t => {
    const txDate = t.transaction_date;
    return txDate >= startDate && txDate <= endDate;
  });
  
  // Filter combined payments for the period (for income)
  const periodPayments = combinedPayments.filter(p => {
    return p.date >= startDate && p.date <= endDate;
  });

  // Helper to format currency
  const fmt = (v: number) => `€ ${v.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Header
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('Plausibilitätsreport', 14, 20);
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  doc.text(`Kontenabgleich für ${selectedYear}`, 14, 28);
  doc.text(`Zeitraum: ${new Date(startDate).toLocaleDateString('de-AT')} - ${new Date(endDate).toLocaleDateString('de-AT')}`, 14, 34);
  doc.text(`Erstellt am: ${new Date().toLocaleDateString('de-AT')}`, 14, 40);
  doc.setTextColor(0);

  let currentY = 50;

  // ===== SECTION 1: Bank Account Summary =====
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('1. Kontenübersicht', 14, currentY);
  currentY += 8;

  // Account summaries for known bank accounts
  const accountSummaries = bankAccounts.map(account => {
    const accountTx = periodTransactions.filter(t => (t as any).bank_account_id === account.id);
    const income = accountTx.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
    const expenses = accountTx.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const openingBalance = account.opening_balance || 0;
    const closingBalance = openingBalance + income - expenses;
    
    return {
      name: account.account_name,
      iban: account.iban || '-',
      openingBalance,
      income,
      expenses,
      closingBalance,
      isValid: true,
    };
  });

  // Add unassigned transactions (no bank_account_id) as separate row
  const unassignedTx = periodTransactions.filter(t => !(t as any).bank_account_id);
  const unassignedIncomeTx = unassignedTx.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
  const unassignedExpensesTx = unassignedTx.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);
  
  if (unassignedTx.length > 0) {
    accountSummaries.push({
      name: 'Nicht zugeordnet',
      iban: '-',
      openingBalance: 0,
      income: unassignedIncomeTx,
      expenses: unassignedExpensesTx,
      closingBalance: unassignedIncomeTx - unassignedExpensesTx,
      isValid: false,
    });
  }

  // Show message if no data at all
  if (accountSummaries.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(150);
    doc.text('Keine Bankkonten konfiguriert und keine Transaktionen im Zeitraum vorhanden.', 14, currentY);
    doc.setTextColor(0);
    currentY += 10;
  } else {
    autoTable(doc, {
      startY: currentY,
      head: [['Konto', 'IBAN', 'Anfangsbestand', '+ Einnahmen', '- Ausgaben', '= Endbestand']],
      body: accountSummaries.map(a => [
        a.name,
        a.iban,
        fmt(a.openingBalance),
        fmt(a.income),
        fmt(a.expenses),
        fmt(a.closingBalance),
      ]),
      foot: [[
        'Gesamt',
        '',
        fmt(accountSummaries.reduce((s, a) => s + a.openingBalance, 0)),
        fmt(accountSummaries.reduce((s, a) => s + a.income, 0)),
        fmt(accountSummaries.reduce((s, a) => s + a.expenses, 0)),
        fmt(accountSummaries.reduce((s, a) => s + a.closingBalance, 0)),
      ]],
      theme: 'striped',
      headStyles: { fillColor: [59, 130, 246], textColor: 255 },
      footStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold' },
      columnStyles: {
        2: { halign: 'right' },
        3: { halign: 'right', textColor: [34, 197, 94] },
        4: { halign: 'right', textColor: [239, 68, 68] },
        5: { halign: 'right', fontStyle: 'bold' },
      },
      styles: { fontSize: 9 },
      margin: { left: 14, right: 14 },
      didParseCell: (data) => {
        // Highlight unassigned row in orange
        if (data.section === 'body' && data.row.raw && (data.row.raw as string[])[0] === 'Nicht zugeordnet') {
          data.cell.styles.fillColor = [255, 243, 224];
          data.cell.styles.textColor = [194, 65, 12];
        }
      },
    });
  }

  currentY = (doc as any).lastAutoTable.finalY + 15;

  // ===== SECTION 2: Income by Property/Tenant (from combinedPayments) =====
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('2. Einnahmen nach Liegenschaft & Mieter', 14, currentY);
  currentY += 8;

  // Group payments by property, then by tenant
  // We need to find property via tenant -> unit -> property
  type PropertyIncome = {
    propertyId: string;
    propertyName: string;
    tenants: { tenantId: string; tenantName: string; amount: number }[];
    total: number;
  };

  const incomeByProperty: PropertyIncome[] = [];
  const propertyGroups = new Map<string, { tenantId: string; amount: number }[]>();
  let unassignedIncome = 0;
  
  for (const payment of periodPayments) {
    const tenant = tenants.find(t => t.id === payment.tenant_id);
    if (!tenant) {
      unassignedIncome += payment.amount;
      continue;
    }
    
    const unit = units.find(u => u.id === tenant.unit_id);
    if (!unit) {
      unassignedIncome += payment.amount;
      continue;
    }
    
    const propertyId = unit.property_id;
    const existing = propertyGroups.get(propertyId) || [];
    existing.push({ tenantId: payment.tenant_id, amount: payment.amount });
    propertyGroups.set(propertyId, existing);
  }

  // Build income summary per property
  for (const [propId, paymentList] of propertyGroups) {
    const property = properties.find(p => p.id === propId);
    const propertyName = property?.name || 'Unbekannt';
    
    // Group by tenant
    const tenantTotals = new Map<string, number>();
    for (const p of paymentList) {
      const current = tenantTotals.get(p.tenantId) || 0;
      tenantTotals.set(p.tenantId, current + p.amount);
    }
    
    const tenantEntries: { tenantId: string; tenantName: string; amount: number }[] = [];
    for (const [tenantId, amount] of tenantTotals) {
      const tenant = tenants.find(t => t.id === tenantId);
      tenantEntries.push({
        tenantId,
        tenantName: tenant ? `${tenant.first_name} ${tenant.last_name}` : 'Unbekannt',
        amount,
      });
    }
    
    tenantEntries.sort((a, b) => b.amount - a.amount);
    
    incomeByProperty.push({
      propertyId: propId,
      propertyName,
      tenants: tenantEntries,
      total: paymentList.reduce((s, p) => s + p.amount, 0),
    });
  }

  // Add unassigned income
  if (unassignedIncome > 0) {
    incomeByProperty.push({
      propertyId: '',
      propertyName: 'Nicht zugeordnet',
      tenants: [{ tenantId: '', tenantName: '-', amount: unassignedIncome }],
      total: unassignedIncome,
    });
  }

  incomeByProperty.sort((a, b) => b.total - a.total);
  
  const totalIncome = periodPayments.reduce((s, p) => s + p.amount, 0);

  // Build table rows
  const incomeRows: string[][] = [];
  for (const prop of incomeByProperty) {
    // Property header row
    incomeRows.push([prop.propertyName, '', fmt(prop.total)]);
    // Tenant rows
    for (const tenant of prop.tenants) {
      incomeRows.push(['', tenant.tenantName, fmt(tenant.amount)]);
    }
  }

  autoTable(doc, {
    startY: currentY,
    head: [['Liegenschaft', 'Mieter', 'Einnahmen (IST)']],
    body: incomeRows,
    foot: [['Gesamt Einnahmen', '', fmt(totalIncome)]],
    theme: 'striped',
    headStyles: { fillColor: [34, 197, 94], textColor: 255 },
    footStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold' },
    columnStyles: {
      2: { halign: 'right' },
    },
    styles: { fontSize: 9 },
    margin: { left: 14, right: 14 },
    didParseCell: (data) => {
      // Bold property rows
      if (data.section === 'body' && data.row.raw && (data.row.raw as string[])[0] !== '') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [240, 253, 244];
      }
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 15;

  // Check if we need a new page
  if (currentY > 240) {
    doc.addPage();
    currentY = 20;
  }

  // ===== SECTION 3: Expenses by Category =====
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('3. Ausgaben nach Aufwandskonto', 14, currentY);
  currentY += 8;

  // Group expenses by category
  const expenseTransactions = periodTransactions.filter(t => t.amount < 0);
  
  type CategoryExpense = {
    categoryId: string;
    categoryName: string;
    transactions: { description: string; amount: number; date: string }[];
    total: number;
  };

  const expensesByCategory: CategoryExpense[] = [];
  const categoryGroups = new Map<string, TransactionData[]>();
  const noCategoryTx: TransactionData[] = [];

  for (const tx of expenseTransactions) {
    if (tx.category_id) {
      const existing = categoryGroups.get(tx.category_id) || [];
      existing.push(tx);
      categoryGroups.set(tx.category_id, existing);
    } else {
      noCategoryTx.push(tx);
    }
  }

  for (const [catId, txList] of categoryGroups) {
    const category = categories.find(c => c.id === catId);
    expensesByCategory.push({
      categoryId: catId,
      categoryName: category?.name || 'Unbekannt',
      transactions: txList.map(t => ({
        description: t.description || '-',
        amount: Math.abs(t.amount),
        date: t.transaction_date,
      })),
      total: txList.reduce((s, t) => s + Math.abs(t.amount), 0),
    });
  }

  if (noCategoryTx.length > 0) {
    expensesByCategory.push({
      categoryId: '',
      categoryName: 'Nicht kategorisiert',
      transactions: noCategoryTx.map(t => ({
        description: t.description || '-',
        amount: Math.abs(t.amount),
        date: t.transaction_date,
      })),
      total: noCategoryTx.reduce((s, t) => s + Math.abs(t.amount), 0),
    });
  }

  expensesByCategory.sort((a, b) => b.total - a.total);

  // Build expense summary table
  autoTable(doc, {
    startY: currentY,
    head: [['Aufwandskonto', 'Anzahl', 'Summe']],
    body: expensesByCategory.map(cat => [
      cat.categoryName,
      cat.transactions.length.toString(),
      fmt(cat.total),
    ]),
    foot: [['Gesamt Ausgaben', expenseTransactions.length.toString(), fmt(expenseTransactions.reduce((s, t) => s + Math.abs(t.amount), 0))]],
    theme: 'striped',
    headStyles: { fillColor: [239, 68, 68], textColor: 255 },
    footStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold' },
    columnStyles: {
      1: { halign: 'center' },
      2: { halign: 'right' },
    },
    styles: { fontSize: 9 },
    margin: { left: 14, right: 14 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 15;

  // Check if we need a new page
  if (currentY > 240) {
    doc.addPage();
    currentY = 20;
  }

  // ===== SECTION 4: Summary / Plausibility Check =====
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('4. Plausibilitätsprüfung', 14, currentY);
  currentY += 8;

  const totalOpeningBalance = accountSummaries.reduce((s, a) => s + a.openingBalance, 0);
  const totalIncomeForPlausibility = periodPayments.reduce((s, p) => s + p.amount, 0);
  const totalExpenses = expenseTransactions.reduce((s, t) => s + Math.abs(t.amount), 0);
  const calculatedClosingBalance = totalOpeningBalance + totalIncomeForPlausibility - totalExpenses;
  const actualClosingBalance = accountSummaries.reduce((s, a) => s + a.closingBalance, 0);
  const difference = calculatedClosingBalance - actualClosingBalance;

  autoTable(doc, {
    startY: currentY,
    head: [['Position', 'Betrag']],
    body: [
      ['Anfangsbestand (alle Konten)', fmt(totalOpeningBalance)],
      ['+ Einnahmen gesamt (IST)', fmt(totalIncomeForPlausibility)],
      ['- Ausgaben gesamt', fmt(totalExpenses)],
      ['= Berechneter Endbestand', fmt(calculatedClosingBalance)],
      ['Tatsächlicher Endbestand', fmt(actualClosingBalance)],
      ['Differenz', fmt(difference)],
    ],
    theme: 'plain',
    headStyles: { fillColor: [59, 130, 246], textColor: 255 },
    columnStyles: {
      1: { halign: 'right' },
    },
    styles: { fontSize: 10 },
    margin: { left: 14, right: 14 },
    didParseCell: (data) => {
      if (data.section === 'body') {
        const rowIdx = data.row.index;
        // Highlight calculated balance
        if (rowIdx === 3) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [240, 249, 255];
        }
        // Highlight difference
        if (rowIdx === 5 && data.column.index === 1) {
          data.cell.styles.fontStyle = 'bold';
          if (Math.abs(difference) < 0.01) {
            data.cell.styles.textColor = [34, 197, 94]; // Green if match
          } else {
            data.cell.styles.textColor = [239, 68, 68]; // Red if mismatch
          }
        }
      }
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 10;

  // Status message
  doc.setFontSize(11);
  if (Math.abs(difference) < 0.01) {
    doc.setTextColor(34, 197, 94);
    doc.text('✓ Plausibilitätsprüfung erfolgreich - Konten stimmen überein', 14, currentY);
  } else {
    doc.setTextColor(239, 68, 68);
    doc.text(`✗ Differenz von ${fmt(difference)} - bitte prüfen`, 14, currentY);
  }
  doc.setTextColor(0);

  // Save
  doc.save(`Plausibilitaetsreport_${selectedYear}.pdf`);
};

// ====== DETAILBERICHT ======
interface DetailReportParams {
  properties: PropertyData[];
  units: UnitData[];
  tenants: TenantData[];
  transactions: TransactionData[];
  categories: CategoryData[];
  selectedPropertyId: string;
  selectedYear: number;
  reportPeriod: 'monthly' | 'quarterly' | 'halfyearly' | 'yearly';
  selectedMonth?: number;
  expenses?: ExpenseData[];
}

export const generateDetailReport = ({
  properties,
  units,
  tenants,
  transactions,
  categories,
  selectedPropertyId,
  selectedYear,
  reportPeriod,
  selectedMonth,
  expenses,
}: DetailReportParams) => {
  const doc = new jsPDF();
  const periodLabel = reportPeriod === 'yearly' 
    ? `Jahr ${selectedYear}` 
    : `${monthNames[(selectedMonth || 1) - 1]} ${selectedYear}`;
  
  const selectedProperty = properties.find(p => p.id === selectedPropertyId);
  
  addHeader(
    doc, 
    'Detailbericht', 
    periodLabel,
    selectedPropertyId !== 'all' ? selectedProperty?.name : 'Alle Liegenschaften'
  );

  // Filter transactions by period
  const periodTransactions = transactions.filter(t => {
    const date = new Date(t.transaction_date);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    
    if (reportPeriod === 'yearly') {
      return year === selectedYear;
    }
    return year === selectedYear && month === selectedMonth;
  });

  // Filter units by property
  const filteredUnits = selectedPropertyId === 'all' 
    ? units 
    : units.filter(u => u.property_id === selectedPropertyId);

  // Group transactions by unit
  const unitTransactions = new Map<string, { income: number; expenses: number; transactions: TransactionData[] }>();
  
  filteredUnits.forEach(unit => {
    unitTransactions.set(unit.id, { income: 0, expenses: 0, transactions: [] });
  });

  periodTransactions.forEach(t => {
    if (t.unit_id && unitTransactions.has(t.unit_id)) {
      const data = unitTransactions.get(t.unit_id)!;
      if (t.amount > 0) {
        data.income += Number(t.amount);
      } else {
        data.expenses += Math.abs(Number(t.amount));
      }
      data.transactions.push(t);
    }
  });

  // Unassigned transactions
  const unassignedTransactions = periodTransactions.filter(t => 
    !t.unit_id || !unitTransactions.has(t.unit_id)
  );
  const unassignedIncome = unassignedTransactions.filter(t => t.amount > 0).reduce((sum, t) => sum + Number(t.amount), 0);
  const unassignedExpenses = unassignedTransactions.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);

  // Filter expenses by period and property
  const periodExpenses = (expenses || []).filter(e => {
    const date = new Date(e.datum);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    
    const matchesProp = selectedPropertyId === 'all' || e.property_id === selectedPropertyId;
    
    if (reportPeriod === 'yearly') {
      return matchesProp && year === selectedYear;
    }
    return matchesProp && year === selectedYear && month === selectedMonth;
  });

  // Group expenses by property
  const expensesByProperty = new Map<string, number>();
  periodExpenses.forEach(e => {
    const current = expensesByProperty.get(e.property_id) || 0;
    expensesByProperty.set(e.property_id, current + Number(e.betrag));
  });
  
  // Calculate total expenses from Kosten & Belege
  const totalExpensesFromCosts = periodExpenses.reduce((sum, e) => sum + Number(e.betrag), 0);

  // Group by property
  const propertiesData = new Map<string, { 
    property: PropertyData; 
    units: Array<{ unit: UnitData; income: number; expenses: number; tenant: TenantData | null }>; 
    totalIncome: number; 
    totalExpenses: number;
    expensesFromCosts: number;
  }>();

  const targetProperties = selectedPropertyId === 'all' 
    ? properties 
    : properties.filter(p => p.id === selectedPropertyId);

  targetProperties.forEach(prop => {
    propertiesData.set(prop.id, {
      property: prop,
      units: [],
      totalIncome: 0,
      totalExpenses: 0,
      expensesFromCosts: expensesByProperty.get(prop.id) || 0,
    });
  });

  filteredUnits.forEach(unit => {
    const data = unitTransactions.get(unit.id);
    if (data && propertiesData.has(unit.property_id)) {
      const propData = propertiesData.get(unit.property_id)!;
      const activeTenant = tenants.find(t => t.unit_id === unit.id && t.status === 'aktiv') || null;
      propData.units.push({
        unit,
        income: data.income,
        expenses: data.expenses,
        tenant: activeTenant,
      });
      propData.totalIncome += data.income;
      propData.totalExpenses += data.expenses;
    }
  });

  let currentY = 50;

  // Generate tables for each property
  Array.from(propertiesData.values()).forEach((propData, index) => {
    if (index > 0) {
      // Check if we need a new page
      if (currentY > 230) {
        doc.addPage();
        currentY = 20;
      }
    }

    // Property header
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(propData.property.name, 14, currentY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`${propData.property.address}, ${propData.property.postal_code} ${propData.property.city}`, 14, currentY + 5);
    doc.setTextColor(0);

    // Summary - include expenses from Kosten & Belege
    const combinedExpenses = propData.totalExpenses + propData.expensesFromCosts;
    doc.setFontSize(10);
    doc.text(`Einnahmen: ${formatCurrency(propData.totalIncome)} | Ausgaben: ${formatCurrency(combinedExpenses)} | Saldo: ${formatCurrency(propData.totalIncome - combinedExpenses)}`, 14, currentY + 12);
    if (propData.expensesFromCosts > 0) {
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(`(davon ${formatCurrency(propData.expensesFromCosts)} aus Belegen)`, 14, currentY + 18);
      doc.setTextColor(0);
      currentY += 6;
    }

    currentY += 18;

    // Units table
    const tableBody = propData.units
      .sort((a, b) => a.unit.top_nummer.localeCompare(b.unit.top_nummer))
      .map(unitData => {
        const saldo = unitData.income - unitData.expenses;
        return [
          `${unitData.unit.top_nummer}`,
          unitData.tenant ? `${unitData.tenant.first_name} ${unitData.tenant.last_name}` : 'Leerstand',
          formatCurrency(unitData.income),
          formatCurrency(unitData.expenses),
          formatCurrency(saldo),
        ];
      });

    if (tableBody.length > 0) {
      autoTable(doc, {
        startY: currentY,
        head: [['Einheit', 'Mieter', 'Einnahmen', 'Ausgaben', 'Saldo']],
        body: tableBody,
        theme: 'plain',
        headStyles: { fillColor: [229, 231, 235], textColor: [0, 0, 0], fontStyle: 'bold' },
        styles: { fontSize: 9 },
        columnStyles: {
          2: { halign: 'right' },
          3: { halign: 'right' },
          4: { halign: 'right' },
        },
      });
      currentY = (doc as any).lastAutoTable?.finalY + 15 || currentY + 50;
    } else {
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text('Keine Einheiten mit Transaktionen', 14, currentY);
      doc.setTextColor(0);
      currentY += 15;
    }
  });

  // Unassigned transactions section
  if (unassignedTransactions.length > 0) {
    if (currentY > 230) {
      doc.addPage();
      currentY = 20;
    }

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Nicht zugeordnete Buchungen', 14, currentY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`${unassignedTransactions.length} Transaktionen ohne Einheitszuordnung`, 14, currentY + 5);
    doc.setTextColor(0);
    currentY += 12;

    doc.setFontSize(10);
    doc.text(`Einnahmen: ${formatCurrency(unassignedIncome)} | Ausgaben: ${formatCurrency(unassignedExpenses)} | Saldo: ${formatCurrency(unassignedIncome - unassignedExpenses)}`, 14, currentY);
    currentY += 10;

    // Show first 20 unassigned transactions
    const unassignedBody = unassignedTransactions.slice(0, 20).map(t => {
      const category = categories.find(c => c.id === t.category_id);
      return [
        new Date(t.transaction_date).toLocaleDateString('de-AT'),
        t.description || '-',
        category?.name || '-',
        formatCurrency(t.amount),
      ];
    });

    autoTable(doc, {
      startY: currentY,
      head: [['Datum', 'Beschreibung', 'Kategorie', 'Betrag']],
      body: unassignedBody,
      theme: 'plain',
      headStyles: { fillColor: [254, 226, 226], textColor: [0, 0, 0], fontStyle: 'bold' },
      styles: { fontSize: 8 },
      columnStyles: {
        3: { halign: 'right' },
      },
    });

    if (unassignedTransactions.length > 20) {
      currentY = (doc as any).lastAutoTable?.finalY + 5 || currentY + 50;
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(`... und ${unassignedTransactions.length - 20} weitere nicht zugeordnete Buchungen`, 14, currentY);
      doc.setTextColor(0);
    }
  }

  // Grand total - include expenses from Kosten & Belege
  const grandTotalIncome = Array.from(propertiesData.values()).reduce((sum, p) => sum + p.totalIncome, 0) + unassignedIncome;
  const grandTotalExpensesFromTransactions = Array.from(propertiesData.values()).reduce((sum, p) => sum + p.totalExpenses, 0) + unassignedExpenses;
  const grandTotalExpensesFromCosts = Array.from(propertiesData.values()).reduce((sum, p) => sum + p.expensesFromCosts, 0);
  const grandTotalExpenses = grandTotalExpensesFromTransactions + grandTotalExpensesFromCosts;
  
  currentY = (doc as any).lastAutoTable?.finalY + 15 || currentY + 15;
  
  if (currentY > 260) {
    doc.addPage();
    currentY = 20;
  }

  doc.setFillColor(219, 234, 254);
  doc.roundedRect(14, currentY, 180, grandTotalExpensesFromCosts > 0 ? 35 : 25, 3, 3, 'F');
  
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Gesamtübersicht', 20, currentY + 8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Einnahmen: ${formatCurrency(grandTotalIncome)} | Ausgaben: ${formatCurrency(grandTotalExpenses)} | Saldo: ${formatCurrency(grandTotalIncome - grandTotalExpenses)}`, 20, currentY + 18);
  if (grandTotalExpensesFromCosts > 0) {
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Ausgaben: ${formatCurrency(grandTotalExpensesFromTransactions)} (Banking) + ${formatCurrency(grandTotalExpensesFromCosts)} (Belege)`, 20, currentY + 28);
    doc.setTextColor(0);
  }

  doc.save(`Detailbericht_${periodLabel.replace(' ', '_')}.pdf`);
};

// ====== KAUTION REPORT ======
interface KautionTenantData {
  id: string;
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  kaution: number;
  kaution_bezahlt: boolean;
  unit_id: string;
  mietbeginn?: string | null;
}

interface KautionUnitData {
  id: string;
  top_nummer: string;
  property_id: string;
}

interface KautionPropertyData {
  id: string;
  name: string;
  address: string;
}

export const generateKautionsReport = (
  tenants: KautionTenantData[],
  units: KautionUnitData[],
  properties: KautionPropertyData[],
  selectedPropertyId: string
) => {
  const doc = new jsPDF();
  
  const selectedProperty = properties.find(p => p.id === selectedPropertyId);
  
  addHeader(
    doc, 
    'Kautionsübersicht', 
    `Stand: ${new Date().toLocaleDateString('de-AT')}`,
    selectedPropertyId !== 'all' ? selectedProperty?.name : 'Alle Liegenschaften'
  );

  // Filter tenants with kaution_bezahlt = true
  const tenantsWithKaution = tenants.filter(t => {
    if (!t.kaution_bezahlt || !t.kaution || Number(t.kaution) <= 0) return false;
    
    if (selectedPropertyId === 'all') return true;
    
    const unit = units.find(u => u.id === t.unit_id);
    return unit?.property_id === selectedPropertyId;
  });

  // Sort by property, then by unit
  const sortedTenants = tenantsWithKaution.sort((a, b) => {
    const unitA = units.find(u => u.id === a.unit_id);
    const unitB = units.find(u => u.id === b.unit_id);
    const propA = properties.find(p => p.id === unitA?.property_id);
    const propB = properties.find(p => p.id === unitB?.property_id);
    
    if (propA?.name !== propB?.name) {
      return (propA?.name || '').localeCompare(propB?.name || '');
    }
    return (unitA?.top_nummer || '').localeCompare(unitB?.top_nummer || '');
  });

  // Calculate total
  const totalKaution = sortedTenants.reduce((sum, t) => sum + Number(t.kaution), 0);

  // Create table data
  const tableData = sortedTenants.map(tenant => {
    const unit = units.find(u => u.id === tenant.unit_id);
    const property = properties.find(p => p.id === unit?.property_id);
    
    return [
      property?.name || '-',
      unit?.top_nummer || '-',
      `${tenant.first_name} ${tenant.last_name}`,
      tenant.mietbeginn ? new Date(tenant.mietbeginn).toLocaleDateString('de-AT') : '-',
      formatCurrency(Number(tenant.kaution)),
    ];
  });

  // Add table
  autoTable(doc, {
    startY: 45,
    head: [['Liegenschaft', 'Einheit', 'Mieter', 'Mietbeginn', 'Kaution']],
    body: tableData,
    theme: 'striped',
    headStyles: { fillColor: [59, 130, 246], textColor: [255, 255, 255], fontStyle: 'bold' },
    styles: { fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 45 },
      1: { cellWidth: 25 },
      2: { cellWidth: 50 },
      3: { cellWidth: 30 },
      4: { halign: 'right', cellWidth: 30 },
    },
  });

  // Add summary
  const finalY = (doc as any).lastAutoTable?.finalY + 15 || 200;
  
  doc.setFillColor(219, 234, 254);
  doc.roundedRect(14, finalY, 180, 25, 3, 3, 'F');
  
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Zusammenfassung', 20, finalY + 8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Anzahl Mietkautionen: ${sortedTenants.length}`, 20, finalY + 18);
  doc.text(`Gesamtsumme: ${formatCurrency(totalKaution)}`, 100, finalY + 18);

  doc.save(`Kautionsuebersicht_${new Date().toISOString().split('T')[0]}.pdf`);
};
