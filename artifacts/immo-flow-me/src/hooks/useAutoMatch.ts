import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';

export interface MatchSuggestion {
  id: string | null;
  name?: string;
  topNummer?: string;
  invoiceNumber?: string;
  confidence: number;
  reason: string;
}

export interface TransactionMatchResult {
  transactionId: string;
  suggestions: {
    tenant?: MatchSuggestion;
    unit?: MatchSuggestion;
    property?: MatchSuggestion;
    category?: MatchSuggestion;
    invoice?: MatchSuggestion;
  };
}

export function useAutoMatch() {
  return useMutation({
    mutationFn: async (transactionIds: string[]): Promise<TransactionMatchResult[]> => {
      const response = await apiRequest('POST', '/api/transactions/auto-match', { transactionIds });
      return response.json();
    },
    onError: (error) => {
      toast.error('Fehler bei der automatischen Zuordnung');
      console.error('Auto-match error:', error);
    },
  });
}

export function useApplyMatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      transactionId: string;
      tenantId?: string | null;
      unitId?: string | null;
      propertyId?: string | null;
      categoryId?: string | null;
      invoiceId?: string | null;
    }) => {
      const response = await apiRequest('POST', '/api/transactions/apply-match', data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (error) => {
      toast.error('Fehler beim Anwenden der Zuordnung');
      console.error('Apply match error:', error);
    },
  });
}
