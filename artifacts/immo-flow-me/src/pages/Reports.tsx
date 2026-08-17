import { useState, useCallback, useMemo } from 'react';
import { getActiveTenantsForPeriod } from '@/utils/tenantFilterUtils';
import { useQueryClient } from '@tanstack/react-query';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  TrendingUp,
  Home,
  Euro,
  FileText,
  Download,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  Building2,
  Receipt,
  AlertCircle,
  Plus,
  Calculator,
  Wallet,
} from 'lucide-react';
import { useProperties } from '@/hooks/useProperties';
import { useUnits } from '@/hooks/useUnits';
import { useTenants } from '@/hooks/useTenants';
import { useInvoices } from '@/hooks/useInvoices';
import { useExpenses, expenseTypeLabels } from '@/hooks/useExpenses';
import { usePayments } from '@/hooks/usePayments';
import { useTransactions } from '@/hooks/useTransactions';
import { useAccountCategories } from '@/hooks/useAccountCategories';
import { usePaymentSync } from '@/hooks/usePaymentSync';
import { useCombinedPayments } from '@/hooks/useCombinedPayments';
import { useMrgAllocation } from '@/hooks/useMrgAllocation';
import { allocatePayment, type InvoiceAmounts } from '@/lib/paymentAllocation';
import { toast } from 'sonner';
import {
  generateRenditeReport,
  generateLeerstandReport,
  generateUmsatzReport,
  generateUstVoranmeldung,
  generateOffenePostenReport,
  generatePlausibilityReport,
  generateDetailReport,
  generateKautionsReport,
  type PaymentData,
  type TransactionData,
  type CategoryData,
} from '@/utils/reportPdfExport';
import { useBankAccounts } from '@/hooks/useBankAccounts';
import { useMrgAllocationYearly } from '@/hooks/useMrgAllocationYearly';
import { DataConsistencyAlert } from '@/components/banking/DataConsistencyAlert';
import { exportToCSV, formatDate, formatCurrency as formatCurrencyCSV } from '@/utils/csvExport';
import { FileSpreadsheet } from 'lucide-react';

// Berechnet Netto aus Brutto
const calculateNetFromGross = (gross: number, vatRate: number): number => {
  if (vatRate === 0) return gross;
  return gross / (1 + vatRate / 100);
};

// Berechnet USt aus Brutto
const calculateVatFromGross = (gross: number, vatRate: number): number => {
  if (vatRate === 0) return 0;
  return gross - (gross / (1 + vatRate / 100));
};

const unitTypeLabels: Record<string, string> = {
  wohnung: 'Wohnung',
  geschaeft: 'Geschäft',
  garage: 'Garage',
  stellplatz: 'Stellplatz',
  lager: 'Lager',
};

// Kategorien für Instandhaltung (mindern Rendite)
const INSTANDHALTUNG_CATEGORIES = ['Instandhaltung', 'Reparaturen'];

// Kategorien für Betriebskosten (werden auf Mieter umgelegt, mindern NICHT die Rendite)
const BETRIEBSKOSTEN_CATEGORIES = [
  'Versicherungen', 'Lift/Aufzug', 'Heizung', 'Wasser/Abwasser', 
  'Strom Allgemein', 'Müllabfuhr', 'Hausbetreuung/Reinigung', 
  'Gartenpflege', 'Schneeräumung', 'Grundsteuer', 'Verwaltungskosten'
];

// Kategorien für Sonstige Kosten (weder umlagefähig noch renditemin.)
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

const reports = [
  {
    id: 'rendite',
    title: 'Renditereport',
    description: 'Übersicht der Rendite pro Liegenschaft und gesamt',
    icon: TrendingUp,
    color: 'bg-success/10 text-success',
  },
  {
    id: 'leerstand',
    title: 'Leerstandsreport',
    description: 'Analyse der Leerstandsquote und Dauer',
    icon: Home,
    color: 'bg-warning/10 text-warning',
  },
  {
    id: 'umsatz',
    title: 'Umsatzreport',
    description: 'Monatliche und jährliche Umsatzübersicht',
    icon: Euro,
    color: 'bg-primary/10 text-primary',
  },
  {
    id: 'plausibilitaet',
    title: 'Plausibilitätsreport',
    description: 'Kontenabgleich: Anfangsbestand + Einnahmen - Ausgaben = Endbestand',
    icon: Calculator,
    color: 'bg-emerald-500/10 text-emerald-600',
  },
  {
    id: 'ust',
    title: 'USt-Voranmeldung',
    description: 'Umsatzsteuer vs. Vorsteuer für das Finanzamt',
    icon: FileText,
    color: 'bg-accent/10 text-accent-foreground',
  },
  {
    id: 'offeneposten',
    title: 'Offene Posten Liste',
    description: 'Übersicht aller unbezahlten Rechnungen',
    icon: AlertCircle,
    color: 'bg-destructive/10 text-destructive',
  },
  {
    id: 'detailbericht',
    title: 'Detailbericht',
    description: 'Einnahmen & Ausgaben pro Einheit/Liegenschaft',
    icon: Building2,
    color: 'bg-blue-500/10 text-blue-600',
  },
  {
    id: 'mietvorschreibung',
    title: 'Mietvorschreibungen',
    description: 'Monatliche Miete, BK & HK pro Mieter',
    icon: Receipt,
    color: 'bg-purple-500/10 text-purple-600',
  },
  {
    id: 'kaution',
    title: 'Kautionsübersicht',
    description: 'Übersicht aller bezahlten Mietkautionen',
    icon: Wallet,
    color: 'bg-teal-500/10 text-teal-600',
  },
  {
    id: 'vertragsablauf',
    title: 'Vertragsablauf',
    description: 'Mietverträge die bald auslaufen',
    icon: Calendar,
    color: 'bg-orange-500/10 text-orange-600',
  },
];

const monthNames = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

export default function Reports() {
  const currentDate = new Date();
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<number>(2025); // Default to 2025 for simulation data
  const [selectedMonth, setSelectedMonth] = useState<number>(12); // Default to December 2025
  const [reportPeriod, setReportPeriod] = useState<'monthly' | 'quarterly' | 'halfyearly' | 'yearly'>('monthly');
  const [selectedQuarter, setSelectedQuarter] = useState<number>(4); // Q1=1, Q2=2, Q3=3, Q4=4
  const [selectedHalfYear, setSelectedHalfYear] = useState<number>(2); // H1=1, H2=2
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [isGeneratingInvoices, setIsGeneratingInvoices] = useState(false);
  
  const queryClient = useQueryClient();
  
  const { data: properties, isLoading: isLoadingProperties } = useProperties();
  const { data: allUnits, isLoading: isLoadingUnits } = useUnits();
  const { data: allTenants, isLoading: isLoadingTenants } = useTenants();
  const { data: allInvoices, isLoading: isLoadingInvoices, refetch: refetchInvoices } = useInvoices();
  const { data: allExpenses, isLoading: isLoadingExpenses } = useExpenses();
  const { data: allPayments, isLoading: isLoadingPayments } = usePayments();
  const { data: allTransactions, isLoading: isLoadingTransactions } = useTransactions();
  const { data: categories, isLoading: isLoadingCategories } = useAccountCategories();
  const { data: bankAccounts, isLoading: isLoadingBankAccounts } = useBankAccounts();
  const { syncExistingPaymentsToTransactions } = usePaymentSync();
  const { data: combinedPayments, isLoading: isLoadingCombined } = useCombinedPayments();
  
  // Central MRG allocation for Offene Posten - uses same logic as PaymentList
  const { allocations: mrgAllocationsMonthly, totals: mrgTotalsMonthly, isLoading: mrgLoadingMonthly } = useMrgAllocation(
    selectedPropertyId,
    selectedYear,
    selectedMonth
  );
  
  // Yearly MRG allocation für jährliche Reports
  const { allocations: mrgAllocationsYearly, totals: mrgTotalsYearly, isLoading: mrgLoadingYearly } = useMrgAllocationYearly(
    selectedPropertyId,
    selectedYear,
    12 // Alle 12 Monate
  );
  
  // Verwende je nach reportPeriod die richtige Berechnung
  const mrgAllocations = reportPeriod === 'yearly' ? mrgAllocationsYearly : mrgAllocationsMonthly;
  const mrgTotals = reportPeriod === 'yearly' ? mrgTotalsYearly : mrgTotalsMonthly;
  const mrgLoading = reportPeriod === 'yearly' ? mrgLoadingYearly : mrgLoadingMonthly;

  const isLoading = isLoadingProperties || isLoadingUnits || isLoadingTenants || isLoadingInvoices || isLoadingExpenses || isLoadingPayments || isLoadingTransactions || isLoadingCategories || isLoadingBankAccounts || isLoadingCombined || mrgLoading;

  // Generate monthly invoices for the selected period
  const handleGenerateInvoices = useCallback(async () => {
    setIsGeneratingInvoices(true);
    try {
      const response = await fetch('/api/functions/generate-monthly-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ year: selectedYear, month: selectedMonth })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Fehler bei der Vorschreibungsgenerierung');
      }

      const result = await response.json();
      
      if (result.created > 0) {
        toast.success(`${result.created} Vorschreibung(en) für ${monthNames[selectedMonth - 1]} ${selectedYear} erstellt`);
      } else if (result.skipped > 0) {
        toast.info(`Alle ${result.skipped} Mieter haben bereits Vorschreibungen für ${monthNames[selectedMonth - 1]} ${selectedYear}`);
      } else {
        toast.warning('Keine aktiven Mieter gefunden');
      }
      
      // Refresh invoices data
      await refetchInvoices();
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    } catch (error) {
      console.error('Error generating invoices:', error);
      toast.error(`Fehler beim Erstellen der Vorschreibungen: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`);
    } finally {
      setIsGeneratingInvoices(false);
    }
  }, [selectedYear, selectedMonth, refetchInvoices, queryClient]);

  // Generate year options (last 5 years)
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentDate.getFullYear() - i);

  // Filter data by selected property
  const units = selectedPropertyId === 'all' 
    ? allUnits 
    : allUnits?.filter(u => u.property_id === selectedPropertyId);
  
  const expenses = selectedPropertyId === 'all'
    ? allExpenses
    : allExpenses?.filter(e => e.property_id === selectedPropertyId);

  // Get unit IDs for filtering invoices
  const unitIds = units?.map(u => u.id) || [];
  const invoices = selectedPropertyId === 'all'
    ? allInvoices
    : allInvoices?.filter(inv => {
      // Look up unit via tenant for invoice filtering
      const tenant = allTenants?.find(t => t.id === inv.tenant_id);
      return tenant && unitIds.includes(tenant.unit_id);
    });

  const selectedProperty = properties?.find(p => p.id === selectedPropertyId);

  // Filter invoices by selected period
  const periodInvoices = invoices?.filter(inv => {
    if (reportPeriod === 'yearly') {
      return inv.year === selectedYear;
    }
    return inv.year === selectedYear && inv.month === selectedMonth;
  }) || [];

  // Filter expenses by selected period
  const periodExpenses = expenses?.filter(exp => {
    if (reportPeriod === 'yearly') {
      return exp.year === selectedYear;
    }
    return exp.year === selectedYear && exp.month === selectedMonth;
  }) || [];

  // ====== TRANSAKTIONEN FILTERN ======
  // Bei Property-Filter: auch Transaktionen einbeziehen die über unit_id zur Property gehören
  const periodTransactions = allTransactions?.filter(t => {
    const date = new Date(t.transaction_date);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    
    // Property-Filter: direkt ODER über unit_id ODER alle wenn 'all' ausgewählt
    let propertyMatch = selectedPropertyId === 'all';
    if (!propertyMatch) {
      // Direkte Property-Zuordnung
      if (t.property_id === selectedPropertyId) {
        propertyMatch = true;
      }
      // Über Unit-Zuordnung
      else if (t.unit_id) {
        const unit = allUnits?.find(u => u.id === t.unit_id);
        propertyMatch = unit?.property_id === selectedPropertyId;
      }
    }
    
    if (reportPeriod === 'yearly') {
      return year === selectedYear && propertyMatch;
    }
    return year === selectedYear && month === selectedMonth && propertyMatch;
  }) || [];

  // ====== KOMBINIERTE ZAHLUNGEN (payments + transactions mit tenant_id) ======
  // Filtere nach Zeitraum UND Liegenschaft (über Mieter -> Unit -> Property)
  const periodCombinedPayments = useMemo(() => {
    // Ermittle Unit-IDs der ausgewählten Liegenschaft
    const propertyUnitIds = selectedPropertyId === 'all' 
      ? null 
      : allUnits?.filter(u => u.propertyId === selectedPropertyId).map(u => u.id) || [];
    
    return (combinedPayments || []).filter(p => {
      const date = new Date(p.date);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      
      // Zeitraum-Filter (alle Perioden: monthly, quarterly, halfyearly, yearly)
      if (year !== selectedYear) return false;
      
      // Berechne Zeitraum-Grenzen basierend auf reportPeriod
      let startMonth: number, endMonth: number;
      switch (reportPeriod) {
        case 'quarterly':
          startMonth = (selectedQuarter - 1) * 3 + 1;
          endMonth = selectedQuarter * 3;
          break;
        case 'halfyearly':
          startMonth = selectedHalfYear === 1 ? 1 : 7;
          endMonth = selectedHalfYear === 1 ? 6 : 12;
          break;
        case 'yearly':
          startMonth = 1;
          endMonth = 12;
          break;
        default: // monthly
          startMonth = selectedMonth;
          endMonth = selectedMonth;
      }
      
      if (month < startMonth || month > endMonth) return false;
      
      // Property-Filter (über Mieter -> Unit -> Property)
      // Note: p.tenant_id is from combinedPayments (snake_case), tenant fields are camelCase
      if (propertyUnitIds !== null) {
        const tenant = allTenants?.find(t => t.id === p.tenant_id);
        if (!tenant || !propertyUnitIds.includes(tenant.unitId)) {
          return false;
        }
      }
      
      return true;
    });
  }, [combinedPayments, reportPeriod, selectedYear, selectedMonth, selectedQuarter, selectedHalfYear, selectedPropertyId, allUnits, allTenants]);

  // Kategorie-IDs ermitteln
  const mieteinnahmenCategoryId = categories?.find(c => c.name === 'Mieteinnahmen')?.id;
  const bkVorauszCategoryId = categories?.find(c => c.name === 'Betriebskostenvorauszahlungen')?.id;
  const hkVorauszCategoryId = categories?.find(c => c.name === 'Heizungskostenvorauszahlungen')?.id;
  const instandhaltungCategoryIds = categories
    ?.filter(c => INSTANDHALTUNG_CATEGORIES.includes(c.name))
    .map(c => c.id) || [];
  const betriebskostenCategoryIds = categories
    ?.filter(c => BETRIEBSKOSTEN_CATEGORIES.includes(c.name))
    .map(c => c.id) || [];

  // ====== IST-EINNAHMEN AUS KOMBINIERTEN ZAHLUNGEN (NUR MIETE-ANTEIL) ======
  // Zahlungsaufteilung: BK → Heizung → Miete
  // Für die Buchhaltungsübersicht zeigen wir nur den Miete-Anteil
  
  const paymentAllocationDetails = useMemo(() => {
    let totalMieteAnteil = 0;
    let totalBkAnteil = 0;
    let totalHkAnteil = 0;
    let totalGesamt = 0;
    
    periodCombinedPayments.forEach(p => {
      // Finde den Mieter für diese Zahlung (supports both tenantId and tenant_id)
      const paymentTenantId = (p as any).tenantId ?? p.tenant_id;
      const tenant = allTenants?.find(t => t.id === paymentTenantId);
      if (!tenant) {
        // Wenn kein Mieter gefunden, zähle alles als Miete
        totalMieteAnteil += Number(p.amount);
        totalGesamt += Number(p.amount);
        return;
      }
      
      // Ermittle Jahr/Monat der Zahlung
      const paymentDate = new Date(p.date);
      const paymentYear = paymentDate.getFullYear();
      const paymentMonth = paymentDate.getMonth() + 1;
      
      // WICHTIG: SOLL-Beträge aus Vorschreibung (monthlyInvoice) statt Mieter-Stammdaten!
      // Die Vorschreibung enthält die tatsächlichen Soll-Beträge für den spezifischen Monat
      const invoice = allInvoices?.find(inv => 
        ((inv as any).tenantId ?? inv.tenant_id) === paymentTenantId && 
        inv.year === paymentYear && 
        inv.month === paymentMonth
      );
      
      // Fallback auf Mieter-Stammdaten nur wenn keine Vorschreibung existiert
      // Supports both camelCase and snake_case field names
      const invoiceAmounts: InvoiceAmounts = invoice ? {
        grundmiete: Number(invoice.grundmiete || 0),
        betriebskosten: Number(invoice.betriebskosten || 0),
        heizungskosten: Number(invoice.heizungskosten || 0),
        gesamtbetrag: Number(invoice.gesamtbetrag || 0)
      } : {
        grundmiete: Number(tenant.grundmiete || 0),
        betriebskosten: Number(tenant.betriebskostenVorschuss ?? tenant.betriebskosten_vorschuss ?? 0),
        heizungskosten: Number(tenant.heizungskostenVorschuss ?? tenant.heizungskosten_vorschuss ?? 0),
        gesamtbetrag: Number(tenant.grundmiete || 0) + 
                      Number(tenant.betriebskostenVorschuss ?? tenant.betriebskosten_vorschuss ?? 0) + 
                      Number(tenant.heizungskostenVorschuss ?? tenant.heizungskosten_vorschuss ?? 0)
      };
      
      // Berechne die Zuordnung (BK → Heizung → Miete)
      const allocation = allocatePayment(Number(p.amount), invoiceAmounts, false);
      
      totalBkAnteil += allocation.allocation.betriebskosten_anteil;
      totalHkAnteil += allocation.allocation.heizung_anteil;
      totalMieteAnteil += allocation.allocation.miete_anteil;
      // Gesamt = Summe der allozierten Anteile (konsistent mit BK+HK+Miete)
      totalGesamt += allocation.allocation.betriebskosten_anteil + 
                     allocation.allocation.heizung_anteil + 
                     allocation.allocation.miete_anteil;
    });
    
    return {
      mieteAnteil: totalMieteAnteil,
      bkAnteil: totalBkAnteil,
      hkAnteil: totalHkAnteil,
      gesamt: totalGesamt  // Jetzt = bkAnteil + hkAnteil + mieteAnteil
    };
  }, [periodCombinedPayments, allTenants, allInvoices]);
  
  // IST-Einnahmen = NUR Miete-Anteil (ohne BK und Heizung)
  const totalIstEinnahmenMiete = paymentAllocationDetails.mieteAnteil;
  const totalIstEinnahmenGesamt = paymentAllocationDetails.gesamt;
  
  // Für Abwärtskompatibilität
  const totalIstEinnahmen = totalIstEinnahmenMiete;
  const totalPaymentsAmount = totalIstEinnahmenGesamt;
  
  // Aufschlüsselung nach Mieter/Unit (für spätere Zuordnung)
  const paymentsByTenant = new Map<string, number>();
  periodCombinedPayments.forEach(p => {
    const paymentTenantId = (p as any).tenantId ?? p.tenant_id;
    const current = paymentsByTenant.get(paymentTenantId) || 0;
    paymentsByTenant.set(paymentTenantId, current + Number(p.amount));
  });


  // ====== AUSGABEN AUS TRANSAKTIONEN (negative Beträge) ======
  const incomeTransactions = periodTransactions.filter(t => Number(t.amount) > 0);
  const expenseTransactions = periodTransactions.filter(t => Number(t.amount) < 0);

  // ====== IST-EINNAHMEN AUS TRANSAKTIONEN (kategorisiert) ======
  // Mieteinnahmen aus Transaktionen mit Kategorie "Mieteinnahmen"
  const mieteFromTransactions = incomeTransactions
    .filter(t => t.category_id === mieteinnahmenCategoryId)
    .reduce((sum, t) => sum + Number(t.amount), 0);
  
  // Betriebskostenvorauszahlungen aus Transaktionen
  const bkFromTransactions = incomeTransactions
    .filter(t => t.category_id === bkVorauszCategoryId)
    .reduce((sum, t) => sum + Number(t.amount), 0);
  
  // Heizungskostenvorauszahlungen aus Transaktionen
  const hkFromTransactions = incomeTransactions
    .filter(t => t.category_id === hkVorauszCategoryId)
    .reduce((sum, t) => sum + Number(t.amount), 0);

  // Instandhaltungskosten (mindern die Rendite)
  const instandhaltungskostenFromTransactions = expenseTransactions
    .filter(t => instandhaltungCategoryIds.includes(t.category_id || ''))
    .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);

  // Betriebskosten (werden umgelegt, mindern NICHT die Rendite)
  const betriebskostenFromTransactions = expenseTransactions
    .filter(t => betriebskostenCategoryIds.includes(t.category_id || ''))
    .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);

  // Gesamtausgaben aus Transaktionen
  const totalExpensesFromTransactions = expenseTransactions
    .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);

  // ====== AUSGABEN AUS KOSTEN & BELEGE (expenses table) ======
  // Kategorien für Betriebskosten aus expenses
  const expenseTypeToBetriebskosten = [
    'versicherung', 'grundsteuer', 'muellabfuhr', 'wasser_abwasser', 
    'strom_allgemein', 'hausbetreuung', 'lift', 'gartenpflege', 
    'schneeraeumung', 'verwaltung', 'ruecklage', 'heizung'
  ];
  const expenseTypeToInstandhaltung = ['reparatur', 'sanierung'];
  const expenseTypeToSonstigeKosten = ['makler', 'notar', 'grundbuch', 'finanzierung'];
  
  const betriebskostenFromExpenses = periodExpenses
    .filter(e => expenseTypeToBetriebskosten.includes(e.expenseType))
    .reduce((sum, e) => sum + Number(e.betrag), 0);
  
  const instandhaltungFromExpenses = periodExpenses
    .filter(e => expenseTypeToInstandhaltung.includes(e.expenseType))
    .reduce((sum, e) => sum + Number(e.betrag), 0);
    
  // Sonstige Kosten aus expenses (nicht umlagefähig, nicht renditemin.)
  const sonstigeKostenFromExpenses = periodExpenses
    .filter(e => e.category === 'sonstige_kosten' || expenseTypeToSonstigeKosten.includes(e.expenseType))
    .reduce((sum, e) => sum + Number(e.betrag), 0);
  
  const totalExpensesFromCosts = periodExpenses
    .reduce((sum, e) => sum + Number(e.betrag), 0);

  // ====== KOMBINIERTE AUSGABEN (Transaktionen + Kosten & Belege) ======
  const combinedBetriebskosten = betriebskostenFromTransactions + betriebskostenFromExpenses;
  const combinedInstandhaltung = instandhaltungskostenFromTransactions + instandhaltungFromExpenses;
  const combinedSonstigeKosten = sonstigeKostenFromExpenses; // Nur aus expenses, keine Transaktionen-Kategorie
  const combinedTotalExpenses = totalExpensesFromTransactions + totalExpensesFromCosts;

  // ====== RENDITE-BERECHNUNG (IST-Basis) ======
  // Nettoertrag = IST-Mieteinnahmen - Instandhaltungskosten (Banking + Belege)
  const nettoertrag = mieteFromTransactions - combinedInstandhaltung;
  const annualNettoertrag = reportPeriod === 'monthly' ? nettoertrag * 12 : nettoertrag;

  // Vacancy rate
  const totalUnits = units?.length || 0;
  const vacantUnits = units?.filter(u => u.status === 'leerstand').length || 0;
  const vacancyRate = totalUnits > 0 ? (vacantUnits / totalUnits) * 100 : 0;

  // Property value estimation
  const totalQm = selectedPropertyId === 'all'
    ? properties?.reduce((sum, p) => sum + Number((p as any).totalQm || (p as any).total_qm || 0), 0) || 0
    : Number((selectedProperty as any)?.totalQm || (selectedProperty as any)?.total_qm || 0);
  const estimatedPropertyValue = totalQm * 3000; // €3000 per m² estimate
  
  // Rendite basierend auf Transaktionen (Mieteinnahmen aus kategorisierten Transaktionen)
  const annualYieldFromTransactions = estimatedPropertyValue > 0 
    ? (annualNettoertrag / estimatedPropertyValue) * 100 
    : 0;

  // ====== UST BERECHNUNG - KOMBINIERT AUS TRANSAKTIONEN UND INVOICES ======
  // USt-Sätze nach Einheitstyp (österreichische Regelung):
  // - Wohnung: Miete 10%, BK 10%, Heizung 20%
  // - Geschäft/Stellplatz: Alles 20%
  // - Garage: Alles 20%
  
  // Hilfsfunktion: USt-Satz nach Einheitstyp ermitteln
  const getVatRateForUnit = (unitId: string | null | undefined, component: 'miete' | 'bk' | 'heizung'): number => {
    if (!unitId) return 20; // Default 20% wenn keine Unit
    const unit = allUnits?.find(u => u.id === unitId);
    if (!unit) return 20;
    
    const unitType = unit.type;
    
    // Geschäft, Stellplatz, Garage = alles 20%
    if (unitType === 'geschaeft' || unitType === 'stellplatz' || unitType === 'garage') {
      return 20;
    }
    
    // Wohnung, Lager, Sonstiges
    if (component === 'heizung') {
      return 20; // Heizung ist immer 20%
    }
    return 10; // Miete und BK für Wohnungen = 10%
  };
  
  // ====== SOLL-VERSTEUERUNG: USt BASIERT AUF SOLL-WERTEN AUS MIETERN ======
  // Bei Soll-Versteuerung entsteht die USt-Schuld mit Rechnungsstellung,
  // basierend auf den monatlichen SOLL-Werten der aktiven Mieter
  
  // Berechne SOLL-Werte aus aktiven Mietern für den Zeitraum
  // Verwendet zentrale Utility-Funktion für konsistente Logik
  const relevantTenants = getActiveTenantsForPeriod(
    allUnits || [],
    allTenants || [],
    selectedPropertyId,
    selectedYear,
    reportPeriod === 'monthly' ? selectedMonth : undefined
  );
  
  // Ermittle Mieter mit zukünftigem Mietbeginn (für Warnhinweis)
  const futureTenants = useMemo(() => {
    if (!allTenants || !allUnits) return [];
    
    // Filter nach Property wenn ausgewählt
    const relevantUnitIds = selectedPropertyId === 'all' 
      ? allUnits.map(u => u.id)
      : allUnits.filter(u => u.propertyId === selectedPropertyId).map(u => u.id);
    
    return allTenants.filter(t => {
      if (t.status !== 'aktiv') return false;
      if (!relevantUnitIds.includes(t.unitId)) return false;
      if (!t.mietbeginn) return false;
      
      const mietbeginn = new Date(t.mietbeginn);
      const mietbeginnYear = mietbeginn.getFullYear();
      const mietbeginnMonth = mietbeginn.getMonth() + 1;
      
      if (reportPeriod === 'yearly') {
        return mietbeginnYear > selectedYear;
      } else {
        if (mietbeginnYear > selectedYear) return true;
        if (mietbeginnYear === selectedYear && mietbeginnMonth > selectedMonth) return true;
        return false;
      }
    }).map(t => {
      const unit = allUnits.find(u => u.id === t.unitId);
      return {
        ...t,
        unitTopNummer: unit?.topNummer || 'N/A',
        mietbeginnFormatted: t.mietbeginn ? new Date(t.mietbeginn).toLocaleDateString('de-AT') : '-'
      };
    });
  }, [allTenants, allUnits, selectedPropertyId, selectedYear, selectedMonth, reportPeriod]);
  
  // Monatliche SOLL-Summen aus Mieterdaten (snake_case from TenantForFilter)
  const sollGrundmiete = relevantTenants.reduce((sum, t) => sum + Number(t.grundmiete || 0), 0);
  const sollBk = relevantTenants.reduce((sum, t) => sum + Number(t.betriebskosten_vorschuss || 0), 0);
  const sollHk = relevantTenants.reduce((sum, t) => sum + Number(t.heizungskosten_vorschuss || 0), 0);
  
  // Berechne Zeitraum-Parameter für alle Perioden
  let periodStartMonth: number, periodEndMonth: number, monthMultiplier: number;
  switch (reportPeriod) {
    case 'quarterly':
      periodStartMonth = (selectedQuarter - 1) * 3 + 1;
      periodEndMonth = selectedQuarter * 3;
      monthMultiplier = 3;
      break;
    case 'halfyearly':
      periodStartMonth = selectedHalfYear === 1 ? 1 : 7;
      periodEndMonth = selectedHalfYear === 1 ? 6 : 12;
      monthMultiplier = 6;
      break;
    case 'yearly':
      periodStartMonth = 1;
      periodEndMonth = 12;
      monthMultiplier = 12;
      break;
    default: // monthly
      periodStartMonth = selectedMonth;
      periodEndMonth = selectedMonth;
      monthMultiplier = 1;
  }
  const periodSollGrundmiete = sollGrundmiete * monthMultiplier;
  const periodSollBk = sollBk * monthMultiplier;
  const periodSollHk = sollHk * monthMultiplier;
  const periodSollGesamt = periodSollGrundmiete + periodSollBk + periodSollHk;
  
  // ====== SOLL/IST PRO MIETER BERECHNUNG ======
  // Erweitert: Inkludiert ALLE Mieter mit Vorschreibungen im Zeitraum (auch ehemalige)
  const tenantSollIstDetails = useMemo(() => {
    // Sammle alle Mieter-IDs die Vorschreibungen im Zeitraum haben
    const tenantsWithInvoices = new Set<string>();
    allInvoices?.forEach(inv => {
      if (inv.year === selectedYear && 
          inv.month >= periodStartMonth && inv.month <= periodEndMonth &&
          inv.tenant_id &&
          !(inv as any).isVacancy && !(inv as any).is_vacancy) {
        // Prüfe Property-Filter
        const tenant = allTenants?.find(t => t.id === inv.tenant_id);
        const unit = allUnits?.find(u => u.id === tenant?.unit_id);
        const unitPropertyId = (unit as any)?.propertyId ?? unit?.property_id;
        if (selectedPropertyId === 'all' || unitPropertyId === selectedPropertyId) {
          tenantsWithInvoices.add(inv.tenant_id);
        }
      }
    });
    
    // Kombiniere relevantTenants mit Mietern die Vorschreibungen haben
    const allRelevantTenantIds = new Set([
      ...relevantTenants.map(t => t.id),
      ...tenantsWithInvoices
    ]);
    
    // Finde die vollständigen Mieter-Objekte
    const tenantsToProcess = Array.from(allRelevantTenantIds).map(tenantId => {
      // Bevorzuge relevantTenants (haben korrektes Format)
      const fromRelevant = relevantTenants.find(t => t.id === tenantId);
      if (fromRelevant) return fromRelevant;
      
      // Fallback: Suche in allTenants
      const fromAll = allTenants?.find(t => t.id === tenantId);
      if (fromAll) {
        return {
          id: fromAll.id,
          unit_id: fromAll.unitId,
          status: fromAll.status,
          mietbeginn: fromAll.mietbeginn,
          mietende: fromAll.mietende,
          grundmiete: Number(fromAll.grundmiete || 0),
          betriebskosten_vorschuss: Number(fromAll.betriebskostenVorschuss || 0),
          heizungskosten_vorschuss: Number(fromAll.heizkostenVorschuss || 0),
          first_name: fromAll.firstName,
          last_name: fromAll.lastName,
        };
      }
      return null;
    }).filter((t): t is NonNullable<typeof t> => t !== null);
    
    const details = tenantsToProcess.map(tenant => {
      const unit = allUnits?.find(u => u.id === tenant.unit_id);
      const property = properties?.find(p => p.id === unit?.propertyId);
      
      // SOLL-Werte: Bevorzugt aus Vorschreibungen (monthlyInvoices) für den Zeitraum
      // Fallback auf Mieterdaten nur wenn keine Vorschreibung existiert
      const tenantInvoices = allInvoices?.filter(inv => 
        inv.tenant_id === tenant.id &&
        inv.year === selectedYear &&
        inv.month >= periodStartMonth && inv.month <= periodEndMonth
      ) || [];
      
      let sollMiete = 0;
      let sollBk = 0;
      let sollHk = 0;
      let sollGesamt = 0;
      
      if (tenantInvoices.length > 0) {
        // BRUTTO-Werte: Summiere gesamtbetrag für konsistente BRUTTO-Anzeige
        // Für Komponenten-Breakdown verwenden wir die Einzel-Felder + USt
        tenantInvoices.forEach(inv => {
          // Komponenten (NETTO aus DB)
          const mieteNetto = Number(inv.grundmiete || 0);
          const bkNetto = Number(inv.betriebskosten || 0);
          const hkNetto = Number(inv.heizungskosten || 0);
          
          // USt-Sätze aus Invoice oder Defaults (BK 10%, HK 20%, Miete je nach Nutzungsart)
          const ustSatzBk = Number((inv as any).ustSatzBk ?? (inv as any).ust_satz_bk ?? 10);
          const ustSatzHk = Number((inv as any).ustSatzHeizung ?? (inv as any).ust_satz_heizung ?? 20);
          const ustSatzMiete = Number((inv as any).ustSatzMiete ?? (inv as any).ust_satz_miete ?? 10);
          
          // BRUTTO-Komponenten
          sollMiete += mieteNetto * (1 + ustSatzMiete / 100);
          sollBk += bkNetto * (1 + ustSatzBk / 100);
          sollHk += hkNetto * (1 + ustSatzHk / 100);
        });
        // BRUTTO-Gesamt aus gesamtbetrag (konsistent mit PDF)
        sollGesamt = tenantInvoices.reduce((sum, inv) => sum + Number((inv as any).gesamtbetrag || 0), 0);
        
        // Reconciliation: Falls Komponenten-Summe != gesamtbetrag, proportional anpassen
        const komponentenSumme = sollMiete + sollBk + sollHk;
        if (komponentenSumme > 0 && Math.abs(komponentenSumme - sollGesamt) > 0.01) {
          const factor = sollGesamt / komponentenSumme;
          sollMiete *= factor;
          sollBk *= factor;
          sollHk *= factor;
        }
      } else {
        // Fallback: Mieterdaten * monthMultiplier (NETTO → BRUTTO mit Default-USt)
        const mieteNetto = Number(tenant.grundmiete || 0) * monthMultiplier;
        const bkNetto = Number(tenant.betriebskosten_vorschuss || 0) * monthMultiplier;
        const hkNetto = Number(tenant.heizungskosten_vorschuss || 0) * monthMultiplier;
        sollMiete = mieteNetto * 1.10; // 10% USt für Wohnung
        sollBk = bkNetto * 1.10; // 10% USt
        sollHk = hkNetto * 1.20; // 20% USt
        sollGesamt = sollMiete + sollBk + sollHk;
      }
      
      // IST-Werte aus Zahlungen für diesen Mieter
      const tenantPayments = periodCombinedPayments.filter(p => p.tenant_id === tenant.id);
      const totalPaid = tenantPayments.reduce((sum, p) => sum + Number(p.amount), 0);
      
      // Zahlungsaufteilung berechnen (BK → Heizung → Miete)
      const invoiceAmounts: InvoiceAmounts = {
        grundmiete: sollMiete,
        betriebskosten: sollBk,
        heizungskosten: sollHk,
        gesamtbetrag: sollGesamt
      };
      
      let istBk = 0;
      let istHk = 0;
      let istMiete = 0;
      
      // BUCHHALTÄRISCH KORREKT: Nur als "voll bezahlt" behandeln wenn:
      // 1. Es gibt einen positiven SOLL-Betrag (sollGesamt > 0.01)
      // 2. Die Zahlung deckt mindestens den SOLL-Betrag
      if (sollGesamt > 0.01 && totalPaid >= sollGesamt - 0.01) {
        // Voll bezahlt: IST = SOLL für alle Komponenten
        istBk = sollBk;
        istHk = sollHk;
        istMiete = sollMiete;
      } else if (totalPaid < 0.01) {
        // KEINE Zahlung erfolgt: IST = 0 für alle Komponenten
        // Dies verhindert fälschliche "Überzahlung" Anzeige
        istBk = 0;
        istHk = 0;
        istMiete = 0;
      } else {
        // Unterzahlung: MRG-Allokation BK → HK → Miete
        const allocation = allocatePayment(totalPaid, invoiceAmounts, false);
        istBk = allocation.allocation.betriebskosten_anteil;
        istHk = allocation.allocation.heizung_anteil;
        istMiete = allocation.allocation.miete_anteil;
      }
      
      // IST Gesamt = Summe der allozierten Anteile (konsistent mit BK+HK+Miete)
      const istGesamt = istBk + istHk + istMiete;
      
      return {
        tenantId: tenant.id,
        tenantName: `${(tenant as any).vorname || (tenant as any).first_name || ''} ${(tenant as any).nachname || (tenant as any).last_name || ''}`.trim() || 'N/A',
        unitName: unit?.top_nummer || 'N/A',
        propertyName: property?.name || 'N/A',
        sollMiete,
        sollBk,
        sollHk,
        sollGesamt,
        istMiete,
        istBk,
        istHk,
        istGesamt,
        diffMiete: sollMiete - istMiete,
        diffBk: sollBk - istBk,
        diffHk: sollHk - istHk,
        diffGesamt: sollGesamt - istGesamt,
        paymentCount: tenantPayments.length
      };
    });
    
    // ====== LEERSTAND (Vacancy) für SOLL/IST Vergleich ======
    // Finde Leerstand-Vorschreibungen für den Zeitraum
    const vacancyInvoices = allInvoices?.filter(inv => 
      (inv as any).isVacancy === true || (inv as any).is_vacancy === true
    ) || [];
    
    const periodVacancyInvoices = vacancyInvoices.filter(inv =>
      inv.year === selectedYear &&
      inv.month >= periodStartMonth && inv.month <= periodEndMonth
    );
    
    // Gruppiere nach Unit
    const vacancyByUnit = new Map<string, typeof periodVacancyInvoices>();
    periodVacancyInvoices.forEach(inv => {
      const unitId = (inv as any).unitId ?? (inv as any).unit_id;
      if (!unitId) return;
      
      // Filter by property if selected (support both camelCase and snake_case)
      const unit = allUnits?.find(u => u.id === unitId);
      const unitPropertyId = unit?.propertyId ?? (unit as any)?.property_id;
      if (selectedPropertyId !== 'all' && unitPropertyId !== selectedPropertyId) return;
      
      if (!vacancyByUnit.has(unitId)) {
        vacancyByUnit.set(unitId, []);
      }
      vacancyByUnit.get(unitId)!.push(inv);
    });
    
    // Erstelle Leerstand-Einträge
    vacancyByUnit.forEach((unitVacancyInvoices, unitId) => {
      const unit = allUnits?.find(u => u.id === unitId);
      const unitPropertyId = unit?.propertyId ?? (unit as any)?.property_id;
      const property = properties?.find(p => p.id === unitPropertyId);
      
      // SOLL BRUTTO aus gesamtbetrag
      const sollGesamt = unitVacancyInvoices.reduce((sum, inv) => 
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
      if (komponentenSumme > 0 && Math.abs(komponentenSumme - sollGesamt) > 0.01) {
        const factor = sollGesamt / komponentenSumme;
        sollBk *= factor;
        sollHk *= factor;
      }
      
      // IST aus paid_amount
      const totalPaid = unitVacancyInvoices.reduce((sum, inv) => 
        sum + Number((inv as any).paidAmount ?? (inv as any).paid_amount ?? 0), 0);
      
      // Proportionale Verteilung der Zahlung auf Komponenten
      const istBk = sollGesamt > 0 ? (sollBk / sollGesamt) * totalPaid : 0;
      const istHk = sollGesamt > 0 ? (sollHk / sollGesamt) * totalPaid : 0;
      const istMiete = 0;
      const istGesamt = istBk + istHk;
      
      details.push({
        tenantId: `vacancy-${unitId}`,
        tenantName: `Leerstand (${unitVacancyInvoices.length} Mon.)`,
        unitName: unit?.top_nummer || 'N/A',
        propertyName: property?.name || 'N/A',
        sollMiete,
        sollBk,
        sollHk,
        sollGesamt,
        istMiete,
        istBk,
        istHk,
        istGesamt,
        diffMiete: sollMiete - istMiete,
        diffBk: sollBk - istBk,
        diffHk: sollHk - istHk,
        diffGesamt: sollGesamt - istGesamt,
        paymentCount: 0
      });
    });
    
    return details;
  }, [relevantTenants, allUnits, allTenants, properties, periodCombinedPayments, monthMultiplier, allInvoices, selectedYear, periodStartMonth, periodEndMonth, selectedPropertyId]);

  // ====== KONSISTENTE SUMMEN aus tenantSollIstDetails ======
  // Diese Werte werden für die Gesamt-Zeile verwendet, damit die Summe der Einzelzeilen stimmt
  const tenantSollIstTotals = useMemo(() => {
    const totals = tenantSollIstDetails.reduce((acc, detail) => ({
      sollBk: acc.sollBk + detail.sollBk,
      sollHk: acc.sollHk + detail.sollHk,
      sollMiete: acc.sollMiete + detail.sollMiete,
      sollGesamt: acc.sollGesamt + detail.sollGesamt,
      istBk: acc.istBk + detail.istBk,
      istHk: acc.istHk + detail.istHk,
      istMiete: acc.istMiete + detail.istMiete,
      istGesamt: acc.istGesamt + detail.istGesamt,
      diffBk: acc.diffBk + detail.diffBk,
      diffHk: acc.diffHk + detail.diffHk,
      diffMiete: acc.diffMiete + detail.diffMiete,
      diffGesamt: acc.diffGesamt + detail.diffGesamt,
    }), {
      sollBk: 0, sollHk: 0, sollMiete: 0, sollGesamt: 0,
      istBk: 0, istHk: 0, istMiete: 0, istGesamt: 0,
      diffBk: 0, diffHk: 0, diffMiete: 0, diffGesamt: 0,
    });
    return totals;
  }, [tenantSollIstDetails]);

  // USt aus SOLL-Werten berechnen (nach Einheitstyp) - snake_case from TenantForFilter
  const ustFromSollMiete = relevantTenants.reduce((sum, t) => {
    const betrag = Number(t.grundmiete || 0) * monthMultiplier;
    const vatRate = getVatRateForUnit(t.unit_id, 'miete');
    return sum + calculateVatFromGross(betrag, vatRate);
  }, 0);
  
  const ustFromSollBk = relevantTenants.reduce((sum, t) => {
    const betrag = Number(t.betriebskosten_vorschuss || 0) * monthMultiplier;
    const vatRate = getVatRateForUnit(t.unit_id, 'bk');
    return sum + calculateVatFromGross(betrag, vatRate);
  }, 0);
  
  const ustFromSollHk = relevantTenants.reduce((sum, t) => {
    const betrag = Number(t.heizungskosten_vorschuss || 0) * monthMultiplier;
    return sum + calculateVatFromGross(betrag, 20); // Heizung immer 20%
  }, 0);
  
  // Gesamte USt aus SOLL-Einnahmen
  const totalUstEinnahmen = ustFromSollMiete + ustFromSollBk + ustFromSollHk;
  
  // Vorsteuer aus Ausgaben (aus Transaktionen - diese haben die Kategorien)
  const vorsteuerFromTransactions = expenseTransactions.reduce((sum, t) => {
    const betrag = Math.abs(Number(t.amount));
    const categoryName = categories?.find(c => c.id === t.category_id)?.name || '';
    const vatRate = CATEGORY_VAT_RATES[categoryName] ?? 20; // Default 20% wenn Kategorie unbekannt
    return sum + calculateVatFromGross(betrag, vatRate);
  }, 0);

  // USt-Zahllast = USt aus Vorschreibungen - Vorsteuer aus Ausgaben
  const vatLiabilityFromTransactions = totalUstEinnahmen - vorsteuerFromTransactions;
  
  // Brutto-Beträge für Anzeige - aus SOLL-Werten der Mieter
  const bruttoGrundmiete = periodSollGrundmiete;
  const bruttoBk = periodSollBk;
  const bruttoHeizung = periodSollHk;
  
  // USt-Beträge für Anzeige - aus SOLL-Werten
  const ustGrundmieteDisplay = ustFromSollMiete;
  const ustBkDisplay = ustFromSollBk;
  const ustHeizungDisplay = ustFromSollHk;
  
  // Heizung-Kategorie für Offene Posten (falls vorhanden)
  const heizungCategoryId = categories?.find(c => c.name === 'Heizung' && c.type === 'income')?.id || 
                            categories?.find(c => c.name === 'Heizungskostenvorauszahlungen')?.id;

  // ====== FALLBACK: AUCH ALTE DATEN AUS INVOICES ANZEIGEN ======
  // Revenue from invoices for selected period (als Vergleich)
  const periodRevenueFromInvoices = periodInvoices.reduce((sum, inv) => sum + Number(inv.gesamtbetrag || 0), 0);
  
  // Calculate gross totals per category from invoices
  const totalGrundmiete = periodInvoices.reduce((sum, inv) => sum + Number(inv.grundmiete || 0), 0);
  const totalBetriebskosten = periodInvoices.reduce((sum, inv) => sum + Number(inv.betriebskosten || 0), 0);
  const totalHeizungskosten = periodInvoices.reduce((sum, inv) => sum + Number(inv.heizungskosten || 0), 0);
  const totalGesamtbetrag = periodInvoices.reduce((sum, inv) => sum + Number(inv.gesamtbetrag || 0), 0);

  // Calculate Netto totals using helper function
  const nettoMieteTotal = periodInvoices.reduce((sum, inv) => 
    sum + calculateNetFromGross(Number(inv.grundmiete || 0), Number(inv.ust_satz_miete || 0)), 0);
  const nettoBkTotal = periodInvoices.reduce((sum, inv) => 
    sum + calculateNetFromGross(Number(inv.betriebskosten || 0), Number(inv.ust_satz_bk || 10)), 0);
  const nettoHkTotal = periodInvoices.reduce((sum, inv) => 
    sum + calculateNetFromGross(Number(inv.heizungskosten || 0), Number(inv.ust_satz_heizung || 20)), 0);
  const totalNetto = nettoMieteTotal + nettoBkTotal + nettoHkTotal;

  // Calculate USt breakdown from gross amounts using helper function
  const ustMiete = periodInvoices.reduce((sum, inv) => 
    sum + calculateVatFromGross(Number(inv.grundmiete || 0), Number(inv.ust_satz_miete || 0)), 0);
  const ustBk = periodInvoices.reduce((sum, inv) => 
    sum + calculateVatFromGross(Number(inv.betriebskosten || 0), Number(inv.ust_satz_bk || 10)), 0);
  const ustHeizung = periodInvoices.reduce((sum, inv) => 
    sum + calculateVatFromGross(Number(inv.heizungskosten || 0), Number(inv.ust_satz_heizung || 20)), 0);
  const totalUst = ustMiete + ustBk + ustHeizung;

// Direkte USt-Sätze pro expense_type (konsistent mit reportPdfExport.ts)
  const EXPENSE_TYPE_VAT_RATES: Record<string, number> = {
    // 20% Normalsteuersatz
    'heizung': 20,
    'strom_allgemein': 20,
    'hausbetreuung': 20,
    'lift': 20,
    'gartenpflege': 20,
    'schneeraeumung': 20,
    'verwaltung': 20,
    'reparatur': 20,
    'sanierung': 20,
    'sonstiges': 20,
    'muellabfuhr': 20,  // Normalsteuersatz in Österreich
    // Sonstige Kosten (Kategorie sonstige_kosten)
    'makler': 20,
    'notar': 20,
    // 10% ermäßigter Steuersatz
    'wasser_abwasser': 10,
    // 0% - Keine Vorsteuer
    'versicherung': 0,
    'grundsteuer': 0,
    'ruecklage': 0,
    'grundbuch': 0,      // Gebühren, keine USt
    'finanzierung': 0,   // Zinsen sind umsatzsteuerfrei
  };
  
  // Vorsteuer-Aufschlüsselung nach expenseType (camelCase from useExpenses)
  const vorsteuerByExpenseType = periodExpenses.reduce((acc, exp) => {
    const expenseType = exp.expenseType || 'sonstiges';
    const betrag = Number(exp.betrag || 0);
    const vatRate = EXPENSE_TYPE_VAT_RATES[expenseType] ?? 20;
    const vorsteuer = calculateVatFromGross(betrag, vatRate);
    
    if (!acc[expenseType]) {
      acc[expenseType] = { brutto: 0, vorsteuer: 0, vatRate };
    }
    acc[expenseType].brutto += betrag;
    acc[expenseType].vorsteuer += vorsteuer;
    
    return acc;
  }, {} as Record<string, { brutto: number; vorsteuer: number; vatRate: number }>);

  type VorsteuerData = { brutto: number; vorsteuer: number; vatRate: number };
  const vorsteuerFromExpenses = (Object.values(vorsteuerByExpenseType) as VorsteuerData[]).reduce(
    (sum: number, data: VorsteuerData) => sum + data.vorsteuer, 0
  );

  // VAT liability from invoices (alt)
  const vatLiability = totalUst - vorsteuerFromExpenses;

  // Kombinierte Vorsteuer aus Banking + Kosten & Belege
  const combinedVorsteuer = vorsteuerFromTransactions + vorsteuerFromExpenses;
  const combinedVatLiability = totalUstEinnahmen - combinedVorsteuer;

  // Period label for display
  const periodLabel = reportPeriod === 'yearly' 
    ? `Jahr ${selectedYear}` 
    : `${monthNames[selectedMonth - 1]} ${selectedYear}`;

  // Report generation handler
  const handleGenerateReport = (reportId: string) => {
    if (!properties || !allUnits || !allTenants || !allInvoices || !allExpenses || !allPayments) {
      toast.error('Daten werden noch geladen...');
      return;
    }

    console.log('Generating report:', reportId);

    try {
      // Prepare transaction data for PDF export
      const transactionData: TransactionData[] = (allTransactions || []).map(t => ({
        id: t.id,
        amount: Number(t.amount),
        transaction_date: t.transaction_date || '',
        category_id: t.category_id || '',
        property_id: t.property_id || '',
        unit_id: t.unit_id || '',
        description: t.description || t.bookingText || '',
      }));

      const categoryData: CategoryData[] = (categories || []).map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
      }));

      console.log('Data prepared, calling generator...');

      switch (reportId) {
        case 'rendite':
          console.log('Generating Rendite report...');
          generateRenditeReport(
            properties,
            allUnits,
            allInvoices,
            transactionData,
            categoryData,
            selectedPropertyId,
            selectedYear,
            reportPeriod,
            selectedMonth,
            allExpenses
          );
          toast.success('Renditereport wurde erstellt');
          break;
        case 'leerstand':
          console.log('Generating Leerstand report...');
          generateLeerstandReport(
            properties,
            allUnits,
            allTenants,
            selectedPropertyId,
            selectedYear
          );
          toast.success('Leerstandsreport wurde erstellt');
          break;
        case 'umsatz':
          console.log('Generating Umsatz report...');
          generateUmsatzReport(
            properties,
            allUnits,
            allTenants,
            allInvoices,
            allPayments as PaymentData[],
            transactionData,
            categoryData,
            selectedPropertyId,
            selectedYear,
            reportPeriod,
            selectedMonth,
            allExpenses
          );
          toast.success('Umsatzreport wurde erstellt');
          break;
        case 'ust':
          console.log('Generating USt report...');
          generateUstVoranmeldung(
            properties,
            allUnits,
            allTenants,
            allInvoices,
            allExpenses,
            transactionData,
            categoryData,
            selectedPropertyId,
            selectedYear,
            reportPeriod,
            selectedMonth,
            selectedQuarter,
            selectedHalfYear
          );
          toast.success('USt-Voranmeldung wurde erstellt');
          break;
        case 'offeneposten':
          console.log('Generating Offene Posten report...');
          // Use combinedPayments for correct SOLL/IST calculation
          const combinedPaymentsData = (combinedPayments || []).map(p => ({
            id: p.id,
            tenant_id: p.tenant_id,
            amount: p.amount,
            date: p.date,
            source: p.source,
          }));
          // Vorschreibungen für SOLL-Berechnung (statt Mieter-Stammdaten)
          // WICHTIG: Alle Felder inkl. USt-Sätze übergeben für konsistente Berechnung
          const invoicesData = (allInvoices || []).map(inv => ({
            id: inv.id,
            tenantId: inv.tenant_id,
            tenant_id: inv.tenant_id,
            unitId: inv.unit_id,
            unit_id: inv.unit_id,
            year: inv.year,
            month: inv.month,
            grundmiete: inv.grundmiete,
            betriebskosten: inv.betriebskosten,
            heizungskosten: inv.heizungskosten,
            gesamtbetrag: inv.gesamtbetrag,
            isVacancy: (inv as any).isVacancy || (inv as any).is_vacancy,
            ustSatzMiete: (inv as any).ustSatzMiete ?? (inv as any).ust_satz_miete,
            ustSatzBk: (inv as any).ustSatzBk ?? (inv as any).ust_satz_bk,
            ustSatzHeizung: (inv as any).ustSatzHeizung ?? (inv as any).ust_satz_heizung,
          }));
          generateOffenePostenReport(
            properties,
            allUnits,
            allTenants,
            combinedPaymentsData,
            selectedPropertyId,
            selectedYear,
            reportPeriod,
            selectedMonth,
            selectedQuarter,
            selectedHalfYear,
            invoicesData
          );
          toast.success('Offene Posten Liste wurde erstellt');
          break;
        case 'plausibilitaet':
          console.log('Generating Plausibility report...');
          // Calculate date range based on period
          const startDate = reportPeriod === 'yearly' 
            ? `${selectedYear}-01-01`
            : `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
          const endDate = reportPeriod === 'yearly'
            ? `${selectedYear}-12-31`
            : new Date(selectedYear, selectedMonth, 0).toISOString().split('T')[0];
          
          // Prepare transaction data with bank_account_id
          const plausibilityTransactions = (allTransactions || []).map(t => ({
            id: t.id,
            amount: Number(t.amount),
            transaction_date: t.transaction_date || '',
            category_id: t.category_id || '',
            property_id: t.property_id || '',
            unit_id: t.unit_id || '',
            description: t.description || t.bookingText || '',
            tenant_id: t.tenant_id || '',
            bank_account_id: t.bank_account_id || '',
          }));
          
          // Prepare combined payments data for income
          const combinedPaymentsForReport = (combinedPayments || []).map(p => ({
            id: p.id,
            tenant_id: p.tenant_id,
            amount: p.amount,
            date: p.date,
            source: p.source,
            description: p.description,
          }));
          
          generatePlausibilityReport({
            bankAccounts: (bankAccounts || []).map(ba => ({
              id: ba.id,
              account_name: ba.account_name,
              iban: ba.iban,
              bank_name: ba.bank_name,
              opening_balance: ba.opening_balance,
              opening_balance_date: ba.opening_balance_date,
            })),
            transactions: plausibilityTransactions,
            combinedPayments: combinedPaymentsForReport,
            properties: properties || [],
            units: allUnits || [],
            tenants: allTenants || [],
            categories: categoryData,
            selectedYear,
            startDate,
            endDate,
          });
          toast.success('Plausibilitätsreport wurde erstellt');
          break;
        case 'detailbericht':
          console.log('Generating Detail report...');
          generateDetailReport({
            properties: properties || [],
            units: allUnits || [],
            tenants: allTenants || [],
            transactions: transactionData,
            categories: categoryData,
            selectedPropertyId,
            selectedYear,
            reportPeriod,
            selectedMonth,
            expenses: allExpenses,
          });
          toast.success('Detailbericht wurde erstellt');
          break;
        default:
          toast.error('Report nicht gefunden');
      }
      console.log('Report generation completed.');
    } catch (error) {
      console.error('Error generating report:', error);
      toast.error(`Fehler beim Erstellen des Reports: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`);
    }
  };

  if (isLoading) {
    return (
      <MainLayout title="Reports & Auswertungen" subtitle="Analysen und Berichte für Ihre Immobilien">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout title="Reports & Auswertungen" subtitle="Analysen und Berichte für Ihre Immobilien">
      {/* Data Consistency Alert */}
      <DataConsistencyAlert />
      
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        {/* Property Filter */}
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-muted-foreground" />
          <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId}>
            <SelectTrigger className="w-[250px]">
              <SelectValue placeholder="Liegenschaft wählen" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Liegenschaften</SelectItem>
              {properties?.map((property) => (
                <SelectItem key={property.id} value={property.id}>
                  {property.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Period Toggle */}
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-muted-foreground" />
          <Tabs value={reportPeriod} onValueChange={(v) => setReportPeriod(v as 'monthly' | 'quarterly' | 'halfyearly' | 'yearly')}>
            <TabsList>
              <TabsTrigger value="monthly">Monatlich</TabsTrigger>
              <TabsTrigger value="quarterly">Quartal</TabsTrigger>
              <TabsTrigger value="halfyearly">Halbjahr</TabsTrigger>
              <TabsTrigger value="yearly">Jährlich</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Year Selection */}
        <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map((year) => (
              <SelectItem key={year} value={year.toString()}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Month Selection (only visible if monthly) */}
        {reportPeriod === 'monthly' && (
          <Select value={selectedMonth.toString()} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthNames.map((month, index) => (
                <SelectItem key={index + 1} value={(index + 1).toString()}>
                  {month}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Quarter Selection */}
        {reportPeriod === 'quarterly' && (
          <Select value={selectedQuarter.toString()} onValueChange={(v) => setSelectedQuarter(parseInt(v))}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Q1 (Jan-Mär)</SelectItem>
              <SelectItem value="2">Q2 (Apr-Jun)</SelectItem>
              <SelectItem value="3">Q3 (Jul-Sep)</SelectItem>
              <SelectItem value="4">Q4 (Okt-Dez)</SelectItem>
            </SelectContent>
          </Select>
        )}

        {/* Half Year Selection */}
        {reportPeriod === 'halfyearly' && (
          <Select value={selectedHalfYear.toString()} onValueChange={(v) => setSelectedHalfYear(parseInt(v))}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1. Halbjahr (Jan-Jun)</SelectItem>
              <SelectItem value="2">2. Halbjahr (Jul-Dez)</SelectItem>
            </SelectContent>
          </Select>
        )}

        {selectedPropertyId !== 'all' && selectedProperty && (
          <span className="text-sm text-muted-foreground">
            {Number((selectedProperty as any).totalQm || (selectedProperty as any).total_qm || 0).toLocaleString('de-AT')} m² • {units?.length || 0} Einheiten
          </span>
        )}

        <Button 
          variant="outline" 
          size="sm"
          onClick={() => syncExistingPaymentsToTransactions.mutate()}
          disabled={syncExistingPaymentsToTransactions.isPending}
          className="ml-auto"
        >
          {syncExistingPaymentsToTransactions.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Mieteinnahmen synchronisieren
        </Button>
      </div>

      {/* Warnung: Mieter mit zukünftigem Mietbeginn */}
      {futureTenants.length > 0 && (
        <div className="mb-6 p-4 border border-warning/50 bg-warning/10 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-warning mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-warning">
                {futureTenants.length} Mieter mit Mietbeginn nach {periodLabel}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Diese Mieter sind zwar als "aktiv" gespeichert, aber ihr Mietbeginn liegt nach dem gewählten Abrechnungszeitraum. 
                Sie werden daher korrekt aus SOLL-Berechnungen, USt-Voranmeldung und OP-Liste ausgeschlossen.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {futureTenants.map(t => (
                  <Badge key={t.id} variant="outline" className="text-xs">
                    {t.unitTopNummer} {t.firstName} {t.lastName} (ab {t.mietbeginnFormatted})
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Kumulierte Einnahmen-Übersicht (IST aus MRG-Allokation) */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Euro className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Kumulierte Einnahmen (IST) - {periodLabel}</CardTitle>
          </div>
          <CardDescription>
            Tatsächliche Zahlungseingänge nach MRG-Allokation (BK→HK→Miete) aus {periodCombinedPayments.length} Zahlungen
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-lg border border-success/30 bg-success/5 p-4">
              <p className="text-xs text-muted-foreground font-medium">Miete (IST)</p>
              <p className="text-xl font-bold text-success mt-1">
                €{paymentAllocationDetails.mieteAnteil.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Eigentümerrelevant
              </p>
            </div>
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4">
              <p className="text-xs text-muted-foreground font-medium">Betriebskosten (IST)</p>
              <p className="text-xl font-bold text-blue-600 mt-1">
                €{paymentAllocationDetails.bkAnteil.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Durchlaufposten
              </p>
            </div>
            <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-4">
              <p className="text-xs text-muted-foreground font-medium">Heizkosten (IST)</p>
              <p className="text-xl font-bold text-orange-600 mt-1">
                €{paymentAllocationDetails.hkAnteil.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Durchlaufposten
              </p>
            </div>
            <div className="rounded-lg border-2 border-primary/50 bg-primary/5 p-4">
              <p className="text-xs text-muted-foreground font-medium">Gesamt IST</p>
              <p className="text-xl font-bold text-primary mt-1">
                €{paymentAllocationDetails.gesamt.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Alle Zahlungseingänge
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Stats - JETZT AUS TRANSAKTIONEN */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Jahresrendite (Netto)</p>
                <p className="text-2xl font-bold text-foreground mt-1">
                  {annualYieldFromTransactions.toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Mieteinnahmen - Instandhaltung
                </p>
              </div>
              <div className="flex items-center gap-1 text-success text-sm">
                <ArrowUpRight className="h-4 w-4" />
                {totalQm.toLocaleString('de-AT')} m²
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Leerstandsquote</p>
                <p className="text-2xl font-bold text-foreground mt-1">
                  {vacancyRate.toFixed(1)}%
                </p>
              </div>
              <div className={`flex items-center gap-1 text-sm ${vacancyRate > 10 ? 'text-destructive' : 'text-success'}`}>
                {vacancyRate > 10 ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                {vacantUnits} von {totalUnits}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Mieteinnahmen {periodLabel} (IST)</p>
                <p className="text-2xl font-bold text-foreground mt-1">
                  €{paymentAllocationDetails.mieteAnteil.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  nur Miete (nach BK→HK→Miete)
                </p>
              </div>
              <div className="flex items-center gap-1 text-success text-sm">
                <ArrowUpRight className="h-4 w-4" />
                {periodCombinedPayments.length} Zahlungen
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">USt-Zahllast (Buchhaltung)</p>
                <p className="text-2xl font-bold text-foreground mt-1">
                  €{combinedVatLiability.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  inkl. {periodExpenses.length} Belege (€{vorsteuerFromExpenses.toLocaleString('de-AT', { minimumFractionDigits: 2 })} Vorsteuer)
                </p>
              </div>
              <div className="text-xs text-muted-foreground">{periodLabel}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Einnahmen/Ausgaben Übersicht */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Buchhaltungsübersicht {periodLabel}</CardTitle>
          <CardDescription>
            IST-Einnahmen aus {periodCombinedPayments.length} Zahlungen • Ausgaben aus {expenseTransactions.length} Buchungen + {periodExpenses.length} Belege
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Einnahmen (IST aus Payments - mit Zahlungsaufteilung BK→HK→Miete) */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-success flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4" />
                Einnahmen (IST) - aus Zahlungen
                <Badge variant="outline" className="text-xs ml-2">BK → HK → Miete</Badge>
              </h4>
              <div className="space-y-2">
                <div className="flex justify-between items-center p-3 rounded-lg border border-success/20 bg-success/5">
                  <div>
                    <span className="text-sm font-medium">Miete (Netto-Ertrag)</span>
                    <p className="text-xs text-muted-foreground">Eigentumsrelevant • nach BK+HK</p>
                  </div>
                  <span className="font-semibold text-success">
                    €{paymentAllocationDetails.mieteAnteil.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg border border-muted bg-muted/30">
                  <div>
                    <span className="text-sm">Betriebskosten</span>
                    <p className="text-xs text-muted-foreground">Durchlaufposten • 1. Priorität</p>
                  </div>
                  <span className="font-semibold text-muted-foreground">
                    €{paymentAllocationDetails.bkAnteil.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg border border-muted bg-muted/30">
                  <div>
                    <span className="text-sm">Heizung</span>
                    <p className="text-xs text-muted-foreground">Durchlaufposten • 2. Priorität</p>
                  </div>
                  <span className="font-semibold text-muted-foreground">
                    €{paymentAllocationDetails.hkAnteil.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg border border-border bg-muted/50">
                  <span className="text-sm">Gesamt eingegangen</span>
                  <span className="font-semibold">
                    €{paymentAllocationDetails.gesamt.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg border-2 border-success bg-success/10">
                  <span className="font-semibold">IST-Mieteinnahmen (nach Aufteilung)</span>
                  <span className="font-bold text-success text-lg">
                    €{paymentAllocationDetails.mieteAnteil.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
              
              {/* SOLL vs IST Vergleich - Miete, BK, Heizung mit Zahlungsaufteilung */}
              <div className="mt-4 p-4 rounded-lg border border-border bg-muted/50 space-y-3">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-muted-foreground">SOLL vs IST Vergleich</p>
                  <Badge variant="outline" className="text-xs">
                    Aufteilung: BK → Heizung → Miete
                  </Badge>
                </div>
                
                {/* Betriebskosten - werden zuerst bedient */}
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-blue-500 text-white text-[10px] flex items-center justify-center">1</span>
                    Betriebskosten
                  </p>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">SOLL:</span>
                    <span>€{mrgTotals.sollBk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">IST (aus Zahlungen):</span>
                    <span>€{paymentAllocationDetails.bkAnteil.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className={`flex justify-between text-sm font-semibold ${mrgTotals.sollBk - paymentAllocationDetails.bkAnteil > 0.01 ? 'text-destructive' : mrgTotals.sollBk - paymentAllocationDetails.bkAnteil < -0.01 ? 'text-success' : 'text-muted-foreground'}`}>
                    <span>Differenz:</span>
                    <span>{mrgTotals.sollBk - paymentAllocationDetails.bkAnteil > 0 ? '-' : '+'}€{Math.abs(mrgTotals.sollBk - paymentAllocationDetails.bkAnteil).toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
                
                <div className="border-t border-border pt-2"></div>
                
                {/* Heizung - wird als zweites bedient */}
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-orange-500 text-white text-[10px] flex items-center justify-center">2</span>
                    Heizung
                  </p>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">SOLL:</span>
                    <span>€{mrgTotals.sollHk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">IST (aus Zahlungen):</span>
                    <span>€{paymentAllocationDetails.hkAnteil.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className={`flex justify-between text-sm font-semibold ${mrgTotals.sollHk - paymentAllocationDetails.hkAnteil > 0.01 ? 'text-destructive' : mrgTotals.sollHk - paymentAllocationDetails.hkAnteil < -0.01 ? 'text-success' : 'text-muted-foreground'}`}>
                    <span>Differenz:</span>
                    <span>{mrgTotals.sollHk - paymentAllocationDetails.hkAnteil > 0 ? '-' : '+'}€{Math.abs(mrgTotals.sollHk - paymentAllocationDetails.hkAnteil).toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
                
                <div className="border-t border-border pt-2"></div>
                
                {/* Miete - wird zuletzt bedient */}
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-green-500 text-white text-[10px] flex items-center justify-center">3</span>
                    Miete
                  </p>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">SOLL:</span>
                    <span>€{mrgTotals.sollMiete.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">IST (aus Zahlungen):</span>
                    <span>€{paymentAllocationDetails.mieteAnteil.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className={`flex justify-between text-sm font-semibold ${mrgTotals.sollMiete - paymentAllocationDetails.mieteAnteil > 0.01 ? 'text-destructive' : mrgTotals.sollMiete - paymentAllocationDetails.mieteAnteil < -0.01 ? 'text-success' : 'text-muted-foreground'}`}>
                    <span>Differenz:</span>
                    <span>{mrgTotals.sollMiete - paymentAllocationDetails.mieteAnteil > 0 ? '-' : '+'}€{Math.abs(mrgTotals.sollMiete - paymentAllocationDetails.mieteAnteil).toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
                
                <div className="border-t-2 border-border pt-2"></div>
                
                {/* Gesamt */}
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-foreground">Gesamt</p>
                  <div className="flex justify-between text-sm font-medium">
                    <span className="text-muted-foreground">SOLL:</span>
                    <span>€{mrgTotals.totalSoll.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-sm font-medium">
                    <span className="text-muted-foreground">IST (eingegangen):</span>
                    <span>€{paymentAllocationDetails.gesamt.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className={`flex justify-between text-sm font-bold ${mrgTotals.totalSoll - paymentAllocationDetails.gesamt > 0.01 ? 'text-destructive' : mrgTotals.totalSoll - paymentAllocationDetails.gesamt < -0.01 ? 'text-success' : 'text-muted-foreground'}`}>
                    <span>Differenz:</span>
                    <span>{mrgTotals.totalSoll - paymentAllocationDetails.gesamt > 0 ? '-' : '+'}€{Math.abs(mrgTotals.totalSoll - paymentAllocationDetails.gesamt).toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
                
                <p className="text-[10px] text-muted-foreground pt-2 border-t border-dashed">
                  Zahlungen werden nach AT-Standard aufgeteilt: Zuerst BK, dann Heizung, zuletzt Miete.
                </p>
              </div>
            </div>

            {/* Ausgaben - NUR aus Kosten & Belege */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-destructive flex items-center gap-2">
                <ArrowDownRight className="h-4 w-4" />
                Ausgaben (aus Kosten & Belege)
              </h4>
              <div className="space-y-2">
                <div className="flex justify-between items-center p-3 rounded-lg border border-destructive/20 bg-destructive/5">
                  <div>
                    <span className="text-sm">Betriebskosten</span>
                    <p className="text-xs text-muted-foreground">
                      Umlagefähig auf Mieter
                    </p>
                  </div>
                  <span className="font-semibold text-destructive">
                    €{betriebskostenFromExpenses.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg border border-orange-500/20 bg-orange-500/5">
                  <div>
                    <span className="text-sm">Instandhaltung</span>
                    <p className="text-xs text-muted-foreground">
                      Mindert Rendite (nicht umlagefähig)
                    </p>
                  </div>
                  <span className="font-semibold text-orange-600">
                    €{instandhaltungFromExpenses.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                {combinedSonstigeKosten > 0 && (
                  <div className="flex justify-between items-center p-3 rounded-lg border border-purple-500/20 bg-purple-500/5">
                    <div>
                      <span className="text-sm">Sonstige Kosten</span>
                      <p className="text-xs text-muted-foreground">
                        Nicht umlagefähig, nicht renditemin.
                      </p>
                    </div>
                    <span className="font-semibold text-purple-600">
                      €{combinedSonstigeKosten.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center p-3 rounded-lg border-2 border-destructive bg-destructive/10">
                  <div>
                    <span className="font-semibold">Gesamt Ausgaben</span>
                    <p className="text-xs text-muted-foreground">
                      {periodExpenses.length} Belege erfasst
                    </p>
                  </div>
                  <span className="font-bold text-destructive text-lg">
                    €{totalExpensesFromCosts.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Rendite = Miete - Instandhaltung */}
          <div className="mt-6 p-4 rounded-lg border-2 border-primary bg-primary/5">
            <div className="flex justify-between items-center">
              <div>
                <span className="font-semibold text-lg">Rendite</span>
                <p className="text-sm text-muted-foreground">
                  Miete (€{totalIstEinnahmen.toLocaleString('de-AT', { minimumFractionDigits: 2 })}) 
                  - Instandhaltung (€{combinedInstandhaltung.toLocaleString('de-AT', { minimumFractionDigits: 2 })})
                </p>
              </div>
              <span className="font-bold text-primary text-2xl">
                €{(totalIstEinnahmen - combinedInstandhaltung).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SOLL/IST pro Mieter */}
      {tenantSollIstDetails.length > 0 && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              SOLL/IST Vergleich pro Mieter
              <Badge variant="outline" className="text-xs font-normal">
                Aufteilung: BK → Heizung → Miete
              </Badge>
            </CardTitle>
            <CardDescription>
              {periodLabel} • {tenantSollIstDetails.length} aktive Mieter
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mieter</TableHead>
                    <TableHead>Einheit</TableHead>
                    <TableHead className="text-right">
                      <div className="flex flex-col items-end">
                        <span>BK</span>
                        <span className="text-[10px] text-blue-500 font-normal">①</span>
                      </div>
                    </TableHead>
                    <TableHead className="text-right">
                      <div className="flex flex-col items-end">
                        <span>Heizung</span>
                        <span className="text-[10px] text-orange-500 font-normal">②</span>
                      </div>
                    </TableHead>
                    <TableHead className="text-right">
                      <div className="flex flex-col items-end">
                        <span>Miete</span>
                        <span className="text-[10px] text-green-500 font-normal">③</span>
                      </div>
                    </TableHead>
                    <TableHead className="text-right">Gesamt</TableHead>
                    <TableHead className="text-right">Differenz</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenantSollIstDetails.map((detail) => (
                    <TableRow key={detail.tenantId}>
                      <TableCell>
                        <div>
                          <span className="font-medium">{detail.tenantName}</span>
                          {selectedPropertyId === 'all' && (
                            <p className="text-xs text-muted-foreground">{detail.propertyName}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{detail.unitName}</TableCell>
                      <TableCell className="text-right">
                        <div className="space-y-0.5">
                          <div className="text-xs text-muted-foreground">
                            SOLL: €{detail.sollBk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </div>
                          <div className="text-sm font-medium">
                            IST: €{detail.istBk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </div>
                          <div className={`text-xs font-semibold ${detail.diffBk > 0.01 ? 'text-destructive' : detail.diffBk < -0.01 ? 'text-success' : 'text-muted-foreground'}`}>
                            {detail.diffBk > 0 ? '-' : '+'}€{Math.abs(detail.diffBk).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="space-y-0.5">
                          <div className="text-xs text-muted-foreground">
                            SOLL: €{detail.sollHk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </div>
                          <div className="text-sm font-medium">
                            IST: €{detail.istHk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </div>
                          <div className={`text-xs font-semibold ${detail.diffHk > 0.01 ? 'text-destructive' : detail.diffHk < -0.01 ? 'text-success' : 'text-muted-foreground'}`}>
                            {detail.diffHk > 0 ? '-' : '+'}€{Math.abs(detail.diffHk).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="space-y-0.5">
                          <div className="text-xs text-muted-foreground">
                            SOLL: €{detail.sollMiete.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </div>
                          <div className="text-sm font-medium">
                            IST: €{detail.istMiete.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </div>
                          <div className={`text-xs font-semibold ${detail.diffMiete > 0.01 ? 'text-destructive' : detail.diffMiete < -0.01 ? 'text-success' : 'text-muted-foreground'}`}>
                            {detail.diffMiete > 0 ? '-' : '+'}€{Math.abs(detail.diffMiete).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="space-y-0.5">
                          <div className="text-xs text-muted-foreground">
                            SOLL: €{detail.sollGesamt.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </div>
                          <div className="text-sm font-medium">
                            IST: €{detail.istGesamt.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className={`text-sm font-bold ${detail.diffGesamt > 0.01 ? 'text-destructive' : detail.diffGesamt < -0.01 ? 'text-success' : 'text-muted-foreground'}`}>
                          {detail.diffGesamt > 0 ? '-' : '+'}€{Math.abs(detail.diffGesamt).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {detail.paymentCount} Zahlung{detail.paymentCount !== 1 ? 'en' : ''}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Summenzeile - verwendet tenantSollIstTotals für konsistente Summen */}
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell colSpan={2}>Gesamt</TableCell>
                    <TableCell className="text-right">
                      <div className="space-y-0.5">
                        <div className="text-xs">SOLL: €{tenantSollIstTotals.sollBk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</div>
                        <div>IST: €{tenantSollIstTotals.istBk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</div>
                        <div className={`text-xs font-semibold ${tenantSollIstTotals.diffBk > 0.01 ? 'text-destructive' : tenantSollIstTotals.diffBk < -0.01 ? 'text-success' : 'text-muted-foreground'}`}>
                          {tenantSollIstTotals.diffBk > 0 ? '-' : '+'}€{Math.abs(tenantSollIstTotals.diffBk).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="space-y-0.5">
                        <div className="text-xs">SOLL: €{tenantSollIstTotals.sollHk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</div>
                        <div>IST: €{tenantSollIstTotals.istHk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</div>
                        <div className={`text-xs font-semibold ${tenantSollIstTotals.diffHk > 0.01 ? 'text-destructive' : tenantSollIstTotals.diffHk < -0.01 ? 'text-success' : 'text-muted-foreground'}`}>
                          {tenantSollIstTotals.diffHk > 0 ? '-' : '+'}€{Math.abs(tenantSollIstTotals.diffHk).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="space-y-0.5">
                        <div className="text-xs">SOLL: €{tenantSollIstTotals.sollMiete.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</div>
                        <div>IST: €{tenantSollIstTotals.istMiete.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</div>
                        <div className={`text-xs font-semibold ${tenantSollIstTotals.diffMiete > 0.01 ? 'text-destructive' : tenantSollIstTotals.diffMiete < -0.01 ? 'text-success' : 'text-muted-foreground'}`}>
                          {tenantSollIstTotals.diffMiete > 0 ? '-' : '+'}€{Math.abs(tenantSollIstTotals.diffMiete).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="space-y-0.5">
                        <div className="text-xs">SOLL: €{tenantSollIstTotals.sollGesamt.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</div>
                        <div>IST: €{tenantSollIstTotals.istGesamt.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className={`font-bold ${tenantSollIstTotals.diffGesamt > 0.01 ? 'text-destructive' : tenantSollIstTotals.diffGesamt < -0.01 ? 'text-success' : 'text-muted-foreground'}`}>
                        {tenantSollIstTotals.diffGesamt > 0 ? '-' : '+'}€{Math.abs(tenantSollIstTotals.diffGesamt).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </div>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground mt-4 flex items-center gap-2">
              <span className="w-4 h-4 rounded-full bg-blue-500 text-white text-[10px] flex items-center justify-center">1</span>
              BK zuerst
              <span className="w-4 h-4 rounded-full bg-orange-500 text-white text-[10px] flex items-center justify-center">2</span>
              Heizung
              <span className="w-4 h-4 rounded-full bg-green-500 text-white text-[10px] flex items-center justify-center">3</span>
              Miete zuletzt
              <span className="ml-2">• Rot = Unterdeckung, Grün = Überdeckung</span>
            </p>
          </CardContent>
        </Card>
      )}

      {/* Report Cards */}
      <h2 className="text-lg font-semibold text-foreground mb-4">Verfügbare Reports</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {reports.map((report) => (
          <Card key={report.id} className="hover:shadow-card-hover transition-shadow">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <div className="flex items-start gap-4">
                <div className={`rounded-lg p-2.5 ${report.color}`}>
                  <report.icon className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base">{report.title}</CardTitle>
                  <CardDescription className="mt-1">{report.description}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Warning for Plausibility report when no bank accounts */}
              {report.id === 'plausibilitaet' && (!bankAccounts || bankAccounts.length === 0) && (
                <div className="mb-3 p-3 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-orange-600 mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-orange-700 dark:text-orange-300">
                      <span className="font-medium">Hinweis:</span> Keine Bankkonten konfiguriert. 
                      Transaktionen ohne Bankkonto-Zuordnung werden als "Nicht zugeordnet" angezeigt. 
                      Für eine vollständige Kontenübersicht legen Sie Bankkonten in den Einstellungen an.
                    </div>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2 mt-2">
                {/* PDF-fähige Berichte */}
                {['rendite', 'leerstand', 'umsatz', 'ust', 'offeneposten', 'plausibilitaet', 'detailbericht'].includes(report.id) && (
                  <Button size="sm" onClick={() => handleGenerateReport(report.id)}>
                    <Download className="h-4 w-4 mr-2" />
                    PDF Export
                  </Button>
                )}
                {/* Inline-Berichte (Detailbericht, Mietvorschreibungen) */}
                {['detailbericht', 'mietvorschreibung'].includes(report.id) && (
                  <Button size="sm" onClick={() => setSelectedReportId(report.id)}>
                    <FileText className="h-4 w-4 mr-2" />
                    Anzeigen
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* USt Preview - KOMBINIERT AUS INVOICES UND TRANSAKTIONEN */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>USt-Voranmeldung {periodLabel}</CardTitle>
              <CardDescription>
                Einnahmen aus {relevantTenants.length} aktiven Mietern (SOLL), Vorsteuer aus {expenseTransactions.length} Banking-Buchungen + {periodExpenses.length} Belege
                {selectedPropertyId !== 'all' && selectedProperty && ` für ${selectedProperty.name}`}
              </CardDescription>
            </div>
            <Button onClick={() => handleGenerateReport('ust')}>
              <Download className="h-4 w-4 mr-2" />
              PDF Export
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-6">
            <h4 className="text-sm font-semibold text-foreground mb-3">
              Einnahmen (Soll-Versteuerung - SOLL aus Mieterdaten)
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Mieteinnahmen</p>
                <p className="text-lg font-bold text-foreground">
                  €{bruttoGrundmiete.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                </p>
                <div className="text-xs text-muted-foreground mt-1">
                  <p>USt: €{ustGrundmieteDisplay.toLocaleString('de-AT', { minimumFractionDigits: 2 })} (10-20%)</p>
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Betriebskosten</p>
                <p className="text-lg font-bold text-foreground">
                  €{bruttoBk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                </p>
                <div className="text-xs text-muted-foreground mt-1">
                  <p>USt: €{ustBkDisplay.toLocaleString('de-AT', { minimumFractionDigits: 2 })} (10-20%)</p>
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Heizung</p>
                <p className="text-lg font-bold text-foreground">
                  €{bruttoHeizung.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                </p>
                <div className="text-xs text-muted-foreground mt-1">
                  <p>USt: €{ustHeizungDisplay.toLocaleString('de-AT', { minimumFractionDigits: 2 })} (20%)</p>
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Ausgaben (Vorsteuer)</p>
                <p className="text-lg font-bold text-foreground">
                  €{(totalExpensesFromTransactions + totalExpensesFromCosts).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                </p>
                <div className="text-xs text-muted-foreground mt-1">
                  <p>Banking: €{vorsteuerFromTransactions.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</p>
                  <p>Belege: €{vorsteuerFromExpenses.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</p>
                </div>
              </div>
              <div className={`rounded-lg border p-3 ${combinedVatLiability >= 0 ? 'border-success/30 bg-success/5' : 'border-primary/30 bg-primary/5'}`}>
                <p className="text-xs text-muted-foreground">
                  {combinedVatLiability >= 0 ? 'Zahllast' : 'Gutschrift'}
                </p>
                <p className={`text-lg font-bold ${combinedVatLiability >= 0 ? 'text-success' : 'text-primary'}`}>
                  €{Math.abs(combinedVatLiability).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
            <div className="mt-4 p-3 bg-muted rounded-lg">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Gesamt SOLL-Einnahmen ({reportPeriod === 'yearly' ? '12 Monate' : 'Monat'}):</span>
                <span className="text-lg font-bold">€{periodSollGesamt.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
            {periodInvoices.length === 0 && (
              <div className="mt-4 p-4 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-orange-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
                      Keine Vorschreibungen für {monthNames[selectedMonth - 1]} {selectedYear} gefunden
                    </p>
                    <p className="text-sm text-orange-600 dark:text-orange-400 mt-1">
                      Erstellen Sie monatliche Mietvorschreibungen basierend auf den aktiven Mietern.
                    </p>
                    <Button 
                      onClick={handleGenerateInvoices}
                      disabled={isGeneratingInvoices}
                      className="mt-3"
                      size="sm"
                    >
                      {isGeneratingInvoices ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Generiere...
                        </>
                      ) : (
                        <>
                          <Plus className="h-4 w-4 mr-2" />
                          Vorschreibungen für {monthNames[selectedMonth - 1]} generieren
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* USt Berechnung */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-lg border border-border p-4">
              <p className="text-sm text-muted-foreground">Umsatzsteuer (aus Einnahmen)</p>
              <p className="text-2xl font-bold text-foreground mt-2">
                €{totalUstEinnahmen.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
              </p>
              <div className="mt-2 text-xs text-muted-foreground space-y-1">
                <p>Mieteinnahmen: €{ustGrundmieteDisplay.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</p>
                <p>BK: €{ustBkDisplay.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</p>
                <p>Heizung (20%): €{ustHeizungDisplay.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</p>
              </div>
            </div>
            <div className="rounded-lg border border-border p-4">
              <p className="text-sm text-muted-foreground">Vorsteuer (aus Ausgaben)</p>
              <p className="text-2xl font-bold text-foreground mt-2">
                €{combinedVorsteuer.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
              </p>
              
              {/* Aufschlüsselung nach Kostenart */}
              {Object.keys(vorsteuerByExpenseType).length > 0 && (
                <div className="mt-3 border-t border-border pt-3">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">
                    Aufschlüsselung nach Kostenart:
                  </p>
                  <div className="space-y-1.5 text-xs">
                    {(Object.entries(vorsteuerByExpenseType) as [string, { brutto: number; vorsteuer: number; vatRate: number }][])
                      .filter(([, data]) => data.vorsteuer > 0)
                      .sort((a, b) => b[1].vorsteuer - a[1].vorsteuer)
                      .map(([type, data]) => (
                        <div key={type} className="flex justify-between items-center">
                          <span className="text-muted-foreground">
                            {expenseTypeLabels[type as keyof typeof expenseTypeLabels] || type} ({data.vatRate}%)
                          </span>
                          <span className="font-medium">
                            €{data.vorsteuer.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
              
              <div className="mt-2 text-xs text-muted-foreground space-y-1 border-t border-border pt-2">
                <p>Banking: €{vorsteuerFromTransactions.toLocaleString('de-AT', { minimumFractionDigits: 2 })} ({expenseTransactions.length} Buchungen)</p>
                <p>Belege: €{vorsteuerFromExpenses.toLocaleString('de-AT', { minimumFractionDigits: 2 })} ({periodExpenses.length} Belege)</p>
              </div>
            </div>
            <div className={`rounded-lg border p-4 ${combinedVatLiability >= 0 ? 'border-success/30 bg-success/5' : 'border-primary/30 bg-primary/5'}`}>
              <p className="text-sm text-muted-foreground">
                {combinedVatLiability >= 0 ? 'Zahllast' : 'Gutschrift'}
              </p>
              <p className={`text-2xl font-bold mt-2 ${combinedVatLiability >= 0 ? 'text-success' : 'text-primary'}`}>
                €{Math.abs(combinedVatLiability).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
              </p>
              <div className="mt-2 text-xs text-muted-foreground">
                {reportPeriod === 'monthly' && (
                  <p>Fällig bis: 15.{(selectedMonth + 1 > 12 ? 1 : selectedMonth + 1).toString().padStart(2, '0')}.{selectedMonth === 12 ? selectedYear + 1 : selectedYear}</p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detaillierte Transaktionen */}
      <Card className="mt-8">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg p-2.5 bg-accent/10">
              <Receipt className="h-5 w-5 text-accent-foreground" />
            </div>
            <div>
              <CardTitle>Transaktionen aus Buchhaltung</CardTitle>
              <CardDescription>
                {periodTransactions.length} Buchungen für {periodLabel}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {periodTransactions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Keine Buchungen für {periodLabel} vorhanden. 
              <br />
              <span className="text-sm">Erfassen Sie Einnahmen und Ausgaben in der Buchhaltung.</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead>Beschreibung</TableHead>
                    <TableHead>Kategorie</TableHead>
                    <TableHead className="text-right">Betrag</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {periodTransactions.slice(0, 15).map((t) => {
                    const category = categories?.find(c => c.id === t.category_id);
                    const isIncome = Number(t.amount) > 0;
                    
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="whitespace-nowrap">
                          {new Date(t.transaction_date).toLocaleDateString('de-AT')}
                        </TableCell>
                        <TableCell>{t.description || '-'}</TableCell>
                        <TableCell>
                          <Badge variant={isIncome ? 'secondary' : 'outline'}>
                            {category?.name || 'Nicht kategorisiert'}
                          </Badge>
                        </TableCell>
                        <TableCell className={`text-right font-semibold ${isIncome ? 'text-success' : 'text-destructive'}`}>
                          {isIncome ? '+' : ''}{Number(t.amount).toLocaleString('de-AT', { minimumFractionDigits: 2 })} €
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {periodTransactions.length > 15 && (
                <p className="text-sm text-muted-foreground text-center mt-4">
                  ... und {periodTransactions.length - 15} weitere Buchungen.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Offene Posten Vorschau */}
      <Card className="mt-8">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2.5 bg-destructive/10">
                <AlertCircle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <CardTitle>Offene Posten / Salden {periodLabel}</CardTitle>
                <CardDescription>
                  SOLL (aus Mieterdaten) vs. IST (aus Zahlungen) - gleicher Zeitraum wie SOLL/IST-Vergleich
                  {selectedPropertyId !== 'all' && selectedProperty && ` für ${selectedProperty.name}`}
                </CardDescription>
              </div>
            </div>
            <Button onClick={() => handleGenerateReport('offeneposten')}>
              <Download className="h-4 w-4 mr-2" />
              PDF Export
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {mrgAllocations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Keine Daten für {periodLabel} vorhanden.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Soll (aus Mieterdaten)</p>
                  <p className="text-lg font-bold text-foreground">
                    €{mrgTotals.totalSoll.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Haben (IST-Zahlungen)</p>
                  <p className="text-lg font-bold text-foreground">
                    €{mrgTotals.totalIst.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                  <p className="text-xs text-muted-foreground">Unterzahlungen</p>
                  <p className="text-lg font-bold text-destructive">
                    €{mrgTotals.totalUnterzahlung.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {mrgAllocations.filter(a => a.saldo > 0).length} Mieter
                  </p>
                </div>
                <div className="rounded-lg border border-success/30 bg-success/5 p-3">
                  <p className="text-xs text-muted-foreground">Überzahlungen</p>
                  <p className="text-lg font-bold text-success">
                    €{mrgTotals.totalUeberzahlung.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {mrgAllocations.filter(a => a.saldo < 0).length} Mieter
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[180px]">Einheit / Mieter</TableHead>
                      <TableHead className="text-right">BK SOLL</TableHead>
                      <TableHead className="text-right">BK IST</TableHead>
                      <TableHead className="text-right">HK SOLL</TableHead>
                      <TableHead className="text-right">HK IST</TableHead>
                      <TableHead className="text-right">Miete SOLL</TableHead>
                      <TableHead className="text-right">Miete IST</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mrgAllocations.slice(0, 15).map((alloc) => {
                      // Saldo = SOLL - IST: positiv = Unterzahlung, negativ = Überzahlung
                      let statusLabel = 'Ausgeglichen';
                      let statusVariant: 'default' | 'destructive' | 'secondary' | 'outline' = 'outline';
                      if (alloc.status === 'offen' && alloc.saldo === 0) {
                        statusLabel = 'Offen';
                        statusVariant = 'secondary';
                      } else if (alloc.saldo > 0.01) {
                        // Positiver Saldo = SOLL > IST = Unterzahlung
                        statusLabel = 'Unterzahlung';
                        statusVariant = 'destructive';
                      } else if (alloc.saldo < -0.01) {
                        // Negativer Saldo = SOLL < IST = Überzahlung
                        statusLabel = 'Überzahlung';
                        statusVariant = 'default';
                      } else if (Math.abs(alloc.saldo) <= 0.01) {
                        statusLabel = 'Bezahlt';
                        statusVariant = 'outline';
                      }
                      
                      const property = properties?.find(p => p.id === alloc.unit?.property_id);
                      
                      return (
                        <TableRow key={alloc.tenant.id}>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium">
                                {alloc.unit?.top_nummer || '-'}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {alloc.tenant.first_name} {alloc.tenant.last_name} • {property?.name || '-'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            €{alloc.sollBk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className={`text-right text-xs ${alloc.diffBk > 0 ? 'text-destructive' : ''}`}>
                            €{alloc.istBk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            €{alloc.sollHk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className={`text-right text-xs ${alloc.diffHk > 0 ? 'text-destructive' : ''}`}>
                            €{alloc.istHk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            €{alloc.sollMiete.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className={`text-right text-xs ${alloc.diffMiete > 0 ? 'text-destructive' : ''}`}>
                            €{alloc.istMiete.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariant}>{statusLabel}</Badge>
                          </TableCell>
                          <TableCell className={`text-right font-bold ${alloc.saldo > 0 ? 'text-destructive' : alloc.saldo < 0 ? 'text-success' : ''}`}>
                            €{alloc.saldo.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {mrgAllocations.length > 15 && (
                  <p className="text-sm text-muted-foreground text-center mt-4">
                    ... und {mrgAllocations.length - 15} weitere Mieter. PDF für vollständige Liste exportieren.
                  </p>
                )}
              </div>
            </>
          )}

          {/* Detailbericht - Einnahmen/Ausgaben pro Einheit */}
          {selectedReportId === 'detailbericht' && (() => {
            // Gruppiere Transaktionen nach Einheiten
            const unitTransactions = new Map<string, { 
              unit: typeof units extends (infer U)[] ? U : never;
              property: typeof properties extends (infer P)[] ? P : never;
              income: number; 
              expenses: number; 
              transactions: typeof periodTransactions;
              tenants: typeof allTenants;
            }>();

            // Initialisiere alle Einheiten (camelCase from useUnits/useTenants)
            units?.forEach(unit => {
              const property = properties?.find(p => p.id === unit.propertyId);
              const unitTenants = allTenants?.filter(t => t.unitId === unit.id) || [];
              unitTransactions.set(unit.id, {
                unit: unit as any,
                property: property as any,
                income: 0,
                expenses: 0,
                transactions: [],
                tenants: unitTenants as any,
              });
            });

            // Verteile Transaktionen
            periodTransactions.forEach(t => {
              if (t.unit_id && unitTransactions.has(t.unit_id)) {
                const data = unitTransactions.get(t.unit_id)!;
                if (Number(t.amount) > 0) {
                  data.income += Number(t.amount);
                } else {
                  data.expenses += Math.abs(Number(t.amount));
                }
                (data.transactions as any[]).push(t);
              }
            });

            // Nicht zugeordnete Transaktionen
            const unassignedTransactions = periodTransactions.filter(t => !t.unit_id);
            const unassignedIncome = unassignedTransactions.filter(t => Number(t.amount) > 0).reduce((sum, t) => sum + Number(t.amount), 0);
            const unassignedExpenses = unassignedTransactions.filter(t => Number(t.amount) < 0).reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);

            // Gruppiere nach Liegenschaft
            const propertiesData = new Map<string, {
              property: typeof properties extends (infer P)[] ? P : never;
              units: Array<{
                unit: typeof units extends (infer U)[] ? U : never;
                income: number;
                expenses: number;
                tenants: typeof allTenants;
              }>;
              totalIncome: number;
              totalExpenses: number;
            }>();

            properties?.forEach(prop => {
              propertiesData.set(prop.id, {
                property: prop as any,
                units: [],
                totalIncome: 0,
                totalExpenses: 0,
              });
            });

            unitTransactions.forEach((data, unitId) => {
              const prop = data.property as { id: string; name: string; address: string; postal_code: string; city: string } | null;
              if (prop && propertiesData.has(prop.id)) {
                const propData = propertiesData.get(prop.id)!;
                propData.units.push({
                  unit: data.unit,
                  income: data.income,
                  expenses: data.expenses,
                  tenants: data.tenants,
                });
                propData.totalIncome += data.income;
                propData.totalExpenses += data.expenses;
              }
            });

            return (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-blue-600" />
                    <h3 className="font-semibold">Detailbericht - Einnahmen & Ausgaben pro Einheit</h3>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setSelectedReportId(null)}>
                    Schließen
                  </Button>
                </div>

                <div className="space-y-6">
                  {Array.from(propertiesData.values())
                    .filter(p => {
                      const prop = p.property as { id: string } | null;
                      return selectedPropertyId === 'all' || prop?.id === selectedPropertyId;
                    })
                    .map((propData) => {
                      const prop = propData.property as { id: string; name: string; address: string; postal_code: string; city: string } | null;
                      return (
                    <div key={prop?.id} className="border rounded-lg overflow-hidden">
                      <div className="bg-muted p-4 flex justify-between items-center">
                        <div>
                          <h4 className="font-semibold text-lg">{prop?.name}</h4>
                          <p className="text-sm text-muted-foreground">{prop?.address}, {prop?.postal_code} {prop?.city}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-success font-semibold">+€{propData.totalIncome.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</p>
                          <p className="text-destructive font-semibold">-€{propData.totalExpenses.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</p>
                        </div>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Einheit</TableHead>
                            <TableHead>Mieter</TableHead>
                            <TableHead className="text-right">Einnahmen</TableHead>
                            <TableHead className="text-right">Ausgaben</TableHead>
                            <TableHead className="text-right">Saldo</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {propData.units.map((unitData: any) => {
                            const activeTenant = (unitData.tenants as any[])?.find((t: any) => t.status === 'aktiv');
                            const saldo = unitData.income - unitData.expenses;
                            return (
                              <TableRow key={unitData.unit?.id}>
                                <TableCell className="font-medium">{unitData.unit?.top_nummer || '-'}</TableCell>
                                <TableCell>
                                  {activeTenant ? `${activeTenant.vorname || activeTenant.first_name || ''} ${activeTenant.nachname || activeTenant.last_name || ''}`.trim() || 'Mieter' : <span className="text-muted-foreground">Leerstand</span>}
                                </TableCell>
                                <TableCell className="text-right text-success">
                                  €{unitData.income.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                                </TableCell>
                                <TableCell className="text-right text-destructive">
                                  €{unitData.expenses.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                                </TableCell>
                                <TableCell className={`text-right font-bold ${saldo >= 0 ? 'text-success' : 'text-destructive'}`}>
                                  €{saldo.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                      );
                    })}

                  {unassignedTransactions.length > 0 && (
                    <div className="border rounded-lg overflow-hidden">
                      <div className="bg-muted p-4">
                        <h4 className="font-semibold">Nicht zugeordnete Buchungen</h4>
                        <p className="text-sm text-muted-foreground">{unassignedTransactions.length} Transaktionen ohne Einheitszuordnung</p>
                      </div>
                      <div className="p-4">
                        <div className="flex gap-8">
                          <div>
                            <p className="text-sm text-muted-foreground">Einnahmen</p>
                            <p className="text-success font-semibold">€{unassignedIncome.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">Ausgaben</p>
                            <p className="text-destructive font-semibold">€{unassignedExpenses.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            );
          })()}

          {/* Mietvorschreibungen - Monatliche SOLL-Werte pro Mieter/Einheit */}
          {selectedReportId === 'mietvorschreibung' && (() => {
            // SOLL-Werte direkt aus tenants-Tabelle (aktive Mieter)
            // Gruppiere nach Liegenschaft
            const propertiesData = new Map<string, {
              property: typeof properties extends (infer P)[] ? P : never;
              tenantsSoll: Array<{
                tenant: typeof allTenants extends (infer T)[] ? T : never;
                unit: typeof allUnits extends (infer U)[] ? U : never;
                grundmiete: number;
                betriebskosten: number;
                heizungskosten: number;
                gesamt: number;
              }>;
              totalGrundmiete: number;
              totalBK: number;
              totalHK: number;
              totalGesamt: number;
            }>();

            // Initialisiere Properties
            properties?.forEach(prop => {
              propertiesData.set(prop.id, {
                property: prop as any,
                tenantsSoll: [],
                totalGrundmiete: 0,
                totalBK: 0,
                totalHK: 0,
                totalGesamt: 0,
              });
            });

            // Filtere nur relevante Units (camelCase from useUnits)
            const relevantUnits = selectedPropertyId === 'all' 
              ? allUnits 
              : allUnits?.filter(u => u.propertyId === selectedPropertyId);

            // Fülle SOLL-Daten aus Mietern
            relevantUnits?.forEach(unit => {
              const property = properties?.find(p => p.id === unit.propertyId);
              if (!property) return;

              // Finde aktive Mieter für diese Unit (camelCase from useTenants)
              const activeTenants = allTenants?.filter(t => 
                t.unitId === unit.id && t.status === 'aktiv'
              ) || [];

              activeTenants.forEach(tenant => {
                const grundmiete = Number(tenant.grundmiete) || 0;
                const bk = Number(tenant.betriebskostenVorschuss) || 0;
                const hk = Number(tenant.heizkostenVorschuss) || 0;
                const gesamt = grundmiete + bk + hk;

                if (gesamt > 0) {
                  const propData = propertiesData.get(property.id)!;
                  propData.tenantsSoll.push({
                    tenant: tenant as any,
                    unit: unit as any,
                    grundmiete,
                    betriebskosten: bk,
                    heizungskosten: hk,
                    gesamt,
                  });
                  propData.totalGrundmiete += grundmiete;
                  propData.totalBK += bk;
                  propData.totalHK += hk;
                  propData.totalGesamt += gesamt;
                }
              });

              // Für Leerstand zeigen wir die Einheit ohne Mieter-Soll
              if (activeTenants.length === 0 && unit.status === 'leerstand') {
                const propData = propertiesData.get(property.id)!;
                propData.tenantsSoll.push({
                  tenant: null as any,
                  unit: unit as any,
                  grundmiete: 0,
                  betriebskosten: 0,
                  heizungskosten: 0,
                  gesamt: 0,
                });
              }
            });

            // Gesamtsummen
            const totals = Array.from(propertiesData.values()).reduce((acc, p) => ({
              grundmiete: acc.grundmiete + p.totalGrundmiete,
              bk: acc.bk + p.totalBK,
              hk: acc.hk + p.totalHK,
              gesamt: acc.gesamt + p.totalGesamt,
            }), { grundmiete: 0, bk: 0, hk: 0, gesamt: 0 });

            return (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Receipt className="h-5 w-5 text-purple-600" />
                    <h3 className="font-semibold">Mietvorschreibungen - Monatliche SOLL-Werte</h3>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setSelectedReportId(null)}>
                    Schließen
                  </Button>
                </div>

                {/* Gesamtübersicht */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground">Grundmiete (SOLL)</p>
                    <p className="text-lg font-bold text-foreground">
                      €{totals.grundmiete.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground">Betriebskosten (SOLL)</p>
                    <p className="text-lg font-bold text-foreground">
                      €{totals.bk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground">Heizung (SOLL)</p>
                    <p className="text-lg font-bold text-foreground">
                      €{totals.hk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                    <p className="text-xs text-muted-foreground">Gesamt (SOLL/Monat)</p>
                    <p className="text-lg font-bold text-primary">
                      €{totals.gesamt.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>

                {Array.from(propertiesData.values())
                  .filter(p => p.tenantsSoll.length > 0)
                  .map((propData) => {
                    const prop = propData.property as { id: string; name: string; address: string } | null;
                    return (
                  <div key={prop?.id} className="border rounded-lg overflow-hidden mb-4">
                    <div className="bg-muted p-4 flex justify-between items-center">
                      <div>
                        <h4 className="font-semibold text-lg">{prop?.name}</h4>
                        <p className="text-sm text-muted-foreground">{prop?.address}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">SOLL: €{propData.totalGesamt.toLocaleString('de-AT', { minimumFractionDigits: 2 })}/Monat</p>
                        <p className="text-xs text-muted-foreground">
                          Miete: €{propData.totalGrundmiete.toLocaleString('de-AT')} | BK: €{propData.totalBK.toLocaleString('de-AT')} | HK: €{propData.totalHK.toLocaleString('de-AT')}
                        </p>
                      </div>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Einheit</TableHead>
                          <TableHead>Mieter</TableHead>
                          <TableHead className="text-right">Grundmiete</TableHead>
                          <TableHead className="text-right">BK</TableHead>
                          <TableHead className="text-right">Heizung</TableHead>
                          <TableHead className="text-right">Gesamt (SOLL)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {propData.tenantsSoll.map((item: any, idx: number) => (
                          <TableRow key={idx}>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-medium">{item.unit?.top_nummer || '-'}</span>
                                <span className="text-xs text-muted-foreground">
                                  {unitTypeLabels[(item.unit as any)?.type || ''] || (item.unit as any)?.type}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              {item.tenant ? (
                                `${(item.tenant as any).vorname || (item.tenant as any).first_name || ''} ${(item.tenant as any).nachname || (item.tenant as any).last_name || ''}`.trim() || 'Mieter'
                              ) : (
                                <Badge variant="outline">Leerstand</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              €{item.grundmiete.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-right">
                              €{item.betriebskosten.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-right">
                              €{item.heizungskosten.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-right font-bold">
                              €{item.gesamt.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                    );
                  })}
              </>
            );
          })()}

          {/* Kautionsübersicht Report */}
          {selectedReportId === 'kaution' && (() => {
            // Filter tenants with kautionBezahlt = true (camelCase from useTenants)
            const tenantsWithKaution = (allTenants || []).filter(t => {
              if (!t.kautionBezahlt || !t.kaution || Number(t.kaution) <= 0) return false;
              
              if (selectedPropertyId === 'all') return true;
              
              const unit = (allUnits || []).find(u => u.id === t.unitId);
              return unit?.propertyId === selectedPropertyId;
            });

            // Sort by property, then by unit
            const sortedTenants = tenantsWithKaution.sort((a, b) => {
              const unitA = (allUnits || []).find(u => u.id === a.unitId);
              const unitB = (allUnits || []).find(u => u.id === b.unitId);
              const propA = (properties || []).find(p => p.id === unitA?.propertyId);
              const propB = (properties || []).find(p => p.id === unitB?.propertyId);
              
              if (propA?.name !== propB?.name) {
                return (propA?.name || '').localeCompare(propB?.name || '');
              }
              return (unitA?.topNummer || '').localeCompare(unitB?.topNummer || '');
            });

            // Calculate total
            const totalKaution = sortedTenants.reduce((sum, t) => sum + Number(t.kaution || 0), 0);

            const handleExportPdf = () => {
              if (!properties || !allUnits || !allTenants) return;
              
              // Map camelCase data from hooks to snake_case for PDF export function interface
              generateKautionsReport(
                allTenants.map(t => ({
                  id: t.id,
                  first_name: t.firstName,
                  last_name: t.lastName,
                  email: t.email,
                  phone: t.phone,
                  kaution: Number(t.kaution || 0),
                  kaution_bezahlt: t.kautionBezahlt || false,
                  unit_id: t.unitId,
                  mietbeginn: t.mietbeginn,
                })),
                allUnits.map(u => ({
                  id: u.id,
                  top_nummer: u.topNummer,
                  property_id: u.propertyId,
                })),
                properties.map(p => ({
                  id: p.id,
                  name: p.name,
                  address: p.address,
                })),
                selectedPropertyId
              );
              toast.success('PDF wurde erstellt');
            };

            return (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold">Kautionsübersicht</h3>
                    <p className="text-sm text-muted-foreground">
                      Alle Mieter mit bezahlter Kaution
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleExportPdf} variant="outline" data-testid="button-kaution-export-pdf">
                      <Download className="h-4 w-4 mr-2" />
                      PDF
                    </Button>
                    <Button 
                      onClick={() => {
                        const csvData = sortedTenants.map(tenant => {
                          const unit = (allUnits || []).find(u => u.id === tenant.unitId);
                          const property = (properties || []).find(p => p.id === unit?.propertyId);
                          return {
                            liegenschaft: property?.name || '',
                            einheit: unit?.topNummer || '',
                            vorname: tenant.firstName,
                            nachname: tenant.lastName,
                            mietbeginn: tenant.mietbeginn || '',
                            kaution: Number(tenant.kaution || 0),
                          };
                        });
                        exportToCSV(csvData, `Kautionsuebersicht_${new Date().toISOString().split('T')[0]}`, {
                          liegenschaft: 'Liegenschaft',
                          einheit: 'Einheit',
                          vorname: 'Vorname',
                          nachname: 'Nachname',
                          mietbeginn: 'Mietbeginn',
                          kaution: 'Kaution (€)',
                        });
                        toast.success('CSV wurde exportiert');
                      }} 
                      variant="outline" 
                      data-testid="button-kaution-export-csv"
                    >
                      <FileSpreadsheet className="h-4 w-4 mr-2" />
                      CSV
                    </Button>
                  </div>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <Card>
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-2">
                        <Wallet className="h-5 w-5 text-teal-600" />
                        <div>
                          <p className="text-sm text-muted-foreground">Anzahl Kautionen</p>
                          <p className="text-2xl font-bold">{sortedTenants.length}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-2">
                        <Euro className="h-5 w-5 text-teal-600" />
                        <div>
                          <p className="text-sm text-muted-foreground">Gesamtsumme</p>
                          <p className="text-2xl font-bold">
                            €{totalKaution.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Table */}
                {sortedTenants.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Wallet className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Keine Mietkautionen gefunden</p>
                    <p className="text-sm">Es wurden keine Mieter mit bezahlter Kaution gefunden.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Liegenschaft</TableHead>
                        <TableHead>Einheit</TableHead>
                        <TableHead>Mieter</TableHead>
                        <TableHead>Mietbeginn</TableHead>
                        <TableHead className="text-right">Kaution</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedTenants.map((tenant) => {
                        const unit = (allUnits || []).find(u => u.id === tenant.unitId);
                        const property = (properties || []).find(p => p.id === unit?.propertyId);
                        
                        return (
                          <TableRow key={tenant.id} data-testid={`row-kaution-${tenant.id}`}>
                            <TableCell>{property?.name || '-'}</TableCell>
                            <TableCell>{unit?.topNummer || '-'}</TableCell>
                            <TableCell className="font-medium">
                              {tenant.firstName} {tenant.lastName}
                            </TableCell>
                            <TableCell>
                              {tenant.mietbeginn 
                                ? new Date(tenant.mietbeginn).toLocaleDateString('de-AT')
                                : '-'
                              }
                            </TableCell>
                            <TableCell className="text-right font-bold">
                              €{Number(tenant.kaution || 0).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </>
            );
          })()}

          {/* Vertragsablauf Report */}
          {selectedReportId === 'vertragsablauf' && (() => {
            const today = new Date();
            const oneMonth = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
            const threeMonths = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
            const sixMonths = new Date(today.getTime() + 180 * 24 * 60 * 60 * 1000);

            // Filter tenants with mietende set (camelCase from useTenants)
            const tenantsWithEndDate = (allTenants || []).filter(t => {
              if (!t.mietende || t.status === 'beendet') return false;
              
              const endDate = new Date(t.mietende);
              if (endDate < today) return false; // Already ended
              if (endDate > sixMonths) return false; // More than 6 months away
              
              if (selectedPropertyId === 'all') return true;
              
              const unit = (allUnits || []).find(u => u.id === t.unitId);
              return unit?.propertyId === selectedPropertyId;
            });

            // Sort by mietende (soonest first)
            const sortedTenants = tenantsWithEndDate.sort((a, b) => {
              return new Date(a.mietende!).getTime() - new Date(b.mietende!).getTime();
            });

            // Categorize by time period
            const within1Month = sortedTenants.filter(t => new Date(t.mietende!) <= oneMonth);
            const within3Months = sortedTenants.filter(t => {
              const end = new Date(t.mietende!);
              return end > oneMonth && end <= threeMonths;
            });
            const within6Months = sortedTenants.filter(t => {
              const end = new Date(t.mietende!);
              return end > threeMonths && end <= sixMonths;
            });

            const getDaysUntilEnd = (endDate: string) => {
              const end = new Date(endDate);
              const diff = Math.ceil((end.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
              return diff;
            };

            const getBadgeVariant = (days: number) => {
              if (days <= 30) return 'destructive';
              if (days <= 90) return 'default';
              return 'secondary';
            };

            return (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold">Vertragsablauf</h3>
                    <p className="text-sm text-muted-foreground">
                      Mietverträge die in den nächsten 6 Monaten auslaufen
                    </p>
                  </div>
                  <Button 
                    onClick={() => {
                      const csvData = sortedTenants.map(tenant => {
                        const unit = (allUnits || []).find(u => u.id === tenant.unitId);
                        const property = (properties || []).find(p => p.id === unit?.propertyId);
                        return {
                          liegenschaft: property?.name || '',
                          einheit: unit?.topNummer || '',
                          vorname: tenant.firstName,
                          nachname: tenant.lastName,
                          mietbeginn: tenant.mietbeginn || '',
                          mietende: tenant.mietende || '',
                          tage_verbleibend: getDaysUntilEnd(tenant.mietende!),
                        };
                      });
                      exportToCSV(csvData, `Vertragsablauf_${new Date().toISOString().split('T')[0]}`, {
                        liegenschaft: 'Liegenschaft',
                        einheit: 'Einheit',
                        vorname: 'Vorname',
                        nachname: 'Nachname',
                        mietbeginn: 'Mietbeginn',
                        mietende: 'Mietende',
                        tage_verbleibend: 'Tage verbleibend',
                      });
                      toast.success('CSV wurde exportiert');
                    }} 
                    variant="outline" 
                    data-testid="button-vertragsablauf-export-csv"
                    disabled={sortedTenants.length === 0}
                  >
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    CSV Export
                  </Button>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <Card className="border-l-4 border-l-red-500">
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-5 w-5 text-red-500" />
                        <div>
                          <p className="text-sm text-muted-foreground">Innerhalb 1 Monat</p>
                          <p className="text-2xl font-bold text-red-600">{within1Month.length}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-orange-500">
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-5 w-5 text-orange-500" />
                        <div>
                          <p className="text-sm text-muted-foreground">Innerhalb 3 Monate</p>
                          <p className="text-2xl font-bold text-orange-600">{within3Months.length}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-blue-500">
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-5 w-5 text-blue-500" />
                        <div>
                          <p className="text-sm text-muted-foreground">Innerhalb 6 Monate</p>
                          <p className="text-2xl font-bold text-blue-600">{within6Months.length}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Table */}
                {sortedTenants.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Keine auslaufenden Verträge</p>
                    <p className="text-sm">In den nächsten 6 Monaten laufen keine Mietverträge aus.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Liegenschaft</TableHead>
                        <TableHead>Einheit</TableHead>
                        <TableHead>Mieter</TableHead>
                        <TableHead>Mietbeginn</TableHead>
                        <TableHead>Mietende</TableHead>
                        <TableHead className="text-right">Verbleibend</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedTenants.map((tenant) => {
                        const unit = (allUnits || []).find(u => u.id === tenant.unitId);
                        const property = (properties || []).find(p => p.id === unit?.propertyId);
                        const daysLeft = getDaysUntilEnd(tenant.mietende!);
                        
                        return (
                          <TableRow key={tenant.id} data-testid={`row-vertragsablauf-${tenant.id}`}>
                            <TableCell>{property?.name || '-'}</TableCell>
                            <TableCell>{unit?.topNummer || '-'}</TableCell>
                            <TableCell className="font-medium">
                              {tenant.firstName} {tenant.lastName}
                            </TableCell>
                            <TableCell>
                              {tenant.mietbeginn 
                                ? new Date(tenant.mietbeginn).toLocaleDateString('de-AT')
                                : '-'
                              }
                            </TableCell>
                            <TableCell>
                              {new Date(tenant.mietende!).toLocaleDateString('de-AT')}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant={getBadgeVariant(daysLeft)}>
                                {daysLeft} Tage
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </>
            );
          })()}
        </CardContent>
      </Card>
    </MainLayout>
  );
}
