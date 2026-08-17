import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  CheckCircle2, 
  AlertTriangle, 
  Loader2,
  ArrowRight,
  Receipt,
  TrendingUp,
  TrendingDown
} from 'lucide-react';
import { useInvoices } from '@/hooks/useInvoices';
import { usePayments } from '@/hooks/usePayments';
import { useMemo } from 'react';

export function OffenePostenWidget() {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  
  const { data: invoices, isLoading: invoicesLoading } = useInvoices(currentYear);
  const { data: payments, isLoading: paymentsLoading } = usePayments();

  const isLoading = invoicesLoading || paymentsLoading;

  const stats = useMemo(() => {
    if (!invoices) {
      return {
        totalOpen: 0,
        openAmount: 0,
        paidThisMonth: 0,
        paidAmount: 0,
        trend: 'neutral' as const,
      };
    }

    const openInvoices = invoices.filter(inv => 
      inv.status !== 'bezahlt'
    );
    const paidInvoices = invoices.filter(inv => inv.status === 'bezahlt');
    
    // Offener Betrag = Gesamtbetrag abzüglich bereits bezahltem Anteil (Teilzahlungen)
    const openAmount = openInvoices.reduce((sum, inv) => {
      const total = Number(inv.gesamtbetrag || 0);
      const paid  = Number((inv as any).paid_amount || 0);
      return sum + Math.max(0, total - paid);
    }, 0);
    const paidAmount = paidInvoices.reduce((sum, inv) => 
      sum + Number(inv.gesamtbetrag || 0), 0);

    const thisMonthPayments = (payments || []).filter(p => {
      const dateStr = p.eingangsDatum || p.eingangs_datum || p.buchungsDatum || p.buchungs_datum;
      if (!dateStr) return false;
      const date = new Date(dateStr);
      return date.getMonth() + 1 === currentMonth && date.getFullYear() === currentYear;
    });
    const paidThisMonth = thisMonthPayments.reduce((sum, p) => sum + Number(p.betrag || 0), 0);

    const trend = openInvoices.length === 0 ? 'good' : 
                  openInvoices.length > 5 ? 'warning' : 'neutral';

    return {
      totalOpen: openInvoices.length,
      openAmount,
      paidThisMonth,
      paidAmount,
      trend,
    };
  }, [invoices, payments, currentYear, currentMonth]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4" />
            Offene Posten
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasOpenItems = stats.totalOpen > 0;

  return (
    <Card className={hasOpenItems ? 'border-warning/50' : ''}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4" />
            Offene Posten
          </CardTitle>
          {hasOpenItems ? (
            <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {stats.totalOpen} offen
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-success/10 text-success border-success/30">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Alles bezahlt
            </Badge>
          )}
        </div>
        <CardDescription>
          Mieteinnahmen aus Vorschreibungen
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex flex-col">
            <span className="text-muted-foreground">Offene Posten</span>
            <span className="font-semibold text-lg flex items-center gap-1">
              {stats.totalOpen}
              {stats.trend === 'warning' && <TrendingUp className="h-4 w-4 text-warning" />}
              {stats.trend === 'good' && <TrendingDown className="h-4 w-4 text-success" />}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-muted-foreground">Offener Betrag</span>
            <span className="font-semibold text-lg text-warning">
              {stats.openAmount.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}
            </span>
          </div>
        </div>

        <div className="pt-2 border-t">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Eingänge diesen Monat:</span>
            <span className="font-medium text-success">
              {stats.paidThisMonth.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}
            </span>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Link to="/reports?tab=offeneposten" className="flex-1">
            <Button size="sm" variant={hasOpenItems ? "default" : "outline"} className="w-full" data-testid="button-offene-posten-details">
              {hasOpenItems ? 'Offene Posten' : 'Details'}
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
