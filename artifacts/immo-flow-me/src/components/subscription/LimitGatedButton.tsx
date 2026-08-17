import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, ButtonProps } from '@/components/ui/button';
import { FeatureLockPopup } from './FeatureLockPopup';
import { useSubscriptionLimits, UserSubscriptionTier } from '@/hooks/useSubscriptionLimits';

interface LimitGatedButtonProps extends Omit<ButtonProps, 'onClick'> {
  currentCount: number;
  limitType: 'properties' | 'tenants';
  featureName: string;
  featureDescription?: string;
  linkTo?: string;
  onClick?: () => void;
  children: React.ReactNode;
}

const tierHierarchy: Record<UserSubscriptionTier, number> = {
  inactive: 0,
  trial: 1,
  starter: 2,
  pro: 3,
  enterprise: 4,
};

export function LimitGatedButton({
  currentCount,
  limitType,
  featureName,
  featureDescription,
  linkTo,
  onClick,
  children,
  ...buttonProps
}: LimitGatedButtonProps) {
  const { limits, effectiveTier } = useSubscriptionLimits();
  const [showPopup, setShowPopup] = useState(false);

  const limit = limitType === 'properties' ? limits.maxProperties : limits.maxTenants;
  const isAtLimit = currentCount >= limit;

  const requiredTier = effectiveTier === 'trial' ? 'starter' : 'pro';

  const handleClick = () => {
    if (isAtLimit) {
      setShowPopup(true);
      return;
    }
    onClick?.();
  };

  if (isAtLimit) {
    return (
      <>
        <Button {...buttonProps} onClick={handleClick} data-testid={`button-${limitType}-limit`}>
          {children}
        </Button>
        <FeatureLockPopup
          open={showPopup}
          onOpenChange={setShowPopup}
          featureName={featureName}
          featureDescription={featureDescription || `Sie haben das Limit von ${limit} ${limitType === 'properties' ? 'Immobilien' : 'Mietern'} erreicht.`}
          requiredTier={requiredTier}
        />
      </>
    );
  }

  if (linkTo) {
    return (
      <Link to={linkTo}>
        <Button {...buttonProps} onClick={onClick}>
          {children}
        </Button>
      </Link>
    );
  }

  return (
    <Button {...buttonProps} onClick={onClick}>
      {children}
    </Button>
  );
}

interface FeatureGatedButtonProps extends Omit<ButtonProps, 'onClick'> {
  featureKey: 'canExport' | 'canUpload' | 'canEditSettlements' | 'canUseAutomation';
  featureName: string;
  featureDescription?: string;
  onClick?: () => void;
  children: React.ReactNode;
}

export function FeatureGatedButton({
  featureKey,
  featureName,
  featureDescription,
  onClick,
  children,
  ...buttonProps
}: FeatureGatedButtonProps) {
  const { limits, effectiveTier } = useSubscriptionLimits();
  const [showPopup, setShowPopup] = useState(false);

  const hasAccess = limits[featureKey];

  const requiredTier: 'starter' | 'pro' = featureKey === 'canUseAutomation' ? 'pro' : 'starter';

  const handleClick = () => {
    if (!hasAccess) {
      setShowPopup(true);
      return;
    }
    onClick?.();
  };

  return (
    <>
      <Button {...buttonProps} onClick={handleClick} data-testid={`button-${featureKey}`}>
        {children}
      </Button>
      <FeatureLockPopup
        open={showPopup}
        onOpenChange={setShowPopup}
        featureName={featureName}
        featureDescription={featureDescription}
        requiredTier={requiredTier}
      />
    </>
  );
}
