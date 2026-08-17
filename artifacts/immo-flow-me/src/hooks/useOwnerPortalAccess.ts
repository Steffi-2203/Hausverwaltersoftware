import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiRequest } from '@/lib/queryClient';

export function useOwnerPortalAccess() {
  return useQuery({
    queryKey: ['owner-portal-access'],
    queryFn: async () => {
      const response = await fetch('/api/owner-portal-access', { credentials: 'include' });
      if (!response.ok) throw new Error('Fehler beim Laden');
      return response.json();
    },
  });
}

export function useCreateOwnerPortalAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (access: { owner_id: string; email: string }) => {
      const response = await apiRequest('POST', '/api/owner-portal-access', access);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner-portal-access'] });
      toast.success('Portal-Zugang erstellt');
    },
    onError: (e: any) => {
      if (e.message?.includes('duplicate')) {
        toast.error('Dieser Eigentümer hat bereits einen Zugang');
      } else {
        toast.error('Fehler beim Erstellen des Zugangs');
      }
    },
  });
}

export function useToggleOwnerPortalAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      await apiRequest('PATCH', `/api/owner-portal-access/${id}`, { is_active });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner-portal-access'] });
      toast.success('Zugang aktualisiert');
    },
    onError: () => toast.error('Fehler beim Aktualisieren'),
  });
}
