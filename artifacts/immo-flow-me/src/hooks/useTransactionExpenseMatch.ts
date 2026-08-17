import { useMemo } from 'react';
import { useExpenses } from './useExpenses';
import { apiRequest } from '@/lib/queryClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fuzzyMatch, datesWithinRange, dateProximityScore } from '@/utils/matchingUtils';

interface Transaction {
  id: string;
  amount: number;
  transaction_date: string;
  counterpart_name: string | null;
  description: string | null;
  property_id?: string | null;
}

export interface ExpenseMatch {
  expenseId: string;
  bezeichnung: string;
  betrag: number;
  datum: string;
  propertyName: string | null;
  beleg_url: string | null;
  confidence: number;
  matchReasons: string[];
}

export function useTransactionExpenseMatch(transaction: Transaction | null) {
  const { data: expenses = [] } = useExpenses();
  
  const suggestedExpenses = useMemo((): ExpenseMatch[] => {
    if (!transaction) return [];
    
    const txAmount = Number(transaction.amount);
    
    if (txAmount >= 0) return [];
    
    const potentialMatches: ExpenseMatch[] = [];
    
    for (const expense of expenses) {
      if (expense.transaction_id) continue;
      
      const expenseAmount = Number(expense.betrag);
      const txAbsAmount = Math.abs(txAmount);
      const amountDiff = Math.abs(expenseAmount - txAbsAmount);
      const amountMatch = amountDiff < 0.01;
      const closeAmountMatch = amountDiff / expenseAmount < 0.05;
      
      if (!amountMatch && !closeAmountMatch) continue;
      
      if (!datesWithinRange(expense.datum, transaction.transaction_date, 14)) continue;
      
      const matchReasons: string[] = [];
      let confidence = 0;
      
      if (amountMatch) {
        confidence += 0.5;
        matchReasons.push('Exakter Betrag');
      } else if (closeAmountMatch) {
        confidence += 0.3;
        matchReasons.push('Ähnlicher Betrag');
      }
      
      const dateScore = dateProximityScore(expense.datum, transaction.transaction_date);
      confidence += dateScore * 0.3;
      if (dateScore >= 0.9) {
        matchReasons.push('Gleiches/nächstes Datum');
      } else if (dateScore >= 0.5) {
        matchReasons.push('Naheliegendes Datum');
      }
      
      const supplierMatch = fuzzyMatch(expense.bezeichnung, transaction.counterpart_name);
      const descriptionMatch = fuzzyMatch(expense.bezeichnung, transaction.description);
      const bestTextMatch = Math.max(supplierMatch, descriptionMatch);
      
      if (bestTextMatch > 0) {
        confidence += bestTextMatch * 0.2;
        if (bestTextMatch >= 0.7) {
          matchReasons.push('Lieferant erkannt');
        } else if (bestTextMatch >= 0.4) {
          matchReasons.push('Ähnliche Beschreibung');
        }
      }
      
      if (confidence >= 0.4) {
        potentialMatches.push({
          expenseId: expense.id,
          bezeichnung: expense.bezeichnung,
          betrag: expenseAmount,
          datum: expense.datum,
          propertyName: (expense as any).properties?.name || null,
          beleg_url: expense.beleg_url || null,
          confidence: Math.min(confidence, 1),
          matchReasons,
        });
      }
    }
    
    potentialMatches.sort((a, b) => b.confidence - a.confidence);
    
    return potentialMatches.slice(0, 5);
  }, [transaction, expenses]);
  
  return suggestedExpenses;
}

export function useLinkTransactionToExpense() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ expenseId, transactionId }: { expenseId: string; transactionId: string }) => {
      await apiRequest('PATCH', `/api/expenses/${expenseId}`, { transaction_id: transactionId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      toast.success('Transaktion mit Kostenbeleg verknüpft');
    },
    onError: (error) => {
      console.error('Error linking transaction to expense:', error);
      toast.error('Fehler beim Verknüpfen');
    },
  });
}
