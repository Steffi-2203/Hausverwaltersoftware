import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';
import { normalizeFields } from '@/utils/fieldNormalizer';

export interface DistributionKey {
  id: string;
  organizationId: string | null;
  keyCode: string;
  name: string;
  unit: string | null;
  inputType: string | null;
  description: string | null;
  includedUnitTypes: string[] | null;
  isActive: boolean | null;
  sortOrder: number | null;
  isSystem: boolean | null;
  mrgKonform: boolean | null;
  mrgParagraph: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DistributionKeyInsert = Omit<DistributionKey, 'id' | 'createdAt' | 'updatedAt'>;
export type DistributionKeyUpdate = Partial<DistributionKeyInsert> & { id: string };

export const inputTypeOptions = [
  { value: 'anzahl', label: 'Anzahl', unit: 'Stk.' },
  { value: 'direkteingabe', label: 'Direkteingabe', unit: 'Anteil' },
  { value: 'promille', label: 'Promille', unit: '‰' },
  { value: 'qm', label: 'Quadratmeter', unit: 'm²' },
  { value: 'mea', label: 'MEA', unit: '‰' },
  { value: 'personen', label: 'Personenanzahl', unit: 'Pers.' },
  { value: 'kwh', label: 'Kilowattstunden', unit: 'kWh' },
  { value: 'm3', label: 'Kubikmeter', unit: 'm³' },
  { value: 'euro', label: 'Euro', unit: '€' },
  { value: 'verbrauch', label: 'Verbrauchsabhängig', unit: 'Einheit' },
];

function normalizeDistributionKey(key: any) {
  return normalizeFields(key);
}

export function useDistributionKeys() {
  return useQuery<DistributionKey[]>({
    queryKey: ['distribution-keys'],
    queryFn: async () => {
      const response = await fetch('/api/distribution-keys', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch distribution keys');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeDistributionKey) : [normalizeDistributionKey(data)];
    },
  });
}

export function useCreateDistributionKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Partial<DistributionKeyInsert>) => {
      const response = await apiRequest('POST', '/api/distribution-keys', data);
      const result = await response.json();
      return normalizeDistributionKey(result);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distribution-keys'] });
      toast.success('Verteilerschlüssel erfolgreich angelegt');
    },
    onError: (error) => {
      toast.error('Fehler beim Anlegen des Verteilerschlüssels');
      console.error('Create distribution key error:', error);
    },
  });
}

export function useUpdateDistributionKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: DistributionKeyUpdate) => {
      const response = await apiRequest('PATCH', `/api/distribution-keys/${id}`, data);
      const result = await response.json();
      return normalizeDistributionKey(result);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distribution-keys'] });
      toast.success('Verteilerschlüssel erfolgreich aktualisiert');
    },
    onError: (error) => {
      toast.error('Fehler beim Aktualisieren des Verteilerschlüssels');
      console.error('Update distribution key error:', error);
    },
  });
}

export function useDeleteDistributionKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/distribution-keys/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distribution-keys'] });
      toast.success('Verteilerschlüssel erfolgreich gelöscht');
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen des Verteilerschlüssels');
      console.error('Delete distribution key error:', error);
    },
  });
}

export function useDistributionKeysByProperty(propertyId: string | undefined) {
  return useQuery<DistributionKey[]>({
    queryKey: ['/api/properties', propertyId, 'distribution-keys'],
    queryFn: async () => {
      if (!propertyId) return [];
      const response = await fetch(`/api/properties/${propertyId}/distribution-keys`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch distribution keys');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeDistributionKey) : [];
    },
    enabled: !!propertyId,
  });
}

export function useCreatePropertyDistributionKey(propertyId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Partial<DistributionKeyInsert>) => {
      const response = await apiRequest('POST', `/api/properties/${propertyId}/distribution-keys`, data);
      const result = await response.json();
      return normalizeDistributionKey(result);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/properties', propertyId, 'distribution-keys'] });
      queryClient.invalidateQueries({ queryKey: ['distribution-keys'] });
      toast.success('Verteilerschlüssel erfolgreich angelegt');
    },
    onError: (error) => {
      toast.error('Fehler beim Anlegen des Verteilerschlüssels');
      console.error('Create distribution key error:', error);
    },
  });
}

export function useDeletePropertyDistributionKey(propertyId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/distribution-keys/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/properties', propertyId, 'distribution-keys'] });
      queryClient.invalidateQueries({ queryKey: ['distribution-keys'] });
      toast.success('Verteilerschlüssel erfolgreich gelöscht');
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen des Verteilerschlüssels');
      console.error('Delete distribution key error:', error);
    },
  });
}
