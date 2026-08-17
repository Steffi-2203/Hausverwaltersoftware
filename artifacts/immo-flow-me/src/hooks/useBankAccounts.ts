import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';
import { normalizeFields } from '@/utils/fieldNormalizer';

export interface BankAccount {
  id: string;
  organization_id: string | null;
  account_name: string;
  bank_name: string | null;
  iban: string | null;
  bic: string | null;
  opening_balance: number | null;
  opening_balance_date: string | null;
  is_primary: boolean | null;
  created_at: string;
  updated_at: string;
}

export type BankAccountInsert = Omit<BankAccount, 'id' | 'created_at' | 'updated_at'>;
export type BankAccountUpdate = Partial<BankAccountInsert>;

function normalizeBankAccount(account: any) {
  return normalizeFields(account);
}

export function useBankAccounts() {
  return useQuery({
    queryKey: ['bank_accounts'],
    queryFn: async () => {
      const response = await fetch('/api/bank-accounts', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch bank accounts');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeBankAccount) : [normalizeBankAccount(data)] as BankAccount[];
    },
  });
}

export function useBankAccount(id?: string) {
  return useQuery({
    queryKey: ['bank_accounts', id],
    queryFn: async () => {
      if (!id) return null;
      const response = await fetch(`/api/bank-accounts/${id}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch bank account');
      const data = await response.json();
      return normalizeBankAccount(data) as BankAccount;
    },
    enabled: !!id,
  });
}

export function useBankBalance(accountId?: string, asOfDate?: string) {
  return useQuery({
    queryKey: ['bank_balance', accountId, asOfDate],
    queryFn: async () => {
      if (!accountId) return null;
      const date = asOfDate || new Date().toISOString().split('T')[0];
      const response = await fetch(`/api/bank-accounts/${accountId}/balance?as_of_date=${date}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch bank balance');
      const data = await response.json();
      return data.balance as number;
    },
    enabled: !!accountId,
  });
}

export function useCreateBankAccount() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (account: BankAccountInsert) => {
      const response = await apiRequest('POST', '/api/bank-accounts', account);
      const data = await response.json();
      return normalizeBankAccount(data) as BankAccount;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank_accounts'] });
      toast.success('Bankkonto erfolgreich angelegt');
    },
    onError: (error) => {
      toast.error('Fehler beim Anlegen des Bankkontos');
      console.error('Create bank account error:', error);
    },
  });
}

export function useUpdateBankAccount() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: BankAccountUpdate & { id: string }) => {
      const response = await apiRequest('PATCH', `/api/bank-accounts/${id}`, updates);
      const data = await response.json();
      return normalizeBankAccount(data) as BankAccount;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank_accounts'] });
      queryClient.invalidateQueries({ queryKey: ['bank_balance'] });
      toast.success('Bankkonto aktualisiert');
    },
    onError: (error) => {
      toast.error('Fehler beim Aktualisieren des Bankkontos');
      console.error('Update bank account error:', error);
    },
  });
}

export function useDeleteBankAccount() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/bank-accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank_accounts'] });
      queryClient.invalidateQueries({ queryKey: ['bank_balance'] });
      toast.success('Bankkonto gelöscht');
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen des Bankkontos');
      console.error('Delete bank account error:', error);
    },
  });
}
