import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, ArrowLeft, Pencil, User, Euro, CreditCard, Calendar, Mail, Phone } from 'lucide-react';
import { useTenant } from '@/hooks/useTenants';
import { useUnit } from '@/hooks/useUnits';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { RentIndexCard } from '@/components/tenants/RentIndexCard';
import { DepositManagementCard } from '@/components/tenants/DepositManagementCard';

const statusLabels: Record<string, string> = {
  aktiv: 'Aktiv',
  leerstand: 'Leerstand',
  beendet: 'Beendet',
};

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive'> = {
  aktiv: 'default',
  leerstand: 'secondary',
  beendet: 'destructive',
};

function formatCurrency(amount: number | null | undefined): string {
  return `€ ${(amount || 0).toLocaleString('de-AT', { minimumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return format(parseISO(dateStr), 'dd.MM.yyyy', { locale: de });
  } catch {
    return dateStr;
  }
}

export default function TenantDetail() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const navigate = useNavigate();
  const { data: tenant, isLoading } = useTenant(tenantId);
  const { data: unit } = useUnit(tenant?.unit_id);

  if (isLoading) {
    return (
      <MainLayout title="Mieter" subtitle="Details">
        <div className="max-w-3xl mx-auto space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </MainLayout>
    );
  }

  if (!tenant) {
    return (
      <MainLayout title="Mieter" subtitle="Nicht gefunden">
        <div className="max-w-3xl mx-auto">
          <p className="text-muted-foreground">Mieter nicht gefunden.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/mieter')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Zurück zur Übersicht
          </Button>
        </div>
      </MainLayout>
    );
  }

  const totalRent = (Number(tenant.grundmiete) || 0) + (Number(tenant.betriebskostenVorschuss) || 0) + (Number(tenant.heizkostenVorschuss) || 0);

  // MRG-Höchstmietzins-Prüfung (§ 16 MRG) — lädt im Hintergrund, blockiert nicht
  const { data: mrgCheck } = useQuery({
    queryKey: ['mrg-check', tenant.id],
    queryFn: async () => {
      const res = await fetch(`/api/tenants/${tenant.id}/mrg-check`);
      if (!res.ok) return null;
      return res.json() as Promise<{
        ueberschritten: boolean;
        differenz: number;
        zulassigerHmz: number | null;
        berechnungsgrundlage: string;
      }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  return (
    <MainLayout
      title={`${tenant.firstName} ${tenant.lastName}`}
      subtitle="Mieter-Details"
    >
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1 text-sm text-muted-foreground flex-wrap">
          <Link to="/mieter" className="hover:text-foreground transition-colors">Mieter</Link>
          <span>/</span>
          <span className="text-foreground font-medium">{tenant.firstName} {tenant.lastName}</span>
        </nav>

        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <Button variant="outline" onClick={() => navigate('/mieter')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Zurück zur Übersicht
          </Button>
          <Button onClick={() => navigate(`/mieter/${tenantId}/bearbeiten`)}>
            <Pencil className="h-4 w-4 mr-2" />
            Bearbeiten
          </Button>
        </div>

        {/* Personal Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Persönliche Daten
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Name</p>
                <p className="font-medium">{tenant.firstName} {tenant.lastName}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <Badge variant={statusVariant[tenant.status || 'aktiv']}>
                  {statusLabels[tenant.status || 'aktiv']}
                </Badge>
              </div>
              {tenant.email && (
                <div>
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Mail className="h-3 w-3" /> E-Mail
                  </p>
                  <p className="font-medium">{tenant.email}</p>
                </div>
              )}
              {tenant.phone && (
                <div>
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Phone className="h-3 w-3" /> Telefon
                  </p>
                  <p className="font-medium">{tenant.phone}</p>
                </div>
              )}
              {unit && (
                <div>
                  <p className="text-sm text-muted-foreground">Einheit</p>
                  <Link
                    to={`/einheiten/${unit.propertyId}/${unit.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {unit.topNummer}
                  </Link>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* MRG-Höchstmietzins-Warnung (§ 16 MRG) */}
        {mrgCheck?.ueberschritten && (
          <Alert className="border-yellow-400 bg-yellow-50 dark:bg-yellow-950/20">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            <AlertDescription className="text-yellow-800 dark:text-yellow-200">
              <strong>Eingetragene Miete übersteigt den berechneten Höchstmietzins (§ 16 MRG).</strong>{' '}
              Zulässig: {formatCurrency(mrgCheck.zulassigerHmz ?? 0)} —
              Differenz: {formatCurrency(mrgCheck.differenz)}.{' '}
              <span className="text-xs opacity-75">{mrgCheck.berechnungsgrundlage}</span>
            </AlertDescription>
          </Alert>
        )}

        {/* Rent Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Euro className="h-5 w-5" />
              Mietdaten
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Grundmiete</p>
                <p className="font-medium">{formatCurrency(Number(tenant.grundmiete))}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">BK-Vorschuss</p>
                <p className="font-medium">{formatCurrency(Number(tenant.betriebskostenVorschuss))}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">HK-Vorschuss</p>
                <p className="font-medium">{formatCurrency(Number(tenant.heizkostenVorschuss))}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground font-semibold">Gesamtmiete</p>
                <p className="font-bold text-lg">{formatCurrency(totalRent)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Contract Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Vertragsdaten
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Mietbeginn</p>
                <p className="font-medium">{formatDate(tenant.mietbeginn)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Mietende</p>
                <p className="font-medium">{formatDate(tenant.mietende) || 'Unbefristet'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Kaution</p>
                <p className="font-medium">{formatCurrency(Number(tenant.kaution))}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Kaution bezahlt</p>
                <Badge variant={tenant.kautionBezahlt ? 'default' : 'destructive'}>
                  {tenant.kautionBezahlt ? 'Ja' : 'Nein'}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Rent Index / Wertsicherung */}
        <RentIndexCard
          tenantId={tenant.id}
          currentGrundmiete={Number(tenant.grundmiete) || 0}
          tenantName={`${tenant.firstName} ${tenant.lastName}`}
        />

        {/* Deposit / Kautionsmanagement */}
        <DepositManagementCard
          tenantId={tenant.id}
          tenantName={`${tenant.firstName} ${tenant.lastName}`}
          existingKaution={tenant.kaution ? Number(tenant.kaution) : undefined}
          existingKautionBezahlt={tenant.kautionBezahlt}
        />

        {/* SEPA Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              SEPA-Lastschrift
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">SEPA-Mandat</p>
                <Badge variant={tenant.sepa_mandat ? 'default' : 'secondary'}>
                  {tenant.sepa_mandat ? 'Aktiv' : 'Nicht vorhanden'}
                </Badge>
              </div>
              {tenant.iban && (
                <div>
                  <p className="text-sm text-muted-foreground">IBAN</p>
                  <p className="font-medium font-mono text-sm">
                    {tenant.iban.slice(0, 4)} **** **** {tenant.iban.slice(-4)}
                  </p>
                </div>
              )}
              {(tenant as any).mandatReference && (
                <div>
                  <p className="text-sm text-muted-foreground">Mandatsreferenz</p>
                  <p className="font-medium">{(tenant as any).mandatReference}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
