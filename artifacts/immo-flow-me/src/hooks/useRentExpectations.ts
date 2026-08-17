import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';
import { normalizeFields } from '@/utils/fieldNormalizer';

export interface RentExpectation {
  id: string;
  unit_id: string;
  start_date: string;
  end_date: string | null;
  grundmiete: number;
  betriebskosten: number;
  heizkosten: number;
  sonstige_kosten: number | null;
  total_miete: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type RentExpectationInsert = Omit<RentExpectation, 'id' | 'created_at' | 'updated_at' | 'total_miete'>;
export type RentExpectationUpdate = Partial<RentExpectationInsert>;

function normalizeRentExpectation(expectation: any) {
  return normalizeFields(expectation);
}

export function useRentExpectations() {
  return useQuery({
    queryKey: ['rent_expectations'],
    queryFn: async () => {
      const response = await fetch('/api/rent-expectations', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch rent expectations');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeRentExpectation) : [normalizeRentExpectation(data)] as RentExpectation[];
    },
  });
}

export function useRentExpectationsByUnit(unitId?: string) {
  return useQuery({
    queryKey: ['rent_expectations', 'unit', unitId],
    queryFn: async () => {
      if (!unitId) return [];
      const response = await fetch(`/api/rent-expectations?unit_id=${unitId}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch rent expectations');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeRentExpectation) : [normalizeRentExpectation(data)] as RentExpectation[];
    },
    enabled: !!unitId,
  });
}

export function useCurrentRentExpectation(unitId?: string) {
  return useQuery({
    queryKey: ['rent_expectations', 'current', unitId],
    queryFn: async () => {
      if (!unitId) return null;
      const response = await fetch(`/api/rent-expectations/current?unit_id=${unitId}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch current rent expectation');
      const data = await response.json();
      return data ? normalizeRentExpectation(data) as RentExpectation : null;
    },
    enabled: !!unitId,
  });
}

export function useCreateRentExpectation() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (expectation: RentExpectationInsert) => {
      const response = await apiRequest('POST', '/api/rent-expectations', expectation);
      const data = await response.json();
      return normalizeRentExpectation(data) as RentExpectation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rent_expectations'] });
      toast.success('Soll-Miete erfolgreich angelegt');
    },
    onError: (error) => {
      toast.error('Fehler beim Anlegen der Soll-Miete');
      console.error('Create rent expectation error:', error);
    },
  });
}

export function useUpdateRentExpectation() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: RentExpectationUpdate & { id: string }) => {
      const response = await apiRequest('PATCH', `/api/rent-expectations/${id}`, updates);
      const data = await response.json();
      return normalizeRentExpectation(data) as RentExpectation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rent_expectations'] });
      toast.success('Soll-Miete aktualisiert');
    },
    onError: (error) => {
      toast.error('Fehler beim Aktualisieren der Soll-Miete');
      console.error('Update rent expectation error:', error);
    },
  });
}

export function useDeleteRentExpectation() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/rent-expectations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rent_expectations'] });
      toast.success('Soll-Miete gelöscht');
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen der Soll-Miete');
      console.error('Delete rent expectation error:', error);
    },
  });
}
