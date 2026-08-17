import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';
import { toast } from 'sonner';
import { normalizeFields } from '@/utils/fieldNormalizer';

type AppRole = 'admin' | 'property_manager' | 'finance' | 'viewer';

export interface TeamMember {
  id: string;
  email: string | null;
  full_name: string | null;
  role: AppRole | null;
  created_at: string;
  assignedPropertiesCount: number;
}

function normalizeTeamMember(member: any) {
  return normalizeFields(member);
}

export function useTeamMembers() {
  const { user } = useAuth();
  const { data: organization } = useOrganization();

  return useQuery({
    queryKey: ['team-members', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const response = await fetch(`/api/organizations/${organization.id}/team-members`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch team members');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeTeamMember) : [normalizeTeamMember(data)] as TeamMember[];
    },
    enabled: !!organization?.id && !!user?.id,
  });
}

export function useTeamStats() {
  const { data: teamMembers } = useTeamMembers();

  const stats = {
    total: teamMembers?.length || 0,
    admins: teamMembers?.filter(m => m.role === 'admin').length || 0,
    propertyManagers: teamMembers?.filter(m => m.role === 'property_manager').length || 0,
    finance: teamMembers?.filter(m => m.role === 'finance').length || 0,
    viewers: teamMembers?.filter(m => m.role === 'viewer').length || 0,
    noRole: teamMembers?.filter(m => !m.role).length || 0,
  };

  return stats;
}

export function useUpdateTeamMemberRole() {
  const queryClient = useQueryClient();
  const { data: organization } = useOrganization();

  return useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: AppRole }) => {
      const response = await apiRequest('PUT', `/api/users/${userId}/role`, { role: newRole });
      const data = await response.json();
      return normalizeTeamMember(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-members', organization?.id] });
      toast.success('Rolle erfolgreich aktualisiert');
    },
    onError: (error) => {
      console.error('Error updating role:', error);
      toast.error('Fehler beim Aktualisieren der Rolle');
    },
  });
}

export function useRemoveTeamMemberRole() {
  const queryClient = useQueryClient();
  const { data: organization } = useOrganization();

  return useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest('DELETE', `/api/users/${userId}/role`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-members', organization?.id] });
      toast.success('Rolle erfolgreich entfernt');
    },
    onError: (error) => {
      console.error('Error removing role:', error);
      toast.error('Fehler beim Entfernen der Rolle');
    },
  });
}
