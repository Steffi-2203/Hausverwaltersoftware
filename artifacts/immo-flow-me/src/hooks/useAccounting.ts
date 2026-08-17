import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';

export function useChartOfAccounts() {
  return useQuery({
    queryKey: ['/api/chart-of-accounts'],
  });
}

export function useJournalEntries(params?: { from?: string; to?: string; propertyId?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.from) searchParams.set('from', params.from);
  if (params?.to) searchParams.set('to', params.to);
  if (params?.propertyId) searchParams.set('propertyId', params.propertyId);
  const qs = searchParams.toString();
  const url = `/api/journal-entries${qs ? `?${qs}` : ''}`;

  return useQuery({
    queryKey: ['/api/journal-entries', params],
    queryFn: async () => {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch journal entries');
      return res.json();
    },
  });
}

export function useCreateJournalEntry() {
  return useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/journal-entries', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/journal-entries'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounting'] });
    },
  });
}

export function useStornoJournalEntry() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('POST', `/api/journal-entries/${id}/storno`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/journal-entries'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounting'] });
    },
  });
}

export function useTrialBalance(params?: { from?: string; to?: string; propertyId?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.from) searchParams.set('from', params.from);
  if (params?.to) searchParams.set('to', params.to);
  if (params?.propertyId) searchParams.set('propertyId', params.propertyId);
  const qs = searchParams.toString();

  return useQuery({
    queryKey: ['/api/accounting/trial-balance', params],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/trial-balance${qs ? `?${qs}` : ''}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden der Saldenliste');
      return res.json();
    },
  });
}

export function useBalanceSheet(params?: { date?: string; propertyId?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.date) searchParams.set('date', params.date);
  if (params?.propertyId) searchParams.set('propertyId', params.propertyId);
  const qs = searchParams.toString();

  return useQuery({
    queryKey: ['/api/accounting/balance-sheet', params],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/balance-sheet${qs ? `?${qs}` : ''}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden der Bilanz');
      return res.json();
    },
  });
}

export function useProfitLoss(params?: { from?: string; to?: string; propertyId?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.from) searchParams.set('from', params.from);
  if (params?.to) searchParams.set('to', params.to);
  if (params?.propertyId) searchParams.set('propertyId', params.propertyId);
  const qs = searchParams.toString();

  return useQuery({
    queryKey: ['/api/accounting/profit-loss', params],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/profit-loss${qs ? `?${qs}` : ''}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden der GuV');
      return res.json();
    },
  });
}

export function useUva(params?: { month?: number; year?: number; propertyId?: string }) {
  return useQuery({
    queryKey: ['/api/accounting/uva', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params?.month) searchParams.set('month', String(params.month));
      if (params?.year) searchParams.set('year', String(params.year));
      if (params?.propertyId) searchParams.set('propertyId', params.propertyId);
      const qs = searchParams.toString();
      const res = await fetch(`/api/accounting/uva${qs ? `?${qs}` : ''}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden der UVA');
      return res.json();
    },
  });
}

export function useAccountLedger(accountId: string, params?: { from?: string; to?: string; propertyId?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.from) searchParams.set('from', params.from);
  if (params?.to) searchParams.set('to', params.to);
  if (params?.propertyId) searchParams.set('propertyId', params.propertyId);
  const qs = searchParams.toString();

  return useQuery({
    queryKey: ['/api/accounting/account-ledger', accountId, params],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/account-ledger/${accountId}${qs ? `?${qs}` : ''}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden des Kontoblatts');
      return res.json();
    },
    enabled: !!accountId,
  });
}

export function useCreateAccount() {
  return useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/chart-of-accounts', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/chart-of-accounts'] });
    },
  });
}

export function useUpdateAccount() {
  return useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await apiRequest('PATCH', `/api/chart-of-accounts/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/chart-of-accounts'] });
    },
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/chart-of-accounts/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/chart-of-accounts'] });
    },
  });
}
