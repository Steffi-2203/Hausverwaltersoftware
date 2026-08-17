import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';
import { normalizeFields } from '@/utils/fieldNormalizer';

export interface Owner {
  id: string;
  property_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  iban: string | null;
  bic: string | null;
  ownership_share: number;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
  properties?: {
    id: string;
    name: string;
    address: string | null;
  };
}

export type OwnerInsert = Omit<Owner, 'id' | 'created_at' | 'updated_at' | 'properties'>;
export type OwnerUpdate = Partial<OwnerInsert>;

function normalizeOwner(owner: any) {
  const normalized = normalizeFields(owner);
  if (normalized.properties) {
    normalized.properties = normalizeFields(normalized.properties);
  }
  return normalized;
}

export function useOwners() {
  return useQuery({
    queryKey: ['owners'],
    queryFn: async () => {
      const response = await fetch('/api/property-owners', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch owners');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeOwner) : [normalizeOwner(data)] as Owner[];
    },
  });
}

export function useOwner(id: string | undefined) {
  return useQuery({
    queryKey: ['owners', id],
    queryFn: async () => {
      if (!id) return null;
      const response = await fetch(`/api/property-owners/${id}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch owner');
      const data = await response.json();
      return data ? normalizeOwner(data) as Owner : null;
    },
    enabled: !!id,
  });
}

export function useCreateOwner() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (owner: OwnerInsert) => {
      const response = await apiRequest('POST', '/api/property-owners', owner);
      const data = await response.json();
      return normalizeOwner(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owners'] });
      queryClient.invalidateQueries({ queryKey: ['property-owners'] });
      toast.success('Eigentümer erfolgreich angelegt');
    },
    onError: (error) => {
      toast.error('Fehler beim Anlegen des Eigentümers');
      console.error('Create owner error:', error);
    },
  });
}

export function useUpdateOwner() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: OwnerUpdate & { id: string }) => {
      const response = await apiRequest('PATCH', `/api/property-owners/${id}`, updates);
      const data = await response.json();
      return normalizeOwner(data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['owners'] });
      queryClient.invalidateQueries({ queryKey: ['owners', data.id] });
      queryClient.invalidateQueries({ queryKey: ['property-owners'] });
      toast.success('Eigentümer erfolgreich aktualisiert');
    },
    onError: (error) => {
      toast.error('Fehler beim Aktualisieren des Eigentümers');
      console.error('Update owner error:', error);
    },
  });
}

export function useDeleteOwner() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/property-owners/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owners'] });
      queryClient.invalidateQueries({ queryKey: ['property-owners'] });
      toast.success('Eigentümer erfolgreich gelöscht');
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen des Eigentümers');
      console.error('Delete owner error:', error);
    },
  });
}

export function usePropertyOwnersForProperty(propertyId: string | undefined) {
  return useQuery({
    queryKey: ['owners', 'property', propertyId],
    queryFn: async () => {
      if (!propertyId) return [];
      const response = await fetch(`/api/properties/${propertyId}/owners`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch property owners');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeOwner) : [normalizeOwner(data)] as Owner[];
    },
    enabled: !!propertyId,
  });
}
