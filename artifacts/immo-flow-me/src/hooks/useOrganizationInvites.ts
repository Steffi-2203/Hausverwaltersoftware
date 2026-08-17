import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';

export type AppRole = 'admin' | 'property_manager' | 'finance' | 'viewer' | 'tester';

export interface OrganizationInvite {
  id: string;
  organizationId: string;
  email: string;
  role: AppRole;
  invitedBy: string | null;
  token: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  status: string;
}

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Administrator',
  property_manager: 'Hausverwalter',
  finance: 'Buchhalter',
  viewer: 'Betrachter',
  tester: 'Tester',
};

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  admin: 'Vollzugriff auf alle Funktionen inkl. Benutzerverwaltung',
  property_manager: 'Verwaltung von Immobilien, Einheiten und Mietern',
  finance: 'Zugriff auf Banking, SEPA, Rechnungen und Finanzdaten',
  viewer: 'Nur Leserechte, sensible Daten maskiert',
  tester: 'Testmodus mit maskierten personenbezogenen Daten',
};

export function usePendingInvites() {
  return useQuery<OrganizationInvite[]>({
    queryKey: ['/api/invites'],
  });
}

export function useInviteByToken(token: string | null) {
  return useQuery<OrganizationInvite | null>({
    queryKey: ['/api/invites/token', token],
    queryFn: async () => {
      if (!token) return null;
      const response = await fetch(`/api/invites/token/${token}`);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Fehler beim Laden der Einladung');
      }
      return response.json();
    },
    enabled: !!token,
  });
}

export function useCreateInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { email: string; role: AppRole }) => {
      const response = await apiRequest('POST', '/api/invites', data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/invites'] });
      queryClient.invalidateQueries({ queryKey: ['/api/organization/members'] });
      toast.success('Einladung erfolgreich gesendet');
    },
    onError: (error) => {
      console.error('Create invite error:', error);
      toast.error(error instanceof Error ? error.message : 'Fehler beim Erstellen der Einladung');
    },
  });
}

export function useAcceptInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (token: string) => {
      const response = await apiRequest('POST', `/api/invites/${token}/accept`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/profile'] });
      queryClient.invalidateQueries({ queryKey: ['/api/profile/organization'] });
      toast.success('Einladung erfolgreich angenommen');
    },
    onError: (error) => {
      console.error('Accept invite error:', error);
      toast.error(error instanceof Error ? error.message : 'Fehler beim Annehmen der Einladung');
    },
  });
}

export function useDeleteInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (inviteId: string) => {
      await apiRequest('DELETE', `/api/invites/${inviteId}`, undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/invites'] });
      toast.success('Einladung widerrufen');
    },
    onError: (error) => {
      console.error('Delete invite error:', error);
      toast.error('Fehler beim Widerrufen der Einladung');
    },
  });
}
