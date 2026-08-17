import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CalendarClock, CheckCircle, AlertTriangle, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { useExpiringLeases, type ExpiringLease } from '@/hooks/useExpiringLeases';

/** Farb-Klassen je nach Dringlichkeit */
function urgencyVariant(days: number): 'destructive' | 'secondary' | 'outline' {
  if (days <= 30) return 'destructive';
  if (days <= 60) return 'secondary';
  return 'outline';
}

function urgencyBg(days: number): string {
  if (days <= 30) return 'bg-destructive/10 border-destructive/20';
  if (days <= 60) return 'bg-warning/10 border-warning/20';
  return 'bg-muted border-border';
}

function daysLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)} Tage überfällig`;
  if (days === 0) return 'Heute';
  if (days === 1) return 'Morgen';
  return `in ${days} Tagen`;
}

function LeaseRow({ lease }: { lease: ExpiringLease }) {
  const days = lease.daysUntilExpiry;
  return (
    <Link
      to={`/mieter/${lease.tenantId}`}
      className={`flex items-center justify-between p-3 rounded-lg border transition hover:shadow-sm ${urgencyBg(days)}`}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm truncate">
          {lease.firstName} {lease.lastName}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {lease.propertyName} · {lease.unitTopNummer}
        </p>
      </div>
      <div className="flex items-center gap-2 ml-3 shrink-0">
        <div className="text-right">
          <Badge variant={urgencyVariant(days)} className="text-xs">
            {daysLabel(days)}
          </Badge>
          <p className="text-xs text-muted-foreground mt-0.5">
            {format(new Date(lease.befristungEnde), 'dd.MM.yyyy', { locale: de })}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </Link>
  );
}

export function ExpiringLeasesWidget({ daysAhead = 90 }: { daysAhead?: number }) {
  const { data, isLoading, isError } = useExpiringLeases(daysAhead);

  const urgent   = (data ?? []).filter(l => l.daysUntilExpiry <= 30);
  const moderate = (data ?? []).filter(l => l.daysUntilExpiry > 30 && l.daysUntilExpiry <= 60);
  const later    = (data ?? []).filter(l => l.daysUntilExpiry > 60);
  const total    = data?.length ?? 0;

  return (
    <Card data-testid="expiring-leases-widget">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-5 w-5" />
            Auslaufende Mietverträge
          </CardTitle>
          {!isLoading && total > 0 && (
            <Badge variant={urgent.length > 0 ? 'destructive' : 'secondary'}>
              {total} {total === 1 ? 'Vertrag' : 'Verträge'}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Fehler beim Laden der auslaufenden Mietverträge.
          </div>
        )}

        {!isLoading && !isError && total === 0 && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <CheckCircle className="h-5 w-5 text-success shrink-0" />
            <span>Keine Mietverträge laufen in den nächsten {daysAhead} Tagen aus.</span>
          </div>
        )}

        {!isLoading && !isError && total > 0 && (
          <div className="space-y-4">
            {/* ≤ 30 Tage — dringend */}
            {urgent.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-xs font-semibold uppercase tracking-wide">
                    Dringend — nächste 30 Tage ({urgent.length})
                  </span>
                </div>
                {urgent.map(l => <LeaseRow key={l.tenantId} lease={l} />)}
              </div>
            )}

            {/* 31–60 Tage */}
            {moderate.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  31–60 Tage ({moderate.length})
                </span>
                {moderate.map(l => <LeaseRow key={l.tenantId} lease={l} />)}
              </div>
            )}

            {/* 61–90 Tage */}
            {later.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  61–{daysAhead} Tage ({later.length})
                </span>
                {later.map(l => <LeaseRow key={l.tenantId} lease={l} />)}
              </div>
            )}

            <Button variant="outline" size="sm" className="w-full" asChild>
              <Link to="/mieter">Alle Mieter anzeigen</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
