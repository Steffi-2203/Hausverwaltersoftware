import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Save, Loader2, AlertTriangle, Building2, Users, Home } from 'lucide-react';
import { useProperty, useCreateProperty, useUpdateProperty } from '@/hooks/useProperties';
import { toast } from 'sonner';
import { z } from 'zod';

/** Alle 9 österreichischen Bundesländer (Richtwert nach § 5 RichtWG) */
const BUNDESLAENDER = [
  { value: 'wien',             label: 'Wien' },
  { value: 'niederoesterreich', label: 'Niederösterreich' },
  { value: 'oberoesterreich',  label: 'Oberösterreich' },
  { value: 'steiermark',       label: 'Steiermark' },
  { value: 'tirol',            label: 'Tirol' },
  { value: 'salzburg',         label: 'Salzburg' },
  { value: 'kaernten',         label: 'Kärnten' },
  { value: 'vorarlberg',       label: 'Vorarlberg' },
  { value: 'burgenland',       label: 'Burgenland' },
];

const MIETRECHT_TYPEN = [
  { value: 'richtwert', label: 'Richtwertmiete (§ 16 Abs. 2 MRG)' },
  { value: 'kategorie', label: 'Kategoriemiete (§ 16 Abs. 1 MRG)' },
  { value: 'frei',      label: 'Freier Markt (kein MRG-Höchstmietzins)' },
];

const propertySchema = z.object({
  name: z.string().min(1, 'Bezeichnung ist erforderlich').max(100, 'Max. 100 Zeichen'),
  address: z.string().min(1, 'Adresse ist erforderlich').max(200, 'Max. 200 Zeichen'),
  city: z.string().min(1, 'Stadt ist erforderlich').max(100, 'Max. 100 Zeichen'),
  postal_code: z.string().min(1, 'PLZ ist erforderlich').max(20, 'Max. 20 Zeichen'),
  management_type: z.enum(['mietverwaltung', 'weg'], { required_error: 'Verwaltungsart ist erforderlich' }),
});

export default function PropertyForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEditing = !!id;
  
  const { data: existingProperty, isLoading: isLoadingProperty } = useProperty(id);
  const createProperty = useCreateProperty();
  const updateProperty = useUpdateProperty();
  
  const [validationError, setValidationError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    city: '',
    postal_code: '',
    management_type: '' as '' | 'mietverwaltung' | 'weg',
    building_year: '',
    total_qm: '',
    notes: '',
    bundesland: '' as string,
    mietrecht_typ: '' as string,
  });

  useEffect(() => {
    if (existingProperty) {
      setFormData({
        name: existingProperty.name || '',
        address: existingProperty.address || '',
        city: existingProperty.city || '',
        postal_code: existingProperty.postal_code || existingProperty.postalCode || '',
        management_type: existingProperty.management_type || existingProperty.managementType || 'mietverwaltung',
        building_year: (existingProperty.building_year || existingProperty.constructionYear || '').toString(),
        total_qm: (existingProperty.total_qm || existingProperty.totalArea || '').toString(),
        notes: existingProperty.notes || '',
        bundesland: (existingProperty as any).bundesland || '',
        mietrecht_typ: (existingProperty as any).mietrechtTyp || (existingProperty as any).mietrecht_typ || '',
      });
    }
  }, [existingProperty]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setValidationError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    
    if (!formData.management_type) {
      setValidationError('Bitte wählen Sie die Verwaltungsart (Mietverwaltung oder WEG).');
      return;
    }
    
    const result = propertySchema.safeParse(formData);
    if (!result.success) {
      setValidationError(result.error.errors[0].message);
      return;
    }
    
    const propertyData: any = {
      name: formData.name.trim(),
      address: formData.address.trim(),
      city: formData.city.trim(),
      postal_code: formData.postal_code.trim(),
      management_type: formData.management_type,
      building_year: formData.building_year ? parseInt(formData.building_year) : null,
      total_qm: parseFloat(formData.total_qm) || 0,
      notes: formData.notes.trim() || null,
      bundesland: formData.bundesland || null,
      mietrecht_typ: formData.mietrecht_typ || null,
    };

    try {
      if (isEditing && id) {
        await updateProperty.mutateAsync({ id, ...propertyData });
        navigate('/liegenschaften');
      } else {
        const newProperty = await createProperty.mutateAsync(propertyData);
        if (newProperty?.id) {
          navigate(`/liegenschaften/${newProperty.id}`);
        } else {
          navigate('/liegenschaften');
        }
      }
    } catch (error) {
    }
  };

  const isSubmitting = createProperty.isPending || updateProperty.isPending;

  if (isEditing && isLoadingProperty) {
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
      title={isEditing ? 'Liegenschaft bearbeiten' : 'Neue Liegenschaft'}
      subtitle={isEditing ? existingProperty?.name : 'Erfassen Sie eine neue Immobilie'}
    >
      <div className="mb-6">
        <Link
          to="/liegenschaften"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Zurück zur Übersicht
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {validationError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{validationError}</AlertDescription>
          </Alert>
        )}

        <div className="rounded-xl border-2 border-primary/30 bg-card p-6">
          <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Verwaltungsart *
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Wählen Sie, ob es sich um eine Mietverwaltung oder eine WEG-Verwaltung handelt. Diese Auswahl bestimmt die verfügbaren Funktionen.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card
              className={`cursor-pointer transition-all ${formData.management_type === 'mietverwaltung' ? 'ring-2 ring-primary bg-primary/5' : 'hover-elevate'}`}
              onClick={() => { setFormData(prev => ({ ...prev, management_type: 'mietverwaltung' })); setValidationError(null); }}
              data-testid="card-select-mietverwaltung"
            >
              <CardContent className="p-4 flex items-start gap-4">
                <div className={`rounded-lg p-2 ${formData.management_type === 'mietverwaltung' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                  <Home className="h-6 w-6" />
                </div>
                <div>
                  <p className="font-semibold">Mietverwaltung</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Verwaltung von Mietobjekten mit Mietverträgen, Vorschreibungen (Miete, BK, Heizung), Mahnwesen und MRG-Compliance.
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card
              className={`cursor-pointer transition-all ${formData.management_type === 'weg' ? 'ring-2 ring-primary bg-primary/5' : 'hover-elevate'}`}
              onClick={() => { setFormData(prev => ({ ...prev, management_type: 'weg' })); setValidationError(null); }}
              data-testid="card-select-weg"
            >
              <CardContent className="p-4 flex items-start gap-4">
                <div className={`rounded-lg p-2 ${formData.management_type === 'weg' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                  <Users className="h-6 w-6" />
                </div>
                <div>
                  <p className="font-semibold">WEG-Verwaltung</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Wohnungseigentumsverwaltung mit Eigentümer-Vorschreibungen (BK, Rücklage, Instandhaltung), MEA-Verteilung und Wirtschaftsplan.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
          {!formData.management_type && (
            <p className="text-sm text-destructive mt-2">Bitte wählen Sie eine Verwaltungsart.</p>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="font-semibold text-foreground mb-4">Grunddaten</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Bezeichnung *</Label>
              <Input
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="z.B. Mozartstraße 15"
                required
                data-testid="input-property-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Adresse *</Label>
              <Input
                id="address"
                name="address"
                value={formData.address}
                onChange={handleChange}
                placeholder="Straße und Hausnummer"
                required
                data-testid="input-property-address"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="postal_code">PLZ *</Label>
              <Input
                id="postal_code"
                name="postal_code"
                value={formData.postal_code}
                onChange={handleChange}
                placeholder="z.B. 1040"
                required
                data-testid="input-property-postalCode"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">Stadt *</Label>
              <Input
                id="city"
                name="city"
                value={formData.city}
                onChange={handleChange}
                placeholder="z.B. Wien"
                required
                data-testid="input-property-city"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="building_year">Baujahr</Label>
              <Input
                id="building_year"
                name="building_year"
                type="number"
                value={formData.building_year}
                onChange={handleChange}
                placeholder="z.B. 1965"
                data-testid="input-property-buildingYear"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="total_qm">Gesamtfläche (m²)</Label>
              <Input
                id="total_qm"
                name="total_qm"
                type="number"
                step="0.01"
                value={formData.total_qm}
                onChange={handleChange}
                placeholder="z.B. 985.50"
                data-testid="input-property-totalQm"
              />
            </div>
          </div>
        </div>

        {/* MRG-Felder: Bundesland und Mietrechtstyp (nur für Mietverwaltung relevant) */}
        {formData.management_type === 'mietverwaltung' && (
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="font-semibold text-foreground mb-1">Mietrecht (MRG)</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Bundesland und Mietrechtstyp bestimmen den gesetzlichen Richtwertmietzins (§ 5 RichtWG).
              Nur erforderlich wenn das MRG auf diese Liegenschaft zutrifft.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bundesland">Bundesland</Label>
                <Select
                  value={formData.bundesland || '__none__'}
                  onValueChange={(val) =>
                    setFormData(prev => ({ ...prev, bundesland: val === '__none__' ? '' : val }))
                  }
                >
                  <SelectTrigger id="bundesland" data-testid="select-bundesland">
                    <SelectValue placeholder="Bundesland wählen…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— kein Bundesland —</SelectItem>
                    {BUNDESLAENDER.map(b => (
                      <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mietrecht_typ">Mietrechtstyp</Label>
                <Select
                  value={formData.mietrecht_typ || '__none__'}
                  onValueChange={(val) =>
                    setFormData(prev => ({ ...prev, mietrecht_typ: val === '__none__' ? '' : val }))
                  }
                >
                  <SelectTrigger id="mietrecht_typ" data-testid="select-mietrecht-typ">
                    <SelectValue placeholder="Mietrechtstyp wählen…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— nicht festgelegt —</SelectItem>
                    {MIETRECHT_TYPEN.map(m => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {formData.mietrecht_typ === 'richtwert' && !formData.bundesland && (
              <p className="mt-2 text-sm text-amber-600 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                Bitte Bundesland angeben — ohne Bundesland kann kein Richtwert berechnet werden.
              </p>
            )}
          </div>
        )}

        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="font-semibold text-foreground mb-4">Notizen</h3>
          <Textarea
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            placeholder="Optionale Bemerkungen zur Liegenschaft..."
            rows={3}
            data-testid="input-property-notes"
          />
        </div>

        {formData.management_type === 'weg' && (
          <Alert>
            <Users className="h-4 w-4" />
            <AlertDescription>
              Nach dem Anlegen können Sie unter <strong>WEG-Verwaltung</strong> Eigentümer zuordnen, MEA-Anteile festlegen und den Wirtschaftsplan erstellen. Die WEG-Vorschreibungen (BK, Rücklage, Instandhaltung, Verwaltungshonorar) werden daraus automatisch berechnet.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-end gap-4">
          <Button type="button" variant="outline" onClick={() => navigate('/liegenschaften')} data-testid="button-cancel-property">
            Abbrechen
          </Button>
          <Button type="submit" disabled={isSubmitting || !formData.management_type} data-testid="button-save-property">
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