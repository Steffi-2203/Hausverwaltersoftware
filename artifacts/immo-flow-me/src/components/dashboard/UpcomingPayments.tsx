import { Calendar, Euro, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useInvoices } from '@/hooks/useInvoices';
import { useTenants } from '@/hooks/useTenants';
import { useUnits } from '@/hooks/useUnits';
import { useMemo } from 'react';
import { format, addDays, isAfter, isBefore, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

const statusLabels = {
  pending: 'Ausstehend',
  overdue: 'Überfällig',
  sepa: 'SEPA',
};

const statusStyles = {
  pending: 'bg-warning/10 text-warning border-warning/30',
  overdue: 'bg-destructive/10 text-destructive border-destructive/30',
  sepa: 'bg-success/10 text-success border-success/30',
};

export function UpcomingPayments() {
  const { data: invoices, isLoading: invoicesLoading } = useInvoices();
  const { data: tenants, isLoading: tenantsLoading } = useTenants();
  const { data: units, isLoading: unitsLoading } = useUnits();

  const isLoading = invoicesLoading || tenantsLoading || unitsLoading;

  const payments = useMemo(() => {
    if (!invoices || !tenants || !units) return [];

    const today = new Date();
    const nextWeek = addDays(today, 7);

    // Get open or overdue invoices
    const relevantInvoices = invoices.filter(inv => 
      inv.status === 'offen' || inv.status === 'ueberfaellig' || inv.status === 'teilbezahlt'
    );

    return relevantInvoices
      .map(inv => {
        const tenant = tenants.find(t => t.id === inv.tenant_id);
        const unit = units.find(u => u.id === inv.unit_id);
        
        if (!tenant || !unit) return null;

        const dueDate = parseISO(inv.faellig_am);
        const isOverdue = isBefore(dueDate, today);
        const isDueWithinWeek = isAfter(dueDate, today) && isBefore(dueDate, nextWeek);
        
        // Determine status
        let status: 'pending' | 'overdue' | 'sepa' = 'pending';
        if (inv.status === 'ueberfaellig' || isOverdue) {
          status = 'overdue';
        } else if (tenant.sepa_mandat) {
          status = 'sepa';
        }

        return {
          id: inv.id,
          tenant: `${tenant.first_name} ${tenant.last_name}`,
          unit: unit.top_nummer,
          amount: Number(inv.gesamtbetrag),
          dueDate: format(dueDate, 'dd.MM.yyyy', { locale: de }),
          dueDateRaw: dueDate,
          status,
          isOverdue,
          isDueWithinWeek,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
      // Show overdue first, then by due date
      .sort((a, b) => {
        if (a.isOverdue && !b.isOverdue) return -1;
        if (!a.isOverdue && b.isOverdue) return 1;
        return a.dueDateRaw.getTime() - b.dueDateRaw.getTime();
      })
      .slice(0, 5); // Show top 5
  }, [invoices, tenants, units]);

  const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-card">
        <div className="p-5 border-b border-border">
          <h3 className="font-semibold text-foreground">Anstehende Zahlungen</h3>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-card">
      <div className="p-5 border-b border-border flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Anstehende Zahlungen</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Offene Vorschreibungen</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-foreground">
            €{totalAmount.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-muted-foreground">Gesamt</p>
        </div>
      </div>
      {payments.length > 0 ? (
        <div className="divide-y divide-border">
          {payments.map((payment) => (
            <div key={payment.id} className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{payment.tenant}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">{payment.unit}</span>
                  <span className="text-xs text-muted-foreground">•</span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {payment.dueDate}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="outline" className={cn('text-xs', statusStyles[payment.status])}>
                  {statusLabels[payment.status]}
                </Badge>
                <span className="font-semibold text-foreground whitespace-nowrap">
                  €{payment.amount.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Euro className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Keine offenen Zahlungen</p>
        </div>
      )}
    </div>
  );
}