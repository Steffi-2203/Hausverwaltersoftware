import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, Euro, CheckCircle2, AlertCircle, ArrowDownRight, ArrowUpRight, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { useTransactionsByUnit, Transaction } from '@/hooks/useTransactions';
import { useInvoices } from '@/hooks/useInvoices';
import { useMemo, useState } from 'react';

interface UnitTransactionsProps {
  unitId: string;
  tenantId?: string;
  monthlyRent?: number;
}

// Sub-component for collapsible transaction history
function TransactionHistoryCollapsible({ transactions }: { transactions: Transaction[] }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Zahlungseingänge ({transactions.length})
              </CardTitle>
              <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            {transactions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Euro className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p>Noch keine Transaktionen importiert</p>
                <p className="text-sm mt-1">Importieren Sie einen Kontoauszug unter Bank-Import</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead>Beschreibung</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Betrag</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell className="whitespace-nowrap">
                        {format(new Date(transaction.transaction_date), 'dd.MM.yyyy', { locale: de })}
                      </TableCell>
                      <TableCell>
                        <div className="max-w-xs">
                          <p className="font-medium truncate">
                            {transaction.counterpart_name || 'Unbekannt'}
                          </p>
                          <p className="text-sm text-muted-foreground truncate">
                            {transaction.description}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={(transaction as any).status === 'matched' ? 'default' : 'secondary'}>
                          {(transaction as any).status === 'matched' ? 'Zugeordnet' : 'Offen'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {Number(transaction.amount) >= 0 ? (
                            <ArrowDownRight className="h-4 w-4 text-green-500" />
                          ) : (
                            <ArrowUpRight className="h-4 w-4 text-red-500" />
                          )}
                          <span className={`font-medium ${Number(transaction.amount) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {new Intl.NumberFormat('de-AT', { style: 'currency', currency: transaction.currency }).format(Number(transaction.amount))}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// Sub-component for collapsible open items
function OpenItemsCollapsible({ unitInvoices }: { unitInvoices: any[] }) {
  const [isOpen, setIsOpen] = useState(false);

  // Filter only open/overdue invoices
  const openInvoices = unitInvoices.filter(inv => inv.status === 'offen' || inv.status === 'ueberfaellig' || inv.status === 'teilbezahlt');

  if (openInvoices.length === 0) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Offene Posten ({openInvoices.length})
              </CardTitle>
              <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Monat</TableHead>
                  <TableHead>Fällig am</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Betrag</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {openInvoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium">
                      {format(new Date(invoice.year, invoice.month - 1), 'MMMM yyyy', { locale: de })}
                    </TableCell>
                    <TableCell>
                      {format(new Date(invoice.faellig_am), 'dd.MM.yyyy', { locale: de })}
                    </TableCell>
                    <TableCell>
                      <Badge variant={invoice.status === 'ueberfaellig' ? 'destructive' : 'secondary'}>
                        {invoice.status === 'offen' ? 'Offen' : invoice.status === 'ueberfaellig' ? 'Überfällig' : 'Teilbezahlt'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium text-red-600">
                      {new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(invoice.gesamtbetrag)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export function UnitTransactions({ unitId, tenantId, monthlyRent = 0 }: UnitTransactionsProps) {
  const { data: transactions = [], isLoading: loadingTransactions } = useTransactionsByUnit(unitId);
  const { data: allInvoices = [] } = useInvoices();

  // Filter invoices for this unit
  const unitInvoices = useMemo(() => {
    return allInvoices.filter(inv => inv.unit_id === unitId);
  }, [allInvoices, unitId]);

  // Calculate Soll/Ist comparison
  const comparison = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    
    // Total expected (Soll) - from invoices
    const sollTotal = unitInvoices
      .filter(inv => inv.year === currentYear)
      .reduce((sum, inv) => sum + Number(inv.gesamtbetrag), 0);
    
    // Total received (Ist) - from transactions
    const istTotal = transactions
      .filter(t => {
        const date = new Date(t.transaction_date);
        return date.getFullYear() === currentYear && Number(t.amount) > 0;
      })
      .reduce((sum, t) => sum + Number(t.amount), 0);
    
    // Current month
    const sollMonat = unitInvoices
      .filter(inv => inv.year === currentYear && inv.month === currentMonth)
      .reduce((sum, inv) => sum + Number(inv.gesamtbetrag), 0);
    
    const istMonat = transactions
      .filter(t => {
        const date = new Date(t.transaction_date);
        return date.getFullYear() === currentYear && date.getMonth() + 1 === currentMonth && Number(t.amount) > 0;
      })
      .reduce((sum, t) => sum + Number(t.amount), 0);
    
    return {
      sollTotal,
      istTotal,
      saldoTotal: istTotal - sollTotal,
      sollMonat,
      istMonat,
      saldoMonat: istMonat - sollMonat,
    };
  }, [unitInvoices, transactions]);

  if (loadingTransactions) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Soll/Ist Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Aktueller Monat</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Soll (Vorschreibung)</span>
                <span className="font-medium">
                  {new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(comparison.sollMonat)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Ist (Zahlungseingang)</span>
                <span className="font-medium">
                  {new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(comparison.istMonat)}
                </span>
              </div>
              <div className="border-t pt-2 flex justify-between items-center">
                <span className="text-sm font-medium">Saldo</span>
                <span className={`font-bold ${comparison.saldoMonat >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {comparison.saldoMonat >= 0 ? '+' : ''}
                  {new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(comparison.saldoMonat)}
                </span>
              </div>
              <Badge 
                variant={comparison.saldoMonat >= 0 ? 'default' : 'destructive'}
                className="w-full justify-center"
              >
                {comparison.saldoMonat >= 0 ? (
                  <>
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Bezahlt
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Offen: {new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(Math.abs(comparison.saldoMonat))}
                  </>
                )}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Jahr {new Date().getFullYear()}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Soll (Gesamt)</span>
                <span className="font-medium">
                  {new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(comparison.sollTotal)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Ist (Eingänge)</span>
                <span className="font-medium">
                  {new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(comparison.istTotal)}
                </span>
              </div>
              <div className="border-t pt-2 flex justify-between items-center">
                <span className="text-sm font-medium">Saldo</span>
                <span className={`font-bold ${comparison.saldoTotal >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {comparison.saldoTotal >= 0 ? '+' : ''}
                  {new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(comparison.saldoTotal)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Transaction History - Collapsible */}
      <TransactionHistoryCollapsible transactions={transactions} />

      {/* Open Items - Collapsible */}
      <OpenItemsCollapsible unitInvoices={unitInvoices} />
    </div>
  );
}
