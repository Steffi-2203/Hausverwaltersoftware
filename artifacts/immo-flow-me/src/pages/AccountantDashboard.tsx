import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { 
  AlertCircle, Euro, Clock, Wrench, TrendingUp, 
  Mail, Download, FileText, Calculator, Building2,
  AlertTriangle, CheckCircle, Send, RefreshCw
} from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { RentIndexationCalculator } from '@/components/accountant/RentIndexationCalculator';

interface AccountantDashboardData {
  dunning: {
    overdueAmount: number;
    overdueCount: number;
    byLevel: { level1: number; level2: number; level3: number };
  };
  maintenance: {
    overdueCount: number;
    dueThisWeek: number;
    upcomingCount: number;
  };
  vpiAdjustments: {
    pendingCount: number;
    totalIncrease: number;
  };
  actions: {
    dunning: Array<{
      invoiceId: string;
      tenantName: string;
      propertyName: string;
      amount: number;
      newLevel: number;
    }>;
    maintenance: Array<{
      contractName: string;
      propertyName: string;
      daysUntilDue: number;
      reminderType: string;
    }>;
    vpi: Array<{
      tenantId: string;
      tenantName: string;
      currentRent: number;
      newRent: number;
      percentageIncrease: number;
    }>;
  };
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(amount);
}

export default function AccountantDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [exportYear, setExportYear] = useState(new Date().getFullYear().toString());
  const [exportPeriod, setExportPeriod] = useState('Q1');

  const { data, isLoading, refetch } = useQuery<AccountantDashboardData>({
    queryKey: ['/api/accountant/dashboard'],
  });

  const processDunning = useMutation({
    mutationFn: (sendEmails: boolean) => 
      apiRequest('POST', '/api/dunning/process', { sendEmails }),
    onSuccess: (result: any) => {
      toast({
        title: 'Mahnlauf abgeschlossen',
        description: `${result.processed} Mahnungen verarbeitet, ${result.emailsSent} E-Mails gesendet`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/accountant/dashboard'] });
    },
  });

  const downloadExport = async (format: 'datev' | 'bmd') => {
    const startDate = `${exportYear}-01-01`;
    const endDate = `${exportYear}-12-31`;
    window.open(`/api/export/${format}?startDate=${startDate}&endDate=${endDate}`, '_blank');
  };

  const downloadUst = async () => {
    window.open(`/api/finanzonline/ust-xml?year=${exportYear}&period=${exportPeriod}`, '_blank');
  };

  if (isLoading) {
    return (
      <MainLayout title="Buchhaltung" subtitle="Dashboard">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-8 w-24 mb-2" />
                <Skeleton className="h-4 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      </MainLayout>
    );
  }

  const dunning = data?.dunning || { overdueAmount: 0, overdueCount: 0, byLevel: { level1: 0, level2: 0, level3: 0 } };
  const maintenance = data?.maintenance || { overdueCount: 0, dueThisWeek: 0, upcomingCount: 0 };
  const vpiAdjustments = data?.vpiAdjustments || { pendingCount: 0, totalIncrease: 0 };

  return (
    <MainLayout title="Buchhaltung" subtitle="Dashboard und Übersichten">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Buchhalter-Dashboard</h1>
          <Button variant="outline" onClick={() => refetch()} data-testid="button-refresh">
            <RefreshCw className="h-4 w-4 mr-2" />
            Aktualisieren
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card data-testid="card-dunning-summary">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-red-500/10 flex items-center justify-center">
                  <AlertCircle className="h-5 w-5 text-red-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{formatCurrency(dunning.overdueAmount)}</p>
                  <p className="text-xs text-muted-foreground">{dunning.overdueCount} überfällige Posten</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-dunning-levels">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-orange-500/10 flex items-center justify-center">
                  <Mail className="h-5 w-5 text-orange-500" />
                </div>
                <div>
                  <div className="flex gap-2">
                    <Badge variant="outline" className="text-yellow-600">{dunning.byLevel.level1}</Badge>
                    <Badge variant="outline" className="text-orange-600">{dunning.byLevel.level2}</Badge>
                    <Badge variant="outline" className="text-red-600">{dunning.byLevel.level3}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Mahnstufen 1/2/3</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-maintenance-summary">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <Wrench className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{maintenance.overdueCount + maintenance.dueThisWeek}</p>
                  <p className="text-xs text-muted-foreground">Wartungen fällig</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-vpi-summary">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{vpiAdjustments.pendingCount}</p>
                  <p className="text-xs text-muted-foreground">VPI-Anpassungen ausstehend</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="dunning" className="space-y-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="dunning" data-testid="tab-dunning">Mahnwesen</TabsTrigger>
            <TabsTrigger value="maintenance" data-testid="tab-maintenance">Wartungen</TabsTrigger>
            <TabsTrigger value="vpi" data-testid="tab-vpi">VPI-Anpassungen</TabsTrigger>
            <TabsTrigger value="indexation" data-testid="tab-indexation">MieWeG-Rechner</TabsTrigger>
            <TabsTrigger value="exports" data-testid="tab-exports">Exporte</TabsTrigger>
          </TabsList>

          <TabsContent value="dunning" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Automatisiertes Mahnwesen</span>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      onClick={() => processDunning.mutate(false)}
                      disabled={processDunning.isPending}
                      data-testid="button-process-dunning"
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Mahnstufen aktualisieren
                    </Button>
                    <Button 
                      onClick={() => processDunning.mutate(true)}
                      disabled={processDunning.isPending}
                      data-testid="button-send-dunning"
                    >
                      <Send className="h-4 w-4 mr-2" />
                      Mahnungen versenden
                    </Button>
                  </div>
                </CardTitle>
                <CardDescription>
                  Gestaffelte Mahneskalation mit automatischen Verzugszinsen nach § 1333 ABGB
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data?.actions.dunning && data.actions.dunning.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Mieter</TableHead>
                        <TableHead>Objekt</TableHead>
                        <TableHead className="text-right">Betrag</TableHead>
                        <TableHead>Mahnstufe</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.actions.dunning.map((action, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{action.tenantName}</TableCell>
                          <TableCell>{action.propertyName}</TableCell>
                          <TableCell className="text-right">{formatCurrency(action.amount)}</TableCell>
                          <TableCell>
                            <Badge variant={action.newLevel === 3 ? 'destructive' : action.newLevel === 2 ? 'default' : 'secondary'}>
                              {action.newLevel === 1 ? 'Erinnerung' : `${action.newLevel - 1}. Mahnung`}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle className="h-12 w-12 mx-auto mb-2 text-green-500" />
                    <p>Keine überfälligen Zahlungen</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="maintenance" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Wartungserinnerungen</CardTitle>
                <CardDescription>
                  Automatische Benachrichtigungen für fällige Wartungsverträge
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data?.actions.maintenance && data.actions.maintenance.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Wartungsvertrag</TableHead>
                        <TableHead>Objekt</TableHead>
                        <TableHead>Fälligkeit</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.actions.maintenance.map((item, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{item.contractName}</TableCell>
                          <TableCell>{item.propertyName}</TableCell>
                          <TableCell>
                            {item.daysUntilDue < 0 
                              ? `${Math.abs(item.daysUntilDue)} Tage überfällig` 
                              : `in ${item.daysUntilDue} Tagen`}
                          </TableCell>
                          <TableCell>
                            <Badge variant={
                              item.reminderType === 'overdue' ? 'destructive' : 
                              item.reminderType === 'due' ? 'default' : 'secondary'
                            }>
                              {item.reminderType === 'overdue' ? 'Überfällig' : 
                               item.reminderType === 'due' ? 'Fällig' : 'Anstehend'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle className="h-12 w-12 mx-auto mb-2 text-green-500" />
                    <p>Keine fälligen Wartungen</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="vpi" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>VPI-Indexanpassungen</CardTitle>
                <CardDescription>
                  Automatische Mietanpassungen bei Überschreitung der 5% Schwelle
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data?.actions.vpi && data.actions.vpi.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Mieter</TableHead>
                        <TableHead className="text-right">Aktuelle Miete</TableHead>
                        <TableHead className="text-right">Neue Miete</TableHead>
                        <TableHead className="text-right">Erhöhung</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.actions.vpi.map((item, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{item.tenantName}</TableCell>
                          <TableCell className="text-right">{formatCurrency(item.currentRent)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(item.newRent)}</TableCell>
                          <TableCell className="text-right text-green-600">
                            +{(item.percentageIncrease * 100).toFixed(2)}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle className="h-12 w-12 mx-auto mb-2 text-green-500" />
                    <p>Keine VPI-Anpassungen erforderlich</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="indexation" className="space-y-4">
            <RentIndexationCalculator />
          </TabsContent>

          <TabsContent value="exports" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calculator className="h-5 w-5" />
                    Buchhaltungs-Export
                  </CardTitle>
                  <CardDescription>
                    DATEV oder BMD kompatible Export-Dateien
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Select value={exportYear} onValueChange={setExportYear}>
                      <SelectTrigger className="w-32" data-testid="select-export-year">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[2024, 2025, 2026].map(year => (
                          <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => downloadExport('datev')} data-testid="button-export-datev">
                      <Download className="h-4 w-4 mr-2" />
                      DATEV Export
                    </Button>
                    <Button variant="outline" onClick={() => downloadExport('bmd')} data-testid="button-export-bmd">
                      <Download className="h-4 w-4 mr-2" />
                      BMD Export
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    FinanzOnline
                  </CardTitle>
                  <CardDescription>
                    USt-Voranmeldung für FinanzOnline vorbereiten
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Select value={exportYear} onValueChange={setExportYear}>
                      <SelectTrigger className="w-24" data-testid="select-ust-year">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[2024, 2025, 2026].map(year => (
                          <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={exportPeriod} onValueChange={setExportPeriod}>
                      <SelectTrigger className="w-40" data-testid="select-ust-period">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Q1">1. Quartal</SelectItem>
                        <SelectItem value="Q2">2. Quartal</SelectItem>
                        <SelectItem value="Q3">3. Quartal</SelectItem>
                        <SelectItem value="Q4">4. Quartal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={downloadUst} data-testid="button-export-ust">
                    <Download className="h-4 w-4 mr-2" />
                    USt-Voranmeldung XML
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
