import { Link } from 'react-router-dom';
import { Lock, Crown, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { UserSubscriptionTier } from '@/hooks/useSubscriptionLimits';

interface FeatureLockPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  featureName: string;
  featureDescription?: string;
  requiredTier: 'starter' | 'pro';
}

const tierLabels: Record<string, string> = {
  starter: 'Starter (€39/Monat)',
  pro: 'Pro (€299/Monat)',
};

export function FeatureLockPopup({
  open,
  onOpenChange,
  featureName,
  featureDescription,
  requiredTier,
}: FeatureLockPopupProps) {
  const TierIcon = requiredTier === 'pro' ? Crown : Sparkles;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-feature-lock">
        <DialogHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Lock className="h-8 w-8 text-muted-foreground" />
          </div>
          <DialogTitle className="text-xl">{featureName}</DialogTitle>
          {featureDescription && (
            <DialogDescription className="text-base">
              {featureDescription}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="text-center space-y-4 py-4">
          <div className="flex items-center justify-center gap-2">
            <TierIcon className="h-5 w-5 text-primary" />
            <span className="font-medium">{tierLabels[requiredTier]} erforderlich</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Upgraden Sie Ihren Plan, um diese Funktion und viele weitere freizuschalten.
          </p>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2">
          <Button 
            variant="outline" 
            onClick={() => onOpenChange(false)}
            className="w-full sm:w-auto"
            data-testid="button-cancel-upgrade"
          >
            Später
          </Button>
          <Link to="/pricing" className="w-full sm:w-auto">
            <Button 
              className="w-full"
              data-testid="button-upgrade-now"
            >
              <Crown className="mr-2 h-4 w-4" />
              Jetzt upgraden
            </Button>
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface FeatureGateProps {
  children: React.ReactNode;
  requiredTier: 'starter' | 'pro';
  featureName: string;
  featureDescription?: string;
  currentTier: UserSubscriptionTier;
  fallback?: React.ReactNode;
}

const tierHierarchy: Record<UserSubscriptionTier, number> = {
  inactive: 0,
  trial: 1,
  starter: 2,
  pro: 3,
  enterprise: 4,
};

export function FeatureGate({
  children,
  requiredTier,
  featureName,
  featureDescription,
  currentTier,
  fallback,
}: FeatureGateProps) {
  const hasAccess = tierHierarchy[currentTier] >= tierHierarchy[requiredTier];

  if (hasAccess) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return (
    <div className="relative">
      <div className="opacity-50 pointer-events-none select-none">
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm rounded-lg">
        <div className="text-center p-4">
          <Lock className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="font-medium">{featureName}</p>
          <p className="text-sm text-muted-foreground mb-3">
            {tierLabels[requiredTier]} erforderlich
          </p>
          <Link to="/pricing">
            <Button size="sm" data-testid="button-upgrade-feature">
              Upgraden
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
