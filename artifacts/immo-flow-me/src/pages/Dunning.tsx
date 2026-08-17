import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertCircle, Mail, Clock, Euro, Users, AlertTriangle, CheckCircle, Send } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { useDunningOverview, getDaysOverdue, DunningCase } from '@/hooks/useDunningOverview';
import { useSendDunning, getDunningStatusLabel, getNextDunningAction } from '@/hooks/useDunning';
import { useProperties } from '@/hooks/useProperties';

export default function Dunning() {
  const [filterMahnstufe, setFilterMahnstufe] = useState<string>('all');
  const [filterProperty, setFilterProperty] = useState<string>('all');
  
  const { data, isLoading } = useDunningOverview();
  const { data: properties } = useProperties();
  const sendDunning = useSendDunning();
  
  const cases = data?.cases || [];
  const stats = data?.stats || { totalCases: 0, totalOpen: 0, totalReminded: 0, totalDunned: 0, totalAmount: 0 };
  
  const filteredCases = cases.filter((c) => {
    if (filterMahnstufe !== 'all' && c.highestMahnstufe !== parseInt(filterMahnstufe)) {
      return false;
    }
    if (filterProperty !== 'all' && c.propertyId !== filterProperty) {
      return false;
    }
    return true;
  });
  
  const handleSendDunning = async (dunningCase: DunningCase) => {
    const nextAction = getNextDunningAction(dunningCase.highestMahnstufe);
    if (!nextAction || !dunningCase.email) return;
    
    // Send for the oldest unpaid invoice
    const oldestInvoice = dunningCase.invoices[0];
    if (!oldestInvoice) return;
    
    await sendDunning.mutateAsync({
      invoiceId: oldestInvoice.id,
      dunningLevel: nextAction.level,
      tenantEmail: dunningCase.email,
      tenantName: dunningCase.tenantName,
      propertyName: dunningCase.propertyName,
      unitNumber: dunningCase.unitNumber,
      amount: dunningCase.totalAmount,
      dueDate: oldestInvoice.faellig_am,
      invoiceMonth: oldestInvoice.month,
      invoiceYear: oldestInvoice.year,
    });
  };
  
  const getMahnstufeColor = (stufe: number) => {
    switch (stufe) {
      case 0: return 'bg-yellow-500';
      case 1: return 'bg-orange-500';
      case 2: return 'bg-red-500';
      default: return 'bg-muted';
    }
  };
  
  return (
    <MainLayout title="Mahnwesen" subtitle="Übersicht und Verwaltung offener Zahlungen">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Mahnwesen</h1>
          <p className="text-muted-foreground">
            Übersicht und Verwaltung offener Zahlungen
          </p>
        </div>
        
        {/* Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                  <Users className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.totalCases}</p>
                  <p className="text-xs text-muted-foreground">Fälle gesamt</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-yellow-500/10 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-yellow-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.totalOpen}</p>
                  <p className="text-xs text-muted-foreground">Noch nicht erinnert</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-orange-500/10 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-orange-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.totalReminded}</p>
                  <p className="text-xs text-muted-foreground">Erinnert</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-red-500/10 flex items-center justify-center">
                  <AlertCircle className="h-5 w-5 text-red-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.totalDunned}</p>
                  <p className="text-xs text-muted-foreground">Gemahnt</p>
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
                  <p className="text-2xl font-bold">
                    {stats.totalAmount.toLocaleString('de-AT', { minimumFractionDigits: 2 })} €
                  </p>
                  <p className="text-xs text-muted-foreground">Offener Betrag</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Filters */}
        <div className="flex gap-4">
          <Select value={filterMahnstufe} onValueChange={setFilterMahnstufe}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Alle Mahnstufen" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Mahnstufen</SelectItem>
              <SelectItem value="0">Noch nicht erinnert</SelectItem>
              <SelectItem value="1">Zahlungserinnerung</SelectItem>
              <SelectItem value="2">Mahnung</SelectItem>
            </SelectContent>
          </Select>
          
          <Select value={filterProperty} onValueChange={setFilterProperty}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Alle Liegenschaften" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Liegenschaften</SelectItem>
              {properties?.map((property) => (
                <SelectItem key={property.id} value={property.id}>
                  {property.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle>Offene Fälle</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-48 flex items-center justify-center">
                <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            ) : filteredCases.length === 0 ? (
              <div className="text-center py-12">
                <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-4" />
                <h3 className="text-lg font-medium">Keine offenen Fälle</h3>
                <p className="text-muted-foreground">
                  {filterMahnstufe !== 'all' || filterProperty !== 'all'
                    ? 'Keine Fälle mit diesen Filterkriterien'
                    : 'Alle Zahlungen sind beglichen'}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mieter</TableHead>
                    <TableHead>Liegenschaft</TableHead>
                    <TableHead>Einheit</TableHead>
                    <TableHead className="text-center">Offene Rechnungen</TableHead>
                    <TableHead className="text-right">Betrag</TableHead>
                    <TableHead className="text-center">Überfällig</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aktion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCases.map((dunningCase) => {
                    const daysOverdue = getDaysOverdue(dunningCase.oldestOverdue);
                    const nextAction = getNextDunningAction(dunningCase.highestMahnstufe);
                    
                    return (
                      <TableRow key={dunningCase.tenantId}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{dunningCase.tenantName}</p>
                            {dunningCase.email && (
                              <p className="text-xs text-muted-foreground">{dunningCase.email}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{dunningCase.propertyName}</TableCell>
                        <TableCell>{dunningCase.unitNumber}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary">{dunningCase.invoices.length}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {dunningCase.totalAmount.toLocaleString('de-AT', { minimumFractionDigits: 2 })} €
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={daysOverdue > 30 ? 'destructive' : 'outline'}>
                            {daysOverdue} Tage
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className={`h-2 w-2 rounded-full ${getMahnstufeColor(dunningCase.highestMahnstufe)}`} />
                            <span className="text-sm">
                              {getDunningStatusLabel(dunningCase.highestMahnstufe)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {nextAction && dunningCase.email ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant={dunningCase.highestMahnstufe === 0 ? 'outline' : 'destructive'}
                                  onClick={() => handleSendDunning(dunningCase)}
                                  disabled={sendDunning.isPending}
                                >
                                  <Send className="h-4 w-4 mr-1" />
                                  {nextAction.label}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>E-Mail an {dunningCase.email} senden</p>
                              </TooltipContent>
                            </Tooltip>
                          ) : !dunningCase.email ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="text-muted-foreground">
                                  <Mail className="h-3 w-3 mr-1" />
                                  Keine E-Mail
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Mieter hat keine E-Mail-Adresse hinterlegt</p>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <Badge variant="secondary">Abgeschlossen</Badge>
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
      </div>
    </MainLayout>
  );
}
