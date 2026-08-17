import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import { apiRequest } from '@/lib/queryClient';
import { normalizeFields } from '@/utils/fieldNormalizer';

function normalizeProperty(property: any) {
  return normalizeFields(property);
}

export interface PropertyInsert {
  name: string;
  address: string;
  city: string;
  postal_code: string;
  country?: string;
  building_year?: number | null;
  total_qm?: number;
  total_mea?: number;
  bk_anteil_wohnung?: number;
  bk_anteil_geschaeft?: number;
  bk_anteil_garage?: number;
  heizung_anteil_wohnung?: number;
  heizung_anteil_geschaeft?: number;
  betriebskosten_gesamt?: number;
  heizungskosten_gesamt?: number;
}

export function useProperties() {
  return useQuery({
    queryKey: ['properties'],
    queryFn: async () => {
      const response = await fetch('/api/properties', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch properties');
      const properties = await response.json();
      return properties.map(normalizeProperty);
    },
    staleTime: 60000,
    gcTime: 300000,
  });
}

export function useProperty(id: string | undefined) {
  return useQuery({
    queryKey: ['property', id],
    queryFn: async () => {
      if (!id) return null;
      const response = await fetch(`/api/properties/${id}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch property');
      const property = await response.json();
      return normalizeProperty(property);
    },
    enabled: !!id,
  });
}

export function useCreateProperty() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (property: PropertyInsert) => {
      if (!user) throw new Error('Not authenticated');

      const propertyId = crypto.randomUUID();

      const response = await apiRequest('POST', '/api/properties', {
        id: propertyId,
        ...property,
      });

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      queryClient.invalidateQueries({ queryKey: ['managed_properties_count'] });
      queryClient.invalidateQueries({ queryKey: ['property_managers'] });
      toast.success('Liegenschaft erfolgreich erstellt');
    },
    onError: (error) => {
      const message = (error as any)?.message ? `: ${(error as any).message}` : '';
      toast.error(`Fehler beim Erstellen der Liegenschaft${message}`);
      console.error('Create property error:', error);
    },
  });
}

export function useUpdateProperty() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: PropertyInsert & { id: string }) => {
      const response = await apiRequest('PATCH', `/api/properties/${id}`, updates);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      queryClient.invalidateQueries({ queryKey: ['property', data.id] });
      toast.success('Liegenschaft erfolgreich aktualisiert');
    },
    onError: (error) => {
      toast.error('Fehler beim Aktualisieren der Liegenschaft');
      console.error('Update property error:', error);
    },
  });
}

export function useDeleteProperty() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/properties/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      toast.success('Liegenschaft erfolgreich gelöscht');
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen der Liegenschaft');
      console.error('Delete property error:', error);
    },
  });
}
