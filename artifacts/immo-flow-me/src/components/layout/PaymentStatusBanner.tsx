import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CreditCard, XCircle, Clock, Lock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

type PaymentStatus = 'active' | 'past_due' | 'canceled' | 'unpaid';

interface UserProfile {
  paymentStatus?: PaymentStatus;
  paymentFailedAt?: string;
  canceledAt?: string;
  subscriptionTier?: string;
}

export type PaymentPhase = 'active' | 'grace_period' | 'soft_lock' | 'hard_lock' | 'canceled';

export function calculatePaymentPhase(
  paymentStatus: PaymentStatus | undefined,
  paymentFailedAt: string | undefined
): { phase: PaymentPhase; daysSinceFailed: number } {
  if (!paymentStatus || paymentStatus === 'active') {
    return { phase: 'active', daysSinceFailed: 0 };
  }

  if (paymentStatus === 'canceled' || paymentStatus === 'unpaid') {
    return { phase: 'canceled', daysSinceFailed: 0 };
  }

  if (paymentStatus === 'past_due') {
    if (!paymentFailedAt) {
      return { phase: 'grace_period', daysSinceFailed: 0 };
    }
    const failedDate = new Date(paymentFailedAt);
    const now = new Date();
    const daysSinceFailed = Math.floor((now.getTime() - failedDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceFailed <= 3) {
      return { phase: 'grace_period', daysSinceFailed };
    } else if (daysSinceFailed <= 14) {
      return { phase: 'soft_lock', daysSinceFailed };
    } else {
      return { phase: 'hard_lock', daysSinceFailed };
    }
  }

  return { phase: 'active', daysSinceFailed: 0 };
}

export function checkFeatureAccess(
  paymentStatus: PaymentStatus | undefined,
  paymentFailedAt: string | undefined,
  featureType: 'read' | 'write' | 'full'
): boolean {
  const { phase } = calculatePaymentPhase(paymentStatus, paymentFailedAt);

  switch (phase) {
    case 'active':
      return true;
    case 'grace_period':
      return true;
    case 'soft_lock':
      return featureType === 'read';
    case 'hard_lock':
      return false;
    case 'canceled':
      return false;
    default:
      return false;
  }
}

async function fetchUserProfile(): Promise<UserProfile | null> {
  const response = await fetch('/api/auth/user', { credentials: 'include' });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('Failed to fetch user');
  return response.json();
}

export function usePaymentPhase() {
  const { data: profile } = useQuery<UserProfile | null>({
    queryKey: ['/api/auth/user'],
    queryFn: fetchUserProfile,
  });

  const paymentStatus = profile?.paymentStatus;
  const paymentFailedAt = profile?.paymentFailedAt;

  const { phase, daysSinceFailed } = calculatePaymentPhase(paymentStatus, paymentFailedAt);

  const canRead = checkFeatureAccess(paymentStatus, paymentFailedAt, 'read');
  const canWrite = checkFeatureAccess(paymentStatus, paymentFailedAt, 'write');
  const canFull = checkFeatureAccess(paymentStatus, paymentFailedAt, 'full');

  const daysUntilSoftLock = phase === 'grace_period' ? 3 - daysSinceFailed : 0;
  const daysUntilHardLock = phase === 'soft_lock' ? 14 - daysSinceFailed : (phase === 'grace_period' ? 14 - daysSinceFailed : 0);

  return {
    phase,
    daysSinceFailed,
    daysUntilSoftLock,
    daysUntilHardLock,
    canRead,
    canWrite,
    canFull,
    paymentStatus,
  };
}

export function PaymentStatusBanner() {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);

  const { data: profile } = useQuery<UserProfile | null>({
    queryKey: ['/api/auth/user'],
    queryFn: fetchUserProfile,
  });

  const paymentStatus = profile?.paymentStatus;
  const paymentFailedAt = profile?.paymentFailedAt;
  const subscriptionTier = profile?.subscriptionTier;

  const phaseResult = calculatePaymentPhase(paymentStatus, paymentFailedAt);
  const phase = phaseResult.phase;
  const daysSinceFailed = phaseResult.daysSinceFailed;
  const daysUntilSoftLock = phase === 'grace_period' ? Math.max(0, 3 - daysSinceFailed) : 0;
  const daysUntilHardLock = phase === 'soft_lock' ? Math.max(0, 14 - daysSinceFailed) : (phase === 'grace_period' ? Math.max(0, 14 - daysSinceFailed) : 0);

  if (dismissed || phase === 'active') {
    return null;
  }

  if (subscriptionTier === 'trial' || subscriptionTier === 'inactive') {
    return null;
  }

  const handleManageSubscription = async () => {
    try {
      const response = await fetch('/api/stripe/create-portal-session', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error('Failed to open billing portal:', error);
    }
  };

  if (phase === 'grace_period') {
    return (
      <Alert className="mx-4 mt-4 mb-0 border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900">
        <Clock className="h-4 w-4 text-amber-600" />
        <AlertTitle data-testid="text-payment-grace-title" className="text-amber-900 dark:text-amber-100">
          Zahlungserinnerung
        </AlertTitle>
        <AlertDescription data-testid="text-payment-grace-message" className="text-amber-800 dark:text-amber-200">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Ihre letzte Zahlung konnte nicht verarbeitet werden. 
              Sie haben noch <strong>{daysUntilSoftLock} Tag(e)</strong> um Ihre Zahlungsdaten zu aktualisieren.
            </span>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleManageSubscription}
              data-testid="button-update-payment-grace"
            >
              <CreditCard className="mr-2 h-4 w-4" />
              Zahlung aktualisieren
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  if (phase === 'soft_lock') {
    return (
      <Alert variant="destructive" className="mx-4 mt-4 mb-0">
        <Lock className="h-4 w-4" />
        <AlertTitle data-testid="text-payment-softlock-title">
          Eingeschränkter Zugriff
        </AlertTitle>
        <AlertDescription data-testid="text-payment-softlock-message">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Ihre Zahlung ist seit {daysSinceFailed} Tagen überfällig. 
              <strong> Nur Lesezugriff aktiv.</strong> Schreibzugriff wird in {Math.max(0, daysUntilHardLock)} Tag(en) gesperrt.
            </span>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleManageSubscription}
              data-testid="button-update-payment-softlock"
            >
              <CreditCard className="mr-2 h-4 w-4" />
              Jetzt bezahlen
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  if (phase === 'hard_lock') {
    return (
      <Alert variant="destructive" className="mx-4 mt-4 mb-0">
        <XCircle className="h-4 w-4" />
        <AlertTitle data-testid="text-payment-hardlock-title">
          Account gesperrt
        </AlertTitle>
        <AlertDescription data-testid="text-payment-hardlock-message">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Ihre Zahlung ist seit {daysSinceFailed} Tagen überfällig. 
              <strong> Ihr Account ist vollständig gesperrt.</strong> Daten werden nach 30 Tagen gelöscht.
            </span>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => navigate('/api/functions/export-user-data')}
                data-testid="button-export-data"
              >
                Daten exportieren
              </Button>
              <Button 
                variant="default" 
                size="sm" 
                onClick={handleManageSubscription}
                data-testid="button-update-payment-hardlock"
              >
                <CreditCard className="mr-2 h-4 w-4" />
                Jetzt reaktivieren
              </Button>
            </div>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  if (phase === 'canceled') {
    return (
      <Alert variant="destructive" className="mx-4 mt-4 mb-0">
        <XCircle className="h-4 w-4" />
        <AlertTitle data-testid="text-subscription-canceled-title">Abonnement beendet</AlertTitle>
        <AlertDescription data-testid="text-subscription-canceled-message">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Ihr Abonnement wurde aufgrund nicht bezahlter Rechnungen gekündigt.
              Einige Funktionen sind eingeschränkt.
            </span>
            <Button 
              variant="default" 
              size="sm" 
              onClick={() => navigate('/pricing')}
              data-testid="button-resubscribe"
            >
              Erneut abonnieren
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}
