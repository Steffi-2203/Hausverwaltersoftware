import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';
import { normalizeFields } from '@/utils/fieldNormalizer';

export type VpiAdjustmentStatus = 'pending' | 'applied' | 'rejected';

export interface VpiAdjustment {
  id: string;
  tenant_id: string;
  adjustment_date: string;
  previous_rent: number;
  new_rent: number;
  vpi_old: number | null;
  vpi_new: number | null;
  percentage_change: number | null;
  notification_sent: boolean | null;
  notification_date: string | null;
  effective_date: string | null;
  notes: string | null;
  created_at: string | null;
  tenants?: {
    id: string;
    first_name: string;
    last_name: string;
    grundmiete: number;
    units?: {
      id: string;
      top_nummer: string;
      properties?: {
        id: string;
        name: string;
      };
    };
  };
}

export interface VpiAdjustmentInsert {
  tenant_id: string;
  adjustment_date: string;
  previous_rent: number;
  new_rent: number;
  vpi_old?: number | null;
  vpi_new?: number | null;
  percentage_change?: number | null;
  notification_sent?: boolean | null;
  notification_date?: string | null;
  effective_date?: string | null;
  notes?: string | null;
}

export interface VpiAdjustmentUpdate {
  id: string;
  tenant_id?: string;
  adjustment_date?: string;
  previous_rent?: number;
  new_rent?: number;
  vpi_old?: number | null;
  vpi_new?: number | null;
  percentage_change?: number | null;
  notification_sent?: boolean | null;
  notification_date?: string | null;
  effective_date?: string | null;
  notes?: string | null;
}

function normalizeVpiAdjustment(adjustment: any) {
  const normalized = normalizeFields(adjustment);
  if (normalized.tenants) {
    normalized.tenants = normalizeFields(normalized.tenants);
    if (normalized.tenants.units) {
      normalized.tenants.units = normalizeFields(normalized.tenants.units);
      if (normalized.tenants.units.properties) {
        normalized.tenants.units.properties = normalizeFields(normalized.tenants.units.properties);
      }
    }
  }
  return normalized;
}

export function getVpiStatus(adjustment: VpiAdjustment): VpiAdjustmentStatus {
  if (adjustment.notification_sent && adjustment.effective_date) {
    const effectiveDate = new Date(adjustment.effective_date);
    const today = new Date();
    if (effectiveDate <= today) {
      return 'applied';
    }
  }
  if (adjustment.notification_sent === false && adjustment.effective_date === null) {
    return 'rejected';
  }
  return 'pending';
}

export function useVpiAdjustments() {
  return useQuery({
    queryKey: ['vpi-adjustments'],
    queryFn: async () => {
      const response = await fetch('/api/vpi-adjustments', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch VPI adjustments');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeVpiAdjustment) : [normalizeVpiAdjustment(data)] as VpiAdjustment[];
    },
  });
}

export function useVpiAdjustment(id: string | undefined) {
  return useQuery({
    queryKey: ['vpi-adjustments', id],
    queryFn: async () => {
      if (!id) return null;
      const response = await fetch(`/api/vpi-adjustments/${id}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch VPI adjustment');
      const data = await response.json();
      return data ? normalizeVpiAdjustment(data) as VpiAdjustment : null;
    },
    enabled: !!id,
  });
}

export function useCreateVpiAdjustment() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (adjustment: VpiAdjustmentInsert) => {
      const response = await apiRequest('POST', '/api/vpi-adjustments', adjustment);
      const data = await response.json();
      return normalizeVpiAdjustment(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vpi-adjustments'] });
      toast.success('VPI-Anpassung erfolgreich erstellt');
    },
    onError: (error) => {
      toast.error('Fehler beim Erstellen der VPI-Anpassung');
      console.error('Create VPI adjustment error:', error);
    },
  });
}

export function useUpdateVpiAdjustment() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: VpiAdjustmentUpdate) => {
      const response = await apiRequest('PATCH', `/api/vpi-adjustments/${id}`, updates);
      const data = await response.json();
      return normalizeVpiAdjustment(data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['vpi-adjustments'] });
      queryClient.invalidateQueries({ queryKey: ['vpi-adjustments', data.id] });
      toast.success('VPI-Anpassung erfolgreich aktualisiert');
    },
    onError: (error) => {
      toast.error('Fehler beim Aktualisieren der VPI-Anpassung');
      console.error('Update VPI adjustment error:', error);
    },
  });
}

export function useApplyVpiAdjustment() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, sendNotification }: { id: string; sendNotification: boolean }) => {
      const response = await apiRequest('POST', `/api/vpi-adjustments/${id}/apply`, { sendNotification });
      const data = await response.json();
      return normalizeVpiAdjustment(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vpi-adjustments'] });
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      toast.success('VPI-Anpassung erfolgreich angewendet');
    },
    onError: (error) => {
      toast.error('Fehler beim Anwenden der VPI-Anpassung');
      console.error('Apply VPI adjustment error:', error);
    },
  });
}

export function useRejectVpiAdjustment() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest('POST', `/api/vpi-adjustments/${id}/reject`, {});
      const data = await response.json();
      return normalizeVpiAdjustment(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vpi-adjustments'] });
      toast.success('VPI-Anpassung abgelehnt');
    },
    onError: (error) => {
      toast.error('Fehler beim Ablehnen der VPI-Anpassung');
      console.error('Reject VPI adjustment error:', error);
    },
  });
}

export function useDeleteVpiAdjustment() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/vpi-adjustments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vpi-adjustments'] });
      toast.success('VPI-Anpassung erfolgreich gelöscht');
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen der VPI-Anpassung');
      console.error('Delete VPI adjustment error:', error);
    },
  });
}
