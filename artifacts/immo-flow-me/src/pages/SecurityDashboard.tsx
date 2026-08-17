import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Shield,
  Monitor,
  Smartphone,
  Tablet,
  Globe,
  Clock,
  Trash2,
  AlertTriangle,
  CheckCircle,
  LogOut,
  Key,
  Lock,
} from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

interface DashboardData {
  activeSessions: number;
  lastLoginAt: string | null;
  securityEvents: SecurityEvent[];
  passwordLastChanged: string | null;
  twoFactorEnabled: boolean;
  securityScore: number;
}

interface SecurityEvent {
  id: string;
  action: string;
  tableName?: string;
  table_name?: string;
  ipAddress?: string;
  ip_address?: string;
  createdAt?: string;
  created_at?: string;
  oldData?: unknown;
  old_data?: unknown;
  newData?: unknown;
  new_data?: unknown;
  userAgent?: string;
  user_agent?: string;
}

interface Session {
  id: string;
  sessionId: string;
  userId: string;
  ipAddress: string;
  userAgent: string;
  deviceType: string;
  browser: string;
  os: string;
  isActive: boolean;
  isCurrent: boolean;
  lastActivityAt: string;
  createdAt: string;
}

function getDeviceIcon(deviceType: string) {
  switch (deviceType) {
    case 'mobile':
      return <Smartphone className="h-4 w-4" />;
    case 'tablet':
      return <Tablet className="h-4 w-4" />;
    default:
      return <Monitor className="h-4 w-4" />;
  }
}

function getDeviceLabel(deviceType: string) {
  switch (deviceType) {
    case 'mobile':
      return 'Mobil';
    case 'tablet':
      return 'Tablet';
    default:
      return 'Desktop';
  }
}

function getEventTypeBadge(action: string) {
  if (action.includes('login') && action.includes('failed')) {
    return <Badge variant="destructive" data-testid={`badge-event-${action}`}>Fehlgeschlagener Login</Badge>;
  }
  if (action.includes('login') || action === 'create') {
    return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid={`badge-event-${action}`}>Login</Badge>;
  }
  if (action.includes('logout')) {
    return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" data-testid={`badge-event-${action}`}>Logout</Badge>;
  }
  if (action.includes('password')) {
    return <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" data-testid={`badge-event-${action}`}>Passwort-Aenderung</Badge>;
  }
  return <Badge variant="outline" data-testid={`badge-event-${action}`}>{action}</Badge>;
}

function getScoreColor(score: number) {
  if (score >= 80) return 'text-green-600 dark:text-green-400';
  if (score >= 60) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function getScoreBarColor(score: number) {
  if (score >= 80) return 'bg-green-500';
  if (score >= 60) return 'bg-yellow-500';
  return 'bg-red-500';
}

function getRecommendations(score: number, data: DashboardData) {
  const recommendations: { icon: typeof Shield; text: string; done: boolean }[] = [];

  recommendations.push({
    icon: Lock,
    text: 'Sicheres Passwort verwenden',
    done: score >= 60,
  });

  recommendations.push({
    icon: Key,
    text: 'Zwei-Faktor-Authentifizierung aktivieren (in Kuerze verfuegbar)',
    done: data.twoFactorEnabled,
  });

  recommendations.push({
    icon: Monitor,
    text: 'Nicht mehr als 3 aktive Sitzungen gleichzeitig',
    done: Number(data.activeSessions) <= 3,
  });

  recommendations.push({
    icon: Shield,
    text: 'Unbekannte Sitzungen regelmaessig ueberpruefen',
    done: Number(data.activeSessions) === 1,
  });

  return recommendations;
}

export default function SecurityDashboard() {
  const [sessionToTerminate, setSessionToTerminate] = useState<string | null>(null);
  const [showBulkTerminate, setShowBulkTerminate] = useState(false);
  const [eventFilter, setEventFilter] = useState<string>('all');

  const { data: dashboardData, isLoading: dashboardLoading } = useQuery<DashboardData>({
    queryKey: ['/api/security/dashboard'],
  });

  const { data: sessions, isLoading: sessionsLoading } = useQuery<Session[]>({
    queryKey: ['/api/security/sessions'],
  });

  const terminateSession = useMutation({
    mutationFn: async (sessionId: string) => {
      await apiRequest('DELETE', `/api/security/sessions/${sessionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/security/sessions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/security/dashboard'] });
      toast.success('Sitzung wurde beendet');
      setSessionToTerminate(null);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Fehler beim Beenden der Sitzung');
    },
  });

  const terminateAllOtherSessions = useMutation({
    mutationFn: async () => {
      await apiRequest('DELETE', '/api/security/sessions');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/security/sessions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/security/dashboard'] });
      toast.success('Alle anderen Sitzungen wurden beendet');
      setShowBulkTerminate(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Fehler beim Beenden der Sitzungen');
    },
  });

  const filteredEvents = dashboardData?.securityEvents?.filter((event) => {
    if (eventFilter === 'all') return true;
    const action = event.action || '';
    return action.includes(eventFilter);
  }) ?? [];

  if (dashboardLoading) {
    return (
      <MainLayout title="Sicherheit" subtitle="Sicherheitseinstellungen und Sitzungsverwaltung">
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
          <Skeleton className="h-96" />
        </div>
      </MainLayout>
    );
  }

  const score = dashboardData?.securityScore ?? 0;
  const recommendations = dashboardData ? getRecommendations(score, dashboardData) : [];

  return (
    <MainLayout title="Sicherheit" subtitle="Sicherheitseinstellungen und Sitzungsverwaltung">
      <div className="max-w-6xl mx-auto">
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="mb-6 flex-wrap" data-testid="security-tabs">
            <TabsTrigger value="overview" data-testid="tab-overview">Uebersicht</TabsTrigger>
            <TabsTrigger value="sessions" data-testid="tab-sessions">Aktive Sitzungen</TabsTrigger>
            <TabsTrigger value="events" data-testid="tab-events">Sicherheitsereignisse</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <Card data-testid="card-security-score">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Sicherheitsbewertung
                </CardTitle>
                <CardDescription>Ihr aktueller Sicherheitsstatus</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-6">
                  <div className={`text-5xl font-bold ${getScoreColor(score)}`} data-testid="text-security-score">
                    {score}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm text-muted-foreground mb-2">von 100 Punkten</div>
                    <div className="w-full bg-muted rounded-full h-3">
                      <div
                        className={`h-3 rounded-full transition-all ${getScoreBarColor(score)}`}
                        style={{ width: `${score}%` }}
                        data-testid="progress-security-score"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card data-testid="card-active-sessions">
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-2">
                    <Monitor className="h-4 w-4" />
                    Aktive Sitzungen
                  </CardDescription>
                  <CardTitle className="text-2xl" data-testid="text-active-sessions">
                    {dashboardData?.activeSessions ?? 0}
                  </CardTitle>
                </CardHeader>
              </Card>

              <Card data-testid="card-last-login">
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Letzter Login
                  </CardDescription>
                  <CardTitle className="text-lg" data-testid="text-last-login">
                    {dashboardData?.lastLoginAt
                      ? format(new Date(dashboardData.lastLoginAt), 'dd.MM.yyyy HH:mm', { locale: de })
                      : 'Unbekannt'}
                  </CardTitle>
                </CardHeader>
              </Card>

              <Card data-testid="card-two-factor">
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-2">
                    <Key className="h-4 w-4" />
                    Zwei-Faktor-Auth
                  </CardDescription>
                  <CardTitle className="text-lg flex items-center gap-2">
                    {dashboardData?.twoFactorEnabled ? (
                      <Badge className="bg-green-100 text-green-800">Aktiv</Badge>
                    ) : (
                      <Badge variant="outline" data-testid="badge-2fa-coming-soon">Bald verfuegbar</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
              </Card>

              <Card data-testid="card-password-changed">
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-2">
                    <Lock className="h-4 w-4" />
                    Passwort zuletzt geaendert
                  </CardDescription>
                  <CardTitle className="text-lg" data-testid="text-password-changed">
                    {dashboardData?.passwordLastChanged
                      ? format(new Date(dashboardData.passwordLastChanged), 'dd.MM.yyyy', { locale: de })
                      : 'Unbekannt'}
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>

            <Card data-testid="card-recommendations">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Sicherheitsempfehlungen
                </CardTitle>
                <CardDescription>Verbessern Sie Ihren Sicherheitsstatus</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recommendations.map((rec, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-3 p-3 rounded-md bg-muted/50"
                      data-testid={`recommendation-${index}`}
                    >
                      {rec.done ? (
                        <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
                      )}
                      <span className={rec.done ? 'text-muted-foreground line-through' : ''}>
                        {rec.text}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sessions" className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-semibold">Aktive Sitzungen</h2>
              {sessions && sessions.length > 1 && (
                <Button
                  variant="destructive"
                  onClick={() => setShowBulkTerminate(true)}
                  disabled={terminateAllOtherSessions.isPending}
                  data-testid="button-terminate-all-sessions"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Alle anderen Sitzungen beenden
                </Button>
              )}
            </div>

            {sessionsLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-20" />
                ))}
              </div>
            ) : !sessions || sessions.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  Keine aktiven Sitzungen gefunden
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {sessions.map((session) => (
                  <Card key={session.id} data-testid={`card-session-${session.id}`}>
                    <CardContent className="flex items-center justify-between flex-wrap gap-4 py-4">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center justify-center h-10 w-10 rounded-md bg-muted">
                          {getDeviceIcon(session.deviceType)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium" data-testid={`text-session-browser-${session.id}`}>
                              {session.browser} / {session.os}
                            </span>
                            {session.isCurrent && (
                              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid={`badge-current-session-${session.id}`}>
                                Aktuelle Sitzung
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1">
                              {getDeviceIcon(session.deviceType)}
                              {getDeviceLabel(session.deviceType)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Globe className="h-3 w-3" />
                              {session.ipAddress}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {format(new Date(session.lastActivityAt), 'dd.MM.yyyy HH:mm', { locale: de })}
                            </span>
                          </div>
                        </div>
                      </div>
                      {!session.isCurrent && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSessionToTerminate(session.id)}
                          disabled={terminateSession.isPending}
                          data-testid={`button-terminate-session-${session.id}`}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Abmelden
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="events" className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-semibold">Sicherheitsereignisse</h2>
              <Select value={eventFilter} onValueChange={setEventFilter}>
                <SelectTrigger className="w-[200px]" data-testid="select-event-filter">
                  <SelectValue placeholder="Alle Ereignisse" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Ereignisse</SelectItem>
                  <SelectItem value="login">Login</SelectItem>
                  <SelectItem value="logout">Logout</SelectItem>
                  <SelectItem value="failed">Fehlgeschlagen</SelectItem>
                  <SelectItem value="password">Passwort-Aenderung</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Zeitpunkt</TableHead>
                        <TableHead>Aktion</TableHead>
                        <TableHead>IP-Adresse</TableHead>
                        <TableHead>Details</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredEvents.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                            Keine Sicherheitsereignisse gefunden
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredEvents.map((event) => (
                          <TableRow key={event.id} data-testid={`row-event-${event.id}`}>
                            <TableCell className="whitespace-nowrap">
                              {event.created_at || event.createdAt
                                ? format(
                                    new Date((event.created_at || event.createdAt)!),
                                    'dd.MM.yyyy HH:mm:ss',
                                    { locale: de }
                                  )
                                : '-'}
                            </TableCell>
                            <TableCell>
                              {getEventTypeBadge(event.action)}
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              {event.ip_address || event.ipAddress || '-'}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                              {event.table_name || event.tableName || '-'}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <AlertDialog open={!!sessionToTerminate} onOpenChange={(open) => !open && setSessionToTerminate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sitzung beenden</AlertDialogTitle>
            <AlertDialogDescription>
              Sind Sie sicher, dass Sie diese Sitzung beenden moechten? Der Benutzer wird auf diesem Geraet abgemeldet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-terminate">Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => sessionToTerminate && terminateSession.mutate(sessionToTerminate)}
              data-testid="button-confirm-terminate"
            >
              Sitzung beenden
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showBulkTerminate} onOpenChange={setShowBulkTerminate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Alle anderen Sitzungen beenden</AlertDialogTitle>
            <AlertDialogDescription>
              Sind Sie sicher, dass Sie alle anderen Sitzungen beenden moechten? Sie bleiben nur in der aktuellen Sitzung angemeldet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-bulk-terminate">Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => terminateAllOtherSessions.mutate()}
              data-testid="button-confirm-bulk-terminate"
            >
              Alle beenden
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
