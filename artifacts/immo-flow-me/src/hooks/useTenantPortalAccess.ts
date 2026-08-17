import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiRequest } from '@/lib/queryClient';

export function useTenantPortalAccess() {
  return useQuery({
    queryKey: ['tenant-portal-access'],
    queryFn: async () => {
      const response = await fetch('/api/tenant-portal-access', { credentials: 'include' });
      if (!response.ok) throw new Error('Fehler beim Laden');
      return response.json();
    },
  });
}

export function useCreateTenantPortalAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (access: { tenant_id: string; email: string }) => {
      const response = await apiRequest('POST', '/api/tenant-portal-access', access);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-portal-access'] });
      toast.success('Portal-Zugang erstellt');
    },
    onError: (e: any) => {
      if (e.message?.includes('duplicate')) {
        toast.error('Dieser Mieter hat bereits einen Zugang');
      } else {
        toast.error('Fehler beim Erstellen des Zugangs');
      }
    },
  });
}

export function useToggleTenantPortalAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      await apiRequest('PATCH', `/api/tenant-portal-access/${id}`, { is_active });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-portal-access'] });
      toast.success('Zugang aktualisiert');
    },
    onError: () => toast.error('Fehler beim Aktualisieren'),
  });
}
