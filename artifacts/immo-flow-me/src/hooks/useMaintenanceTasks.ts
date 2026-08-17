import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';
import { normalizeFields } from '@/utils/fieldNormalizer';

export interface MaintenanceTask {
  id: string;
  organization_id: string | null;
  property_id: string | null;
  unit_id: string | null;
  title: string;
  description: string | null;
  category: 'repair' | 'maintenance' | 'inspection' | 'emergency' | 'other' | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'pending_approval' | 'completed' | 'cancelled';
  assigned_to: string | null;
  contractor_name: string | null;
  contractor_contact: string | null;
  due_date: string | null;
  completed_at: string | null;
  estimated_cost: number | null;
  actual_cost: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  properties?: { name: string } | null;
  units?: { top_nummer: string } | null;
}

export interface CreateMaintenanceTask {
  property_id: string;
  unit_id?: string | null;
  title: string;
  description?: string;
  category?: string;
  priority?: string;
  contractor_name?: string;
  contractor_contact?: string;
  due_date?: string;
  estimated_cost?: number;
}

function normalizeMaintenanceTask(task: any) {
  const normalized = normalizeFields(task);
  if (normalized.properties) {
    normalized.properties = normalizeFields(normalized.properties);
  }
  if (normalized.units) {
    normalized.units = normalizeFields(normalized.units);
  }
  return normalized;
}

export function useMaintenanceTasks(filters?: {
  status?: string;
  priority?: string;
  category?: string;
  propertyId?: string;
}) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['maintenance-tasks', user?.id, filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.status && filters.status !== 'all') params.set('status', filters.status);
      if (filters?.priority && filters.priority !== 'all') params.set('priority', filters.priority);
      if (filters?.category && filters.category !== 'all') params.set('category', filters.category);
      if (filters?.propertyId && filters.propertyId !== 'all') params.set('property_id', filters.propertyId);
      
      const url = `/api/maintenance-tasks${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch maintenance tasks');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeMaintenanceTask) : [normalizeMaintenanceTask(data)] as MaintenanceTask[];
    },
    enabled: !!user?.id,
  });
}

export function useCreateMaintenanceTask() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (task: CreateMaintenanceTask) => {
      const response = await apiRequest('POST', '/api/maintenance-tasks', task);
      const data = await response.json();
      return normalizeMaintenanceTask(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance-tasks'] });
      toast({
        title: 'Auftrag erstellt',
        description: 'Der Wartungsauftrag wurde erfolgreich erstellt.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Fehler',
        description: 'Der Auftrag konnte nicht erstellt werden.',
        variant: 'destructive',
      });
      console.error('Error creating task:', error);
    },
  });
}

export function useUpdateMaintenanceTask() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<MaintenanceTask> & { id: string }) => {
      const response = await apiRequest('PATCH', `/api/maintenance-tasks/${id}`, updates);
      const data = await response.json();
      return normalizeMaintenanceTask(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance-tasks'] });
      toast({
        title: 'Auftrag aktualisiert',
        description: 'Der Wartungsauftrag wurde erfolgreich aktualisiert.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Fehler',
        description: 'Der Auftrag konnte nicht aktualisiert werden.',
        variant: 'destructive',
      });
      console.error('Error updating task:', error);
    },
  });
}

export function useDeleteMaintenanceTask() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/maintenance-tasks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance-tasks'] });
      toast({
        title: 'Auftrag gelöscht',
        description: 'Der Wartungsauftrag wurde gelöscht.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Fehler',
        description: 'Der Auftrag konnte nicht gelöscht werden.',
        variant: 'destructive',
      });
      console.error('Error deleting task:', error);
    },
  });
}

export const TASK_CATEGORIES = [
  { value: 'repair', label: 'Reparatur' },
  { value: 'maintenance', label: 'Wartung' },
  { value: 'inspection', label: 'Inspektion' },
  { value: 'emergency', label: 'Notfall' },
  { value: 'other', label: 'Sonstiges' },
];

export const TASK_PRIORITIES = [
  { value: 'low', label: 'Niedrig', icon: '↓', color: 'text-gray-500' },
  { value: 'medium', label: 'Mittel', icon: '➡️', color: 'text-yellow-500' },
  { value: 'high', label: 'Hoch', icon: '⚠️', color: 'text-orange-500' },
  { value: 'urgent', label: 'Dringend', icon: '🔥', color: 'text-red-500' },
];

export const TASK_STATUSES = [
  { value: 'open', label: 'Offen', color: 'bg-gray-100 text-gray-800' },
  { value: 'in_progress', label: 'In Bearbeitung', color: 'bg-blue-100 text-blue-800' },
  { value: 'pending_approval', label: 'Wartet auf Freigabe', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'completed', label: 'Abgeschlossen', color: 'bg-green-100 text-green-800' },
  { value: 'cancelled', label: 'Storniert', color: 'bg-red-100 text-red-800' },
];
