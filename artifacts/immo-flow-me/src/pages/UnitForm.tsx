import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeft, Save, Loader2, Home, BarChart3, AlertTriangle, Scale } from 'lucide-react';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { useCreateUnit, useUnit, useUpdateUnit } from '@/hooks/useUnits';
import { useProperty } from '@/hooks/useProperties';
import { useDistributionKeys } from '@/hooks/useDistributionKeys';
import { useDistributionKeysWithValues, useSaveUnitDistributionValues, VS_COLUMN_TO_KEY_CODE } from '@/hooks/useUnitDistributionValues';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Validation schema
const unitSchema = z.object({
  top_nummer: z.string().min(1, 'Top-Nummer ist erforderlich').max(50, 'Max. 50 Zeichen'),
  qm: z.string().min(1, 'Nutzfläche ist erforderlich'),
  mea: z.string().min(1, 'MEA ist erforderlich'),
});

const unitTypes = [
  { value: 'wohnung', label: 'Wohnung' },
  { value: 'geschaeft', label: 'Geschäft' },
  { value: 'garage', label: 'Garage' },
  { value: 'stellplatz', label: 'Stellplatz' },
  { value: 'lager', label: 'Lager' },
  { value: 'sonstiges', label: 'Sonstiges' },
];

const mrgScopeOptions = [
  { value: 'vollanwendung', label: 'Vollanwendung', description: 'Altbau vor 1945/1953, voller Mieterschutz' },
  { value: 'teilanwendung', label: 'Teilanwendung', description: 'Neubauten mit bestimmten Schutzbestimmungen' },
  { value: 'ausgenommen', label: 'Ausgenommen', description: 'Nicht dem MRG unterliegend' },
];

const ausstattungsKategorien = [
  { value: 'A', label: 'Kategorie A', description: 'Mit Zentralheizung/Etagenheizung und Bad/WC' },
  { value: 'B', label: 'Kategorie B', description: 'Mit Bad/WC (mind. 1,5m²), ohne Heizung' },
  { value: 'C', label: 'Kategorie C', description: 'Mit WC und Wasserentnahme im Inneren' },
  { value: 'D', label: 'Kategorie D', description: 'Ohne WC oder Wasserentnahme' },
];

type UnitType = 'wohnung' | 'geschaeft' | 'garage' | 'stellplatz' | 'lager' | 'sonstiges';
type MrgScope = 'vollanwendung' | 'teilanwendung' | 'ausgenommen';
type Ausstattungskategorie = 'A' | 'B' | 'C' | 'D';

interface FormData {
  top_nummer: string;
  type: UnitType;
  floor: string;
  qm: string;
  mea: string;
  mrg_scope: MrgScope;
  ausstattungskategorie: Ausstattungskategorie;
  nutzflaeche_mrg: string;
  richtwertmiete_basis: string;
  leerstand_bk: string;
  leerstand_hk: string;
}

export default function UnitForm() {
  const { propertyId, unitId } = useParams();
  const navigate = useNavigate();
  const isEditing = !!unitId;

  const { data: property } = useProperty(propertyId);
  const { data: existingUnit, isLoading: isLoadingUnit } = useUnit(unitId);
  const { data: distributionKeys, isLoading: isLoadingKeys } = useDistributionKeys();
  const { data: keysWithValues } = useDistributionKeysWithValues(unitId);
  const createUnit = useCreateUnit();
  const updateUnit = useUpdateUnit();
  const saveDistributionValues = useSaveUnitDistributionValues();
  
  const [validationError, setValidationError] = useState<string | null>(null);

  // Basic form data
  const [formData, setFormData] = useState<FormData>({
    top_nummer: '',
    type: 'wohnung',
    floor: '',
    qm: '',
    mea: '',
    mrg_scope: 'vollanwendung',
    ausstattungskategorie: 'A',
    nutzflaeche_mrg: '',
    richtwertmiete_basis: '',
    leerstand_bk: '',
    leerstand_hk: '',
  });

  // Distribution key values stored separately by key_id
  const [distributionValues, setDistributionValues] = useState<Record<string, string>>({});

  // Load existing unit data
  useEffect(() => {
    if (existingUnit) {
      setFormData({
        top_nummer: existingUnit.topNummer || '',
        type: existingUnit.type || 'wohnung',
        floor: (existingUnit as any).floor?.toString() || '',
        qm: (existingUnit as any).qm?.toString() || '',
        mea: (existingUnit as any).mea?.toString() || '',
        mrg_scope: (existingUnit as any).mrg_scope || 'vollanwendung',
        ausstattungskategorie: (existingUnit as any).ausstattungskategorie || 'A',
        nutzflaeche_mrg: (existingUnit as any).nutzflaeche_mrg?.toString() || '',
        richtwertmiete_basis: (existingUnit as any).richtwertmiete_basis?.toString() || '',
        leerstand_bk: (existingUnit as any).leerstandBk?.toString() || '',
        leerstand_hk: (existingUnit as any).leerstandHk?.toString() || '',
      });
    }
  }, [existingUnit]);

  // Load distribution values when keysWithValues is available
  useEffect(() => {
    if (keysWithValues && keysWithValues.length > 0) {
      const values: Record<string, string> = {};
      keysWithValues.forEach(key => {
        values[key.id] = key.value?.toString() || '';
      });
      setDistributionValues(values);
    }
  }, [keysWithValues]);

  // For new units or units without distribution values, try to get values from legacy vs_* columns
  useEffect(() => {
    if (existingUnit && distributionKeys && distributionKeys.length > 0 && !keysWithValues?.some(k => k.value > 0)) {
      const values: Record<string, string> = {};
      
      distributionKeys.forEach(key => {
        // Find which vs_* column maps to this key_code
        const vsColumn = Object.entries(VS_COLUMN_TO_KEY_CODE).find(([_, code]) => code === key.keyCode)?.[0];
        if (vsColumn && existingUnit[vsColumn as keyof typeof existingUnit] !== undefined) {
          const legacyValue = existingUnit[vsColumn as keyof typeof existingUnit];
          if (legacyValue && legacyValue !== 0) {
            values[key.id] = legacyValue.toString();
          }
        }
      });
      
      if (Object.keys(values).length > 0) {
        setDistributionValues(prev => ({ ...prev, ...values }));
      }
    }
  }, [existingUnit, distributionKeys, keysWithValues]);

  // Auto-sync qm and mea to distribution keys when they change
  useEffect(() => {
    if (formData.qm && distributionKeys) {
      const qmKey = distributionKeys.find(k => k.keyCode === 'qm');
      if (qmKey && !distributionValues[qmKey.id]) {
        setDistributionValues(prev => ({ ...prev, [qmKey.id]: formData.qm }));
      }
    }
  }, [formData.qm, distributionKeys]);

  useEffect(() => {
    if (formData.mea && distributionKeys) {
      const meaKey = distributionKeys.find(k => k.keyCode === 'mea');
      if (meaKey && !distributionValues[meaKey.id]) {
        setDistributionValues(prev => ({ ...prev, [meaKey.id]: formData.mea }));
      }
    }
  }, [formData.mea, distributionKeys]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setValidationError(null);
  };

  const handleDistributionValueChange = (keyId: string, value: string) => {
    setDistributionValues(prev => ({ ...prev, [keyId]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    
    // Validate form data
    const result = unitSchema.safeParse(formData);
    if (!result.success) {
      setValidationError(result.error.errors[0].message);
      return;
    }

    // Prepare unit data (basic fields + MRG fields + Leerstand)
    const unitData: any = {
      property_id: propertyId!,
      top_nummer: formData.top_nummer.trim(),
      type: formData.type,
      floor: formData.floor ? parseInt(formData.floor) : null,
      qm: parseFloat(formData.qm) || 0,
      mea: parseFloat(formData.mea) || 0,
      mrg_scope: formData.mrg_scope,
      ausstattungskategorie: formData.ausstattungskategorie,
      nutzflaeche_mrg: formData.nutzflaeche_mrg ? parseFloat(formData.nutzflaeche_mrg) : parseFloat(formData.qm) || 0,
      richtwertmiete_basis: formData.richtwertmiete_basis ? parseFloat(formData.richtwertmiete_basis) : 0,
      leerstand_bk: formData.leerstand_bk ? parseFloat(formData.leerstand_bk) : 0,
      leerstand_hk: formData.leerstand_hk ? parseFloat(formData.leerstand_hk) : 0,
    };

    // Also update legacy vs_* columns for backward compatibility
    if (distributionKeys) {
      distributionKeys.forEach(key => {
        const vsColumn = Object.entries(VS_COLUMN_TO_KEY_CODE).find(([_, code]) => code === key.keyCode)?.[0];
        if (vsColumn) {
          const value = distributionValues[key.id];
          if (key.inputType === 'anzahl') {
            unitData[vsColumn] = value ? parseInt(value) : 0;
          } else {
            unitData[vsColumn] = value ? parseFloat(value) : 0;
          }
        }
      });
    }

    try {
      let savedUnitId = unitId;
      
      if (isEditing && unitId) {
        await updateUnit.mutateAsync({ id: unitId, ...unitData });
      } else {
        const newUnit = await createUnit.mutateAsync(unitData);
        savedUnitId = newUnit.id;
      }

      // Save distribution values to the new table
      if (savedUnitId && distributionKeys) {
        const valuesToSave = distributionKeys
          .filter(key => key.isActive)
          .map(key => ({
            keyId: key.id,
            value: distributionValues[key.id] ? parseFloat(distributionValues[key.id]) : 0,
          }));

        await saveDistributionValues.mutateAsync({
          unitId: savedUnitId,
          values: valuesToSave,
        });
      }

      navigate(`/liegenschaften/${propertyId}`);
    } catch (error) {
      // Error handling is done in the hooks
    }
  };

  const getInputStep = (inputType: string) => {
    switch (inputType) {
      case 'anzahl':
        return '1';
      case 'qm':
      case 'mea':
      case 'promille':
      case 'direkteingabe':
      default:
        return '0.01';
    }
  };

  const isSubmitting = createUnit.isPending || updateUnit.isPending || saveDistributionValues.isPending;
  const isLoading = isLoadingUnit || isLoadingKeys;

  // Get only active distribution keys for display
  const activeDistributionKeys = distributionKeys?.filter(k => k.isActive) || [];

  if (isEditing && isLoading) {
    return (
      <MainLayout title="Laden..." subtitle="">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout
      title={isEditing ? 'Einheit bearbeiten' : 'Neue Einheit'}
      subtitle={property?.name || ''}
    >
      <div className="mb-6">
        <Link
          to={`/liegenschaften/${propertyId}`}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Zurück zur Liegenschaft
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Validation Error */}
        {validationError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{validationError}</AlertDescription>
          </Alert>
        )}

        {/* Basic Unit Data */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Home className="h-5 w-5" />
              Einheitsdaten
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="top_nummer">Top-Nummer *</Label>
                <Input
                  id="top_nummer"
                  name="top_nummer"
                  value={formData.top_nummer}
                  onChange={handleChange}
                  placeholder="z.B. Top 1, Garage 2"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="type">Typ *</Label>
                <Select
                  value={formData.type}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, type: value as UnitType }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Typ wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {unitTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="floor">Stockwerk</Label>
                <Input
                  id="floor"
                  name="floor"
                  type="number"
                  value={formData.floor}
                  onChange={handleChange}
                  placeholder="z.B. 0, 1, -1"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="qm" className="flex items-center">
                  Nutzfläche (m²) *
                  <InfoTooltip text="qm" />
                </Label>
                <Input
                  id="qm"
                  name="qm"
                  type="number"
                  step="0.01"
                  value={formData.qm}
                  onChange={handleChange}
                  placeholder="z.B. 78.50"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mea" className="flex items-center">
                  MEA (‰) *
                  <InfoTooltip text="mea" />
                </Label>
                <Input
                  id="mea"
                  name="mea"
                  type="number"
                  step="0.01"
                  value={formData.mea}
                  onChange={handleChange}
                  placeholder="z.B. 79"
                  required
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* MRG Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5" />
              MRG-Einstellungen (Mietrechtsgesetz)
            </CardTitle>
            <CardDescription>
              Rechtliche Einordnung dieser Einheit nach dem österreichischen Mietrechtsgesetz
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* MRG Anwendungsbereich */}
              <div className="space-y-2">
                <Label htmlFor="mrg_scope" className="flex items-center">
                  MRG-Anwendungsbereich
                  <InfoTooltip text="mrg_scope" />
                </Label>
                <Select
                  value={formData.mrg_scope}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, mrg_scope: value as MrgScope }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Anwendungsbereich wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {mrgScopeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <div>
                          <span className="font-medium">{option.label}</span>
                          <span className="text-muted-foreground ml-2 text-xs">– {option.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Ausstattungskategorie */}
              <div className="space-y-2">
                <Label htmlFor="ausstattungskategorie" className="flex items-center">
                  Ausstattungskategorie (§15a MRG)
                  <InfoTooltip text="ausstattungskategorie" />
                </Label>
                <Select
                  value={formData.ausstattungskategorie}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, ausstattungskategorie: value as Ausstattungskategorie }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Kategorie wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {ausstattungsKategorien.map((kat) => (
                      <SelectItem key={kat.value} value={kat.value}>
                        <div>
                          <span className="font-medium">{kat.label}</span>
                          <span className="text-muted-foreground ml-2 text-xs">– {kat.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Nutzfläche nach §17 MRG */}
              <div className="space-y-2">
                <Label htmlFor="nutzflaeche_mrg" className="flex items-center">
                  Nutzfläche nach §17 MRG (m²)
                  <InfoTooltip text="nutzflaeche_mrg" />
                </Label>
                <Input
                  id="nutzflaeche_mrg"
                  name="nutzflaeche_mrg"
                  type="number"
                  step="0.01"
                  value={formData.nutzflaeche_mrg}
                  onChange={handleChange}
                  placeholder={formData.qm || 'Wie oben'}
                />
                <p className="text-xs text-muted-foreground">
                  Leer lassen = automatisch von Nutzfläche übernehmen
                </p>
              </div>

              {/* Richtwertmiete Basis */}
              <div className="space-y-2">
                <Label htmlFor="richtwertmiete_basis" className="flex items-center">
                  Richtwert-Basis (€/m²) — nur Erfassung
                  <InfoTooltip text="Nur Dateneingabe — das System prüft NICHT automatisch ob die tatsächliche Miete den zulässigen Höchstmietzins übersteigt. Zur Prüfung: Menü → Mietzinsrechner." />
                </Label>
                <Input
                  id="richtwertmiete_basis"
                  name="richtwertmiete_basis"
                  type="number"
                  step="0.01"
                  value={formData.richtwertmiete_basis}
                  onChange={handleChange}
                  placeholder="z.B. 6.67"
                />
                <p className="text-xs text-muted-foreground">
                  Wien 2025/2026: €6,67/m² — Nur Erfassung. Keine automatische Zulässigkeitsprüfung.
                  Den Mietzinsrechner verwenden um zu prüfen ob die Miete den gesetzlichen Rahmen einhält.
                </p>
              </div>
            </div>

            {/* MRG Info Box */}
            {formData.mrg_scope === 'vollanwendung' && (
              <Alert className="mt-4 border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
                <Scale className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-blue-800 dark:text-blue-200">
                  <strong>Vollanwendung MRG:</strong> Es gelten strenge Mieterschutzbestimmungen, 
                  Richtwertmiete, §14 Erhaltungsbeiträge und die BK-Abrechnung muss §21-24 MRG entsprechen.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Leerstand-Kosten (Owner pays when vacant) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Home className="h-5 w-5" />
              Leerstand-Kosten
            </CardTitle>
            <CardDescription>
              Bei Leerstand werden diese Kosten dem Eigentümer vorgeschrieben (BK/HK ohne Miete)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="leerstand_bk">
                  Betriebskosten bei Leerstand (€/Monat)
                </Label>
                <Input
                  id="leerstand_bk"
                  name="leerstand_bk"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.leerstand_bk}
                  onChange={handleChange}
                  placeholder="z.B. 85.00"
                  data-testid="input-leerstand-bk"
                />
                <p className="text-xs text-muted-foreground">
                  BK-Vorschuss der bei Leerstand dem Eigentümer zugeordnet wird
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="leerstand_hk">
                  Heizkosten bei Leerstand (€/Monat)
                </Label>
                <Input
                  id="leerstand_hk"
                  name="leerstand_hk"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.leerstand_hk}
                  onChange={handleChange}
                  placeholder="z.B. 45.00"
                  data-testid="input-leerstand-hk"
                />
                <p className="text-xs text-muted-foreground">
                  HK-Vorschuss der bei Leerstand dem Eigentümer zugeordnet wird
                </p>
              </div>
            </div>

            <Alert className="mt-4 border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950">
              <AlertTriangle className="h-4 w-4 text-orange-600" />
              <AlertDescription className="text-orange-800 dark:text-orange-200">
                <strong>MRG §21:</strong> Bei Leerstand trägt der Eigentümer die anteiligen Betriebskosten 
                und Heizkosten. Diese Werte werden für die Vorschreibung bei Status "Leerstand" verwendet.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        {/* Distribution Keys - Dynamic from Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Verteilerschlüssel ({activeDistributionKeys.length} aktive Schlüssel)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Geben Sie die Werte für die Betriebskostenverteilung dieser Einheit ein. 
              Die Schlüssel können in den Einstellungen konfiguriert werden.
            </p>
            {isLoadingKeys ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : activeDistributionKeys.length === 0 ? (
              <Alert>
                <AlertDescription>
                  Keine aktiven Verteilerschlüssel gefunden. Bitte konfigurieren Sie diese in den Einstellungen.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {activeDistributionKeys.map((key) => (
                  <div key={key.id} className="space-y-2">
                    <Label htmlFor={`dist-${key.id}`} className="text-sm">
                      {key.name}
                      <span className="text-muted-foreground ml-1">({key.unit})</span>
                    </Label>
                    <Input
                      id={`dist-${key.id}`}
                      type="number"
                      step={getInputStep(key.inputType)}
                      min="0"
                      value={distributionValues[key.id] || ''}
                      onChange={(e) => handleDistributionValueChange(key.id, e.target.value)}
                      placeholder="0"
                    />
                    {key.description && (
                      <p className="text-xs text-muted-foreground">{key.description}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(`/liegenschaften/${propertyId}`)}
          >
            Abbrechen
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Speichern...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                {isEditing ? 'Aktualisieren' : 'Erstellen'}
              </>
            )}
          </Button>
        </div>
      </form>
    </MainLayout>
  );
}
