import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { useUnmatchedTransactions } from '@/hooks/useTransactions';
import { useAutoMatch, useApplyMatch, type TransactionMatchResult } from '@/hooks/useAutoMatch';
import { Loader2, Wand2, Check, CheckCheck, ArrowRight } from 'lucide-react';

function formatAmount(amount: string | number): string {
  return new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(Number(amount));
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleDateString('de-AT');
  } catch {
    return dateStr;
  }
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'secondary';
  let className = '';
  if (confidence > 80) {
    className = 'bg-green-600 dark:bg-green-700 text-white';
  } else if (confidence >= 50) {
    className = 'bg-yellow-500 dark:bg-yellow-600 text-white';
  } else {
    className = 'bg-red-500 dark:bg-red-600 text-white';
  }

  return (
    <Badge variant={variant} className={`${className} no-default-hover-elevate no-default-active-elevate`} data-testid="badge-confidence">
      {confidence}%
    </Badge>
  );
}

export default function AutoMatch() {
  const { data: unmatchedTransactions, isLoading: isLoadingTransactions } = useUnmatchedTransactions();
  const autoMatchMutation = useAutoMatch();
  const applyMatchMutation = useApplyMatch();

  const [matchResults, setMatchResults] = useState<TransactionMatchResult[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [appliedCount, setAppliedCount] = useState(0);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());

  const transactions = unmatchedTransactions || [];

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === transactions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(transactions.map(t => t.id)));
    }
  };

  const handleAutoMatch = async () => {
    const ids = selectedIds.size > 0 ? Array.from(selectedIds) : transactions.map(t => t.id);
    if (ids.length === 0) return;

    const results = await autoMatchMutation.mutateAsync(ids);
    setMatchResults(results);
    setAppliedCount(0);
    setAppliedIds(new Set());
  };

  const handleApply = async (result: TransactionMatchResult) => {
    const { suggestions } = result;
    await applyMatchMutation.mutateAsync({
      transactionId: result.transactionId,
      tenantId: suggestions.tenant?.id,
      unitId: suggestions.unit?.id,
      propertyId: suggestions.property?.id,
      categoryId: suggestions.category?.id,
      invoiceId: suggestions.invoice?.id,
    });
    setAppliedCount(prev => prev + 1);
    setAppliedIds(prev => new Set(prev).add(result.transactionId));
  };

  const handleApplyAll = async () => {
    const highConfidence = matchResults.filter(r => {
      if (appliedIds.has(r.transactionId)) return false;
      const s = r.suggestions;
      const maxConf = Math.max(
        s.tenant?.confidence || 0,
        s.unit?.confidence || 0,
        s.property?.confidence || 0,
        s.category?.confidence || 0,
        s.invoice?.confidence || 0,
      );
      return maxConf > 80;
    });

    let count = 0;
    for (const result of highConfidence) {
      try {
        await handleApply(result);
        count++;
      } catch {
        // continue with others
      }
    }
    if (count > 0) {
      setAppliedCount(prev => prev + count);
    }
  };

  const highConfidenceCount = matchResults.filter(r => {
    if (appliedIds.has(r.transactionId)) return false;
    const s = r.suggestions;
    const maxConf = Math.max(
      s.tenant?.confidence || 0,
      s.unit?.confidence || 0,
      s.property?.confidence || 0,
      s.category?.confidence || 0,
      s.invoice?.confidence || 0,
    );
    return maxConf > 80;
  }).length;

  const resultsWithSuggestions = matchResults.filter(r => Object.keys(r.suggestions).length > 0);

  return (
    <MainLayout title="">
      <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground" data-testid="text-page-title">
              Automatische Belegzuordnung
            </h1>
            <p className="text-sm text-muted-foreground mt-1" data-testid="text-page-description">
              Transaktionen automatisch Mietern, Einheiten und Kategorien zuordnen
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {matchResults.length > 0 && highConfidenceCount > 0 && (
              <Button
                onClick={handleApplyAll}
                disabled={applyMatchMutation.isPending}
                data-testid="button-apply-all"
              >
                {applyMatchMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCheck className="mr-2 h-4 w-4" />
                )}
                Alle übernehmen ({highConfidenceCount})
              </Button>
            )}
            <Button
              onClick={handleAutoMatch}
              disabled={autoMatchMutation.isPending || transactions.length === 0}
              data-testid="button-auto-match"
            >
              {autoMatchMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="mr-2 h-4 w-4" />
              )}
              {selectedIds.size > 0
                ? `${selectedIds.size} zuordnen`
                : 'Automatisch zuordnen'}
            </Button>
          </div>
        </div>

        {appliedCount > 0 && (
          <Card data-testid="card-success-count">
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                <Check className="h-5 w-5" />
                <span className="font-medium" data-testid="text-applied-count">
                  {appliedCount} Zuordnung{appliedCount !== 1 ? 'en' : ''} erfolgreich übernommen
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {autoMatchMutation.isPending && (
          <Card data-testid="card-matching-progress">
            <CardContent className="py-8">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-muted-foreground">Transaktionen werden analysiert...</p>
              </div>
            </CardContent>
          </Card>
        )}

        {matchResults.length > 0 && !autoMatchMutation.isPending && (
          <Card data-testid="card-match-results">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
              <CardTitle className="text-lg">
                Zuordnungsvorschläge ({resultsWithSuggestions.length} von {matchResults.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table data-testid="table-match-results">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[100px]">Datum</TableHead>
                      <TableHead className="text-right w-[120px]">Betrag</TableHead>
                      <TableHead>Buchungstext</TableHead>
                      <TableHead>Mieter</TableHead>
                      <TableHead>Einheit / Liegenschaft</TableHead>
                      <TableHead>Kategorie</TableHead>
                      <TableHead>Rechnung</TableHead>
                      <TableHead className="w-[100px]">Aktion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {matchResults.map(result => {
                      const tx = transactions.find(t => t.id === result.transactionId);
                      if (!tx) return null;
                      const { suggestions } = result;
                      const hasSuggestions = Object.keys(suggestions).length > 0;
                      const isApplied = appliedIds.has(result.transactionId);

                      return (
                        <TableRow
                          key={result.transactionId}
                          className={isApplied ? 'opacity-50' : ''}
                          data-testid={`row-match-result-${result.transactionId}`}
                        >
                          <TableCell className="text-sm" data-testid={`text-date-${result.transactionId}`}>
                            {formatDate(tx.transactionDate)}
                          </TableCell>
                          <TableCell
                            className={`text-right text-sm font-medium ${Number(tx.amount) >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                            data-testid={`text-amount-${result.transactionId}`}
                          >
                            {formatAmount(tx.amount)}
                          </TableCell>
                          <TableCell className="text-sm max-w-[200px] truncate" data-testid={`text-booking-${result.transactionId}`}>
                            {tx.bookingText || tx.reference || '-'}
                          </TableCell>
                          <TableCell data-testid={`text-tenant-${result.transactionId}`}>
                            {suggestions.tenant ? (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-sm">{suggestions.tenant.name}</span>
                                <ConfidenceBadge confidence={suggestions.tenant.confidence} />
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell data-testid={`text-unit-property-${result.transactionId}`}>
                            <div className="space-y-0.5">
                              {suggestions.unit && (
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-sm">Top {suggestions.unit.topNummer}</span>
                                  <ConfidenceBadge confidence={suggestions.unit.confidence} />
                                </div>
                              )}
                              {suggestions.property && (
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs text-muted-foreground">{suggestions.property.name}</span>
                                </div>
                              )}
                              {!suggestions.unit && !suggestions.property && (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell data-testid={`text-category-${result.transactionId}`}>
                            {suggestions.category ? (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-sm">{suggestions.category.name}</span>
                                <ConfidenceBadge confidence={suggestions.category.confidence} />
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell data-testid={`text-invoice-${result.transactionId}`}>
                            {suggestions.invoice ? (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-sm">{suggestions.invoice.invoiceNumber}</span>
                                <ConfidenceBadge confidence={suggestions.invoice.confidence} />
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {isApplied ? (
                              <Badge variant="secondary" className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 no-default-hover-elevate no-default-active-elevate" data-testid={`badge-applied-${result.transactionId}`}>
                                <Check className="h-3 w-3 mr-1" />
                                Erledigt
                              </Badge>
                            ) : hasSuggestions ? (
                              <Button
                                size="sm"
                                onClick={() => handleApply(result)}
                                disabled={applyMatchMutation.isPending}
                                data-testid={`button-apply-${result.transactionId}`}
                              >
                                <ArrowRight className="h-4 w-4 mr-1" />
                                Übernehmen
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">Keine Vorschläge</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        <Card data-testid="card-unmatched-transactions">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
            <CardTitle className="text-lg">
              Nicht zugeordnete Transaktionen ({transactions.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoadingTransactions ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : transactions.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground" data-testid="text-no-transactions">
                Alle Transaktionen sind bereits zugeordnet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table data-testid="table-unmatched-transactions">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]">
                        <Checkbox
                          checked={selectedIds.size === transactions.length && transactions.length > 0}
                          onCheckedChange={toggleSelectAll}
                          data-testid="checkbox-select-all"
                        />
                      </TableHead>
                      <TableHead className="w-[100px]">Datum</TableHead>
                      <TableHead className="text-right w-[120px]">Betrag</TableHead>
                      <TableHead>Buchungstext</TableHead>
                      <TableHead>Partner</TableHead>
                      <TableHead>Referenz</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map(tx => (
                      <TableRow key={tx.id} data-testid={`row-transaction-${tx.id}`}>
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(tx.id)}
                            onCheckedChange={() => toggleSelect(tx.id)}
                            data-testid={`checkbox-select-${tx.id}`}
                          />
                        </TableCell>
                        <TableCell className="text-sm" data-testid={`text-tx-date-${tx.id}`}>
                          {formatDate(tx.transactionDate)}
                        </TableCell>
                        <TableCell
                          className={`text-right text-sm font-medium ${Number(tx.amount) >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                          data-testid={`text-tx-amount-${tx.id}`}
                        >
                          {formatAmount(tx.amount)}
                        </TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate" data-testid={`text-tx-booking-${tx.id}`}>
                          {tx.bookingText || '-'}
                        </TableCell>
                        <TableCell className="text-sm" data-testid={`text-tx-partner-${tx.id}`}>
                          {tx.partnerName || '-'}
                        </TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate" data-testid={`text-tx-reference-${tx.id}`}>
                          {tx.reference || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
