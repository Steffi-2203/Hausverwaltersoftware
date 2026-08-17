import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Wrench, AlertTriangle, ChevronRight, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { useUpcomingMaintenance, getContractTypeLabel } from '@/hooks/useMaintenanceContracts';

export function UpcomingMaintenanceWidget() {
  const { data, isLoading } = useUpcomingMaintenance(30);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Anstehende Wartungen
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  const overdueCount = data?.overdue.length || 0;
  const upcomingCount = data?.upcoming.length || 0;
  const totalCount = overdueCount + upcomingCount;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Anstehende Wartungen
          </CardTitle>
          {totalCount > 0 && (
            <Badge variant={overdueCount > 0 ? 'destructive' : 'secondary'}>
              {totalCount} {totalCount === 1 ? 'Wartung' : 'Wartungen'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {totalCount === 0 ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <CheckCircle className="h-5 w-5 text-success" />
            <span>Keine Wartungen in den nächsten 30 Tagen fällig</span>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Overdue Section */}
            {overdueCount > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {overdueCount} überfällig{overdueCount > 1 ? 'e' : ''}
                  </span>
                </div>
                <div className="space-y-2">
                  {data?.overdue.slice(0, 3).map((contract) => (
                    <div
                      key={contract.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-destructive/10 border border-destructive/20"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{contract.title}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {contract.properties?.name} • {getContractTypeLabel(contract.contract_type)}
                        </p>
                      </div>
                      <Badge variant="destructive" className="ml-2 shrink-0">
                        {format(new Date(contract.next_due_date), 'dd.MM.', { locale: de })}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Upcoming Section */}
            {upcomingCount > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-warning">
                  <Wrench className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {upcomingCount} demnächst fällig
                  </span>
                </div>
                <div className="space-y-2">
                  {data?.upcoming.slice(0, 3).map((contract) => (
                    <div
                      key={contract.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-muted"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{contract.title}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {contract.properties?.name} • {getContractTypeLabel(contract.contract_type)}
                        </p>
                      </div>
                      <Badge variant="outline" className="ml-2 shrink-0">
                        {format(new Date(contract.next_due_date), 'dd.MM.', { locale: de })}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* View All Link */}
            {totalCount > 3 && (
              <Button variant="ghost" className="w-full" asChild>
                <Link to="/liegenschaften" className="flex items-center justify-center gap-2">
                  Alle Wartungen anzeigen
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
