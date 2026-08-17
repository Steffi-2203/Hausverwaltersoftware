import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';
import { normalizeFields } from '@/utils/fieldNormalizer';

export interface PropertyBudget {
  id: string;
  property_id: string;
  organization_id: string | null;
  year: number;
  position_1_name: string | null;
  position_1_amount: number;
  position_2_name: string | null;
  position_2_amount: number;
  position_3_name: string | null;
  position_3_amount: number;
  position_4_name: string | null;
  position_4_amount: number;
  position_5_name: string | null;
  position_5_amount: number;
  status: 'entwurf' | 'eingereicht' | 'genehmigt' | 'abgelehnt';
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  properties?: {
    name: string;
    address: string;
  };
}

export interface BudgetFormData {
  property_id: string;
  year: number;
  position_1_name?: string;
  position_1_amount?: number;
  position_2_name?: string;
  position_2_amount?: number;
  position_3_name?: string;
  position_3_amount?: number;
  position_4_name?: string;
  position_4_amount?: number;
  position_5_name?: string;
  position_5_amount?: number;
  notes?: string;
}

function normalizeBudget(budget: any) {
  const normalized = normalizeFields(budget);
  if (normalized.properties) {
    normalized.properties = normalizeFields(normalized.properties);
  }
  return normalized;
}

export function useBudgets(propertyId?: string, year?: number) {
  return useQuery({
    queryKey: ['budgets', propertyId, year],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (propertyId) params.set('property_id', propertyId);
      if (year) params.set('year', String(year));
      
      const url = `/api/budgets${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch budgets');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeBudget) : [normalizeBudget(data)] as PropertyBudget[];
    },
  });
}

export function useBudget(budgetId: string) {
  return useQuery({
    queryKey: ['budget', budgetId],
    queryFn: async () => {
      const response = await fetch(`/api/budgets/${budgetId}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch budget');
      const data = await response.json();
      return normalizeBudget(data) as PropertyBudget;
    },
    enabled: !!budgetId,
  });
}

export function useCreateBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: BudgetFormData) => {
      const response = await apiRequest('POST', '/api/budgets', data);
      const result = await response.json();
      return normalizeBudget(result);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets'] });
      toast.success('Budgetplan erstellt');
    },
    onError: (error: Error) => {
      console.error('Error creating budget:', error);
      if (error.message.includes('unique')) {
        toast.error('Für diese Liegenschaft existiert bereits ein Budgetplan für dieses Jahr');
      } else {
        toast.error('Fehler beim Erstellen des Budgetplans');
      }
    },
  });
}

export function useUpdateBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<BudgetFormData> }) => {
      const response = await apiRequest('PATCH', `/api/budgets/${id}`, data);
      const result = await response.json();
      return normalizeBudget(result);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets'] });
      queryClient.invalidateQueries({ queryKey: ['budget'] });
      toast.success('Budgetplan aktualisiert');
    },
    onError: (error: Error) => {
      console.error('Error updating budget:', error);
      toast.error('Fehler beim Aktualisieren des Budgetplans');
    },
  });
}

export function useUpdateBudgetStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      id, 
      status, 
      approved_by 
    }: { 
      id: string; 
      status: 'entwurf' | 'eingereicht' | 'genehmigt' | 'abgelehnt';
      approved_by?: string;
    }) => {
      const response = await apiRequest('PATCH', `/api/budgets/${id}/status`, { status, approved_by });
      const result = await response.json();
      return normalizeBudget(result);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['budgets'] });
      queryClient.invalidateQueries({ queryKey: ['budget'] });
      
      const messages: Record<string, string> = {
        eingereicht: 'Budgetplan zur Genehmigung eingereicht',
        genehmigt: 'Budgetplan genehmigt',
        abgelehnt: 'Budgetplan abgelehnt',
        entwurf: 'Budgetplan auf Entwurf zurückgesetzt',
      };
      toast.success(messages[variables.status]);
    },
    onError: (error: Error) => {
      console.error('Error updating budget status:', error);
      toast.error('Fehler beim Aktualisieren des Status');
    },
  });
}

export function useDeleteBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/budgets/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets'] });
      toast.success('Budgetplan gelöscht');
    },
    onError: (error: Error) => {
      console.error('Error deleting budget:', error);
      toast.error('Fehler beim Löschen des Budgetplans');
    },
  });
}

export function useBudgetExpenses(propertyId: string, year: number) {
  return useQuery({
    queryKey: ['budget-expenses', propertyId, year],
    queryFn: async () => {
      const response = await fetch(`/api/budgets/expenses?property_id=${propertyId}&year=${year}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch budget expenses');
      return response.json() as Promise<Record<number, number>>;
    },
    enabled: !!propertyId && !!year,
  });
}

export function useBudgetExpensesFromAll(propertyId: string, year: number) {
  return useQuery({
    queryKey: ['budget-expenses-all', propertyId, year],
    queryFn: async () => {
      const response = await fetch(`/api/budgets/expenses-all?property_id=${propertyId}&year=${year}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch budget expenses');
      return response.json() as Promise<Record<number, number>>;
    },
    enabled: !!propertyId && !!year,
  });
}
