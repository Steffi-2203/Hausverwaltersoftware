import { useState, useMemo } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
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
import {
  Loader2,
  Flame,
  Eye,
  FileText,
  Download,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useProperties } from '@/hooks/useProperties';

function formatEur(value: number): string {
  return value.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' });
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  entwurf: { label: 'Entwurf', variant: 'secondary' },
  berechnet: { label: 'Berechnet', variant: 'default' },
  geprueft: { label: 'Geprüft', variant: 'outline', className: 'text-green-600 border-green-600' },
  versendet: { label: 'Versendet', variant: 'outline' },
  storniert: { label: 'Storniert', variant: 'destructive' },
};

const complianceRequirements = [
  { paragraph: '§5', title: 'Anwendungsbereich', description: 'HeizKG gilt für Gebäude mit mindestens 4 Nutzungsobjekten und gemeinsamer Wärmeversorgung.', check: 'Prüfung der Anzahl der Nutzungsobjekte und gemeinsamer Heizanlage.' },
  { paragraph: '§6', title: 'Begriffsbestimmungen', description: 'Korrekte Verwendung der Begriffe: Nutzfläche, Verbrauchsanteile, Grundkosten.', check: 'Validierung der Flächenangaben und Messgerätetypen.' },
  { paragraph: '§7', title: 'Aufteilung der Heiz- und Warmwasserkosten', description: 'Aufteilung in verbrauchsabhängige und flächenabhängige Anteile.', check: 'Prüfung der Aufteilungsschlüssel (55-65% Verbrauch, 35-45% Fläche).' },
  { paragraph: '§8', title: 'Verbrauchsanteil', description: 'Der Verbrauchsanteil muss zwischen 55% und 65% der Gesamtkosten betragen.', check: 'Validierung der konfigurierten Verbrauchsanteile für Heizung und Warmwasser.' },
  { paragraph: '§9', title: 'Abrechnungszeitraum', description: 'Der Abrechnungszeitraum darf maximal 12 Monate betragen.', check: 'Prüfung des Zeitraums auf maximale Dauer.' },
  { paragraph: '§10', title: 'Messgeräte', description: 'Verbrauchserfassung durch Heizkostenverteiler oder Wärmemengenzähler.', check: 'Prüfung der Messgerätetypen je Einheit.' },
  { paragraph: '§11', title: 'Ablesung und Auswertung', description: 'Ordnungsgemäße Ablesung und Auswertung der Messgeräte.', check: 'Validierung der Messwerte auf Plausibilität.' },
  { paragraph: '§12', title: 'Schätzung bei fehlenden Messdaten', description: 'Einheiten ohne Messdaten werden nach Fläche verteilt.', check: 'Kennzeichnung geschätzter Werte und Anwendung der Flächenverteilung.' },
  { paragraph: '§13', title: 'Warmwasserkosten', description: 'Gesonderte Aufteilung der Warmwasserkosten.', check: 'Separate Berechnung und Ausweisung der Warmwasserkosten.' },
  { paragraph: '§14', title: 'Abrechnung', description: 'Detaillierte Abrechnung mit Nachvollziehbarkeit für jeden Nutzer.', check: 'Prüfung auf Vollständigkeit aller Positionen und Saldoermittlung.' },
  { paragraph: '§15', title: 'Einsichtsrecht', description: 'Nutzer haben Recht auf Einsicht in Abrechnungsunterlagen.', check: 'Bereitstellung von PDF- und CSV-Exporten.' },
];

interface UnitMeterData {
  heatingMeterType: string;
  heatingMeterValue: string;
  hotWaterMeterValue: string;
  prepayment: string;
  occupancy: string;
}

function StepIndicator({ currentStep, totalSteps }: { currentStep: number; totalSteps: number }) {
  const stepLabels = ['Grunddaten', 'Messdaten', 'Ergebnis', 'Prüfprotokoll'];
  return (
    <div className="flex items-center gap-2 mb-6" data-testid="step-indicator">
      {Array.from({ length: totalSteps }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
              i + 1 === currentStep
                ? 'bg-primary text-primary-foreground'
                : i + 1 < currentStep
                ? 'bg-green-600 text-white'
                : 'bg-muted text-muted-foreground'
            }`}
            data-testid={`step-${i + 1}`}
          >
            {i + 1 < currentStep ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
          </div>
          <span className={`text-sm hidden sm:inline ${i + 1 === currentStep ? 'font-medium' : 'text-muted-foreground'}`}>
            {stepLabels[i]}
          </span>
          {i < totalSteps - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      ))}
    </div>
  );
}

function ResultsSummaryCards({ result, totalInputCosts }: { result: any; totalInputCosts: number }) {
  const summary = result?.summary;
  if (!summary) return null;
  const diff = Number(summary.trialBalanceDiff || 0);
  const diffColor = Math.abs(diff) === 0 ? 'text-green-600 dark:text-green-400' : Math.abs(diff) <= 0.01 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400';
  const totalHeating = result.lines?.reduce((s: number, l: any) => s + Number(l.heatingTotal || 0), 0) || 0;
  const totalHotWater = result.lines?.reduce((s: number, l: any) => s + Number(l.hotWaterTotal || 0), 0) || 0;
  const totalMaint = result.lines?.reduce((s: number, l: any) => s + Number(l.maintenanceShare || 0) + Number(l.meterReadingShare || 0), 0) || 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
      <Card data-testid="card-total-costs">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Gesamtkosten</p>
          <p className="text-lg font-bold" data-testid="text-summary-total">{formatEur(totalInputCosts)}</p>
        </CardContent>
      </Card>
      <Card data-testid="card-heating-distributed">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Heizung verteilt</p>
          <p className="text-lg font-bold" data-testid="text-summary-heating">{formatEur(totalHeating)}</p>
        </CardContent>
      </Card>
      <Card data-testid="card-hotwater-distributed">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Warmwasser verteilt</p>
          <p className="text-lg font-bold" data-testid="text-summary-hotwater">{formatEur(totalHotWater)}</p>
        </CardContent>
      </Card>
      <Card data-testid="card-maintenance-distributed">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Wartung + Messkosten</p>
          <p className="text-lg font-bold" data-testid="text-summary-maintenance">{formatEur(totalMaint)}</p>
        </CardContent>
      </Card>
      <Card data-testid="card-trial-balance">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Trial-Balance-Differenz</p>
          <p className={`text-lg font-bold ${diffColor}`} data-testid="text-summary-diff">{formatEur(diff)}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function ResultsTable({ lines }: { lines: any[] }) {
  if (!lines || lines.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <Table data-testid="table-results">
        <TableHeader>
          <TableRow>
            <TableHead>Top-Nr</TableHead>
            <TableHead>Mieter</TableHead>
            <TableHead className="text-right">Fläche m²</TableHead>
            <TableHead className="text-right">Heizung Verbr.</TableHead>
            <TableHead className="text-right">Heizung Fläche</TableHead>
            <TableHead className="text-right">Heizung Ges.</TableHead>
            <TableHead className="text-right">WW Verbr.</TableHead>
            <TableHead className="text-right">WW Fläche</TableHead>
            <TableHead className="text-right">WW Ges.</TableHead>
            <TableHead className="text-right">Wartung</TableHead>
            <TableHead className="text-right">Messkosten</TableHead>
            <TableHead className="text-right">Gesamt</TableHead>
            <TableHead className="text-right">Vorauszahlung</TableHead>
            <TableHead className="text-right">Saldo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l: any, idx: number) => {
            const balance = Number(l.balance || 0);
            const isEstimated = l.isEstimated;
            return (
              <TableRow
                key={l.unitId || idx}
                className={isEstimated ? 'bg-yellow-50 dark:bg-yellow-900/10' : ''}
                data-testid={`row-result-${l.unitId || idx}`}
              >
                <TableCell className="flex items-center gap-1">
                  {isEstimated && <Info className="h-3 w-3 text-yellow-600" />}
                  {(l.unitId || '').substring(0, 8)}
                </TableCell>
                <TableCell>{l.tenantName || '—'}</TableCell>
                <TableCell className="text-right">{Number(l.areaM2 || 0).toFixed(2)}</TableCell>
                <TableCell className="text-right">{formatEur(Number(l.heatingConsumptionShare || 0))}</TableCell>
                <TableCell className="text-right">{formatEur(Number(l.heatingAreaShare || 0))}</TableCell>
                <TableCell className="text-right font-medium">{formatEur(Number(l.heatingTotal || 0))}</TableCell>
                <TableCell className="text-right">{formatEur(Number(l.hotWaterConsumptionShare || 0))}</TableCell>
                <TableCell className="text-right">{formatEur(Number(l.hotWaterAreaShare || 0))}</TableCell>
                <TableCell className="text-right font-medium">{formatEur(Number(l.hotWaterTotal || 0))}</TableCell>
                <TableCell className="text-right">{formatEur(Number(l.maintenanceShare || 0))}</TableCell>
                <TableCell className="text-right">{formatEur(Number(l.meterReadingShare || 0))}</TableCell>
                <TableCell className="text-right font-bold">{formatEur(Number(l.totalCost || 0))}</TableCell>
                <TableCell className="text-right">{formatEur(Number(l.prepayment || 0))}</TableCell>
                <TableCell
                  className={`text-right font-medium ${balance > 0 ? 'text-red-600 dark:text-red-400' : balance < 0 ? 'text-green-600 dark:text-green-400' : ''}`}
                  data-testid={`text-balance-${l.unitId || idx}`}
                >
                  {balance > 0 ? `${formatEur(balance)} Nachzahlung` : balance < 0 ? `${formatEur(Math.abs(balance))} Guthaben` : formatEur(0)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ComplianceCheckTable({ checks }: { checks: any[] }) {
  if (!checks || checks.length === 0) return null;

  const statusBadge = (status: string) => {
    if (status === 'ok') return <Badge variant="outline" className="text-green-600 border-green-600" data-testid="badge-compliance-ok">OK</Badge>;
    if (status === 'warnung') return <Badge variant="secondary" className="text-yellow-600" data-testid="badge-compliance-warning">Warnung</Badge>;
    return <Badge variant="destructive" data-testid="badge-compliance-error">Fehler</Badge>;
  };

  return (
    <Table data-testid="table-compliance">
      <TableHeader>
        <TableRow>
          <TableHead>Paragraph</TableHead>
          <TableHead>Anforderung</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Details</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {checks.map((c: any, i: number) => (
          <TableRow key={i} data-testid={`row-compliance-${i}`}>
            <TableCell className="font-medium">{c.paragraph || c.rule || `§${i + 5}`}</TableCell>
            <TableCell>{c.requirement || c.description || c.title || ''}</TableCell>
            <TableCell>{statusBadge(c.status || 'ok')}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{c.details || c.message || ''}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function BillingRunsTab({
  selectedPropertyId,
  setSelectedPropertyId,
  properties,
  propertiesLoading,
  onViewRun,
  onNewRun,
}: {
  selectedPropertyId: string;
  setSelectedPropertyId: (v: string) => void;
  properties: any[];
  propertiesLoading: boolean;
  onViewRun: (run: any) => void;
  onNewRun: () => void;
}) {
  const { toast } = useToast();

  const { data: runs = [], isLoading: runsLoading } = useQuery({
    queryKey: ['/api/heizkosten/runs', selectedPropertyId],
    queryFn: async () => {
      const url = selectedPropertyId
        ? `/api/heizkosten/runs?propertyId=${selectedPropertyId}`
        : '/api/heizkosten/runs';
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden der Abrechnungsläufe');
      return res.json();
    },
  });

  const handleExport = async (id: number, format?: string) => {
    try {
      const url = format ? `/api/heizkosten/export/${id}?format=${format}` : `/api/heizkosten/export/${id}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Export fehlgeschlagen');
      if (format === 'csv') {
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `heizkosten_${id}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      } else {
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `heizkosten_${id}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      }
      toast({ title: 'Export erfolgreich' });
    } catch (error: any) {
      toast({ title: 'Export fehlgeschlagen', description: error.message, variant: 'destructive' });
    }
  };

  const handlePdf = async (id: number) => {
    try {
      const res = await apiRequest('POST', '/api/heizkosten/generatePdf', { runId: id });
      const data = await res.json();
      if (data.html) {
        const w = window.open('', '_blank');
        if (w) {
          w.document.write(data.html);
          w.document.close();
        }
      }
      toast({ title: 'PDF generiert' });
    } catch (error: any) {
      toast({ title: 'PDF-Generierung fehlgeschlagen', description: error.message, variant: 'destructive' });
    }
  };

  const totalCosts = (run: any) =>
    Number(run.heatingSupplyCost || 0) + Number(run.hotWaterSupplyCost || 0) + Number(run.maintenanceCost || 0) + Number(run.meterReadingCost || 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2 min-w-[250px]">
          <Label>Liegenschaft filtern</Label>
          {propertiesLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" data-testid="loader-properties" />
          ) : (
            <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId} data-testid="select-property-filter">
              <SelectTrigger data-testid="select-property-filter-trigger">
                <SelectValue placeholder="Alle Liegenschaften" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Liegenschaften</SelectItem>
                {properties.map((p: any) => (
                  <SelectItem key={p.id} value={p.id} data-testid={`select-property-${p.id}`}>
                    {p.name || p.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <Button onClick={onNewRun} data-testid="button-new-billing">
          <Flame className="h-4 w-4 mr-2" />
          Neue Abrechnung
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {runsLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin" data-testid="loader-runs" />
            </div>
          ) : (runs as any[]).length === 0 ? (
            <div className="p-8 text-center text-muted-foreground" data-testid="text-no-runs">
              Keine Abrechnungsläufe vorhanden.
            </div>
          ) : (
            <Table data-testid="table-runs">
              <TableHeader>
                <TableRow>
                  <TableHead>Periode</TableHead>
                  <TableHead>Liegenschaft</TableHead>
                  <TableHead className="text-right">Gesamtkosten</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Version</TableHead>
                  <TableHead className="text-right">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(runs as any[]).map((run: any) => {
                  const sc = statusConfig[run.status] || statusConfig.entwurf;
                  return (
                    <TableRow key={run.id} data-testid={`row-run-${run.id}`}>
                      <TableCell data-testid={`text-period-${run.id}`}>{run.periodFrom} — {run.periodTo}</TableCell>
                      <TableCell data-testid={`text-property-${run.id}`}>{run.propertyName || '—'}</TableCell>
                      <TableCell className="text-right" data-testid={`text-cost-${run.id}`}>{formatEur(totalCosts(run))}</TableCell>
                      <TableCell>
                        <Badge variant={sc.variant} className={sc.className || ''} data-testid={`badge-status-${run.id}`}>
                          {sc.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right" data-testid={`text-version-${run.id}`}>{run.version || 1}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="icon" variant="ghost" onClick={() => onViewRun(run)} data-testid={`button-view-${run.id}`}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          {run.status === 'berechnet' && (
                            <Button size="icon" variant="ghost" onClick={() => handlePdf(run.id)} data-testid={`button-pdf-${run.id}`}>
                              <FileText className="h-4 w-4" />
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" onClick={() => handleExport(run.id)} data-testid={`button-export-${run.id}`}>
                            <Download className="h-4 w-4" />
                          </Button>
                          {(run.status === 'berechnet' || run.status === 'geprueft') && (
                            <Button size="icon" variant="ghost" onClick={() => onViewRun({ ...run, _storno: true })} data-testid={`button-storno-${run.id}`}>
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NewBillingWizard({
  properties,
  propertiesLoading,
  onComplete,
}: {
  properties: any[];
  propertiesLoading: boolean;
  onComplete: (runId: number) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [step, setStep] = useState(1);

  const [propertyId, setPropertyId] = useState('');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [heatingSupplyCost, setHeatingSupplyCost] = useState('');
  const [hotWaterSupplyCost, setHotWaterSupplyCost] = useState('');
  const [maintenanceCost, setMaintenanceCost] = useState('');
  const [meterReadingCost, setMeterReadingCost] = useState('');
  const [heatingConsumptionPct, setHeatingConsumptionPct] = useState(65);
  const [hotWaterConsumptionPct, setHotWaterConsumptionPct] = useState(65);
  const [restCentRule, setRestCentRule] = useState('assign_to_largest_share');

  const [unitMeterData, setUnitMeterData] = useState<Record<string, UnitMeterData>>({});
  const [computeResult, setComputeResult] = useState<any>(null);
  const [createdRunId, setCreatedRunId] = useState<number | null>(null);

  const { data: propertyUnits = [], isLoading: unitsLoading } = useQuery({
    queryKey: ['/api/units', propertyId],
    queryFn: async () => {
      if (!propertyId) return [];
      const res = await fetch(`/api/units?propertyId=${propertyId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden der Einheiten');
      return res.json();
    },
    enabled: !!propertyId && step >= 2,
  });

  const createAndComputeMutation = useMutation({
    mutationFn: async () => {
      const runRes = await apiRequest('POST', '/api/heizkosten/runs', {
        propertyId,
        periodFrom,
        periodTo,
        heatingSupplyCost,
        hotWaterSupplyCost,
        maintenanceCost,
        meterReadingCost,
        heatingConsumptionSharePct: String(heatingConsumptionPct),
        heatingAreaSharePct: String(100 - heatingConsumptionPct),
        hotWaterConsumptionSharePct: String(hotWaterConsumptionPct),
        hotWaterAreaSharePct: String(100 - hotWaterConsumptionPct),
        roundingMethod: 'kaufmaennisch',
        restCentRule,
      });
      const run = await runRes.json();

      const unitData = (propertyUnits as any[]).map((u: any) => {
        const md = unitMeterData[u.id];
        const heatingType = md?.heatingMeterType || 'none';
        const heatingValue = Number(md?.heatingMeterValue || 0);
        const hotWaterValue = Number(md?.hotWaterMeterValue || 0);

        return {
          unitId: u.id,
          heatingMeter: heatingType !== 'none' && heatingValue > 0
            ? { type: heatingType === 'hkv' ? 'hkv' : 'waermemengenzaehler', value: heatingValue }
            : null,
          hotWaterMeter: hotWaterValue > 0 ? { value: hotWaterValue } : null,
          prepayment: Number(md?.prepayment || 0),
          occupancy: Number(md?.occupancy || 1),
        };
      });

      const computeRes = await apiRequest('POST', '/api/heizkosten/compute', {
        runId: run.id,
        unitData,
      });
      const result = await computeRes.json();
      return { run, result };
    },
    onSuccess: ({ run, result }) => {
      setCreatedRunId(run.id);
      setComputeResult(result);
      setStep(3);
      qc.invalidateQueries({ queryKey: ['/api/heizkosten/runs'] });
      toast({ title: 'Berechnung abgeschlossen', description: 'Die Heizkosten wurden erfolgreich verteilt.' });
    },
    onError: (error: any) => {
      toast({ title: 'Fehler bei der Berechnung', description: error.message, variant: 'destructive' });
    },
  });

  const handleUnitDataChange = (unitId: string, field: keyof UnitMeterData, value: string) => {
    setUnitMeterData(prev => ({
      ...prev,
      [unitId]: { ...prev[unitId], [field]: value },
    }));
  };

  const validateStep1 = () => {
    if (!propertyId) { toast({ title: 'Fehler', description: 'Bitte Liegenschaft auswählen.', variant: 'destructive' }); return false; }
    if (!periodFrom || !periodTo) { toast({ title: 'Fehler', description: 'Bitte Abrechnungszeitraum angeben.', variant: 'destructive' }); return false; }
    if (!heatingSupplyCost || Number(heatingSupplyCost) <= 0) { toast({ title: 'Fehler', description: 'Bitte Heizkosten eingeben.', variant: 'destructive' }); return false; }
    return true;
  };

  const totalInputCosts = Number(heatingSupplyCost || 0) + Number(hotWaterSupplyCost || 0) + Number(maintenanceCost || 0) + Number(meterReadingCost || 0);

  return (
    <div className="space-y-4">
      <StepIndicator currentStep={step} totalSteps={4} />

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flame className="h-5 w-5" />
              Schritt 1: Grunddaten
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Liegenschaft</Label>
              {propertiesLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Select value={propertyId} onValueChange={setPropertyId} data-testid="select-property-wizard">
                  <SelectTrigger data-testid="select-property-wizard-trigger">
                    <SelectValue placeholder="Liegenschaft auswählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {properties.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name || p.address}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Zeitraum von</Label>
                <Input type="date" value={periodFrom} onChange={e => setPeriodFrom(e.target.value)} data-testid="input-period-from" />
              </div>
              <div className="space-y-2">
                <Label>Zeitraum bis</Label>
                <Input type="date" value={periodTo} onChange={e => setPeriodTo(e.target.value)} data-testid="input-period-to" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Heizung (Wärmelieferung) €</Label>
                <Input type="number" step="0.01" min="0" value={heatingSupplyCost} onChange={e => setHeatingSupplyCost(e.target.value)} placeholder="z.B. 10000.00" data-testid="input-heating-cost" />
              </div>
              <div className="space-y-2">
                <Label>Warmwasser €</Label>
                <Input type="number" step="0.01" min="0" value={hotWaterSupplyCost} onChange={e => setHotWaterSupplyCost(e.target.value)} placeholder="z.B. 2000.00" data-testid="input-hotwater-cost" />
              </div>
              <div className="space-y-2">
                <Label>Wartung €</Label>
                <Input type="number" step="0.01" min="0" value={maintenanceCost} onChange={e => setMaintenanceCost(e.target.value)} placeholder="z.B. 500.00" data-testid="input-maintenance-cost" />
              </div>
              <div className="space-y-2">
                <Label>Messkosten €</Label>
                <Input type="number" step="0.01" min="0" value={meterReadingCost} onChange={e => setMeterReadingCost(e.target.value)} placeholder="z.B. 300.00" data-testid="input-meter-cost" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <Label>Heizung Verbrauchsanteil: {heatingConsumptionPct}% / Flächenanteil: {100 - heatingConsumptionPct}%</Label>
                <Slider
                  min={55}
                  max={65}
                  step={1}
                  value={[heatingConsumptionPct]}
                  onValueChange={([v]) => setHeatingConsumptionPct(v)}
                  data-testid="slider-heating-pct"
                />
              </div>
              <div className="space-y-3">
                <Label>Warmwasser Verbrauchsanteil: {hotWaterConsumptionPct}% / Flächenanteil: {100 - hotWaterConsumptionPct}%</Label>
                <Slider
                  min={55}
                  max={65}
                  step={1}
                  value={[hotWaterConsumptionPct]}
                  onValueChange={([v]) => setHotWaterConsumptionPct(v)}
                  data-testid="slider-hotwater-pct"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Rundungsmethode</Label>
                <Input value="Kaufmännisch" disabled data-testid="input-rounding" />
              </div>
              <div className="space-y-2">
                <Label>Restcent-Regel</Label>
                <Select value={restCentRule} onValueChange={setRestCentRule} data-testid="select-restcent">
                  <SelectTrigger data-testid="select-restcent-trigger">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="assign_to_largest_share">Größter Anteil</SelectItem>
                    <SelectItem value="assign_to_smallest_share">Kleinster Anteil</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={() => { if (validateStep1()) setStep(2); }} data-testid="button-step1-next">
                Weiter <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flame className="h-5 w-5" />
              Schritt 2: Messdaten
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-md border bg-blue-50 dark:bg-blue-900/10 text-sm">
              <Info className="h-4 w-4 mt-0.5 text-blue-600 flex-shrink-0" />
              <span>Einheiten ohne Messdaten werden nach Fläche verteilt (§12 HeizKG)</span>
            </div>

            {unitsLoading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin" data-testid="loader-units" />
              </div>
            ) : (propertyUnits as any[]).length === 0 ? (
              <p className="text-muted-foreground p-4" data-testid="text-no-units">Keine Einheiten für diese Liegenschaft gefunden.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table data-testid="table-meter-input">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Top-Nr</TableHead>
                      <TableHead className="text-right">Fläche m²</TableHead>
                      <TableHead>Heizung Messgerät</TableHead>
                      <TableHead>Heizung Messwert</TableHead>
                      <TableHead>Warmwasser Messwert</TableHead>
                      <TableHead>Vorauszahlung €</TableHead>
                      <TableHead>Bewohner</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(propertyUnits as any[]).map((unit: any) => (
                      <TableRow key={unit.id} data-testid={`row-unit-${unit.id}`}>
                        <TableCell>{unit.name || unit.bezeichnung || unit.id?.substring(0, 8)}</TableCell>
                        <TableCell className="text-right">{Number(unit.flaeche || 0).toFixed(2)}</TableCell>
                        <TableCell>
                          <Select
                            value={unitMeterData[unit.id]?.heatingMeterType || 'hkv'}
                            onValueChange={v => handleUnitDataChange(unit.id, 'heatingMeterType', v)}
                            data-testid={`select-meter-type-${unit.id}`}
                          >
                            <SelectTrigger data-testid={`select-meter-type-trigger-${unit.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="hkv">HKV</SelectItem>
                              <SelectItem value="waermemengenzaehler">Wärmemengenzähler</SelectItem>
                              <SelectItem value="none">Kein Messgerät</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={unitMeterData[unit.id]?.heatingMeterValue || ''}
                            onChange={e => handleUnitDataChange(unit.id, 'heatingMeterValue', e.target.value)}
                            placeholder="0.00"
                            data-testid={`input-heating-value-${unit.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={unitMeterData[unit.id]?.hotWaterMeterValue || ''}
                            onChange={e => handleUnitDataChange(unit.id, 'hotWaterMeterValue', e.target.value)}
                            placeholder="0.00"
                            data-testid={`input-hotwater-value-${unit.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={unitMeterData[unit.id]?.prepayment || ''}
                            onChange={e => handleUnitDataChange(unit.id, 'prepayment', e.target.value)}
                            placeholder="0.00"
                            data-testid={`input-prepayment-${unit.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="1"
                            min="1"
                            value={unitMeterData[unit.id]?.occupancy || '1'}
                            onChange={e => handleUnitDataChange(unit.id, 'occupancy', e.target.value)}
                            data-testid={`input-occupancy-${unit.id}`}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)} data-testid="button-step2-back">
                <ChevronLeft className="h-4 w-4 mr-1" /> Zurück
              </Button>
              <Button
                onClick={() => createAndComputeMutation.mutate()}
                disabled={createAndComputeMutation.isPending}
                data-testid="button-compute"
              >
                {createAndComputeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Berechnen
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && computeResult && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Flame className="h-5 w-5" />
                Schritt 3: Ergebnis
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ResultsSummaryCards result={computeResult} totalInputCosts={totalInputCosts} />
              <ResultsTable lines={computeResult.lines} />

              {computeResult.warnings && computeResult.warnings.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-600" />
                    Warnungen
                  </h4>
                  {computeResult.warnings.map((w: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded-md border bg-yellow-50 dark:bg-yellow-900/10 text-sm" data-testid={`text-warning-${i}`}>
                      <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-600 flex-shrink-0" />
                      {w}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(2)} data-testid="button-step3-back">
                  <ChevronLeft className="h-4 w-4 mr-1" /> Zurück
                </Button>
                <Button onClick={() => setStep(4)} data-testid="button-step3-next">
                  Weiter <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {step === 4 && computeResult && createdRunId && (
        <ExportStep runId={createdRunId} computeResult={computeResult} onComplete={onComplete} />
      )}
    </div>
  );
}

function ExportStep({ runId, computeResult, onComplete }: { runId: number; computeResult: any; onComplete: (id: number) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [stornoReason, setStornoReason] = useState('');
  const [showStorno, setShowStorno] = useState(false);

  const stornoMutation = useMutation({
    mutationFn: async () => {
      await apiRequest('POST', `/api/heizkosten/storno/${runId}`, { stornoReason });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/heizkosten/runs'] });
      toast({ title: 'Abrechnung storniert' });
      onComplete(runId);
    },
    onError: (error: any) => {
      toast({ title: 'Storno fehlgeschlagen', description: error.message, variant: 'destructive' });
    },
  });

  const handlePdf = async () => {
    try {
      const res = await apiRequest('POST', '/api/heizkosten/generatePdf', { runId });
      const data = await res.json();
      if (data.html) {
        const w = window.open('', '_blank');
        if (w) {
          w.document.write(data.html);
          w.document.close();
        }
      }
      toast({ title: 'PDF generiert' });
    } catch (error: any) {
      toast({ title: 'PDF-Generierung fehlgeschlagen', description: error.message, variant: 'destructive' });
    }
  };

  const handleJsonExport = async () => {
    try {
      const res = await fetch(`/api/heizkosten/export/${runId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Export fehlgeschlagen');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `heizkosten_${runId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      toast({ title: 'JSON Export erfolgreich' });
    } catch (error: any) {
      toast({ title: 'Export fehlgeschlagen', description: error.message, variant: 'destructive' });
    }
  };

  const handleCsvExport = async () => {
    try {
      const res = await fetch(`/api/heizkosten/export/${runId}?format=csv`, { credentials: 'include' });
      if (!res.ok) throw new Error('Export fehlgeschlagen');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `heizkosten_${runId}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      toast({ title: 'CSV Export erfolgreich' });
    } catch (error: any) {
      toast({ title: 'Export fehlgeschlagen', description: error.message, variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Flame className="h-5 w-5" />
          Schritt 4: Prüfprotokoll & Export
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {computeResult.complianceCheck && (
          <div className="space-y-2">
            <h4 className="font-medium">Prüfprotokoll</h4>
            <ComplianceCheckTable checks={
              Array.isArray(computeResult.complianceCheck)
                ? computeResult.complianceCheck
                : Object.entries(computeResult.complianceCheck).map(([key, val]: [string, any]) => ({
                    paragraph: key,
                    requirement: val.description || val.requirement || key,
                    status: val.status || (val.passed ? 'ok' : 'fehler'),
                    details: val.details || val.message || '',
                  }))
            } />
          </div>
        )}

        {computeResult.lines?.some((l: any) => l.plausibilityFlags && l.plausibilityFlags.length > 0) && (
          <div className="space-y-2">
            <h4 className="font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              Plausibilitätsprüfung
            </h4>
            {computeResult.lines
              .filter((l: any) => l.plausibilityFlags && l.plausibilityFlags.length > 0)
              .map((l: any, i: number) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded-md border bg-yellow-50 dark:bg-yellow-900/10 text-sm" data-testid={`text-plausibility-${i}`}>
                  <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-600 flex-shrink-0" />
                  <span>Einheit {(l.unitId || '').substring(0, 8)}: {l.plausibilityFlags.join(', ')}</span>
                </div>
              ))}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <Button onClick={handlePdf} data-testid="button-generate-pdf">
            <FileText className="h-4 w-4 mr-2" />
            PDF generieren
          </Button>
          <Button variant="outline" onClick={handleJsonExport} data-testid="button-json-export">
            <Download className="h-4 w-4 mr-2" />
            JSON Export
          </Button>
          <Button variant="outline" onClick={handleCsvExport} data-testid="button-csv-export">
            <Download className="h-4 w-4 mr-2" />
            CSV Export
          </Button>
          <Button variant="outline" onClick={() => setShowStorno(!showStorno)} data-testid="button-toggle-storno">
            <RotateCcw className="h-4 w-4 mr-2" />
            Stornieren
          </Button>
        </div>

        {showStorno && (
          <div className="space-y-3 p-4 border rounded-md">
            <Label>Storno-Begründung</Label>
            <Input
              value={stornoReason}
              onChange={e => setStornoReason(e.target.value)}
              placeholder="Begründung eingeben..."
              data-testid="input-storno-reason"
            />
            <Button
              variant="destructive"
              onClick={() => stornoMutation.mutate()}
              disabled={!stornoReason || stornoMutation.isPending}
              data-testid="button-confirm-storno"
            >
              {stornoMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Storno bestätigen
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DetailView({ run, onBack }: { run: any; onBack: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: runDetail, isLoading } = useQuery({
    queryKey: ['/api/heizkosten/runs', run.id],
    queryFn: async () => {
      const res = await fetch(`/api/heizkosten/runs/${run.id}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json();
    },
  });

  const { data: complianceData } = useQuery({
    queryKey: ['/api/heizkosten/compliance-check', run.id],
    queryFn: async () => {
      const res = await fetch(`/api/heizkosten/compliance-check/${run.id}`, { credentials: 'include' });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!run.id && run.status === 'berechnet',
  });

  const [stornoReason, setStornoReason] = useState('');
  const [showStorno, setShowStorno] = useState(false);

  const stornoMutation = useMutation({
    mutationFn: async () => {
      await apiRequest('POST', `/api/heizkosten/storno/${run.id}`, { stornoReason });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/heizkosten/runs'] });
      toast({ title: 'Abrechnung storniert' });
      onBack();
    },
    onError: (error: any) => {
      toast({ title: 'Storno fehlgeschlagen', description: error.message, variant: 'destructive' });
    },
  });

  const handlePdf = async () => {
    try {
      const res = await apiRequest('POST', '/api/heizkosten/generatePdf', { runId: run.id });
      const data = await res.json();
      if (data.html) {
        const w = window.open('', '_blank');
        if (w) {
          w.document.write(data.html);
          w.document.close();
        }
      }
    } catch (error: any) {
      toast({ title: 'PDF-Generierung fehlgeschlagen', description: error.message, variant: 'destructive' });
    }
  };

  const handleExport = async (format?: string) => {
    try {
      const url = format ? `/api/heizkosten/export/${run.id}?format=${format}` : `/api/heizkosten/export/${run.id}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Export fehlgeschlagen');
      if (format === 'csv') {
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `heizkosten_${run.id}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      } else {
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `heizkosten_${run.id}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      }
      toast({ title: 'Export erfolgreich' });
    } catch (error: any) {
      toast({ title: 'Export fehlgeschlagen', description: error.message, variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" data-testid="loader-detail" />
      </div>
    );
  }

  if (!runDetail) return null;

  const totalCosts = Number(runDetail.heatingSupplyCost || 0) + Number(runDetail.hotWaterSupplyCost || 0) + Number(runDetail.maintenanceCost || 0) + Number(runDetail.meterReadingCost || 0);
  const sc = statusConfig[runDetail.status] || statusConfig.entwurf;

  const resultForCards = {
    summary: {
      totalDistributed: runDetail.totalDistributed,
      trialBalanceDiff: runDetail.trialBalanceDiff,
    },
    lines: runDetail.lines || [],
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-lg font-semibold flex items-center gap-2" data-testid="text-detail-title">
          <Flame className="h-5 w-5" />
          Abrechnung #{run.id} — {run.propertyName || runDetail.propertyName}
        </h3>
        <Button variant="outline" onClick={onBack} data-testid="button-detail-back">
          <ChevronLeft className="h-4 w-4 mr-1" /> Zurück
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div>
          <Label className="text-muted-foreground text-xs">Zeitraum</Label>
          <p className="text-sm" data-testid="text-detail-period">{runDetail.periodFrom} — {runDetail.periodTo}</p>
        </div>
        <div>
          <Label className="text-muted-foreground text-xs">Gesamtkosten</Label>
          <p className="text-sm" data-testid="text-detail-total">{formatEur(totalCosts)}</p>
        </div>
        <div>
          <Label className="text-muted-foreground text-xs">Heizung / Fläche</Label>
          <p className="text-sm" data-testid="text-detail-split">{runDetail.heatingConsumptionSharePct}% / {runDetail.heatingAreaSharePct}%</p>
        </div>
        <div>
          <Label className="text-muted-foreground text-xs">Version</Label>
          <p className="text-sm" data-testid="text-detail-version">{runDetail.version || 1}</p>
        </div>
        <div>
          <Label className="text-muted-foreground text-xs">Status</Label>
          <Badge variant={sc.variant} className={sc.className || ''} data-testid="badge-detail-status">{sc.label}</Badge>
        </div>
      </div>

      {(runDetail.lines || []).length > 0 && (
        <>
          <ResultsSummaryCards result={resultForCards} totalInputCosts={totalCosts} />
          <ResultsTable lines={runDetail.lines} />
        </>
      )}

      {runDetail.warnings && (runDetail.warnings as string[]).length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            Warnungen
          </h4>
          {(runDetail.warnings as string[]).map((w: string, i: number) => (
            <div key={i} className="flex items-start gap-2 p-2 rounded-md border bg-yellow-50 dark:bg-yellow-900/10 text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-600 flex-shrink-0" />
              {w}
            </div>
          ))}
        </div>
      )}

      {complianceData && (
        <div className="space-y-2">
          <h4 className="font-medium">Prüfprotokoll</h4>
          <ComplianceCheckTable checks={
            Array.isArray(complianceData)
              ? complianceData
              : Object.entries(complianceData).map(([key, val]: [string, any]) => ({
                  paragraph: key,
                  requirement: val.description || val.requirement || key,
                  status: val.status || (val.passed ? 'ok' : 'fehler'),
                  details: val.details || val.message || '',
                }))
          } />
        </div>
      )}

      {runDetail.complianceCheckResult && !complianceData && (
        <div className="space-y-2">
          <h4 className="font-medium">Prüfprotokoll</h4>
          <ComplianceCheckTable checks={
            Array.isArray(runDetail.complianceCheckResult)
              ? runDetail.complianceCheckResult
              : Object.entries(runDetail.complianceCheckResult).map(([key, val]: [string, any]) => ({
                  paragraph: key,
                  requirement: val.description || val.requirement || key,
                  status: val.status || (val.passed ? 'ok' : 'fehler'),
                  details: val.details || val.message || '',
                }))
          } />
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {runDetail.status === 'berechnet' && (
          <Button onClick={handlePdf} data-testid="button-detail-pdf">
            <FileText className="h-4 w-4 mr-2" /> PDF generieren
          </Button>
        )}
        <Button variant="outline" onClick={() => handleExport()} data-testid="button-detail-json">
          <Download className="h-4 w-4 mr-2" /> JSON Export
        </Button>
        <Button variant="outline" onClick={() => handleExport('csv')} data-testid="button-detail-csv">
          <Download className="h-4 w-4 mr-2" /> CSV Export
        </Button>
        {(runDetail.status === 'berechnet' || runDetail.status === 'geprueft') && (
          <Button variant="outline" onClick={() => setShowStorno(!showStorno)} data-testid="button-detail-storno">
            <RotateCcw className="h-4 w-4 mr-2" /> Stornieren
          </Button>
        )}
      </div>

      {showStorno && (
        <div className="space-y-3 p-4 border rounded-md">
          <Label>Storno-Begründung</Label>
          <Input
            value={stornoReason}
            onChange={e => setStornoReason(e.target.value)}
            placeholder="Begründung eingeben..."
            data-testid="input-detail-storno-reason"
          />
          <Button
            variant="destructive"
            onClick={() => stornoMutation.mutate()}
            disabled={!stornoReason || stornoMutation.isPending}
            data-testid="button-detail-confirm-storno"
          >
            {stornoMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Storno bestätigen
          </Button>
        </div>
      )}
    </div>
  );
}

function ComplianceTab() {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['/api/heizkosten/runs'],
    queryFn: async () => {
      const res = await fetch('/api/heizkosten/runs', { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json();
    },
  });

  const completedRuns = (runs as any[]).filter((r: any) => r.status === 'berechnet' || r.status === 'geprueft');
  const totalRuns = completedRuns.length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            HeizKG Compliance-Übersicht
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 mb-4">
            <div className="text-sm text-muted-foreground">
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span data-testid="text-compliance-summary">{totalRuns} abgeschlossene Abrechnungsläufe</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">HeizKG Anforderungen (§§5–15)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table data-testid="table-heizkG-requirements">
            <TableHeader>
              <TableRow>
                <TableHead>Paragraph</TableHead>
                <TableHead>Anforderung</TableHead>
                <TableHead>Beschreibung</TableHead>
                <TableHead>Systemprüfung</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {complianceRequirements.map((req, i) => (
                <TableRow key={i} data-testid={`row-requirement-${i}`}>
                  <TableCell className="font-medium">{req.paragraph}</TableCell>
                  <TableCell className="font-medium">{req.title}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{req.description}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{req.check}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Heizkosten() {
  const [activeTab, setActiveTab] = useState('runs');
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [viewingRun, setViewingRun] = useState<any>(null);

  const { data: properties = [], isLoading: propertiesLoading } = useProperties();

  const handleViewRun = (run: any) => {
    setViewingRun(run);
    setActiveTab('detail');
  };

  const handleNewRun = () => {
    setActiveTab('neu');
  };

  const handleWizardComplete = () => {
    setActiveTab('runs');
  };

  const filterPropertyId = selectedPropertyId === 'all' ? '' : selectedPropertyId;

  return (
    <MainLayout title="Heizkostenabrechnung" subtitle="HeizKG-konforme Abrechnung nach Verbrauch und Fläche">
      <div className="space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList data-testid="tabs-list">
            <TabsTrigger value="runs" data-testid="tab-runs">Abrechnungsläufe</TabsTrigger>
            <TabsTrigger value="neu" data-testid="tab-neu">Neue Abrechnung</TabsTrigger>
            <TabsTrigger value="detail" data-testid="tab-detail" disabled={!viewingRun}>Detail-Ansicht</TabsTrigger>
            <TabsTrigger value="compliance" data-testid="tab-compliance">Compliance</TabsTrigger>
          </TabsList>

          <TabsContent value="runs">
            <BillingRunsTab
              selectedPropertyId={filterPropertyId}
              setSelectedPropertyId={setSelectedPropertyId}
              properties={properties as any[]}
              propertiesLoading={propertiesLoading}
              onViewRun={handleViewRun}
              onNewRun={handleNewRun}
            />
          </TabsContent>

          <TabsContent value="neu">
            <NewBillingWizard
              properties={properties as any[]}
              propertiesLoading={propertiesLoading}
              onComplete={handleWizardComplete}
            />
          </TabsContent>

          <TabsContent value="detail">
            {viewingRun ? (
              <DetailView run={viewingRun} onBack={() => { setViewingRun(null); setActiveTab('runs'); }} />
            ) : (
              <div className="p-8 text-center text-muted-foreground" data-testid="text-no-detail">
                Bitte wählen Sie einen Abrechnungslauf aus der Liste.
              </div>
            )}
          </TabsContent>

          <TabsContent value="compliance">
            <ComplianceTab />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
