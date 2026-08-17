import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';

interface OrgMembership {
  id: string;
  organization_id: string;
  role: string;
  is_default: boolean;
  organization: {
    id: string;
    name: string;
  };
}

interface ActiveOrganizationContextValue {
  activeOrgId: string | null;
  activeOrgName: string | null;
  organizations: OrgMembership[];
  isLoading: boolean;
  switchOrganization: (orgId: string) => void;
}

const ActiveOrganizationContext = createContext<ActiveOrganizationContextValue>({
  activeOrgId: null,
  activeOrgName: null,
  organizations: [],
  isLoading: true,
  switchOrganization: () => {},
});

export function ActiveOrganizationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeOrgId, setActiveOrgId] = useState<string | null>(() => {
    return localStorage.getItem('activeOrgId');
  });

  const { data: memberships = [], isLoading } = useQuery({
    queryKey: ['user-organizations', user?.id],
    queryFn: async () => {
      if (!user) return [];

      const response = await fetch('/api/user-organizations', { credentials: 'include' });
      if (!response.ok) {
        console.error('Error fetching user organizations');
        return [];
      }
      const data = await response.json();

      return (data || []).map((d: any) => ({
        id: d.id,
        organization_id: d.organization_id,
        role: d.role,
        is_default: d.is_default,
        organization: d.organization || { id: d.organization_id, name: '' },
      })) as OrgMembership[];
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (memberships.length === 0) return;

    const stored = localStorage.getItem('activeOrgId');
    const validStored = memberships.find(m => m.organization_id === stored);

    if (validStored) {
      setActiveOrgId(validStored.organization_id);
    } else {
      const defaultOrg = memberships.find(m => m.is_default) || memberships[0];
      setActiveOrgId(defaultOrg.organization_id);
      localStorage.setItem('activeOrgId', defaultOrg.organization_id);
    }
  }, [memberships]);

  const switchOrganization = useCallback((orgId: string) => {
    setActiveOrgId(orgId);
    localStorage.setItem('activeOrgId', orgId);
    queryClient.invalidateQueries();
  }, [queryClient]);

  const activeOrgName = memberships.find(m => m.organization_id === activeOrgId)?.organization?.name || null;

  return (
    <ActiveOrganizationContext.Provider
      value={{
        activeOrgId,
        activeOrgName,
        organizations: memberships,
        isLoading,
        switchOrganization,
      }}
    >
      {children}
    </ActiveOrganizationContext.Provider>
  );
}

export function useActiveOrganization() {
  return useContext(ActiveOrganizationContext);
}
