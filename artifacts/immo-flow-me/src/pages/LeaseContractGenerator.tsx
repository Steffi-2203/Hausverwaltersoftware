import { useState, useMemo } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useLeaseTemplates, useGenerateContract, useGenerateContractPdf, type LeaseTemplate, type GenerateContractInput } from '@/hooks/useLeaseContracts';
import { useProperties } from '@/hooks/useProperties';
import { useUnits } from '@/hooks/useUnits';
import { useTenants } from '@/hooks/useTenants';
import { toast } from 'sonner';
import {
  FileSignature,
  ChevronRight,
  ChevronLeft,
  Download,
  Eye,
  Check,
  FileText,
  Building,
  Users,
  ListChecks,
  Loader2,
} from 'lucide-react';

const STEP_LABELS = [
  { label: 'Vorlage auswählen', icon: FileText },
  { label: 'Stammdaten', icon: Building },
  { label: 'Klauseln auswählen', icon: ListChecks },
  { label: 'Vorschau & Generierung', icon: Eye },
];

export default function LeaseContractGenerator() {
  const [step, setStep] = useState(0);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [leaseStart, setLeaseStart] = useState('');
  const [leaseEnd, setLeaseEnd] = useState('');
  const [monthlyRent, setMonthlyRent] = useState('');
  const [operatingCosts, setOperatingCosts] = useState('');
  const [deposit, setDeposit] = useState('');
  const [selectedClauses, setSelectedClauses] = useState<string[]>([]);
  const [customNotes, setCustomNotes] = useState('');

  const { data: templates, isLoading: templatesLoading } = useLeaseTemplates();
  const { data: propertiesData, isLoading: propertiesLoading } = useProperties();
  const { data: unitsData } = useUnits(selectedPropertyId || undefined);
  const { data: tenantsData } = useTenants();
  const generateContract = useGenerateContract();
  const generatePdf = useGenerateContractPdf();

  const properties = useMemo(() => {
    if (!propertiesData) return [];
    if (Array.isArray(propertiesData)) return propertiesData;
    if (propertiesData.data) return propertiesData.data;
    return [];
  }, [propertiesData]);

  const units = useMemo(() => {
    if (!unitsData) return [];
    return Array.isArray(unitsData) ? unitsData : [];
  }, [unitsData]);

  const tenants = useMemo(() => {
    if (!tenantsData) return [];
    const all = Array.isArray(tenantsData) ? tenantsData : [];
    if (!selectedUnitId) return all;
    return all.filter((t: any) => (t.unitId || t.unit_id) === selectedUnitId);
  }, [tenantsData, selectedUnitId]);

  const selectedTemplate = useMemo(() => {
    if (!templates || !selectedTemplateId) return null;
    return templates.find(t => t.id === selectedTemplateId) || null;
  }, [templates, selectedTemplateId]);

  const selectedProperty = useMemo(() => properties.find((p: any) => p.id === selectedPropertyId), [properties, selectedPropertyId]);
  const selectedUnit = useMemo(() => units.find((u: any) => u.id === selectedUnitId), [units, selectedUnitId]);
  const selectedTenant = useMemo(() => {
    if (!tenantsData) return null;
    const all = Array.isArray(tenantsData) ? tenantsData : [];
    return all.find((t: any) => t.id === selectedTenantId) || null;
  }, [tenantsData, selectedTenantId]);

  const handleSelectTemplate = (id: string) => {
    setSelectedTemplateId(id);
    const tmpl = templates?.find(t => t.id === id);
    if (tmpl) {
      const optionalIds = tmpl.clauses.filter(c => !c.required).map(c => c.id);
      setSelectedClauses(optionalIds);
    }
  };

  const handlePropertyChange = (id: string) => {
    setSelectedPropertyId(id);
    setSelectedUnitId('');
    setSelectedTenantId('');
  };

  const handleUnitChange = (id: string) => {
    setSelectedUnitId(id);
    setSelectedTenantId('');
    const unit = units.find((u: any) => u.id === id);
    if (unit?.flaeche) {
      // no auto-fill for rent fields
    }
  };

  const handleTenantChange = (id: string) => {
    setSelectedTenantId(id);
    const tenant = tenantsData && Array.isArray(tenantsData) ? tenantsData.find((t: any) => t.id === id) : null;
    if (tenant) {
      if (tenant.grundmiete && Number(tenant.grundmiete) > 0) setMonthlyRent(String(Number(tenant.grundmiete)));
      const bk = Number(tenant.betriebskostenVorschuss || tenant.betriebskosten_vorschuss || 0);
      if (bk > 0) setOperatingCosts(String(bk));
      if (tenant.kaution && Number(tenant.kaution) > 0) setDeposit(String(Number(tenant.kaution)));
      if (tenant.mietbeginn) setLeaseStart(tenant.mietbeginn);
      if (tenant.mietende) setLeaseEnd(tenant.mietende);
    }
  };

  const toggleClause = (clauseId: string) => {
    setSelectedClauses(prev =>
      prev.includes(clauseId) ? prev.filter(id => id !== clauseId) : [...prev, clauseId]
    );
  };

  const getContractInput = (): GenerateContractInput => ({
    templateId: selectedTemplateId,
    tenantId: selectedTenantId || undefined,
    unitId: selectedUnitId || undefined,
    propertyId: selectedPropertyId || undefined,
    leaseStart,
    leaseEnd: leaseEnd || null,
    monthlyRent: parseFloat(monthlyRent) || 0,
    operatingCosts: parseFloat(operatingCosts) || 0,
    deposit: parseFloat(deposit) || 0,
    selectedClauses,
    customNotes,
  });

  const handlePreview = () => {
    generateContract.mutate(getContractInput(), {
      onError: () => toast.error('Fehler bei der Vertragserstellung'),
    });
  };

  const handleDownloadPdf = () => {
    generatePdf.mutate(getContractInput(), {
      onSuccess: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Mietvertrag_${selectedUnit?.topNummer || 'Entwurf'}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success('PDF wurde heruntergeladen');
      },
      onError: () => toast.error('Fehler bei der PDF-Erstellung'),
    });
  };

  const canProceed = () => {
    switch (step) {
      case 0: return !!selectedTemplateId;
      case 1: return !!leaseStart && !!monthlyRent;
      case 2: return true;
      case 3: return true;
      default: return false;
    }
  };

  const formatCurrency = (val: string | number) => {
    const num = typeof val === 'string' ? parseFloat(val) : val;
    if (isNaN(num)) return '—';
    return new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(num);
  };

  const formatDateDisplay = (d: string) => {
    if (!d) return '—';
    const date = new Date(d);
    return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
  };

  return (
    <MainLayout title="">
      <div className="container mx-auto py-6 px-4 max-w-5xl" data-testid="page-lease-contract-generator">
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <FileSignature className="h-7 w-7 text-muted-foreground" />
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Mietvertragsgenerator</h1>
          <Badge variant="secondary" data-testid="badge-mrg">MRG-konform</Badge>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-1 mb-8 overflow-x-auto" data-testid="stepper-container">
          {STEP_LABELS.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === step;
            const isCompleted = i < step;
            return (
              <div key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                <button
                  onClick={() => i < step && setStep(i)}
                  disabled={i > step}
                  data-testid={`stepper-step-${i}`}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : isCompleted
                      ? 'bg-muted text-foreground cursor-pointer'
                      : 'text-muted-foreground'
                  }`}
                >
                  {isCompleted ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
              </div>
            );
          })}
        </div>

        {/* Step 1: Template Selection */}
        {step === 0 && (
          <div data-testid="step-template-selection">
            <h2 className="text-lg font-semibold mb-4">Vertragsvorlage auswählen</h2>
            {templatesLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Vorlagen werden geladen...</span>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-3">
                {templates?.map((tmpl) => (
                  <Card
                    key={tmpl.id}
                    data-testid={`template-card-${tmpl.id}`}
                    className={`cursor-pointer transition-all ${
                      selectedTemplateId === tmpl.id
                        ? 'ring-2 ring-primary'
                        : 'hover-elevate'
                    }`}
                    onClick={() => handleSelectTemplate(tmpl.id)}
                  >
                    <CardHeader>
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-base">{tmpl.name}</CardTitle>
                        {selectedTemplateId === tmpl.id && (
                          <Check className="h-5 w-5 text-primary shrink-0" />
                        )}
                      </div>
                      <CardDescription>{tmpl.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-muted-foreground">
                        {tmpl.clauses.length} Klauseln ({tmpl.clauses.filter(c => c.required).length} Pflicht)
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Stammdaten */}
        {step === 1 && (
          <div data-testid="step-stammdaten" className="space-y-6">
            <h2 className="text-lg font-semibold mb-4">Stammdaten erfassen</h2>

            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2"><Building className="h-4 w-4" /> Objekt & Mieter</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="property-select">Liegenschaft</Label>
                    <Select value={selectedPropertyId} onValueChange={handlePropertyChange}>
                      <SelectTrigger data-testid="select-property" id="property-select">
                        <SelectValue placeholder="Liegenschaft auswählen" />
                      </SelectTrigger>
                      <SelectContent>
                        {properties.map((p: any) => (
                          <SelectItem key={p.id} value={p.id} data-testid={`property-option-${p.id}`}>
                            {p.name} – {p.address}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="unit-select">Einheit</Label>
                    <Select value={selectedUnitId} onValueChange={handleUnitChange} disabled={!selectedPropertyId}>
                      <SelectTrigger data-testid="select-unit" id="unit-select">
                        <SelectValue placeholder={selectedPropertyId ? 'Einheit auswählen' : 'Zuerst Liegenschaft wählen'} />
                      </SelectTrigger>
                      <SelectContent>
                        {units.map((u: any) => (
                          <SelectItem key={u.id} value={u.id} data-testid={`unit-option-${u.id}`}>
                            Top {u.topNummer || u.top_nummer} ({u.flaeche || '—'} m²)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="tenant-select">Mieter/in</Label>
                    <Select value={selectedTenantId} onValueChange={handleTenantChange}>
                      <SelectTrigger data-testid="select-tenant" id="tenant-select">
                        <SelectValue placeholder="Mieter auswählen (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        {tenants.map((t: any) => (
                          <SelectItem key={t.id} value={t.id} data-testid={`tenant-option-${t.id}`}>
                            {t.firstName || t.first_name} {t.lastName || t.last_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedProperty && (
                    <div className="text-sm text-muted-foreground bg-muted rounded-md p-3" data-testid="auto-fill-info">
                      <p><span className="font-medium">Adresse:</span> {selectedProperty.address}, {selectedProperty.postalCode || selectedProperty.postal_code} {selectedProperty.city}</p>
                      {selectedUnit && <p><span className="font-medium">Fläche:</span> {selectedUnit.flaeche || '—'} m²</p>}
                      {selectedTenant && <p><span className="font-medium">Mieter:</span> {selectedTenant.firstName || selectedTenant.first_name} {selectedTenant.lastName || selectedTenant.last_name}</p>}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Vertragsdaten</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="lease-start">Mietbeginn *</Label>
                    <Input
                      id="lease-start"
                      type="date"
                      value={leaseStart}
                      onChange={e => setLeaseStart(e.target.value)}
                      data-testid="input-lease-start"
                    />
                  </div>

                  <div>
                    <Label htmlFor="lease-end">Mietende (leer = unbefristet)</Label>
                    <Input
                      id="lease-end"
                      type="date"
                      value={leaseEnd}
                      onChange={e => setLeaseEnd(e.target.value)}
                      data-testid="input-lease-end"
                    />
                  </div>

                  <div>
                    <Label htmlFor="monthly-rent">Monatlicher Hauptmietzins (EUR) *</Label>
                    <Input
                      id="monthly-rent"
                      type="number"
                      step="0.01"
                      min="0"
                      value={monthlyRent}
                      onChange={e => setMonthlyRent(e.target.value)}
                      placeholder="z.B. 850.00"
                      data-testid="input-monthly-rent"
                    />
                  </div>

                  <div>
                    <Label htmlFor="operating-costs">Betriebskosten-Akonto (EUR)</Label>
                    <Input
                      id="operating-costs"
                      type="number"
                      step="0.01"
                      min="0"
                      value={operatingCosts}
                      onChange={e => setOperatingCosts(e.target.value)}
                      placeholder="z.B. 180.00"
                      data-testid="input-operating-costs"
                    />
                  </div>

                  <div>
                    <Label htmlFor="deposit">Kaution (EUR)</Label>
                    <Input
                      id="deposit"
                      type="number"
                      step="0.01"
                      min="0"
                      value={deposit}
                      onChange={e => setDeposit(e.target.value)}
                      placeholder="z.B. 2550.00"
                      data-testid="input-deposit"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Step 3: Klauseln */}
        {step === 2 && selectedTemplate && (
          <div data-testid="step-clause-selection">
            <h2 className="text-lg font-semibold mb-4">Klauseln auswählen</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Pflichtklauseln sind bereits aktiviert und können nicht abgewählt werden.
            </p>
            <div className="space-y-3">
              {selectedTemplate.clauses.map((clause) => (
                <Card key={clause.id} data-testid={`clause-card-${clause.id}`}>
                  <CardContent className="py-4">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id={`clause-${clause.id}`}
                        data-testid={`checkbox-clause-${clause.id}`}
                        checked={clause.required || selectedClauses.includes(clause.id)}
                        disabled={clause.required}
                        onCheckedChange={() => !clause.required && toggleClause(clause.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <label
                          htmlFor={`clause-${clause.id}`}
                          className="font-medium text-sm cursor-pointer flex items-center gap-2 flex-wrap"
                        >
                          {clause.title}
                          {clause.required && <Badge variant="secondary" className="text-xs">Pflicht</Badge>}
                        </label>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {clause.content.substring(0, 150)}...
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Step 4: Preview & Generation */}
        {step === 3 && (
          <div data-testid="step-preview" className="space-y-6">
            <h2 className="text-lg font-semibold mb-4">Vorschau & Generierung</h2>

            <div className="flex items-center gap-3 flex-wrap">
              <Button
                onClick={handlePreview}
                disabled={generateContract.isPending}
                data-testid="button-preview-contract"
              >
                {generateContract.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
                Vorschau anzeigen
              </Button>
              <Button
                onClick={handleDownloadPdf}
                disabled={generatePdf.isPending}
                variant="default"
                data-testid="button-download-pdf"
              >
                {generatePdf.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
                PDF herunterladen
              </Button>
            </div>

            <div>
              <Label htmlFor="custom-notes">Besondere Vereinbarungen / Anmerkungen</Label>
              <Textarea
                id="custom-notes"
                value={customNotes}
                onChange={e => setCustomNotes(e.target.value)}
                placeholder="Zusätzliche Vereinbarungen hier eintragen..."
                className="mt-1"
                rows={3}
                data-testid="textarea-custom-notes"
              />
            </div>

            {/* Summary info */}
            <Card data-testid="contract-summary">
              <CardHeader>
                <CardTitle className="text-base">Vertragszusammenfassung</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">Vorlage:</span>
                  <span data-testid="summary-template">{selectedTemplate?.name || '—'}</span>
                  <span className="text-muted-foreground">Liegenschaft:</span>
                  <span data-testid="summary-property">{selectedProperty?.name || '—'}</span>
                  <span className="text-muted-foreground">Einheit:</span>
                  <span data-testid="summary-unit">Top {selectedUnit?.topNummer || selectedUnit?.top_nummer || '—'}</span>
                  <span className="text-muted-foreground">Mieter/in:</span>
                  <span data-testid="summary-tenant">{selectedTenant ? `${selectedTenant.firstName || selectedTenant.first_name} ${selectedTenant.lastName || selectedTenant.last_name}` : '—'}</span>
                  <span className="text-muted-foreground">Mietbeginn:</span>
                  <span data-testid="summary-start">{leaseStart ? formatDateDisplay(leaseStart) : '—'}</span>
                  <span className="text-muted-foreground">Mietende:</span>
                  <span data-testid="summary-end">{leaseEnd ? formatDateDisplay(leaseEnd) : 'Unbefristet'}</span>
                  <span className="text-muted-foreground">Hauptmietzins:</span>
                  <span data-testid="summary-rent">{monthlyRent ? formatCurrency(monthlyRent) : '—'}</span>
                  <span className="text-muted-foreground">Betriebskosten:</span>
                  <span data-testid="summary-bk">{operatingCosts ? formatCurrency(operatingCosts) : '—'}</span>
                  <span className="text-muted-foreground">Kaution:</span>
                  <span data-testid="summary-deposit">{deposit ? formatCurrency(deposit) : '—'}</span>
                </div>
              </CardContent>
            </Card>

            {/* Contract Preview */}
            {generateContract.data && (
              <Card data-testid="contract-preview-card">
                <CardHeader>
                  <CardTitle className="text-base">Vertragsvorschau</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="bg-muted/50 rounded-md p-6 space-y-6 text-sm leading-relaxed" data-testid="contract-text-preview">
                    <div className="text-center space-y-1">
                      <h3 className="text-xl font-bold">
                        {generateContract.data.templateId === 'weg_nutzungsvertrag' ? 'NUTZUNGSVERTRAG' : 'MIETVERTRAG'}
                      </h3>
                      <p className="text-muted-foreground">({generateContract.data.templateName})</p>
                    </div>

                    <Separator />

                    <div>
                      <p><strong>Zwischen</strong></p>
                      <p className="ml-4">Vermieter/in: {generateContract.data.vermieterName}</p>
                      <p>und</p>
                      <p className="ml-4">Mieter/in: {generateContract.data.mieterName}</p>
                    </div>

                    <Separator />

                    {generateContract.data.clauses.map((clause) => (
                      <div key={clause.id} data-testid={`preview-clause-${clause.id}`}>
                        <h4 className="font-semibold mb-2">{clause.title}</h4>
                        <p className="whitespace-pre-wrap">{clause.content}</p>
                      </div>
                    ))}

                    {generateContract.data.customNotes && (
                      <div data-testid="preview-custom-notes">
                        <h4 className="font-semibold mb-2">Besondere Vereinbarungen</h4>
                        <p className="whitespace-pre-wrap">{generateContract.data.customNotes}</p>
                      </div>
                    )}

                    <Separator />

                    <div className="grid grid-cols-2 gap-8 pt-8">
                      <div className="text-center">
                        <div className="border-t border-foreground/30 pt-2 mt-12">Vermieter/in</div>
                      </div>
                      <div className="text-center">
                        <div className="border-t border-foreground/30 pt-2 mt-12">Mieter/in</div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Navigation buttons */}
        <div className="flex items-center justify-between mt-8 gap-3">
          <Button
            variant="outline"
            onClick={() => setStep(s => Math.max(0, s - 1))}
            disabled={step === 0}
            data-testid="button-step-back"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Zurück
          </Button>

          {step < 3 && (
            <Button
              onClick={() => setStep(s => Math.min(3, s + 1))}
              disabled={!canProceed()}
              data-testid="button-step-next"
            >
              Weiter
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
