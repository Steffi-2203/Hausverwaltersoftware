import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Receipt, Link2, CheckCircle2, ExternalLink, X, Sparkles, Search, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useTransactionExpenseMatch, useLinkTransactionToExpense } from '@/hooks/useTransactionExpenseMatch';
import { useExpenses } from '@/hooks/useExpenses';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

interface TransactionExpenseLinkDialogProps {
  transaction: {
    id: string;
    amount: number;
    transaction_date: string;
    counterpart_name: string | null;
    description: string | null;
    property_id?: string | null;
  };
  children: React.ReactNode;
}

export function TransactionExpenseLinkDialog({
  transaction,
  children,
}: TransactionExpenseLinkDialogProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAllExpenses, setShowAllExpenses] = useState(false);
  
  const suggestedExpenses = useTransactionExpenseMatch(transaction);
  const { data: allExpenses = [] } = useExpenses();
  const linkMutation = useLinkTransactionToExpense();
  
  // Filter unlinked expenses for manual search
  const unlinkedExpenses = allExpenses.filter(e => !e.transaction_id);
  const filteredExpenses = searchQuery 
    ? unlinkedExpenses.filter(e => 
        e.bezeichnung.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (e as any).properties?.name?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : unlinkedExpenses;
  
  const handleLink = (expenseId: string) => {
    linkMutation.mutate({ expenseId, transactionId: transaction.id });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Kostenbeleg verknüpfen
          </DialogTitle>
          <DialogDescription>
            Verknüpfen Sie diese Transaktion mit einem erfassten Kostenbeleg für die Plausibilitätsprüfung.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Transaction Info */}
          <div className="bg-muted rounded-lg p-3 space-y-1">
            <div className="text-sm text-muted-foreground">Transaktion:</div>
            <div className="font-medium">
              € {Math.abs(transaction.amount).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
            </div>
            <div className="text-sm">
              {format(new Date(transaction.transaction_date), 'dd.MM.yyyy', { locale: de })}
              {transaction.counterpart_name && ` • ${transaction.counterpart_name}`}
            </div>
          </div>
          
          {/* Suggested Matches */}
          {suggestedExpenses.length > 0 && !showAllExpenses && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-amber-500" />
                Passende Kostenbelege
              </div>
              <ScrollArea className="max-h-48">
                <div className="space-y-2 pr-4">
                  {suggestedExpenses.map((expense) => (
                    <div
                      key={expense.expenseId}
                      className="border rounded-lg p-3 space-y-2 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex justify-between items-start">
                        <div className="space-y-0.5 flex-1 min-w-0">
                          <div className="font-medium truncate">{expense.bezeichnung}</div>
                          <div className="text-sm text-muted-foreground">
                            € {expense.betrag.toLocaleString('de-AT', { minimumFractionDigits: 2 })} • {format(new Date(expense.datum), 'dd.MM.yyyy', { locale: de })}
                          </div>
                          {expense.propertyName && (
                            <div className="text-xs text-muted-foreground">{expense.propertyName}</div>
                          )}
                        </div>
                        <Badge
                          variant="secondary"
                          className={cn(
                            'text-xs ml-2 shrink-0',
                            expense.confidence >= 0.8 && 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
                            expense.confidence >= 0.6 && expense.confidence < 0.8 && 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
                            expense.confidence < 0.6 && 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                          )}
                        >
                          {Math.round(expense.confidence * 100)}%
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {expense.matchReasons.map((reason, i) => (
                          <Badge key={i} variant="outline" className="text-xs py-0">
                            {reason}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        {expense.beleg_url && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={() => window.open(expense.beleg_url!, '_blank')}
                          >
                            <ExternalLink className="h-4 w-4 mr-1" />
                            Beleg
                          </Button>
                        )}
                        <Button
                          size="sm"
                          className="flex-1"
                          onClick={() => handleLink(expense.expenseId)}
                          disabled={linkMutation.isPending}
                        >
                          <Link2 className="h-4 w-4 mr-1" />
                          Verknüpfen
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
          
          {/* Toggle to show all / manual search */}
          {!showAllExpenses && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setShowAllExpenses(true)}
            >
              <Search className="h-4 w-4 mr-2" />
              Alle Kostenbelege durchsuchen
            </Button>
          )}
          
          {/* Manual Search */}
          {showAllExpenses && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAllExpenses(false)}
                >
                  ← Zurück zu Vorschlägen
                </Button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Kostenbeleg suchen..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <ScrollArea className="h-64">
                <div className="space-y-2 pr-4">
                  {filteredExpenses.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      Keine unverknüpften Kostenbelege gefunden
                    </div>
                  ) : (
                    filteredExpenses.slice(0, 20).map((expense) => (
                      <div
                        key={expense.id}
                        className="border rounded-lg p-3 hover:bg-muted/50 transition-colors flex justify-between items-center gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{expense.bezeichnung}</div>
                          <div className="text-sm text-muted-foreground">
                            € {Number(expense.betrag).toLocaleString('de-AT', { minimumFractionDigits: 2 })} • {format(new Date(expense.datum), 'dd.MM.yyyy', { locale: de })}
                          </div>
                          {(expense as any).properties?.name && (
                            <div className="text-xs text-muted-foreground">{(expense as any).properties.name}</div>
                          )}
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleLink(expense.id)}
                          disabled={linkMutation.isPending}
                        >
                          <Link2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          )}
          
          {/* No matches hint */}
          {suggestedExpenses.length === 0 && !showAllExpenses && (
            <div className="text-center py-4 text-muted-foreground text-sm">
              Keine automatischen Vorschläge gefunden.
              <br />
              Suchen Sie manuell nach einem passenden Beleg.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
