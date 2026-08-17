import { useState, useCallback } from 'react';
import { useSubscriptionLimits, UserSubscriptionTier } from './useSubscriptionLimits';

type RequiredTier = 'starter' | 'pro';

interface FeatureGateResult {
  canAccess: boolean;
  checkAccess: () => boolean;
  showUpgradePopup: boolean;
  setShowUpgradePopup: (show: boolean) => void;
  currentTier: UserSubscriptionTier;
  requiredTier: RequiredTier;
}

const tierHierarchy: Record<UserSubscriptionTier, number> = {
  inactive: 0,
  trial: 1,
  starter: 2,
  pro: 3,
  enterprise: 4,
};

export function useFeatureGate(requiredTier: RequiredTier): FeatureGateResult {
  const { effectiveTier } = useSubscriptionLimits();
  const [showUpgradePopup, setShowUpgradePopup] = useState(false);

  const canAccess = tierHierarchy[effectiveTier] >= tierHierarchy[requiredTier];

  const checkAccess = useCallback(() => {
    if (!canAccess) {
      setShowUpgradePopup(true);
      return false;
    }
    return true;
  }, [canAccess]);

  return {
    canAccess,
    checkAccess,
    showUpgradePopup,
    setShowUpgradePopup,
    currentTier: effectiveTier,
    requiredTier,
  };
}

export function usePropertyLimit() {
  const { limits, effectiveTier } = useSubscriptionLimits();
  const [showUpgradePopup, setShowUpgradePopup] = useState(false);

  const checkLimit = useCallback((currentCount: number) => {
    if (currentCount >= limits.maxProperties) {
      setShowUpgradePopup(true);
      return false;
    }
    return true;
  }, [limits.maxProperties]);

  return {
    maxProperties: limits.maxProperties,
    checkLimit,
    showUpgradePopup,
    setShowUpgradePopup,
    currentTier: effectiveTier,
  };
}

export function useTenantLimit() {
  const { limits, effectiveTier } = useSubscriptionLimits();
  const [showUpgradePopup, setShowUpgradePopup] = useState(false);

  const checkLimit = useCallback((currentCount: number) => {
    if (currentCount >= limits.maxTenants) {
      setShowUpgradePopup(true);
      return false;
    }
    return true;
  }, [limits.maxTenants]);

  return {
    maxTenants: limits.maxTenants,
    checkLimit,
    showUpgradePopup,
    setShowUpgradePopup,
    currentTier: effectiveTier,
  };
}
