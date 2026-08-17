import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';

export interface Unit {
  id: string;
  propertyId: string;
  property_id: string;
  topNummer: string;
  top_nummer: string;
  type: 'wohnung' | 'geschaeft' | 'garage' | 'stellplatz' | 'lager' | 'sonstiges';
  status: 'aktiv' | 'leerstand' | 'beendet';
  flaeche: string | null;
  zimmer: number | null;
  nutzwert: string | null;
  stockwerk: number | null;
  notes: string | null;
  createdAt: string;
  created_at: string;
  updatedAt: string;
  updated_at: string;
  tenants?: Tenant[];
}

export interface Tenant {
  id: string;
  unitId: string;
  unit_id: string;
  firstName: string;
  first_name: string;
  lastName: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  status: 'aktiv' | 'leerstand' | 'beendet';
  mietbeginn: string | null;
  mietende: string | null;
  grundmiete: string;
  betriebskostenVorschuss: string;
  betriebskosten_vorschuss: string;
  heizungskostenVorschuss: string;
  heizungskosten_vorschuss: string;
}

function normalizeUnit(u: any): Unit {
  return {
    ...u,
    propertyId: u.propertyId ?? u.property_id ?? '',
    property_id: u.propertyId ?? u.property_id ?? '',
    topNummer: u.topNummer ?? u.top_nummer ?? '',
    top_nummer: u.topNummer ?? u.top_nummer ?? '',
    createdAt: u.createdAt ?? u.created_at ?? '',
    created_at: u.createdAt ?? u.created_at ?? '',
    updatedAt: u.updatedAt ?? u.updated_at ?? '',
    updated_at: u.updatedAt ?? u.updated_at ?? '',
  };
}

function normalizeTenantForUnit(t: any): Tenant {
  return {
    ...t,
    unitId: t.unitId ?? t.unit_id ?? '',
    unit_id: t.unitId ?? t.unit_id ?? '',
    firstName: t.firstName ?? t.first_name ?? '',
    first_name: t.firstName ?? t.first_name ?? '',
    lastName: t.lastName ?? t.last_name ?? '',
    last_name: t.lastName ?? t.last_name ?? '',
    betriebskostenVorschuss: t.betriebskostenVorschuss ?? t.betriebskosten_vorschuss ?? '0',
    betriebskosten_vorschuss: t.betriebskostenVorschuss ?? t.betriebskosten_vorschuss ?? '0',
    heizungskostenVorschuss: t.heizungskostenVorschuss ?? t.heizungskosten_vorschuss ?? '0',
    heizungskosten_vorschuss: t.heizungskostenVorschuss ?? t.heizungskosten_vorschuss ?? '0',
  };
}

// Required: topNummer, propertyId. Optional: type, status, flaeche, zimmer, nutzwert, stockwerk, notes
export type UnitInsert = Pick<Unit, 'topNummer' | 'propertyId'> & Partial<Pick<Unit, 'type' | 'status' | 'flaeche' | 'zimmer' | 'nutzwert' | 'stockwerk' | 'notes'>>;
export type UnitUpdate = Partial<UnitInsert>;

export function useUnits(propertyId?: string) {
  return useQuery({
    queryKey: ['units', propertyId],
    staleTime: 60000,
    gcTime: 300000,
    queryFn: async () => {
      const url = propertyId 
        ? `/api/properties/${propertyId}/units`
        : '/api/units';
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch units');
      const units = await response.json();
      
      if (propertyId) {
        const tenantsResponse = await fetch('/api/tenants', { credentials: 'include' });
        if (tenantsResponse.ok) {
          const tenants = await tenantsResponse.json();
          const normalizedTenants = tenants.map(normalizeTenantForUnit);
          return units.map((unit: any) => {
            const normalizedUnit = normalizeUnit(unit);
            return {
              ...normalizedUnit,
              tenants: normalizedTenants.filter((t: Tenant) => 
                (t.unitId ?? t.unit_id) === normalizedUnit.id
              )
            };
          });
        }
      }
      
      return units.map(normalizeUnit);
    },
  });
}

export function useUnit(id: string | undefined) {
  return useQuery({
    queryKey: ['unit', id],
    queryFn: async () => {
      if (!id) return null;
      const response = await fetch(`/api/units/${id}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch unit');
      const unit = await response.json();
      const normalized = normalizeUnit(unit);
      
      const tenantsResponse = await fetch(`/api/units/${id}/tenants`, { credentials: 'include' });
      if (tenantsResponse.ok) {
        const tenants = await tenantsResponse.json();
        normalized.tenants = tenants.map(normalizeTenantForUnit);
      }
      
      return normalized;
    },
    enabled: !!id,
  });
}

export function useCreateUnit() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (unit: UnitInsert) => {
      const response = await apiRequest('POST', '/api/units', unit);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['units'] });
      queryClient.invalidateQueries({ queryKey: ['units', data.propertyId] });
      toast.success('Einheit erfolgreich erstellt');
    },
    onError: (error) => {
      toast.error('Fehler beim Erstellen der Einheit');
      console.error('Create unit error:', error);
    },
  });
}

export function useUpdateUnit() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: UnitUpdate & { id: string }) => {
      const response = await apiRequest('PATCH', `/api/units/${id}`, updates);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['units'] });
      queryClient.invalidateQueries({ queryKey: ['unit', data.id] });
      toast.success('Einheit erfolgreich aktualisiert');
    },
    onError: (error) => {
      toast.error('Fehler beim Aktualisieren der Einheit');
      console.error('Update unit error:', error);
    },
  });
}

export function useDeleteUnit() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/units/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['units'] });
      toast.success('Einheit erfolgreich gelöscht');
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen der Einheit');
      console.error('Delete unit error:', error);
    },
  });
}
