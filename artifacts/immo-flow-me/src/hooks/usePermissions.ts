import { useQuery } from '@tanstack/react-query';

interface Permissions {
  canViewFinances: boolean;
  canEditFinances: boolean;
  canViewFullTenantData: boolean;
  canManageMaintenance: boolean;
  canApproveInvoices: boolean;
  canSendMessages: boolean;
  canManageUsers: boolean;
  role: string | null;
  isAdmin: boolean;
  isPropertyManager: boolean;
  isFinance: boolean;
  isViewer: boolean;
  isTester: boolean;
  isLoading: boolean;
}

interface ProfileWithRoles {
  id: string;
  email: string;
  fullName: string;
  organizationId: string | null;
  roles: string[];
}

export function usePermissions(): Permissions {
  const { data: profile, isLoading } = useQuery<ProfileWithRoles>({
    queryKey: ['/api/profile'],
    queryFn: async () => {
      const res = await fetch('/api/profile', { credentials: 'include' });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return null;
        }
        throw new Error('Failed to fetch profile');
      }
      return res.json();
    },
    retry: false,
  });

  const roles = profile?.roles || [];
  const primaryRole = roles[0] || null;
  
  const isAdmin = roles.includes('admin');
  const isPropertyManager = roles.includes('property_manager');
  const isFinance = roles.includes('finance');
  const isViewer = roles.includes('viewer');
  const isTester = roles.includes('tester');

  if (isAdmin) {
    return {
      canViewFinances: true,
      canEditFinances: true,
      canViewFullTenantData: true,
      canManageMaintenance: true,
      canApproveInvoices: true,
      canSendMessages: true,
      canManageUsers: true,
      role: 'admin',
      isAdmin: true,
      isPropertyManager: false,
      isFinance: false,
      isViewer: false,
      isTester: false,
      isLoading,
    };
  }

  if (isPropertyManager) {
    return {
      canViewFinances: false,
      canEditFinances: false,
      canViewFullTenantData: true,
      canManageMaintenance: true,
      canApproveInvoices: true,
      canSendMessages: true,
      canManageUsers: false,
      role: 'property_manager',
      isAdmin: false,
      isPropertyManager: true,
      isFinance: false,
      isViewer: false,
      isTester: false,
      isLoading,
    };
  }

  if (isFinance) {
    return {
      canViewFinances: true,
      canEditFinances: true,
      canViewFullTenantData: true,
      canManageMaintenance: false,
      canApproveInvoices: true,
      canSendMessages: false,
      canManageUsers: false,
      role: 'finance',
      isAdmin: false,
      isPropertyManager: false,
      isFinance: true,
      isViewer: false,
      isTester: false,
      isLoading,
    };
  }

  if (isTester) {
    return {
      canViewFinances: true,
      canEditFinances: false,
      canViewFullTenantData: false,
      canManageMaintenance: false, // Gesperrt für Tester
      canApproveInvoices: false,
      canSendMessages: true, // Nachrichten erlaubt für Tester
      canManageUsers: false,
      role: 'tester',
      isAdmin: false,
      isPropertyManager: false,
      isFinance: false,
      isViewer: false,
      isTester: true,
      isLoading,
    };
  }

  return {
    canViewFinances: false,
    canEditFinances: false,
    canViewFullTenantData: false,
    canManageMaintenance: false,
    canApproveInvoices: false,
    canSendMessages: false,
    canManageUsers: false,
    role: primaryRole,
    isAdmin: false,
    isPropertyManager: false,
    isFinance: false,
    isViewer: true,
    isTester: false,
    isLoading,
  };
}
