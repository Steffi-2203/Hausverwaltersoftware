import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';

export interface MatchProposal {
  transactionId: string;
  transactionDate: string;
  amount: number;
  partnerName: string;
  partnerIban: string;
  bookingText: string;
  matches: InvoiceMatch[];
}

export interface InvoiceMatch {
  invoiceId: string;
  invoiceNumber: string;
  tenantId: string | null;
  tenantName: string;
  unitId: string | null;
  unitTopNummer: string;
  propertyName: string;
  invoiceAmount: number;
  confidence: number;
  matchReason: string;
}

export interface ReconciliationAction {
  transactionId: string;
  invoiceId: string;
  tenantId: string;
  unitId: string;
  amount: number;
}

export interface ReconciliationStats {
  totalTransactions: number;
  matchedTransactions: number;
  unmatchedCount: number;
  unmatchedAmount: number;
  matchRate: number;
  lastReconciliation: string;
}

export function useBankReconciliation() {
  return useMutation({
    mutationFn: async (bankAccountId: string) => {
      const response = await apiRequest('POST', '/api/bank-reconciliation/match', { bankAccountId });
      return (await response.json()) as MatchProposal[];
    },
    onError: () => {
      toast.error('Fehler beim automatischen Abgleich');
    },
  });
}

export function useApplyReconciliation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (actions: ReconciliationAction[]) => {
      const response = await apiRequest('POST', '/api/bank-reconciliation/apply', { actions });
      return await response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['bank_accounts'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliation-stats'] });
      queryClient.invalidateQueries({ queryKey: ['bank_balance'] });
      toast.success(`${data.applied} Zuordnung(en) erfolgreich übernommen`);
    },
    onError: () => {
      toast.error('Fehler beim Übernehmen der Zuordnungen');
    },
  });
}

export function useReconciliationStats() {
  return useQuery({
    queryKey: ['reconciliation-stats'],
    queryFn: async () => {
      const response = await fetch('/api/bank-reconciliation/stats', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch reconciliation stats');
      return (await response.json()) as ReconciliationStats;
    },
  });
}
