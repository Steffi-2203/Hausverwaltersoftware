import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';

export interface Deadline {
  id: string;
  organization_id: string | null;
  property_id: string | null;
  title: string;
  description: string | null;
  deadline_date: string;
  reminder_days: number;
  reminder_sent_at: string | null;
  category: 'vertrag' | 'versicherung' | 'wartung' | 'abrechnung' | 'steuer' | 'sonstiges';
  source_type: string | null;
  source_id: string | null;
  is_recurring: boolean;
  recurrence_months: number | null;
  status: 'offen' | 'erledigt' | 'uebersprungen';
  created_at: string;
  updated_at: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  vertrag: 'Vertrag',
  versicherung: 'Versicherung',
  wartung: 'Wartung',
  abrechnung: 'Abrechnung',
  steuer: 'Steuer',
  sonstiges: 'Sonstiges',
};

export function getCategoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] || cat;
}

export function useDeadlines(filters?: { status?: string; category?: string; propertyId?: string }) {
  return useQuery({
    queryKey: ['/api/deadlines', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.status) params.set('status', filters.status);
      if (filters?.category) params.set('category', filters.category);
      if (filters?.propertyId) params.set('propertyId', filters.propertyId);
      const qs = params.toString();
      const res = await fetch(`/api/deadlines${qs ? `?${qs}` : ''}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json() as Promise<Deadline[]>;
    },
  });
}

export function useCreateDeadline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (deadline: Omit<Deadline, 'id' | 'created_at' | 'updated_at' | 'reminder_sent_at'>) => {
      const res = await apiRequest('POST', '/api/deadlines', deadline);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/deadlines'] });
      toast.success('Frist erstellt');
    },
    onError: () => toast.error('Fehler beim Erstellen'),
  });
}

export function useUpdateDeadline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<Deadline>) => {
      const res = await apiRequest('PATCH', `/api/deadlines/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/deadlines'] });
      toast.success('Frist aktualisiert');
    },
    onError: () => toast.error('Fehler'),
  });
}

export function useDeleteDeadline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/deadlines/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/deadlines'] });
      toast.success('Frist gelöscht');
    },
    onError: () => toast.error('Fehler'),
  });
}
