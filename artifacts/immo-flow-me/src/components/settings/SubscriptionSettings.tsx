import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Crown, Sparkles, Zap, ExternalLink, Loader2 } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import { useToast } from '@/hooks/use-toast';
import { useMutation } from '@tanstack/react-query';

interface PlanFeature {
  name: string;
  starter: boolean | string;
  professional: boolean | string;
  enterprise: boolean | string;
}

const planFeatures: PlanFeature[] = [
  { name: 'Liegenschaften', starter: '5', professional: '25', enterprise: 'Unbegrenzt' },
  { name: 'Einheiten', starter: '20', professional: '100', enterprise: 'Unbegrenzt' },
  { name: 'Benutzer', starter: '2', professional: '5', enterprise: 'Unbegrenzt' },
  { name: 'Vorschreibungen', starter: true, professional: true, enterprise: true },
  { name: 'Zahlungsverwaltung', starter: true, professional: true, enterprise: true },
  { name: 'BK-Abrechnung', starter: true, professional: true, enterprise: true },
  { name: 'SEPA-Export', starter: false, professional: true, enterprise: true },
  { name: 'Mahnwesen', starter: false, professional: true, enterprise: true },
  { name: 'Wartungsverträge', starter: false, professional: true, enterprise: true },
  { name: 'OCR-Belegerfassung', starter: false, professional: true, enterprise: true },
  { name: 'API-Zugang', starter: false, professional: false, enterprise: true },
  { name: 'Priority Support', starter: false, professional: false, enterprise: true },
];

const prices = {
  starter: { monthly: 39, yearly: 390 },
  professional: { monthly: 299, yearly: 2990 },
  enterprise: { monthly: 399, yearly: 3990 },
};

export function SubscriptionSettings() {
  const { status, tier, isTrial, trialDaysRemaining, isActive, isExpired } = useSubscription();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly');
  const [selectedTier, setSelectedTier] = useState<string | null>(null);

  const success = searchParams.get('success');
  const cancelled = searchParams.get('cancelled');

  const checkoutMutation = useMutation({
    mutationFn: async (tier: string) => {
      const res = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tier, interval }),
      });
      if (!res.ok) throw new Error('Failed to create checkout session');
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: () => {
      toast({
        title: 'Fehler',
        description: 'Checkout konnte nicht gestartet werden.',
        variant: 'destructive',
      });
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/stripe/create-portal-session', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to create portal session');
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: () => {
      toast({
        title: 'Fehler',
        description: 'Portal konnte nicht geöffnet werden.',
        variant: 'destructive',
      });
    },
  });

  const handleSubscribe = (tier: string) => {
    setSelectedTier(tier);
    checkoutMutation.mutate(tier);
  };

  return (
    <div className="space-y-6">
      {success && (
        <Card className="border-green-500 bg-green-50 dark:bg-green-950/20">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <Check className="h-5 w-5" />
              <span className="font-medium">Zahlung erfolgreich! Ihr Abo ist jetzt aktiv.</span>
            </div>
          </CardContent>
        </Card>
      )}

      {cancelled && (
        <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20">
          <CardContent className="pt-6">
            <div className="text-yellow-700 dark:text-yellow-400">
              Checkout wurde abgebrochen. Sie können jederzeit erneut ein Abo abschließen.
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Aktueller Plan
          </CardTitle>
          <CardDescription>Ihr aktueller Abonnementstatus</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold capitalize">{tier}</span>
                <Badge variant={isActive ? 'default' : isTrial ? 'secondary' : 'destructive'}>
                  {isActive ? 'Aktiv' : isTrial ? 'Testversion' : isExpired ? 'Abgelaufen' : status}
                </Badge>
              </div>
              {isTrial && trialDaysRemaining !== null && (
                <p className="text-sm text-muted-foreground mt-1">
                  Noch {trialDaysRemaining} Tage in der Testversion
                </p>
              )}
            </div>
            {isActive && (
              <Button variant="outline" onClick={() => portalMutation.mutate()} disabled={portalMutation.isPending}>
                {portalMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4 mr-2" />}
                Abo verwalten
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-center gap-4 py-4">
        <Button
          variant={interval === 'monthly' ? 'default' : 'outline'}
          onClick={() => setInterval('monthly')}
          size="sm"
        >
          Monatlich
        </Button>
        <Button
          variant={interval === 'yearly' ? 'default' : 'outline'}
          onClick={() => setInterval('yearly')}
          size="sm"
        >
          Jährlich
          <Badge variant="secondary" className="ml-2">-17%</Badge>
        </Button>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <Card className={tier === 'starter' && isActive ? 'border-primary' : ''}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-blue-500" />
              <CardTitle>Starter</CardTitle>
            </div>
            <CardDescription>Für kleine Hausverwaltungen</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <span className="text-3xl font-bold">{prices.starter[interval]}€</span>
              <span className="text-muted-foreground">/{interval === 'monthly' ? 'Monat' : 'Jahr'}</span>
            </div>
            <ul className="space-y-2">
              {planFeatures.map((feature) => (
                <li key={feature.name} className="flex items-center gap-2 text-sm">
                  {feature.starter ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <span className="h-4 w-4" />
                  )}
                  <span className={!feature.starter ? 'text-muted-foreground line-through' : ''}>
                    {feature.name}
                    {typeof feature.starter === 'string' && ` (${feature.starter})`}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Button 
              className="w-full" 
              variant={tier === 'starter' && isActive ? 'outline' : 'default'}
              onClick={() => handleSubscribe('starter')}
              disabled={checkoutMutation.isPending || (tier === 'starter' && isActive)}
            >
              {checkoutMutation.isPending && selectedTier === 'starter' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : tier === 'starter' && isActive ? (
                'Aktueller Plan'
              ) : (
                'Starter wählen'
              )}
            </Button>
          </CardFooter>
        </Card>

        <Card className={`${tier === 'professional' && isActive ? 'border-primary' : ''} relative`}>
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <Badge className="bg-primary">Beliebteste Wahl</Badge>
          </div>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-500" />
              <CardTitle>Professional</CardTitle>
            </div>
            <CardDescription>Für wachsende Hausverwaltungen</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <span className="text-3xl font-bold">{prices.professional[interval]}€</span>
              <span className="text-muted-foreground">/{interval === 'monthly' ? 'Monat' : 'Jahr'}</span>
            </div>
            <ul className="space-y-2">
              {planFeatures.map((feature) => (
                <li key={feature.name} className="flex items-center gap-2 text-sm">
                  {feature.professional ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <span className="h-4 w-4" />
                  )}
                  <span className={!feature.professional ? 'text-muted-foreground line-through' : ''}>
                    {feature.name}
                    {typeof feature.professional === 'string' && ` (${feature.professional})`}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Button 
              className="w-full" 
              variant={tier === 'professional' && isActive ? 'outline' : 'default'}
              onClick={() => handleSubscribe('professional')}
              disabled={checkoutMutation.isPending || (tier === 'professional' && isActive)}
            >
              {checkoutMutation.isPending && selectedTier === 'professional' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : tier === 'professional' && isActive ? (
                'Aktueller Plan'
              ) : (
                'Professional wählen'
              )}
            </Button>
          </CardFooter>
        </Card>

        <Card className={tier === 'enterprise' && isActive ? 'border-primary' : ''}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-yellow-500" />
              <CardTitle>Enterprise</CardTitle>
            </div>
            <CardDescription>Für große Hausverwaltungen</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <span className="text-3xl font-bold">{prices.enterprise[interval]}€</span>
              <span className="text-muted-foreground">/{interval === 'monthly' ? 'Monat' : 'Jahr'}</span>
            </div>
            <ul className="space-y-2">
              {planFeatures.map((feature) => (
                <li key={feature.name} className="flex items-center gap-2 text-sm">
                  {feature.enterprise ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <span className="h-4 w-4" />
                  )}
                  <span className={!feature.enterprise ? 'text-muted-foreground line-through' : ''}>
                    {feature.name}
                    {typeof feature.enterprise === 'string' && ` (${feature.enterprise})`}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Button 
              className="w-full" 
              variant={tier === 'enterprise' && isActive ? 'outline' : 'default'}
              onClick={() => handleSubscribe('enterprise')}
              disabled={checkoutMutation.isPending || (tier === 'enterprise' && isActive)}
            >
              {checkoutMutation.isPending && selectedTier === 'enterprise' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : tier === 'enterprise' && isActive ? (
                'Aktueller Plan'
              ) : (
                'Enterprise wählen'
              )}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
