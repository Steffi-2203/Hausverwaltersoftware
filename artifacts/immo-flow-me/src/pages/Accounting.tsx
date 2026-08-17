import { useState, useMemo } from 'react';
import { MonthlyRevenueChart, CategoryPieChart } from '@/components/charts/FinanceChart';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Calculator,
  TrendingUp,
  TrendingDown,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  FileDown,
  BookOpen,
  BarChart3,
  Scale,
  Receipt,
  RotateCcw,
  List,
  Building2,
  Download,
  Loader2,
  CreditCard,
  ArrowRight,
  Upload,
  LinkIcon,
  Sparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAccountCategories, AccountCategory } from '@/hooks/useAccountCategories';
import { useTransactions } from '@/hooks/useTransactions';
import { useBankAccounts } from '@/hooks/useBankAccounts';
import {
  useChartOfAccounts,
  useJournalEntries,
  useTrialBalance,
  useBalanceSheet,
  useProfitLoss,
  useUva,
  useAccountLedger,
  useCreateJournalEntry,
  useStornoJournalEntry,
} from '@/hooks/useAccounting';
import { useProperties } from '@/hooks/useProperties';
import { EaRechnungTab } from '@/components/accounting/EaRechnungTab';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

function formatEur(value: number): string {
  return value.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' });
}

function useXlsxDownload() {
  const [downloading, setDownloading] = useState<string | null>(null);
  const { toast } = useToast();

  const download = async (url: string, filename: string, key: string) => {
    setDownloading(key);
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Export fehlgeschlagen');
      const blob = await response.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      toast({ title: 'Export erfolgreich', description: `${filename} wurde heruntergeladen.` });
    } catch {
      toast({ title: 'Export fehlgeschlagen', variant: 'destructive' });
    } finally {
      setDownloading(null);
    }
  };

  return { download, downloading };
}

function OverviewTab({ selectedYear, selectedMonth, setSelectedYear, setSelectedMonth }: any) {
  const { data: categories, isLoading: catLoading } = useAccountCategories();
  const { data: transactions, isLoading: txLoading } = useTransactions();
  const { data: bankAccounts, isLoading: bankLoading } = useBankAccounts();
  const { toast } = useToast();
  const isLoading = catLoading || txLoading || bankLoading;

  const filteredTransactions = useMemo(() => {
    if (!transactions) return [];
    return transactions.filter((t: any) => {
      const d = new Date(t.transactionDate || t.transaction_date || '');
      if (d.getFullYear() !== selectedYear) return false;
      if (selectedMonth !== 'all' && d.getMonth() + 1 !== Number(selectedMonth)) return false;
      return true;
    });
  }, [transactions, selectedYear, selectedMonth]);

  const categoryMap = useMemo(() => {
    const map = new Map<string, AccountCategory>();
    categories?.forEach((c: any) => map.set(c.id, c));
    return map;
  }, [categories]);

  const summary = useMemo(() => {
    let totalIncome = 0, totalExpenses = 0;
    const incomeByCategory = new Map<string, { name: string; total: number; count: number }>();
    const expenseByCategory = new Map<string, { name: string; total: number; count: number }>();
    for (const t of filteredTransactions) {
      const amount = Number(t.amount);
      const catId = t.categoryId || t.category_id || 'uncategorized';
      const catName = categoryMap.get(catId)?.name || 'Nicht kategorisiert';
      if (amount >= 0) {
        totalIncome += amount;
        const existing = incomeByCategory.get(catId);
        if (existing) { existing.total += amount; existing.count++; }
        else incomeByCategory.set(catId, { name: catName, total: amount, count: 1 });
      } else {
        totalExpenses += Math.abs(amount);
        const existing = expenseByCategory.get(catId);
        if (existing) { existing.total += Math.abs(amount); existing.count++; }
        else expenseByCategory.set(catId, { name: catName, total: Math.abs(amount), count: 1 });
      }
    }
    return {
      totalIncome, totalExpenses, balance: totalIncome - totalExpenses,
      transactionCount: filteredTransactions.length,
      incomeCategories: Array.from(incomeByCategory.values()).sort((a, b) => b.total - a.total),
      expenseCategories: Array.from(expenseByCategory.values()).sort((a, b) => b.total - a.total),
    };
  }, [filteredTransactions, categoryMap]);

  const totalBankBalance = useMemo(() => {
    if (!bankAccounts) return 0;
    return bankAccounts.reduce((sum: number, ba: any) => sum + Number(ba.balance || ba.current_balance || 0), 0);
  }, [bankAccounts]);

  const monthNames = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const monthlyData = useMemo(() => {
    const monthMap = new Map<number, { income: number; expenses: number }>();
    for (let m = 0; m < 12; m++) monthMap.set(m, { income: 0, expenses: 0 });
    for (const t of filteredTransactions) {
      const d = new Date(t.transactionDate || t.transaction_date || '');
      const m = d.getMonth();
      const entry = monthMap.get(m);
      if (!entry) continue;
      const amount = Number(t.amount);
      if (amount >= 0) entry.income += amount; else entry.expenses += Math.abs(amount);
    }
    return Array.from(monthMap.entries()).sort(([a], [b]) => a - b)
      .map(([m, v]) => ({ month: monthNames[m], income: v.income, expenses: v.expenses }));
  }, [filteredTransactions]);

  const expensePieData = useMemo(() => summary.expenseCategories.map(c => ({ name: c.name, value: c.total })), [summary]);

  if (isLoading) return <div className="grid grid-cols-1 md:grid-cols-4 gap-4" data-testid="accounting-loading">{[...Array(4)].map((_, i) => <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>)}</div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-income"><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-md bg-green-100 dark:bg-green-900/30"><TrendingUp className="h-5 w-5 text-green-600 dark:text-green-400" /></div><div><p className="text-sm text-muted-foreground">Einnahmen</p><p className="text-xl font-bold text-green-600 dark:text-green-400" data-testid="text-total-income">{formatEur(summary.totalIncome)}</p></div></div></CardContent></Card>
        <Card data-testid="card-expenses"><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-md bg-red-100 dark:bg-red-900/30"><TrendingDown className="h-5 w-5 text-red-600 dark:text-red-400" /></div><div><p className="text-sm text-muted-foreground">Ausgaben</p><p className="text-xl font-bold text-red-600 dark:text-red-400" data-testid="text-total-expenses">{formatEur(summary.totalExpenses)}</p></div></div></CardContent></Card>
        <Card data-testid="card-balance"><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-md bg-primary/10"><Calculator className="h-5 w-5 text-primary" /></div><div><p className="text-sm text-muted-foreground">Saldo</p><p className={`text-xl font-bold ${summary.balance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} data-testid="text-balance">{formatEur(summary.balance)}</p></div></div></CardContent></Card>
        <Card data-testid="card-bank-accounts"><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-md bg-blue-100 dark:bg-blue-900/30"><Wallet className="h-5 w-5 text-blue-600 dark:text-blue-400" /></div><div><p className="text-sm text-muted-foreground">Bankkonten</p><p className="text-xl font-bold" data-testid="text-bank-balance">{formatEur(totalBankBalance)}</p><p className="text-xs text-muted-foreground" data-testid="text-bank-count">{bankAccounts?.length || 0} Konten</p></div></div></CardContent></Card>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card><CardHeader><CardTitle className="text-base">Monatsverlauf</CardTitle></CardHeader><CardContent><MonthlyRevenueChart data={monthlyData} /></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Ausgabenverteilung</CardTitle></CardHeader><CardContent><CategoryPieChart data={expensePieData} type="expense" /></CardContent></Card>
      </div>
    </div>
  );
}

function JournalTab({ propertyId }: { propertyId?: string }) {
  const { data: entries, isLoading } = useJournalEntries({ propertyId });
  const stornoMutation = useStornoJournalEntry();
  const { toast } = useToast();

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const handleStorno = async (id: string) => {
    try {
      await stornoMutation.mutateAsync(id);
      toast({ title: 'Storno erfolgreich', description: 'Die Buchung wurde storniert.' });
    } catch {
      toast({ title: 'Storno fehlgeschlagen', variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><BookOpen className="h-4 w-4" />Journal ({(entries as any[])?.length || 0} Buchungen)</CardTitle></CardHeader>
      <CardContent className="p-0">
        {!entries || (entries as any[]).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Noch keine Buchungen vorhanden</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Buchungsnr.</TableHead>
                <TableHead>Datum</TableHead>
                <TableHead>Beschreibung</TableHead>
                <TableHead>Belegnr.</TableHead>
                <TableHead className="text-right">Soll</TableHead>
                <TableHead className="text-right">Haben</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(entries as any[]).map((entry: any) => {
                const totalDebit = entry.lines?.reduce((s: number, l: any) => s + Number(l.debit || 0), 0) || 0;
                const totalCredit = entry.lines?.reduce((s: number, l: any) => s + Number(l.credit || 0), 0) || 0;
                return (
                  <TableRow key={entry.id} data-testid={`row-journal-${entry.id}`} className={entry.isStorno ? 'opacity-60' : ''}>
                    <TableCell className="text-sm font-mono" data-testid={`text-journal-nr-${entry.id}`}>{entry.bookingNumber}</TableCell>
                    <TableCell className="text-sm" data-testid={`text-journal-date-${entry.id}`}>{entry.entryDate ? format(new Date(entry.entryDate), 'dd.MM.yyyy', { locale: de }) : '-'}</TableCell>
                    <TableCell className="text-sm max-w-[300px] truncate" data-testid={`text-journal-desc-${entry.id}`}>
                      {entry.isStorno && <Badge variant="destructive" className="mr-2 text-xs">STORNO</Badge>}
                      {entry.description}
                    </TableCell>
                    <TableCell className="text-sm" data-testid={`text-journal-beleg-${entry.id}`}>{entry.belegNummer || '-'}</TableCell>
                    <TableCell className="text-right text-sm font-medium" data-testid={`text-journal-debit-${entry.id}`}>{formatEur(totalDebit)}</TableCell>
                    <TableCell className="text-right text-sm font-medium" data-testid={`text-journal-credit-${entry.id}`}>{formatEur(totalCredit)}</TableCell>
                    <TableCell>
                      {!entry.isStorno && (
                        <Button size="icon" variant="ghost" onClick={() => handleStorno(entry.id)} data-testid={`button-storno-${entry.id}`}>
                          <RotateCcw className="h-4 w-4" />
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
  );
}

function ChartOfAccountsTab() {
  const { data: accounts, isLoading } = useChartOfAccounts();
  const [filter, setFilter] = useState('');

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const filtered = (accounts as any[] || []).filter((a: any) =>
    a.accountNumber.includes(filter) || a.name.toLowerCase().includes(filter.toLowerCase())
  );

  const typeLabels: Record<string, string> = { asset: 'Aktiva', liability: 'Passiva', equity: 'Eigenkapital', revenue: 'Erlöse', expense: 'Aufwand' };
  const typeColors: Record<string, string> = { asset: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400', liability: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400', equity: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400', revenue: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400', expense: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2"><List className="h-4 w-4" />Kontenrahmen ({filtered.length} Konten)</CardTitle>
          <Input placeholder="Konto suchen..." value={filter} onChange={e => setFilter(e.target.value)} className="max-w-[250px]" data-testid="input-account-search" />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Konto-Nr.</TableHead>
              <TableHead>Bezeichnung</TableHead>
              <TableHead>Typ</TableHead>
              <TableHead>Beschreibung</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((a: any) => (
              <TableRow key={a.id} data-testid={`row-account-${a.id}`}>
                <TableCell className="font-mono text-sm font-medium" data-testid={`text-account-nr-${a.id}`}>{a.accountNumber}</TableCell>
                <TableCell className="text-sm" data-testid={`text-account-name-${a.id}`}>{a.name}</TableCell>
                <TableCell><Badge className={typeColors[a.accountType] || ''} data-testid={`badge-account-type-${a.id}`}>{typeLabels[a.accountType] || a.accountType}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate" data-testid={`text-account-desc-${a.id}`}>{a.description || '-'}</TableCell>
                <TableCell>{a.isActive ? <Badge variant="outline">Aktiv</Badge> : <Badge variant="secondary">Inaktiv</Badge>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TrialBalanceTab({ propertyId }: { propertyId?: string }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const { data, isLoading } = useTrialBalance({ from: `${year}-01-01`, to: `${year}-12-31`, propertyId });
  const { download, downloading } = useXlsxDownload();

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const rows = (data as any[]) || [];
  const totalDebit = rows.reduce((s: number, r: any) => s + Number(r.total_debit || 0), 0);
  const totalCredit = rows.reduce((s: number, r: any) => s + Number(r.total_credit || 0), 0);

  const handleXlsxExport = () => {
    const params = new URLSearchParams({ from: `${year}-01-01`, to: `${year}-12-31` });
    if (propertyId) params.set('propertyId', propertyId);
    download(`/api/accounting/export/saldenliste?${params}`, `Saldenliste_${year}.xlsx`, 'saldenliste');
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2"><BarChart3 className="h-4 w-4" />Saldenliste {year}</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleXlsxExport} disabled={downloading === 'saldenliste'} data-testid="button-export-saldenliste-xlsx">
              {downloading === 'saldenliste' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              XLSX Export
            </Button>
            <Select value={year.toString()} onValueChange={v => setYear(Number(v))}>
              <SelectTrigger className="w-[100px]" data-testid="select-trial-year"><SelectValue /></SelectTrigger>
              <SelectContent>{[0,1,2,3,4].map(i => { const y = now.getFullYear() - i; return <SelectItem key={y} value={y.toString()}>{y}</SelectItem>; })}</SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12"><BarChart3 className="h-12 w-12 text-muted-foreground mb-4" /><p className="text-muted-foreground">Keine Kontenbewegungen</p></div>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Konto-Nr.</TableHead><TableHead>Bezeichnung</TableHead><TableHead>Typ</TableHead><TableHead className="text-right">Soll</TableHead><TableHead className="text-right">Haben</TableHead><TableHead className="text-right">Saldo</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r: any) => (
                <TableRow key={r.id} data-testid={`row-trial-${r.id}`}>
                  <TableCell className="font-mono text-sm">{r.account_number}</TableCell>
                  <TableCell className="text-sm">{r.name}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{r.account_type}</Badge></TableCell>
                  <TableCell className="text-right text-sm">{formatEur(Number(r.total_debit))}</TableCell>
                  <TableCell className="text-right text-sm">{formatEur(Number(r.total_credit))}</TableCell>
                  <TableCell className={`text-right text-sm font-medium ${Number(r.balance) >= 0 ? '' : 'text-red-600 dark:text-red-400'}`}>{formatEur(Number(r.balance))}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-bold border-t-2">
                <TableCell colSpan={3}>Summe</TableCell>
                <TableCell className="text-right">{formatEur(totalDebit)}</TableCell>
                <TableCell className="text-right">{formatEur(totalCredit)}</TableCell>
                <TableCell className="text-right">{formatEur(totalDebit - totalCredit)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function BalanceSheetTab({ propertyId }: { propertyId?: string }) {
  const { data, isLoading } = useBalanceSheet({ propertyId });
  const { download, downloading } = useXlsxDownload();

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const bs = data as any;
  if (!bs) return <div className="text-center py-12 text-muted-foreground">Keine Bilanzdaten</div>;

  const handleXlsxExport = () => {
    const params = new URLSearchParams();
    if (propertyId) params.set('propertyId', propertyId);
    const qs = params.toString() ? `?${params}` : '';
    download(`/api/accounting/export/bilanz${qs}`, `Bilanz_${new Date().getFullYear()}.xlsx`, 'bilanz');
  };

  const renderSection = (title: string, items: any[], total: number, colorClass: string) => (
    <div className="space-y-2">
      <h3 className="font-semibold text-sm">{title}</h3>
      {items.length === 0 ? <p className="text-sm text-muted-foreground pl-4">Keine Positionen</p> : (
        <div className="space-y-1">
          {items.map((item: any, i: number) => (
            <div key={i} className="flex justify-between items-center px-4 py-1 text-sm">
              <span>{item.account_number} - {item.name}</span>
              <span className={`font-medium ${colorClass}`}>{formatEur(Math.abs(Number(item.balance)))}</span>
            </div>
          ))}
          <div className="flex justify-between items-center px-4 py-2 font-bold border-t text-sm">
            <span>Summe {title}</span><span className={colorClass}>{formatEur(total)}</span>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2"><Scale className="h-4 w-4" />Bilanz per {bs.date}</CardTitle>
          <Button variant="outline" onClick={handleXlsxExport} disabled={downloading === 'bilanz'} data-testid="button-export-bilanz-xlsx">
            {downloading === 'bilanz' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            XLSX Export
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>{renderSection('Aktiva', bs.assets?.items || [], bs.assets?.total || 0, 'text-blue-600 dark:text-blue-400')}</div>
          <div className="space-y-6">
            {renderSection('Verbindlichkeiten', bs.liabilities?.items || [], bs.liabilities?.total || 0, 'text-orange-600 dark:text-orange-400')}
            {renderSection('Eigenkapital', bs.equity?.items || [], bs.equity?.total || 0, 'text-purple-600 dark:text-purple-400')}
          </div>
        </div>
        <div className="mt-4 p-3 rounded-md border">
          <div className="flex justify-between items-center text-sm">
            <span className="font-medium">Bilanzprüfung</span>
            <Badge variant={bs.balanceCheck ? 'default' : 'destructive'}>{bs.balanceCheck ? 'Ausgeglichen' : 'Differenz vorhanden'}</Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProfitLossTab({ propertyId }: { propertyId?: string }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const { data, isLoading } = useProfitLoss({ from: `${year}-01-01`, to: `${year}-12-31`, propertyId });
  const { download, downloading } = useXlsxDownload();

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const pl = data as any;
  if (!pl) return <div className="text-center py-12 text-muted-foreground">Keine GuV-Daten</div>;

  const handleXlsxExport = () => {
    const params = new URLSearchParams({ from: `${year}-01-01`, to: `${year}-12-31` });
    if (propertyId) params.set('propertyId', propertyId);
    download(`/api/accounting/export/guv?${params}`, `GuV_${year}.xlsx`, 'guv');
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" />Gewinn- und Verlustrechnung {year}</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleXlsxExport} disabled={downloading === 'guv'} data-testid="button-export-guv-xlsx">
              {downloading === 'guv' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              XLSX Export
            </Button>
            <Select value={year.toString()} onValueChange={v => setYear(Number(v))}>
              <SelectTrigger className="w-[100px]" data-testid="select-guv-year"><SelectValue /></SelectTrigger>
              <SelectContent>{[0,1,2,3,4].map(i => { const y = now.getFullYear() - i; return <SelectItem key={y} value={y.toString()}>{y}</SelectItem>; })}</SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div className="space-y-2">
            <h3 className="font-semibold text-sm text-green-600 dark:text-green-400">Erlöse</h3>
            {(pl.revenue?.items || []).map((item: any, i: number) => (
              <div key={i} className="flex justify-between items-center px-4 py-1 text-sm">
                <span>{item.account_number} - {item.name}</span>
                <span className="font-medium text-green-600 dark:text-green-400">{formatEur(Number(item.balance))}</span>
              </div>
            ))}
            <div className="flex justify-between px-4 py-2 font-bold border-t text-sm"><span>Summe Erlöse</span><span className="text-green-600 dark:text-green-400">{formatEur(pl.revenue?.total || 0)}</span></div>
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold text-sm text-red-600 dark:text-red-400">Aufwendungen</h3>
            {(pl.expenses?.items || []).map((item: any, i: number) => (
              <div key={i} className="flex justify-between items-center px-4 py-1 text-sm">
                <span>{item.account_number} - {item.name}</span>
                <span className="font-medium text-red-600 dark:text-red-400">{formatEur(Math.abs(Number(item.balance)))}</span>
              </div>
            ))}
            <div className="flex justify-between px-4 py-2 font-bold border-t text-sm"><span>Summe Aufwand</span><span className="text-red-600 dark:text-red-400">{formatEur(pl.expenses?.total || 0)}</span></div>
          </div>
          <div className="p-4 rounded-md border">
            <div className="flex justify-between items-center">
              <span className="text-lg font-bold">Jahresergebnis</span>
              <span className={`text-lg font-bold ${pl.netIncome >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{formatEur(pl.netIncome || 0)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BankingTab() {
  const { data: bankAccounts, isLoading } = useBankAccounts();

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const accounts = (bankAccounts as any[]) || [];
  const totalBalance = accounts.reduce((s: number, ba: any) => s + Number(ba.balance || ba.current_balance || 0), 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2"><CreditCard className="h-4 w-4" />Bankkonten ({accounts.length})</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-sm">{formatEur(totalBalance)} Gesamtsaldo</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8">
              <CreditCard className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-4">Noch keine Bankkonten eingerichtet</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {accounts.map((ba: any) => (
                <Card key={ba.id} data-testid={`card-bank-account-${ba.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 rounded-md bg-blue-100 dark:bg-blue-900/30">
                        <Wallet className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{ba.name || ba.bankName}</p>
                        <p className="text-xs text-muted-foreground font-mono">{ba.iban || '-'}</p>
                      </div>
                    </div>
                    <p className={`text-lg font-bold ${Number(ba.balance || ba.current_balance || 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {formatEur(Number(ba.balance || ba.current_balance || 0))}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="hover-elevate">
          <Link to="/auto-zuordnung" data-testid="link-auto-match">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-md bg-green-100 dark:bg-green-900/30">
                <LinkIcon className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">Auto-Zuordnung</p>
                <p className="text-xs text-muted-foreground">Zahlungen automatisch zuordnen</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Link>
        </Card>
        <Card className="hover-elevate">
          <Link to="/bank-abgleich" data-testid="link-bank-reconciliation">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-md bg-amber-100 dark:bg-amber-900/30">
                <BarChart3 className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">Bank-Abgleich</p>
                <p className="text-xs text-muted-foreground">Kontobewegungen abstimmen</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Link>
        </Card>
        <Card className="hover-elevate">
          <Link to="/ebics-banking" data-testid="link-ebics">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-md bg-purple-100 dark:bg-purple-900/30">
                <Upload className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">EBICS Banking</p>
                <p className="text-xs text-muted-foreground">Elektronischer Zahlungsverkehr</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Link>
        </Card>
      </div>
    </div>
  );
}

function UvaTab({ propertyId }: { propertyId?: string }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const { data, isLoading } = useUva({ month, year, propertyId });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const uva = data as any;
  const monthNames = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4" />UVA - {monthNames[month - 1]} {year}</CardTitle>
          <div className="flex gap-2">
            <Select value={month.toString()} onValueChange={v => setMonth(Number(v))}>
              <SelectTrigger className="w-[140px]" data-testid="select-uva-month"><SelectValue /></SelectTrigger>
              <SelectContent>{monthNames.map((n, i) => <SelectItem key={i+1} value={(i+1).toString()}>{n}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={year.toString()} onValueChange={v => setYear(Number(v))}>
              <SelectTrigger className="w-[100px]" data-testid="select-uva-year"><SelectValue /></SelectTrigger>
              <SelectContent>{[0,1,2].map(i => { const y = now.getFullYear() - i; return <SelectItem key={y} value={y.toString()}>{y}</SelectItem>; })}</SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!uva ? (
          <div className="text-center py-12 text-muted-foreground">Keine UVA-Daten</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Umsatzsteuer</p><p className="text-xl font-bold">{formatEur(uva.umsatzsteuer || 0)}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Vorsteuer</p><p className="text-xl font-bold">{formatEur(uva.vorsteuer || 0)}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Zahllast</p><p className={`text-xl font-bold ${(uva.zahllast || 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>{formatEur(uva.zahllast || 0)}</p></CardContent></Card>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Accounting() {
  const { toast } = useToast();
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('overview');
  const { data: properties } = useProperties();
  const propertyId = selectedPropertyId === 'all' ? undefined : selectedPropertyId;

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);
  const months = [
    { value: '1', label: 'Jänner' }, { value: '2', label: 'Februar' }, { value: '3', label: 'März' },
    { value: '4', label: 'April' }, { value: '5', label: 'Mai' }, { value: '6', label: 'Juni' },
    { value: '7', label: 'Juli' }, { value: '8', label: 'August' }, { value: '9', label: 'September' },
    { value: '10', label: 'Oktober' }, { value: '11', label: 'November' }, { value: '12', label: 'Dezember' },
  ];

  const handleExport = async (type: 'datev' | 'bmd') => {
    try {
      const url = `/api/export/${type}?year=${selectedYear}${selectedMonth !== 'all' ? `&month=${selectedMonth}` : ''}`;
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Export fehlgeschlagen');
      const blob = await response.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${type}-export-${selectedYear}${selectedMonth !== 'all' ? `-${selectedMonth}` : ''}.csv`;
      a.click();
      toast({ title: 'Export erfolgreich', description: `${type.toUpperCase()}-Export wurde heruntergeladen.` });
    } catch {
      toast({ title: 'Export fehlgeschlagen', variant: 'destructive' });
    }
  };

  return (
    <MainLayout title="Finanzbuchhaltung" subtitle="Doppelte Buchführung & Kontenverwaltung">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-accounting-title">Finanzbuchhaltung</h1>
            <p className="text-muted-foreground" data-testid="text-accounting-subtitle">Banking, Doppelte Buchführung, Bilanz, GuV & UVA</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(Number(v))}>
              <SelectTrigger className="w-[100px]" data-testid="select-accounting-year"><SelectValue /></SelectTrigger>
              <SelectContent>{years.map(y => <SelectItem key={y} value={y.toString()} data-testid={`select-year-${y}`}>{y}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId}>
              <SelectTrigger className="w-[220px]" data-testid="select-accounting-property">
                <Building2 className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Alle Liegenschaften" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="select-property-all">Alle Liegenschaften</SelectItem>
                {(properties as any[] || []).map((p: any) => (
                  <SelectItem key={p.id} value={p.id} data-testid={`select-property-${p.id}`}>
                    {p.name || p.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-[140px]" data-testid="select-accounting-month"><SelectValue placeholder="Alle Monate" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="select-month-all">Alle Monate</SelectItem>
                {months.map(m => <SelectItem key={m.value} value={m.value} data-testid={`select-month-${m.value}`}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => handleExport('datev')} data-testid="button-export-datev"><FileDown className="h-4 w-4 mr-2" />DATEV</Button>
            <Button variant="outline" onClick={() => handleExport('bmd')} data-testid="button-export-bmd"><FileDown className="h-4 w-4 mr-2" />BMD</Button>
          </div>
        </div>

        <Card className="border-dashed" data-testid="card-ki-hint-accounting">
          <CardContent className="p-3">
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-primary shrink-0" />
                <span className="font-medium">KI-Funktionen verfügbar:</span>
              </div>
              <Link to="/ki-rechnungen" className="underline underline-offset-2 hover:text-foreground" data-testid="link-ki-ocr">Belege per OCR erfassen</Link>
              <span className="text-muted-foreground/50">|</span>
              <Link to="/ki-assistent" className="underline underline-offset-2 hover:text-foreground" data-testid="link-ki-assistant">KI-Assistent fragen</Link>
              <span className="text-muted-foreground/50">|</span>
              <Link to="/ki-insights" className="underline underline-offset-2 hover:text-foreground" data-testid="link-ki-anomalies">Anomalie-Erkennung</Link>
            </div>
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex flex-wrap gap-1" data-testid="tabs-accounting">
            <TabsTrigger value="overview" data-testid="tab-overview"><Calculator className="h-4 w-4 mr-1" />Übersicht</TabsTrigger>
            <TabsTrigger value="banking" data-testid="tab-banking"><CreditCard className="h-4 w-4 mr-1" />Banking</TabsTrigger>
            <TabsTrigger value="journal" data-testid="tab-journal"><BookOpen className="h-4 w-4 mr-1" />Journal</TabsTrigger>
            <TabsTrigger value="accounts" data-testid="tab-accounts"><List className="h-4 w-4 mr-1" />Kontenrahmen</TabsTrigger>
            <TabsTrigger value="trial-balance" data-testid="tab-trial-balance"><BarChart3 className="h-4 w-4 mr-1" />Saldenliste</TabsTrigger>
            <TabsTrigger value="balance-sheet" data-testid="tab-balance-sheet"><Scale className="h-4 w-4 mr-1" />Bilanz</TabsTrigger>
            <TabsTrigger value="profit-loss" data-testid="tab-profit-loss"><TrendingUp className="h-4 w-4 mr-1" />GuV</TabsTrigger>
            <TabsTrigger value="uva" data-testid="tab-uva"><Receipt className="h-4 w-4 mr-1" />UVA</TabsTrigger>
            <TabsTrigger value="ea" data-testid="tab-ea"><Wallet className="h-4 w-4 mr-1" />E/A Rechnung</TabsTrigger>
          </TabsList>
          <TabsContent value="overview"><OverviewTab selectedYear={selectedYear} selectedMonth={selectedMonth} setSelectedYear={setSelectedYear} setSelectedMonth={setSelectedMonth} /></TabsContent>
          <TabsContent value="banking"><BankingTab /></TabsContent>
          <TabsContent value="journal"><JournalTab propertyId={propertyId} /></TabsContent>
          <TabsContent value="accounts"><ChartOfAccountsTab /></TabsContent>
          <TabsContent value="trial-balance"><TrialBalanceTab propertyId={propertyId} /></TabsContent>
          <TabsContent value="balance-sheet"><BalanceSheetTab propertyId={propertyId} /></TabsContent>
          <TabsContent value="profit-loss"><ProfitLossTab propertyId={propertyId} /></TabsContent>
          <TabsContent value="uva"><UvaTab propertyId={propertyId} /></TabsContent>
          <TabsContent value="ea"><EaRechnungTab propertyId={propertyId} /></TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
