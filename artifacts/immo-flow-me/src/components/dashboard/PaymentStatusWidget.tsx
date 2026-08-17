import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useUnits } from '@/hooks/useUnits';
import { useTenants } from '@/hooks/useTenants';
import { useRentExpectations } from '@/hooks/useRentExpectations';
import { useTransactions } from '@/hooks/useTransactions';
import { useMemo } from 'react';
import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react';

interface UnitPaymentStatus {
  unitId: string;
  topNummer: string;
  tenantName: string | null;
  expectedRent: number;
  paidAmount: number;
  isPaid: boolean;
  isPartiallyPaid: boolean;
}

export function PaymentStatusWidget() {
  const { data: units, isLoading: unitsLoading } = useUnits();
  const { data: tenants, isLoading: tenantsLoading } = useTenants();
  const { data: rentExpectations, isLoading: expectationsLoading } = useRentExpectations();
  const { data: transactions, isLoading: transactionsLoading } = useTransactions();

  const isLoading = unitsLoading || tenantsLoading || expectationsLoading || transactionsLoading;

  // Get current month boundaries
  const { firstOfMonth, lastOfMonth, monthLabel } = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    
    return {
      firstOfMonth: first.toISOString().slice(0, 10),
      lastOfMonth: last.toISOString().slice(0, 10),
      monthLabel: now.toLocaleString('de-AT', { month: 'long', year: 'numeric' }),
    };
  }, []);

  // Calculate payment status per unit
  const paymentStatus = useMemo<UnitPaymentStatus[]>(() => {
    if (!units) return [];

    // Filter to units with active tenants
    const activeUnits = units.filter(u => u.status === 'aktiv');

    // Filter matched transactions for current month
    const monthlyTransactions = transactions?.filter(t => 
      t.transaction_date >= firstOfMonth &&
      t.transaction_date <= lastOfMonth &&
      (t as any).status === 'matched' &&
      Number(t.amount) > 0
    ) || [];

    return activeUnits.map(unit => {
      // Find active tenant for this unit
      const tenant = tenants?.find(t => t.unit_id === unit.id && t.status === 'aktiv');
      const tenantName = tenant ? `${tenant.first_name} ${tenant.last_name}` : null;

      // Find current rent expectation for this unit
      const today = new Date().toISOString().slice(0, 10);
      const expectation = rentExpectations?.find(re => 
        re.unit_id === unit.id &&
        re.start_date <= today &&
        (!re.end_date || re.end_date >= today)
      );

      // Calculate expected rent (from rent_expectations or tenant data)
      const expectedRent = expectation?.monthly_rent || 
        (tenant ? Number(tenant.grundmiete) + Number(tenant.betriebskosten_vorschuss) + Number(tenant.heizungskosten_vorschuss) : 0);

      // Sum all matched payments for this unit this month
      const unitPayments = monthlyTransactions.filter(t => t.unit_id === unit.id);
      const paidAmount = unitPayments.reduce((sum, t) => sum + Number(t.amount), 0);

      const isPaid = paidAmount >= expectedRent && expectedRent > 0;
      const isPartiallyPaid = paidAmount > 0 && paidAmount < expectedRent;

      return {
        unitId: unit.id,
        topNummer: unit.top_nummer,
        tenantName,
        expectedRent,
        paidAmount,
        isPaid,
        isPartiallyPaid,
      };
    }).sort((a, b) => a.topNummer.localeCompare(b.topNummer, 'de', { numeric: true }));
  }, [units, tenants, rentExpectations, transactions, firstOfMonth, lastOfMonth]);

  // Summary stats
  const summary = useMemo(() => {
    const paid = paymentStatus.filter(s => s.isPaid).length;
    const total = paymentStatus.length;
    const totalExpected = paymentStatus.reduce((sum, s) => sum + s.expectedRent, 0);
    const totalPaid = paymentStatus.reduce((sum, s) => sum + s.paidAmount, 0);

    return { paid, total, totalExpected, totalPaid };
  }, [paymentStatus]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (paymentStatus.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Zahlungsstatus {monthLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Keine vermieteten Einheiten vorhanden.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Zahlungsstatus {monthLabel}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ScrollArea className="h-[200px] pr-4">
          <div className="space-y-2">
            {paymentStatus.map(status => (
              <div 
                key={status.unitId} 
                className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium shrink-0">{status.topNummer}</span>
                  {status.tenantName && (
                    <span className="text-sm text-muted-foreground truncate">
                      • {status.tenantName}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm tabular-nums">
                    {status.paidAmount.toLocaleString('de-AT', { minimumFractionDigits: 2 })} € / {status.expectedRent.toLocaleString('de-AT', { minimumFractionDigits: 2 })} €
                  </span>
                  {status.isPaid ? (
                    <Badge variant="default" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Bezahlt
                    </Badge>
                  ) : status.isPartiallyPaid ? (
                    <Badge variant="default" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Teilweise
                    </Badge>
                  ) : (
                    <Badge variant="default" className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 gap-1">
                      <XCircle className="h-3 w-3" />
                      Offen
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="pt-3 border-t space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Bezahlt:</span>
            <span className="font-medium text-green-600 dark:text-green-400">
              {summary.paid} / {summary.total}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Gesamt Soll:</span>
            <span className="font-medium">
              {summary.totalExpected.toLocaleString('de-AT', { minimumFractionDigits: 2 })} €
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Gesamt Ist:</span>
            <span className="font-medium">
              {summary.totalPaid.toLocaleString('de-AT', { minimumFractionDigits: 2 })} €
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
