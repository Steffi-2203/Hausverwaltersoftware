import { Link } from 'react-router-dom';
import { ArrowLeft, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AGB() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-xl text-foreground">ImmoFlowMe</span>
          </Link>
          <Link to="/">
            <Button variant="ghost" size="sm" data-testid="button-back-agb">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Zurück
            </Button>
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl font-bold text-foreground mb-2">Allgemeine Geschäftsbedingungen (AGB)</h1>
        <p className="text-sm text-muted-foreground mb-8">Stand: Februar 2026</p>

        <div className="space-y-8 text-muted-foreground">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">1. Geltungsbereich</h2>
            <p>
              Diese Allgemeinen Geschäftsbedingungen (AGB) gelten für alle Verträge zwischen ImmoFlowMe
              (Stephania Pfeffer) und Kunden über die Nutzung der SaaS-Hausverwaltungssoftware ImmoFlowMe.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">2. Vertragsgegenstand</h2>
            <p>
              ImmoFlowMe stellt dem Kunden eine cloudbasierte Software zur Verwaltung von Liegenschaften,
              Mietverhältnissen, Abrechnungen und Dokumenten zur Verfügung.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">3. Registrierung und Vertragsschluss</h2>
            <p>
              Der Vertrag kommt durch Registrierung des Kunden auf der Plattform und Bestätigung durch
              ImmoFlowMe zustande. Der Kunde sichert zu, nur wahrheitsgemäße Angaben zu machen.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">4. Preise und Zahlungsbedingungen</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>Die Nutzung der Software erfolgt gegen ein monatliches Entgelt.</li>
              <li>Die Abrechnung erfolgt elektronisch, in der Regel monatlich im Voraus.</li>
              <li>Zahlungen werden über den Zahlungsdienstleister Stripe abgewickelt.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">5. Pflichten des Kunden</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>Der Kunde ist verpflichtet, Zugangsdaten geheim zu halten.</li>
              <li>Der Kunde darf die Software nur im Rahmen der gesetzlichen Bestimmungen nutzen.</li>
              <li>Der Kunde ist für die Inhalte und Daten, die er in die Software einbringt, selbst verantwortlich.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">6. Verfügbarkeit und Support</h2>
            <p>
              Die Verfügbarkeit der Software richtet sich nach dem jeweils gültigen{' '}
              <Link to="/sla" className="text-primary hover:underline">Service Level Agreement (SLA)</Link>.
              Support wird per E-Mail und ggf. weiteren Kanälen angeboten.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">7. Haftung</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>Die Haftung von ImmoFlowMe ist -- außer bei Vorsatz und grober Fahrlässigkeit -- auf insgesamt EUR 10.000 pro Vertragsjahr begrenzt.</li>
              <li>Für mittelbare Schäden, entgangenen Gewinn oder Datenverluste wird nur gehaftet, soweit diese durch ImmoFlowMe vorsätzlich oder grob fahrlässig verursacht wurden.</li>
              <li>Der Kunde ist verpflichtet, regelmäßig Datenexporte durchzuführen; eine Haftung für Datenverlust ohne Exportpflichtverletzung ist ausgeschlossen.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">8. Nutzungsrechte und geistiges Eigentum</h2>
            <p>
              Alle Rechte an der Software verbleiben bei ImmoFlowMe. Der Kunde erhält ein einfaches,
              nicht übertragbares Nutzungsrecht für die Dauer des Vertrages.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">9. Datenschutz und Auftragsverarbeitung</h2>
            <p>
              Die Verarbeitung personenbezogener Daten erfolgt gemäß der{' '}
              <Link to="/datenschutz" className="text-primary hover:underline">Datenschutzerklärung</Link>{' '}
              und dem{' '}
              <Link to="/avv" className="text-primary hover:underline">Auftragsverarbeitungsvertrag (AVV)</Link>{' '}
              nach Art. 28 DSGVO, der Bestandteil dieser AGB ist.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">10. Vertragslaufzeit und Kündigung</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>Der Vertrag wird auf unbestimmte Zeit geschlossen und kann von beiden Parteien mit einer Frist von 30 Tagen zum Monatsende gekündigt werden, sofern nichts Abweichendes vereinbart ist.</li>
              <li>Nach Kündigung stellt ImmoFlowMe dem Kunden für 30 Tage einen Datenexport zur Verfügung.</li>
              <li>Nach Ablauf der Frist erfolgt die Löschung der Daten gemäß Löschkonzept und gesetzlichen Aufbewahrungspflichten.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">11. Schlussbestimmungen</h2>
            <p>
              Es gilt österreichisches Recht. Gerichtsstand ist -- soweit zulässig -- der Sitz von ImmoFlowMe.
              Sollten einzelne Bestimmungen dieser AGB unwirksam sein, bleibt die Wirksamkeit der übrigen
              Bestimmungen unberührt.
            </p>
          </section>

          <p className="mt-4 text-sm">
            <strong className="text-foreground">Muster-Disclaimer:</strong> Diese AGB stellen ein Muster dar und ersetzen keine individuelle Rechtsberatung.
          </p>
        </div>

        <div className="mt-12 pt-8 border-t border-border flex flex-wrap gap-6 text-sm">
          <Link to="/impressum" className="text-muted-foreground hover:text-foreground" data-testid="link-impressum">
            Impressum
          </Link>
          <Link to="/datenschutz" className="text-muted-foreground hover:text-foreground" data-testid="link-datenschutz">
            Datenschutz
          </Link>
          <Link to="/avv" className="text-muted-foreground hover:text-foreground" data-testid="link-avv">
            AVV
          </Link>
          <Link to="/sla" className="text-muted-foreground hover:text-foreground" data-testid="link-sla">
            SLA
          </Link>
        </div>
      </main>
    </div>
  );
}