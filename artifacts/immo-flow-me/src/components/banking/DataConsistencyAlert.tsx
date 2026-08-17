import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { 
  AlertTriangle, 
  ChevronDown, 
  ChevronUp, 
  RefreshCw, 
  X, 
  CheckCircle2,
  Loader2,
  Info
} from 'lucide-react';
import { useDataConsistencyCheck, ConsistencyIssue } from '@/hooks/useDataConsistencyCheck';
import { usePaymentSync } from '@/hooks/usePaymentSync';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

interface DataConsistencyAlertProps {
  onDismiss?: () => void;
  showDismiss?: boolean;
  variant?: 'default' | 'compact';
}

export function DataConsistencyAlert({ 
  onDismiss, 
  showDismiss = true,
  variant = 'default'
}: DataConsistencyAlertProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  
  const { 
    isLoading, 
    hasIssues, 
    issues, 
    summary,
    paymentsWithoutTransactions,
    transactionsWithoutPayments
  } = useDataConsistencyCheck();
  
  const { syncExistingPaymentsToTransactions } = usePaymentSync();

  const handleDismiss = () => {
    setIsDismissed(true);
    onDismiss?.();
  };

  const handleSync = async () => {
    await syncExistingPaymentsToTransactions.mutateAsync();
  };

  // Don't show if loading, no issues, or dismissed
  if (isLoading || !hasIssues || isDismissed) {
    return null;
  }

  const missingTransactionIssues = issues.filter(i => i.type === 'missing_transaction');
  const missingPaymentIssues = issues.filter(i => i.type === 'missing_payment');

  if (variant === 'compact') {
    return (
      <Alert variant="default" className="border-warning bg-warning/10">
        <AlertTriangle className="h-4 w-4 text-warning" />
        <AlertDescription className="flex items-center justify-between">
          <span>
            {paymentsWithoutTransactions > 0 && (
              <span className="mr-4">
                <Badge variant="outline" className="mr-1">{paymentsWithoutTransactions}</Badge>
                Zahlung(en) nicht synchronisiert
              </span>
            )}
            {transactionsWithoutPayments > 0 && (
              <span>
                <Badge variant="outline" className="mr-1 border-destructive text-destructive">{transactionsWithoutPayments}</Badge>
                verwaiste Transaktionen
              </span>
            )}
          </span>
          <div className="flex gap-2">
            {paymentsWithoutTransactions > 0 && (
              <Button 
                size="sm" 
                variant="outline"
                onClick={handleSync}
                disabled={syncExistingPaymentsToTransactions.isPending}
              >
                {syncExistingPaymentsToTransactions.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-1" />
                )}
                Sync
              </Button>
            )}
            {showDismiss && (
              <Button size="sm" variant="ghost" onClick={handleDismiss}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="default" className="border-warning bg-warning/10 mb-6">
      <AlertTriangle className="h-4 w-4 text-warning" />
      <AlertTitle className="flex items-center justify-between">
        <span>Datenkonsistenz-Warnung</span>
        {showDismiss && (
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={handleDismiss}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </AlertTitle>
      <AlertDescription className="mt-2">
        <div className="space-y-3">
          {/* Summary */}
          <div className="flex flex-wrap gap-4 text-sm">
            {paymentsWithoutTransactions > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-warning/20">
                  {paymentsWithoutTransactions}
                </Badge>
                <span>Mieteinnahme(n) nicht in Banking-Übersicht</span>
              </div>
            )}
            {transactionsWithoutPayments > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="destructive">
                  {transactionsWithoutPayments}
                </Badge>
                <span>Verwaiste Transaktionen (ohne Payment-Eintrag)</span>
              </div>
            )}
          </div>

          {/* Details Collapsible */}
          <Collapsible open={isOpen} onOpenChange={setIsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="p-0 h-auto font-normal text-muted-foreground hover:text-foreground">
                {isOpen ? (
                  <>
                    <ChevronUp className="h-4 w-4 mr-1" />
                    Details ausblenden
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4 mr-1" />
                    Details anzeigen
                  </>
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-3">
              {missingTransactionIssues.length > 0 && (
                <div className="space-y-1">
                  <div className="text-sm font-medium flex items-center gap-1">
                    <Info className="h-3 w-3" />
                    Payments ohne Transaction (in Banking nicht sichtbar):
                  </div>
                  <ul className="text-sm text-muted-foreground space-y-0.5 ml-4">
                    {missingTransactionIssues.slice(0, 5).map((issue, i) => (
                      <li key={issue.paymentId || i} className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground/60">•</span>
                        <span>{issue.tenantName}</span>
                        <span className="font-mono">€{issue.amount?.toFixed(2)}</span>
                        <span className="text-xs">
                          ({issue.date && format(new Date(issue.date), 'dd.MM.yyyy', { locale: de })})
                        </span>
                      </li>
                    ))}
                    {missingTransactionIssues.length > 5 && (
                      <li className="text-xs text-muted-foreground/60">
                        ... und {missingTransactionIssues.length - 5} weitere
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {missingPaymentIssues.length > 0 && (
                <div className="space-y-1">
                  <div className="text-sm font-medium flex items-center gap-1 text-destructive">
                    <AlertTriangle className="h-3 w-3" />
                    Transactions ohne Payment (mögliche Duplikate):
                  </div>
                  <ul className="text-sm text-muted-foreground space-y-0.5 ml-4">
                    {missingPaymentIssues.slice(0, 5).map((issue, i) => (
                      <li key={issue.transactionId || i} className="flex items-center gap-2">
                        <span className="text-xs text-destructive/60">•</span>
                        <span>{issue.tenantName}</span>
                        <span className="font-mono">€{issue.amount?.toFixed(2)}</span>
                        <span className="text-xs">
                          ({issue.date && format(new Date(issue.date), 'dd.MM.yyyy', { locale: de })})
                        </span>
                      </li>
                    ))}
                    {missingPaymentIssues.length > 5 && (
                      <li className="text-xs text-destructive/60">
                        ... und {missingPaymentIssues.length - 5} weitere
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {/* Sync Status */}
              <div className="text-xs text-muted-foreground border-t pt-2">
                Sync-Status: {summary.syncedPayments}/{summary.totalPayments} Payments synchronisiert
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            {paymentsWithoutTransactions > 0 && (
              <Button 
                size="sm" 
                onClick={handleSync}
                disabled={syncExistingPaymentsToTransactions.isPending}
              >
                {syncExistingPaymentsToTransactions.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Jetzt synchronisieren
              </Button>
            )}
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}

/**
 * Compact status badge for use in headers/dashboards
 */
export function DataConsistencyStatus() {
  const { isLoading, hasIssues, issues } = useDataConsistencyCheck();

  if (isLoading) {
    return null;
  }

  if (!hasIssues) {
    return (
      <Badge variant="outline" className="bg-success/10 text-success border-success/30">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Sync OK
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">
      <AlertTriangle className="h-3 w-3 mr-1" />
      {issues.length} Inkonsistenz{issues.length !== 1 ? 'en' : ''}
    </Badge>
  );
}
