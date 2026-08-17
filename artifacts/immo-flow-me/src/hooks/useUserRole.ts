import { useQuery } from '@tanstack/react-query';

export type AppRole = 'admin' | 'property_manager' | 'finance' | 'viewer';

export function useUserRole() {
  return useQuery({
    queryKey: ['user-role'],
    queryFn: async () => {
      const response = await fetch('/api/user/role', { credentials: 'include' });
      if (!response.ok) {
        console.error('Error fetching user role');
        return 'viewer' as AppRole;
      }
      const data = await response.json();
      return (data?.role as AppRole) ?? 'viewer';
    },
  });
}

export function useHasFinanceAccess() {
  const { data: role, isLoading } = useUserRole();
  return {
    hasAccess: role === 'admin' || role === 'finance',
    isLoading,
  };
}

export function useIsAdmin() {
  const { data: role, isLoading } = useUserRole();
  return {
    isAdmin: role === 'admin',
    isLoading,
  };
}

export function useIsTester() {
  const { data: role, isLoading } = useUserRole();
  return {
    isTester: role === ('tester' as AppRole),
    isLoading,
  };
}
