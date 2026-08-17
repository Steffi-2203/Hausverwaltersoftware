import { Link } from 'react-router-dom';
import { ArrowLeft, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function SLA() {
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
            <Button variant="ghost" size="sm" data-testid="button-back-sla">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Zurück
            </Button>
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl font-bold text-foreground mb-2">Service Level Agreement (SLA)</h1>
        <p className="text-sm text-muted-foreground mb-2">Stand: Februar 2026</p>
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-4 mb-8">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            <strong>Hinweis:</strong> Dieses SLA dient als Muster und sollte vor Verwendung von einem Rechtsanwalt geprüft werden.
          </p>
        </div>

        <div className="space-y-8 text-muted-foreground">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">1. Geltungsbereich</h2>
            <p>
              Dieses Service Level Agreement (SLA) regelt die Verfügbarkeit und Servicequalität der
              SaaS-Plattform ImmoFlowMe und ist Bestandteil des Nutzungsvertrages zwischen ImmoFlowMe
              und dem Kunden.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">2. Verfügbarkeitsstufen</h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-border text-sm">
                <thead>
                  <tr className="bg-muted">
                    <th className="border border-border px-4 py-2 text-left text-foreground">Tier</th>
                    <th className="border border-border px-4 py-2 text-left text-foreground">Verfügbarkeit (pro Monat)</th>
                    <th className="border border-border px-4 py-2 text-left text-foreground">Beschreibung</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-border px-4 py-2 text-foreground font-medium">Tier 1</td>
                    <td className="border border-border px-4 py-2">99 %</td>
                    <td className="border border-border px-4 py-2">Standard-Verfügbarkeit</td>
                  </tr>
                  <tr className="bg-muted/50">
                    <td className="border border-border px-4 py-2 text-foreground font-medium">Tier 2</td>
                    <td className="border border-border px-4 py-2">99,5 %</td>
                    <td className="border border-border px-4 py-2">Erhöhte Verfügbarkeit für professionelle Verwaltungen</td>
                  </tr>
                  <tr>
                    <td className="border border-border px-4 py-2 text-foreground font-medium">Tier 3</td>
                    <td className="border border-border px-4 py-2">99,9 %</td>
                    <td className="border border-border px-4 py-2">Hohe Verfügbarkeit für Enterprise-Kunden</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">3. Störungskategorien</h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-border text-sm">
                <thead>
                  <tr className="bg-muted">
                    <th className="border border-border px-4 py-2 text-left text-foreground">Kategorie</th>
                    <th className="border border-border px-4 py-2 text-left text-foreground">Beschreibung</th>
                    <th className="border border-border px-4 py-2 text-left text-foreground">Reaktionszeit</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-border px-4 py-2 text-foreground font-medium">Kritisch</td>
                    <td className="border border-border px-4 py-2">Kompletter Systemausfall, Login nicht möglich</td>
                    <td className="border border-border px-4 py-2">innerhalb von 2 Stunden</td>
                  </tr>
                  <tr className="bg-muted/50">
                    <td className="border border-border px-4 py-2 text-foreground font-medium">Hoch</td>
                    <td className="border border-border px-4 py-2">Kernfunktionen erheblich beeinträchtigt</td>
                    <td className="border border-border px-4 py-2">innerhalb von 6 Stunden</td>
                  </tr>
                  <tr>
                    <td className="border border-border px-4 py-2 text-foreground font-medium">Mittel</td>
                    <td className="border border-border px-4 py-2">Teilfunktionen gestört, Workarounds möglich</td>
                    <td className="border border-border px-4 py-2">innerhalb von 24 Stunden</td>
                  </tr>
                  <tr className="bg-muted/50">
                    <td className="border border-border px-4 py-2 text-foreground font-medium">Niedrig</td>
                    <td className="border border-border px-4 py-2">Kosmetische Fehler, UI-Probleme</td>
                    <td className="border border-border px-4 py-2">innerhalb von 72 Stunden</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">4. Gutschriftensystem</h2>
            <p className="mb-4">
              Wird die zugesicherte Verfügbarkeit in einem Kalendermonat unterschritten, erhält der Kunde
              auf Antrag folgende Gutschriften:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-border text-sm">
                <thead>
                  <tr className="bg-muted">
                    <th className="border border-border px-4 py-2 text-left text-foreground">Abweichung von SLA</th>
                    <th className="border border-border px-4 py-2 text-left text-foreground">Gutschrift auf Monatsgebühr</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-border px-4 py-2">bis 1 % unter SLA</td>
                    <td className="border border-border px-4 py-2">5 %</td>
                  </tr>
                  <tr className="bg-muted/50">
                    <td className="border border-border px-4 py-2">bis 2 % unter SLA</td>
                    <td className="border border-border px-4 py-2">10 %</td>
                  </tr>
                  <tr>
                    <td className="border border-border px-4 py-2">bis 5 % unter SLA</td>
                    <td className="border border-border px-4 py-2">25 %</td>
                  </tr>
                  <tr className="bg-muted/50">
                    <td className="border border-border px-4 py-2">mehr als 5 % unter SLA</td>
                    <td className="border border-border px-4 py-2">50 %</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-4">
              Gutschriften werden mit zukünftigen Rechnungen verrechnet und begründen keinen Anspruch auf Auszahlung.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">5. Backups und Wiederherstellung</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>Tägliche Datensicherungen der Produktivdatenbank</li>
              <li>Point-in-Time Recovery (PITR) für einen definierten Zeitraum</li>
              <li>Redundante Speicherung in EU-Rechenzentren</li>
              <li>Regelmäßige Wiederherstellungstests</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">6. Wartungsfenster</h2>
            <p>
              Geplante Wartungsarbeiten werden mindestens 48 Stunden im Voraus angekündigt und nach
              Möglichkeit außerhalb der üblichen Geschäftszeiten durchgeführt. Notfallwartungen können
              kurzfristig erfolgen; der Kunde wird so früh wie möglich informiert.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">7. Ausschlüsse</h2>
            <p className="mb-4">Die Verfügbarkeitszusagen gelten nicht für Ausfälle, die verursacht werden durch:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Störungen in der Infrastruktur des Kunden (z. B. Internetzugang)</li>
              <li>Höhere Gewalt</li>
              <li>Fehlkonfigurationen durch den Kunden</li>
              <li>Ausfälle von Drittanbietern, die außerhalb des Einflussbereichs von ImmoFlowMe liegen</li>
            </ul>
          </section>

          <p className="mt-4 text-sm">
            <strong className="text-foreground">Muster-Disclaimer:</strong> Dieses SLA stellt ein Muster dar und ersetzt keine individuelle Rechtsberatung.
          </p>
        </div>

        <div className="mt-12 pt-8 border-t border-border flex flex-wrap gap-6 text-sm">
          <Link to="/impressum" className="text-muted-foreground hover:text-foreground" data-testid="link-impressum">
            Impressum
          </Link>
          <Link to="/datenschutz" className="text-muted-foreground hover:text-foreground" data-testid="link-datenschutz">
            Datenschutz
          </Link>
          <Link to="/agb" className="text-muted-foreground hover:text-foreground" data-testid="link-agb">
            AGB
          </Link>
          <Link to="/avv" className="text-muted-foreground hover:text-foreground" data-testid="link-avv">
            AVV
          </Link>
        </div>
      </main>
    </div>
  );
}