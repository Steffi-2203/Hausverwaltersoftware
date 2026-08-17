import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';
import { normalizeFields } from '@/utils/fieldNormalizer';

type FeeType = 'ruecklastschrift' | 'mahnung' | 'sonstiges';

export interface TenantFee {
  id: string;
  tenant_id: string;
  fee_type: FeeType;
  amount: number;
  description: string | null;
  sepa_item_id: string | null;
  created_at: string;
  paid_at: string | null;
  payment_id: string | null;
  notes: string | null;
}

export interface CreateTenantFeeInput {
  tenant_id: string;
  fee_type?: FeeType;
  amount?: number;
  description?: string;
  sepa_item_id?: string;
  notes?: string;
}

export const DEFAULT_RETURN_FEE = 6.00;

export const FEE_TYPE_LABELS: Record<FeeType, string> = {
  ruecklastschrift: 'Rücklastschrift-Gebühr',
  mahnung: 'Mahngebühr',
  sonstiges: 'Sonstige Gebühr',
};

function normalizeTenantFee(fee: any) {
  return normalizeFields(fee);
}

export function useTenantFees() {
  return useQuery({
    queryKey: ['tenant-fees'],
    queryFn: async () => {
      const response = await fetch('/api/tenant-fees', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch tenant fees');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeTenantFee) : [normalizeTenantFee(data)] as TenantFee[];
    },
  });
}

export function useTenantFeesByTenantId(tenantId: string | null) {
  return useQuery({
    queryKey: ['tenant-fees', 'tenant', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const response = await fetch(`/api/tenant-fees?tenant_id=${tenantId}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch tenant fees');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeTenantFee) : [normalizeTenantFee(data)] as TenantFee[];
    },
    enabled: !!tenantId,
  });
}

export function useUnpaidTenantFees() {
  return useQuery({
    queryKey: ['tenant-fees', 'unpaid'],
    queryFn: async () => {
      const response = await fetch('/api/tenant-fees?unpaid=true', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch unpaid tenant fees');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeTenantFee) : [normalizeTenantFee(data)] as TenantFee[];
    },
  });
}

export function useCreateTenantFee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateTenantFeeInput) => {
      const response = await apiRequest('POST', '/api/tenant-fees', {
        tenant_id: input.tenant_id,
        fee_type: input.fee_type || 'ruecklastschrift',
        amount: input.amount ?? DEFAULT_RETURN_FEE,
        description: input.description,
        sepa_item_id: input.sepa_item_id,
        notes: input.notes,
      });
      const data = await response.json();
      return normalizeTenantFee(data) as TenantFee;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-fees'] });
    },
    onError: (error) => {
      console.error('Error creating tenant fee:', error);
      toast.error('Fehler beim Erstellen der Gebühr');
    },
  });
}

export function useMarkFeePaid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ feeId, paymentId }: { feeId: string; paymentId?: string }) => {
      const response = await apiRequest('PATCH', `/api/tenant-fees/${feeId}/paid`, { paymentId });
      const data = await response.json();
      return normalizeTenantFee(data) as TenantFee;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-fees'] });
      toast.success('Gebühr als bezahlt markiert');
    },
    onError: (error) => {
      console.error('Error marking fee as paid:', error);
      toast.error('Fehler beim Aktualisieren der Gebühr');
    },
  });
}

export function useDeleteTenantFee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (feeId: string) => {
      await apiRequest('DELETE', `/api/tenant-fees/${feeId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-fees'] });
      toast.success('Gebühr gelöscht');
    },
    onError: (error) => {
      console.error('Error deleting tenant fee:', error);
      toast.error('Fehler beim Löschen der Gebühr');
    },
  });
}
