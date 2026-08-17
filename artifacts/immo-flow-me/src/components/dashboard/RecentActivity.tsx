import { CreditCard, UserPlus, FileText, AlertCircle, Loader2, Receipt, Home } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePayments } from '@/hooks/usePayments';
import { useTenants } from '@/hooks/useTenants';
import { useUnits } from '@/hooks/useUnits';
import { useInvoices } from '@/hooks/useInvoices';
import { useMemo } from 'react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

interface Activity {
  id: string;
  type: 'payment' | 'tenant' | 'invoice' | 'alert';
  title: string;
  description: string;
  timestamp: string;
  dateRaw: Date;
}

const iconMap = {
  payment: CreditCard,
  tenant: UserPlus,
  invoice: Receipt,
  alert: AlertCircle,
};

const colorMap = {
  payment: 'bg-success/10 text-success',
  tenant: 'bg-primary/10 text-primary',
  invoice: 'bg-accent/10 text-accent',
  alert: 'bg-destructive/10 text-destructive',
};

export function RecentActivity() {
  const { data: payments, isLoading: paymentsLoading } = usePayments();
  const { data: tenants, isLoading: tenantsLoading } = useTenants();
  const { data: units, isLoading: unitsLoading } = useUnits();
  const { data: invoices, isLoading: invoicesLoading } = useInvoices();

  const isLoading = paymentsLoading || tenantsLoading || unitsLoading || invoicesLoading;

  const activities = useMemo(() => {
    const items: Activity[] = [];

    // Add recent payments
    payments?.slice(0, 5).forEach(payment => {
      const tenant = tenants?.find(t => t.id === payment.tenant_id);
      const unit = units?.find(u => u.id === tenant?.unit_id);
      
      if (tenant) {
        items.push({
          id: `payment-${payment.id}`,
          type: 'payment',
          title: 'Zahlung eingegangen',
          description: `${tenant.first_name} ${tenant.last_name} - ${unit?.top_nummer || ''} - €${Number(payment.betrag).toLocaleString('de-AT', { minimumFractionDigits: 2 })}`,
          timestamp: formatDistanceToNow(parseISO(payment.eingangs_datum), { addSuffix: true, locale: de }),
          dateRaw: parseISO(payment.eingangs_datum),
        });
      }
    });

    // Add recent tenants
    tenants?.filter(t => t.status === 'aktiv').slice(0, 3).forEach(tenant => {
      const unit = units?.find(u => u.id === tenant.unit_id);
      
      items.push({
        id: `tenant-${tenant.id}`,
        type: 'tenant',
        title: 'Mieter aktiv',
        description: `${tenant.first_name} ${tenant.last_name} - ${unit?.top_nummer || ''}`,
        timestamp: formatDistanceToNow(parseISO(tenant.mietbeginn), { addSuffix: true, locale: de }),
        dateRaw: parseISO(tenant.created_at),
      });
    });

    // Add overdue invoices as alerts
    invoices?.filter(i => i.status === 'ueberfaellig').slice(0, 3).forEach(invoice => {
      const tenant = tenants?.find(t => t.id === invoice.tenant_id);
      
      if (tenant) {
        items.push({
          id: `alert-${invoice.id}`,
          type: 'alert',
          title: 'Zahlung überfällig',
          description: `${tenant.first_name} ${tenant.last_name} - €${Number(invoice.gesamtbetrag).toLocaleString('de-AT', { minimumFractionDigits: 2 })}`,
          timestamp: formatDistanceToNow(parseISO(invoice.faellig_am), { addSuffix: true, locale: de }),
          dateRaw: parseISO(invoice.faellig_am),
        });
      }
    });

    // Sort by date and take top 5
    return items
      .sort((a, b) => b.dateRaw.getTime() - a.dateRaw.getTime())
      .slice(0, 5);
  }, [payments, tenants, units, invoices]);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-card">
        <div className="p-5 border-b border-border">
          <h3 className="font-semibold text-foreground">Letzte Aktivitäten</h3>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-card">
      <div className="p-5 border-b border-border">
        <h3 className="font-semibold text-foreground">Letzte Aktivitäten</h3>
      </div>
      {activities.length > 0 ? (
        <div className="divide-y divide-border">
          {activities.map((activity) => {
            const Icon = iconMap[activity.type];
            return (
              <div key={activity.id} className="flex items-start gap-3 p-4 hover:bg-muted/50 transition-colors">
                <div className={cn('rounded-lg p-2', colorMap[activity.type])}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{activity.title}</p>
                  <p className="text-sm text-muted-foreground truncate">{activity.description}</p>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">{activity.timestamp}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Home className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Noch keine Aktivitäten</p>
        </div>
      )}
    </div>
  );
}