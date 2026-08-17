import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';

export function useManagementContracts() {
  return useQuery({
    queryKey: ['/api/management-contracts'],
    queryFn: async () => {
      const res = await fetch('/api/management-contracts', { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json();
    },
  });
}

export function useCreateManagementContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contract: {
      organization_id: string;
      property_id?: string;
      owner_name?: string;
      contract_type?: string;
      title: string;
      start_date: string;
      end_date?: string;
      auto_renew?: boolean;
      renewal_months?: number;
      notice_period_months?: number;
      notice_deadline?: string;
      monthly_fee?: number;
      fee_type?: string;
      notes?: string;
      status?: string;
    }) => {
      const res = await apiRequest('POST', '/api/management-contracts', contract);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/management-contracts'] });
      toast.success('Vertrag gespeichert');
    },
    onError: () => toast.error('Fehler beim Speichern'),
  });
}

export function useUpdateManagementContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; [key: string]: any }) => {
      const res = await apiRequest('PATCH', `/api/management-contracts/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/management-contracts'] });
      toast.success('Vertrag aktualisiert');
    },
    onError: () => toast.error('Fehler beim Aktualisieren'),
  });
}

export function useDeleteManagementContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/management-contracts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/management-contracts'] });
      toast.success('Vertrag gelöscht');
    },
    onError: () => toast.error('Fehler beim Löschen'),
  });
}
