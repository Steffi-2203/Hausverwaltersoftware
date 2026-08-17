import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';

export interface TransactionSplit {
  id: string;
  transaction_id: string;
  category_id: string | null;
  amount: number;
  description: string | null;
  created_at: string;
}

export type TransactionSplitInsert = Omit<TransactionSplit, 'id' | 'created_at'>;
export type TransactionSplitUpdate = Partial<Omit<TransactionSplit, 'id' | 'created_at' | 'transaction_id'>>;

export function useTransactionSplits(transactionId?: string) {
  return useQuery({
    queryKey: ['transaction_splits', transactionId],
    queryFn: async () => {
      if (!transactionId) return [];
      const response = await fetch(`/api/transactions/${transactionId}/splits`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch transaction splits');
      return response.json() as Promise<TransactionSplit[]>;
    },
    enabled: !!transactionId,
  });
}

export function useCreateTransactionSplit() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (split: TransactionSplitInsert) => {
      const response = await apiRequest('POST', `/api/transactions/${split.transaction_id}/splits`, split);
      return response.json() as Promise<TransactionSplit>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['transaction_splits', data.transaction_id] });
      toast.success('Split hinzugefügt');
    },
    onError: (error) => {
      toast.error('Fehler beim Erstellen des Splits');
      console.error('Create split error:', error);
    },
  });
}

export function useCreateTransactionSplits() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (splits: TransactionSplitInsert[]) => {
      if (splits.length === 0) return [];
      const transactionId = splits[0].transaction_id;
      const response = await apiRequest('POST', `/api/transactions/${transactionId}/splits/batch`, { splits });
      return response.json() as Promise<TransactionSplit[]>;
    },
    onSuccess: (data) => {
      if (data.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['transaction_splits', data[0].transaction_id] });
      }
      toast.success('Splits hinzugefügt');
    },
    onError: (error) => {
      toast.error('Fehler beim Erstellen der Splits');
      console.error('Create splits error:', error);
    },
  });
}

export function useUpdateTransactionSplit() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, transactionId, ...updates }: TransactionSplitUpdate & { id: string; transactionId: string }) => {
      const response = await apiRequest('PATCH', `/api/transaction-splits/${id}`, updates);
      const data = await response.json();
      return { ...data, transactionId } as TransactionSplit & { transactionId: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['transaction_splits', data.transactionId] });
      toast.success('Split aktualisiert');
    },
    onError: (error) => {
      toast.error('Fehler beim Aktualisieren des Splits');
      console.error('Update split error:', error);
    },
  });
}

export function useDeleteTransactionSplit() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, transactionId }: { id: string; transactionId: string }) => {
      await apiRequest('DELETE', `/api/transaction-splits/${id}`);
      return { transactionId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['transaction_splits', data.transactionId] });
      toast.success('Split gelöscht');
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen des Splits');
      console.error('Delete split error:', error);
    },
  });
}

export function useDeleteTransactionSplits() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (transactionId: string) => {
      await apiRequest('DELETE', `/api/transactions/${transactionId}/splits`);
      return { transactionId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['transaction_splits', data.transactionId] });
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen der Splits');
      console.error('Delete splits error:', error);
    },
  });
}
