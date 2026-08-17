import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Shield, FileText, Clock, AlertTriangle, CheckCircle, Plus,
  Trash2, Eye, Calendar, Database, Play,
} from 'lucide-react';

interface DashboardData {
  totalConsents: number;
  activeConsents: number;
  revokedConsents: number;
  processingActivitiesCount: number;
  retentionPoliciesCount: number;
  pendingRetention: number;
  lastReviewDate: string | null;
  complianceScore: number;
}

interface ConsentRecord {
  id: string;
  userId: string;
  organizationId: string;
  consentType: string;
  granted: boolean;
  consentVersion: string;
  ipAddress: string | null;
  userAgent: string | null;
  legalBasis: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface ProcessingActivity {
  id: string;
  organizationId: string;
  name: string;
  purpose: string;
  legalBasis: string;
  dataCategories: string[];
  dataSubjects: string[];
  recipients: string | null;
  thirdCountryTransfer: boolean;
  transferSafeguards: string | null;
  retentionPeriod: string;
  technicalMeasures: string | null;
  organizationalMeasures: string | null;
  responsiblePerson: string | null;
  dpiaConducted: boolean;
  dpiaDate: string | null;
  isActive: boolean;
  lastReviewDate: string | null;
  nextReviewDate: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RetentionPolicy {
  id: string;
  organizationId: string;
  dataCategory: string;
  retentionDays: number;
  legalBasis: string;
  autoDelete: boolean;
  notifyBeforeDays: number;
  isActive: boolean;
  lastExecutedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function getComplianceColor(score: number) {
  if (score >= 80) return 'text-green-600 dark:text-green-400';
  if (score >= 50) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function getComplianceWarnings(data: DashboardData): string[] {
  const warnings: string[] = [];
  if (data.processingActivitiesCount === 0) {
    warnings.push('Keine Verarbeitungstaetigkeiten erfasst - Art. 30 DSGVO erfordert ein Verzeichnis');
  }
  if (data.retentionPoliciesCount === 0) {
    warnings.push('Keine Loeschfristen definiert - Datenminimierung gemaess Art. 5 DSGVO beachten');
  }
  if (data.pendingRetention > 0) {
    warnings.push(`${data.pendingRetention} Loeschfrist(en) erfordern Ueberpruefung`);
  }
  if (data.totalConsents === 0) {
    warnings.push('Keine Einwilligungen erfasst - pruefen Sie, ob Einwilligungen eingeholt werden muessen');
  }
  if (data.complianceScore < 50) {
    warnings.push('Compliance-Score unter 50% - dringender Handlungsbedarf');
  }
  if (!data.lastReviewDate) {
    warnings.push('Keine letzte Ueberpruefung dokumentiert - regelmaessige Reviews durchfuehren');
  }
  return warnings;
}

function formatDays(days: number): string {
  if (days >= 365) {
    const years = Math.round(days / 365 * 10) / 10;
    return `${years} Jahr${years !== 1 ? 'e' : ''}`;
  }
  return `${days} Tage`;
}

export default function DsgvoCompliance() {
  const [activeTab, setActiveTab] = useState('overview');
  const [showActivityDialog, setShowActivityDialog] = useState(false);
  const [editingActivity, setEditingActivity] = useState<ProcessingActivity | null>(null);
  const [showRetentionDialog, setShowRetentionDialog] = useState(false);
  const [editingRetention, setEditingRetention] = useState<RetentionPolicy | null>(null);
  const [showConsentDetail, setShowConsentDetail] = useState(false);
  const [selectedConsent, setSelectedConsent] = useState<ConsentRecord | null>(null);

  const { data: dashboard, isLoading: dashboardLoading } = useQuery<DashboardData>({
    queryKey: ['/api/dsgvo/dashboard'],
  });

  const { data: consents, isLoading: consentsLoading } = useQuery<ConsentRecord[]>({
    queryKey: ['/api/dsgvo/consent'],
  });

  const { data: activities, isLoading: activitiesLoading } = useQuery<ProcessingActivity[]>({
    queryKey: ['/api/dsgvo/processing-activities'],
  });

  const { data: retentionPolicies, isLoading: retentionLoading } = useQuery<RetentionPolicy[]>({
    queryKey: ['/api/dsgvo/retention-policies'],
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('PUT', `/api/dsgvo/consent/${id}/revoke`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/dsgvo/consent'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dsgvo/dashboard'] });
      toast.success('Einwilligung widerrufen');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Fehler beim Widerrufen');
    },
  });

  const createActivityMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      await apiRequest('POST', '/api/dsgvo/processing-activities', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/dsgvo/processing-activities'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dsgvo/dashboard'] });
      toast.success('Verarbeitungstaetigkeit erstellt');
      setShowActivityDialog(false);
      setEditingActivity(null);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Fehler beim Erstellen');
    },
  });

  const updateActivityMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      await apiRequest('PUT', `/api/dsgvo/processing-activities/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/dsgvo/processing-activities'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dsgvo/dashboard'] });
      toast.success('Verarbeitungstaetigkeit aktualisiert');
      setShowActivityDialog(false);
      setEditingActivity(null);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Fehler beim Aktualisieren');
    },
  });

  const deleteActivityMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/dsgvo/processing-activities/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/dsgvo/processing-activities'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dsgvo/dashboard'] });
      toast.success('Verarbeitungstaetigkeit deaktiviert');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Fehler beim Deaktivieren');
    },
  });

  const createRetentionMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      await apiRequest('POST', '/api/dsgvo/retention-policies', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/dsgvo/retention-policies'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dsgvo/dashboard'] });
      toast.success('Loeschfrist erstellt');
      setShowRetentionDialog(false);
      setEditingRetention(null);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Fehler beim Erstellen');
    },
  });

  const updateRetentionMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      await apiRequest('PUT', `/api/dsgvo/retention-policies/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/dsgvo/retention-policies'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dsgvo/dashboard'] });
      toast.success('Loeschfrist aktualisiert');
      setShowRetentionDialog(false);
      setEditingRetention(null);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Fehler beim Aktualisieren');
    },
  });

  const executeRetentionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/dsgvo/retention-policies/execute');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/dsgvo/retention-policies'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dsgvo/dashboard'] });
      toast.success(`Loeschfrist-Pruefung abgeschlossen: ${data.policiesChecked} Richtlinien geprueft`);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Fehler bei der Pruefung');
    },
  });

  if (dashboardLoading) {
    return (
      <MainLayout title="DSGVO-Compliance" subtitle="Datenschutz-Grundverordnung">
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-96" />
        </div>
      </MainLayout>
    );
  }

  const dashboardData = dashboard ?? {
    totalConsents: 0,
    activeConsents: 0,
    revokedConsents: 0,
    processingActivitiesCount: 0,
    retentionPoliciesCount: 0,
    pendingRetention: 0,
    lastReviewDate: null,
    complianceScore: 0,
  };

  const warnings = getComplianceWarnings(dashboardData);

  return (
    <MainLayout title="DSGVO-Compliance" subtitle="Datenschutz-Grundverordnung - Verwaltung und Dokumentation">
      <div className="max-w-7xl mx-auto space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-6 flex-wrap" data-testid="tabs-dsgvo">
            <TabsTrigger value="overview" data-testid="tab-overview">
              <Shield className="h-4 w-4 mr-2" />
              Uebersicht
            </TabsTrigger>
            <TabsTrigger value="consent" data-testid="tab-consent">
              <CheckCircle className="h-4 w-4 mr-2" />
              Einwilligungen
            </TabsTrigger>
            <TabsTrigger value="processing" data-testid="tab-processing">
              <FileText className="h-4 w-4 mr-2" />
              Verarbeitungstaetigkeiten
            </TabsTrigger>
            <TabsTrigger value="retention" data-testid="tab-retention">
              <Clock className="h-4 w-4 mr-2" />
              Loeschfristen
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Overview */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="md:col-span-1">
                <CardHeader className="pb-2">
                  <CardDescription>Compliance-Score</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col items-center justify-center py-4">
                  <div className={`text-6xl font-bold ${getComplianceColor(dashboardData.complianceScore)}`} data-testid="text-compliance-score">
                    {dashboardData.complianceScore}%
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    {dashboardData.complianceScore >= 80 ? 'Guter Stand' :
                     dashboardData.complianceScore >= 50 ? 'Verbesserungsbedarf' :
                     'Dringender Handlungsbedarf'}
                  </p>
                  {dashboardData.lastReviewDate && (
                    <div className="flex items-center gap-1 mt-3 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      <span>Letzte Ueberpruefung: {format(new Date(dashboardData.lastReviewDate), 'dd.MM.yyyy', { locale: de })}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="md:col-span-2 grid grid-cols-2 lg:grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Einwilligungen gesamt</CardDescription>
                    <CardTitle className="text-2xl flex items-center gap-2">
                      <CheckCircle className="h-5 w-5 text-primary" />
                      <span data-testid="text-total-consents">{dashboardData.totalConsents}</span>
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Aktive Einwilligungen</CardDescription>
                    <CardTitle className="text-2xl flex items-center gap-2">
                      <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                      <span data-testid="text-active-consents">{dashboardData.activeConsents}</span>
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Verarbeitungstaetigkeiten</CardDescription>
                    <CardTitle className="text-2xl flex items-center gap-2">
                      <FileText className="h-5 w-5 text-primary" />
                      <span data-testid="text-processing-count">{dashboardData.processingActivitiesCount}</span>
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Loeschfristen</CardDescription>
                    <CardTitle className="text-2xl flex items-center gap-2">
                      <Clock className="h-5 w-5 text-primary" />
                      <span data-testid="text-retention-count">{dashboardData.retentionPoliciesCount}</span>
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Ausstehende Pruefungen</CardDescription>
                    <CardTitle className="text-2xl flex items-center gap-2">
                      <AlertTriangle className={`h-5 w-5 ${dashboardData.pendingRetention > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-muted-foreground'}`} />
                      <span data-testid="text-pending-retention">{dashboardData.pendingRetention}</span>
                    </CardTitle>
                  </CardHeader>
                </Card>
              </div>
            </div>

            {warnings.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                    Empfehlungen und Hinweise
                  </CardTitle>
                  <CardDescription>
                    Handlungsempfehlungen zur Verbesserung der DSGVO-Compliance
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3" data-testid="list-warnings">
                    {warnings.map((warning, idx) => (
                      <li key={idx} className="flex items-start gap-3 text-sm">
                        <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
                        <span>{warning}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Tab 2: Consent Management */}
          <TabsContent value="consent" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <CheckCircle className="h-5 w-5" />
                      Einwilligungsverwaltung
                    </CardTitle>
                    <CardDescription>
                      Alle erfassten Einwilligungen gemaess Art. 7 DSGVO
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {consentsLoading ? (
                  <Skeleton className="h-48" />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Typ</TableHead>
                          <TableHead>Version</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Datum</TableHead>
                          <TableHead>IP-Adresse</TableHead>
                          <TableHead className="text-right">Aktionen</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {!consents || consents.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                              Keine Einwilligungen vorhanden
                            </TableCell>
                          </TableRow>
                        ) : (
                          consents.map((consent) => (
                            <TableRow key={consent.id} data-testid={`row-consent-${consent.id}`}>
                              <TableCell className="font-medium">{consent.consentType}</TableCell>
                              <TableCell>{consent.consentVersion}</TableCell>
                              <TableCell>
                                {consent.revokedAt ? (
                                  <Badge variant="destructive" data-testid={`badge-consent-status-${consent.id}`}>Widerrufen</Badge>
                                ) : consent.granted ? (
                                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid={`badge-consent-status-${consent.id}`}>Erteilt</Badge>
                                ) : (
                                  <Badge variant="outline" data-testid={`badge-consent-status-${consent.id}`}>Ausstehend</Badge>
                                )}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                {format(new Date(consent.createdAt), 'dd.MM.yyyy HH:mm', { locale: de })}
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {consent.ipAddress || '-'}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    data-testid={`button-view-consent-${consent.id}`}
                                    onClick={() => {
                                      setSelectedConsent(consent);
                                      setShowConsentDetail(true);
                                    }}
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                  {consent.granted && !consent.revokedAt && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      data-testid={`button-revoke-consent-${consent.id}`}
                                      onClick={() => revokeMutation.mutate(consent.id)}
                                      disabled={revokeMutation.isPending}
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab 3: Processing Activities */}
          <TabsContent value="processing" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      Verzeichnis der Verarbeitungstaetigkeiten
                    </CardTitle>
                    <CardDescription>
                      Gemaess Art. 30 DSGVO - Verzeichnis aller Datenverarbeitungen
                    </CardDescription>
                  </div>
                  <Button
                    data-testid="button-add-activity"
                    onClick={() => {
                      setEditingActivity(null);
                      setShowActivityDialog(true);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Neue Taetigkeit
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {activitiesLoading ? (
                  <Skeleton className="h-48" />
                ) : !activities || activities.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Database className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p className="text-lg font-medium mb-2">Keine Verarbeitungstaetigkeiten erfasst</p>
                    <p className="text-sm mb-4">Erstellen Sie Ihr Verarbeitungsverzeichnis gemaess Art. 30 DSGVO</p>
                    <Button
                      data-testid="button-add-activity-empty"
                      onClick={() => {
                        setEditingActivity(null);
                        setShowActivityDialog(true);
                      }}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Erste Taetigkeit anlegen
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {activities.map((activity) => (
                      <Card key={activity.id} data-testid={`card-activity-${activity.id}`}>
                        <CardContent className="pt-4">
                          <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                            <div className="flex-1 space-y-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-semibold text-base">{activity.name}</h3>
                                {activity.dpiaConducted && (
                                  <Badge variant="outline" className="text-xs">
                                    <Shield className="h-3 w-3 mr-1" />
                                    DSFA durchgefuehrt
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground">{activity.purpose}</p>
                              <div className="flex flex-wrap gap-2 items-center">
                                <span className="text-xs text-muted-foreground">Rechtsgrundlage:</span>
                                <Badge variant="outline">{activity.legalBasis}</Badge>
                              </div>
                              {activity.dataCategories && activity.dataCategories.length > 0 && (
                                <div className="flex flex-wrap gap-1 items-center">
                                  <span className="text-xs text-muted-foreground mr-1">Datenkategorien:</span>
                                  {activity.dataCategories.map((cat, idx) => (
                                    <Badge key={idx} variant="secondary">{cat}</Badge>
                                  ))}
                                </div>
                              )}
                              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  Aufbewahrung: {activity.retentionPeriod}
                                </span>
                                {activity.lastReviewDate && (
                                  <span className="flex items-center gap-1">
                                    <Calendar className="h-3 w-3" />
                                    Letzte Pruefung: {format(new Date(activity.lastReviewDate), 'dd.MM.yyyy', { locale: de })}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                data-testid={`button-edit-activity-${activity.id}`}
                                onClick={() => {
                                  setEditingActivity(activity);
                                  setShowActivityDialog(true);
                                }}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                data-testid={`button-delete-activity-${activity.id}`}
                                onClick={() => deleteActivityMutation.mutate(activity.id)}
                                disabled={deleteActivityMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab 4: Retention Policies */}
          <TabsContent value="retention" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Clock className="h-5 w-5" />
                      Loeschfristen und Aufbewahrungsrichtlinien
                    </CardTitle>
                    <CardDescription>
                      Verwaltung der Datenaufbewahrung gemaess Art. 5 Abs. 1 lit. e DSGVO
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      data-testid="button-execute-retention"
                      onClick={() => executeRetentionMutation.mutate()}
                      disabled={executeRetentionMutation.isPending}
                    >
                      <Play className="h-4 w-4 mr-2" />
                      {executeRetentionMutation.isPending ? 'Pruefe...' : 'Loeschpruefung starten'}
                    </Button>
                    <Button
                      data-testid="button-add-retention"
                      onClick={() => {
                        setEditingRetention(null);
                        setShowRetentionDialog(true);
                      }}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Neue Loeschfrist
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {retentionLoading ? (
                  <Skeleton className="h-48" />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Datenkategorie</TableHead>
                          <TableHead>Aufbewahrungsdauer</TableHead>
                          <TableHead>Rechtsgrundlage</TableHead>
                          <TableHead>Auto-Loeschung</TableHead>
                          <TableHead>Letzte Pruefung</TableHead>
                          <TableHead className="text-right">Aktionen</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {!retentionPolicies || retentionPolicies.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                              Keine Loeschfristen definiert
                            </TableCell>
                          </TableRow>
                        ) : (
                          retentionPolicies.map((policy) => (
                            <TableRow key={policy.id} data-testid={`row-retention-${policy.id}`}>
                              <TableCell className="font-medium capitalize">{policy.dataCategory}</TableCell>
                              <TableCell>{formatDays(policy.retentionDays)}</TableCell>
                              <TableCell>
                                <Badge variant="outline">{policy.legalBasis}</Badge>
                              </TableCell>
                              <TableCell>
                                <Switch
                                  checked={policy.autoDelete}
                                  data-testid={`switch-auto-delete-${policy.id}`}
                                  onCheckedChange={(checked) => {
                                    updateRetentionMutation.mutate({
                                      id: policy.id,
                                      data: { autoDelete: checked },
                                    });
                                  }}
                                />
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                                {policy.lastExecutedAt
                                  ? format(new Date(policy.lastExecutedAt), 'dd.MM.yyyy HH:mm', { locale: de })
                                  : 'Noch nicht ausgefuehrt'}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  data-testid={`button-edit-retention-${policy.id}`}
                                  onClick={() => {
                                    setEditingRetention(policy);
                                    setShowRetentionDialog(true);
                                  }}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Consent Detail Dialog */}
      <Dialog open={showConsentDetail} onOpenChange={setShowConsentDetail}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5" />
              Einwilligung Details
            </DialogTitle>
            <DialogDescription>Detaillierte Informationen zur Einwilligung</DialogDescription>
          </DialogHeader>
          {selectedConsent && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Typ</p>
                  <p className="font-medium">{selectedConsent.consentType}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Version</p>
                  <p className="font-medium">{selectedConsent.consentVersion}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  {selectedConsent.revokedAt ? (
                    <Badge variant="destructive">Widerrufen</Badge>
                  ) : selectedConsent.granted ? (
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Erteilt</Badge>
                  ) : (
                    <Badge variant="outline">Ausstehend</Badge>
                  )}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Datum</p>
                  <p className="font-medium">
                    {format(new Date(selectedConsent.createdAt), 'dd.MM.yyyy HH:mm:ss', { locale: de })}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">IP-Adresse</p>
                  <p className="font-mono text-sm">{selectedConsent.ipAddress || '-'}</p>
                </div>
                {selectedConsent.legalBasis && (
                  <div>
                    <p className="text-sm text-muted-foreground">Rechtsgrundlage</p>
                    <p className="font-medium">{selectedConsent.legalBasis}</p>
                  </div>
                )}
                {selectedConsent.revokedAt && (
                  <div>
                    <p className="text-sm text-muted-foreground">Widerrufen am</p>
                    <p className="font-medium">
                      {format(new Date(selectedConsent.revokedAt), 'dd.MM.yyyy HH:mm:ss', { locale: de })}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Processing Activity Dialog */}
      <ActivityDialog
        open={showActivityDialog}
        onOpenChange={setShowActivityDialog}
        activity={editingActivity}
        onSubmit={(data) => {
          if (editingActivity) {
            updateActivityMutation.mutate({ id: editingActivity.id, data });
          } else {
            createActivityMutation.mutate(data);
          }
        }}
        isPending={createActivityMutation.isPending || updateActivityMutation.isPending}
      />

      {/* Retention Policy Dialog */}
      <RetentionDialog
        open={showRetentionDialog}
        onOpenChange={setShowRetentionDialog}
        policy={editingRetention}
        onSubmit={(data) => {
          if (editingRetention) {
            updateRetentionMutation.mutate({ id: editingRetention.id, data });
          } else {
            createRetentionMutation.mutate(data);
          }
        }}
        isPending={createRetentionMutation.isPending || updateRetentionMutation.isPending}
      />
    </MainLayout>
  );
}

function ActivityDialog({
  open,
  onOpenChange,
  activity,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity: ProcessingActivity | null;
  onSubmit: (data: Record<string, unknown>) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [legalBasis, setLegalBasis] = useState('');
  const [dataCategories, setDataCategories] = useState('');
  const [retentionPeriod, setRetentionPeriod] = useState('');
  const [responsiblePerson, setResponsiblePerson] = useState('');
  const [dpiaConducted, setDpiaConducted] = useState(false);

  const resetForm = () => {
    if (activity) {
      setName(activity.name);
      setPurpose(activity.purpose);
      setLegalBasis(activity.legalBasis);
      setDataCategories((activity.dataCategories || []).join(', '));
      setRetentionPeriod(activity.retentionPeriod);
      setResponsiblePerson(activity.responsiblePerson || '');
      setDpiaConducted(activity.dpiaConducted);
    } else {
      setName('');
      setPurpose('');
      setLegalBasis('');
      setDataCategories('');
      setRetentionPeriod('');
      setResponsiblePerson('');
      setDpiaConducted(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) resetForm();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {activity ? 'Verarbeitungstaetigkeit bearbeiten' : 'Neue Verarbeitungstaetigkeit'}
          </DialogTitle>
          <DialogDescription>
            Erfassen Sie die Details der Datenverarbeitung gemaess Art. 30 DSGVO
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="activity-name">Name der Verarbeitung *</Label>
            <Input
              id="activity-name"
              data-testid="input-activity-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Mieterdatenverwaltung"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="activity-purpose">Zweck der Verarbeitung *</Label>
            <Textarea
              id="activity-purpose"
              data-testid="input-activity-purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Beschreiben Sie den Zweck der Datenverarbeitung"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="activity-legal-basis">Rechtsgrundlage *</Label>
            <Select value={legalBasis} onValueChange={setLegalBasis}>
              <SelectTrigger data-testid="select-activity-legal-basis">
                <SelectValue placeholder="Rechtsgrundlage waehlen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Art. 6 Abs. 1 lit. a DSGVO - Einwilligung">Einwilligung (Art. 6 Abs. 1 lit. a)</SelectItem>
                <SelectItem value="Art. 6 Abs. 1 lit. b DSGVO - Vertragserfüllung">Vertragserfllung (Art. 6 Abs. 1 lit. b)</SelectItem>
                <SelectItem value="Art. 6 Abs. 1 lit. c DSGVO - Rechtliche Verpflichtung">Rechtliche Verpflichtung (Art. 6 Abs. 1 lit. c)</SelectItem>
                <SelectItem value="Art. 6 Abs. 1 lit. f DSGVO - Berechtigtes Interesse">Berechtigtes Interesse (Art. 6 Abs. 1 lit. f)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="activity-categories">Datenkategorien (kommagetrennt)</Label>
            <Input
              id="activity-categories"
              data-testid="input-activity-categories"
              value={dataCategories}
              onChange={(e) => setDataCategories(e.target.value)}
              placeholder="z.B. Stammdaten, Kontaktdaten, Finanzdaten"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="activity-retention">Aufbewahrungsfrist *</Label>
            <Input
              id="activity-retention"
              data-testid="input-activity-retention"
              value={retentionPeriod}
              onChange={(e) => setRetentionPeriod(e.target.value)}
              placeholder="z.B. 7 Jahre nach Vertragsende"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="activity-responsible">Verantwortliche Person</Label>
            <Input
              id="activity-responsible"
              data-testid="input-activity-responsible"
              value={responsiblePerson}
              onChange={(e) => setResponsiblePerson(e.target.value)}
              placeholder="Name der verantwortlichen Person"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="activity-dpia"
              data-testid="switch-activity-dpia"
              checked={dpiaConducted}
              onCheckedChange={setDpiaConducted}
            />
            <Label htmlFor="activity-dpia">Datenschutz-Folgenabschaetzung (DSFA) durchgefuehrt</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-activity">
            Abbrechen
          </Button>
          <Button
            data-testid="button-save-activity"
            onClick={() => {
              if (!name || !purpose || !legalBasis || !retentionPeriod) {
                toast.error('Bitte fuellen Sie alle Pflichtfelder aus');
                return;
              }
              onSubmit({
                name,
                purpose,
                legalBasis,
                dataCategories: dataCategories.split(',').map((c) => c.trim()).filter(Boolean),
                retentionPeriod,
                responsiblePerson: responsiblePerson || null,
                dpiaConducted,
              });
            }}
            disabled={isPending}
          >
            {isPending ? 'Speichere...' : activity ? 'Aktualisieren' : 'Erstellen'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RetentionDialog({
  open,
  onOpenChange,
  policy,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policy: RetentionPolicy | null;
  onSubmit: (data: Record<string, unknown>) => void;
  isPending: boolean;
}) {
  const [dataCategory, setDataCategory] = useState('');
  const [retentionDays, setRetentionDays] = useState('');
  const [legalBasis, setLegalBasis] = useState('');
  const [autoDelete, setAutoDelete] = useState(false);
  const [notifyBeforeDays, setNotifyBeforeDays] = useState('30');

  const resetForm = () => {
    if (policy) {
      setDataCategory(policy.dataCategory);
      setRetentionDays(String(policy.retentionDays));
      setLegalBasis(policy.legalBasis);
      setAutoDelete(policy.autoDelete);
      setNotifyBeforeDays(String(policy.notifyBeforeDays));
    } else {
      setDataCategory('');
      setRetentionDays('');
      setLegalBasis('');
      setAutoDelete(false);
      setNotifyBeforeDays('30');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) resetForm();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            {policy ? 'Loeschfrist bearbeiten' : 'Neue Loeschfrist'}
          </DialogTitle>
          <DialogDescription>
            Definieren Sie Aufbewahrungsfristen fuer Datenkategorien
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="retention-category">Datenkategorie *</Label>
            <Select value={dataCategory} onValueChange={setDataCategory}>
              <SelectTrigger data-testid="select-retention-category">
                <SelectValue placeholder="Kategorie waehlen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mieterdaten">Mieterdaten</SelectItem>
                <SelectItem value="finanzdaten">Finanzdaten</SelectItem>
                <SelectItem value="kommunikation">Kommunikation</SelectItem>
                <SelectItem value="dokumente">Dokumente</SelectItem>
                <SelectItem value="stammdaten">Stammdaten</SelectItem>
                <SelectItem value="vertragsdaten">Vertragsdaten</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="retention-days">Aufbewahrungsdauer (Tage) *</Label>
            <Input
              id="retention-days"
              type="number"
              data-testid="input-retention-days"
              value={retentionDays}
              onChange={(e) => setRetentionDays(e.target.value)}
              placeholder="z.B. 2557 (7 Jahre)"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="retention-legal-basis">Rechtsgrundlage *</Label>
            <Select value={legalBasis} onValueChange={setLegalBasis}>
              <SelectTrigger data-testid="select-retention-legal-basis">
                <SelectValue placeholder="Rechtsgrundlage waehlen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BAO § 132 - 7 Jahre Aufbewahrung">BAO Paragraph 132 - 7 Jahre Aufbewahrung</SelectItem>
                <SelectItem value="UGB § 212 - 7 Jahre Aufbewahrung">UGB Paragraph 212 - 7 Jahre Aufbewahrung</SelectItem>
                <SelectItem value="MRG - Mietrechtsgesetz">MRG - Mietrechtsgesetz</SelectItem>
                <SelectItem value="DSGVO Art. 5 - Speicherbegrenzung">DSGVO Art. 5 - Speicherbegrenzung</SelectItem>
                <SelectItem value="DSGVO Art. 17 - Recht auf Löschung">DSGVO Art. 17 - Recht auf Loeschung</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="retention-notify">Benachrichtigung vor Loeschung (Tage)</Label>
            <Input
              id="retention-notify"
              type="number"
              data-testid="input-retention-notify"
              value={notifyBeforeDays}
              onChange={(e) => setNotifyBeforeDays(e.target.value)}
              placeholder="30"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="retention-auto-delete"
              data-testid="switch-retention-auto-delete"
              checked={autoDelete}
              onCheckedChange={setAutoDelete}
            />
            <Label htmlFor="retention-auto-delete">Automatische Loeschung aktivieren</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-retention">
            Abbrechen
          </Button>
          <Button
            data-testid="button-save-retention"
            onClick={() => {
              if (!dataCategory || !retentionDays || !legalBasis) {
                toast.error('Bitte fuellen Sie alle Pflichtfelder aus');
                return;
              }
              onSubmit({
                dataCategory,
                retentionDays: parseInt(retentionDays, 10),
                legalBasis,
                autoDelete,
                notifyBeforeDays: parseInt(notifyBeforeDays, 10) || 30,
              });
            }}
            disabled={isPending}
          >
            {isPending ? 'Speichere...' : policy ? 'Aktualisieren' : 'Erstellen'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
