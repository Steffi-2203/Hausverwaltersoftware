import { useQuery } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { apiRequest } from '@/lib/queryClient';

export type UserSubscriptionTier = 'trial' | 'inactive' | 'starter' | 'pro' | 'enterprise';

interface SubscriptionLimits {
  maxProperties: number;
  maxUnits: number;
  maxTenants: number;
  maxOcrInvoices: number;
  maxOcrBankStatements: number;
  canExport: boolean;
  canUpload: boolean;
  canViewSettlements: boolean;
  canEditSettlements: boolean;
  canUseAutomation: boolean;
  canSendMessages: boolean;
  canViewReports: boolean;
  canManageOwners: boolean;
  canManageMeters: boolean;
  canManageKeys: boolean;
  canManageVpi: boolean;
  canManageBanking: boolean;
  canManageBudgets: boolean;
  canManageDunning: boolean;
  canManageMaintenance: boolean;
  canManageContractors: boolean;
  canManageInvoiceApproval: boolean;
  canManageTeam: boolean;
  canManageDocuments: boolean;
  canUseKiAutopilot: boolean;
  hasFullAccess: boolean;
}

const TIER_LIMITS: Record<UserSubscriptionTier, SubscriptionLimits> = {
  trial: {
    maxProperties: 1,
    maxUnits: 5,
    maxTenants: 5,
    maxOcrInvoices: 3,
    maxOcrBankStatements: 1,
    canExport: false,
    canUpload: true, // OCR Upload erlaubt
    canViewSettlements: true, // Abrechnungen ansehen
    canEditSettlements: false,
    canUseAutomation: false,
    canSendMessages: true, // Nachrichten senden erlaubt
    canViewReports: true, // Reports ansehen erlaubt
    canManageOwners: false,
    canManageMeters: false,
    canManageKeys: false,
    canManageVpi: false,
    canManageBanking: false,
    canManageBudgets: false,
    canManageDunning: false,
    canManageMaintenance: false,
    canManageContractors: false,
    canManageInvoiceApproval: false,
    canManageTeam: false,
    canManageDocuments: false,
    canUseKiAutopilot: false,
    hasFullAccess: false,
  },
  inactive: {
    maxProperties: 0,
    maxUnits: 0,
    maxTenants: 0,
    maxOcrInvoices: 0,
    maxOcrBankStatements: 0,
    canExport: false,
    canUpload: false,
    canViewSettlements: false,
    canEditSettlements: false,
    canUseAutomation: false,
    canSendMessages: false,
    canViewReports: false,
    canManageOwners: false,
    canManageMeters: false,
    canManageKeys: false,
    canManageVpi: false,
    canManageBanking: false,
    canManageBudgets: false,
    canManageDunning: false,
    canManageMaintenance: false,
    canManageContractors: false,
    canManageInvoiceApproval: false,
    canManageTeam: false,
    canManageDocuments: false,
    canUseKiAutopilot: false,
    hasFullAccess: false,
  },
  starter: {
    maxProperties: 10,
    maxUnits: 50,
    maxTenants: Infinity,
    maxOcrInvoices: Infinity,
    maxOcrBankStatements: Infinity,
    canExport: true,
    canUpload: true,
    canViewSettlements: true,
    canEditSettlements: true,
    canUseAutomation: false,
    canSendMessages: true,
    canViewReports: true,
    canManageOwners: true,
    canManageMeters: true,
    canManageKeys: true,
    canManageVpi: true,
    canManageBanking: true,
    canManageBudgets: true,
    canManageDunning: true,
    canManageMaintenance: true,
    canManageContractors: true,
    canManageInvoiceApproval: true,
    canManageTeam: true,
    canManageDocuments: true,
    canUseKiAutopilot: false,
    hasFullAccess: false,
  },
  pro: {
    maxProperties: Infinity,
    maxUnits: Infinity,
    maxTenants: Infinity,
    maxOcrInvoices: Infinity,
    maxOcrBankStatements: Infinity,
    canExport: true,
    canUpload: true,
    canViewSettlements: true,
    canEditSettlements: true,
    canUseAutomation: true,
    canSendMessages: true,
    canViewReports: true,
    canManageOwners: true,
    canManageMeters: true,
    canManageKeys: true,
    canManageVpi: true,
    canManageBanking: true,
    canManageBudgets: true,
    canManageDunning: true,
    canManageMaintenance: true,
    canManageContractors: true,
    canManageInvoiceApproval: true,
    canManageTeam: true,
    canManageDocuments: true,
    canUseKiAutopilot: false,
    hasFullAccess: true,
  },
  enterprise: {
    maxProperties: Infinity,
    maxUnits: Infinity,
    maxTenants: Infinity,
    maxOcrInvoices: Infinity,
    maxOcrBankStatements: Infinity,
    canExport: true,
    canUpload: true,
    canViewSettlements: true,
    canEditSettlements: true,
    canUseAutomation: true,
    canSendMessages: true,
    canViewReports: true,
    canManageOwners: true,
    canManageMeters: true,
    canManageKeys: true,
    canManageVpi: true,
    canManageBanking: true,
    canManageBudgets: true,
    canManageDunning: true,
    canManageMaintenance: true,
    canManageContractors: true,
    canManageInvoiceApproval: true,
    canManageTeam: true,
    canManageDocuments: true,
    canUseKiAutopilot: false,
    hasFullAccess: true,
  },
};

interface UserSubscriptionData {
  tier: UserSubscriptionTier;
  trialEndsAt: string | null;
  subscriptionEndsAt: string | null;
  trialDaysRemaining: number | null;
  isTrialExpired: boolean;
  isSubscriptionExpired: boolean;
}

export function useSubscriptionLimits() {
  const { user } = useAuth();

  const { data: subscriptionData, isLoading } = useQuery<UserSubscriptionData>({
    queryKey: ['/api/user/subscription'],
    queryFn: async () => {
      const response = await fetch('/api/user/subscription', {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch subscription');
      }
      return response.json();
    },
    enabled: !!user,
  });

  const tier: UserSubscriptionTier = subscriptionData?.tier || 'trial';
  const limits = TIER_LIMITS[tier];

  const trialEndsAt = subscriptionData?.trialEndsAt ? new Date(subscriptionData.trialEndsAt) : null;
  const subscriptionEndsAt = subscriptionData?.subscriptionEndsAt ? new Date(subscriptionData.subscriptionEndsAt) : null;
  
  const now = new Date();
  const trialDaysRemaining = trialEndsAt 
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : null;

  const isTrialExpired = tier === 'trial' && trialEndsAt ? trialEndsAt < now : false;
  const isSubscriptionExpired = subscriptionEndsAt ? subscriptionEndsAt < now : false;
  
  const effectiveTier: UserSubscriptionTier = isTrialExpired || isSubscriptionExpired ? 'inactive' : tier;
  const effectiveLimits = TIER_LIMITS[effectiveTier];

  const isTrial = tier === 'trial' && !isTrialExpired;
  const isInactive = effectiveTier === 'inactive';
  const isPaid = ['starter', 'pro', 'enterprise'].includes(effectiveTier);
  const isPro = effectiveTier === 'pro' || effectiveTier === 'enterprise';

  return {
    tier,
    effectiveTier,
    limits: effectiveLimits,
    trialEndsAt,
    subscriptionEndsAt,
    trialDaysRemaining,
    isTrialExpired,
    isSubscriptionExpired,
    isTrial,
    isInactive,
    isPaid,
    isPro,
    isLoading,
    canCreateProperty: (currentCount: number) => currentCount < effectiveLimits.maxProperties,
    canCreateUnit: (currentCount: number) => currentCount < effectiveLimits.maxUnits,
    canCreateTenant: (currentCount: number) => currentCount < effectiveLimits.maxTenants,
    canUploadOcrInvoice: (currentCount: number) => currentCount < effectiveLimits.maxOcrInvoices,
    canUploadOcrBankStatement: (currentCount: number) => currentCount < effectiveLimits.maxOcrBankStatements,
  };
}

export function useCanAccessFeature(feature: keyof SubscriptionLimits): boolean {
  const { limits } = useSubscriptionLimits();
  const value = limits[feature];
  return typeof value === 'boolean' ? value : value > 0;
}
