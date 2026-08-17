import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';

export interface HeatingCostReading {
  id: string;
  organization_id: string | null;
  property_id: string;
  unit_id: string;
  period_from: string;
  period_to: string;
  consumption: number;
  consumption_unit: string;
  cost_share: number;
  source: 'csv' | 'manual';
  provider: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function useHeatingCostReadings(propertyId?: string, periodFrom?: string, periodTo?: string) {
  return useQuery({
    queryKey: ['/api/heating-cost-readings', propertyId, periodFrom, periodTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (propertyId) params.set('propertyId', propertyId);
      if (periodFrom) params.set('periodFrom', periodFrom);
      if (periodTo) params.set('periodTo', periodTo);
      const qs = params.toString();
      const res = await fetch(`/api/heating-cost-readings${qs ? `?${qs}` : ''}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json() as Promise<HeatingCostReading[]>;
    },
    enabled: !!propertyId,
  });
}

export function useCreateHeatingCostReading() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reading: Omit<HeatingCostReading, 'id' | 'created_at' | 'updated_at'>) => {
      const res = await apiRequest('POST', '/api/heating-cost-readings', reading);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/heating-cost-readings'] });
      toast.success('Heizkostenablesung gespeichert');
    },
    onError: () => toast.error('Fehler beim Speichern der Ablesung'),
  });
}

export function useBulkCreateHeatingCostReadings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (readings: Omit<HeatingCostReading, 'id' | 'created_at' | 'updated_at'>[]) => {
      const res = await apiRequest('POST', '/api/heating-cost-readings', readings);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/heating-cost-readings'] });
      const count = Array.isArray(data) ? data.length : 1;
      toast.success(`${count} Ablesungen importiert`);
    },
    onError: () => toast.error('Fehler beim Import'),
  });
}

export function useDeleteHeatingCostReading() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/heating-cost-readings/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/heating-cost-readings'] });
      toast.success('Ablesung gelöscht');
    },
    onError: () => toast.error('Fehler beim Löschen'),
  });
}
