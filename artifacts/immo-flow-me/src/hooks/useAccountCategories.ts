import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';

export interface AccountCategory {
  id: string;
  organization_id: string | null;
  name: string;
  type: 'income' | 'expense' | 'asset';
  parent_id: string | null;
  is_system: boolean;
  created_at: string;
  default_distribution_key_id: string | null;
}

export type AccountCategoryInsert = Omit<AccountCategory, 'id' | 'created_at'>;
export type AccountCategoryUpdate = Partial<Omit<AccountCategory, 'id' | 'created_at' | 'organization_id' | 'is_system'>>;

export function useAccountCategories() {
  return useQuery({
    queryKey: ['account_categories'],
    queryFn: async () => {
      const response = await fetch('/api/account-categories', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch account categories');
      return response.json() as Promise<AccountCategory[]>;
    },
  });
}

export function useAccountCategoriesByType(type: 'income' | 'expense' | 'asset') {
  return useQuery({
    queryKey: ['account_categories', type],
    queryFn: async () => {
      const response = await fetch(`/api/account-categories?type=${type}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch account categories');
      return response.json() as Promise<AccountCategory[]>;
    },
  });
}

export function useCreateAccountCategory() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (category: AccountCategoryInsert) => {
      const response = await apiRequest('POST', '/api/account-categories', category);
      return response.json() as Promise<AccountCategory>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account_categories'] });
      toast.success('Kategorie erfolgreich erstellt');
    },
    onError: (error) => {
      toast.error('Fehler beim Erstellen der Kategorie');
      console.error('Create category error:', error);
    },
  });
}

export function useUpdateAccountCategory() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: AccountCategoryUpdate & { id: string }) => {
      const response = await apiRequest('PATCH', `/api/account-categories/${id}`, updates);
      return response.json() as Promise<AccountCategory>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account_categories'] });
      toast.success('Kategorie aktualisiert');
    },
    onError: (error) => {
      toast.error('Fehler beim Aktualisieren der Kategorie');
      console.error('Update category error:', error);
    },
  });
}

export function useDeleteAccountCategory() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/account-categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account_categories'] });
      toast.success('Kategorie gelöscht');
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen der Kategorie');
      console.error('Delete category error:', error);
    },
  });
}
