import { Link } from 'react-router-dom';
import { Crown, Clock, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSubscriptionLimits } from '@/hooks/useSubscriptionLimits';

export function UserUpgradeBanner() {
  const { 
    isTrial, 
    isInactive, 
    trialDaysRemaining, 
    isTrialExpired 
  } = useSubscriptionLimits();

  if (!isTrial && !isInactive && !isTrialExpired) {
    return null;
  }

  if (isInactive || isTrialExpired) {
    return (
      <div 
        className="px-4 py-3 text-center bg-destructive/10 border-b border-destructive/20"
        data-testid="banner-upgrade-inactive"
      >
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span className="text-sm text-destructive font-medium">
            Ihre Testversion ist abgelaufen.
          </span>
          <Link to="/pricing">
            <Button size="sm" variant="destructive" data-testid="button-upgrade-banner">
              Jetzt upgraden
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (isTrial && trialDaysRemaining !== null) {
    return (
      <div 
        className="px-4 py-3 text-center bg-primary/10 border-b border-primary/20"
        data-testid="banner-upgrade-trial"
      >
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <Clock className="h-4 w-4 text-primary" />
          <span className="text-sm text-primary font-medium">
            Testversion: noch {trialDaysRemaining} {trialDaysRemaining === 1 ? 'Tag' : 'Tage'}
          </span>
          <Link to="/pricing">
            <Button size="sm" data-testid="button-upgrade-banner">
              <Crown className="mr-2 h-4 w-4" />
              Plan auswählen
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return null;
}
