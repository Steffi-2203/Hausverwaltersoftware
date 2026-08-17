import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Shield, BarChart3, ArrowRight, CheckCircle, Building2,
  Scale, BookOpen, Bot, Landmark, FileSignature, Thermometer,
  Users, TrendingUp, Zap
} from 'lucide-react';
import immoflowLogo from '@/assets/immoflowme-logo.png';

const features = [
  {
    icon: Scale,
    title: 'MRG- & WEG-Compliance',
    description: 'Richtwertmietzins, Kategoriemietzins, HeizKG-Abrechnung, WEG-Eigentumsverwaltung — alles gesetzeskonform.'
  },
  {
    icon: BookOpen,
    title: 'Doppelte Buchführung',
    description: 'Österreichischer Kontenrahmen, Bilanz, GuV, UVA, Saldenliste, Kontoblatt, Storno und E/A-Rechnung.'
  },
  {
    icon: Bot,
    title: 'KI-Automatisierung',
    description: 'OCR-Belegerkennung, automatische Vorschreibungen, Mahnläufe, VPI-Anpassung und KI-Copilot.'
  },
  {
    icon: Landmark,
    title: 'Banking & Zahlungsverkehr',
    description: 'EBICS-Anbindung, SEPA-Export, Offene-Posten-Management, automatisches Bank-Matching.'
  },
  {
    icon: FileSignature,
    title: 'DMS & eSignatur',
    description: 'Dokumentenmanagement mit Versionierung, Volltextsuche, eIDAS-konforme elektronische Signatur.'
  },
  {
    icon: Thermometer,
    title: 'HeizKG-Abrechnung',
    description: 'Vollständige Heizkostenabrechnung nach §§5-15 HeizKG mit Compliance-Prüfung und PDF-Export.'
  },
];

const benefits = [
  'MRG/WEG/HeizKG-konform',
  'DSGVO & GoBD-zertifiziert',
  'BMD NTCS/DATEV-Export',
  'FinanzOnline-Anbindung',
  'Mieter- & Eigentümerportale',
  'PWA — auch am Smartphone',
  'Elektronische Signatur',
  'ESG-Energiemonitoring',
  'EBICS Live-Banking',
  'Automatische Mahnläufe',
];

const targetGroups = [
  {
    icon: Building2,
    title: 'Kleine Hausverwaltungen',
    units: '5 — 50 Einheiten',
    description: 'Professionelle Werkzeuge ab dem ersten Objekt. Kein Excel mehr — sofort startklar mit allen gesetzlichen Anforderungen.',
  },
  {
    icon: Users,
    title: 'Mittlere Verwaltungen',
    units: '50 — 500 Einheiten',
    description: 'Automatisierung, die Personal spart. Mahnläufe, Vorschreibungen und Abrechnungen laufen auf Knopfdruck.',
  },
  {
    icon: TrendingUp,
    title: 'Große Hausverwaltungen',
    units: '500 — 2.000+ Einheiten',
    description: 'Enterprise-Funktionen für maximale Effizienz. Multi-Mandanten, Teamverwaltung, API-Anbindung und dedizierter Support.',
  },
];

const stats = [
  { value: '5 — 2.000+', label: 'Einheiten' },
  { value: '71', label: 'Kontenrahmen' },
  { value: '§§5-15', label: 'HeizKG-konform' },
  { value: '100%', label: 'Cloud-basiert' },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-[999]">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <img src={immoflowLogo} alt="ImmoFlowMe Logo" className="h-12 w-auto" data-testid="img-logo" />
            <div className="flex flex-col">
              <span className="font-bold text-lg leading-tight">ImmoFlowMe</span>
              <span className="text-xs text-muted-foreground">by ImmoPepper</span>
            </div>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <Button variant="ghost" asChild>
              <Link to="/preise" data-testid="link-pricing-nav">Preise</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/demo" data-testid="button-demo-nav">Demo testen</Link>
            </Button>
            <Button asChild>
              <Link to="/login" data-testid="button-login-nav">Anmelden</Link>
            </Button>
          </div>
        </div>
      </nav>

      <section className="container mx-auto px-4 py-20 md:py-32">
        <div className="max-w-4xl mx-auto text-center">
          <Badge variant="secondary" className="mb-6" data-testid="badge-hero">
            Professionelle Hausverwaltungssoftware aus Österreich
          </Badge>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6" data-testid="text-hero-title">
            Hausverwaltung im Flow
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground mb-4 max-w-3xl mx-auto" data-testid="text-hero-subtitle">
            Die professionelle Software für österreichische Hausverwaltungen jeder Größe —
            von 5 bis über 2.000 Einheiten.
          </p>
          <p className="text-lg text-muted-foreground mb-8 max-w-3xl mx-auto">
            MRG- und WEG-konform, KI-gestützt, vollautomatisiert — von der Buchhaltung bis zur Heizkostenabrechnung.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
            <Button size="lg" asChild>
              <Link to="/demo" data-testid="button-demo-hero">
                14 Tage kostenlos testen
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/preise" data-testid="button-pricing-hero">
                Preise ansehen
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="border-y bg-muted/30 py-12">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-4xl mx-auto">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl md:text-4xl font-bold text-primary mb-1" data-testid={`text-stat-${stat.label}`}>{stat.value}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-20">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4" data-testid="text-target-title">
              Für Hausverwaltungen jeder Größe
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Ob Sie 10 oder 2.000 Einheiten verwalten — ImmoFlowMe wächst mit Ihnen und automatisiert Ihre Prozesse.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {targetGroups.map((group, index) => (
              <Card key={index} className="hover-elevate" data-testid={`card-target-${index}`}>
                <CardContent className="p-6">
                  <div className="bg-primary/10 w-12 h-12 rounded-md flex items-center justify-center mb-4">
                    <group.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-semibold mb-1">{group.title}</h3>
                  <div className="text-sm font-medium text-primary mb-3">{group.units}</div>
                  <p className="text-muted-foreground">{group.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-20 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4" data-testid="text-features-title">
              Alles für die professionelle Hausverwaltung
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Von der gesetzeskonformen Abrechnung bis zur KI-gestützten Automatisierung — alles in einer Plattform.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <Card key={index} className="hover-elevate" data-testid={`card-feature-${index}`}>
                <CardContent className="p-6">
                  <div className="bg-primary/10 w-12 h-12 rounded-md flex items-center justify-center mb-4">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-20">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold mb-6" data-testid="text-benefits-title">
                Warum ImmoFlowMe?
              </h2>
              <p className="text-lg text-muted-foreground mb-8">
                ImmoFlowMe wurde speziell für den österreichischen Markt entwickelt.
                Automatisieren Sie wiederkehrende Aufgaben und konzentrieren Sie sich auf das, was zählt — Ihre Liegenschaften und Mieter.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {benefits.map((benefit, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                    <span className="text-sm font-medium">{benefit}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-gradient-to-br from-primary/20 to-primary/5 rounded-md p-8">
              <div className="space-y-6">
                <div className="flex items-start gap-3">
                  <Zap className="h-6 w-6 text-primary flex-shrink-0 mt-1" />
                  <div>
                    <div className="font-semibold mb-1">Personalkosten senken</div>
                    <p className="text-sm text-muted-foreground">Automatisierung von Vorschreibungen, Mahnungen und Abrechnungen spart bis zu 60% manuelle Arbeit.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Shield className="h-6 w-6 text-primary flex-shrink-0 mt-1" />
                  <div>
                    <div className="font-semibold mb-1">Höchste Sicherheitsstandards</div>
                    <p className="text-sm text-muted-foreground">2FA, Verschlüsselung, BAO §132 Aufbewahrung, GoBD-Audit-Trail, DSGVO-konform.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <BarChart3 className="h-6 w-6 text-primary flex-shrink-0 mt-1" />
                  <div>
                    <div className="font-semibold mb-1">Umfassende Auswertungen</div>
                    <p className="text-sm text-muted-foreground">Dashboards, Ad-hoc-Berichte, geplante Reports, BMD/DATEV-Export.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-primary text-primary-foreground py-20">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4" data-testid="text-cta-title">
            Bereit, Ihre Hausverwaltung zu digitalisieren?
          </h2>
          <p className="text-lg opacity-90 mb-8 max-w-2xl mx-auto">
            Testen Sie ImmoFlowMe 14 Tage kostenlos — ohne Kreditkarte, ohne Verpflichtung.
            Ob 5 oder 2.000 Einheiten — wir haben den richtigen Plan für Sie.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
            <Button size="lg" variant="secondary" asChild>
              <Link to="/demo" data-testid="button-demo-cta">
                Kostenlos testen
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="border-primary-foreground/30 text-primary-foreground">
              <Link to="/preise" data-testid="button-pricing-cta">
                Preise vergleichen
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t py-12">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <img src={immoflowLogo} alt="ImmoFlowMe Logo" className="h-8 w-auto" />
              <div className="flex flex-col">
                <span className="font-semibold text-sm">ImmoFlowMe</span>
                <span className="text-xs text-muted-foreground">by ImmoPepper</span>
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} ImmoFlowMe by ImmoPepper. Alle Rechte vorbehalten.
            </div>
            <div className="flex gap-6 text-sm text-muted-foreground flex-wrap">
              <Link to="/datenschutz" className="hover:text-foreground transition-colors">Datenschutz</Link>
              <Link to="/impressum" className="hover:text-foreground transition-colors">Impressum</Link>
              <Link to="/agb" className="hover:text-foreground transition-colors">AGB</Link>
              <Link to="/avv" className="hover:text-foreground transition-colors">AVV</Link>
              <Link to="/sla" className="hover:text-foreground transition-colors">SLA</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
