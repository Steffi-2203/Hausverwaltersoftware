import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Loader2, Save, User, Euro, CreditCard, Calendar, Plus, Trash2, BarChart3, Clock } from 'lucide-react';
import { useUnit } from '@/hooks/useUnits';
import { useProperty } from '@/hooks/useProperties';
import { useTenant, useCreateTenant, useUpdateTenant } from '@/hooks/useTenants';
import { useDistributionKeysByProperty } from '@/hooks/useDistributionKeys';
import { format } from 'date-fns';
import { InfoTooltip } from '@/components/ui/InfoTooltip';

interface SonstigeKostenPosition {
  name: string;
  betrag: number;
  ust: number;
  schluessel: string;
}

/**
 * GET /api/tenants/:id gibt zusätzlich zu den Tenant-Spalten auch
 * gemergete Lease-Felder zurück (befristet, befristungEnde, lagezuschlag,
 * abschlaege, wasserkostenVorschuss, sonstigeKosten). Diese kommen nicht
 * aus dem Drizzle-Schema-Typ, daher eigene Interface-Erweiterung.
 */
interface TenantApiResponse {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  mietbeginn?: string | null;
  mietende?: string | null;
  kaution?: string | number | null;
  kautionBezahlt?: boolean;
  grundmiete?: string | number | null;
  betriebskostenVorschuss?: string | number | null;
  heizkostenVorschuss?: string | number | null;
  wasserkostenVorschuss?: string | number | null;
  sepaMandat?: boolean;
  iban?: string | null;
  bic?: string | null;
  status?: string;
  // Lease-gemergete Felder
  befristet?: boolean;
  befristungEnde?: string | null;
  befristung_ende?: string | null;
  lagezuschlag?: number | string | null;
  abschlaege?: number | string | null;
  sonstigeKosten?: Record<string, { betrag?: number | string; ust?: number; schluessel?: string }> | null;
}

// Preprocessor for optional MRG €/m² fields (§ 16 Abs. 2 MRG):
// empty string / null / undefined → null; numeric string → number.
function mrgEurM2(direction: 'positive' | 'negative', label: string) {
  const preprocess = (v: unknown) =>
    v === '' || v === null || v === undefined ? null : Number(v);
  if (direction === 'positive') {
    return z.preprocess(
      preprocess,
      z.number({ invalid_type_error: `${label} muss eine Zahl sein` })
        .min(0, `${label} muss ≥ 0 €/m² sein`)
        .nullable()
    );
  }
  return z.preprocess(
    preprocess,
    z.number({ invalid_type_error: `${label} muss eine Zahl sein` })
      .max(0, `${label} muss ≤ 0 €/m² sein`)
      .nullable()
  );
}

const tenantSchema = z.object({
  first_name: z.string().trim().min(1, 'Vorname ist erforderlich').max(100),
  last_name: z.string().trim().min(1, 'Nachname ist erforderlich').max(100),
  email: z.string().trim().email('Ungültige E-Mail-Adresse').max(255).optional().or(z.literal('')),
  phone: z.string().trim().max(50).optional().or(z.literal('')),
  mietbeginn: z.string().min(1, 'Mietbeginn ist erforderlich'),
  mietende: z.string().optional().or(z.literal('')),
  befristet: z.boolean().default(false),
  befristung_ende: z.string().optional().or(z.literal('')),
  kaution: z.coerce.number().min(0, 'Kaution muss positiv sein'),
  kaution_bezahlt: z.boolean(),
  grundmiete: z.coerce.number().min(0, 'Grundmiete muss positiv sein'),
  betriebskosten_vorschuss: z.coerce.number().min(0, 'BK-Vorschuss muss positiv sein'),
  heizungskosten_vorschuss: z.coerce.number().min(0, 'Heizungskosten-Vorschuss muss positiv sein'),
  wasserkosten_vorschuss: z.coerce.number().min(0, 'Wasserkosten-Vorschuss muss positiv sein'),
  // MRG § 16 Abs. 2: Lagezuschlag/Abschläge in €/m² — nur bei mietrecht_typ='richtwert'
  lagezuschlag: mrgEurM2('positive',  'Lagezuschlag'),
  abschlaege:   mrgEurM2('negative',  'Abschläge'),
  sepa_mandat: z.boolean(),
  iban: z.string().trim().max(34).optional().or(z.literal('')),
  bic: z.string().trim().max(11).optional().or(z.literal('')),
  mandat_reference: z.string().trim().max(35).optional().or(z.literal('')),
  status: z.enum(['aktiv', 'leerstand', 'beendet']),
}).refine(
  (data) => !data.befristet || !!data.befristung_ende,
  { message: 'Befristungsdatum ist erforderlich wenn der Vertrag befristet ist', path: ['befristung_ende'] }
);

type TenantFormData = z.infer<typeof tenantSchema>;

export default function TenantForm() {
  const { unitId, tenantId, propertyId } = useParams();
  const navigate = useNavigate();
  const isEditing = !!tenantId;

  const { data: unit, isLoading: isLoadingUnit } = useUnit(unitId);
  const { data: property, isLoading: isLoadingProperty } = useProperty(propertyId || unit?.propertyId);
  const { data: tenant, isLoading: isLoadingTenant } = useTenant(tenantId);
  const createTenant = useCreateTenant();
  const updateTenant = useUpdateTenant();
  
  const effectivePropertyId = propertyId || unit?.propertyId;
  const { data: distributionKeys } = useDistributionKeysByProperty(effectivePropertyId);
  
  const [sonstigeKosten, setSonstigeKosten] = useState<SonstigeKostenPosition[]>([]);
  
  useEffect(() => {
    const t = tenant as TenantApiResponse | undefined;
    if (t?.sonstigeKosten && typeof t.sonstigeKosten === 'object') {
      const positions: SonstigeKostenPosition[] = [];
      const sk = t.sonstigeKosten;
      for (const [name, item] of Object.entries(sk)) {
        if (item && item.betrag !== undefined) {
          positions.push({
            name,
            betrag: typeof item.betrag === 'string' ? parseFloat(item.betrag) : Number(item.betrag),
            ust: Number(item.ust || 10),
            schluessel: item.schluessel || '',
          });
        }
      }
      setSonstigeKosten(positions);
    }
  }, [tenant]);

  const form = useForm<TenantFormData>({
    resolver: zodResolver(tenantSchema),
    defaultValues: {
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      mietbeginn: format(new Date(), 'yyyy-MM-dd'),
      mietende: '',
      befristet: false,
      befristung_ende: '',
      kaution: 0,
      kaution_bezahlt: false,
      grundmiete: 0,
      betriebskosten_vorschuss: 0,
      heizungskosten_vorschuss: 0,
      wasserkosten_vorschuss: 0,
      lagezuschlag: null,
      abschlaege: null,
      sepa_mandat: false,
      iban: '',
      bic: '',
      mandat_reference: '',
      status: 'aktiv',
    },
    values: (() => {
      if (!tenant) return undefined;
      const t = tenant as TenantApiResponse;
      return {
        first_name: t.firstName,
        last_name: t.lastName,
        email: t.email || '',
        phone: t.phone || '',
        mietbeginn: tenant.mietbeginn || '',
        mietende: tenant.mietende || '',
        befristet: t.befristet ?? false,
        befristung_ende: t.befristungEnde ?? t.befristung_ende ?? '',
        kaution: Number(tenant.kaution || 0),
        kaution_bezahlt: tenant.kautionBezahlt || false,
        grundmiete: Number(tenant.grundmiete || 0),
        betriebskosten_vorschuss: Number(tenant.betriebskostenVorschuss || 0),
        heizungskosten_vorschuss: Number(tenant.heizkostenVorschuss || 0),
        wasserkosten_vorschuss: Number(t.wasserkostenVorschuss || 0),
        lagezuschlag: t.lagezuschlag != null ? Number(t.lagezuschlag) : null,
        abschlaege:   t.abschlaege   != null ? Number(t.abschlaege)   : null,
        sepa_mandat: tenant.sepaMandat || false,
        iban: tenant.iban || '',
        bic: tenant.bic || '',
        mandat_reference: '',
        status: tenant.status || 'aktiv',
      };
    })(),
  });

  const watchSepaMandat = form.watch('sepa_mandat');
  const watchBefristet = form.watch('befristet');
  const watchGrundmiete = form.watch('grundmiete');
  const watchBK = form.watch('betriebskosten_vorschuss');
  const watchHeizung = form.watch('heizungskosten_vorschuss');
  const watchWasser = form.watch('wasserkosten_vorschuss');
  
  const sonstigeKostenTotal = sonstigeKosten.reduce((sum, pos) => sum + (pos.betrag || 0), 0);
  const totalRent = (watchGrundmiete || 0) + (watchBK || 0) + (watchHeizung || 0) + (watchWasser || 0) + sonstigeKostenTotal;
  
  const addSonstigeKostenPosition = () => {
    setSonstigeKosten([...sonstigeKosten, { name: '', betrag: 0, ust: 10, schluessel: '' }]);
  };
  
  const removeSonstigeKostenPosition = (index: number) => {
    setSonstigeKosten(sonstigeKosten.filter((_, i) => i !== index));
  };
  
  const updateSonstigeKostenPosition = (index: number, field: keyof SonstigeKostenPosition, value: string | number) => {
    const updated = [...sonstigeKosten];
    if (field === 'betrag' || field === 'ust') {
      updated[index][field] = typeof value === 'string' ? parseFloat(value) || 0 : value;
    } else {
      updated[index][field] = value as string;
    }
    setSonstigeKosten(updated);
  };

  const onSubmit = async (data: TenantFormData) => {
    // Build sonstige_kosten JSONB from positions
    const sonstigeKostenObj: Record<string, { betrag: number; ust: number; schluessel: string }> = {};
    for (const pos of sonstigeKosten) {
      if (pos.name && pos.betrag > 0) {
        sonstigeKostenObj[pos.name] = {
          betrag: pos.betrag,
          ust: pos.ust,
          schluessel: pos.schluessel || 'Nutzfläche', // Default to Nutzfläche if not set
        };
      }
    }
    
    // Convert form data (snake_case) to API format (camelCase)
    const tenantData = {
      firstName: data.first_name,
      lastName: data.last_name,
      unitId: unitId!,
      mietbeginn: data.mietbeginn,
      mietende: data.mietende || null,
      befristet: data.befristet,
      befristungEnde: data.befristet ? (data.befristung_ende || null) : null,
      kaution: String(data.kaution),
      kautionBezahlt: data.kaution_bezahlt,
      grundmiete: String(data.grundmiete),
      betriebskostenVorschuss: String(data.betriebskosten_vorschuss),
      heizkostenVorschuss: String(data.heizungskosten_vorschuss),
      wasserkostenVorschuss: String(data.wasserkosten_vorschuss),
      // MRG § 16 Abs. 2 — nur bei richtwert-Objekten erfasst
      lagezuschlag: data.lagezuschlag != null ? String(data.lagezuschlag) : null,
      abschlaege:   data.abschlaege   != null ? String(data.abschlaege)   : null,
      sonstigeKosten: Object.keys(sonstigeKostenObj).length > 0 ? sonstigeKostenObj : null,
      sepaMandat: data.sepa_mandat,
      sepaMandatDatum: null,
      status: data.status,
      email: data.email || null,
      phone: data.phone || null,
      mobilePhone: null,
      iban: data.iban || null,
      bic: data.bic || null,
      mandatReference: data.mandat_reference || null,
      notes: null,
    };

    if (isEditing && tenantId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await updateTenant.mutateAsync({ id: tenantId, ...tenantData } as any);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await createTenant.mutateAsync(tenantData as any);
    }

    navigate(`/einheiten/${effectivePropertyId}/${unitId}`);
  };

  const isLoading = isLoadingUnit || isLoadingProperty || (isEditing && isLoadingTenant);
  const isSaving = createTenant.isPending || updateTenant.isPending;

  if (isLoading) {
    return (
      <MainLayout title="Laden..." subtitle="">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  const backUrl = `/einheiten/${effectivePropertyId}/${unitId}`;

  return (
    <MainLayout
      title={isEditing ? 'Mieter bearbeiten' : 'Neuer Mieter'}
      subtitle={unit ? `${unit.topNummer} - ${property?.name || ''}` : ''}
    >
      {/* Back Button */}
      <Link
        to={backUrl}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Zurück zur Einheit
      </Link>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Personal Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Persönliche Daten
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="first_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vorname *</FormLabel>
                      <FormControl>
                        <Input placeholder="Max" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="last_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nachname *</FormLabel>
                      <FormControl>
                        <Input placeholder="Mustermann" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>E-Mail</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="max@example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Telefon</FormLabel>
                      <FormControl>
                        <Input placeholder="+43 1 234 5678" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Status wählen" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="aktiv">Aktiv</SelectItem>
                        <SelectItem value="beendet">Beendet</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Rental Period */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Mietdauer
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="mietbeginn"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        Mietbeginn *
                        <InfoTooltip text="mietbeginn" />
                      </FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="mietende"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        Mietende
                        <InfoTooltip text="mietende" />
                      </FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormDescription>Leer lassen für unbefristeten Vertrag</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Befristung */}
              <div className="rounded-lg border border-border p-4 space-y-3">
                <FormField
                  control={form.control}
                  name="befristet"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="checkbox-befristet"
                        />
                      </FormControl>
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <FormLabel className="font-normal cursor-pointer">
                          Befristeter Mietvertrag (§ 29 Abs. 1 Z 3 MRG)
                        </FormLabel>
                      </div>
                    </FormItem>
                  )}
                />

                {watchBefristet && (
                  <FormField
                    control={form.control}
                    name="befristung_ende"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Befristung bis *
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            {...field}
                            data-testid="input-befristung-ende"
                          />
                        </FormControl>
                        <FormDescription>
                          Mindestdauer 3 Jahre (§ 29 Abs. 1 Z 3 MRG). Nach Ablauf endet der Vertrag automatisch.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="kaution"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        Kaution (€)
                        <InfoTooltip text="kaution" />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="kaution_bezahlt"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-3 space-y-0 pt-8">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormLabel className="font-normal">Kaution bezahlt</FormLabel>
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* Rent Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Euro className="h-5 w-5" />
                Monatliche Miete
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="grundmiete"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        Grundmiete (€) *
                        <InfoTooltip text="grundmiete" />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="betriebskosten_vorschuss"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        BK-Vorschuss (€) *
                        <InfoTooltip text="betriebskosten" />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="heizungskosten_vorschuss"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        Heizungskosten-Vorschuss (€) *
                        <InfoTooltip text="heizkosten" />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="wasserkosten_vorschuss"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        Wasserkosten-Vorschuss (€)
                        <InfoTooltip text="Monatlicher Vorschuss für Wasserkosten (falls separat abgerechnet)" />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="p-4 rounded-lg bg-muted">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Gesamtmiete monatlich:</span>
                  <span className="text-xl font-bold">
                    € {totalRent.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* MRG § 16 Abs. 2 — Lagezuschlag / Abschläge (nur bei Richtwert-Mietobjekten) */}
          {property?.mietrechtTyp === 'richtwert' && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Lagezuschlag und Abschläge (§ 16 Abs. 2 MRG)
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Beträge in €/m² nach § 16 Abs. 2 MRG. Der Lagezuschlag (≥ 0) wird
                  zum Richtwert addiert, Abschläge (≤ 0) davon subtrahiert —
                  jeweils multipliziert mit der Nutzfläche.
                  Quellen: Lagezuschlags-Rechner der Gemeinde. Leer = nicht berücksichtigt.
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="lagezuschlag"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center">
                          Lagezuschlag (€/m²)
                          <InfoTooltip text="Objektivierter Lagezuschlag gem. § 16 Abs. 2 MRG in €/m² (z. B. aus dem Lagezuschlags-Rechner der Gemeinde). Wird zum Richtwert addiert und mit der Nutzfläche multipliziert. Typischer Bereich: 0 – 4 €/m²." />
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="z.B. 0.50"
                            data-testid="input-lagezuschlag"
                            {...field}
                            value={field.value ?? ''}
                            onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
                          />
                        </FormControl>
                        <FormDescription>€/m² · ≥ 0 · Leer = nicht berücksichtigt</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="abschlaege"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center">
                          Abschläge (€/m²)
                          <InfoTooltip text="Ausstattungs- oder sonstige Abschläge gem. § 16 Abs. 2 MRG in €/m² (negativer Betrag). Verringert den zulässigen Höchstmietzins. Beispiel: −0.25 für leichten Mangel." />
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            max="0"
                            placeholder="z.B. -0.25"
                            data-testid="input-abschlaege"
                            {...field}
                            value={field.value ?? ''}
                            onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
                          />
                        </FormControl>
                        <FormDescription>€/m² · ≤ 0 · Leer = nicht berücksichtigt</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Sonstige Kosten */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Sonstige Kosten
                  </CardTitle>
                  <CardDescription>
                    Zusätzliche Betriebskosten-Positionen mit Verteilerschlüssel
                  </CardDescription>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addSonstigeKostenPosition}>
                  <Plus className="h-4 w-4 mr-2" />
                  Position hinzufügen
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {sonstigeKosten.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-4">
                  Keine zusätzlichen Kosten. Klicken Sie auf "Position hinzufügen" um eine neue Position anzulegen.
                </p>
              ) : (
                <div className="space-y-4">
                  {sonstigeKosten.map((pos, index) => (
                    <div key={index} className="grid grid-cols-1 md:grid-cols-5 gap-3 p-3 border rounded-lg items-end">
                      <div className="md:col-span-1">
                        <label className="text-sm font-medium mb-1 block">Bezeichnung</label>
                        <Input
                          placeholder="z.B. BK inkl. Stellplatz"
                          value={pos.name}
                          onChange={(e) => updateSonstigeKostenPosition(index, 'name', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">Betrag (€ netto)</label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={pos.betrag}
                          onChange={(e) => updateSonstigeKostenPosition(index, 'betrag', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">USt %</label>
                        <Select
                          value={String(pos.ust)}
                          onValueChange={(val) => updateSonstigeKostenPosition(index, 'ust', parseInt(val))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="10">10% (BK/Wasser)</SelectItem>
                            <SelectItem value="20">20% (Heizung)</SelectItem>
                            <SelectItem value="0">0% (steuerfrei)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">Verteilerschlüssel</label>
                        <Select
                          value={pos.schluessel}
                          onValueChange={(val) => updateSonstigeKostenPosition(index, 'schluessel', val)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Schlüssel wählen" />
                          </SelectTrigger>
                          <SelectContent>
                            {distributionKeys?.filter(k => k.isActive).map((key) => (
                              <SelectItem key={key.id} value={key.name}>
                                {key.name}
                              </SelectItem>
                            ))}
                            {(!distributionKeys || distributionKeys.filter(k => k.isActive).length === 0) && (
                              <SelectItem value="Direktwert">Direktwert</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeSonstigeKostenPosition(index)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  
                  {sonstigeKosten.length > 0 && (
                    <div className="p-3 rounded-lg bg-muted flex items-center justify-between">
                      <span className="font-medium">Summe Sonstige Kosten:</span>
                      <span className="font-bold">
                        € {sonstigeKostenTotal.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* SEPA Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                SEPA-Lastschrift
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="sepa_mandat"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormLabel className="font-normal flex items-center">
                      SEPA-Lastschriftmandat erteilt
                      <InfoTooltip text="sepa_mandat" />
                    </FormLabel>
                  </FormItem>
                )}
              />

              {watchSepaMandat && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
                  <FormField
                    control={form.control}
                    name="iban"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center">
                          IBAN
                          <InfoTooltip text="iban" />
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="AT12 3456 7890 1234 5678" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="bic"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center">
                          BIC
                          <InfoTooltip text="bic" />
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="BAWAATWW" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="mandat_reference"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center">
                          Mandatsreferenz
                          <InfoTooltip text="mandat_reference" />
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="MANDAT-001" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Submit */}
          <div className="flex items-center justify-end gap-4">
            <Button type="button" variant="outline" onClick={() => navigate(backUrl)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {isEditing ? 'Speichern' : 'Mieter anlegen'}
            </Button>
          </div>
        </form>
      </Form>
    </MainLayout>
  );
}
