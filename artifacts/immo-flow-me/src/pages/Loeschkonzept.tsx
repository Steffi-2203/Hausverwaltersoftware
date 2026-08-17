import { Link } from 'react-router-dom';
import { ArrowLeft, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Loeschkonzept() {
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
            <Button variant="ghost" size="sm" data-testid="button-back-loeschkonzept">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Zurück
            </Button>
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl font-bold text-foreground mb-2">Löschkonzept für personenbezogene Daten</h1>
        <p className="text-sm text-muted-foreground mb-8">Stand: Februar 2026</p>

        <div className="space-y-8 text-muted-foreground">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">1. Ziel und Geltungsbereich</h2>
            <p>
              Dieses Löschkonzept beschreibt die Grundsätze und Prozesse zur Löschung und Anonymisierung
              personenbezogener Daten in der SaaS-Plattform ImmoFlowMe unter Berücksichtigung der DSGVO
              sowie der österreichischen Aufbewahrungspflichten (BAO, UStG, HeizKG).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">2. Aufbewahrungsfristen</h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm" data-testid="table-aufbewahrungsfristen">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 pr-4 font-semibold text-foreground">Datenkategorie</th>
                    <th className="text-left py-3 pr-4 font-semibold text-foreground">Aufbewahrungsfrist</th>
                    <th className="text-left py-3 font-semibold text-foreground">Rechtsgrundlage</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border">
                    <td className="py-3 pr-4">Vertragsdaten</td>
                    <td className="py-3 pr-4">7 Jahre nach Vertragsende</td>
                    <td className="py-3">§ 132 BAO</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-3 pr-4">Finanzdaten / Buchungsbelege</td>
                    <td className="py-3 pr-4">7 Jahre</td>
                    <td className="py-3">§ 132 BAO</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-3 pr-4">Grundstücksbezogene Unterlagen</td>
                    <td className="py-3 pr-4">22 Jahre</td>
                    <td className="py-3">§ 18 UStG</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-3 pr-4">Betriebskostenabrechnungen</td>
                    <td className="py-3 pr-4">7 Jahre</td>
                    <td className="py-3">§ 132 BAO</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-3 pr-4">Heizkostenabrechnungen</td>
                    <td className="py-3 pr-4">7 Jahre</td>
                    <td className="py-3">HeizKG i.V.m. § 132 BAO</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-3 pr-4">Server-Log-Dateien</td>
                    <td className="py-3 pr-4">90 Tage</td>
                    <td className="py-3">Berechtigtes Interesse (Systemsicherheit)</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4">Bewerberdaten</td>
                    <td className="py-3 pr-4">6 Monate nach Absage</td>
                    <td className="py-3">Berechtigtes Interesse</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">3. Lösch- und Anonymisierungsmethoden</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>Automatisierte Löschung von Datensätzen nach Ablauf der definierten Fristen.</li>
              <li>Anonymisierung, wenn eine vollständige Löschung aus technischen oder rechtlichen Gründen nicht möglich ist.</li>
              <li>Überschreiben von Backups nach einem definierten Zeitraum (z. B. 90 Tage).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">4. Löschprozesse</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>Regelmäßige, automatisierte Jobs prüfen das Alter der Datensätze und markieren diese zur Löschung.</li>
              <li>Löschvorgänge werden protokolliert, um Nachweise gegenüber Verantwortlichen und Aufsichtsbehörden erbringen zu können.</li>
              <li>Betroffenenrechte (z. B. Löschung nach Art. 17 DSGVO) werden durch manuelle oder halbautomatisierte Prozesse umgesetzt.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">5. Verantwortlichkeiten</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>ImmoFlowMe ist für die technische Umsetzung der Löschung und Anonymisierung verantwortlich.</li>
              <li>Der jeweilige Verantwortliche (Kunde) ist für die rechtliche Bewertung und Klassifizierung der von ihm verarbeiteten Daten verantwortlich.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">6. Beziehung zum AVV und zur Datenschutzerklärung</h2>
            <p>
              Dieses Löschkonzept ergänzt die Regelungen im{' '}
              <Link to="/avv" className="text-primary hover:underline">Auftragsverarbeitungsvertrag (AVV)</Link>{' '}
              und in der{' '}
              <Link to="/datenschutz" className="text-primary hover:underline">Datenschutzerklärung</Link>.
              Im Zweifel gelten die gesetzlichen Aufbewahrungspflichten und die vertraglichen Vereinbarungen im AVV.
            </p>
          </section>

          <p className="mt-4 text-sm">
            <strong className="text-foreground">Muster-Disclaimer:</strong> Dieses Löschkonzept stellt ein Muster dar und ersetzt keine individuelle Rechtsberatung.
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
          <Link to="/agb" className="text-muted-foreground hover:text-foreground" data-testid="link-agb">
            AGB
          </Link>
          <Link to="/sla" className="text-muted-foreground hover:text-foreground" data-testid="link-sla">
            SLA
          </Link>
        </div>
      </main>
    </div>
  );
}