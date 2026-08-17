import { Fragment } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, X, Crown, Sparkles, Zap, Bot, Building2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useSubscriptionLimits } from '@/hooks/useSubscriptionLimits';
import { useAuth } from '@/hooks/useAuth';
import immoflowLogo from '@/assets/immoflowme-logo.png';

interface PlanFeature {
  name: string;
  category?: string;
  trial: boolean | string;
  starter: boolean | string;
  pro: boolean | string;
  enterprise: boolean | string;
}

const features: PlanFeature[] = [
  { name: 'Verwaltete Einheiten', category: 'Grundlagen', trial: '5', starter: '50', pro: '500', enterprise: 'Unbegrenzt' },
  { name: 'Benutzer', trial: '1', starter: '3', pro: '10', enterprise: 'Unbegrenzt' },
  { name: 'Liegenschaften', trial: '1', starter: '10', pro: '100', enterprise: 'Unbegrenzt' },

  { name: 'Mieterverwaltung', category: 'Verwaltung', trial: true, starter: true, pro: true, enterprise: true },
  { name: 'Einheitenverwaltung', trial: true, starter: true, pro: true, enterprise: true },
  { name: 'Mietverträge & Leasing', trial: false, starter: true, pro: true, enterprise: true },
  { name: 'Schlüsselverwaltung', trial: false, starter: true, pro: true, enterprise: true },
  { name: 'Schadensmeldungen', trial: false, starter: true, pro: true, enterprise: true },

  { name: 'Betriebskostenabrechnung', category: 'Abrechnung & Compliance', trial: 'Ansicht', starter: true, pro: true, enterprise: true },
  { name: 'HeizKG-Abrechnung (§§5-15)', trial: false, starter: false, pro: true, enterprise: true },
  { name: 'MRG-Richtwertmietzins', trial: false, starter: true, pro: true, enterprise: true },
  { name: 'WEG-Eigentümerverwaltung', trial: false, starter: false, pro: true, enterprise: true },
  { name: 'Kautionsverwaltung', trial: false, starter: true, pro: true, enterprise: true },

  { name: 'E/A-Rechnung', category: 'Buchhaltung', trial: false, starter: true, pro: true, enterprise: true },
  { name: 'Doppelte Buchführung', trial: false, starter: false, pro: true, enterprise: true },
  { name: 'Bilanz, GuV, UVA', trial: false, starter: false, pro: true, enterprise: true },
  { name: 'Offene-Posten-Management', trial: false, starter: true, pro: true, enterprise: true },
  { name: 'Jahresabschluss-Wizard', trial: false, starter: false, pro: true, enterprise: true },

  { name: 'SEPA-Export', category: 'Banking & Zahlungen', trial: false, starter: true, pro: true, enterprise: true },
  { name: 'EBICS Live-Banking', trial: false, starter: false, pro: true, enterprise: true },
  { name: 'Auto. Bank-Matching', trial: false, starter: false, pro: false, enterprise: true },

  { name: 'Dokumente hochladen', category: 'Dokumente & Export', trial: false, starter: true, pro: true, enterprise: true },
  { name: 'DMS mit Volltextsuche', trial: false, starter: false, pro: true, enterprise: true },
  { name: 'Elektronische Signatur', trial: false, starter: false, pro: true, enterprise: true },
  { name: 'Vertragsgenerator', trial: false, starter: false, pro: false, enterprise: true },
  { name: 'BMD NTCS/DATEV-Export', trial: false, starter: false, pro: true, enterprise: true },
  { name: 'FinanzOnline-Anbindung', trial: false, starter: false, pro: false, enterprise: true },

  { name: 'Automatische Vorschreibungen', category: 'Automatisierung', trial: false, starter: false, pro: true, enterprise: true },
  { name: 'Automatische Mahnläufe', trial: false, starter: false, pro: true, enterprise: true },
  { name: 'VPI-Mietanpassung', trial: false, starter: false, pro: true, enterprise: true },
  { name: 'Workflow-Regeln-Engine', trial: false, starter: false, pro: false, enterprise: true },

  { name: 'Mieterportal', category: 'Portale', trial: false, starter: false, pro: true, enterprise: true },
  { name: 'Eigentümerportal', trial: false, starter: false, pro: false, enterprise: true },

  { name: 'PDF/XLSX-Export', category: 'Reporting', trial: false, starter: true, pro: true, enterprise: true },
  { name: 'Dashboards & Charts', trial: true, starter: true, pro: true, enterprise: true },
  { name: 'Ad-hoc Query Builder', trial: false, starter: false, pro: true, enterprise: true },
  { name: 'Geplante Reports', trial: false, starter: false, pro: false, enterprise: true },

  { name: 'ESG-Energiemonitoring', category: 'Zusatzmodule', trial: false, starter: false, pro: true, enterprise: true },
  { name: 'PWA (Smartphone-App)', trial: true, starter: true, pro: true, enterprise: true },
  { name: 'Push-Benachrichtigungen', trial: false, starter: true, pro: true, enterprise: true },
  { name: 'KI-Autopilot', trial: false, starter: false, pro: '+€39/M', enterprise: 'Inkludiert' },

  { name: 'E-Mail-Support', category: 'Support', trial: true, starter: true, pro: true, enterprise: true },
  { name: 'Prioritäts-Support', trial: false, starter: false, pro: true, enterprise: true },
  { name: 'Persönlicher Ansprechpartner', trial: false, starter: false, pro: false, enterprise: true },
  { name: 'Onboarding-Begleitung', trial: false, starter: false, pro: false, enterprise: true },
];

interface PricingPlan {
  id: 'trial' | 'starter' | 'pro' | 'enterprise';
  name: string;
  price: string;
  priceDetail: string;
  description: string;
  icon: typeof Crown;
  popular?: boolean;
  highlight?: string;
}

const plans: PricingPlan[] = [
  {
    id: 'trial',
    name: 'Testversion',
    price: 'Kostenlos',
    priceDetail: '14 Tage',
    description: 'Lernen Sie ImmoFlowMe unverbindlich kennen.',
    icon: Zap,
  },
  {
    id: 'starter',
    name: 'Starter',
    price: '€39',
    priceDetail: 'pro Monat',
    description: 'Für kleine Verwaltungen und Einsteiger.',
    icon: Sparkles,
  },
  {
    id: 'pro',
    name: 'Professional',
    price: '€299',
    priceDetail: 'pro Monat',
    description: 'Für wachsende Hausverwaltungen mit Automatisierung.',
    icon: Crown,
    popular: true,
    highlight: 'Beliebtester Plan',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: '€399',
    priceDetail: 'pro Monat',
    description: 'Für große Verwaltungen mit vollem Funktionsumfang.',
    icon: Building2,
  },
];

function FeatureValue({ value }: { value: boolean | string }) {
  if (typeof value === 'string') {
    return <span className="text-sm font-medium">{value}</span>;
  }
  return value ? (
    <Check className="h-5 w-5 text-green-600" />
  ) : (
    <X className="h-5 w-5 text-muted-foreground/30" />
  );
}

export default function Pricing() {
  const { user } = useAuth();
  const { effectiveTier } = useSubscriptionLimits();
  const navigate = useNavigate();

  const handleSelectPlan = (planId: 'trial' | 'starter' | 'pro' | 'enterprise') => {
    if (planId === 'trial') {
      if (!user) {
        navigate('/register');
      }
      return;
    }
    navigate(`/checkout?plan=${planId}`);
  };

  const isCurrentPlan = (planId: string) => {
    return effectiveTier === planId;
  };

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-[999]">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4 flex-wrap">
          <Link to="/" className="flex items-center gap-3">
            <img src={immoflowLogo} alt="ImmoFlowMe Logo" className="h-10 w-auto" />
            <div className="flex flex-col">
              <span className="font-bold text-lg leading-tight">ImmoFlowMe</span>
              <span className="text-xs text-muted-foreground">by ImmoPepper</span>
            </div>
          </Link>
          <div className="flex items-center gap-4 flex-wrap">
            <Button variant="outline" asChild>
              <Link to="/demo" data-testid="button-demo-pricing-nav">Demo testen</Link>
            </Button>
            <Button asChild>
              <Link to="/login" data-testid="button-login-pricing-nav">Anmelden</Link>
            </Button>
          </div>
        </div>
      </nav>

      <div className="container mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4" data-testid="text-pricing-title">
            Transparent und fair — für jede Verwaltungsgröße
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Starten Sie kostenlos und wachsen Sie mit Ihren Anforderungen.
            Alle Preise exkl. USt. Jährliche Abrechnung auf Anfrage.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto mb-16">
          {plans.map((plan) => {
            const Icon = plan.icon;
            const current = isCurrentPlan(plan.id);

            return (
              <Card
                key={plan.id}
                className={`relative ${plan.popular ? 'border-primary shadow-lg' : ''}`}
                data-testid={`card-plan-${plan.id}`}
              >
                {plan.highlight && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                    {plan.highlight}
                  </Badge>
                )}
                <CardHeader className="text-center pb-2">
                  <div className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md ${plan.popular ? 'bg-primary/10' : 'bg-muted'}`}>
                    <Icon className={`h-6 w-6 ${plan.popular ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  <div className="mt-2">
                    <span className="text-3xl font-bold">{plan.price}</span>
                    <span className="text-muted-foreground ml-1 text-sm">{plan.priceDetail}</span>
                  </div>
                  <CardDescription className="mt-2">{plan.description}</CardDescription>
                </CardHeader>
                <CardContent className="pb-4">
                  <ul className="space-y-2 text-sm">
                    {features.filter(f => f.category === 'Grundlagen').map((feature) => (
                      <li key={feature.name} className="flex items-center gap-2">
                        <FeatureValue value={feature[plan.id]} />
                        <span>{feature.name}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  <Button
                    className="w-full"
                    variant={plan.popular ? 'default' : 'outline'}
                    disabled={current}
                    onClick={() => handleSelectPlan(plan.id)}
                    data-testid={`button-select-${plan.id}`}
                  >
                    {current ? 'Aktueller Plan' : plan.id === 'trial' ? 'Kostenlos starten' : 'Plan auswählen'}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>

        <div className="max-w-6xl mx-auto mb-16">
          <Card className="max-w-lg mx-auto border-primary/50" data-testid="card-ki-autopilot-addon">
            <CardHeader className="text-center pb-2">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-primary/10">
                <Bot className="h-6 w-6 text-primary" />
              </div>
              <CardTitle className="text-xl">KI-Autopilot Add-on</CardTitle>
              <div className="mt-2">
                <span className="text-3xl font-bold">€39</span>
                <span className="text-muted-foreground ml-1 text-sm">pro Monat</span>
              </div>
              <CardDescription className="mt-2">
                Für Professional-Kunden. Im Enterprise-Plan bereits inkludiert.
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-4">
              <ul className="space-y-2 text-sm">
                {['KI-Assistent (Chat-Copilot)', 'Automatische Vorschreibung & Mahnlauf', 'KI-Rechnungs- & Belegerkennung (OCR)', 'Anomalieerkennung & Insights', 'KI-Kommunikationsassistent (E-Mail)'].map(f => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-600 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Button
                className="w-full"
                onClick={() => navigate('/checkout?plan=ki-autopilot')}
                data-testid="button-select-ki-autopilot"
              >
                Add-on buchen
              </Button>
            </CardFooter>
          </Card>
        </div>

        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold mb-6 text-center" data-testid="text-comparison-title">Detaillierter Feature-Vergleich</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" data-testid="table-feature-comparison">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-4 px-4 font-medium">Feature</th>
                  <th className="text-center py-4 px-4 font-medium">Testversion</th>
                  <th className="text-center py-4 px-4 font-medium">Starter</th>
                  <th className="text-center py-4 px-4 font-medium border-x border-primary/20 bg-primary/5">Professional</th>
                  <th className="text-center py-4 px-4 font-medium">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {features.map((feature, index) => (
                  <Fragment key={feature.name}>
                    {feature.category && (
                      <tr className="bg-muted/50">
                        <td colSpan={5} className="py-3 px-4 font-semibold text-sm text-muted-foreground">
                          {feature.category}
                        </td>
                      </tr>
                    )}
                    <tr className={index % 2 === 0 ? 'bg-muted/10' : ''}>
                      <td className="py-3 px-4 text-sm">{feature.name}</td>
                      <td className="text-center py-3 px-4">
                        <div className="flex justify-center"><FeatureValue value={feature.trial} /></div>
                      </td>
                      <td className="text-center py-3 px-4">
                        <div className="flex justify-center"><FeatureValue value={feature.starter} /></div>
                      </td>
                      <td className="text-center py-3 px-4 border-x border-primary/20 bg-primary/5">
                        <div className="flex justify-center"><FeatureValue value={feature.pro} /></div>
                      </td>
                      <td className="text-center py-3 px-4">
                        <div className="flex justify-center"><FeatureValue value={feature.enterprise} /></div>
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="max-w-6xl mx-auto mt-16">
          <Card className="max-w-2xl mx-auto" data-testid="card-white-label">
            <CardContent className="p-8 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-muted">
                <Building2 className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-bold mb-2">White Label — auf Anfrage</h3>
              <p className="text-muted-foreground mb-6">
                Sie möchten ImmoFlowMe unter Ihrer eigenen Marke betreiben?
                Wir bieten White-Label-Lösungen mit individuellem Branding, eigener Domain und angepasstem Design für größere Verwaltungen und Franchisepartner.
              </p>
              <Button variant="outline" asChild>
                <Link to="/white-label" data-testid="button-white-label">
                  <Mail className="mr-2 h-4 w-4" />
                  Unverbindlich anfragen
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="text-center mt-12">
          <p className="text-muted-foreground mb-4">
            Fragen zu unseren Plänen? Wir beraten Sie gerne.
          </p>
          <Button variant="outline" asChild>
            <a href="mailto:support@immoflow.me" data-testid="button-contact-pricing">Kontaktieren Sie uns</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
