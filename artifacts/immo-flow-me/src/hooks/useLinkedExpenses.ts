import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

interface LinkedExpense {
  id: string;
  bezeichnung: string;
  betrag: number;
  datum: string;
  beleg_url: string | null;
  beleg_nummer: string | null;
  transaction_id: string;
}

export function useLinkedExpenses() {
  return useQuery({
    queryKey: ['expenses', 'linked'],
    queryFn: async () => {
      const response = await fetch('/api/expenses?linked=true', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch linked expenses');
      return response.json() as Promise<LinkedExpense[]>;
    },
  });
}

export function useLinkedExpensesMap() {
  const { data: linkedExpenses = [] } = useLinkedExpenses();
  
  const expensesByTransactionId = useMemo(() => {
    const map = new Map<string, LinkedExpense>();
    for (const expense of linkedExpenses) {
      if (expense.transaction_id) {
        map.set(expense.transaction_id, expense);
      }
    }
    return map;
  }, [linkedExpenses]);
  
  return expensesByTransactionId;
}
