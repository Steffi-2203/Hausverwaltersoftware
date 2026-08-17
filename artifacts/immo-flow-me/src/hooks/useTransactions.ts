import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';

export interface Transaction {
  id: string;
  organizationId?: string | null;
  bankAccountId: string | null;
  transactionDate: string;
  amount: string | number;
  bookingText: string | null;
  partnerName: string | null;
  partnerIban: string | null;
  reference: string | null;
  categoryId: string | null;
  isMatched: boolean;
  matchedTenantId: string | null;
  matchedUnitId: string | null;
  matchedExpenseId?: string | null;
  matchedPaymentId?: string | null;
  propertyId?: string | null;
  notes?: string | null;
  currency?: string;
  valueDate?: string | null;
  description?: string | null;
  rawData: any | null;
  createdAt: string;
  updatedAt?: string;
  // Legacy snake_case aliases for backward compatibility
  bank_account_id?: string | null;
  transaction_date?: string;
  value_date?: string | null;
  counterpart_name?: string | null;
  counterpart_iban?: string | null;
  category_id?: string | null;
  tenant_id?: string | null;
  unit_id?: string | null;
  property_id?: string | null;
  matched_expense_id?: string | null;
  matched_payment_id?: string | null;
  is_matched?: boolean;
  created_at?: string;
  updated_at?: string;
}

export type TransactionInsert = Omit<Transaction, 'id' | 'created_at' | 'updated_at'>;
export type TransactionUpdate = Partial<TransactionInsert>;

// Helper to normalize transaction data with snake_case aliases for backward compatibility
function normalizeTransaction(t: any): Transaction {
  return {
    ...t,
    // Ensure camelCase primary fields
    bankAccountId: t.bankAccountId ?? t.bank_account_id ?? null,
    transactionDate: t.transactionDate ?? t.transaction_date ?? '',
    valueDate: t.valueDate ?? t.value_date ?? null,
    partnerName: t.partnerName ?? t.counterpart_name ?? null,
    partnerIban: t.partnerIban ?? t.counterpart_iban ?? null,
    categoryId: t.categoryId ?? t.category_id ?? null,
    isMatched: t.isMatched ?? t.is_matched ?? false,
    matchedTenantId: t.matchedTenantId ?? t.tenant_id ?? null,
    matchedUnitId: t.matchedUnitId ?? t.unit_id ?? null,
    matchedExpenseId: t.matchedExpenseId ?? t.matched_expense_id ?? null,
    matchedPaymentId: t.matchedPaymentId ?? t.matched_payment_id ?? null,
    propertyId: t.propertyId ?? t.property_id ?? null,
    notes: t.notes ?? null,
    currency: t.currency ?? 'EUR',
    description: t.description ?? t.bookingText ?? null,
    createdAt: t.createdAt ?? t.created_at ?? '',
    updatedAt: t.updatedAt ?? t.updated_at ?? null,
    // Add snake_case aliases for backward compatibility
    bank_account_id: t.bankAccountId ?? t.bank_account_id ?? null,
    transaction_date: t.transactionDate ?? t.transaction_date ?? '',
    value_date: t.valueDate ?? t.value_date ?? null,
    counterpart_name: t.partnerName ?? t.counterpart_name ?? null,
    counterpart_iban: t.partnerIban ?? t.counterpart_iban ?? null,
    category_id: t.categoryId ?? t.category_id ?? null,
    tenant_id: t.matchedTenantId ?? t.tenant_id ?? null,
    unit_id: t.matchedUnitId ?? t.unit_id ?? null,
    property_id: t.propertyId ?? t.property_id ?? null,
    matched_expense_id: t.matchedExpenseId ?? t.matched_expense_id ?? null,
    matched_payment_id: t.matchedPaymentId ?? t.matched_payment_id ?? null,
    is_matched: t.isMatched ?? t.is_matched ?? false,
    created_at: t.createdAt ?? t.created_at ?? '',
    updated_at: t.updatedAt ?? t.updated_at ?? null,
  };
}

export function useTransactions() {
  return useQuery({
    queryKey: ['transactions'],
    staleTime: 60000,
    gcTime: 300000,
    queryFn: async () => {
      const response = await fetch('/api/transactions', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch transactions');
      const data = await response.json();
      return data.map(normalizeTransaction) as Transaction[];
    },
  });
}

export function useTransactionsByUnit(unitId?: string) {
  return useQuery({
    queryKey: ['transactions', 'unit', unitId],
    staleTime: 60000,
    queryFn: async () => {
      if (!unitId) return [];
      const response = await fetch(`/api/transactions?unit_id=${unitId}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch transactions');
      const data = await response.json();
      return data.map(normalizeTransaction) as Transaction[];
    },
    enabled: !!unitId,
  });
}

export function useTransactionsByBankAccount(bankAccountId?: string) {
  return useQuery({
    queryKey: ['transactions', 'bank_account', bankAccountId],
    staleTime: 60000,
    queryFn: async () => {
      if (!bankAccountId) return [];
      const response = await fetch(`/api/bank-accounts/${bankAccountId}/transactions`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch transactions');
      const data = await response.json();
      return data.map(normalizeTransaction) as Transaction[];
    },
    enabled: !!bankAccountId,
  });
}

export function useTransactionsByCategory(categoryId?: string) {
  return useQuery({
    queryKey: ['transactions', 'category', categoryId],
    staleTime: 60000,
    queryFn: async () => {
      if (!categoryId) return [];
      const response = await fetch(`/api/transactions?category_id=${categoryId}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch transactions');
      const data = await response.json();
      return data.map(normalizeTransaction) as Transaction[];
    },
    enabled: !!categoryId,
  });
}

export function useRecentTransactions(limit: number = 10) {
  return useQuery({
    queryKey: ['transactions', 'recent', limit],
    staleTime: 60000,
    queryFn: async () => {
      const response = await fetch(`/api/transactions?limit=${limit}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch transactions');
      const data = await response.json();
      return data.map(normalizeTransaction) as Transaction[];
    },
  });
}

export function useUnmatchedTransactions() {
  return useQuery({
    queryKey: ['transactions', 'unmatched'],
    staleTime: 60000,
    queryFn: async () => {
      const response = await fetch('/api/transactions?unmatched=true', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch transactions');
      const data = await response.json();
      return data.map(normalizeTransaction) as Transaction[];
    },
  });
}

export interface TransactionSummary {
  totalIncome: number;
  totalExpenses: number;
  balance: number;
  incomeByCategory: { categoryId: string | null; categoryName: string; total: number }[];
  expensesByCategory: { categoryId: string | null; categoryName: string; total: number }[];
}

export function useTransactionSummary(startDate?: string, endDate?: string) {
  const { data: transactions } = useTransactions();
  
  return useQuery({
    queryKey: ['transactions', 'summary', startDate, endDate],
    staleTime: 60000,
    queryFn: async () => {
      const filtered = (transactions || []).filter(t => {
        if (startDate && t.transaction_date < startDate) return false;
        if (endDate && t.transaction_date > endDate) return false;
        return true;
      });
      
      const totalIncome = filtered
        .filter(t => Number(t.amount) > 0)
        .reduce((sum, t) => sum + Number(t.amount), 0);
      
      const totalExpenses = filtered
        .filter(t => Number(t.amount) < 0)
        .reduce((sum, t) => sum + Number(t.amount), 0);
      
      const incomeByCategory = new Map<string | null, { categoryName: string; total: number }>();
      const expensesByCategory = new Map<string | null, { categoryName: string; total: number }>();
      
      for (const t of filtered) {
        const categoryId = t.category_id;
        const categoryName = 'Nicht kategorisiert';
        const map = Number(t.amount) > 0 ? incomeByCategory : expensesByCategory;
        
        const existing = map.get(categoryId);
        if (existing) {
          existing.total += Number(t.amount);
        } else {
          map.set(categoryId, { categoryName, total: Number(t.amount) });
        }
      }
      
      return {
        totalIncome,
        totalExpenses,
        balance: totalIncome + totalExpenses,
        incomeByCategory: Array.from(incomeByCategory.entries()).map(([categoryId, data]) => ({
          categoryId,
          ...data
        })).sort((a, b) => b.total - a.total),
        expensesByCategory: Array.from(expensesByCategory.entries()).map(([categoryId, data]) => ({
          categoryId,
          ...data
        })).sort((a, b) => a.total - b.total),
      } as TransactionSummary;
    },
    enabled: !!transactions,
  });
}

// Helper to convert snake_case inputs to camelCase for API
function normalizeOutboundTransaction(updates: any): any {
  const result: any = {};
  
  // Map snake_case to camelCase for API
  const fieldMappings: Record<string, string> = {
    bank_account_id: 'bankAccountId',
    transaction_date: 'transactionDate',
    value_date: 'valueDate',
    counterpart_name: 'partnerName',
    counterpart_iban: 'partnerIban',
    category_id: 'categoryId',
    tenant_id: 'matchedTenantId',
    unit_id: 'matchedUnitId',
    property_id: 'propertyId',
    matched_expense_id: 'matchedExpenseId',
    matched_payment_id: 'matchedPaymentId',
    is_matched: 'isMatched',
    created_at: 'createdAt',
    updated_at: 'updatedAt',
    booking_text: 'bookingText',
    partner_name: 'partnerName',
    partner_iban: 'partnerIban',
    raw_data: 'rawData',
    organization_id: 'organizationId',
  };
  
  for (const [key, value] of Object.entries(updates)) {
    // Use the camelCase version if there's a mapping, otherwise keep original
    const mappedKey = fieldMappings[key] || key;
    result[mappedKey] = value;
  }
  
  return result;
}

export function useCreateTransaction() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (transaction: TransactionInsert) => {
      // Normalize to camelCase for API
      const normalizedTransaction = normalizeOutboundTransaction(transaction);
      const response = await apiRequest('POST', '/api/transactions', normalizedTransaction);
      return response.json() as Promise<Transaction>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (error) => {
      console.error('Create transaction error:', error);
    },
  });
}

export function useCreateTransactions() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (transactions: TransactionInsert[]) => {
      const results: Transaction[] = [];
      for (const t of transactions) {
        // Normalize to camelCase for API
        const normalizedTransaction = normalizeOutboundTransaction(t);
        const response = await apiRequest('POST', '/api/transactions', normalizedTransaction);
        results.push(await response.json());
      }
      return results;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      toast.success(`${data.length} Transaktionen erfolgreich importiert`);
    },
    onError: (error) => {
      toast.error('Fehler beim Importieren der Transaktionen');
      console.error('Create transactions error:', error);
    },
  });
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: TransactionUpdate & { id: string }) => {
      // Normalize to camelCase for API
      const normalizedUpdates = normalizeOutboundTransaction(updates);
      
      const hasAssignment = 
        normalizedUpdates.matchedUnitId || 
        normalizedUpdates.matchedTenantId || 
        normalizedUpdates.propertyId || 
        normalizedUpdates.categoryId;
      
      if (hasAssignment) {
        normalizedUpdates.isMatched = true;
      }
      
      const response = await apiRequest('PATCH', `/api/transactions/${id}`, normalizedUpdates);
      return response.json() as Promise<Transaction>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      toast.success('Transaktion aktualisiert');
    },
    onError: (error) => {
      toast.error('Fehler beim Aktualisieren der Transaktion');
      console.error('Update transaction error:', error);
    },
  });
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/transactions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      toast.success('Transaktion gelöscht');
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen der Transaktion');
      console.error('Delete transaction error:', error);
    },
  });
}
