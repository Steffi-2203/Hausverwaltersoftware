import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Loader2,
  ArrowRight,
  Database
} from 'lucide-react';
import { useDataConsistencyCheck } from '@/hooks/useDataConsistencyCheck';
import { usePaymentSync } from '@/hooks/usePaymentSync';

export function SyncStatusWidget() {
  const { 
    isLoading, 
    hasIssues, 
    summary,
    paymentsWithoutTransactions,
    transactionsWithoutPayments
  } = useDataConsistencyCheck();
  
  const { syncExistingPaymentsToTransactions } = usePaymentSync();

  const handleSync = async () => {
    await syncExistingPaymentsToTransactions.mutateAsync();
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" />
            Datensynchronisation
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

  return (
    <Card className={hasIssues ? 'border-warning/50' : ''}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" />
            Datensynchronisation
          </CardTitle>
          {hasIssues ? (
            <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Aktion erforderlich
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-success/10 text-success border-success/30">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Synchron
            </Badge>
          )}
        </div>
        <CardDescription>
          Payments ↔ Transactions Sync-Status
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Summary */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex flex-col">
            <span className="text-muted-foreground">Payments</span>
            <span className="font-semibold text-lg">{summary.totalPayments}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-muted-foreground">Synchronisiert</span>
            <span className="font-semibold text-lg text-success">{summary.syncedPayments}</span>
          </div>
        </div>

        {/* Issues */}
        {hasIssues && (
          <div className="space-y-2 pt-2 border-t">
            {paymentsWithoutTransactions > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Nicht in Banking:</span>
                <Badge variant="outline" className="bg-warning/10">
                  {paymentsWithoutTransactions}
                </Badge>
              </div>
            )}
            {transactionsWithoutPayments > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Verwaiste Transaktionen:</span>
                <Badge variant="destructive">
                  {transactionsWithoutPayments}
                </Badge>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          {hasIssues && paymentsWithoutTransactions > 0 && (
            <Button 
              size="sm" 
              variant="default"
              onClick={handleSync}
              disabled={syncExistingPaymentsToTransactions.isPending}
              className="flex-1"
            >
              {syncExistingPaymentsToTransactions.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Synchronisieren
            </Button>
          )}
          <Link to="/reports" className={hasIssues && paymentsWithoutTransactions > 0 ? '' : 'flex-1'}>
            <Button size="sm" variant="outline" className="w-full">
              Details
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
