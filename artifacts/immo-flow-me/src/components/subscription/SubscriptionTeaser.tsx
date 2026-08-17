import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Lock, Sparkles, Crown, Zap } from 'lucide-react';
import { useSubscription, SubscriptionTier } from '@/hooks/useSubscription';
import { Link } from 'react-router-dom';

interface SubscriptionTeaserProps {
  feature: string;
  description?: string;
  requiredTier?: SubscriptionTier;
  children?: React.ReactNode;
}

export function SubscriptionTeaser({ 
  feature, 
  description,
  requiredTier = 'starter',
  children 
}: SubscriptionTeaserProps) {
  const { canAccessFullFeatures, isTrial, trialDaysRemaining, isExpired, tier } = useSubscription();

  const tierOrder: SubscriptionTier[] = ['starter', 'professional', 'enterprise'];
  const currentTierIndex = tierOrder.indexOf(tier);
  const requiredTierIndex = tierOrder.indexOf(requiredTier);
  const hasRequiredTier = currentTierIndex >= requiredTierIndex;

  if (canAccessFullFeatures && hasRequiredTier) {
    return <>{children}</>;
  }

  const tierLabels: Record<SubscriptionTier, string> = {
    starter: 'Starter',
    professional: 'Professional',
    enterprise: 'Enterprise',
  };

  const TierIcon = requiredTier === 'enterprise' ? Crown : requiredTier === 'professional' ? Sparkles : Zap;

  return (
    <Card className="border-dashed border-2 border-muted-foreground/30 bg-muted/20">
      <CardHeader className="text-center pb-2">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <Lock className="h-8 w-8 text-muted-foreground" />
        </div>
        <CardTitle className="text-xl">{feature}</CardTitle>
        {description && (
          <CardDescription className="text-base">{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="text-center space-y-4">
        {isExpired ? (
          <div className="space-y-2">
            <Badge variant="destructive" className="text-sm">
              Abo abgelaufen
            </Badge>
            <p className="text-sm text-muted-foreground">
              Erneuern Sie Ihr Abo, um wieder vollen Zugriff zu erhalten.
            </p>
          </div>
        ) : isTrial ? (
          <div className="space-y-2">
            <Badge variant="secondary" className="text-sm">
              Testversion - noch {trialDaysRemaining} Tage
            </Badge>
            <p className="text-sm text-muted-foreground">
              Diese Funktion erfordert ein {tierLabels[requiredTier]} Abo.
            </p>
          </div>
        ) : !hasRequiredTier ? (
          <div className="space-y-2">
            <Badge className="gap-1">
              <TierIcon className="h-3 w-3" />
              {tierLabels[requiredTier]} erforderlich
            </Badge>
            <p className="text-sm text-muted-foreground">
              Upgraden Sie auf {tierLabels[requiredTier]}, um diese Funktion freizuschalten.
            </p>
          </div>
        ) : null}

        <Link to="/einstellungen?tab=subscription">
          <Button className="w-full">
            <Sparkles className="mr-2 h-4 w-4" />
            {isExpired ? 'Abo erneuern' : hasRequiredTier ? 'Jetzt upgraden' : `Auf ${tierLabels[requiredTier]} upgraden`}
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

export function TrialBanner() {
  const { isTrial, trialDaysRemaining, isExpired } = useSubscription();

  if (!isTrial && !isExpired) return null;

  return (
    <div className={`px-4 py-2 text-center text-sm ${isExpired ? 'bg-destructive text-destructive-foreground' : 'bg-primary/10 text-primary'}`}>
      {isExpired ? (
        <span>
          Ihre Testversion ist abgelaufen. {' '}
          <Link to="/einstellungen?tab=subscription" className="underline font-medium">
            Jetzt upgraden
          </Link>
        </span>
      ) : (
        <span>
          Testversion: noch {trialDaysRemaining} Tage. {' '}
          <Link to="/einstellungen?tab=subscription" className="underline font-medium">
            Jetzt Abo abschließen
          </Link>
        </span>
      )}
    </div>
  );
}
