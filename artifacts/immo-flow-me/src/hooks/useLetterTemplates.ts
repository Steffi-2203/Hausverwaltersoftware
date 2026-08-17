import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';

export function useLetterTemplates() {
  return useQuery({
    queryKey: ['/api/letter-templates'],
    queryFn: async () => {
      const res = await fetch('/api/letter-templates', { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json();
    },
  });
}

export function useCreateLetterTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (template: {
      name: string;
      category: string;
      subject: string;
      body: string;
      organization_id: string;
    }) => {
      const res = await apiRequest('POST', '/api/letter-templates', template);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/letter-templates'] });
      toast.success('Vorlage gespeichert');
    },
    onError: () => toast.error('Fehler beim Speichern'),
  });
}

export function useDeleteLetterTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/letter-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/letter-templates'] });
      toast.success('Vorlage gelöscht');
    },
    onError: () => toast.error('Fehler beim Löschen'),
  });
}

export function useSerialLetters() {
  return useQuery({
    queryKey: ['/api/serial-letters'],
    queryFn: async () => {
      const res = await fetch('/api/serial-letters', { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json();
    },
  });
}

export function useCreateSerialLetter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (letter: {
      organization_id: string;
      property_id: string;
      template_id?: string;
      subject: string;
      body: string;
      recipient_count: number;
      sent_via: string;
      sent_at?: string;
    }) => {
      const res = await apiRequest('POST', '/api/serial-letters', letter);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/serial-letters'] });
      toast.success('Serienbrief erstellt');
    },
    onError: () => toast.error('Fehler beim Erstellen'),
  });
}
