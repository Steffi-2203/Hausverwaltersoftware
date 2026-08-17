import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { useTenants } from '@/hooks/useTenants';
import { useTenantPortalAccess, useCreateTenantPortalAccess, useToggleTenantPortalAccess } from '@/hooks/useTenantPortalAccess';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  Home, Euro, FileText, CreditCard, AlertTriangle,
  Download, CheckCircle, Clock, Users, Plus, Shield,
  Calendar, MapPin, Ruler, Building2, Key, FolderOpen, Receipt,
  Mail, Loader2
} from 'lucide-react';

function formatCurrency(amount: number | string | null | undefined) {
  const num = typeof amount === 'string' ? parseFloat(amount) : (amount || 0);
  return new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(num);
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return '-';
  try {
    return format(new Date(dateStr), 'dd.MM.yyyy', { locale: de });
  } catch {
    return dateStr;
  }
}

const MONTH_NAMES = ['', 'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const STATUS_MAP: Record<string, { label: string; variant: 'default' | 'outline' | 'secondary' | 'destructive' }> = {
  bezahlt: { label: 'Bezahlt', variant: 'default' },
  offen: { label: 'Offen', variant: 'outline' },
  ueberfaellig: { label: 'Überfällig', variant: 'destructive' },
  gemahnt: { label: 'Gemahnt', variant: 'destructive' },
  storniert: { label: 'Storniert', variant: 'secondary' },
  teilbezahlt: { label: 'Teilbezahlt', variant: 'outline' },
};

const CATEGORY_LABELS: Record<string, string> = {
  vertrag: 'Vertrag',
  rechnung: 'Rechnung',
  bescheid: 'Bescheid',
  protokoll: 'Protokoll',
  korrespondenz: 'Korrespondenz',
  abrechnung: 'Abrechnung',
  mahnung: 'Mahnung',
  kaution: 'Kaution',
  uebergabe: 'Übergabe',
  sonstiges: 'Sonstiges',
};

function TenantSelfServiceView() {
  const [filterYear, setFilterYear] = useState<string>('alle');
  const [filterStatus, setFilterStatus] = useState<string>('alle');

  const { data: dashboard, isLoading: dashLoading } = useQuery<any>({
    queryKey: ['/api/tenant-portal/dashboard'],
  });

  const { data: invoices, isLoading: invLoading } = useQuery<any[]>({
    queryKey: ['/api/tenant-portal/invoices', filterYear, filterStatus],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterYear !== 'alle') params.set('year', filterYear);
      if (filterStatus !== 'alle') params.set('status', filterStatus);
      const res = await fetch(`/api/tenant-portal/invoices?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler');
      return res.json();
    },
  });

  const { data: allPayments, isLoading: payLoading } = useQuery<any[]>({
    queryKey: ['/api/tenant-portal/payments'],
  });

  const { data: documents, isLoading: docLoading } = useQuery<any[]>({
    queryKey: ['/api/tenant-portal/documents'],
  });

  const { data: leaseHistory } = useQuery<any[]>({
    queryKey: ['/api/tenant-portal/lease'],
  });

  if (dashLoading) {
    return (
      <MainLayout title="Mein Portal" subtitle="Laden...">
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            {[1,2,3,4].map(i => (
              <Card key={i}><CardContent className="pt-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      </MainLayout>
    );
  }

  if (!dashboard) {
    return (
      <MainLayout title="Mieterportal" subtitle="Kein Zugang">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Shield className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium" data-testid="text-no-access">Kein Portal-Zugang</p>
            <p className="text-sm text-muted-foreground">Sie haben keinen aktiven Mieterportal-Zugang. Bitte kontaktieren Sie Ihre Hausverwaltung.</p>
          </CardContent>
        </Card>
      </MainLayout>
    );
  }

  const { tenant, unit, property, lease, openBalance, openInvoiceCount, documentCount } = dashboard;
  const currentYear = new Date().getFullYear();
  const availableYears = Array.from(new Set((invoices || []).map((i: any) => i.year))).sort((a: number, b: number) => b - a);
  if (!availableYears.includes(currentYear)) availableYears.unshift(currentYear);

  return (
    <MainLayout
      title={`Willkommen, ${tenant.firstName}`}
      subtitle={property ? `${property.name} – ${property.address}, ${property.plz} ${property.ort}` : ''}
    >
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Home className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium" data-testid="text-unit-number">Top {unit?.topNummer || '?'}</p>
                  <p className="text-sm text-muted-foreground">
                    {unit?.flaeche ? `${unit.flaeche} m²` : ''} {unit?.zimmer ? `· ${unit.zimmer} Zimmer` : ''}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Euro className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium" data-testid="text-monthly-rent">{formatCurrency(tenant.grundmiete)}</p>
                  <p className="text-sm text-muted-foreground">Monatl. Miete (netto)</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-full flex items-center justify-center ${openBalance > 0 ? 'bg-destructive/10' : 'bg-green-500/10'}`}>
                  {openBalance > 0 ? <AlertTriangle className="h-5 w-5 text-destructive" /> : <CheckCircle className="h-5 w-5 text-green-600" />}
                </div>
                <div>
                  <p className="font-medium" data-testid="text-open-balance">{formatCurrency(openBalance)}</p>
                  <p className="text-sm text-muted-foreground">
                    {openInvoiceCount > 0 ? `${openInvoiceCount} offene Rechnung(en)` : 'Alles bezahlt'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <FolderOpen className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium" data-testid="text-document-count">{documentCount} Dokumente</p>
                  <p className="text-sm text-muted-foreground">Verfügbar</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview" data-testid="tab-overview">
              <Home className="h-4 w-4 mr-1" /> Übersicht
            </TabsTrigger>
            <TabsTrigger value="invoices" data-testid="tab-invoices">
              <Receipt className="h-4 w-4 mr-1" /> Vorschreibungen
            </TabsTrigger>
            <TabsTrigger value="payments" data-testid="tab-payments">
              <CreditCard className="h-4 w-4 mr-1" /> Zahlungen
            </TabsTrigger>
            <TabsTrigger value="documents" data-testid="tab-documents">
              <FileText className="h-4 w-4 mr-1" /> Dokumente
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Key className="h-4 w-4" /> Mietvertrag
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Mietbeginn</span>
                      <span className="text-sm font-medium" data-testid="text-lease-start">{formatDate(tenant.mietbeginn)}</span>
                    </div>
                    {tenant.mietende && (
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Mietende</span>
                        <span className="text-sm font-medium">{formatDate(tenant.mietende)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Grundmiete</span>
                      <span className="text-sm font-medium">{formatCurrency(tenant.grundmiete)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">BK-Vorschuss</span>
                      <span className="text-sm font-medium">{formatCurrency(tenant.betriebskostenVorschuss)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Heizkosten</span>
                      <span className="text-sm font-medium">{formatCurrency(tenant.heizkostenVorschuss)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Wasserkosten</span>
                      <span className="text-sm font-medium">{formatCurrency(tenant.wasserkostenVorschuss)}</span>
                    </div>
                    {tenant.kaution && (
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Kaution</span>
                        <span className="text-sm font-medium">
                          {formatCurrency(tenant.kaution)}
                          {tenant.kautionBezahlt && (
                            <Badge variant="outline" className="ml-2">Bezahlt</Badge>
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Building2 className="h-4 w-4" /> Objekt & Einheit
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {property && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Liegenschaft</span>
                          <span className="text-sm font-medium">{property.name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Adresse</span>
                          <span className="text-sm font-medium">{property.address}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">PLZ / Ort</span>
                          <span className="text-sm font-medium">{property.plz} {property.ort}</span>
                        </div>
                      </>
                    )}
                    {unit && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Top-Nr.</span>
                          <span className="text-sm font-medium">{unit.topNummer}</span>
                        </div>
                        {unit.typ && (
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Typ</span>
                            <span className="text-sm font-medium">{unit.typ}</span>
                          </div>
                        )}
                        {unit.flaeche && (
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Fläche</span>
                            <span className="text-sm font-medium">{unit.flaeche} m²</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {dashboard.recentInvoices?.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Clock className="h-4 w-4" /> Letzte Vorschreibungen
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Zeitraum</TableHead>
                        <TableHead className="text-right">Betrag</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Fällig am</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dashboard.recentInvoices.map((inv: any) => {
                        const st = STATUS_MAP[inv.status] || { label: inv.status, variant: 'outline' as const };
                        return (
                          <TableRow key={inv.id} data-testid={`row-invoice-${inv.id}`}>
                            <TableCell>{MONTH_NAMES[inv.month]} {inv.year}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(inv.gesamtbetrag)}</TableCell>
                            <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                            <TableCell>{formatDate(inv.faelligkeitsDatum)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="invoices" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <CardTitle className="text-base">Vorschreibungen</CardTitle>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Select value={filterYear} onValueChange={setFilterYear}>
                      <SelectTrigger className="w-[130px]" data-testid="select-filter-year">
                        <SelectValue placeholder="Jahr" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="alle">Alle Jahre</SelectItem>
                        {availableYears.map((y: number) => (
                          <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                      <SelectTrigger className="w-[140px]" data-testid="select-filter-status">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="alle">Alle Status</SelectItem>
                        <SelectItem value="offen">Offen</SelectItem>
                        <SelectItem value="bezahlt">Bezahlt</SelectItem>
                        <SelectItem value="ueberfaellig">Überfällig</SelectItem>
                        <SelectItem value="teilbezahlt">Teilbezahlt</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {invLoading ? (
                  <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : !invoices?.length ? (
                  <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-invoices">Keine Vorschreibungen gefunden</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Zeitraum</TableHead>
                        <TableHead>Rechnung</TableHead>
                        <TableHead className="text-right">Miete</TableHead>
                        <TableHead className="text-right">BK</TableHead>
                        <TableHead className="text-right">Heizung</TableHead>
                        <TableHead className="text-right">Gesamt</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Fällig</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map((inv: any) => {
                        const st = STATUS_MAP[inv.status] || { label: inv.status, variant: 'outline' as const };
                        return (
                          <TableRow key={inv.id} data-testid={`row-invoice-detail-${inv.id}`}>
                            <TableCell className="font-medium">{MONTH_NAMES[inv.month]} {inv.year}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{inv.rechnungsNummer || '-'}</TableCell>
                            <TableCell className="text-right">{formatCurrency(inv.grundmiete)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(inv.betriebskosten)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(inv.heizungskosten)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(inv.gesamtbetrag)}</TableCell>
                            <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                            <TableCell>{formatDate(inv.faelligkeitsDatum)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payments" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Zahlungshistorie</CardTitle>
              </CardHeader>
              <CardContent>
                {payLoading ? (
                  <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : !allPayments?.length ? (
                  <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-payments">Keine Zahlungen gefunden</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Buchungsdatum</TableHead>
                        <TableHead className="text-right">Betrag</TableHead>
                        <TableHead>Zahlungsart</TableHead>
                        <TableHead>Verwendungszweck</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allPayments.map((pay: any) => (
                        <TableRow key={pay.id} data-testid={`row-payment-${pay.id}`}>
                          <TableCell>{formatDate(pay.buchungsDatum)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(pay.betrag)}</TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {pay.paymentType === 'ueberweisung' ? 'Überweisung' :
                               pay.paymentType === 'lastschrift' ? 'Lastschrift' :
                               pay.paymentType === 'bar' ? 'Bar' : pay.paymentType || '-'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{pay.verwendungszweck || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="documents" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Meine Dokumente</CardTitle>
              </CardHeader>
              <CardContent>
                {docLoading ? (
                  <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : !documents?.length ? (
                  <div className="flex flex-col items-center justify-center py-8">
                    <FolderOpen className="h-10 w-10 text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground" data-testid="text-no-documents">Keine Dokumente verfügbar</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Dokument</TableHead>
                        <TableHead>Kategorie</TableHead>
                        <TableHead>Datum</TableHead>
                        <TableHead>Größe</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {documents.map((doc: any) => (
                        <TableRow key={doc.id} data-testid={`row-document-${doc.id}`}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">{doc.name}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{CATEGORY_LABELS[doc.category] || doc.category}</Badge>
                          </TableCell>
                          <TableCell>{formatDate(doc.createdAt)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {doc.fileSize ? `${(doc.fileSize / 1024).toFixed(0)} KB` : '-'}
                          </TableCell>
                          <TableCell>
                            {doc.fileUrl && (
                              <Button size="sm" variant="outline" asChild data-testid={`button-download-${doc.id}`}>
                                <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer">
                                  <Download className="h-3 w-3 mr-1" /> Download
                                </a>
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {leaseHistory && leaseHistory.length > 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Calendar className="h-4 w-4" /> Vertragshistorie
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Beginn</TableHead>
                    <TableHead>Ende</TableHead>
                    <TableHead className="text-right">Grundmiete</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaseHistory.map((l: any) => (
                    <TableRow key={l.id}>
                      <TableCell>{formatDate(l.startDate)}</TableCell>
                      <TableCell>{l.endDate ? formatDate(l.endDate) : 'Unbefristet'}</TableCell>
                      <TableCell className="text-right">{formatCurrency(l.grundmiete)}</TableCell>
                      <TableCell>
                        <Badge variant={l.status === 'aktiv' ? 'default' : 'outline'}>
                          {l.status === 'aktiv' ? 'Aktiv' : l.status === 'beendet' ? 'Beendet' : l.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}

export default function TenantPortal() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: tenants } = useTenants();
  const { data: portalAccess } = useTenantPortalAccess();
  const createAccess = useCreateTenantPortalAccess();
  const toggleAccess = useToggleTenantPortalAccess();

  const [showGrantAccess, setShowGrantAccess] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [accessEmail, setAccessEmail] = useState('');
  const [sendingInvite, setSendingInvite] = useState<string | null>(null);

  const handleSendInvite = async (accessId: string) => {
    setSendingInvite(accessId);
    try {
      const res = await fetch('/api/tenant-portal/send-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tenantPortalAccessId: accessId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast({ title: 'Einladung gesendet', description: 'Die Einladungs-E-Mail wurde erfolgreich versendet.' });
      } else {
        toast({ title: 'Fehler', description: data.error || 'Einladung konnte nicht gesendet werden', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Fehler', description: 'Verbindung zum Server fehlgeschlagen', variant: 'destructive' });
    } finally {
      setSendingInvite(null);
    }
  };

  const { data: accessCheck } = useQuery<{ hasAccess: boolean }>({
    queryKey: ['/api/tenant-portal/check-access'],
  });

  if (accessCheck?.hasAccess) {
    return <TenantSelfServiceView />;
  }

  const handleGrantAccess = async () => {
    if (!selectedTenantId || !accessEmail) return;
    try {
      await createAccess.mutateAsync({ tenant_id: selectedTenantId, email: accessEmail });
      setShowGrantAccess(false);
      setSelectedTenantId('');
      setAccessEmail('');
    } catch (error) {
      toast({ title: 'Fehler', description: 'Zugang konnte nicht erstellt werden', variant: 'destructive' });
    }
  };

  const activeTenants = tenants?.filter((t: any) => t.status === 'aktiv') || [];

  return (
    <MainLayout title="Mieterportal" subtitle="Self-Service Zugang für Mieter verwalten">
      <div className="space-y-6">
        <div className="flex flex-wrap justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Portal-Zugänge verwalten</h2>
          </div>
          <Button onClick={() => setShowGrantAccess(true)} data-testid="button-grant-access">
            <Plus className="h-4 w-4 mr-2" /> Zugang einrichten
          </Button>
        </div>

        {!portalAccess || portalAccess.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Users className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">Keine Portal-Zugänge</p>
              <p className="text-muted-foreground text-sm">Richten Sie Zugänge ein, damit Mieter ihre Daten einsehen können.</p>
              <Button className="mt-4" onClick={() => setShowGrantAccess(true)} data-testid="button-first-access">
                <Plus className="h-4 w-4 mr-2" /> Ersten Zugang einrichten
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mieter</TableHead>
                    <TableHead>E-Mail</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Letzter Login</TableHead>
                    <TableHead>Aktiv</TableHead>
                    <TableHead>Aktion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {portalAccess.map((access: any) => {
                    const tenant = tenants?.find((t: any) => t.id === access.tenant_id);
                    const hasPassword = access.password_hash != null;
                    return (
                      <TableRow key={access.id} data-testid={`row-access-${access.id}`}>
                        <TableCell className="font-medium">
                          {tenant ? `${tenant.first_name || tenant.firstName} ${tenant.last_name || tenant.lastName}` : 'Unbekannt'}
                        </TableCell>
                        <TableCell>{access.email}</TableCell>
                        <TableCell>
                          {hasPassword ? (
                            <Badge>Registriert</Badge>
                          ) : (
                            <Badge variant="outline">Ausstehend</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {access.last_login_at
                            ? format(new Date(access.last_login_at), 'dd.MM.yyyy HH:mm', { locale: de })
                            : '-'}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={access.is_active}
                            onCheckedChange={(checked) => toggleAccess.mutate({ id: access.id, is_active: checked })}
                            data-testid={`switch-active-${access.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSendInvite(access.id)}
                            disabled={sendingInvite === access.id || !access.is_active}
                            data-testid={`button-send-invite-${access.id}`}
                          >
                            {sendingInvite === access.id ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-1" />
                            ) : (
                              <Mail className="h-4 w-4 mr-1" />
                            )}
                            Einladung senden
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={showGrantAccess} onOpenChange={setShowGrantAccess}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Portal-Zugang einrichten</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Mieter</Label>
              <Select value={selectedTenantId} onValueChange={(v) => {
                setSelectedTenantId(v);
                const tenant = activeTenants.find((t: any) => t.id === v);
                if (tenant?.email) setAccessEmail(tenant.email);
              }}>
                <SelectTrigger data-testid="select-tenant"><SelectValue placeholder="Mieter wählen..." /></SelectTrigger>
                <SelectContent>
                  {activeTenants.map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.first_name || t.firstName} {t.last_name || t.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>E-Mail für Portal-Zugang</Label>
              <Input
                type="email"
                value={accessEmail}
                onChange={e => setAccessEmail(e.target.value)}
                placeholder="mieter@example.com"
                data-testid="input-access-email"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGrantAccess(false)} data-testid="button-cancel-access">Abbrechen</Button>
            <Button onClick={handleGrantAccess} disabled={!selectedTenantId || !accessEmail} data-testid="button-create-access">Zugang erstellen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
