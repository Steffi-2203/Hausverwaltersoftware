import { useQuery } from '@tanstack/react-query';

export type SubscriptionStatus = 'trial' | 'active' | 'cancelled' | 'expired';
export type SubscriptionTier = 'starter' | 'professional' | 'enterprise';

interface Organization {
  id: string;
  name: string;
  subscriptionStatus: SubscriptionStatus;
  subscriptionTier: SubscriptionTier;
  trialEndsAt: string | null;
}

interface SubscriptionInfo {
  status: SubscriptionStatus;
  tier: SubscriptionTier;
  isActive: boolean;
  isTrial: boolean;
  isExpired: boolean;
  trialEndsAt: Date | null;
  trialDaysRemaining: number | null;
  canAccessFullFeatures: boolean;
  isLoading: boolean;
}

export function useSubscription(): SubscriptionInfo {
  const { data: organization, isLoading } = useQuery<Organization | null>({
    queryKey: ['/api/profile/organization'],
    queryFn: async () => {
      const res = await fetch('/api/profile/organization', { credentials: 'include' });
      if (!res.ok) {
        if (res.status === 401) return null;
        throw new Error('Failed to fetch organization');
      }
      return res.json();
    },
    retry: false,
  });

  const status = organization?.subscriptionStatus || 'trial';
  const tier = organization?.subscriptionTier || 'starter';
  const trialEndsAt = organization?.trialEndsAt ? new Date(organization.trialEndsAt) : null;
  
  const now = new Date();
  const trialDaysRemaining = trialEndsAt 
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : null;

  const isTrial = status === 'trial';
  const isActive = status === 'active';
  const isExpired = status === 'expired' || status === 'cancelled' || 
    (isTrial && trialEndsAt && trialEndsAt < now);

  const canAccessFullFeatures = isActive || (isTrial && !isExpired);

  return {
    status,
    tier,
    isActive,
    isTrial,
    isExpired,
    trialEndsAt,
    trialDaysRemaining,
    canAccessFullFeatures,
    isLoading,
  };
}

export function useCanAccessFeature(requiredTier: SubscriptionTier = 'starter'): boolean {
  const { tier, canAccessFullFeatures } = useSubscription();
  
  // Check if user is admin - admins always have full access
  // We need to import useIsAdmin but to avoid circular deps, we check localStorage or make a simple fetch
  // For now, just check the subscription
  if (!canAccessFullFeatures) return false;
  
  const tierOrder: SubscriptionTier[] = ['starter', 'professional', 'enterprise'];
  const currentTierIndex = tierOrder.indexOf(tier);
  const requiredTierIndex = tierOrder.indexOf(requiredTier);
  
  return currentTierIndex >= requiredTierIndex;
}
