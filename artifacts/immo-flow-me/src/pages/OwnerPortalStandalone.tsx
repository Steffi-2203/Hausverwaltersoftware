import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  Home, Euro, FileText, Building2, Shield, LogOut,
  Calendar, Download, FolderOpen, Users, PieChart, Landmark
} from 'lucide-react';
import immoflowLogo from '@/assets/immoflowme-logo.png';

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

const STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'outline' | 'secondary' | 'destructive' }> = {
  geplant: { label: 'Geplant', variant: 'outline' },
  eingeladen: { label: 'Eingeladen', variant: 'secondary' },
  durchgefuehrt: { label: 'Durchgeführt', variant: 'default' },
  protokolliert: { label: 'Protokolliert', variant: 'default' },
  entwurf: { label: 'Entwurf', variant: 'outline' },
  genehmigt: { label: 'Genehmigt', variant: 'default' },
  aktiv: { label: 'Aktiv', variant: 'default' },
  abgeschlossen: { label: 'Abgeschlossen', variant: 'secondary' },
};

export default function OwnerPortalStandalone() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const { data: session, isLoading: sessionLoading } = useQuery<any>({
    queryKey: ['/api/owner-auth/session'],
  });

  const { data: dashboard, isLoading: dashLoading } = useQuery<any>({
    queryKey: ['/api/owner-portal/dashboard'],
    enabled: session?.authenticated === true,
  });

  const { data: properties, isLoading: propLoading } = useQuery<any[]>({
    queryKey: ['/api/owner-portal/properties'],
    enabled: session?.authenticated === true,
  });

  const { data: settlements, isLoading: settLoading } = useQuery<any[]>({
    queryKey: ['/api/owner-portal/settlements'],
    enabled: session?.authenticated === true,
  });

  const { data: assemblies, isLoading: asmLoading } = useQuery<any[]>({
    queryKey: ['/api/owner-portal/assemblies'],
    enabled: session?.authenticated === true,
  });

  const { data: documents, isLoading: docLoading } = useQuery<any[]>({
    queryKey: ['/api/owner-portal/documents'],
    enabled: session?.authenticated === true,
  });

  const { data: budgets, isLoading: budLoading } = useQuery<any[]>({
    queryKey: ['/api/owner-portal/budgets'],
    enabled: session?.authenticated === true,
  });

  useEffect(() => {
    if (!sessionLoading && !session?.authenticated) {
      navigate('/eigentuemer-login', { replace: true });
    }
  }, [session, sessionLoading, navigate]);

  async function handleLogout() {
    try {
      await fetch('/api/owner-auth/logout', { method: 'POST', credentials: 'include' });
      navigate('/eigentuemer-login', { replace: true });
    } catch {
      toast({ title: 'Fehler', description: 'Abmeldung fehlgeschlagen', variant: 'destructive' });
    }
  }

  if (sessionLoading || dashLoading) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b bg-card">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            <img src={immoflowLogo} alt="ImmoFlowMe" className="h-8 w-auto" />
            <Skeleton className="h-9 w-24" />
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            {[1,2,3,4].map(i => (
              <Card key={i}><CardContent className="pt-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </main>
      </div>
    );
  }

  if (!session?.authenticated) return null;

  if (!dashboard) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b bg-card">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            <img src={immoflowLogo} alt="ImmoFlowMe" className="h-8 w-auto" />
            <Button variant="outline" onClick={handleLogout} data-testid="button-owner-logout">
              <LogOut className="h-4 w-4 mr-2" /> Abmelden
            </Button>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-6">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Shield className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">Keine Daten verfügbar</p>
              <p className="text-sm text-muted-foreground">Es konnten keine Eigentümerdaten geladen werden.</p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const { owner, propertyCount, unitCount, totalMeaShare, reserveFundTotal, assemblyCount } = dashboard;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src={immoflowLogo} alt="ImmoFlowMe" className="h-8 w-auto" />
            <span className="text-sm text-muted-foreground hidden sm:inline">Eigentümerportal</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden md:inline">
              {owner.firstName} {owner.lastName}
            </span>
            <Button variant="outline" onClick={handleLogout} data-testid="button-owner-logout">
              <LogOut className="h-4 w-4 mr-2" /> Abmelden
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-owner-welcome">
            Willkommen, {owner.firstName}
          </h1>
          {owner.companyName && (
            <p className="text-muted-foreground">{owner.companyName}</p>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium" data-testid="text-property-count">{propertyCount} Liegenschaft{propertyCount !== 1 ? 'en' : ''}</p>
                  <p className="text-sm text-muted-foreground">{unitCount} Einheit{unitCount !== 1 ? 'en' : ''}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <PieChart className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium" data-testid="text-total-mea">{totalMeaShare?.toFixed(2) || '0.00'}</p>
                  <p className="text-sm text-muted-foreground">MEA-Anteile gesamt</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Landmark className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium" data-testid="text-reserve-fund">{formatCurrency(reserveFundTotal)}</p>
                  <p className="text-sm text-muted-foreground">Rücklage gesamt</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium" data-testid="text-assembly-count">{assemblyCount} Versammlung{assemblyCount !== 1 ? 'en' : ''}</p>
                  <p className="text-sm text-muted-foreground">WEG-Versammlungen</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview" data-testid="tab-owner-overview">
              <Home className="h-4 w-4 mr-1" /> Übersicht
            </TabsTrigger>
            <TabsTrigger value="properties" data-testid="tab-owner-properties">
              <Building2 className="h-4 w-4 mr-1" /> Liegenschaften
            </TabsTrigger>
            <TabsTrigger value="settlements" data-testid="tab-owner-settlements">
              <Euro className="h-4 w-4 mr-1" /> Abrechnungen
            </TabsTrigger>
            <TabsTrigger value="assemblies" data-testid="tab-owner-assemblies">
              <Users className="h-4 w-4 mr-1" /> Versammlungen
            </TabsTrigger>
            <TabsTrigger value="documents" data-testid="tab-owner-documents">
              <FileText className="h-4 w-4 mr-1" /> Dokumente
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Shield className="h-4 w-4" /> Eigentümer-Daten
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between gap-2">
                      <span className="text-sm text-muted-foreground">Name</span>
                      <span className="text-sm font-medium" data-testid="text-owner-name">{owner.firstName} {owner.lastName}</span>
                    </div>
                    {owner.companyName && (
                      <div className="flex justify-between gap-2">
                        <span className="text-sm text-muted-foreground">Firma</span>
                        <span className="text-sm font-medium">{owner.companyName}</span>
                      </div>
                    )}
                    {owner.email && (
                      <div className="flex justify-between gap-2">
                        <span className="text-sm text-muted-foreground">E-Mail</span>
                        <span className="text-sm font-medium">{owner.email}</span>
                      </div>
                    )}
                    {owner.phone && (
                      <div className="flex justify-between gap-2">
                        <span className="text-sm text-muted-foreground">Telefon</span>
                        <span className="text-sm font-medium">{owner.phone}</span>
                      </div>
                    )}
                    {owner.address && (
                      <div className="flex justify-between gap-2">
                        <span className="text-sm text-muted-foreground">Adresse</span>
                        <span className="text-sm font-medium text-right">{owner.address}{owner.postalCode || owner.city ? `, ${owner.postalCode || ''} ${owner.city || ''}` : ''}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Building2 className="h-4 w-4" /> Meine Liegenschaften
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!dashboard.properties?.length ? (
                    <p className="text-sm text-muted-foreground text-center py-4">Keine Liegenschaften zugeordnet</p>
                  ) : (
                    <div className="space-y-3">
                      {dashboard.properties.map((prop: any) => (
                        <div key={prop.id} className="flex justify-between items-start gap-2 border-b border-border pb-3 last:border-0 last:pb-0">
                          <div>
                            <p className="text-sm font-medium" data-testid={`text-property-name-${prop.id}`}>{prop.name}</p>
                            <p className="text-xs text-muted-foreground">{prop.address}, {prop.postalCode} {prop.city}</p>
                          </div>
                          <Badge variant="outline" data-testid={`badge-ownership-${prop.id}`}>{prop.ownershipShare}%</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {dashboard.unitOwnerships?.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <PieChart className="h-4 w-4" /> MEA-Anteile
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Einheit</TableHead>
                        <TableHead className="text-right">MEA-Anteil</TableHead>
                        <TableHead className="text-right">Nutzwert</TableHead>
                        <TableHead>Gültig ab</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dashboard.unitOwnerships.map((uo: any) => (
                        <TableRow key={uo.id} data-testid={`row-unit-ownership-${uo.id}`}>
                          <TableCell className="font-medium">{uo.unitId?.substring(0, 8) || '-'}</TableCell>
                          <TableCell className="text-right">{parseFloat(uo.meaShare || '0').toFixed(4)}</TableCell>
                          <TableCell className="text-right">{uo.nutzwert ? parseFloat(uo.nutzwert).toFixed(4) : '-'}</TableCell>
                          <TableCell>{formatDate(uo.validFrom)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {budgets && budgets.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Euro className="h-4 w-4" /> Aktuelle Wirtschaftspläne
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Liegenschaft</TableHead>
                        <TableHead>Jahr</TableHead>
                        <TableHead className="text-right">Gesamtbetrag</TableHead>
                        <TableHead className="text-right">Rücklage</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {budgets.slice(0, 5).map((b: any) => {
                        const st = STATUS_LABELS[b.status] || { label: b.status, variant: 'outline' as const };
                        return (
                          <TableRow key={b.id} data-testid={`row-budget-${b.id}`}>
                            <TableCell className="font-medium">{b.propertyName}</TableCell>
                            <TableCell>{b.year}</TableCell>
                            <TableCell className="text-right">{formatCurrency(b.totalAmount)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(b.reserveContribution)}</TableCell>
                            <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="properties" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Meine Liegenschaften</CardTitle>
              </CardHeader>
              <CardContent>
                {propLoading ? (
                  <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : !properties?.length ? (
                  <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-properties">Keine Liegenschaften gefunden</p>
                ) : (
                  <div className="space-y-4">
                    {properties.map((prop: any) => (
                      <Card key={prop.id} data-testid={`card-property-${prop.id}`}>
                        <CardContent className="pt-6">
                          <div className="flex flex-wrap justify-between items-start gap-4 mb-4">
                            <div>
                              <p className="font-medium text-base">{prop.name}</p>
                              <p className="text-sm text-muted-foreground">{prop.address}, {prop.postalCode} {prop.city}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">Anteil: {prop.ownershipShare}%</Badge>
                              {prop.validFrom && <Badge variant="secondary">Seit {formatDate(prop.validFrom)}</Badge>}
                            </div>
                          </div>
                          {prop.ownedUnits?.length > 0 && (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Top</TableHead>
                                  <TableHead>Typ</TableHead>
                                  <TableHead className="text-right">Fläche</TableHead>
                                  <TableHead className="text-right">MEA</TableHead>
                                  <TableHead className="text-right">Nutzwert</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {prop.ownedUnits.map((unit: any, idx: number) => (
                                  <TableRow key={unit.unitId || idx} data-testid={`row-unit-${unit.unitId}`}>
                                    <TableCell className="font-medium">{unit.topNummer || '-'}</TableCell>
                                    <TableCell>{unit.type || '-'}</TableCell>
                                    <TableCell className="text-right">{unit.flaeche ? `${unit.flaeche} m²` : '-'}</TableCell>
                                    <TableCell className="text-right">{parseFloat(unit.meaShare || '0').toFixed(4)}</TableCell>
                                    <TableCell className="text-right">{unit.nutzwert ? parseFloat(unit.nutzwert).toFixed(4) : '-'}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settlements" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Abrechnungen</CardTitle>
              </CardHeader>
              <CardContent>
                {settLoading ? (
                  <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : !settlements?.length ? (
                  <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-settlements">Keine Abrechnungen gefunden</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Liegenschaft</TableHead>
                        <TableHead>Jahr</TableHead>
                        <TableHead className="text-right">Ausgaben</TableHead>
                        <TableHead className="text-right">Vorschuss</TableHead>
                        <TableHead className="text-right">Differenz</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Aktion</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {settlements.map((s: any) => {
                        const st = STATUS_LABELS[s.status] || { label: s.status, variant: 'outline' as const };
                        return (
                          <TableRow key={s.id} data-testid={`row-settlement-${s.id}`}>
                            <TableCell className="font-medium">{s.propertyName}</TableCell>
                            <TableCell>{s.year}</TableCell>
                            <TableCell className="text-right">{formatCurrency(s.gesamtausgaben)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(s.gesamtvorschuss)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(s.differenz)}</TableCell>
                            <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                            <TableCell>
                              {s.pdfUrl && (
                                <Button size="sm" variant="outline" asChild data-testid={`button-download-settlement-${s.id}`}>
                                  <a href={s.pdfUrl} target="_blank" rel="noopener noreferrer">
                                    <Download className="h-3 w-3 mr-1" /> PDF
                                  </a>
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="assemblies" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">WEG-Versammlungen</CardTitle>
              </CardHeader>
              <CardContent>
                {asmLoading ? (
                  <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : !assemblies?.length ? (
                  <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-assemblies">Keine Versammlungen gefunden</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Titel</TableHead>
                        <TableHead>Liegenschaft</TableHead>
                        <TableHead>Datum</TableHead>
                        <TableHead>Typ</TableHead>
                        <TableHead>Ort</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Protokoll</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assemblies.map((a: any) => {
                        const st = STATUS_LABELS[a.status] || { label: a.status, variant: 'outline' as const };
                        return (
                          <TableRow key={a.id} data-testid={`row-assembly-${a.id}`}>
                            <TableCell className="font-medium">{a.title}</TableCell>
                            <TableCell>{a.propertyName}</TableCell>
                            <TableCell>{formatDate(a.assemblyDate)}</TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {a.assemblyType === 'ordentlich' ? 'Ordentlich' : a.assemblyType === 'ausserordentlich' ? 'Außerordentlich' : a.assemblyType}
                              </Badge>
                            </TableCell>
                            <TableCell>{a.location || '-'}</TableCell>
                            <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                            <TableCell>
                              {a.protocolUrl && (
                                <Button size="sm" variant="outline" asChild data-testid={`button-download-protocol-${a.id}`}>
                                  <a href={a.protocolUrl} target="_blank" rel="noopener noreferrer">
                                    <Download className="h-3 w-3 mr-1" /> Protokoll
                                  </a>
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="documents" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Dokumente</CardTitle>
              </CardHeader>
              <CardContent>
                {docLoading ? (
                  <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : !documents?.length ? (
                  <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-documents">Keine Dokumente gefunden</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Kategorie</TableHead>
                        <TableHead>Datum</TableHead>
                        <TableHead>Größe</TableHead>
                        <TableHead>Aktion</TableHead>
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
                              <Button size="sm" variant="outline" asChild data-testid={`button-download-doc-${doc.id}`}>
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
      </main>
    </div>
  );
}
