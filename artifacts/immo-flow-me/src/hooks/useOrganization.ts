import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '@/lib/queryClient';
import { normalizeFields } from '@/utils/fieldNormalizer';

export type SubscriptionTier = 'starter' | 'professional' | 'enterprise';
export type SubscriptionStatus = 'trial' | 'active' | 'cancelled' | 'expired';

export interface Organization {
  id: string;
  name: string;
  subscription_tier: SubscriptionTier;
  subscription_status: SubscriptionStatus;
  trial_ends_at: string | null;
  created_at: string;
  updated_at: string;
  iban: string | null;
  bic: string | null;
  sepa_creditor_id: string | null;
  // White-Label Branding
  brandName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  supportEmail: string | null;
}

export const TIER_LIMITS = {
  starter: { properties: 999, unitsPerProperty: 999 },
  professional: { properties: 999, unitsPerProperty: 999 },
  enterprise: { properties: 999, unitsPerProperty: 999 },
} as const;

export const TIER_LABELS: Record<SubscriptionTier, string> = {
  starter: 'Vollversion',
  professional: 'Vollversion',
  enterprise: 'Vollversion',
};

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trial: 'Aktiv',
  active: 'Aktiv',
  cancelled: 'Aktiv',
  expired: 'Aktiv',
};

function normalizeOrganization(org: any) {
  return normalizeFields(org);
}

export function useOrganization() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['organization', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const response = await fetch('/api/profile/organization', { credentials: 'include' });
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Failed to fetch organization');
      }
      const data = await response.json();
      return normalizeOrganization(data) as Organization;
    },
    enabled: !!user,
  });
}

interface PropertyUnitCount {
  propertyId: string;
  unitCount: number;
}

export function useSubscriptionLimits() {
  const { user } = useAuth();
  const { data: organization, isLoading: isLoadingOrg } = useOrganization();

  const { data: propertiesData, isLoading: isLoadingProperties } = useQuery({
    queryKey: ['properties_for_limits', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const response = await fetch('/api/properties', { credentials: 'include' });
      if (!response.ok) return [];
      const properties = await response.json();
      return properties.map((p: any) => p.id);
    },
    enabled: !!user,
  });

  const { data: unitsData, isLoading: isLoadingUnits } = useQuery({
    queryKey: ['units_for_limits', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const response = await fetch('/api/units', { credentials: 'include' });
      if (!response.ok) return [];
      const units = await response.json();
      
      const countByProperty: Record<string, number> = {};
      units?.forEach((unit: any) => {
        countByProperty[unit.propertyId] = (countByProperty[unit.propertyId] || 0) + 1;
      });
      
      return Object.entries(countByProperty).map(([propertyId, unitCount]) => ({
        propertyId,
        unitCount,
      })) as PropertyUnitCount[];
    },
    enabled: !!user,
  });

  const maxLimits = { properties: 999, unitsPerProperty: 999 };

  const currentUsage = useMemo(() => {
    const propertiesCount = propertiesData?.length || 0;
    const unitsPerProperty: Record<string, number> = {};
    
    unitsData?.forEach(item => {
      unitsPerProperty[item.propertyId] = item.unitCount;
    });

    propertiesData?.forEach(propertyId => {
      if (!(propertyId in unitsPerProperty)) {
        unitsPerProperty[propertyId] = 0;
      }
    });

    return {
      properties: propertiesCount,
      units: unitsPerProperty,
      totalUnits: Object.values(unitsPerProperty).reduce((sum, count) => sum + count, 0),
    };
  }, [propertiesData, unitsData]);

  const canAddProperty = true;
  const canAddUnit = useCallback((_propertyId: string): boolean => true, []);
  const getRemainingUnits = useCallback((_propertyId: string): number => 999, []);

  return {
    isLoading: isLoadingOrg || isLoadingProperties || isLoadingUnits,
    organization,
    subscriptionTier: 'enterprise' as SubscriptionTier,
    tierLabel: 'Vollversion',
    status: 'active' as SubscriptionStatus,
    statusLabel: 'Aktiv',
    trialEndsAt: null,
    trialDaysRemaining: 0,
    isTrialExpired: false,
    isTrialExpiringSoon: false,
    maxLimits,
    limits: maxLimits,
    currentUsage,
    canAddProperty,
    canAddUnit,
    getRemainingUnits,
    hasReachedPropertyLimit: false,
    getUnitLimitReached: (_propertyId: string) => false,
  };
}

export function calculateTrialDaysRemaining(_trialEndsAt: Date | null): number {
  return 0;
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      id: string;
      name?: string;
      iban?: string | null;
      bic?: string | null;
      sepa_creditor_id?: string | null;
      brandName?: string | null;
      logoUrl?: string | null;
      primaryColor?: string | null;
      supportEmail?: string | null;
    }) => {
      const response = await apiRequest('PATCH', `/api/organizations/${data.id}`, data);
      const result = await response.json();
      return normalizeOrganization(result);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization'] });
      toast.success('Organisation aktualisiert');
    },
    onError: (error) => {
      console.error('Error updating organization:', error);
      toast.error('Fehler beim Aktualisieren der Organisation');
    },
  });
}
