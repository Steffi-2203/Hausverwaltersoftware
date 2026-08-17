import { useMemo } from 'react';
import { useTransactions } from './useTransactions';
import { Expense } from './useExpenses';
import { apiRequest } from '@/lib/queryClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fuzzyMatch, datesWithinRange, dateProximityScore } from '@/utils/matchingUtils';

export interface TransactionMatch {
  transactionId: string;
  amount: number;
  date: string;
  counterpartName: string | null;
  description: string | null;
  confidence: number;
  matchReasons: string[];
}

export interface ExpenseWithMatches extends Expense {
  suggestedMatches: TransactionMatch[];
  linkedTransaction?: {
    id: string;
    amount: number;
    date: string;
    counterpartName: string | null;
  };
}

export function useExpenseTransactionMatch(expenses: Expense[]) {
  const { data: transactions = [] } = useTransactions();
  
  const expensesWithMatches = useMemo((): ExpenseWithMatches[] => {
    return expenses.map(expense => {
      if (expense.transactionId) {
        const linkedTx = transactions.find(t => t.id === expense.transactionId);
        return {
          ...expense,
          suggestedMatches: [],
          linkedTransaction: linkedTx ? {
            id: linkedTx.id,
            amount: Number(linkedTx.amount),
            date: linkedTx.transaction_date,
            counterpartName: linkedTx.counterpart_name,
          } : undefined,
        };
      }
      
      const potentialMatches: TransactionMatch[] = [];
      
      for (const tx of transactions) {
        const txAmount = Number(tx.amount);
        
        if (txAmount >= 0) continue;
        
        const isAlreadyLinked = expenses.some(
          e => e.transactionId === tx.id && e.id !== expense.id
        );
        if (isAlreadyLinked) continue;
        
        const expenseAmount = Number(expense.betrag);
        const txAbsAmount = Math.abs(txAmount);
        const amountDiff = Math.abs(expenseAmount - txAbsAmount);
        const amountMatch = amountDiff < 0.01;
        const closeAmountMatch = amountDiff / expenseAmount < 0.05;
        
        if (!amountMatch && !closeAmountMatch) continue;
        
        if (!datesWithinRange(expense.datum, tx.transaction_date, 14)) continue;
        
        const matchReasons: string[] = [];
        let confidence = 0;
        
        if (amountMatch) {
          confidence += 0.5;
          matchReasons.push('Exakter Betrag');
        } else if (closeAmountMatch) {
          confidence += 0.3;
          matchReasons.push('Ähnlicher Betrag');
        }
        
        const dateScore = dateProximityScore(expense.datum, tx.transaction_date);
        confidence += dateScore * 0.3;
        if (dateScore >= 0.9) {
          matchReasons.push('Gleiches/nächstes Datum');
        } else if (dateScore >= 0.5) {
          matchReasons.push('Naheliegendes Datum');
        }
        
        const supplierMatch = fuzzyMatch(expense.bezeichnung, tx.counterpart_name);
        const descriptionMatch = fuzzyMatch(expense.bezeichnung, tx.description);
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
            transactionId: tx.id,
            amount: txAmount,
            date: tx.transaction_date,
            counterpartName: tx.counterpart_name,
            description: tx.description,
            confidence: Math.min(confidence, 1),
            matchReasons,
          });
        }
      }
      
      potentialMatches.sort((a, b) => b.confidence - a.confidence);
      
      return {
        ...expense,
        suggestedMatches: potentialMatches.slice(0, 3),
      };
    });
  }, [expenses, transactions]);
  
  return expensesWithMatches;
}

export function useLinkExpenseTransaction() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ expenseId, transactionId }: { expenseId: string; transactionId: string | null }) => {
      await apiRequest('PATCH', `/api/expenses/${expenseId}`, { transaction_id: transactionId });
    },
    onSuccess: (_, { transactionId }) => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      
      if (transactionId) {
        toast.success('Kosten mit Transaktion verknüpft');
      } else {
        toast.success('Verknüpfung aufgehoben');
      }
    },
    onError: (error) => {
      console.error('Error linking expense:', error);
      toast.error('Fehler beim Verknüpfen');
    },
  });
}

export function useAutoMatchExpenses() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (matches: Array<{ expenseId: string; transactionId: string }>) => {
      const response = await apiRequest('POST', '/api/expenses/auto-match', { matches });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      toast.success(`${data.count || 0} Kosten automatisch verknüpft`);
    },
    onError: (error) => {
      console.error('Error auto-matching:', error);
      toast.error('Fehler beim automatischen Verknüpfen');
    },
  });
}
