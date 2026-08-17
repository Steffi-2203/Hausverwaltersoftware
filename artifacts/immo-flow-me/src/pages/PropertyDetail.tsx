import { useState, type ReactNode } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ArrowLeft,
  Building2,
  Edit,
  Plus,
  FileText,
  Home,
  Euro,
  Percent,
  Loader2,
  Trash2,
  Crown,
  Upload,
  Users,
  AlertTriangle,
  Wrench,
  FileImage,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Scale,
} from 'lucide-react';
import { UnitImportDialog } from '@/components/units/UnitImportDialog';
import { HeatingCostImportDialog } from '@/components/heating/HeatingCostImportDialog';
import { TenantImportDialog } from '@/components/tenants/TenantImportDialog';
import { PdfScanDialog } from '@/components/tenants/PdfScanDialog';
import { PropertyOwnersCard } from '@/components/property/PropertyOwnersCard';
import { MaintenanceContractsTab } from '@/components/property/MaintenanceContractsTab';
import { useQueryClient, useQueries } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useProperty, useDeleteProperty } from '@/hooks/useProperties';
import { useUnits } from '@/hooks/useUnits';
import { usePropertyDocuments, useUploadPropertyDocument, useDeletePropertyDocument, PROPERTY_DOCUMENT_TYPES } from '@/hooks/usePropertyDocuments';
import { useDistributionKeysByProperty, useCreatePropertyDistributionKey, useDeletePropertyDistributionKey, inputTypeOptions } from '@/hooks/useDistributionKeys';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { useSubscriptionLimits } from '@/hooks/useOrganization';
import { DocumentUploadDialog } from '@/components/documents/DocumentUploadDialog';
import { DocumentList } from '@/components/documents/DocumentList';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

const unitTypeLabels: Record<string, string> = {
  wohnung: 'Wohnung',
  geschaeft: 'Geschäft',
  garage: 'Garage',
  stellplatz: 'Stellplatz',
  lager: 'Lager',
  sonstiges: 'Sonstiges',
};

const statusLabels: Record<string, string> = {
  aktiv: 'Vermietet',
  leerstand: 'Leerstand',
  beendet: 'Beendet',
};

const statusStyles: Record<string, string> = {
  aktiv: 'status-active',
  leerstand: 'status-vacant',
  beendet: 'status-ended',
};

export default function PropertyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [unitImportDialogOpen, setUnitImportDialogOpen] = useState(false);
  const [tenantImportDialogOpen, setTenantImportDialogOpen] = useState(false);
  const [pdfScanDialogOpen, setPdfScanDialogOpen] = useState(false);
  const [heatingImportOpen, setHeatingImportOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('units');
  const { maxLimits, canAddUnit: canAddUnitToProperty } = useSubscriptionLimits();
  
  const { data: property, isLoading: isLoadingProperty } = useProperty(id);
  const { data: units, isLoading: isLoadingUnits } = useUnits(id);
  const { data: documents, isLoading: isLoadingDocuments } = usePropertyDocuments(id);
  const { data: distributionKeys, isLoading: isLoadingDistributionKeys } = useDistributionKeysByProperty(id);
  const deleteProperty = useDeleteProperty();
  const uploadDocument = useUploadPropertyDocument();
  const deleteDocument = useDeletePropertyDocument();
  const createDistributionKey = useCreatePropertyDistributionKey(id || '');
  const deleteDistributionKey = useDeletePropertyDistributionKey(id || '');
  
  const [newKeyDialogOpen, setNewKeyDialogOpen] = useState(false);
  const [newKeyForm, setNewKeyForm] = useState({ 
    keyCode: '', 
    name: '', 
    description: '', 
    inputType: 'flaeche', 
    unit: 'm²',
    includedUnitTypes: ['wohnung', 'geschaeft', 'lager', 'garage', 'stellplatz', 'sonstiges'] as string[]
  });
  
  const allUnitTypes = [
    { value: 'wohnung', label: 'Wohnungen' },
    { value: 'geschaeft', label: 'Geschäfte' },
    { value: 'lager', label: 'Lager' },
    { value: 'garage', label: 'Garagen' },
    { value: 'stellplatz', label: 'Stellplätze' },
    { value: 'sonstiges', label: 'Sonstige' },
  ];
  
  // Check if unit limit is reached for this property
  const canAddUnit = id ? canAddUnitToProperty(id) : false;
  
  const handleCreateDistributionKey = async () => {
    if (!newKeyForm.keyCode || !newKeyForm.name) return;
    await createDistributionKey.mutateAsync({
      keyCode: newKeyForm.keyCode,
      name: newKeyForm.name,
      description: newKeyForm.description || undefined,
      inputType: newKeyForm.inputType,
      unit: inputTypeOptions.find(o => o.value === newKeyForm.inputType)?.unit || 'Anteil',
      includedUnitTypes: newKeyForm.includedUnitTypes,
    });
    setNewKeyForm({ 
      keyCode: '', 
      name: '', 
      description: '', 
      inputType: 'flaeche', 
      unit: 'm²',
      includedUnitTypes: ['wohnung', 'geschaeft', 'lager', 'garage', 'stellplatz', 'sonstiges']
    });
    setNewKeyDialogOpen(false);
  };

  const handleDelete = async () => {
    if (id) {
      await deleteProperty.mutateAsync(id);
      navigate('/liegenschaften');
    }
  };

  const handleUploadDocument = async (file: File, type: string, name: string) => {
    if (!id) return;
    await uploadDocument.mutateAsync({
      propertyId: id,
      file,
      documentType: type,
      documentName: name,
    });
  };

  const handleDeleteDocument = (doc: { id: string; file_url: string }) => {
    if (!id) return;
    deleteDocument.mutate({
      id: doc.id,
      propertyId: id,
      fileUrl: doc.file_url,
    });
  };

  if (isLoadingProperty || isLoadingUnits) {
    return (
      <MainLayout title="Laden..." subtitle="">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  if (!property) {
    return (
      <MainLayout title="Nicht gefunden" subtitle="">
        <div className="flex flex-col items-center justify-center py-12">
          <p className="text-muted-foreground mb-4">Liegenschaft nicht gefunden</p>
          <Link to="/liegenschaften">
            <Button>Zurück zur Übersicht</Button>
          </Link>
        </div>
      </MainLayout>
    );
  }

  const totalRent = units?.reduce((sum, unit) => {
    const tenants = unit.tenants as any[];
    const activeTenant = tenants?.find((t: any) => t.status === 'aktiv');
    if (activeTenant) {
      return (
        sum +
        Number(activeTenant.grundmiete || 0) +
        Number(activeTenant.betriebskosten_vorschuss || 0) +
        Number(activeTenant.heizungskosten_vorschuss || 0)
      );
    }
    return sum;
  }, 0) || 0;

  // Calculate distribution key validation
  const unitsQmSum = units?.reduce((acc, unit) => acc + (Number((unit as any).vs_qm) || Number(unit.qm) || 0), 0) || 0;
  const unitsMeaSum = units?.reduce((acc, unit) => acc + (Number((unit as any).vs_mea) || Number(unit.mea) || 0), 0) || 0;
  const propertyQm = Number(property?.total_qm) || 0;
  const propertyMea = Number(property?.total_mea) || 0;
  const qmDiff = propertyQm - unitsQmSum;
  const meaDiff = propertyMea - unitsMeaSum;
  const hasDistributionMismatch = Math.abs(qmDiff) > 0.01 || Math.abs(meaDiff) > 0.01;

  // MRG-Richtwert-Check: nur für Mietverwaltungs-Liegenschaften relevant
  const isMietverwaltung =
    (property.management_type || (property as any).managementType) === 'mietverwaltung';

  // Aktive Mieter pro Einheit für parallele MRG-Check-Abfragen sammeln
  const activeTenantsForMrg = isMietverwaltung && units
    ? units.flatMap((unit) => {
        const tenantList = unit.tenants as any[];
        const activeTenant = tenantList?.find((t: any) => t.status === 'aktiv');
        if (!activeTenant) return [];
        return [{
          tenantId: activeTenant.id as string,
          topNummer: unit.top_nummer,
          unitQm: Number(unit.qm) || 0,
          grundmiete: Number(activeTenant.grundmiete) || 0,
          tenantName: `${activeTenant.first_name} ${activeTenant.last_name}`.trim(),
        }];
      })
    : [];

  type MrgCheckResult = {
    ueberschritten: boolean;
    differenz: number;
    zulassigerHmz: number | null;
    berechnungsgrundlage: string;
  };

  // useQueries mit stabilem leeren Array wenn nicht applicable
  const mrgCheckQueries = useQueries({
    queries: activeTenantsForMrg.map(({ tenantId }) => ({
      queryKey: ['mrg-check', tenantId],
      queryFn: async (): Promise<MrgCheckResult | null> => {
        const res = await fetch(`/api/tenants/${tenantId}/mrg-check`);
        if (!res.ok) return null;
        return res.json();
      },
      staleTime: 0,
    })),
  });

  const mrgCheckLoading = mrgCheckQueries.some((q) => q.isLoading);

  // Ampel-Logik pro Einheit bestimmen
  type MrgStatus = 'ok' | 'grenzwertig' | 'ueberschritten' | 'nicht_anwendbar';
  const getMrgStatus = (check: MrgCheckResult | null | undefined, grundmiete: number): MrgStatus => {
    if (!check || check.zulassigerHmz === null) return 'nicht_anwendbar';
    if (check.ueberschritten) return 'ueberschritten';
    if (check.zulassigerHmz > 0 && grundmiete / check.zulassigerHmz >= 0.9) return 'grenzwertig';
    return 'ok';
  };

  // MRG-Check Zusammenfassung
  const mrgRows = activeTenantsForMrg.map((t, i) => ({
    ...t,
    check: mrgCheckQueries[i]?.data ?? null,
    status: getMrgStatus(mrgCheckQueries[i]?.data as MrgCheckResult | null | undefined, t.grundmiete),
  }));

  const mrgSummary = {
    ok: mrgRows.filter((r) => r.status === 'ok').length,
    grenzwertig: mrgRows.filter((r) => r.status === 'grenzwertig').length,
    ueberschritten: mrgRows.filter((r) => r.status === 'ueberschritten').length,
  };

  const hasMrgWarnings = mrgSummary.ueberschritten > 0 || mrgSummary.grenzwertig > 0;

  return (
    <MainLayout
      title={property.name}
      subtitle={`${property.address}, ${property.postal_code} ${property.city}`}
    >
      {/* Breadcrumb Navigation */}
      <nav className="flex items-center gap-1 text-sm text-muted-foreground mb-6">
        <Link to="/liegenschaften" className="hover:text-foreground transition-colors">Liegenschaften</Link>
        <span>/</span>
        <span className="text-foreground font-medium">{property.name}</span>
        <Badge variant="outline" className="ml-2" data-testid="badge-management-type">
          {(property.management_type || property.managementType) === 'weg' ? 'WEG' : 'Mietverwaltung'}
        </Badge>
      </nav>

      {/* Back Button & Actions */}
      <div className="flex items-center justify-between mb-6">
        <Link
          to="/liegenschaften"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Zurück zur Übersicht
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setActiveTab('documents')}>
            <FileText className="h-4 w-4 mr-2" />
            Dokumente
          </Button>
          <Link to={`/liegenschaften/${id}/bearbeiten`}>
            <Button variant="outline">
              <Edit className="h-4 w-4 mr-2" />
              Bearbeiten
            </Button>
          </Link>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <Trash2 className="h-4 w-4 mr-2" />
                Löschen
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Liegenschaft löschen?</AlertDialogTitle>
                <AlertDialogDescription>
                  Diese Aktion kann nicht rückgängig gemacht werden. Alle zugehörigen Einheiten und
                  Mieter werden ebenfalls gelöscht.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>Löschen</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Property Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Home className="h-5 w-5 text-primary" />
            </div>
            <span className="text-sm text-muted-foreground">Einheiten</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{units?.length || 0}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {units?.filter((u) => u.status === 'aktiv').length || 0} vermietet •{' '}
            {units?.filter((u) => u.status === 'leerstand').length || 0} leer
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-lg bg-success/10 p-2">
              <Euro className="h-5 w-5 text-success" />
            </div>
            <span className="text-sm text-muted-foreground">Monatliche Miete</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            €{totalRent.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-muted-foreground mt-1">inkl. BK & Heizung</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-lg bg-accent/10 p-2">
              <Building2 className="h-5 w-5 text-accent-foreground" />
            </div>
            <span className="text-sm text-muted-foreground">Gesamtfläche</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {Number(property.total_qm).toLocaleString('de-AT')} m²
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {Number(property.total_mea)}‰ MEA gesamt
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-lg bg-warning/10 p-2">
              <Percent className="h-5 w-5 text-warning" />
            </div>
            <span className="text-sm text-muted-foreground">Betriebskosten</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            €{Number(property.betriebskosten_gesamt).toLocaleString('de-AT')}
          </p>
          <p className="text-xs text-muted-foreground mt-1">pro Jahr</p>
        </div>
      </div>

      {/* Global Distribution Key Warning */}
      {hasDistributionMismatch && (
        <div className="rounded-xl border-2 border-destructive bg-destructive/10 p-4 mb-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 text-destructive flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-semibold text-destructive">
                ⚠️ Verteilerschlüssel stimmen nicht überein!
              </h4>
              <p className="text-sm text-destructive mt-1">
                {Math.abs(qmDiff) > 0.01 && (
                  <span className="block">
                    <strong>m²:</strong> {propertyQm.toLocaleString('de-AT')} m² Liegenschaft vs. {unitsQmSum.toLocaleString('de-AT')} m² Einheiten 
                    ({qmDiff > 0 ? 'fehlen' : 'zuviel'}: {Math.abs(qmDiff).toLocaleString('de-AT')} m²)
                  </span>
                )}
                {Math.abs(meaDiff) > 0.01 && (
                  <span className="block">
                    <strong>MEA:</strong> {propertyMea.toLocaleString('de-AT')}‰ Liegenschaft vs. {unitsMeaSum.toLocaleString('de-AT')}‰ Einheiten 
                    ({meaDiff > 0 ? 'fehlen' : 'zuviel'}: {Math.abs(meaDiff).toLocaleString('de-AT')}‰)
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Die Mieter zahlen sonst für Leerstände oder nicht erfasste Einheiten mit. Bitte Einheiten oder Liegenschafts-Werte anpassen.
              </p>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => setActiveTab('distribution')}
            >
              Details anzeigen
            </Button>
          </div>
        </div>
      )}

      {/* MRG-Richtwert-Warnung: Bundesland oder Mietrecht-Typ fehlt */}
      {(property.management_type || (property as any).managementType) === 'mietverwaltung' &&
        (!((property as any).bundesland) || !((property as any).mietrecht_typ || (property as any).mietrechtTyp)) && (
        <div
          className="rounded-xl border-2 border-warning bg-warning/10 p-4 mb-4"
          data-testid="mrg-missing-fields-banner"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 text-warning flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-semibold text-warning-foreground">
                MRG-Richtwert-Prüfung nicht möglich
              </h4>
              <p className="text-sm text-muted-foreground mt-1">
                Für diese Mietverwaltungs-Liegenschaft fehlen Angaben die für die gesetzliche
                Richtwertberechnung (§16 MRG) benötigt werden:
              </p>
              <ul className="text-sm text-muted-foreground mt-1 list-disc list-inside space-y-0.5">
                {!(property as any).bundesland && (
                  <li>Bundesland ist nicht gesetzt</li>
                )}
                {!((property as any).mietrecht_typ || (property as any).mietrechtTyp) && (
                  <li>Mietrechtstyp (Voll-MRG / Teil-MRG / ABGB) ist nicht gesetzt</li>
                )}
              </ul>
            </div>
            <Link to={`/liegenschaften/${id}/bearbeiten`}>
              <Button
                variant="outline"
                size="sm"
                className="border-warning text-warning-foreground hover:bg-warning hover:text-warning-foreground whitespace-nowrap"
              >
                <Edit className="h-4 w-4 mr-1" />
                Jetzt ergänzen
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="units" className="relative">
            Einheiten
            {hasDistributionMismatch && (
              <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-destructive" />
            )}
          </TabsTrigger>
          <TabsTrigger value="owners">Eigentümer</TabsTrigger>
          <TabsTrigger value="distribution" className="relative">
            Verteilerschlüssel
            {hasDistributionMismatch && (
              <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-destructive" />
            )}
          </TabsTrigger>
          <TabsTrigger value="costs">Betriebskosten</TabsTrigger>
          <TabsTrigger value="maintenance">
            <Wrench className="h-4 w-4 mr-1" />
            Wartungsverträge
          </TabsTrigger>
          <TabsTrigger value="heating">
            Heizkosten
          </TabsTrigger>
          <TabsTrigger value="documents">Dokumente</TabsTrigger>
          {isMietverwaltung && (
            <TabsTrigger value="mrg" className="relative">
              <Scale className="h-4 w-4 mr-1" />
              MRG-Richtwert
              {hasMrgWarnings && !mrgCheckLoading && (
                <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-destructive" />
              )}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="units" className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="font-semibold text-foreground">Alle Einheiten</h3>
              <p className="text-sm text-muted-foreground">
                {units?.length || 0} von {maxLimits.unitsPerProperty} Einheiten
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setUnitImportDialogOpen(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Einheiten importieren
              </Button>
              <Button variant="outline" onClick={() => setTenantImportDialogOpen(true)}>
                <Users className="h-4 w-4 mr-2" />
                Mieter CSV Import
              </Button>
              <Button onClick={() => setPdfScanDialogOpen(true)} data-testid="button-pdf-scan-property">
                <FileImage className="h-4 w-4 mr-2" />
                PDF scannen
              </Button>
              {canAddUnit ? (
                <Link to={`/liegenschaften/${id}/einheiten/neu`}>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Einheit hinzufügen
                  </Button>
                </Link>
              ) : (
                <Link to="/einstellungen">
                  <Button variant="secondary">
                    <Crown className="h-4 w-4 mr-2" />
                    Einstellungen
                  </Button>
                </Link>
              )}
            </div>
          </div>

          {units && units.length > 0 ? (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Top</TableHead>
                    <TableHead>Typ</TableHead>
                    <TableHead>Fläche</TableHead>
                    <TableHead>MEA</TableHead>
                    <TableHead>Personen</TableHead>
                    <TableHead>Mieter</TableHead>
                    <TableHead>Vorschreibung/Monat</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {units.map((unit) => {
                    const tenants = unit.tenants as any[];
                    const activeTenant = tenants?.find((t: any) => t.status === 'aktiv');
                    const grundmiete = activeTenant ? Number(activeTenant.grundmiete || 0) : 0;
                    const bk = activeTenant ? Number(activeTenant.betriebskosten_vorschuss || 0) : 0;
                    const hk = activeTenant ? Number(activeTenant.heizungskosten_vorschuss || 0) : 0;
                    const totalRent = grundmiete + bk + hk;

                    return (
                      <TableRow key={unit.id} className="hover:bg-muted/30">
                        <TableCell className="font-medium">{unit.top_nummer}</TableCell>
                        <TableCell>{unitTypeLabels[unit.type] || unit.type}</TableCell>
                        <TableCell>{Number(unit.qm).toLocaleString('de-AT')} m²</TableCell>
                        <TableCell>{Number(unit.mea)}‰</TableCell>
                        <TableCell>{unit.vs_personen || 0}</TableCell>
                        <TableCell>
                          {activeTenant ? (
                            <div>
                              <p className="font-medium">
                                {activeTenant.first_name} {activeTenant.last_name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                seit{' '}
                                {new Date(activeTenant.mietbeginn).toLocaleDateString('de-AT')}
                              </p>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {activeTenant ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <span className="font-medium cursor-help underline decoration-dotted">
                                    €{totalRent.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="p-3">
                                  <div className="space-y-1 text-sm">
                                    <p className="font-semibold border-b pb-1 mb-2">Monatliche Vorschreibung</p>
                                    <div className="flex justify-between gap-4">
                                      <span>Grundmiete:</span>
                                      <span className="font-medium">€ {grundmiete.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span>Betriebskosten:</span>
                                      <span className="font-medium">€ {bk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span>Heizkosten:</span>
                                      <span className="font-medium">€ {hk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="flex justify-between gap-4 border-t pt-1 mt-2 font-semibold">
                                      <span>Gesamt:</span>
                                      <span>€ {totalRent.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
                                    </div>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className={cn('status-badge', statusStyles[unit.status])}>
                            {statusLabels[unit.status] || unit.status}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Link to={`/einheiten/${id}/${unit.id}?tab=documents`}>
                              <Button variant="ghost" size="sm" title="Dokumente">
                                <FileText className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Link to={`/liegenschaften/${id}/einheiten/${unit.id}/bearbeiten`}>
                              <Button variant="ghost" size="sm" title="Bearbeiten">
                                <Edit className="h-4 w-4" />
                              </Button>
                            </Link>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card p-12 text-center">
              <Home className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Noch keine Einheiten vorhanden</p>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                Fügen Sie die erste Einheit hinzu
              </p>
              {canAddUnit ? (
                <Link to={`/liegenschaften/${id}/einheiten/neu`}>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Einheit hinzufügen
                  </Button>
                </Link>
              ) : (
                <Link to="/einstellungen">
                  <Button variant="secondary">
                    <Crown className="h-4 w-4 mr-2" />
                    Einstellungen
                  </Button>
                </Link>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="owners" className="space-y-4">
          {id && <PropertyOwnersCard propertyId={id} />}
        </TabsContent>

        <TabsContent value="distribution" className="space-y-4">
          {/* Distribution Key Validation Warnings */}
          {(() => {
            const unitsQmSum = units?.reduce((acc, unit) => acc + (Number((unit as any).vs_qm) || Number(unit.qm) || 0), 0) || 0;
            const unitsMeaSum = units?.reduce((acc, unit) => acc + (Number((unit as any).vs_mea) || Number(unit.mea) || 0), 0) || 0;
            const propertyQm = Number(property.total_qm) || 0;
            const propertyMea = Number(property.total_mea) || 0;
            
            const qmDiff = propertyQm - unitsQmSum;
            const meaDiff = propertyMea - unitsMeaSum;
            const hasQmMismatch = Math.abs(qmDiff) > 0.01;
            const hasMeaMismatch = Math.abs(meaDiff) > 0.01;
            
            if (hasQmMismatch || hasMeaMismatch) {
              return (
                <div className="rounded-xl border-2 border-destructive bg-destructive/10 p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-6 w-6 text-destructive flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <h4 className="font-semibold text-destructive mb-2">
                        Verteilerschlüssel nicht vollständig zugeordnet!
                      </h4>
                      <div className="space-y-1 text-sm">
                        {hasQmMismatch && (
                          <p className="text-destructive">
                            <strong>Quadratmeter:</strong> Liegenschaft hat {propertyQm.toLocaleString('de-AT')} m², 
                            aber nur {unitsQmSum.toLocaleString('de-AT')} m² sind auf Einheiten verteilt. 
                            <span className="font-bold"> Differenz: {qmDiff.toLocaleString('de-AT')} m²</span>
                          </p>
                        )}
                        {hasMeaMismatch && (
                          <p className="text-destructive">
                            <strong>MEA:</strong> Liegenschaft hat {propertyMea.toLocaleString('de-AT')}‰, 
                            aber nur {unitsMeaSum.toLocaleString('de-AT')}‰ sind auf Einheiten verteilt. 
                            <span className="font-bold"> Differenz: {meaDiff.toLocaleString('de-AT')}‰</span>
                          </p>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-2">
                        Bitte korrigieren Sie die Werte in den Einheiten oder passen Sie die Liegenschafts-Gesamtwerte an.
                      </p>
                    </div>
                  </div>
                </div>
              );
            }
            return null;
          })()}
          
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="font-semibold text-foreground mb-4">Verteilerschlüssel-Summen aller Einheiten</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Übersicht der aufsummierten Verteilerschlüssel aller {units?.length || 0} Einheiten dieser Liegenschaft.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { key: 'vs_qm', label: 'Quadratmeter', unit: 'm²', fallback: 'qm', propertyTotal: Number(property.total_qm) },
                { key: 'vs_mea', label: 'MEA', unit: '‰', fallback: 'mea', propertyTotal: Number(property.total_mea) },
                { key: 'vs_personen', label: 'Personenanzahl', unit: 'Pers.', fallback: null, propertyTotal: null },
                { key: 'vs_heizung_verbrauch', label: 'Heizungsverbrauch', unit: 'kWh', fallback: null, propertyTotal: null },
                { key: 'vs_wasser_verbrauch', label: 'Wasserverbrauch', unit: 'm³', fallback: null, propertyTotal: null },
                { key: 'vs_lift_wohnung', label: 'Lift Wohnung', unit: 'Anteil', fallback: null, propertyTotal: null },
                { key: 'vs_lift_geschaeft', label: 'Lift Geschäft', unit: 'Anteil', fallback: null, propertyTotal: null },
                { key: 'vs_muell', label: 'Müllentsorgung', unit: 'Anteil', fallback: null, propertyTotal: null },
                { key: 'vs_strom_allgemein', label: 'Allgemeinstrom', unit: 'Anteil', fallback: null, propertyTotal: null },
                { key: 'vs_versicherung', label: 'Versicherung', unit: 'Anteil', fallback: null, propertyTotal: null },
                { key: 'vs_hausbetreuung', label: 'Hausbetreuung', unit: 'Anteil', fallback: null, propertyTotal: null },
                { key: 'vs_garten', label: 'Gartenpflege', unit: 'Anteil', fallback: null, propertyTotal: null },
                { key: 'vs_schneeraeumung', label: 'Schneeräumung', unit: 'Anteil', fallback: null, propertyTotal: null },
                { key: 'vs_kanal', label: 'Kanalgebühren', unit: 'Anteil', fallback: null, propertyTotal: null },
                { key: 'vs_grundsteuer', label: 'Grundsteuer', unit: 'Anteil', fallback: null, propertyTotal: null },
                { key: 'vs_verwaltung', label: 'Verwaltungskosten', unit: 'Anteil', fallback: null, propertyTotal: null },
                { key: 'vs_ruecklage', label: 'Rücklage', unit: 'Anteil', fallback: null, propertyTotal: null },
                { key: 'vs_sonstiges_1', label: 'Sonstiges 1', unit: 'Anteil', fallback: null, propertyTotal: null },
                { key: 'vs_sonstiges_2', label: 'Sonstiges 2', unit: 'Anteil', fallback: null, propertyTotal: null },
                { key: 'vs_sonstiges_3', label: 'Sonstiges 3', unit: 'Anteil', fallback: null, propertyTotal: null },
              ].map((field) => {
                const sum = units?.reduce((acc, unit) => {
                  const value = (unit as any)[field.key] ?? (field.fallback ? (unit as any)[field.fallback] : 0);
                  return acc + (Number(value) || 0);
                }, 0) || 0;
                
                const hasMismatch = field.propertyTotal !== null && Math.abs(field.propertyTotal - sum) > 0.01;
                
                return (
                  <div
                    key={field.key}
                    className={cn(
                      "rounded-lg border p-3 transition-colors",
                      hasMismatch 
                        ? "border-destructive bg-destructive/5" 
                        : "border-border hover:bg-muted/30"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">{field.label}</p>
                      {hasMismatch && <AlertTriangle className="h-4 w-4 text-destructive" />}
                    </div>
                    <p className={cn(
                      "text-xl font-bold mt-1",
                      hasMismatch ? "text-destructive" : "text-foreground"
                    )}>
                      {field.key === 'vs_personen' 
                        ? sum.toLocaleString('de-AT')
                        : sum.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      <span className="text-sm font-normal text-muted-foreground ml-1">{field.unit}</span>
                    </p>
                    {field.propertyTotal !== null && (
                      <p className={cn(
                        "text-xs mt-1",
                        hasMismatch ? "text-destructive" : "text-muted-foreground"
                      )}>
                        Soll: {field.propertyTotal.toLocaleString('de-AT')} {field.unit}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          
          {/* Eigene Verteilerschlüssel */}
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-foreground">Eigene Verteilerschlüssel</h3>
                <p className="text-sm text-muted-foreground">
                  Definieren Sie eigene Verteilerschlüssel für diese Liegenschaft (z.B. Heizkreis A, Lift 1, etc.)
                </p>
              </div>
              <Dialog open={newKeyDialogOpen} onOpenChange={setNewKeyDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" data-testid="button-add-distribution-key">
                    <Plus className="h-4 w-4 mr-1" />
                    Neuer Schlüssel
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Neuen Verteilerschlüssel anlegen</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="keyCode">Schlüssel-Code</Label>
                        <Input
                          id="keyCode"
                          placeholder="z.B. heizkreis_a"
                          value={newKeyForm.keyCode}
                          onChange={(e) => setNewKeyForm(f => ({ ...f, keyCode: e.target.value }))}
                          data-testid="input-key-code"
                        />
                      </div>
                      <div>
                        <Label htmlFor="keyName">Name</Label>
                        <Input
                          id="keyName"
                          placeholder="z.B. Heizkreis A"
                          value={newKeyForm.name}
                          onChange={(e) => setNewKeyForm(f => ({ ...f, name: e.target.value }))}
                          data-testid="input-key-name"
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="keyDescription">Beschreibung (optional)</Label>
                      <Input
                        id="keyDescription"
                        placeholder="z.B. Heizkreislauf für Tops 1-5"
                        value={newKeyForm.description}
                        onChange={(e) => setNewKeyForm(f => ({ ...f, description: e.target.value }))}
                        data-testid="input-key-description"
                      />
                    </div>
                    <div>
                      <Label htmlFor="inputType">Berechnungsart</Label>
                      <Select
                        value={newKeyForm.inputType}
                        onValueChange={(v) => setNewKeyForm(f => ({ ...f, inputType: v }))}
                      >
                        <SelectTrigger data-testid="select-input-type">
                          <SelectValue placeholder="Berechnungsart wählen" />
                        </SelectTrigger>
                        <SelectContent>
                          {inputTypeOptions.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label} ({opt.unit})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Einbezogene Einheitstypen</Label>
                      <p className="text-xs text-muted-foreground mb-2">
                        Welche Einheitstypen werden bei dieser Kostenart berücksichtigt?
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {allUnitTypes.map(ut => (
                          <label key={ut.value} className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox
                              checked={newKeyForm.includedUnitTypes.includes(ut.value)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setNewKeyForm(f => ({ ...f, includedUnitTypes: [...f.includedUnitTypes, ut.value] }));
                                } else {
                                  setNewKeyForm(f => ({ ...f, includedUnitTypes: f.includedUnitTypes.filter(t => t !== ut.value) }));
                                }
                              }}
                              data-testid={`checkbox-unit-type-${ut.value}`}
                            />
                            {ut.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline">Abbrechen</Button>
                    </DialogClose>
                    <Button 
                      onClick={handleCreateDistributionKey}
                      disabled={!newKeyForm.keyCode || !newKeyForm.name || createDistributionKey.isPending}
                      data-testid="button-save-distribution-key"
                    >
                      {createDistributionKey.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                      Speichern
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            
            {isLoadingDistributionKeys ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : distributionKeys && distributionKeys.length > 0 ? (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Typ</TableHead>
                      <TableHead>Einheit</TableHead>
                      <TableHead>Einbezogene Einheiten</TableHead>
                      <TableHead className="text-right">Aktionen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {distributionKeys.map((key) => {
                      const unitTypes = ((key as any).includedUnitTypes || (key as any).included_unit_types) as string[] | null || ['wohnung', 'geschaeft', 'lager', 'garage', 'stellplatz', 'sonstiges'];
                      const unitTypeLabels: Record<string, string> = {
                        wohnung: 'Whg',
                        geschaeft: 'Gesch',
                        lager: 'Lager',
                        garage: 'Gar',
                        stellplatz: 'Stpl',
                        sonstiges: 'Sonst'
                      };
                      return (
                      <TableRow key={key.id} data-testid={`row-distribution-key-${key.id}`}>
                        <TableCell className="font-mono text-sm">{key.keyCode}</TableCell>
                        <TableCell>{key.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {inputTypeOptions.find(o => o.value === key.inputType)?.label || key.inputType}
                          </Badge>
                        </TableCell>
                        <TableCell>{key.unit}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {unitTypes.length === 6 ? (
                              <Badge variant="outline" className="text-xs">Alle</Badge>
                            ) : (
                              unitTypes.map(ut => (
                                <Badge key={ut} variant="outline" className="text-xs">{unitTypeLabels[ut] || ut}</Badge>
                              ))
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteDistributionKey.mutate(key.id)}
                            disabled={deleteDistributionKey.isPending}
                            data-testid={`button-delete-key-${key.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>Noch keine eigenen Verteilerschlüssel definiert.</p>
                <p className="text-sm">Klicken Sie auf "Neuer Schlüssel" um einen anzulegen.</p>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="costs" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-xl border border-border bg-card p-6">
              <h3 className="font-semibold text-foreground mb-4">Betriebskosten-Anteile</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Wohnung</span>
                  <Badge variant="secondary">{Number(property.bk_anteil_wohnung)}%</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Geschäft</span>
                  <Badge variant="secondary">{Number(property.bk_anteil_geschaeft)}%</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Garage</span>
                  <Badge variant="secondary">{Number(property.bk_anteil_garage)}%</Badge>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-6">
              <h3 className="font-semibold text-foreground mb-4">Heizkosten-Anteile</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Wohnung</span>
                  <Badge variant="secondary">{Number(property.heizung_anteil_wohnung)}%</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Geschäft</span>
                  <Badge variant="secondary">{Number(property.heizung_anteil_geschaeft)}%</Badge>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-6 md:col-span-2">
              <h3 className="font-semibold text-foreground mb-4">Jahreskosten gesamt</h3>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-3xl font-bold text-foreground">
                    €{Number(property.betriebskosten_gesamt).toLocaleString('de-AT')}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">Betriebskosten p.a.</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-foreground">
                    €{Number(property.heizungskosten_gesamt).toLocaleString('de-AT')}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">Heizungskosten p.a.</p>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="maintenance" className="space-y-4">
          {id && <MaintenanceContractsTab propertyId={id} />}
        </TabsContent>

        <TabsContent value="heating" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-foreground">Heizkostenabrechnung</h3>
              <p className="text-sm text-muted-foreground">Externe Heizkostendaten importieren (z.B. ISTA, Techem)</p>
            </div>
            <Button onClick={() => setHeatingImportOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              HK-Daten importieren
            </Button>
          </div>
          <div className="rounded-lg border bg-muted/50 p-8 text-center text-muted-foreground">
            <p>Importieren Sie Verbrauchsdaten Ihres Heizkosten-Ableseunternehmens per CSV oder manuelle Eingabe.</p>
          </div>
        </TabsContent>

        {/* MRG-Richtwert-Check Tab */}
        {isMietverwaltung && (
          <TabsContent value="mrg" className="space-y-4">
            <div>
              <h3 className="font-semibold text-foreground">MRG-Richtwert-Prüfung (§ 16 MRG)</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                Vergleich des aktuellen Mietzinses mit dem zulässigen Richtwert-Höchstmietzins pro Einheit
              </p>
            </div>

            {mrgCheckLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : activeTenantsForMrg.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-12 text-center">
                <Scale className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">Keine aktiven Mietverhältnisse vorhanden</p>
                <p className="text-sm text-muted-foreground mt-1">
                  MRG-Richtwert-Prüfungen sind nur für Einheiten mit aktivem Mieter möglich.
                </p>
              </div>
            ) : (
              <>
                {/* Zusammenfassungs-Kacheln */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl border bg-card p-4 flex items-center gap-3">
                    <CheckCircle2 className="h-8 w-8 text-green-500 flex-shrink-0" />
                    <div>
                      <p className="text-2xl font-bold text-foreground">{mrgSummary.ok}</p>
                      <p className="text-xs text-muted-foreground">Im Rahmen</p>
                    </div>
                  </div>
                  <div className="rounded-xl border bg-card p-4 flex items-center gap-3">
                    <AlertTriangle className="h-8 w-8 text-yellow-500 flex-shrink-0" />
                    <div>
                      <p className="text-2xl font-bold text-foreground">{mrgSummary.grenzwertig}</p>
                      <p className="text-xs text-muted-foreground">Grenzwertig (&ge;90 %)</p>
                    </div>
                  </div>
                  <div className="rounded-xl border bg-card p-4 flex items-center gap-3">
                    <XCircle className="h-8 w-8 text-red-500 flex-shrink-0" />
                    <div>
                      <p className="text-2xl font-bold text-foreground">{mrgSummary.ueberschritten}</p>
                      <p className="text-xs text-muted-foreground">Überschritten</p>
                    </div>
                  </div>
                </div>

                {/* Detailtabelle */}
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Top</TableHead>
                        <TableHead>Mieter</TableHead>
                        <TableHead className="text-right">Fläche</TableHead>
                        <TableHead className="text-right">Grundmiete</TableHead>
                        <TableHead className="text-right">Zul. Höchstmietzins</TableHead>
                        <TableHead className="text-right">Differenz</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mrgRows.map((row) => {
                        const statusConfig: Record<MrgStatus, { icon: ReactNode; label: string; className: string }> = {
                          ok: {
                            icon: <CheckCircle2 className="h-4 w-4 text-green-500" />,
                            label: 'Im Rahmen',
                            className: 'text-green-700 bg-green-50 border-green-200',
                          },
                          grenzwertig: {
                            icon: <AlertTriangle className="h-4 w-4 text-yellow-500" />,
                            label: 'Grenzwertig',
                            className: 'text-yellow-700 bg-yellow-50 border-yellow-200',
                          },
                          ueberschritten: {
                            icon: <XCircle className="h-4 w-4 text-red-500" />,
                            label: 'Überschritten',
                            className: 'text-red-700 bg-red-50 border-red-200',
                          },
                          nicht_anwendbar: {
                            icon: <MinusCircle className="h-4 w-4 text-muted-foreground" />,
                            label: 'Nicht anwendbar',
                            className: 'text-muted-foreground bg-muted border-border',
                          },
                        };
                        const cfg = statusConfig[row.status];
                        const hmz = row.check?.zulassigerHmz;
                        const differenz = row.check?.differenz ?? 0;
                        return (
                          <TableRow key={row.tenantId} className="hover:bg-muted/30">
                            <TableCell className="font-medium">{row.topNummer}</TableCell>
                            <TableCell>{row.tenantName}</TableCell>
                            <TableCell className="text-right">
                              {row.unitQm > 0
                                ? `${row.unitQm.toLocaleString('de-AT')} m²`
                                : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {row.grundmiete > 0
                                ? `€ ${row.grundmiete.toLocaleString('de-AT', { minimumFractionDigits: 2 })}`
                                : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-right">
                              {hmz != null
                                ? `€ ${hmz.toLocaleString('de-AT', { minimumFractionDigits: 2 })}`
                                : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-right">
                              {row.status === 'ueberschritten'
                                ? <span className="text-red-600 font-medium">
                                    +€ {differenz.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                                  </span>
                                : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-center">
                              <span className={cn(
                                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border',
                                cfg.className,
                              )}>
                                {cfg.icon}
                                {cfg.label}
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <p className="text-xs text-muted-foreground">
                  Grenzwertig: Grundmiete ≥ 90 % des zulässigen Richtwert-Höchstmietzinses.
                  Nicht anwendbar: Einheit hat keine Nutzfläche, kein Bundesland oder ist nicht als
                  Richtwert-Mietrecht eingestuft.
                </p>
              </>
            )}
          </TabsContent>
        )}

        <TabsContent value="documents" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground">
              Dokumente ({documents?.length || 0})
            </h3>
            <Button onClick={() => setUploadDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Dokument hochladen
            </Button>
          </div>
          
          {isLoadingDocuments ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <DocumentList
              documents={documents || []}
              documentTypes={PROPERTY_DOCUMENT_TYPES}
              onDelete={handleDeleteDocument}
              isDeleting={deleteDocument.isPending}
              emptyMessage="Noch keine Dokumente hochgeladen"
              emptyDescription="Laden Sie Energieausweis, Gebäudepläne und andere wichtige Dokumente hoch"
            />
          )}
        </TabsContent>
      </Tabs>

      <DocumentUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        documentTypes={PROPERTY_DOCUMENT_TYPES}
        onUpload={handleUploadDocument}
        isUploading={uploadDocument.isPending}
      />

      {id && units && (
        <>
          <UnitImportDialog
            open={unitImportDialogOpen}
            onOpenChange={setUnitImportDialogOpen}
            propertyId={id}
            existingUnits={units.map(u => ({ top_nummer: u.top_nummer }))}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['units', id] });
            }}
          />

          <TenantImportDialog
            open={tenantImportDialogOpen}
            onOpenChange={setTenantImportDialogOpen}
            propertyId={id}
            units={units.map(u => ({ id: u.id, top_nummer: u.top_nummer }))}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['units', id] });
              queryClient.invalidateQueries({ queryKey: ['tenants'] });
              queryClient.invalidateQueries({ queryKey: ['mrg-check'] });
            }}
          />

          <PdfScanDialog
            open={pdfScanDialogOpen}
            onOpenChange={setPdfScanDialogOpen}
            propertyId={id}
            units={units.map(u => ({ id: u.id, top_nummer: u.top_nummer }))}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['units', id] });
              queryClient.invalidateQueries({ queryKey: ['tenants'] });
              queryClient.invalidateQueries({ queryKey: ['mrg-check'] });
            }}
          />
          <HeatingCostImportDialog
            open={heatingImportOpen}
            onOpenChange={setHeatingImportOpen}
            propertyId={id}
          />
        </>
      )}
    </MainLayout>
  );
}
