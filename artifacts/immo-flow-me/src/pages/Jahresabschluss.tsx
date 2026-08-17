import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CheckCircle2, Circle, ArrowRight, ArrowLeft, Calendar, Calculator, FileCheck, BarChart3, Lock, FileText, Download, AlertTriangle, Plus, Building2 } from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useProperties } from '@/hooks/useProperties';

function formatEur(value: number): string {
  return value.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' });
}

const STEPS = [
  { label: 'Periode waehlen', icon: Calendar },
  { label: 'AfA buchen', icon: Calculator },
  { label: 'Abgrenzungen', icon: FileCheck },
  { label: 'Bilanz/GuV Review', icon: BarChart3 },
  { label: 'Periode sperren', icon: Lock },
  { label: 'Abschlussbericht', icon: FileText },
];

function StepIndicator({ currentStep, completedSteps }: { currentStep: number; completedSteps: Set<number> }) {
  return (
    <div className="flex items-center justify-between w-full mb-8" data-testid="step-indicator">
      {STEPS.map((step, idx) => {
        const isCompleted = completedSteps.has(idx);
        const isCurrent = idx === currentStep;
        const Icon = step.icon;
        return (
          <div key={idx} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`flex items-center justify-center w-9 h-9 rounded-full border-2 transition-colors ${
                  isCurrent
                    ? 'border-primary bg-primary text-primary-foreground'
                    : isCompleted
                    ? 'border-green-500 bg-green-500 text-white'
                    : 'border-muted-foreground/30 bg-background text-muted-foreground'
                }`}
                data-testid={`step-circle-${idx}`}
              >
                {isCompleted ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-4 w-4" />}
              </div>
              <span
                className={`text-xs text-center max-w-[80px] leading-tight ${
                  isCurrent ? 'font-semibold text-foreground' : 'text-muted-foreground'
                }`}
                data-testid={`step-label-${idx}`}
              >
                {step.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-2 mt-[-16px] ${
                  completedSteps.has(idx) ? 'bg-green-500' : 'bg-muted-foreground/20'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Step1PeriodeWaehlen({
  selectedPeriodId,
  setSelectedPeriodId,
  setSelectedYear,
  setSelectedPeriod,
  selectedPropertyId,
  setSelectedPropertyId,
}: {
  selectedPeriodId: string | null;
  setSelectedPeriodId: (id: string) => void;
  setSelectedYear: (year: number) => void;
  setSelectedPeriod: (p: any) => void;
  selectedPropertyId: string;
  setSelectedPropertyId: (id: string) => void;
}) {
  const { toast } = useToast();
  const [newYear, setNewYear] = useState(new Date().getFullYear().toString());
  const { data: properties } = useProperties();

  const periodsQueryParams = new URLSearchParams();
  if (selectedPropertyId) periodsQueryParams.set('propertyId', selectedPropertyId);
  const periodsQs = periodsQueryParams.toString();

  const { data: periods, isLoading } = useQuery({
    queryKey: ['/api/fiscal-year/periods', selectedPropertyId],
    queryFn: async () => {
      const res = await fetch(`/api/fiscal-year/periods${periodsQs ? `?${periodsQs}` : ''}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Perioden konnten nicht geladen werden');
      return res.json();
    },
  });

  const createPeriodMutation = useMutation({
    mutationFn: async (year: number) => {
      const body: any = { year };
      if (selectedPropertyId) body.propertyId = selectedPropertyId;
      const res = await apiRequest('POST', '/api/fiscal-year/periods', body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fiscal-year/periods'] });
      toast({ title: 'Periode erstellt', description: `Geschaeftsjahr ${newYear} wurde angelegt.` });
    },
    onError: (error: Error) => {
      toast({ title: 'Fehler', description: error.message, variant: 'destructive' });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="loading-periods">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const periodList = (periods as any[]) || [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Geschaeftsperiode waehlen</h2>
        <p className="text-sm text-muted-foreground">Waehlen Sie die Periode fuer den Jahresabschluss oder erstellen Sie eine neue.</p>
      </div>

      <div className="space-y-1">
        <label className="text-sm text-muted-foreground flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5" />
          Liegenschaft
        </label>
        <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId} data-testid="select-property">
          <SelectTrigger className="w-full max-w-xs" data-testid="select-property-trigger">
            <SelectValue placeholder="Liegenschaft waehlen..." />
          </SelectTrigger>
          <SelectContent>
            {(properties || []).map((prop: any) => (
              <SelectItem key={prop.id} value={prop.id} data-testid={`select-property-option-${prop.id}`}>
                {prop.name || prop.address || prop.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {periodList.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Noch keine Perioden vorhanden</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {periodList.map((period: any) => {
            const id = period.id || period.periodId;
            const year = period.year || period.fiscalYear;
            const isSelected = selectedPeriodId === String(id);
            return (
              <Card
                key={id}
                className={`cursor-pointer transition-colors ${isSelected ? 'ring-2 ring-primary' : 'hover-elevate'}`}
                onClick={() => {
                  setSelectedPeriodId(String(id));
                  setSelectedYear(Number(year));
                  setSelectedPeriod(period);
                }}
                data-testid={`card-period-${id}`}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Geschaeftsjahr {year}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap items-center gap-2">
                    {period.closed ? (
                      <Badge variant="secondary">
                        <Lock className="h-3 w-3 mr-1" />
                        Gesperrt
                      </Badge>
                    ) : (
                      <Badge variant="outline">Offen</Badge>
                    )}
                    {period.depreciationBooked && (
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">AfA gebucht</Badge>
                    )}
                    {period.accrualsReviewed && (
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Abgrenzungen</Badge>
                    )}
                    {period.balanceReviewed && (
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Bilanz</Badge>
                    )}
                    {isSelected && <Badge variant="default">Ausgewaehlt</Badge>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Neue Periode erstellen
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">Jahr</label>
              <Input
                type="number"
                value={newYear}
                onChange={(e) => setNewYear(e.target.value)}
                className="w-[120px]"
                data-testid="input-new-period-year"
              />
            </div>
            <Button
              onClick={() => createPeriodMutation.mutate(Number(newYear))}
              disabled={createPeriodMutation.isPending || !newYear}
              data-testid="button-create-period"
            >
              {createPeriodMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Periode erstellen
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Step2AfABuchen({
  selectedYear,
  selectedPeriodId,
  selectedPeriod,
  selectedPropertyId,
}: {
  selectedYear: number;
  selectedPeriodId: string;
  selectedPeriod: any;
  selectedPropertyId: string;
}) {
  const { toast } = useToast();
  const [newAsset, setNewAsset] = useState({ name: '', acquisitionDate: '', acquisitionCost: '', usefulLifeYears: '' });

  const assetQueryParams = new URLSearchParams();
  assetQueryParams.set('year', String(selectedYear));
  if (selectedPropertyId) assetQueryParams.set('propertyId', selectedPropertyId);

  const { data: assets, isLoading } = useQuery({
    queryKey: ['/api/fiscal-year/depreciation-assets', selectedYear, selectedPropertyId],
    queryFn: async () => {
      const res = await fetch(`/api/fiscal-year/depreciation-assets?${assetQueryParams.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Anlagevermoegen konnte nicht geladen werden');
      return res.json();
    },
  });

  const bookDepreciationMutation = useMutation({
    mutationFn: async () => {
      const body: any = { periodId: selectedPeriodId };
      if (selectedPropertyId) body.propertyId = selectedPropertyId;
      const res = await apiRequest('POST', '/api/fiscal-year/book-depreciation', body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fiscal-year/periods'] });
      queryClient.invalidateQueries({ queryKey: ['/api/fiscal-year/depreciation-assets', selectedYear] });
      toast({ title: 'AfA gebucht', description: 'Die Abschreibungen wurden erfolgreich gebucht.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Fehler', description: error.message, variant: 'destructive' });
    },
  });

  const addAssetMutation = useMutation({
    mutationFn: async (data: typeof newAsset) => {
      const res = await apiRequest('POST', '/api/fiscal-year/depreciation-assets', {
        name: data.name,
        acquisitionDate: data.acquisitionDate,
        acquisitionCost: Number(data.acquisitionCost),
        usefulLifeYears: Number(data.usefulLifeYears),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fiscal-year/depreciation-assets', selectedYear] });
      setNewAsset({ name: '', acquisitionDate: '', acquisitionCost: '', usefulLifeYears: '' });
      toast({ title: 'Anlage hinzugefuegt', description: 'Das Anlagegut wurde erfolgreich erstellt.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Fehler', description: error.message, variant: 'destructive' });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="loading-assets">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const assetList = (assets as any[]) || [];
  const alreadyBooked = selectedPeriod?.depreciationBooked;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Abschreibungen (AfA) buchen</h2>
        <p className="text-sm text-muted-foreground">Anlagevermoegen pruefen und AfA fuer das Geschaeftsjahr {selectedYear} buchen.</p>
      </div>

      {alreadyBooked && (
        <Card className="border-green-200 dark:border-green-800">
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
            <div>
              <p className="font-medium text-green-700 dark:text-green-400">Bereits gebucht</p>
              <p className="text-sm text-muted-foreground">Die AfA fuer dieses Geschaeftsjahr wurde bereits gebucht.</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Anlagevermoegen ({assetList.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {assetList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Calculator className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Keine Anlagegueter vorhanden</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-3 font-medium">Name</th>
                    <th className="text-right p-3 font-medium">Anschaffungskosten</th>
                    <th className="text-right p-3 font-medium">Nutzungsdauer</th>
                    <th className="text-right p-3 font-medium">AfA-Satz</th>
                    <th className="text-right p-3 font-medium">Buchwert</th>
                  </tr>
                </thead>
                <tbody>
                  {assetList.map((asset: any, idx: number) => {
                    const id = asset.id || idx;
                    const cost = Number(asset.acquisitionCost || asset.acquisition_cost || 0);
                    const life = Number(asset.usefulLifeYears || asset.useful_life_years || 1);
                    const rate = life > 0 ? (100 / life).toFixed(1) : '0';
                    const bookValue = Number(asset.bookValue || asset.book_value || cost);
                    return (
                      <tr key={id} className="border-b" data-testid={`row-asset-${id}`}>
                        <td className="p-3" data-testid={`text-asset-name-${id}`}>{asset.name}</td>
                        <td className="p-3 text-right" data-testid={`text-asset-cost-${id}`}>{formatEur(cost)}</td>
                        <td className="p-3 text-right" data-testid={`text-asset-life-${id}`}>{life} Jahre</td>
                        <td className="p-3 text-right" data-testid={`text-asset-rate-${id}`}>{rate}%</td>
                        <td className="p-3 text-right font-medium" data-testid={`text-asset-bookvalue-${id}`}>{formatEur(bookValue)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
        {!alreadyBooked && (
          <CardFooter className="flex justify-end gap-2 p-4">
            <Button
              onClick={() => bookDepreciationMutation.mutate()}
              disabled={bookDepreciationMutation.isPending || assetList.length === 0}
              data-testid="button-book-depreciation"
            >
              {bookDepreciationMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              <Calculator className="h-4 w-4 mr-2" />
              AfA buchen
            </Button>
          </CardFooter>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Neues Anlagegut erfassen
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">Bezeichnung</label>
              <Input
                value={newAsset.name}
                onChange={(e) => setNewAsset({ ...newAsset, name: e.target.value })}
                placeholder="z.B. Drucker"
                data-testid="input-asset-name"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">Anschaffungsdatum</label>
              <Input
                type="date"
                value={newAsset.acquisitionDate}
                onChange={(e) => setNewAsset({ ...newAsset, acquisitionDate: e.target.value })}
                data-testid="input-asset-date"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">Anschaffungskosten</label>
              <Input
                type="number"
                value={newAsset.acquisitionCost}
                onChange={(e) => setNewAsset({ ...newAsset, acquisitionCost: e.target.value })}
                placeholder="0.00"
                data-testid="input-asset-cost"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">Nutzungsdauer (Jahre)</label>
              <Input
                type="number"
                value={newAsset.usefulLifeYears}
                onChange={(e) => setNewAsset({ ...newAsset, usefulLifeYears: e.target.value })}
                placeholder="5"
                data-testid="input-asset-life"
              />
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
          <Button
            onClick={() => addAssetMutation.mutate(newAsset)}
            disabled={addAssetMutation.isPending || !newAsset.name || !newAsset.acquisitionCost || !newAsset.usefulLifeYears}
            data-testid="button-add-asset"
          >
            {addAssetMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            <Plus className="h-4 w-4 mr-2" />
            Anlage hinzufuegen
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

function Step3Abgrenzungen({
  selectedYear,
  selectedPeriodId,
  selectedPeriod,
}: {
  selectedYear: number;
  selectedPeriodId: string;
  selectedPeriod: any;
}) {
  const { toast } = useToast();

  const { data: accruals, isLoading } = useQuery({
    queryKey: ['/api/fiscal-year/accruals', selectedYear],
    queryFn: async () => {
      const res = await fetch(`/api/fiscal-year/accruals?year=${selectedYear}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Abgrenzungen konnten nicht geladen werden');
      return res.json();
    },
  });

  const reviewAccrualsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/fiscal-year/review-accruals', { periodId: selectedPeriodId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fiscal-year/periods'] });
      toast({ title: 'Abgrenzungen bestaetigt', description: 'Die Abgrenzungen wurden als geprueft markiert.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Fehler', description: error.message, variant: 'destructive' });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="loading-accruals">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const accrualList = (accruals as any[]) || [];
  const alreadyReviewed = selectedPeriod?.accrualsReviewed;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Abgrenzungen pruefen</h2>
        <p className="text-sm text-muted-foreground">Periodenabgrenzungen fuer das Geschaeftsjahr {selectedYear} pruefen und bestaetigen.</p>
      </div>

      {alreadyReviewed && (
        <Card className="border-green-200 dark:border-green-800">
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
            <div>
              <p className="font-medium text-green-700 dark:text-green-400">Bereits geprueft</p>
              <p className="text-sm text-muted-foreground">Die Abgrenzungen fuer dieses Geschaeftsjahr wurden bereits bestaetigt.</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Abgrenzungsbuchungen ({accrualList.length})</CardTitle>
          <CardDescription>Rechnungsabgrenzungsposten und sonstige Abgrenzungen</CardDescription>
        </CardHeader>
        <CardContent>
          {accrualList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <FileCheck className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Keine Abgrenzungsbuchungen vorhanden</p>
            </div>
          ) : (
            <div className="space-y-2">
              {accrualList.map((item: any, idx: number) => {
                const id = item.id || idx;
                return (
                  <div
                    key={id}
                    className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-md border"
                    data-testid={`row-accrual-${id}`}
                  >
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium" data-testid={`text-accrual-desc-${id}`}>
                        {item.description || item.name || '-'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.account || item.accountNumber || ''} {item.date ? `- ${new Date(item.date).toLocaleDateString('de-AT')}` : ''}
                      </p>
                    </div>
                    <span className="text-sm font-medium" data-testid={`text-accrual-amount-${id}`}>
                      {formatEur(Number(item.amount || item.betrag || 0))}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
        {!alreadyReviewed && (
          <CardFooter className="flex justify-end gap-2">
            <Button
              onClick={() => reviewAccrualsMutation.mutate()}
              disabled={reviewAccrualsMutation.isPending}
              data-testid="button-review-accruals"
            >
              {reviewAccrualsMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              <FileCheck className="h-4 w-4 mr-2" />
              Abgrenzungen bestaetigt
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}

function Step4BilanzGuVReview({
  selectedYear,
  selectedPeriodId,
  selectedPeriod,
  selectedPropertyId,
}: {
  selectedYear: number;
  selectedPeriodId: string;
  selectedPeriod: any;
  selectedPropertyId: string;
}) {
  const { toast } = useToast();

  const trialBalanceParams = new URLSearchParams();
  trialBalanceParams.set('from', `${selectedYear}-01-01`);
  trialBalanceParams.set('to', `${selectedYear}-12-31`);
  if (selectedPropertyId) trialBalanceParams.set('propertyId', selectedPropertyId);

  const { data: trialBalance, isLoading } = useQuery({
    queryKey: ['/api/accounting/trial-balance', selectedYear, selectedPropertyId],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/trial-balance?${trialBalanceParams.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Saldenliste konnte nicht geladen werden');
      return res.json();
    },
  });

  const reviewBalanceMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/fiscal-year/review-balance', { periodId: selectedPeriodId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fiscal-year/periods'] });
      toast({ title: 'Bilanz/GuV geprueft', description: 'Die Bilanz- und GuV-Pruefung wurde abgeschlossen.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Fehler', description: error.message, variant: 'destructive' });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="loading-trial-balance">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const rows = (trialBalance as any[]) || [];
  const alreadyReviewed = selectedPeriod?.balanceReviewed;

  const summary = useMemo(() => {
    let totalAktiva = 0;
    let totalPassiva = 0;
    let totalErloese = 0;
    let totalAufwand = 0;

    for (const row of rows) {
      const balance = Number(row.balance || 0);
      const type = (row.account_type || row.accountType || '').toLowerCase();
      if (type === 'asset') totalAktiva += Math.abs(balance);
      else if (type === 'liability' || type === 'equity') totalPassiva += Math.abs(balance);
      else if (type === 'revenue') totalErloese += Math.abs(balance);
      else if (type === 'expense') totalAufwand += Math.abs(balance);
    }

    return {
      totalAktiva,
      totalPassiva,
      differenz: totalAktiva - totalPassiva,
      totalErloese,
      totalAufwand,
      ergebnis: totalErloese - totalAufwand,
    };
  }, [rows]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Bilanz- und GuV-Pruefung</h2>
        <p className="text-sm text-muted-foreground">Ueberblick ueber die Bilanz und Gewinn- und Verlustrechnung fuer {selectedYear}.</p>
      </div>

      {alreadyReviewed && (
        <Card className="border-green-200 dark:border-green-800">
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
            <div>
              <p className="font-medium text-green-700 dark:text-green-400">Bereits geprueft</p>
              <p className="text-sm text-muted-foreground">Die Bilanz/GuV fuer dieses Geschaeftsjahr wurde bereits geprueft.</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bilanz</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-sm">Total Aktiva</span>
              <span className="text-sm font-medium" data-testid="text-total-aktiva">{formatEur(summary.totalAktiva)}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-sm">Total Passiva</span>
              <span className="text-sm font-medium" data-testid="text-total-passiva">{formatEur(summary.totalPassiva)}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm font-semibold">Differenz</span>
              <span
                className={`text-sm font-bold ${summary.differenz === 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                data-testid="text-bilanz-differenz"
              >
                {formatEur(summary.differenz)}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gewinn- und Verlustrechnung</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-sm">Total Erloese</span>
              <span className="text-sm font-medium text-green-600 dark:text-green-400" data-testid="text-total-erloese">{formatEur(summary.totalErloese)}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-sm">Total Aufwand</span>
              <span className="text-sm font-medium text-red-600 dark:text-red-400" data-testid="text-total-aufwand">{formatEur(summary.totalAufwand)}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm font-semibold">Ergebnis</span>
              <span
                className={`text-sm font-bold ${summary.ergebnis >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                data-testid="text-guv-ergebnis"
              >
                {formatEur(summary.ergebnis)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {!alreadyReviewed && (
        <div className="flex justify-end">
          <Button
            onClick={() => reviewBalanceMutation.mutate()}
            disabled={reviewBalanceMutation.isPending}
            data-testid="button-review-balance"
          >
            {reviewBalanceMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            <BarChart3 className="h-4 w-4 mr-2" />
            Bilanz/GuV geprueft
          </Button>
        </div>
      )}
    </div>
  );
}

function Step5PeriodeSperren({
  selectedPeriodId,
  selectedPeriod,
}: {
  selectedPeriodId: string;
  selectedPeriod: any;
}) {
  const { toast } = useToast();

  const closePeriodMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/fiscal-year/close', { periodId: selectedPeriodId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fiscal-year/periods'] });
      toast({ title: 'Periode gesperrt', description: 'Die Periode wurde erfolgreich gesperrt.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Fehler', description: error.message, variant: 'destructive' });
    },
  });

  const isClosed = selectedPeriod?.closed;
  const allStepsCompleted =
    selectedPeriod?.depreciationBooked &&
    selectedPeriod?.accrualsReviewed &&
    selectedPeriod?.balanceReviewed;

  const steps = [
    { label: 'Periode ausgewaehlt', done: true },
    { label: 'AfA gebucht', done: !!selectedPeriod?.depreciationBooked },
    { label: 'Abgrenzungen geprueft', done: !!selectedPeriod?.accrualsReviewed },
    { label: 'Bilanz/GuV geprueft', done: !!selectedPeriod?.balanceReviewed },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Periode sperren</h2>
        <p className="text-sm text-muted-foreground">Uebersicht der Abschlussschritte und Periodensperre.</p>
      </div>

      {isClosed && (
        <Card className="border-green-200 dark:border-green-800">
          <CardContent className="flex items-center gap-3 p-4">
            <Lock className="h-6 w-6 text-green-600 dark:text-green-400" />
            <div>
              <p className="font-medium text-green-700 dark:text-green-400">Periode gesperrt</p>
              <p className="text-sm text-muted-foreground">Diese Periode ist bereits gesperrt. Es koennen keine Buchungen mehr vorgenommen werden.</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Abschluss-Checkliste</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {steps.map((step, idx) => (
              <div key={idx} className="flex items-center gap-3" data-testid={`checklist-item-${idx}`}>
                {step.done ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                )}
                <span className={`text-sm ${step.done ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {step.label}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {!isClosed && (
        <>
          <Card className="border-yellow-200 dark:border-yellow-800">
            <CardContent className="flex items-start gap-3 p-4">
              <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-yellow-700 dark:text-yellow-400">
                Nach dem Sperren koennen keine Buchungen mehr fuer diese Periode vorgenommen werden.
              </p>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              variant="destructive"
              onClick={() => closePeriodMutation.mutate()}
              disabled={closePeriodMutation.isPending || !allStepsCompleted}
              data-testid="button-close-period"
            >
              {closePeriodMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              <Lock className="h-4 w-4 mr-2" />
              Periode sperren
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Step6Abschlussbericht({
  selectedPeriodId,
  selectedPeriod,
}: {
  selectedPeriodId: string;
  selectedPeriod: any;
}) {
  const { toast } = useToast();

  const { data: report, isLoading } = useQuery({
    queryKey: ['/api/fiscal-year/report', selectedPeriodId],
    queryFn: async () => {
      const res = await fetch(`/api/fiscal-year/report?periodId=${selectedPeriodId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Abschlussbericht konnte nicht geladen werden');
      return res.json();
    },
  });

  const handleExport = (type: string) => {
    toast({ title: 'Export wird vorbereitet...', description: `${type} wird generiert.` });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="loading-report">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const rep = report as any;
  const year = selectedPeriod?.year || selectedPeriod?.fiscalYear || '';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Abschlussbericht {year}</h2>
        <p className="text-sm text-muted-foreground">Zusammenfassung und Exporte fuer den Jahresabschluss.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-sm text-muted-foreground">Periodenstatus:</span>
        {selectedPeriod?.closed ? (
          <Badge variant="secondary">
            <Lock className="h-3 w-3 mr-1" />
            Gesperrt
          </Badge>
        ) : (
          <Badge variant="outline">Offen</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Bilanz
            </CardTitle>
            <CardDescription>Ueberblick</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Aktiva</span>
              <span className="font-medium" data-testid="text-report-aktiva">
                {formatEur(Number(rep?.balance?.totalAktiva || rep?.balance?.assets || 0))}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Passiva</span>
              <span className="font-medium" data-testid="text-report-passiva">
                {formatEur(Number(rep?.balance?.totalPassiva || rep?.balance?.liabilities || 0))}
              </span>
            </div>
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full" onClick={() => handleExport('Bilanz PDF')} data-testid="button-export-bilanz">
              <Download className="h-4 w-4 mr-2" />
              Bilanz PDF
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              GuV
            </CardTitle>
            <CardDescription>Ueberblick</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Erloese</span>
              <span className="font-medium text-green-600 dark:text-green-400" data-testid="text-report-erloese">
                {formatEur(Number(rep?.profitLoss?.revenue || rep?.profitLoss?.totalErloese || 0))}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Aufwand</span>
              <span className="font-medium text-red-600 dark:text-red-400" data-testid="text-report-aufwand">
                {formatEur(Number(rep?.profitLoss?.expenses || rep?.profitLoss?.totalAufwand || 0))}
              </span>
            </div>
            <div className="flex justify-between text-sm font-semibold border-t pt-2">
              <span>Ergebnis</span>
              <span data-testid="text-report-ergebnis">
                {formatEur(Number(rep?.profitLoss?.result || rep?.profitLoss?.ergebnis || 0))}
              </span>
            </div>
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full" onClick={() => handleExport('GuV PDF')} data-testid="button-export-guv">
              <Download className="h-4 w-4 mr-2" />
              GuV PDF
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Anlagenspiegel
            </CardTitle>
            <CardDescription>Ueberblick</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Anlagen gesamt</span>
              <span className="font-medium" data-testid="text-report-anlagen">
                {formatEur(Number(rep?.assets?.total || rep?.assets?.totalBookValue || 0))}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span>AfA gesamt</span>
              <span className="font-medium" data-testid="text-report-afa">
                {formatEur(Number(rep?.assets?.totalDepreciation || 0))}
              </span>
            </div>
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full" onClick={() => handleExport('Anlagenspiegel PDF')} data-testid="button-export-anlagenspiegel">
              <Download className="h-4 w-4 mr-2" />
              Anlagenspiegel PDF
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

function Jahresabschluss() {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedPeriod, setSelectedPeriod] = useState<any>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');

  const completedSteps = useMemo(() => {
    const set = new Set<number>();
    if (selectedPeriodId) set.add(0);
    if (selectedPeriod?.depreciationBooked) set.add(1);
    if (selectedPeriod?.accrualsReviewed) set.add(2);
    if (selectedPeriod?.balanceReviewed) set.add(3);
    if (selectedPeriod?.closed) {
      set.add(4);
      set.add(5);
    }
    return set;
  }, [selectedPeriodId, selectedPeriod]);

  const canGoNext = useMemo(() => {
    if (currentStep === 0) return !!selectedPeriodId;
    return true;
  }, [currentStep, selectedPeriodId]);

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <Step1PeriodeWaehlen
            selectedPeriodId={selectedPeriodId}
            setSelectedPeriodId={setSelectedPeriodId}
            setSelectedYear={setSelectedYear}
            setSelectedPeriod={setSelectedPeriod}
            selectedPropertyId={selectedPropertyId}
            setSelectedPropertyId={setSelectedPropertyId}
          />
        );
      case 1:
        return (
          <Step2AfABuchen
            selectedYear={selectedYear}
            selectedPeriodId={selectedPeriodId!}
            selectedPeriod={selectedPeriod}
            selectedPropertyId={selectedPropertyId}
          />
        );
      case 2:
        return (
          <Step3Abgrenzungen
            selectedYear={selectedYear}
            selectedPeriodId={selectedPeriodId!}
            selectedPeriod={selectedPeriod}
          />
        );
      case 3:
        return (
          <Step4BilanzGuVReview
            selectedYear={selectedYear}
            selectedPeriodId={selectedPeriodId!}
            selectedPeriod={selectedPeriod}
            selectedPropertyId={selectedPropertyId}
          />
        );
      case 4:
        return (
          <Step5PeriodeSperren
            selectedPeriodId={selectedPeriodId!}
            selectedPeriod={selectedPeriod}
          />
        );
      case 5:
        return (
          <Step6Abschlussbericht
            selectedPeriodId={selectedPeriodId!}
            selectedPeriod={selectedPeriod}
          />
        );
      default:
        return null;
    }
  };

  return (
    <MainLayout title="Jahresabschluss" subtitle="Gefuehrter Abschluss-Wizard">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-jahresabschluss-title">Jahresabschluss</h1>
          <p className="text-muted-foreground" data-testid="text-jahresabschluss-subtitle">Gefuehrter Abschluss-Wizard</p>
        </div>

        <StepIndicator currentStep={currentStep} completedSteps={completedSteps} />

        <div data-testid="wizard-step-content">
          {renderStep()}
        </div>

        <div className="flex justify-between items-center pt-4 border-t gap-4">
          <Button
            variant="outline"
            onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
            disabled={currentStep === 0}
            data-testid="button-zurueck"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Zurueck
          </Button>
          <span className="text-sm text-muted-foreground" data-testid="text-step-counter">
            Schritt {currentStep + 1} von {STEPS.length}
          </span>
          <Button
            onClick={() => setCurrentStep((s) => Math.min(STEPS.length - 1, s + 1))}
            disabled={currentStep === STEPS.length - 1 || !canGoNext}
            data-testid="button-weiter"
          >
            Weiter
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    </MainLayout>
  );
}

export default Jahresabschluss;
