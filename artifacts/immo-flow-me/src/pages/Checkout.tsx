import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Crown, Sparkles, ArrowLeft, Loader2, CheckCircle, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

type PlanId = 'starter' | 'pro' | 'ki-autopilot';

interface PlanDetails {
  id: PlanId;
  name: string;
  price: string;
  priceDetail: string;
  features: string[];
  icon: typeof Crown;
}

const planDetails: Record<PlanId, PlanDetails> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    price: '€39',
    priceDetail: 'pro Monat',
    features: [
      'Bis zu 50 Immobilien',
      'Unbegrenzte Mieter',
      'SEPA-Export',
      'Dokumente hochladen',
      'Berichte exportieren',
      'Betriebskostenabrechnung',
    ],
    icon: Sparkles,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: '€299',
    priceDetail: 'pro Monat',
    features: [
      'Unbegrenzte Immobilien',
      'Unbegrenzte Mieter',
      'Alle Starter-Features',
      'Automatische Mahnungen',
      'Automatische Vorschreibungen',
      'API-Zugang',
      'Prioritäts-Support',
    ],
    icon: Crown,
  },
  'ki-autopilot': {
    id: 'ki-autopilot',
    name: 'KI-Autopilot',
    price: '€99',
    priceDetail: 'pro Monat',
    features: [
      'KI-Assistent (Chat)',
      'Auto-Vorschreibung & Mahnlauf',
      'KI-Rechnungserkennung',
      'Anomalieerkennung & Insights',
      'KI-Kommunikationsassistent',
    ],
    icon: Bot,
  },
};

export default function Checkout() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const planId = searchParams.get('plan') as PlanId | null;
  const sessionId = searchParams.get('session_id');

  useEffect(() => {
    if (sessionId) {
      setSuccess(true);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/login?redirect=/checkout?plan=' + planId);
    }
  }, [user, loading, navigate, planId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!planId || !planDetails[planId]) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md w-full mx-4">
          <CardHeader className="text-center">
            <CardTitle>Plan nicht gefunden</CardTitle>
            <CardDescription>Bitte wählen Sie einen gültigen Plan.</CardDescription>
          </CardHeader>
          <CardFooter>
            <Link to="/pricing" className="w-full">
              <Button className="w-full" data-testid="button-back-pricing">
                Zurück zur Preisübersicht
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md w-full mx-4" data-testid="card-checkout-success">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <CardTitle className="text-2xl">Vielen Dank!</CardTitle>
            <CardDescription className="text-base">
              Ihr {planDetails[planId].name}-Abo wurde erfolgreich aktiviert.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center text-muted-foreground">
            <p>Sie haben jetzt vollen Zugang zu allen {planDetails[planId].name}-Features.</p>
          </CardContent>
          <CardFooter>
            <Link to="/dashboard" className="w-full">
              <Button className="w-full" data-testid="button-go-dashboard">
                Zum Dashboard
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  const plan = planDetails[planId];
  const Icon = plan.icon;

  const handleCheckout = async () => {
    if (!user) {
      navigate('/login?redirect=/checkout?plan=' + planId);
      return;
    }
    
    setIsLoading(true);
    try {
      const endpoint = plan.id === 'ki-autopilot' ? '/api/stripe/ki-autopilot-checkout' : '/api/stripe/checkout';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ planId: plan.id }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 401) {
          navigate('/login?redirect=/checkout?plan=' + planId);
          return;
        }
        throw new Error(errorData.error || 'Checkout failed');
      }
      
      const data = await response.json();
      
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No checkout URL received');
      }
    } catch (error) {
      console.error('Checkout error:', error);
      toast({
        title: 'Fehler',
        description: 'Checkout konnte nicht gestartet werden. Bitte versuchen Sie es erneut.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12">
        <Link to="/pricing" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="h-4 w-4" />
          Zurück zur Preisübersicht
        </Link>

        <div className="max-w-lg mx-auto">
          <Card data-testid="card-checkout">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <Icon className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="text-2xl">{plan.name}</CardTitle>
              <div className="mt-2">
                <span className="text-4xl font-bold">{plan.price}</span>
                <span className="text-muted-foreground ml-2">{plan.priceDetail}</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="font-medium mb-3">Enthaltene Features:</h3>
                <ul className="space-y-2">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2 text-sm">
                      <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border-t pt-4">
                <div className="flex justify-between items-center mb-4">
                  <span className="font-medium">Monatliche Zahlung</span>
                  <span className="text-xl font-bold">{plan.price}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Sie werden zu Stripe weitergeleitet, um die Zahlung abzuschließen.
                  Das Abo kann jederzeit gekündigt werden.
                </p>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button 
                className="w-full" 
                size="lg"
                onClick={handleCheckout}
                disabled={isLoading}
                data-testid="button-checkout-stripe"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Wird geladen...
                  </>
                ) : (
                  <>
                    <Crown className="mr-2 h-4 w-4" />
                    Jetzt abonnieren
                  </>
                )}
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                Sichere Zahlung über Stripe. AGB und Datenschutz gelten.
              </p>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
