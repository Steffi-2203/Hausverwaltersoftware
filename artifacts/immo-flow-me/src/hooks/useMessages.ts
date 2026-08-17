import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';
import { normalizeFields } from '@/utils/fieldNormalizer';

export interface Message {
  id: string;
  organization_id: string | null;
  maintenance_task_id: string | null;
  unit_id: string | null;
  tenant_id: string | null;
  recipient_type: 'tenant' | 'contractor' | 'internal' | null;
  recipient_email: string | null;
  recipient_phone: string | null;
  recipient_name: string | null;
  subject: string | null;
  message_body: string;
  message_type: 'email' | 'sms' | 'both' | null;
  sent_at: string | null;
  status: 'draft' | 'sent' | 'failed';
  created_by: string | null;
  created_at: string;
  tenants?: { first_name: string; last_name: string } | null;
  units?: { top_nummer: string } | null;
}

function normalizeMessage(message: any) {
  const normalized = normalizeFields(message);
  if (normalized.tenants) {
    normalized.tenants = normalizeFields(normalized.tenants);
  }
  if (normalized.units) {
    normalized.units = normalizeFields(normalized.units);
  }
  return normalized;
}

export function useMessages(status?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['messages', user?.id, status],
    queryFn: async () => {
      const url = status && status !== 'all' 
        ? `/api/messages?status=${status}` 
        : '/api/messages';
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch messages');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeMessage) : [normalizeMessage(data)] as Message[];
    },
    enabled: !!user?.id,
  });
}

export function useSentMessages() {
  return useMessages('sent');
}

export function useCreateMessage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (message: {
      recipient_type: 'tenant' | 'contractor' | 'internal';
      recipient_email?: string;
      recipient_phone?: string;
      recipient_name?: string;
      subject?: string;
      message_body: string;
      message_type?: 'email' | 'sms' | 'both';
      tenant_id?: string;
      unit_id?: string;
      maintenance_task_id?: string;
      status?: 'draft' | 'sent';
    }) => {
      const response = await apiRequest('POST', '/api/messages', message);
      const data = await response.json();
      return normalizeMessage(data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      toast({
        title: data.status === 'sent' ? 'Nachricht gesendet' : 'Entwurf gespeichert',
        description: data.status === 'sent' 
          ? 'Die Nachricht wurde erfolgreich gesendet.' 
          : 'Der Entwurf wurde gespeichert.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Fehler',
        description: 'Die Nachricht konnte nicht erstellt werden.',
        variant: 'destructive',
      });
      console.error('Error creating message:', error);
    },
  });
}

export function useUpdateMessage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Message> & { id: string }) => {
      const response = await apiRequest('PATCH', `/api/messages/${id}`, updates);
      const data = await response.json();
      return normalizeMessage(data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      toast({
        title: data.status === 'sent' ? 'Nachricht gesendet' : 'Nachricht aktualisiert',
        description: data.status === 'sent' 
          ? 'Die Nachricht wurde erfolgreich gesendet.' 
          : 'Die Nachricht wurde aktualisiert.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Fehler',
        description: 'Die Nachricht konnte nicht aktualisiert werden.',
        variant: 'destructive',
      });
      console.error('Error updating message:', error);
    },
  });
}

export function useDeleteMessage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/messages/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      toast({
        title: 'Nachricht gelöscht',
        description: 'Die Nachricht wurde gelöscht.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Fehler',
        description: 'Die Nachricht konnte nicht gelöscht werden.',
        variant: 'destructive',
      });
      console.error('Error deleting message:', error);
    },
  });
}
