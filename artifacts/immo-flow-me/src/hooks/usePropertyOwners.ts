import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { normalizeFields } from '@/utils/fieldNormalizer';

export interface PropertyOwner {
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
}

export type PropertyOwnerInsert = Omit<PropertyOwner, 'id' | 'created_at' | 'updated_at'>;
export type PropertyOwnerUpdate = Partial<PropertyOwnerInsert> & { id: string };

function normalizePropertyOwner(owner: any) {
  return normalizeFields(owner);
}

export function usePropertyOwners(propertyId: string | undefined) {
  return useQuery({
    queryKey: ['property-owners', propertyId],
    queryFn: async () => {
      if (!propertyId) return [];
      const response = await fetch(`/api/properties/${propertyId}/owners`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch property owners');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizePropertyOwner) : [normalizePropertyOwner(data)] as PropertyOwner[];
    },
    enabled: !!propertyId,
  });
}

export function useCreatePropertyOwner() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (owner: PropertyOwnerInsert) => {
      const response = await apiRequest('POST', `/api/properties/${owner.property_id}/owners`, owner);
      const data = await response.json();
      return normalizePropertyOwner(data) as PropertyOwner;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['property-owners', variables.property_id] });
    },
  });
}

export function useUpdatePropertyOwner() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: PropertyOwnerUpdate) => {
      const response = await apiRequest('PATCH', `/api/property-owners/${id}`, updates);
      const data = await response.json();
      return normalizePropertyOwner(data) as PropertyOwner;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['property-owners', data.property_id] });
    },
  });
}

export function useDeletePropertyOwner() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, propertyId }: { id: string; propertyId: string }) => {
      await apiRequest('DELETE', `/api/property-owners/${id}`);
      return { id, propertyId };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['property-owners', variables.propertyId] });
    },
  });
}

export function useTotalOwnershipShare(propertyId: string | undefined) {
  const { data: owners } = usePropertyOwners(propertyId);
  
  if (!owners || owners.length === 0) return 0;
  
  return owners.reduce((sum, owner) => sum + owner.ownership_share, 0);
}

export function usePrimaryOwner(propertyId: string | undefined) {
  const { data: owners } = usePropertyOwners(propertyId);
  
  if (!owners || owners.length === 0) return null;
  
  return owners.find(o => o.is_primary) || owners[0];
}
