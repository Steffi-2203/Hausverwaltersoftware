import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';
import { normalizeFields } from '@/utils/fieldNormalizer';

export interface KeyInventoryItem {
  id: string;
  property_id: string;
  unit_id: string | null;
  key_type: string;
  key_number: string | null;
  description: string | null;
  total_count: number | null;
  available_count: number | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  properties?: {
    id: string;
    name: string;
  };
  units?: {
    id: string;
    top_nummer: string;
  } | null;
}

export interface KeyInventoryInsert {
  property_id: string;
  unit_id?: string | null;
  key_type: string;
  key_number?: string | null;
  description?: string | null;
  total_count?: number;
  available_count?: number;
  notes?: string | null;
}

export interface KeyInventoryUpdate extends Partial<KeyInventoryInsert> {
  id: string;
}

export interface KeyHandover {
  id: string;
  key_inventory_id: string;
  tenant_id: string | null;
  recipient_name: string | null;
  handover_date: string;
  return_date: string | null;
  quantity: number | null;
  status: string | null;
  handover_protocol: string | null;
  notes: string | null;
  created_at: string | null;
  tenants?: {
    id: string;
    first_name: string;
    last_name: string;
  } | null;
}

export interface KeyHandoverInsert {
  key_inventory_id: string;
  tenant_id?: string | null;
  recipient_name?: string | null;
  handover_date: string;
  return_date?: string | null;
  quantity?: number;
  status?: string;
  handover_protocol?: string | null;
  notes?: string | null;
}

export const KEY_TYPE_LABELS: Record<string, string> = {
  hauptschluessel: 'Haupteingang',
  wohnungsschluessel: 'Wohnung',
  kellerschluessel: 'Keller',
  garagenschluessel: 'Garage',
  briefkastenschluessel: 'Briefkasten',
  sonstiges: 'Sonstiges',
};

export const KEY_STATUS_LABELS: Record<string, string> = {
  vorhanden: 'Vorhanden',
  ausgegeben: 'Ausgegeben',
  verloren: 'Verloren',
  gesperrt: 'Gesperrt',
};

function normalizeKeyInventory(item: any) {
  const normalized = normalizeFields(item);
  if (normalized.properties) {
    normalized.properties = normalizeFields(normalized.properties);
  }
  if (normalized.units) {
    normalized.units = normalizeFields(normalized.units);
  }
  return normalized;
}

function normalizeKeyHandover(handover: any) {
  const normalized = normalizeFields(handover);
  if (normalized.tenants) {
    normalized.tenants = normalizeFields(normalized.tenants);
  }
  return normalized;
}

export function useKeyInventory(propertyId?: string) {
  return useQuery({
    queryKey: ['key-inventory', propertyId],
    queryFn: async () => {
      const url = propertyId ? `/api/key-inventory?property_id=${propertyId}` : '/api/key-inventory';
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch key inventory');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeKeyInventory) : [normalizeKeyInventory(data)] as KeyInventoryItem[];
    },
  });
}

export function useKeyInventoryItem(id: string | undefined) {
  return useQuery({
    queryKey: ['key-inventory', 'item', id],
    queryFn: async () => {
      if (!id) return null;
      const response = await fetch(`/api/key-inventory/${id}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch key inventory item');
      const data = await response.json();
      return data ? normalizeKeyInventory(data) as KeyInventoryItem : null;
    },
    enabled: !!id,
  });
}

export function useCreateKeyInventory() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (key: KeyInventoryInsert) => {
      const response = await apiRequest('POST', '/api/key-inventory', key);
      const data = await response.json();
      return normalizeKeyInventory(data) as KeyInventoryItem;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['key-inventory'] });
      toast.success('Schlüssel erfolgreich angelegt');
    },
    onError: (error) => {
      toast.error('Fehler beim Anlegen des Schlüssels');
      console.error('Create key error:', error);
    },
  });
}

export function useUpdateKeyInventory() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: KeyInventoryUpdate) => {
      const response = await apiRequest('PATCH', `/api/key-inventory/${id}`, updates);
      const data = await response.json();
      return normalizeKeyInventory(data) as KeyInventoryItem;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['key-inventory'] });
      queryClient.invalidateQueries({ queryKey: ['key-inventory', 'item', data.id] });
      toast.success('Schlüssel erfolgreich aktualisiert');
    },
    onError: (error) => {
      toast.error('Fehler beim Aktualisieren des Schlüssels');
      console.error('Update key error:', error);
    },
  });
}

export function useDeleteKeyInventory() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/key-inventory/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['key-inventory'] });
      toast.success('Schlüssel erfolgreich gelöscht');
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen des Schlüssels');
      console.error('Delete key error:', error);
    },
  });
}

export function useKeyHandovers(keyInventoryId: string | undefined) {
  return useQuery({
    queryKey: ['key-handovers', keyInventoryId],
    queryFn: async () => {
      if (!keyInventoryId) return [];
      const response = await fetch(`/api/key-inventory/${keyInventoryId}/handovers`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch key handovers');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeKeyHandover) : [normalizeKeyHandover(data)] as KeyHandover[];
    },
    enabled: !!keyInventoryId,
  });
}

export function useCreateKeyHandover() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (handover: KeyHandoverInsert) => {
      const response = await apiRequest('POST', `/api/key-inventory/${handover.key_inventory_id}/handovers`, handover);
      const data = await response.json();
      return normalizeKeyHandover(data) as KeyHandover;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['key-handovers', data.key_inventory_id] });
      queryClient.invalidateQueries({ queryKey: ['key-inventory'] });
      toast.success('Schlüsselübergabe erfolgreich erfasst');
    },
    onError: (error) => {
      toast.error('Fehler beim Erfassen der Schlüsselübergabe');
      console.error('Create handover error:', error);
    },
  });
}
