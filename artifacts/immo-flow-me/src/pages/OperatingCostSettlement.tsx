import { useState, useMemo } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Calculator, Download, Euro, Home, FileText, Flame, TrendingUp, TrendingDown, CheckCircle, AlertCircle, Users, FileDown, Files, Save, Mail, RefreshCw, RefreshCcw, Eye } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useProperties } from '@/hooks/useProperties';
import { useExpenses } from '@/hooks/useExpenses';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { 
  generateTenantSettlementPdf, 
  generateAllTenantSettlementsPdf, 
  generateGesamtabrechnungPdf 
} from '@/utils/bkAbrechnungPdfExport';
import { useSaveSettlement, useExistingSettlement, useFinalizeSettlement } from '@/hooks/useSettlements';
import { useUpdateNewAdvances } from '@/hooks/useNewAdvances';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { usePaymentSync } from '@/hooks/usePaymentSync';
import { NewAdvanceDialog } from '@/components/settlements/NewAdvanceDialog';
import { GuidedEmptyState } from '@/components/GuidedEmptyState';

// Distribution key mapping for expense types (without heating - handled separately)
const expenseDistributionKeys: Record<string, 'mea' | 'qm' | 'personen'> = {
  lift: 'mea',
  versicherung: 'qm',
  grundsteuer: 'qm',
  muellabfuhr: 'personen',
  wasser_abwasser: 'personen',
  strom_allgemein: 'mea',
  hausbetreuung: 'qm',
  gartenpflege: 'qm',
  schneeraeumung: 'qm',
  verwaltung: 'mea',
  ruecklage: 'mea',
  sonstiges: 'qm',
};

const expenseTypeLabels: Record<string, string> = {
  versicherung: 'Versicherung',
  grundsteuer: 'Grundsteuer',
  muellabfuhr: 'Müllabfuhr',
  wasser_abwasser: 'Wasser/Abwasser',
  strom_allgemein: 'Allgemeinstrom',
  hausbetreuung: 'Hausbetreuung',
  lift: 'Lift',
  gartenpflege: 'Gartenpflege',
  schneeraeumung: 'Schneeräumung',
  verwaltung: 'Verwaltung',
  ruecklage: 'Rücklage',
  sonstiges: 'Sonstiges',
};

const distributionKeyLabels: Record<string, string> = {
  mea: 'MEA (‰)',
  qm: 'Quadratmeter',
  personen: 'Personen',
};

interface TenantInfo {
  id: string;
  name: string;
  email: string | null;
  mietbeginn: string;
  mietende: string | null;
  status: string;
  bk_vorschuss_monatlich: number;
  hk_vorschuss_monatlich: number;
}

interface UnitWithTenants {
  id: string;
  top_nummer: string;
  type: string;
  qm: number;
  mea: number;
  vs_personen: number | null;
  status: string;
  // Current tenant at settlement time (for BK)
  current_tenant: TenantInfo | null;
  // Tenants who lived there during the year (for HK) - could be multiple
  year_tenants: TenantInfo[];
}

export default function OperatingCostSettlement() {
  const currentYear = new Date().getFullYear();
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<number>(currentYear - 1); // Default: Vorjahr für Abrechnung
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null); // null = ganzes Jahr (Standard für Jahresabrechnung)
  const [sendEmails, setSendEmails] = useState<boolean>(true);
  const [isAdvanceDialogOpen, setIsAdvanceDialogOpen] = useState(false);
  const [selectedUnitDetail, setSelectedUnitDetail] = useState<any>(null);

  const { data: properties, isLoading: isLoadingProperties } = useProperties();
  const { data: expenses, isLoading: isLoadingExpenses } = useExpenses(
    selectedPropertyId || undefined,
    selectedYear,
    selectedMonth || undefined
  );

  // Check for existing settlement
  const { data: existingSettlement } = useExistingSettlement(
    selectedPropertyId || undefined,
    selectedYear
  );

  const saveSettlement = useSaveSettlement();
  const finalizeSettlement = useFinalizeSettlement();
  const updateNewAdvances = useUpdateNewAdvances();
  const { syncExistingTransactionsToExpenses } = usePaymentSync();

  // Fetch ALL units with current tenant and year tenants (including past tenants)
  const { data: units, isLoading: isLoadingUnits } = useQuery({
    queryKey: ['units-with-tenants-advances', selectedPropertyId, selectedYear],
    queryFn: async () => {
      if (!selectedPropertyId) return [];
      
      const response = await fetch(`/api/properties/${selectedPropertyId}/units?includeTenants=true`);
      if (!response.ok) throw new Error('Failed to fetch units');
      const unitsData = await response.json();

      return unitsData.map((u: any) => {
        const allTenants = u.tenants || [];
        
        // Current tenant = active tenant
        const currentTenant = allTenants.find((t: any) => t.status === 'aktiv') || null;
        
        const yearStart = `${selectedYear}-01-01`;
        const yearEnd = `${selectedYear}-12-31`;

        const yearTenants = allTenants.filter((t: any) => {
          const beginn = t.mietbeginn;
          const ende = t.mietende;
          return beginn <= yearEnd && (ende === null || ende >= yearStart);
        }).map((t: any) => ({
          id: t.id,
          name: `${t.firstName || t.first_name} ${t.lastName || t.last_name}`,
          email: t.email,
          mietbeginn: t.mietbeginn,
          mietende: t.mietende,
          status: t.status,
          bk_vorschuss_monatlich: Number(t.betriebskostenVorschuss || t.betriebskosten_vorschuss || 0),
          hk_vorschuss_monatlich: Number(t.heizkostenVorschuss || t.heizungskosten_vorschuss || 0),
        }));

        return {
          id: u.id,
          top_nummer: u.topNummer || u.top_nummer,
          type: u.type,
          qm: Number(u.qm || u.flaeche || 0),
          mea: Number(u.nutzwert || u.mea || 0),
          vs_personen: u.vsPersonen || u.vs_personen || 0,
          status: u.status,
          current_tenant: currentTenant ? {
            id: currentTenant.id,
            name: `${currentTenant.firstName || currentTenant.first_name} ${currentTenant.lastName || currentTenant.last_name}`,
            email: currentTenant.email,
            mietbeginn: currentTenant.mietbeginn,
            mietende: currentTenant.mietende,
            status: currentTenant.status,
            bk_vorschuss_monatlich: Number(currentTenant.betriebskostenVorschuss || currentTenant.betriebskosten_vorschuss || 0),
            hk_vorschuss_monatlich: Number(currentTenant.heizkostenVorschuss || currentTenant.heizungskosten_vorschuss || 0),
          } : null,
          year_tenants: yearTenants,
        };
      });
    },
    enabled: !!selectedPropertyId,
  });

  // Calculate totals for distribution
  // Use fallback: mea from API alias OR nutzwert from DB, qm from alias OR flaeche from DB
  const totals = useMemo(() => {
    if (!units) return { qm: 0, qmBeheizt: 0, mea: 0, personen: 0 };
    return units.reduce(
      (acc, unit: any) => {
        const unitQm = Number(unit.qm || unit.flaeche || 0);
        const unitMea = Number(unit.mea || unit.nutzwert || 0);
        return {
          qm: acc.qm + unitQm,
          qmBeheizt: acc.qmBeheizt + (unit.type !== 'garage' ? unitQm : 0),
          mea: acc.mea + unitMea,
          personen: acc.personen + (unit.vs_personen ?? 0),
        };
      },
      { qm: 0, qmBeheizt: 0, mea: 0, personen: 0 }
    );
  }, [units]);

  // Calculate number of months for the period
  const monthCount = selectedMonth ? 1 : 12;

  // Separate BK expenses (without heating) and Heating expenses
  const bkKosten = useMemo(() => {
    if (!expenses) return [];
    return expenses.filter(e => 
      e.category === 'betriebskosten_umlagefaehig' && e.expenseType !== 'heizung'
    );
  }, [expenses]);

  const hkKosten = useMemo(() => {
    if (!expenses) return [];
    return expenses.filter(e => 
      e.category === 'betriebskosten_umlagefaehig' && e.expenseType === 'heizung'
    );
  }, [expenses]);

  // Calculate total by expense type (BK only, without heating)
  const expensesByType = useMemo(() => {
    const grouped: Record<string, number> = {};
    bkKosten.forEach(exp => {
      grouped[exp.expenseType] = (grouped[exp.expenseType] || 0) + Number(exp.betrag);
    });
    return grouped;
  }, [bkKosten]);

  // Total heating costs
  const totalHeizkosten = hkKosten.reduce((sum, e) => sum + Number(e.betrag), 0);

  // Calculate distribution per unit (BK and HK separately)
  // BK: Current tenant pays (or owner if vacant)
  // HK: Year tenant (Altmieter) pays - the one who lived during the year
  const unitDistribution = useMemo(() => {
    if (!units || units.length === 0) return [];

    return units.map(unit => {
      const unitCosts: Record<string, number> = {};
      let totalBkCost = 0;

      // Calculate BK costs per expense type
      // Use fallback for mea/qm to handle both API alias and DB field names
      const unitMea = Number((unit as any).mea || (unit as any).nutzwert || 0);
      const unitQm = Number((unit as any).qm || (unit as any).flaeche || 0);
      
      Object.entries(expensesByType).forEach(([expenseType, totalAmount]) => {
        const distributionKey = expenseDistributionKeys[expenseType] || 'qm';
        let unitShare = 0;
        let unitValue = 0;
        let totalValue = 0;

        switch (distributionKey) {
          case 'mea':
            unitValue = unitMea;
            totalValue = totals.mea;
            break;
          case 'qm':
            unitValue = unitQm;
            totalValue = totals.qm;
            break;
          case 'personen':
            unitValue = unit.vs_personen ?? 0;
            totalValue = totals.personen;
            break;
        }

        if (totalValue > 0) {
          unitShare = (unitValue / totalValue) * totalAmount;
        }

        unitCosts[expenseType] = Math.round(unitShare * 100) / 100;
        totalBkCost += unitShare;
      });

      // Calculate HK costs (distributed by qm - only for heated units, excluding garages)
      let hkCost = 0;
      if (unit.type !== 'garage' && totals.qmBeheizt > 0) {
        hkCost = (unitQm / totals.qmBeheizt) * totalHeizkosten;
      }

      // Determine who pays what:
      // BK: Current tenant at settlement time (or owner if no current tenant)
      const currentTenant = unit.current_tenant;
      const isLeerstandBK = !currentTenant;

      // HK: Year tenant (Altmieter) - whoever lived during the year
      // If there are multiple year tenants, use the earliest one (Altmieter)
      // If no year tenants, HK also goes to owner
      const yearTenant = unit.year_tenants.length > 0 
        ? unit.year_tenants.sort((a, b) => a.mietbeginn.localeCompare(b.mietbeginn))[0]
        : null;
      const isLeerstandHK = !yearTenant;

      // Calculate advance payments for the period
      // BK advance from current tenant
      const bkVorschussGesamt = currentTenant 
        ? currentTenant.bk_vorschuss_monatlich * monthCount 
        : 0;
      // HK advance from year tenant (Altmieter)
      const hkVorschussGesamt = yearTenant 
        ? yearTenant.hk_vorschuss_monatlich * monthCount 
        : 0;

      // Calculate balance
      // BK: Only if there's a current tenant
      const bkSaldo = isLeerstandBK ? 0 : Math.round((totalBkCost - bkVorschussGesamt) * 100) / 100;
      // HK: Only if there's a year tenant
      const hkSaldo = isLeerstandHK ? 0 : Math.round((hkCost - hkVorschussGesamt) * 100) / 100;

      return {
        ...unit,
        costs: unitCosts,
        totalBkCost: Math.round(totalBkCost * 100) / 100,
        hkCost: Math.round(hkCost * 100) / 100,
        bkVorschuss: bkVorschussGesamt,
        hkVorschuss: hkVorschussGesamt,
        bkSaldo,
        hkSaldo,
        gesamtSaldo: bkSaldo + hkSaldo,
        isLeerstandBK,
        isLeerstandHK,
        isLeerstand: isLeerstandBK && isLeerstandHK,
        bkMieter: currentTenant?.name || null,
        hkMieter: yearTenant?.name || null,
        // For saving to database
        bkTenantId: currentTenant?.id || null,
        hkTenantId: yearTenant?.id || null,
        tenantEmail: currentTenant?.email || yearTenant?.email || null,
      };
    });
  }, [units, expensesByType, totals, totalHeizkosten, monthCount]);

  const totalBkKosten = bkKosten.reduce((sum, e) => sum + Number(e.betrag), 0);

  // Calculate verification sums - these MUST equal the total costs
  const verificationSums = useMemo(() => {
    if (!unitDistribution.length) return null;

    // Sum of all BK costs distributed to units (Mieter + Eigentümer)
    const sumBkVerteilt = unitDistribution.reduce((sum, u) => sum + u.totalBkCost, 0);
    // Sum of all HK costs distributed to units (Mieter + Eigentümer)
    const sumHkVerteilt = unitDistribution.reduce((sum, u) => sum + u.hkCost, 0);

    // Costs paid by tenants (Mieter)
    const bkMieter = unitDistribution.filter(u => !u.isLeerstandBK).reduce((sum, u) => sum + u.totalBkCost, 0);
    const hkMieter = unitDistribution.filter(u => !u.isLeerstandHK).reduce((sum, u) => sum + u.hkCost, 0);

    // Costs paid by owner (Eigentümer / Leerstand)
    const bkEigentuemer = unitDistribution.filter(u => u.isLeerstandBK).reduce((sum, u) => sum + u.totalBkCost, 0);
    const hkEigentuemer = unitDistribution.filter(u => u.isLeerstandHK).reduce((sum, u) => sum + u.hkCost, 0);

    // Advance payments
    const bkVorschuss = unitDistribution.filter(u => !u.isLeerstandBK).reduce((sum, u) => sum + u.bkVorschuss, 0);
    const hkVorschuss = unitDistribution.filter(u => !u.isLeerstandHK).reduce((sum, u) => sum + u.hkVorschuss, 0);

    // Saldo
    const bkSaldoGesamt = unitDistribution.filter(u => !u.isLeerstandBK).reduce((sum, u) => sum + u.bkSaldo, 0);
    const hkSaldoGesamt = unitDistribution.filter(u => !u.isLeerstandHK).reduce((sum, u) => sum + u.hkSaldo, 0);

    // Verification check
    const bkMatch = Math.abs(sumBkVerteilt - totalBkKosten) < 0.01;
    const hkMatch = Math.abs(sumHkVerteilt - totalHeizkosten) < 0.01;

    return {
      sumBkVerteilt,
      sumHkVerteilt,
      bkMieter,
      hkMieter,
      bkEigentuemer,
      hkEigentuemer,
      bkVorschuss,
      hkVorschuss,
      bkSaldoGesamt,
      hkSaldoGesamt,
      bkMatch,
      hkMatch,
      gesamtMatch: bkMatch && hkMatch,
    };
  }, [unitDistribution, totalBkKosten, totalHeizkosten]);

  // Validate units for incomplete data (missing MEA, qm, or Personen)
  const unitValidationWarnings = useMemo(() => {
    if (!units?.length) return [];
    
    const warnings: { unitId: string; topNummer: string; issues: string[] }[] = [];
    
    units.forEach((unit: any) => {
      const issues: string[] = [];
      const mea = Number(unit.mea || unit.nutzwert || 0);
      const qm = Number(unit.qm || unit.flaeche || 0);
      const personen = unit.vs_personen ?? unit.vsPersonen ?? 0;
      
      if (mea <= 0) issues.push('MEA/Nutzwert fehlt');
      if (qm <= 0) issues.push('Fläche fehlt');
      if (personen <= 0) issues.push('Personenzahl fehlt');
      
      if (issues.length > 0) {
        warnings.push({ unitId: unit.id, topNummer: unit.top_nummer, issues });
      }
    });
    
    return warnings;
  }, [units]);

  const selectedProperty = properties?.find(p => p.id === selectedPropertyId);

  const isLoading = isLoadingProperties || isLoadingExpenses || isLoadingUnits;

  return (
    <MainLayout
      title="BK-Abrechnung"
      subtitle="Betriebskostenabrechnung nach Verteilerschlüsseln"
    >
      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Liegenschaft</label>
              <Select
                value={selectedPropertyId}
                onValueChange={setSelectedPropertyId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Liegenschaft wählen..." />
                </SelectTrigger>
                <SelectContent>
                  {properties?.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Jahr</label>
              <Select
                value={selectedYear.toString()}
                onValueChange={(v) => setSelectedYear(parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[currentYear - 1, currentYear, currentYear + 1].map(year => (
                    <SelectItem key={year} value={year.toString()}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Monat</label>
              <Select
                value={selectedMonth?.toString() || 'all'}
                onValueChange={(v) => setSelectedMonth(v === 'all' ? null : parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Gesamtes Jahr</SelectItem>
                  {Array.from({ length: 12 }, (_, i) => (
                    <SelectItem key={i + 1} value={(i + 1).toString()}>
                      {new Date(2000, i).toLocaleString('de-AT', { month: 'long' })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {!selectedPropertyId ? (
        <GuidedEmptyState 
          icon={Home}
          title="BK-Abrechnung erstellen"
          description="Waehlen Sie oben eine Liegenschaft aus, um die Betriebskostenabrechnung zu starten. Die Abrechnung wird automatisch fuer alle Mieter der Liegenschaft erstellt."
          steps={[
            "Liegenschaft oben auswaehlen",
            "Abrechnungszeitraum pruefen",
            "Kosten und Verteilerschluessel kontrollieren",
            "Abrechnung generieren und versenden"
          ]}
          actionLabel="Assistent starten"
          actionHref="/workflows"
          secondaryActionLabel="Liegenschaften verwalten"
          secondaryActionHref="/liegenschaften"
        />
      ) : isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Euro className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Betriebskosten</p>
                    <p className="text-xl font-bold">€ {totalBkKosten.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-orange-100">
                    <Flame className="h-5 w-5 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Heizkosten</p>
                    <p className="text-xl font-bold">€ {totalHeizkosten.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Home className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Einheiten</p>
                    <p className="text-xl font-bold">{units?.length || 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <span className="text-primary font-bold text-sm">m²</span>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Gesamt-qm</p>
                    <p className="text-xl font-bold">{totals.qm.toLocaleString('de-AT')} m²</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <span className="text-primary font-bold text-sm">‰</span>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Gesamt-MEA</p>
                    <p className="text-xl font-bold">{totals.mea.toLocaleString('de-AT')}‰</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Expense Types with Distribution Keys */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Betriebskosten nach Verteilerschlüssel
              </CardTitle>
              <CardDescription>
                {selectedMonth 
                  ? `${new Date(selectedYear, selectedMonth - 1).toLocaleString('de-AT', { month: 'long', year: 'numeric' })}`
                  : `Jahr ${selectedYear}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {Object.keys(expensesByType).length === 0 && totalHeizkosten === 0 ? (
                <div className="text-center py-6">
                  <p className="text-muted-foreground mb-4">
                    Keine umlagefähigen Kosten für diesen Zeitraum erfasst.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => syncExistingTransactionsToExpenses.mutate()}
                    disabled={syncExistingTransactionsToExpenses.isPending}
                  >
                    {syncExistingTransactionsToExpenses.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Buchungen aus Buchhaltung synchronisieren
                  </Button>
                  <p className="text-xs text-muted-foreground mt-2">
                    Synchronisiert bestehende kategorisierte Ausgaben zur BK-Abrechnung
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kostenart</TableHead>
                      <TableHead>Verteilerschlüssel</TableHead>
                      <TableHead className="text-right">Betrag</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(expensesByType).map(([type, amount]) => (
                      <TableRow key={type}>
                        <TableCell className="font-medium">
                          {expenseTypeLabels[type] || type}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {distributionKeyLabels[expenseDistributionKeys[type] || 'qm']}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          € {Number(amount).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2">
                      <TableCell className="font-bold">Summe Betriebskosten</TableCell>
                      <TableCell></TableCell>
                      <TableCell className="text-right font-bold">
                        € {totalBkKosten.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                    {/* Heizung als separate Position */}
                    <TableRow className="bg-orange-50">
                      <TableCell className="font-medium flex items-center gap-2">
                        <Flame className="h-4 w-4 text-orange-600" />
                        Heizkosten
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-orange-100 text-orange-700 border-orange-300">
                          Quadratmeter
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        € {totalHeizkosten.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                    <TableRow className="border-t-2 bg-muted/50">
                      <TableCell className="font-bold">Gesamtkosten</TableCell>
                      <TableCell></TableCell>
                      <TableCell className="text-right font-bold">
                        € {(totalBkKosten + totalHeizkosten).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Warnung bei unvollständigen Einheitendaten */}
          {unitValidationWarnings.length > 0 && (
            <Card className="mb-4 border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-yellow-700 dark:text-yellow-500">
                  <AlertCircle className="h-4 w-4" />
                  Warnung: Unvollständige Einheitendaten
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-yellow-700 dark:text-yellow-500 mb-2">
                  Folgende Einheiten haben fehlende Daten, die zu einer unvollständigen Kostenverteilung führen können:
                </p>
                <div className="space-y-1">
                  {unitValidationWarnings.map(w => (
                    <div key={w.unitId} className="text-sm flex items-center gap-2">
                      <Badge variant="outline" className="text-yellow-700 border-yellow-500">{w.topNummer}</Badge>
                      <span className="text-yellow-600">{w.issues.join(', ')}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-yellow-600 mt-2">
                  Bitte korrigieren Sie die Einheitendaten unter Liegenschaften → Einheiten bearbeiten.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Kontrollrechnung - Gesamtübersicht */}
          {verificationSums && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {verificationSums.gesamtMatch ? (
                    <CheckCircle className="h-5 w-5 text-success" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-destructive" />
                  )}
                  Gesamtbetriebskostenabrechnung {selectedYear}
                </CardTitle>
                <CardDescription>
                  Kontrollrechnung: Summe der Einzelabrechnungen = Gesamtkosten
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* BK Kontrollrechnung */}
                  <div className="space-y-3">
                    <h4 className="font-semibold flex items-center gap-2 text-blue-700">
                      <Euro className="h-4 w-4" />
                      Betriebskosten
                    </h4>
                    <Table>
                      <TableBody>
                        <TableRow>
                          <TableCell>Gesamtkosten BK (laut Buchhaltung)</TableCell>
                          <TableCell className="text-right font-medium">
                            € {totalBkKosten.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                        </TableRow>
                        <TableRow className="bg-blue-50/50">
                          <TableCell className="flex items-center gap-2">
                            <Users className="h-4 w-4" />
                            davon Mieter (Einzelabrechnungen)
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            € {verificationSums.bkMieter.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                        </TableRow>
                        <TableRow className="bg-muted/50">
                          <TableCell className="flex items-center gap-2">
                            <Home className="h-4 w-4" />
                            davon Eigentümer (Leerstand)
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            € {verificationSums.bkEigentuemer.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                        </TableRow>
                        <TableRow className="border-t-2">
                          <TableCell className="font-bold">
                            Summe verteilt
                            {verificationSums.bkMatch ? (
                              <CheckCircle className="h-4 w-4 text-success inline ml-2" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-destructive inline ml-2" />
                            )}
                          </TableCell>
                          <TableCell className={`text-right font-bold ${verificationSums.bkMatch ? 'text-success' : 'text-destructive'}`}>
                            € {verificationSums.sumBkVerteilt.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                        </TableRow>
                        <TableRow className="bg-blue-100/50">
                          <TableCell>Vorschüsse erhalten (Mieter)</TableCell>
                          <TableCell className="text-right font-medium">
                            € {verificationSums.bkVorschuss.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                        </TableRow>
                        <TableRow className="border-t-2 bg-blue-100">
                          <TableCell className="font-bold">Saldo Mieter (Nachz./Guthaben)</TableCell>
                          <TableCell className={`text-right font-bold ${verificationSums.bkSaldoGesamt > 0 ? 'text-destructive' : verificationSums.bkSaldoGesamt < 0 ? 'text-success' : ''}`}>
                            {verificationSums.bkSaldoGesamt > 0 ? '+' : ''}{verificationSums.bkSaldoGesamt < 0 ? '-' : ''}€ {Math.abs(verificationSums.bkSaldoGesamt).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                            <span className="text-xs font-normal ml-1">
                              {verificationSums.bkSaldoGesamt > 0 ? '(Nachzahlung)' : verificationSums.bkSaldoGesamt < 0 ? '(Guthaben)' : ''}
                            </span>
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>

                  {/* HK Kontrollrechnung */}
                  <div className="space-y-3">
                    <h4 className="font-semibold flex items-center gap-2 text-orange-700">
                      <Flame className="h-4 w-4" />
                      Heizkosten
                    </h4>
                    <Table>
                      <TableBody>
                        <TableRow>
                          <TableCell>Gesamtkosten HK (laut Buchhaltung)</TableCell>
                          <TableCell className="text-right font-medium">
                            € {totalHeizkosten.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                        </TableRow>
                        <TableRow className="bg-orange-50/50">
                          <TableCell className="flex items-center gap-2">
                            <Users className="h-4 w-4" />
                            davon Mieter/Altmieter (Einzelabrechnungen)
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            € {verificationSums.hkMieter.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                        </TableRow>
                        <TableRow className="bg-muted/50">
                          <TableCell className="flex items-center gap-2">
                            <Home className="h-4 w-4" />
                            davon Eigentümer (Leerstand)
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            € {verificationSums.hkEigentuemer.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                        </TableRow>
                        <TableRow className="border-t-2">
                          <TableCell className="font-bold">
                            Summe verteilt
                            {verificationSums.hkMatch ? (
                              <CheckCircle className="h-4 w-4 text-success inline ml-2" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-destructive inline ml-2" />
                            )}
                          </TableCell>
                          <TableCell className={`text-right font-bold ${verificationSums.hkMatch ? 'text-success' : 'text-destructive'}`}>
                            € {verificationSums.sumHkVerteilt.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                        </TableRow>
                        <TableRow className="bg-orange-100/50">
                          <TableCell>Vorschüsse erhalten (Mieter/Altmieter)</TableCell>
                          <TableCell className="text-right font-medium">
                            € {verificationSums.hkVorschuss.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                        </TableRow>
                        <TableRow className="border-t-2 bg-orange-100">
                          <TableCell className="font-bold">Saldo Mieter (Nachz./Guthaben)</TableCell>
                          <TableCell className={`text-right font-bold ${verificationSums.hkSaldoGesamt > 0 ? 'text-destructive' : verificationSums.hkSaldoGesamt < 0 ? 'text-success' : ''}`}>
                            {verificationSums.hkSaldoGesamt > 0 ? '+' : ''}{verificationSums.hkSaldoGesamt < 0 ? '-' : ''}€ {Math.abs(verificationSums.hkSaldoGesamt).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                            <span className="text-xs font-normal ml-1">
                              {verificationSums.hkSaldoGesamt > 0 ? '(Nachzahlung)' : verificationSums.hkSaldoGesamt < 0 ? '(Guthaben)' : ''}
                            </span>
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {/* Gesamtsumme */}
                <div className="mt-6 p-4 bg-muted rounded-lg">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-sm text-muted-foreground">Gesamtkosten</p>
                      <p className="text-2xl font-bold">
                        € {(totalBkKosten + totalHeizkosten).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Summe Einzelabrechnungen</p>
                      <p className={`text-2xl font-bold ${verificationSums.gesamtMatch ? 'text-success' : 'text-destructive'}`}>
                        € {(verificationSums.sumBkVerteilt + verificationSums.sumHkVerteilt).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                        {verificationSums.gesamtMatch && <CheckCircle className="h-5 w-5 inline ml-2" />}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Differenz</p>
                      <p className={`text-2xl font-bold ${verificationSums.gesamtMatch ? 'text-success' : 'text-destructive'}`}>
                        € {Math.abs((totalBkKosten + totalHeizkosten) - (verificationSums.sumBkVerteilt + verificationSums.sumHkVerteilt)).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                </div>

                {/* PDF Export Buttons */}
                <div className="mt-6 flex flex-wrap gap-3">
                  <Button 
                    onClick={() => {
                      if (!selectedProperty || !verificationSums) return;
                      generateGesamtabrechnungPdf(
                        {
                          name: selectedProperty.name,
                          address: selectedProperty.address,
                          city: selectedProperty.city,
                          postal_code: (selectedProperty as any).postal_code || (selectedProperty as any).postalCode,
                        },
                        unitDistribution,
                        selectedYear,
                        expensesByType,
                        totalBkKosten,
                        totalHeizkosten,
                        totals,
                        expenseDistributionKeys,
                        verificationSums
                      );
                      toast.success('Gesamtabrechnung PDF erstellt');
                    }}
                  >
                    <FileDown className="h-4 w-4 mr-2" />
                    Gesamtabrechnung PDF
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => {
                      if (!selectedProperty) return;
                      const unitsWithTenants = unitDistribution.filter(u => !u.isLeerstandBK || !u.isLeerstandHK);
                      if (unitsWithTenants.length === 0) {
                        toast.error('Keine Mieter für Einzelabrechnungen vorhanden');
                        return;
                      }
                      generateAllTenantSettlementsPdf(
                        {
                          name: selectedProperty.name,
                          address: selectedProperty.address,
                          city: selectedProperty.city,
                          postal_code: (selectedProperty as any).postal_code || (selectedProperty as any).postalCode,
                        },
                        unitDistribution,
                        selectedYear,
                        expensesByType,
                        totalBkKosten,
                        totalHeizkosten,
                        totals,
                        expenseDistributionKeys
                      );
                      toast.success(`${unitsWithTenants.length} Einzelabrechnungen werden erstellt...`);
                    }}
                  >
                    <Files className="h-4 w-4 mr-2" />
                    Alle Einzelabrechnungen ({unitDistribution.filter(u => !u.isLeerstandBK || !u.isLeerstandHK).length})
                  </Button>
                </div>

                {/* Speichern und E-Mail Optionen */}
                <div className="mt-6 p-4 border rounded-lg bg-card">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center space-x-2">
                      <Checkbox 
                        id="sendEmails" 
                        checked={sendEmails}
                        onCheckedChange={(checked) => setSendEmails(checked === true)}
                      />
                      <Label htmlFor="sendEmails" className="flex items-center gap-2">
                        <Mail className="h-4 w-4" />
                        E-Mails an Mieter senden (bei hinterlegter E-Mail)
                      </Label>
                    </div>
                    
                    <div className="flex gap-2 ml-auto">
                      <Button
                        onClick={() => {
                          if (!selectedProperty || !verificationSums) return;
                          
                          const items = unitDistribution.map(u => ({
                            unitId: u.id,
                            tenantId: u.bkTenantId || u.hkTenantId,
                            tenantName: u.bkMieter || u.hkMieter || 'Eigentümer',
                            tenantEmail: u.tenantEmail,
                            isLeerstandBK: u.isLeerstandBK,
                            isLeerstandHK: u.isLeerstandHK,
                            bkAnteil: u.totalBkCost,
                            hkAnteil: u.hkCost,
                            bkVorschuss: u.bkVorschuss,
                            hkVorschuss: u.hkVorschuss,
                            bkSaldo: u.bkSaldo,
                            hkSaldo: u.hkSaldo,
                            gesamtSaldo: u.gesamtSaldo,
                          }));

                          saveSettlement.mutate({
                            propertyId: selectedPropertyId,
                            propertyName: selectedProperty.name,
                            propertyAddress: `${selectedProperty.address}, ${(selectedProperty as any).postal_code || (selectedProperty as any).postalCode} ${selectedProperty.city}`,
                            year: selectedYear,
                            totalBk: totalBkKosten,
                            totalHk: totalHeizkosten,
                            bkMieter: verificationSums.bkMieter,
                            hkMieter: verificationSums.hkMieter,
                            bkEigentuemer: verificationSums.bkEigentuemer,
                            hkEigentuemer: verificationSums.hkEigentuemer,
                            items,
                            sendEmails,
                          });
                        }}
                        disabled={saveSettlement.isPending || existingSettlement?.status === 'abgeschlossen'}
                      >
                        {saveSettlement.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4 mr-2" />
                        )}
                        {existingSettlement ? 'Aktualisieren' : 'Speichern'}
                        {sendEmails && ` + E-Mails`}
                      </Button>

                      {existingSettlement && existingSettlement.status !== 'abgeschlossen' && (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            finalizeSettlement.mutate({ settlementId: existingSettlement.id });
                          }}
                          disabled={finalizeSettlement.isPending}
                        >
                          {finalizeSettlement.isPending ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <CheckCircle className="h-4 w-4 mr-2" />
                          )}
                          Finalisieren
                        </Button>
                      )}

                      {/* New Advances Button - only show when settlement is finalized */}
                      {existingSettlement && existingSettlement.status === 'abgeschlossen' && (
                        <Button
                          variant="outline"
                          className="border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                          onClick={() => setIsAdvanceDialogOpen(true)}
                        >
                          <RefreshCcw className="h-4 w-4 mr-2" />
                          Neue Vorschreibung ab {selectedYear + 1}
                        </Button>
                      )}
                    </div>
                  </div>

                  {existingSettlement && (
                    <div className="mt-3 flex items-center gap-2 text-sm">
                      <Badge variant={existingSettlement.status === 'abgeschlossen' ? 'default' : 'secondary'}>
                        {existingSettlement.status === 'entwurf' && 'Entwurf'}
                        {existingSettlement.status === 'berechnet' && 'Berechnet'}
                        {existingSettlement.status === 'versendet' && 'Versendet'}
                        {existingSettlement.status === 'abgeschlossen' && 'Abgeschlossen'}
                      </Badge>
                      {existingSettlement.finalized_at && (
                        <span className="text-muted-foreground">
                          Finalisiert am {new Date(existingSettlement.finalized_at).toLocaleDateString('de-AT')}
                        </span>
                      )}
                      {existingSettlement.status === 'abgeschlossen' && (
                        <span className="text-muted-foreground italic">
                          (Änderungen nicht mehr möglich)
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Calculator className="h-5 w-5" />
                    Einzelabrechnungen pro Einheit
                  </CardTitle>
                  <CardDescription>
                    Anteilige Kosten, Vorauszahlungen und Saldo ({monthCount} {monthCount === 1 ? 'Monat' : 'Monate'}) - Klicken Sie auf eine Zeile für PDF-Export
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {unitDistribution.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">
                  Keine Einheiten vorhanden.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Top</TableHead>
                        <TableHead className="bg-blue-50">BK Mieter</TableHead>
                        <TableHead className="bg-orange-50">HK Mieter (Altmieter)</TableHead>
                        <TableHead className="text-right">qm</TableHead>
                        <TableHead className="text-right bg-blue-50">BK Anteil</TableHead>
                        <TableHead className="text-right bg-blue-50">BK Vorschuss</TableHead>
                        <TableHead className="text-right bg-blue-50">BK Saldo</TableHead>
                        <TableHead className="text-right bg-orange-50">HK Anteil</TableHead>
                        <TableHead className="text-right bg-orange-50">HK Vorschuss</TableHead>
                        <TableHead className="text-right bg-orange-50">HK Saldo</TableHead>
                        <TableHead className="text-right">PDF</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unitDistribution.map(unit => (
                        <TableRow key={unit.id} className={`${unit.isLeerstand ? 'bg-muted/30' : ''}`}>
                          <TableCell className="font-medium">
                            {unit.top_nummer}
                          </TableCell>
                          {/* BK Mieter */}
                          <TableCell className="bg-blue-50/30">
                            {unit.bkMieter || (
                              <span className="text-muted-foreground italic flex items-center gap-1">
                                <Badge variant="outline" className="text-xs">Leerstand</Badge>
                                Eigentümer
                              </span>
                            )}
                          </TableCell>
                          {/* HK Mieter (Altmieter) */}
                          <TableCell className="bg-orange-50/30">
                            {unit.hkMieter || (
                              <span className="text-muted-foreground italic flex items-center gap-1">
                                <Badge variant="outline" className="text-xs">Leerstand</Badge>
                                Eigentümer
                              </span>
                            )}
                            {unit.hkMieter && unit.bkMieter && unit.hkMieter !== unit.bkMieter && (
                              <Badge variant="secondary" className="ml-1 text-xs">Alt</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{Number(unit.qm).toLocaleString('de-AT')}</TableCell>
                          {/* BK */}
                          <TableCell className="text-right bg-blue-50/50">
                            € {unit.totalBkCost.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                            {unit.isLeerstandBK && (
                              <span className="text-xs block text-muted-foreground">(Eigentümer)</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right bg-blue-50/50">
                            {unit.isLeerstandBK ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              `€ ${unit.bkVorschuss.toLocaleString('de-AT', { minimumFractionDigits: 2 })}`
                            )}
                          </TableCell>
                          <TableCell className="text-right bg-blue-50/50">
                            {unit.isLeerstandBK ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <span className={`flex items-center justify-end gap-1 ${unit.bkSaldo > 0 ? 'text-destructive' : unit.bkSaldo < 0 ? 'text-success' : ''}`}>
                                {unit.bkSaldo > 0 && <TrendingUp className="h-3 w-3" />}
                                {unit.bkSaldo < 0 && <TrendingDown className="h-3 w-3" />}
                                € {Math.abs(unit.bkSaldo).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                                <span className="text-xs font-normal ml-1">
                                  {unit.bkSaldo > 0 ? '(Nachz.)' : unit.bkSaldo < 0 ? '(Guthaben)' : ''}
                                </span>
                              </span>
                            )}
                          </TableCell>
                          {/* HK */}
                          <TableCell className="text-right bg-orange-50/50">
                            € {unit.hkCost.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                            {unit.isLeerstandHK && (
                              <span className="text-xs block text-muted-foreground">(Eigentümer)</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right bg-orange-50/50">
                            {unit.isLeerstandHK ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              `€ ${unit.hkVorschuss.toLocaleString('de-AT', { minimumFractionDigits: 2 })}`
                            )}
                          </TableCell>
                          <TableCell className="text-right bg-orange-50/50">
                            {unit.isLeerstandHK ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <span className={`flex items-center justify-end gap-1 ${unit.hkSaldo > 0 ? 'text-destructive' : unit.hkSaldo < 0 ? 'text-success' : ''}`}>
                                {unit.hkSaldo > 0 && <TrendingUp className="h-3 w-3" />}
                                {unit.hkSaldo < 0 && <TrendingDown className="h-3 w-3" />}
                                € {Math.abs(unit.hkSaldo).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                                <span className="text-xs font-normal ml-1">
                                  {unit.hkSaldo > 0 ? '(Nachz.)' : unit.hkSaldo < 0 ? '(Guthaben)' : ''}
                                </span>
                              </span>
                            )}
                          </TableCell>
                          {/* Details + PDF Button */}
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedUnitDetail(unit)}
                                title={`Details für Top ${unit.top_nummer}`}
                                data-testid={`button-unit-detail-${unit.id}`}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              {(!unit.isLeerstandBK || !unit.isLeerstandHK) && selectedProperty && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    generateTenantSettlementPdf(
                                      {
                                        name: selectedProperty.name,
                                        address: selectedProperty.address,
                                        city: selectedProperty.city,
                                        postal_code: (selectedProperty as any).postal_code || (selectedProperty as any).postalCode,
                                      },
                                      unit,
                                      selectedYear,
                                      expensesByType,
                                      totalBkKosten,
                                      totalHeizkosten,
                                      totals,
                                      expenseDistributionKeys
                                    );
                                    toast.success(`PDF für Top ${unit.top_nummer} erstellt`);
                                  }}
                                  title={`PDF für Top ${unit.top_nummer}`}
                                  data-testid={`button-unit-pdf-${unit.id}`}
                                >
                                  <FileDown className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {/* Summenzeile */}
                      <TableRow className="border-t-2 bg-muted/50">
                        <TableCell className="font-bold">Summe</TableCell>
                        <TableCell></TableCell>
                        <TableCell></TableCell>
                        <TableCell className="text-right font-medium">{totals.qm.toLocaleString('de-AT')}</TableCell>
                        <TableCell className="text-right font-medium bg-blue-50/50">
                          € {unitDistribution.reduce((sum, u) => sum + u.totalBkCost, 0).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-medium bg-blue-50/50">
                          € {unitDistribution.filter(u => !u.isLeerstandBK).reduce((sum, u) => sum + u.bkVorschuss, 0).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-medium bg-blue-50/50">
                          € {unitDistribution.filter(u => !u.isLeerstandBK).reduce((sum, u) => sum + u.bkSaldo, 0).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-medium bg-orange-50/50">
                          € {unitDistribution.reduce((sum, u) => sum + u.hkCost, 0).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-medium bg-orange-50/50">
                          € {unitDistribution.filter(u => !u.isLeerstandHK).reduce((sum, u) => sum + u.hkVorschuss, 0).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-medium bg-orange-50/50">
                          € {unitDistribution.filter(u => !u.isLeerstandHK).reduce((sum, u) => sum + u.hkSaldo, 0).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Legende */}
              <div className="mt-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-destructive" />
                  <span>Nachzahlung</span>
                </div>
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-success" />
                  <span>Guthaben</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">Alt</Badge>
                  <span>Altmieter (zahlt nur HK)</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">Leerstand</Badge>
                  <span>Kosten trägt Eigentümer</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* New Advance Dialog */}
      {selectedProperty && units && (
        <NewAdvanceDialog
          open={isAdvanceDialogOpen}
          onOpenChange={setIsAdvanceDialogOpen}
          propertyId={selectedPropertyId}
          propertyName={selectedProperty.name}
          propertyAddress={`${selectedProperty.address}, ${(selectedProperty as any).postal_code || (selectedProperty as any).postalCode} ${selectedProperty.city}`}
          settlementYear={selectedYear}
          tenantChanges={unitDistribution
            .filter(u => u.current_tenant && !u.isLeerstandBK)
            .map(u => {
              // Calculate new advances based on actual costs
              const newBk = totals.mea > 0 
                ? Math.round((u.mea / totals.mea * totalBkKosten / 12) * 100) / 100 
                : 0;
              const newHk = totals.qm > 0 
                ? Math.round((u.qm / totals.qm * totalHeizkosten / 12) * 100) / 100 
                : 0;
              
              return {
                tenantId: u.current_tenant?.id || '',
                tenantName: u.bkMieter || '',
                unitNumber: u.top_nummer,
                oldBk: u.bkVorschuss / 12, // Current monthly advance
                newBk,
                oldHk: u.hkVorschuss / 12, // Current monthly advance
                newHk,
                grundmiete: 0, // We don't have access to grundmiete here, will be fetched in dialog
              };
            })}
          onConfirm={async (effectiveMonth, effectiveYear) => {
            if (!units) return;
            
            const unitsForUpdate = units.map(u => ({
              id: u.id,
              qm: u.qm,
              mea: u.mea,
              currentTenantId: u.current_tenant?.id || null,
            }));

            await updateNewAdvances.mutateAsync({
              propertyId: selectedPropertyId,
              totalBkKosten: totalBkKosten,
              totalHkKosten: totalHeizkosten,
              units: unitsForUpdate,
              totals: {
                qm: totals.qm,
                mea: totals.mea,
              },
            });
          }}
          isPending={updateNewAdvances.isPending}
        />
      )}

      {/* Einzelabrechnungs-Detail Dialog */}
      <Dialog open={!!selectedUnitDetail} onOpenChange={(open) => !open && setSelectedUnitDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Einzelabrechnung {selectedUnitDetail?.top_nummer} - {selectedYear}
            </DialogTitle>
            <DialogDescription>
              Detaillierte Kostenaufschlüsselung nach Kostenart und Verteilerschlüssel
            </DialogDescription>
          </DialogHeader>
          
          {selectedUnitDetail && (
            <div className="space-y-6">
              {/* Mieter-Info */}
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-blue-700">BK-Zahler</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="font-medium">{selectedUnitDetail.bkMieter || 'Eigentümer (Leerstand)'}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-orange-700">HK-Zahler</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="font-medium">{selectedUnitDetail.hkMieter || 'Eigentümer (Leerstand)'}</p>
                  </CardContent>
                </Card>
              </div>

              {/* Einheitsdaten */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Verteilungsgrundlagen</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Fläche (qm):</span>
                      <p className="font-medium">{Number(selectedUnitDetail.qm).toLocaleString('de-AT')} m² 
                        <span className="text-xs text-muted-foreground ml-1">
                          ({totals.qm > 0 ? ((Number(selectedUnitDetail.qm) / totals.qm) * 100).toFixed(2) : 0}%)
                        </span>
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">MEA (Nutzwert):</span>
                      <p className="font-medium">{Number(selectedUnitDetail.mea).toLocaleString('de-AT', { minimumFractionDigits: 4 })}
                        <span className="text-xs text-muted-foreground ml-1">
                          ({totals.mea > 0 ? ((Number(selectedUnitDetail.mea) / totals.mea) * 100).toFixed(2) : 0}%)
                        </span>
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Personen:</span>
                      <p className="font-medium">{selectedUnitDetail.vs_personen || 0}
                        <span className="text-xs text-muted-foreground ml-1">
                          ({totals.personen > 0 ? ((selectedUnitDetail.vs_personen / totals.personen) * 100).toFixed(2) : 0}%)
                        </span>
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Betriebskosten Aufschlüsselung */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-blue-700 flex items-center gap-2">
                    <Euro className="h-4 w-4" />
                    Betriebskosten nach Kostenart
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kostenart</TableHead>
                        <TableHead>Schlüssel</TableHead>
                        <TableHead className="text-right">Gesamt</TableHead>
                        <TableHead className="text-right">Anteil</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(selectedUnitDetail.costs || {}).map(([type, amount]: [string, any]) => {
                        const totalAmount = expensesByType[type] || 0;
                        const key = expenseDistributionKeys[type] || 'qm';
                        return (
                          <TableRow key={type}>
                            <TableCell>{expenseTypeLabels[type] || type}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                {distributionKeyLabels[key]}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground">
                              € {totalAmount.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              € {Number(amount).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="border-t-2 font-bold">
                        <TableCell colSpan={3}>Summe Betriebskosten</TableCell>
                        <TableCell className="text-right">
                          € {selectedUnitDetail.totalBkCost.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Heizkosten */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-orange-700 flex items-center gap-2">
                    <Flame className="h-4 w-4" />
                    Heizkosten
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-muted-foreground text-sm">Verteilung nach m² (beheizt)</span>
                      <p className="text-xs text-muted-foreground">
                        {Number(selectedUnitDetail.qm).toLocaleString('de-AT')} m² von {totals.qmBeheizt.toLocaleString('de-AT')} m² = 
                        {totals.qmBeheizt > 0 ? ((Number(selectedUnitDetail.qm) / totals.qmBeheizt) * 100).toFixed(2) : 0}%
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-muted-foreground text-sm">
                        Gesamt: € {totalHeizkosten.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </p>
                      <p className="font-bold text-lg">
                        € {selectedUnitDetail.hkCost.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Saldo Zusammenfassung */}
              <Card className="border-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Saldo Übersicht</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableBody>
                      <TableRow>
                        <TableCell>BK Kosten</TableCell>
                        <TableCell className="text-right">€ {selectedUnitDetail.totalBkCost.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>BK Vorschuss bezahlt</TableCell>
                        <TableCell className="text-right">€ {selectedUnitDetail.bkVorschuss.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</TableCell>
                      </TableRow>
                      <TableRow className="font-bold">
                        <TableCell>BK Saldo</TableCell>
                        <TableCell className={`text-right ${selectedUnitDetail.bkSaldo > 0 ? 'text-destructive' : 'text-success'}`}>
                          € {selectedUnitDetail.bkSaldo.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          <span className="text-xs ml-1">
                            {selectedUnitDetail.bkSaldo > 0 ? '(Nachzahlung)' : selectedUnitDetail.bkSaldo < 0 ? '(Guthaben)' : ''}
                          </span>
                        </TableCell>
                      </TableRow>
                      <TableRow className="border-t">
                        <TableCell>HK Kosten</TableCell>
                        <TableCell className="text-right">€ {selectedUnitDetail.hkCost.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>HK Vorschuss bezahlt</TableCell>
                        <TableCell className="text-right">€ {selectedUnitDetail.hkVorschuss.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</TableCell>
                      </TableRow>
                      <TableRow className="font-bold">
                        <TableCell>HK Saldo</TableCell>
                        <TableCell className={`text-right ${selectedUnitDetail.hkSaldo > 0 ? 'text-destructive' : 'text-success'}`}>
                          € {selectedUnitDetail.hkSaldo.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          <span className="text-xs ml-1">
                            {selectedUnitDetail.hkSaldo > 0 ? '(Nachzahlung)' : selectedUnitDetail.hkSaldo < 0 ? '(Guthaben)' : ''}
                          </span>
                        </TableCell>
                      </TableRow>
                      <TableRow className="border-t-2 bg-muted/50">
                        <TableCell className="font-bold text-lg">Gesamtsaldo</TableCell>
                        <TableCell className={`text-right font-bold text-lg ${selectedUnitDetail.gesamtSaldo > 0 ? 'text-destructive' : 'text-success'}`}>
                          € {selectedUnitDetail.gesamtSaldo.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          <span className="text-sm ml-2">
                            {selectedUnitDetail.gesamtSaldo > 0 ? '(Nachzahlung)' : selectedUnitDetail.gesamtSaldo < 0 ? '(Guthaben)' : ''}
                          </span>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
