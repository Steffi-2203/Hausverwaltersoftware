import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { RefreshCw, CheckCircle, ArrowRight, TrendingUp, AlertCircle, Loader2 } from 'lucide-react';
import { useBankAccounts } from '@/hooks/useBankAccounts';
import {
  useBankReconciliation,
  useApplyReconciliation,
  useReconciliationStats,
  type MatchProposal,
  type ReconciliationAction,
} from '@/hooks/useBankReconciliation';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(value);
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  return new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(dateStr));
}

function getConfidenceBadgeVariant(confidence: number): 'default' | 'secondary' | 'destructive' {
  if (confidence >= 90) return 'default';
  if (confidence >= 70) return 'secondary';
  return 'destructive';
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 90) return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
  if (confidence >= 70) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
  return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
}

export default function BankReconciliation() {
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<string>('');
  const [proposals, setProposals] = useState<MatchProposal[]>([]);
  const [selectedMatches, setSelectedMatches] = useState<Map<string, ReconciliationAction[]>>(new Map());
  const [hasRun, setHasRun] = useState(false);

  const { data: bankAccounts, isLoading: loadingAccounts } = useBankAccounts();
  const reconciliationMutation = useBankReconciliation();
  const applyMutation = useApplyReconciliation();
  const { data: stats, isLoading: loadingStats } = useReconciliationStats();

  const handleStartReconciliation = async () => {
    if (!selectedBankAccountId) return;
    try {
      const result = await reconciliationMutation.mutateAsync(selectedBankAccountId);
      setProposals(result);
      setSelectedMatches(new Map());
      setHasRun(true);
    } catch {}
  };

  const toggleMatch = (transactionId: string, match: MatchProposal['matches'][0], txAmount: number) => {
    setSelectedMatches(prev => {
      const next = new Map(prev);
      const existing = next.get(transactionId) || [];
      const idx = existing.findIndex(a => a.invoiceId === match.invoiceId);
      if (idx >= 0) {
        existing.splice(idx, 1);
        if (existing.length === 0) {
          next.delete(transactionId);
        } else {
          next.set(transactionId, [...existing]);
        }
      } else {
        next.set(transactionId, [...existing, {
          transactionId,
          invoiceId: match.invoiceId,
          tenantId: match.tenantId || '',
          unitId: match.unitId || '',
          amount: match.invoiceAmount,
        }]);
      }
      return next;
    });
  };

  const isMatchSelected = (transactionId: string, invoiceId: string) => {
    const actions = selectedMatches.get(transactionId);
    return actions ? actions.some(a => a.invoiceId === invoiceId) : false;
  };

  const totalSelectedCount = useMemo(() => {
    let count = 0;
    selectedMatches.forEach(actions => count += actions.length);
    return count;
  }, [selectedMatches]);

  const totalSelectedAmount = useMemo(() => {
    let amount = 0;
    selectedMatches.forEach(actions => {
      actions.forEach(a => amount += a.amount);
    });
    return amount;
  }, [selectedMatches]);

  const handleApply = async () => {
    const allActions: ReconciliationAction[] = [];
    selectedMatches.forEach(actions => allActions.push(...actions));
    if (allActions.length === 0) return;
    try {
      await applyMutation.mutateAsync(allActions);
      setSelectedMatches(new Map());
      if (selectedBankAccountId) {
        const result = await reconciliationMutation.mutateAsync(selectedBankAccountId);
        setProposals(result);
      }
    } catch {}
  };

  const selectAll = () => {
    const next = new Map<string, ReconciliationAction[]>();
    for (const proposal of proposals) {
      if (proposal.matches.length > 0) {
        const bestMatch = proposal.matches[0];
        next.set(proposal.transactionId, [{
          transactionId: proposal.transactionId,
          invoiceId: bestMatch.invoiceId,
          tenantId: bestMatch.tenantId || '',
          unitId: bestMatch.unitId || '',
          amount: bestMatch.invoiceAmount,
        }]);
      }
    }
    setSelectedMatches(next);
  };

  const deselectAll = () => {
    setSelectedMatches(new Map());
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto" data-testid="page-bank-reconciliation">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Bank-Abgleich</h1>
          <p className="text-sm text-muted-foreground mt-1" data-testid="text-page-subtitle">
            Automatischer Abgleich von Banktransaktionen mit offenen Rechnungen
          </p>
        </div>
      </div>

      {!loadingStats && stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="section-stats">
          <Card data-testid="card-stat-unmatched">
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Offene Transaktionen</CardTitle>
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-unmatched-count">{stats.unmatchedCount}</div>
              <p className="text-xs text-muted-foreground" data-testid="text-unmatched-amount">
                {formatCurrency(stats.unmatchedAmount)} offen
              </p>
            </CardContent>
          </Card>
          <Card data-testid="card-stat-matched">
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Zugeordnet</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-matched-count">{stats.matchedTransactions}</div>
              <p className="text-xs text-muted-foreground">von {stats.totalTransactions} gesamt</p>
            </CardContent>
          </Card>
          <Card data-testid="card-stat-rate">
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Abgleich-Rate</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-match-rate">{stats.matchRate}%</div>
              <p className="text-xs text-muted-foreground">der Transaktionen zugeordnet</p>
            </CardContent>
          </Card>
          <Card data-testid="card-stat-total">
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Gesamt-Transaktionen</CardTitle>
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-transactions">{stats.totalTransactions}</div>
              <p className="text-xs text-muted-foreground">
                Letzter Abgleich: {formatDate(stats.lastReconciliation)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card data-testid="card-reconciliation-controls">
        <CardHeader>
          <CardTitle className="text-lg">Abgleich starten</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium mb-2 block" htmlFor="bank-account-select">
                Bankkonto auswählen
              </label>
              <Select
                value={selectedBankAccountId}
                onValueChange={setSelectedBankAccountId}
              >
                <SelectTrigger data-testid="select-bank-account" id="bank-account-select">
                  <SelectValue placeholder="Bankkonto wählen..." />
                </SelectTrigger>
                <SelectContent>
                  {loadingAccounts ? (
                    <SelectItem value="loading" disabled>Laden...</SelectItem>
                  ) : bankAccounts && bankAccounts.length > 0 ? (
                    bankAccounts.map((acc: any) => (
                      <SelectItem key={acc.id} value={acc.id} data-testid={`select-option-bank-${acc.id}`}>
                        {acc.account_name || acc.accountName} {acc.iban ? `(${acc.iban})` : ''}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="empty" disabled>Keine Bankkonten vorhanden</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleStartReconciliation}
              disabled={!selectedBankAccountId || reconciliationMutation.isPending}
              data-testid="button-start-reconciliation"
            >
              {reconciliationMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Abgleich starten
            </Button>
          </div>
        </CardContent>
      </Card>

      {hasRun && proposals.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground" data-testid="text-proposals-count">
            {proposals.length} Vorschläge gefunden
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={selectAll} data-testid="button-select-all">
              Alle auswählen
            </Button>
            <Button variant="outline" size="sm" onClick={deselectAll} data-testid="button-deselect-all">
              Auswahl aufheben
            </Button>
          </div>
        </div>
      )}

      {hasRun && proposals.length === 0 && !reconciliationMutation.isPending && (
        <Card data-testid="card-empty-state">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckCircle className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Keine offenen Transaktionen</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              Alle Eingangs-Transaktionen auf diesem Konto sind bereits zugeordnet oder es gibt keine passenden offenen Rechnungen.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4" data-testid="section-proposals">
        {proposals.map((proposal) => (
          <Card key={proposal.transactionId} data-testid={`card-proposal-${proposal.transactionId}`}>
            <CardContent className="p-4 md:p-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-2" data-testid={`section-transaction-${proposal.transactionId}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" data-testid={`badge-date-${proposal.transactionId}`}>
                      {formatDate(proposal.transactionDate)}
                    </Badge>
                    <span className="text-lg font-bold" data-testid={`text-amount-${proposal.transactionId}`}>
                      {formatCurrency(proposal.amount)}
                    </span>
                  </div>
                  <p className="text-sm font-medium" data-testid={`text-partner-${proposal.transactionId}`}>
                    {proposal.partnerName || 'Unbekannt'}
                  </p>
                  {proposal.partnerIban && (
                    <p className="text-xs text-muted-foreground font-mono" data-testid={`text-iban-${proposal.transactionId}`}>
                      {proposal.partnerIban}
                    </p>
                  )}
                  {proposal.bookingText && (
                    <p className="text-xs text-muted-foreground" data-testid={`text-booking-${proposal.transactionId}`}>
                      {proposal.bookingText}
                    </p>
                  )}
                </div>

                <div className="space-y-2" data-testid={`section-matches-${proposal.transactionId}`}>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <ArrowRight className="h-4 w-4" />
                    <span>Mögliche Zuordnungen</span>
                  </div>
                  {proposal.matches.map((match) => (
                    <div
                      key={`${proposal.transactionId}-${match.invoiceId}`}
                      className="flex items-start gap-3 p-3 rounded-md border border-border dark:border-border"
                      data-testid={`match-row-${proposal.transactionId}-${match.invoiceId}`}
                    >
                      <Checkbox
                        checked={isMatchSelected(proposal.transactionId, match.invoiceId)}
                        onCheckedChange={() => toggleMatch(proposal.transactionId, match, proposal.amount)}
                        data-testid={`checkbox-match-${proposal.transactionId}-${match.invoiceId}`}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium" data-testid={`text-invoice-number-${match.invoiceId}`}>
                            {match.invoiceNumber}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${getConfidenceColor(match.confidence)}`} data-testid={`badge-confidence-${match.invoiceId}`}>
                            {match.confidence}%
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground" data-testid={`text-tenant-${match.invoiceId}`}>
                          {match.tenantName} &middot; {match.unitTopNummer} &middot; {match.propertyName}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold" data-testid={`text-invoice-amount-${match.invoiceId}`}>
                            {formatCurrency(match.invoiceAmount)}
                          </span>
                          <Badge variant="outline" className="text-xs" data-testid={`badge-reason-${match.invoiceId}`}>
                            {match.matchReason}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {totalSelectedCount > 0 && (
        <div
          className="sticky bottom-4 z-50 bg-card dark:bg-card border border-border rounded-md shadow-lg p-4"
          data-testid="section-summary-bar"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium" data-testid="text-selected-summary">
                {totalSelectedCount} von {proposals.length} Transaktionen zugeordnet
              </p>
              <p className="text-lg font-bold" data-testid="text-selected-amount">
                Gesamtbetrag: {formatCurrency(totalSelectedAmount)}
              </p>
            </div>
            <Button
              onClick={handleApply}
              disabled={applyMutation.isPending}
              data-testid="button-apply-reconciliation"
            >
              {applyMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="mr-2 h-4 w-4" />
              )}
              Ausgewählte übernehmen
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
