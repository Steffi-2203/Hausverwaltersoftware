import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Link2, Link2Off, CheckCircle2, AlertCircle, Sparkles, X } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { TransactionMatch, useLinkExpenseTransaction } from '@/hooks/useExpenseTransactionMatch';

interface TransactionMatchBadgeProps {
  expenseId: string;
  linkedTransaction?: {
    id: string;
    amount: number;
    date: string;
    counterpartName: string | null;
  };
  suggestedMatches: TransactionMatch[];
}

export function TransactionMatchBadge({
  expenseId,
  linkedTransaction,
  suggestedMatches,
}: TransactionMatchBadgeProps) {
  const [open, setOpen] = useState(false);
  const linkMutation = useLinkExpenseTransaction();

  const handleLink = (transactionId: string) => {
    linkMutation.mutate({ expenseId, transactionId });
    setOpen(false);
  };

  const handleUnlink = () => {
    linkMutation.mutate({ expenseId, transactionId: null });
    setOpen(false);
  };

  // Already linked
  if (linkedTransaction) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Badge
            variant="outline"
            className="cursor-pointer border-green-500 bg-green-500/10 text-green-700 dark:text-green-300 hover:bg-green-500/20"
          >
            <Link2 className="h-3 w-3 mr-1" />
            Verknüpft
          </Badge>
        </PopoverTrigger>
        <PopoverContent className="w-80" align="start">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <span className="font-medium">Mit Transaktion verknüpft</span>
            </div>
            <div className="bg-muted rounded-lg p-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Betrag:</span>
                <span className="font-medium">
                  € {Math.abs(linkedTransaction.amount).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Datum:</span>
                <span>{format(new Date(linkedTransaction.date), 'dd.MM.yyyy', { locale: de })}</span>
              </div>
              {linkedTransaction.counterpartName && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Empfänger:</span>
                  <span className="truncate max-w-[160px]">{linkedTransaction.counterpartName}</span>
                </div>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full text-destructive hover:text-destructive"
              onClick={handleUnlink}
              disabled={linkMutation.isPending}
            >
              <Link2Off className="h-4 w-4 mr-2" />
              Verknüpfung aufheben
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // Has suggested matches
  if (suggestedMatches.length > 0) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Badge
            variant="outline"
            className="cursor-pointer border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 animate-pulse"
          >
            <Sparkles className="h-3 w-3 mr-1" />
            {suggestedMatches.length} Vorschlag{suggestedMatches.length > 1 ? 'e' : ''}
          </Badge>
        </PopoverTrigger>
        <PopoverContent className="w-96" align="start">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-amber-500" />
                <span className="font-medium">Passende Transaktionen</span>
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {suggestedMatches.map((match) => (
                <div
                  key={match.transactionId}
                  className="border rounded-lg p-3 space-y-2 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex justify-between items-start">
                    <div className="space-y-0.5">
                      <div className="font-medium">
                        € {Math.abs(match.amount).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {format(new Date(match.date), 'dd.MM.yyyy', { locale: de })}
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className={cn(
                        'text-xs',
                        match.confidence >= 0.8 && 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
                        match.confidence >= 0.6 && match.confidence < 0.8 && 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
                        match.confidence < 0.6 && 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                      )}
                    >
                      {Math.round(match.confidence * 100)}%
                    </Badge>
                  </div>
                  {(match.counterpartName || match.description) && (
                    <div className="text-sm text-muted-foreground truncate">
                      {match.counterpartName || match.description}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {match.matchReasons.map((reason, i) => (
                      <Badge key={i} variant="outline" className="text-xs py-0">
                        {reason}
                      </Badge>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => handleLink(match.transactionId)}
                    disabled={linkMutation.isPending}
                  >
                    <Link2 className="h-4 w-4 mr-2" />
                    Verknüpfen
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // No matches
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <AlertCircle className="h-3 w-3 mr-1" />
      Offen
    </Badge>
  );
}
