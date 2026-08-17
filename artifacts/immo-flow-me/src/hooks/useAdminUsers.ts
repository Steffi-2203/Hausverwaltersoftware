import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useIsAdmin } from '@/hooks/useAdmin';
import { toast } from 'sonner';
import { normalizeFields } from '@/utils/fieldNormalizer';

export type AppRole = 'admin' | 'property_manager' | 'finance' | 'viewer' | 'tester';

export interface AdminUser {
  user_id: string;
  email: string | null;
  full_name: string | null;
  organization_id: string | null;
  organization_name: string | null;
  role: AppRole | null;
  created_at: string;
}

function normalizeAdminUser(user: any) {
  return normalizeFields(user);
}

export function useAdminUsers() {
  const { data: isAdmin } = useIsAdmin();

  return useQuery({
    queryKey: ['admin-users'],
    queryFn: async (): Promise<AdminUser[]> => {
      const response = await fetch('/api/admin/users', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch admin users');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeAdminUser) : [normalizeAdminUser(data)];
    },
    enabled: !!isAdmin,
  });
}

export function useUpdateUserRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      await apiRequest('PUT', `/api/users/${userId}/role`, { role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('Rolle wurde aktualisiert');
    },
    onError: (error) => {
      console.error('Error updating role:', error);
      toast.error('Fehler beim Aktualisieren der Rolle');
    },
  });
}

export function useRemoveUserRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest('DELETE', `/api/users/${userId}/role`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('Rolle wurde entfernt');
    },
    onError: (error) => {
      console.error('Error removing role:', error);
      toast.error('Fehler beim Entfernen der Rolle');
    },
  });
}

export function useAdminUserStats() {
  const { data: users } = useAdminUsers();

  if (!users) {
    return {
      totalUsers: 0,
      adminCount: 0,
      financeCount: 0,
      managerCount: 0,
      viewerCount: 0,
      noRoleCount: 0,
    };
  }

  return {
    totalUsers: users.length,
    adminCount: users.filter(u => u.role === 'admin').length,
    financeCount: users.filter(u => u.role === 'finance').length,
    managerCount: users.filter(u => u.role === 'property_manager').length,
    viewerCount: users.filter(u => u.role === 'viewer').length,
    noRoleCount: users.filter(u => !u.role).length,
  };
}
