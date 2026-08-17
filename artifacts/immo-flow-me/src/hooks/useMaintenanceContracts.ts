import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';
import { normalizeFields } from '@/utils/fieldNormalizer';

export interface MaintenanceContract {
  id: string;
  organization_id: string | null;
  property_id: string;
  title: string;
  contract_type: string;
  description: string | null;
  contractor_name: string | null;
  contractor_contact: string | null;
  contractor_email: string | null;
  interval_months: number;
  last_maintenance_date: string | null;
  next_due_date: string;
  reminder_days: number;
  reminder_sent_at: string | null;
  estimated_cost: number | null;
  contract_fee: number | null;
  is_active: boolean;
  document_url: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  properties?: {
    name: string;
    address: string;
  };
}

export interface CreateMaintenanceContract {
  property_id: string;
  title: string;
  contract_type: string;
  description?: string;
  contractor_name?: string;
  contractor_contact?: string;
  contractor_email?: string;
  interval_months: number;
  last_maintenance_date?: string;
  next_due_date: string;
  reminder_days?: number;
  estimated_cost?: number;
  contract_fee?: number;
  document_url?: string;
  notes?: string;
}

export const CONTRACT_TYPES = [
  { value: 'tuev', label: 'TÜV-Prüfung', defaultInterval: 24 },
  { value: 'elevator', label: 'Aufzugwartung', defaultInterval: 12 },
  { value: 'hvac', label: 'Klimaanlage', defaultInterval: 12 },
  { value: 'heating', label: 'Heizungsanlage', defaultInterval: 12 },
  { value: 'fire_safety', label: 'Brandschutz', defaultInterval: 12 },
  { value: 'electrical', label: 'Elektroprüfung', defaultInterval: 48 },
  { value: 'water', label: 'Wasseruntersuchung (Legionellen)', defaultInterval: 12 },
  { value: 'chimney', label: 'Kaminkehrer', defaultInterval: 12 },
  { value: 'gas', label: 'Gasanlage', defaultInterval: 12 },
  { value: 'other', label: 'Sonstige', defaultInterval: 12 },
] as const;

export function getContractTypeLabel(type: string): string {
  const found = CONTRACT_TYPES.find(t => t.value === type);
  return found?.label || type;
}

function normalizeMaintenanceContract(contract: any) {
  const normalized = normalizeFields(contract);
  if (normalized.properties) {
    normalized.properties = normalizeFields(normalized.properties);
  }
  return normalized;
}

export function useMaintenanceContracts(propertyId?: string) {
  return useQuery({
    queryKey: ['maintenance_contracts', propertyId],
    queryFn: async () => {
      const url = propertyId 
        ? `/api/maintenance-contracts?property_id=${propertyId}` 
        : '/api/maintenance-contracts';
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch maintenance contracts');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeMaintenanceContract) : [normalizeMaintenanceContract(data)] as MaintenanceContract[];
    },
  });
}

export function useUpcomingMaintenance(daysAhead: number = 30) {
  return useQuery({
    queryKey: ['upcoming_maintenance', daysAhead],
    queryFn: async () => {
      const response = await fetch(`/api/maintenance-contracts/upcoming?days=${daysAhead}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch upcoming maintenance');
      const data = await response.json();
      const contracts = Array.isArray(data) ? data.map(normalizeMaintenanceContract) : [normalizeMaintenanceContract(data)] as MaintenanceContract[];
      
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      
      return {
        overdue: contracts.filter(c => c.next_due_date < todayStr),
        upcoming: contracts.filter(c => c.next_due_date >= todayStr),
        all: contracts,
      };
    },
  });
}

export function useCreateMaintenanceContract() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (contract: CreateMaintenanceContract) => {
      const response = await apiRequest('POST', '/api/maintenance-contracts', contract);
      const data = await response.json();
      return normalizeMaintenanceContract(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance_contracts'] });
      queryClient.invalidateQueries({ queryKey: ['upcoming_maintenance'] });
      toast.success('Wartungsvertrag erfolgreich erstellt');
    },
    onError: (error: Error) => {
      toast.error(`Fehler beim Erstellen: ${error.message}`);
    },
  });
}

export function useUpdateMaintenanceContract() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<MaintenanceContract> & { id: string }) => {
      const response = await apiRequest('PATCH', `/api/maintenance-contracts/${id}`, updates);
      const data = await response.json();
      return normalizeMaintenanceContract(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance_contracts'] });
      queryClient.invalidateQueries({ queryKey: ['upcoming_maintenance'] });
      toast.success('Wartungsvertrag aktualisiert');
    },
    onError: (error: Error) => {
      toast.error(`Fehler beim Aktualisieren: ${error.message}`);
    },
  });
}

export function useMarkMaintenanceComplete() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, completedDate }: { id: string; completedDate: string }) => {
      const response = await apiRequest('POST', `/api/maintenance-contracts/${id}/complete`, { completedDate });
      const data = await response.json();
      return normalizeMaintenanceContract(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance_contracts'] });
      queryClient.invalidateQueries({ queryKey: ['upcoming_maintenance'] });
      toast.success('Wartung als erledigt markiert, nächster Termin berechnet');
    },
    onError: (error: Error) => {
      toast.error(`Fehler: ${error.message}`);
    },
  });
}

export function useDeleteMaintenanceContract() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/maintenance-contracts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance_contracts'] });
      queryClient.invalidateQueries({ queryKey: ['upcoming_maintenance'] });
      toast.success('Wartungsvertrag gelöscht');
    },
    onError: (error: Error) => {
      toast.error(`Fehler beim Löschen: ${error.message}`);
    },
  });
}
