import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Receipt, AlertTriangle, CheckCircle2, TrendingUp, ArrowRight, Search, Link2, Calendar, Euro, Clock, Users, ArrowUpDown, Building2, Download, Pencil } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useProperties } from '@/hooks/useProperties';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { MainLayout } from '@/components/layout/MainLayout';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function formatEur(value: number): string {
  return value.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' });
}

const AGING_COLORS = ['#3b82f6', '#f59e0b', '#f97316', '#ef4444'];

function AbstimmungTab() {
  const [kpiPropertyId, setKpiPropertyId] = useState('all');
  const { data: propertiesList } = useProperties();

  const sortedProperties = useMemo(() => {
    return [...(propertiesList || [])].sort((a: any, b: any) =>
      (a.name || '').localeCompare(b.name || '', 'de')
    );
  }, [propertiesList]);

  const { data: kpis, isLoading } = useQuery({
    queryKey: ['/api/open-items/kpis', kpiPropertyId],
    queryFn: async () => {
      const url = kpiPropertyId !== 'all'
        ? `/api/open-items/kpis?propertyId=${kpiPropertyId}`
        : '/api/open-items/kpis';
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('KPI-Daten konnten nicht geladen werden');
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="loading-kpis">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalOpen = kpis?.totalOpen || 0;
  const totalOpenAmount = Number(kpis?.totalOpenAmount || 0);
  const overdueCount = kpis?.overdueCount || 0;
  const overdueAmount = Number(kpis?.overdueAmount || 0);
  const paymentsLast7DaysCount = kpis?.paymentsLast7DaysCount || 0;
  const paymentsLast7Days = Number(kpis?.paymentsLast7Days || 0);
  const paidCount = kpis?.paidCount || 0;
  const totalCount = kpis?.totalCount || 1;
  const eingangsquote = totalCount > 0 ? Math.round((paidCount / totalCount) * 100) : 0;

  const agingData = [
    { name: '0-30 Tage', amount: Number(kpis?.aging?.['0-30'] || 0) },
    { name: '31-60 Tage', amount: Number(kpis?.aging?.['31-60'] || 0) },
    { name: '61-90 Tage', amount: Number(kpis?.aging?.['61-90'] || 0) },
    { name: '90+ Tage', amount: Number(kpis?.aging?.['90+'] || 0) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <Select value={kpiPropertyId} onValueChange={setKpiPropertyId}>
          <SelectTrigger className="w-[240px]" data-testid="select-kpi-property-filter">
            <SelectValue placeholder="Alle Liegenschaften" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Liegenschaften</SelectItem>
            {sortedProperties.map((p: any) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-kpi-open">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-blue-100 dark:bg-blue-900/30">
                <Receipt className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Offene Forderungen</p>
                <p className="text-xl font-bold" data-testid="text-total-open">{totalOpen}</p>
                <p className="text-sm text-muted-foreground" data-testid="text-total-open-amount">{formatEur(totalOpenAmount)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-overdue">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-red-100 dark:bg-red-900/30">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Ueberfaellige Posten</p>
                <p className="text-xl font-bold text-red-600 dark:text-red-400" data-testid="text-overdue-count">{overdueCount}</p>
                <p className="text-sm text-red-600 dark:text-red-400" data-testid="text-overdue-amount">{formatEur(overdueAmount)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-payments">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-green-100 dark:bg-green-900/30">
                <TrendingUp className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Zahlungseingaenge 7 Tage</p>
                <p className="text-xl font-bold text-green-600 dark:text-green-400" data-testid="text-payments-7d-count">{paymentsLast7DaysCount}</p>
                <p className="text-sm text-green-600 dark:text-green-400" data-testid="text-payments-7d-amount">{formatEur(paymentsLast7Days)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-rate">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-purple-100 dark:bg-purple-900/30">
                <CheckCircle2 className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Eingangsquote</p>
                <p className="text-xl font-bold" data-testid="text-eingangsquote">{eingangsquote}%</p>
                <p className="text-sm text-muted-foreground">{paidCount} von {totalCount} bezahlt</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Altersstruktur offener Posten
          </CardTitle>
          <CardDescription>Verteilung nach Faelligkeitszeitraum</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]" data-testid="chart-aging">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agingData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis tickFormatter={(v) => formatEur(v)} />
                <Tooltip formatter={(value: number) => formatEur(value)} />
                <Bar dataKey="amount" name="Betrag" radius={[4, 4, 0, 0]}>
                  {agingData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={AGING_COLORS[index]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function getDueBadge(dueDate: string | null | undefined) {
  if (!dueDate) return <Badge variant="secondary">Unbekannt</Badge>;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return <Badge variant="destructive" data-testid="badge-overdue">Ueberfaellig</Badge>;
  }
  if (diffDays <= 7) {
    return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" data-testid="badge-due-soon">Faellig in {diffDays} Tagen</Badge>;
  }
  return <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400" data-testid="badge-not-due">Offen</Badge>;
}

const opStatusLabels: Record<string, string> = {
  offen: 'Offen', bezahlt: 'Bezahlt', teilbezahlt: 'Teilbezahlt', ueberfaellig: 'Überfällig',
};
const opStatusStyles: Record<string, string> = {
  offen: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  bezahlt: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  teilbezahlt: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  ueberfaellig: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

function OPListeTab() {
  const [search, setSearch] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortField, setSortField] = useState<string>('dueDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [xlsxDownloading, setXlsxDownloading] = useState(false);
  // Teilbezahlt-Dialog: nur für WEG-Vorschreibungen
  const [teilbezahltDialog, setTeilbezahltDialog] = useState<{
    id: string;
    gesamtbetrag: number;
    existingPaidAmount?: number;
  } | null>(null);
  const [teilbezahltAmount, setTeilbezahltAmount] = useState<string>('');
  const { toast } = useToast();

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const { data: openItems, isLoading } = useQuery({
    queryKey: ['/api/open-items', propertyFilter],
    queryFn: async () => {
      const url = propertyFilter !== 'all'
        ? `/api/open-items?propertyId=${propertyFilter}`
        : '/api/open-items';
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Offene Posten konnten nicht geladen werden');
      return res.json();
    },
  });

  // Mutation: Status einer WEG-Vorschreibung ändern (inkl. paid_amount bei Teilzahlung)
  const statusMut = useMutation({
    mutationFn: async ({ id, status, paidAmount }: { id: string; status: string; paidAmount?: number }) => {
      const body: Record<string, unknown> = { status };
      if (paidAmount !== undefined) body.paid_amount = paidAmount;
      const res = await apiRequest('PATCH', `/api/weg/vorschreibungen/${id}/status`, body);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || 'Fehler beim Aktualisieren');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/open-items'] });
      queryClient.invalidateQueries({ queryKey: ['/api/open-items/kpis'] });
      toast({ title: 'Status aktualisiert' });
    },
    onError: (err: any) => {
      toast({ title: 'Fehler', description: err.message, variant: 'destructive' });
    },
  });

  const handleWegStatusChange = (id: string, newStatus: string, gesamtbetrag: number) => {
    if (newStatus === 'teilbezahlt') {
      setTeilbezahltAmount('');
      setTeilbezahltDialog({ id, gesamtbetrag });
    } else {
      statusMut.mutate({ id, status: newStatus });
    }
  };

  const handleCorrectTeilbezahlt = (id: string, gesamtbetrag: number, existingPaidAmount?: number) => {
    setTeilbezahltAmount(existingPaidAmount != null ? String(existingPaidAmount) : '');
    setTeilbezahltDialog({ id, gesamtbetrag, existingPaidAmount });
  };

  const confirmTeilbezahlt = () => {
    if (!teilbezahltDialog) return;
    const amount = parseFloat(teilbezahltAmount.replace(',', '.'));
    if (isNaN(amount) || amount <= 0 || amount >= teilbezahltDialog.gesamtbetrag) {
      toast({
        title: 'Ungültiger Betrag',
        description: `Betrag muss zwischen 0,01 € und ${formatEur(teilbezahltDialog.gesamtbetrag)} liegen.`,
        variant: 'destructive',
      });
      return;
    }
    statusMut.mutate({ id: teilbezahltDialog.id, status: 'teilbezahlt', paidAmount: amount });
    setTeilbezahltDialog(null);
  };

  const items = useMemo(() => {
    let list = (openItems as any[]) || [];

    if (search) {
      const s = search.toLowerCase();
      list = list.filter((item: any) =>
        (item.mieter || item.tenantName || '').toLowerCase().includes(s) ||
        (item.einheit || item.unitTopNummer || item.unitName || '').toLowerCase().includes(s)
      );
    }

    if (statusFilter !== 'all') {
      list = list.filter((item: any) => (item.status || '').toLowerCase() === statusFilter);
    }

    list = [...list].sort((a: any, b: any) => {
      let valA: any, valB: any;
      switch (sortField) {
        case 'propertyName':
          valA = (a.propertyName || a.property_name || '').toLowerCase();
          valB = (b.propertyName || b.property_name || '').toLowerCase();
          break;
        case 'mieter':
          valA = (a.mieter || a.tenantName || '').toLowerCase();
          valB = (b.mieter || b.tenantName || '').toLowerCase();
          break;
        case 'einheit':
          valA = (a.einheit || a.unitTopNummer || a.unitName || '').toLowerCase();
          valB = (b.einheit || b.unitTopNummer || b.unitName || '').toLowerCase();
          break;
        case 'amount':
          // Sortierung nach offenem Restbetrag (wie angezeigt):
          // bei teilbezahlt = gesamtbetrag − paid_amount, sonst gesamtbetrag
          const outstandingOf = (x: any) => {
            const gross = Number(x.gesamtbetrag || x.totalAmount || 0);
            if (x.status === 'teilbezahlt') {
              const paid = Number(x.paid_amount ?? x.paidAmount ?? 0);
              return Math.max(0, gross - paid);
            }
            return gross;
          };
          valA = outstandingOf(a);
          valB = outstandingOf(b);
          break;
        case 'dueDate':
        default:
          valA = a.faelligAm || a.dueDate || '';
          valB = b.faelligAm || b.dueDate || '';
          break;
      }
      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [openItems, search, statusFilter, sortField, sortDir]);

  const properties = useMemo(() => {
    const map = new Map<string, string>();
    ((openItems as any[]) || []).forEach((item: any) => {
      const id = item.propertyId || item.property_id;
      const name = item.propertyName || item.property_name || id;
      if (id) map.set(id, name);
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], 'de'));
  }, [openItems]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="loading-op-list">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleXlsxExport = async () => {
    setXlsxDownloading(true);
    try {
      const params = new URLSearchParams();
      if (propertyFilter !== 'all') params.set('propertyId', propertyFilter);
      const qs = params.toString() ? `?${params}` : '';
      const response = await fetch(`/api/accounting/export/op-liste${qs}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Export fehlgeschlagen');
      const blob = await response.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `OP-Liste_${new Date().getFullYear()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      toast({ title: 'Export erfolgreich', description: 'OP-Liste wurde heruntergeladen.' });
    } catch {
      toast({ title: 'Export fehlgeschlagen', variant: 'destructive' });
    } finally {
      setXlsxDownloading(false);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Mieter, Eigentümer oder Einheit suchen..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-op"
            />
          </div>
          <Select value={propertyFilter} onValueChange={setPropertyFilter}>
            <SelectTrigger className="w-[200px]" data-testid="select-property-filter">
              <SelectValue placeholder="Alle Objekte" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Objekte</SelectItem>
              {properties.map(([id, name]) => (
                <SelectItem key={id} value={id}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
              <SelectValue placeholder="Alle Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Status</SelectItem>
              <SelectItem value="offen">Offen</SelectItem>
              <SelectItem value="teilbezahlt">Teilbezahlt</SelectItem>
              <SelectItem value="ueberfaellig">Ueberfaellig</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={handleXlsxExport} disabled={xlsxDownloading} data-testid="button-export-op-xlsx">
            {xlsxDownloading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            XLSX Export
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12" data-testid="empty-op-list">
                <Receipt className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Keine offenen Posten</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('propertyName')} data-testid="sort-liegenschaft">
                      <span className="flex items-center gap-1">Liegenschaft <ArrowUpDown className="h-3 w-3" /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('mieter')} data-testid="sort-mieter">
                      <span className="flex items-center gap-1">Mieter / Eigentümer <ArrowUpDown className="h-3 w-3" /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('einheit')} data-testid="sort-einheit">
                      <span className="flex items-center gap-1">Einheit <ArrowUpDown className="h-3 w-3" /></span>
                    </TableHead>
                    <TableHead>Monat/Jahr</TableHead>
                    <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort('amount')} data-testid="sort-amount">
                      <span className="flex items-center justify-end gap-1">Gesamtbetrag <ArrowUpDown className="h-3 w-3" /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('dueDate')} data-testid="sort-due-date">
                      <span className="flex items-center gap-1">Fällig am <ArrowUpDown className="h-3 w-3" /></span>
                    </TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item: any, index: number) => {
                    const id = item.id || index;
                    const isWeg = item.source === 'weg';
                    return (
                      <TableRow key={id} data-testid={`row-op-${id}`}>
                        <TableCell className="text-sm" data-testid={`text-op-liegenschaft-${id}`}>
                          {item.propertyName || item.property_name || '-'}
                        </TableCell>
                        <TableCell className="text-sm" data-testid={`text-op-mieter-${id}`}>
                          <span className="flex items-center gap-1.5 flex-wrap">
                            {isWeg && (
                              <Badge variant="outline" className="text-xs py-0 px-1.5 shrink-0">WEG</Badge>
                            )}
                            {item.mieter || item.tenantName || '-'}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm" data-testid={`text-op-einheit-${id}`}>
                          {item.einheit || item.unitTopNummer || item.unitName || '-'}
                        </TableCell>
                        <TableCell className="text-sm" data-testid={`text-op-period-${id}`}>
                          {item.monat || item.month || '-'}/{item.jahr || item.year || '-'}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium" data-testid={`text-op-amount-${id}`}>
                          {item.status === 'teilbezahlt' ? (() => {
                            const gross = Number(item.gesamtbetrag || item.totalAmount || 0);
                            // paid_amount: WEG liefert snake_case, MI liefert camelCase (Drizzle)
                            const paid = Number(item.paid_amount ?? item.paidAmount ?? 0);
                            const outstanding = Math.max(0, gross - paid);
                            return (
                              <>
                                <span
                                  className="text-orange-600 dark:text-orange-400 font-semibold"
                                  data-testid={`text-op-outstanding-${id}`}
                                  title="Noch offener Restbetrag"
                                >
                                  {formatEur(outstanding)}
                                </span>
                                <span className="block text-xs text-muted-foreground font-normal">
                                  {formatEur(paid)} bez. · {formatEur(gross)} ges.
                                </span>
                              </>
                            );
                          })() : (
                            formatEur(Number(item.gesamtbetrag || item.totalAmount || 0))
                          )}
                        </TableCell>
                        <TableCell className="text-sm" data-testid={`text-op-due-${id}`}>
                          {item.faelligAm || item.dueDate
                            ? new Date(item.faelligAm || item.dueDate).toLocaleDateString('de-AT')
                            : '-'}
                        </TableCell>
                        <TableCell data-testid={`badge-op-status-${id}`}>
                          {isWeg ? (
                            /* WEG-Vorschreibungen: Status per Select änderbar, mit Teilbezahlt-Dialog */
                            <div className="flex items-center gap-1">
                              <Select
                                value={item.status || 'offen'}
                                onValueChange={(newStatus) =>
                                  handleWegStatusChange(id, newStatus, parseFloat(item.gesamtbetrag) || 0)
                                }
                              >
                                <SelectTrigger className="w-[130px]" data-testid={`select-op-status-${id}`}>
                                  <Badge className={opStatusStyles[item.status] || ''}>
                                    {opStatusLabels[item.status] || item.status}
                                  </Badge>
                                </SelectTrigger>
                                <SelectContent>
                                  {Object.entries(opStatusLabels).map(([key, label]) => (
                                    <SelectItem key={key} value={key}>{label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {item.status === 'teilbezahlt' && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 shrink-0"
                                  title={item.paid_amount
                                    ? `Bezahlt: ${formatEur(Number(item.paid_amount))} — Betrag korrigieren`
                                    : 'Teilbetrag noch nicht erfasst — jetzt eingeben'}
                                  data-testid={`button-correct-teilbezahlt-op-${id}`}
                                  onClick={() => handleCorrectTeilbezahlt(
                                    id,
                                    parseFloat(item.gesamtbetrag) || 0,
                                    item.paid_amount ? parseFloat(item.paid_amount) : undefined,
                                  )}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          ) : (
                            /* Mieter-Vorschreibungen: nur Status-Badge (read-only) */
                            getDueBadge(item.faelligAm || item.dueDate)
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

      {/* Teilbezahlt-Dialog (nur für WEG-Vorschreibungen) */}
      <Dialog open={!!teilbezahltDialog} onOpenChange={(open) => { if (!open) setTeilbezahltDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {teilbezahltDialog?.existingPaidAmount != null ? 'Teilbetrag korrigieren' : 'Teilzahlung erfassen'}
            </DialogTitle>
            <DialogDescription>
              Geben Sie den tatsächlich eingegangenen Betrag ein. Der Gesamtbetrag dieser Vorschreibung
              beträgt {teilbezahltDialog ? formatEur(teilbezahltDialog.gesamtbetrag) : ''}.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <div className="space-y-2">
              <Label htmlFor="op-teilbezahlt-amount">Bezahlter Betrag (€)</Label>
              <Input
                id="op-teilbezahlt-amount"
                type="number"
                min="0.01"
                step="0.01"
                max={teilbezahltDialog?.gesamtbetrag ?? undefined}
                placeholder="z.B. 125,00"
                value={teilbezahltAmount}
                onChange={(e) => setTeilbezahltAmount(e.target.value)}
                data-testid="input-op-teilbezahlt-amount"
                autoFocus
              />
            </div>
            {teilbezahltDialog && teilbezahltAmount && (
              <p className="text-sm text-muted-foreground">
                Offener Restbetrag:{' '}
                <span className="font-medium">
                  {formatEur(Math.max(0, teilbezahltDialog.gesamtbetrag - (parseFloat(teilbezahltAmount.replace(',', '.')) || 0)))}
                </span>
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTeilbezahltDialog(null)}>Abbrechen</Button>
            <Button
              onClick={confirmTeilbezahlt}
              disabled={statusMut.isPending}
              data-testid="button-confirm-op-teilbezahlt"
            >
              {statusMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Teilzahlung buchen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function BankMatchTab() {
  const { toast } = useToast();

  const { data: suggestions, isLoading } = useQuery({
    queryKey: ['/api/bank-matching/suggestions'],
    queryFn: async () => {
      const res = await fetch('/api/bank-matching/suggestions', { credentials: 'include' });
      if (!res.ok) throw new Error('Matching-Vorschlaege konnten nicht geladen werden');
      return res.json();
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async ({ paymentId, invoiceId }: { paymentId: string; invoiceId: string }) => {
      const res = await apiRequest('POST', '/api/bank-matching/confirm', { paymentId, invoiceId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bank-matching/suggestions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/open-items'] });
      queryClient.invalidateQueries({ queryKey: ['/api/open-items/kpis'] });
      toast({ title: 'Zahlung zugeordnet', description: 'Die Zuordnung wurde erfolgreich gespeichert.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Zuordnung fehlgeschlagen', description: error.message, variant: 'destructive' });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="loading-bank-match">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const suggestionList = (suggestions as any[]) || [];

  if (suggestionList.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12" data-testid="empty-bank-match">
          <CheckCircle2 className="h-12 w-12 text-green-600 dark:text-green-400 mb-4" />
          <p className="text-muted-foreground font-medium">Alle Zahlungen zugeordnet</p>
          <p className="text-sm text-muted-foreground mt-1">Es gibt keine offenen Zuordnungsvorschlaege</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {suggestionList.length} nicht zugeordnete Zahlung{suggestionList.length !== 1 ? 'en' : ''} gefunden
      </p>
      {suggestionList.map((payment: any, pIdx: number) => {
        const paymentId = payment.id || payment.paymentId || pIdx;
        return (
          <Card key={paymentId} data-testid={`card-match-${paymentId}`}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Euro className="h-4 w-4" />
                    {formatEur(Number(payment.betrag || payment.amount || 0))}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    <span className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {payment.datum || payment.date
                          ? new Date(payment.datum || payment.date).toLocaleDateString('de-AT')
                          : '-'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {payment.verwendungszweck || payment.reference || payment.description || '-'}
                      </span>
                    </span>
                  </CardDescription>
                </div>
                <Badge variant="outline">
                  <Link2 className="h-3 w-3 mr-1" />
                  {(payment.suggestions || payment.matches || []).length} Vorschlaege
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(payment.suggestions || payment.matches || []).map((suggestion: any, sIdx: number) => {
                  const invoiceId = suggestion.id || suggestion.invoiceId || sIdx;
                  return (
                    <div
                      key={invoiceId}
                      className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-md border"
                      data-testid={`row-suggestion-${paymentId}-${invoiceId}`}
                    >
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium" data-testid={`text-suggestion-tenant-${paymentId}-${invoiceId}`}>
                          {suggestion.mieter || suggestion.tenantName || '-'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {suggestion.einheit || suggestion.unitName || '-'} - {suggestion.monat || suggestion.month || '-'}/{suggestion.jahr || suggestion.year || '-'}
                        </p>
                        <p className="text-sm font-medium">
                          {formatEur(Number(suggestion.betrag || suggestion.amount || 0))}
                        </p>
                        {suggestion.score != null && (
                          <Badge variant="secondary" className="text-xs">
                            Konfidenz: {Math.round(suggestion.score * 100)}%
                          </Badge>
                        )}
                      </div>
                      <Button
                        variant="default"
                        onClick={() => confirmMutation.mutate({ paymentId: String(paymentId), invoiceId: String(invoiceId) })}
                        disabled={confirmMutation.isPending}
                        data-testid={`button-match-${paymentId}-${invoiceId}`}
                      >
                        {confirmMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <ArrowRight className="h-4 w-4 mr-2" />
                        )}
                        Zuordnen
                      </Button>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function OffenePosten() {
  const [activeTab, setActiveTab] = useState('abstimmung');

  return (
    <MainLayout title="OP-Management" subtitle="Offene Posten verwalten und abgleichen">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-op-title">OP-Management</h1>
          <p className="text-muted-foreground" data-testid="text-op-subtitle">Offene Posten, Abstimmung und Bank-Matching</p>
        </div>

        <Card className="border-dashed" data-testid="card-ki-hint-op">
          <CardContent className="p-3">
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-primary shrink-0" />
                <span className="font-medium">Tipp:</span>
              </div>
              <span>Die Bank-OP Zuordnung matcht Zahlungen automatisch per IBAN, Betrag und Referenz.</span>
              <span className="text-muted-foreground/50">|</span>
              <Link to="/auto-zuordnung" className="underline underline-offset-2 hover:text-foreground" data-testid="link-op-auto-match">Zur Auto-Zuordnung</Link>
            </div>
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList data-testid="tabs-op">
            <TabsTrigger value="abstimmung" data-testid="tab-op-abstimmung">
              <Receipt className="h-4 w-4 mr-1" />
              Abstimmung
            </TabsTrigger>
            <TabsTrigger value="liste" data-testid="tab-op-liste">
              <Clock className="h-4 w-4 mr-1" />
              OP-Liste
            </TabsTrigger>
            <TabsTrigger value="matching" data-testid="tab-op-matching">
              <Link2 className="h-4 w-4 mr-1" />
              Bank-OP Match
            </TabsTrigger>
          </TabsList>
          <TabsContent value="abstimmung"><AbstimmungTab /></TabsContent>
          <TabsContent value="liste"><OPListeTab /></TabsContent>
          <TabsContent value="matching"><BankMatchTab /></TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}

export default OffenePosten;
