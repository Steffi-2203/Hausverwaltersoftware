import { useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, AlertCircle, MinusCircle } from 'lucide-react';
import { useInvoicesByTenant } from '@/hooks/useInvoices';
import { useCombinedPayments } from '@/hooks/useCombinedPayments';

interface TenantPaymentDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant: {
    id: string;
    first_name: string;
    last_name: string;
    grundmiete: number;
    betriebskosten_vorschuss: number;
    heizungskosten_vorschuss: number;
    mietbeginn: string;
  } | null;
  unit: {
    top_nummer: string;
  } | null;
  year: number;
  month: number; // Up to this month (inclusive)
}

interface MonthData {
  month: number;
  monthName: string;
  sollMiete: number;
  sollBk: number;
  sollHk: number;
  sollTotal: number;
  istMiete: number;
  istBk: number;
  istHk: number;
  istTotal: number;
  differenz: number;
  hasInvoice: boolean;
}

const monthNames = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

export function TenantPaymentDetailDialog({
  open,
  onOpenChange,
  tenant,
  unit,
  year,
  month,
}: TenantPaymentDetailDialogProps) {
  const { data: invoices, isLoading: invoicesLoading } = useInvoicesByTenant(tenant?.id || '');
  const { data: allPayments, isLoading: paymentsLoading } = useCombinedPayments();

  const isLoading = invoicesLoading || paymentsLoading;

  // Calculate monthly data from January to selected month
  const monthlyData = useMemo(() => {
    if (!tenant) return [];

    const mietbeginn = new Date(tenant.mietbeginn);
    const mietbeginnYear = mietbeginn.getFullYear();
    const mietbeginnMonth = mietbeginn.getMonth() + 1;

    // Filter invoices for this year
    const yearInvoices = (invoices || []).filter(inv => inv.year === year);
    
    // Filter payments for this tenant and year
    const tenantPayments = (allPayments || []).filter(p => {
      if (p.tenant_id !== tenant.id) return false;
      const paymentDate = new Date(p.date);
      return paymentDate.getFullYear() === year;
    });

    const data: MonthData[] = [];

    for (let m = 1; m <= month; m++) {
      // Check if tenant was active in this month
      const isActiveInMonth = 
        (mietbeginnYear < year) || 
        (mietbeginnYear === year && mietbeginnMonth <= m);

      if (!isActiveInMonth) continue;

      // Find invoice for this month
      const invoice = yearInvoices.find(inv => inv.month === m);
      
      // Get SOLL values (from invoice or tenant defaults)
      const sollMiete = invoice ? Number(invoice.grundmiete) : Number(tenant.grundmiete || 0);
      const sollBk = invoice ? Number(invoice.betriebskosten) : Number(tenant.betriebskosten_vorschuss || 0);
      const sollHk = invoice ? Number(invoice.heizungskosten) : Number(tenant.heizungskosten_vorschuss || 0);
      const sollTotal = sollMiete + sollBk + sollHk;

      // Get payments for this month
      const monthPayments = tenantPayments.filter(p => {
        const paymentDate = new Date(p.date);
        return paymentDate.getMonth() + 1 === m;
      });

      const totalPayment = monthPayments.reduce((sum, p) => sum + p.amount, 0);

      // MRG-konforme Aufteilung: BK -> HK -> Miete
      let remaining = totalPayment;
      const istBk = Math.min(remaining, sollBk);
      remaining -= istBk;
      const istHk = Math.min(remaining, sollHk);
      remaining -= istHk;
      const istMiete = remaining; // Rest geht auf Miete

      data.push({
        month: m,
        monthName: monthNames[m - 1],
        sollMiete,
        sollBk,
        sollHk,
        sollTotal,
        istMiete,
        istBk,
        istHk,
        istTotal: totalPayment,
        differenz: totalPayment - sollTotal,
        hasInvoice: !!invoice,
      });
    }

    return data;
  }, [tenant, invoices, allPayments, year, month]);

  // Calculate totals
  const totals = useMemo(() => {
    return monthlyData.reduce(
      (acc, m) => ({
        sollMiete: acc.sollMiete + m.sollMiete,
        sollBk: acc.sollBk + m.sollBk,
        sollHk: acc.sollHk + m.sollHk,
        sollTotal: acc.sollTotal + m.sollTotal,
        istMiete: acc.istMiete + m.istMiete,
        istBk: acc.istBk + m.istBk,
        istHk: acc.istHk + m.istHk,
        istTotal: acc.istTotal + m.istTotal,
        differenz: acc.differenz + m.differenz,
      }),
      { sollMiete: 0, sollBk: 0, sollHk: 0, sollTotal: 0, istMiete: 0, istBk: 0, istHk: 0, istTotal: 0, differenz: 0 }
    );
  }, [monthlyData]);

  if (!tenant) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-primary">{unit?.top_nummer || '-'}</span>
            <span>{tenant.first_name} {tenant.last_name}</span>
            <Badge variant="outline" className="ml-2">
              Jän - {monthNames[month - 1]} {year}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : monthlyData.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            Keine Daten für diesen Zeitraum
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Monat</TableHead>
                  <TableHead className="text-right">Miete SOLL</TableHead>
                  <TableHead className="text-right">Miete IST</TableHead>
                  <TableHead className="text-right">BK SOLL</TableHead>
                  <TableHead className="text-right">BK IST</TableHead>
                  <TableHead className="text-right">HK SOLL</TableHead>
                  <TableHead className="text-right">HK IST</TableHead>
                  <TableHead className="text-right">Gesamt SOLL</TableHead>
                  <TableHead className="text-right">Gesamt IST</TableHead>
                  <TableHead className="text-right">Differenz</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthlyData.map((m) => {
                  const isPaid = Math.abs(m.differenz) < 0.01;
                  const isOverpaid = m.differenz > 0.01;
                  const isUnderpaid = m.differenz < -0.01;

                  return (
                    <TableRow 
                      key={m.month}
                      className={isUnderpaid ? 'bg-red-50/30 dark:bg-red-950/10' : isOverpaid ? 'bg-green-50/30 dark:bg-green-950/10' : ''}
                    >
                      <TableCell className="font-medium">
                        {m.monthName}
                        {!m.hasInvoice && (
                          <span className="text-xs text-muted-foreground ml-1">(kein VS)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        € {m.sollMiete.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className={`text-right ${m.istMiete < m.sollMiete - 0.01 ? 'text-red-600' : ''}`}>
                        € {m.istMiete.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        € {m.sollBk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className={`text-right ${m.istBk < m.sollBk - 0.01 ? 'text-red-600' : ''}`}>
                        € {m.istBk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        € {m.sollHk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className={`text-right ${m.istHk < m.sollHk - 0.01 ? 'text-red-600' : ''}`}>
                        € {m.istHk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-medium text-muted-foreground">
                        € {m.sollTotal.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        € {m.istTotal.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className={`text-right font-bold ${isUnderpaid ? 'text-red-600' : isOverpaid ? 'text-green-600' : ''}`}>
                        {m.differenz > 0 ? '+' : ''}€ {m.differenz.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-center">
                        {isPaid ? (
                          <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                        ) : isOverpaid ? (
                          <Badge className="bg-blue-100 text-blue-800">+</Badge>
                        ) : (
                          <AlertCircle className="h-5 w-5 text-red-600 mx-auto" />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {/* Totals row */}
                <TableRow className="bg-muted/50 font-bold border-t-2">
                  <TableCell>Gesamt</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    € {totals.sollMiete.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className={`text-right ${totals.istMiete < totals.sollMiete - 0.01 ? 'text-red-600' : ''}`}>
                    € {totals.istMiete.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    € {totals.sollBk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className={`text-right ${totals.istBk < totals.sollBk - 0.01 ? 'text-red-600' : ''}`}>
                    € {totals.istBk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    € {totals.sollHk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className={`text-right ${totals.istHk < totals.sollHk - 0.01 ? 'text-red-600' : ''}`}>
                    € {totals.istHk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    € {totals.sollTotal.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    € {totals.istTotal.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className={`text-right ${totals.differenz < -0.01 ? 'text-red-600' : totals.differenz > 0.01 ? 'text-green-600' : ''}`}>
                    {totals.differenz > 0 ? '+' : ''}€ {totals.differenz.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}