import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';

export interface OwnerPayout {
  id: string;
  organization_id: string | null;
  property_id: string;
  owner_id: string;
  period_from: string;
  period_to: string;
  total_income: number;
  total_expenses: number;
  management_fee: number;
  net_payout: number;
  status: 'entwurf' | 'freigegeben' | 'ausgezahlt';
  pdf_url: string | null;
  sepa_exported_at: string | null;
  email_sent_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function useOwnerPayouts(propertyId?: string) {
  return useQuery({
    queryKey: ['/api/owner-payouts', propertyId],
    queryFn: async () => {
      const params = propertyId ? `?propertyId=${propertyId}` : '';
      const res = await fetch(`/api/owner-payouts${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json() as Promise<OwnerPayout[]>;
    },
  });
}

export function useCreateOwnerPayout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payout: Omit<OwnerPayout, 'id' | 'created_at' | 'updated_at' | 'pdf_url' | 'sepa_exported_at' | 'email_sent_at'>) => {
      const res = await apiRequest('POST', '/api/owner-payouts', payout);
      return res.json() as Promise<OwnerPayout>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/owner-payouts'] });
      toast.success('Eigentümer-Abrechnung erstellt');
    },
    onError: () => toast.error('Fehler beim Erstellen der Abrechnung'),
  });
}

export function useUpdateOwnerPayout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<OwnerPayout>) => {
      const res = await apiRequest('PATCH', `/api/owner-payouts/${id}`, updates);
      return res.json() as Promise<OwnerPayout>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/owner-payouts'] });
      toast.success('Abrechnung aktualisiert');
    },
    onError: () => toast.error('Fehler beim Aktualisieren'),
  });
}

export function useDeleteOwnerPayout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/owner-payouts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/owner-payouts'] });
      toast.success('Abrechnung gelöscht');
    },
    onError: () => toast.error('Fehler beim Löschen'),
  });
}
