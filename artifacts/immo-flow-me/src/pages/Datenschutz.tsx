import { Link } from 'react-router-dom';
import { ArrowLeft, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Datenschutz() {
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
            <Button variant="ghost" size="sm" data-testid="button-back-datenschutz">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Zurück
            </Button>
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl font-bold text-foreground mb-8">Datenschutzerklärung</h1>

        <div className="space-y-8 text-muted-foreground">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">1. Verantwortlicher</h2>
            <p>
              Verantwortlich für die Datenverarbeitung auf dieser Website ist:
            </p>
            <div className="mt-4 p-4 bg-muted rounded-lg">
              <p className="font-medium text-foreground">ImmoFlowMe</p>
              <p>Stephania Pfeffer</p>
              <p>[Adresse wird ergänzt]</p>
              <p className="mt-2">
                E-Mail:{' '}
                <a href="mailto:datenschutz@immoflowme.at" className="text-primary hover:underline">
                  datenschutz@immoflowme.at
                </a>
              </p>
              <p>
                Web:{' '}
                <a href="https://www.immoflowme.at" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  www.immoflowme.at
                </a>
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">2. Erhebung und Speicherung personenbezogener Daten</h2>
            <p>
              Wir erheben personenbezogene Daten, wenn Sie uns diese im Rahmen Ihrer Registrierung,
              bei der Nutzung unserer Software oder bei Kontaktaufnahme mit uns freiwillig mitteilen.
            </p>
            <h3 className="text-lg font-medium text-foreground mt-4 mb-2">Bei der Registrierung:</h3>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>E-Mail-Adresse</li>
              <li>Name (optional)</li>
              <li>Firmenname (optional)</li>
              <li>Passwort (verschlüsselt gespeichert)</li>
            </ul>
            <h3 className="text-lg font-medium text-foreground mt-4 mb-2">Server-Log-Dateien:</h3>
            <p>
              Bei jedem Zugriff auf unsere Website werden automatisch folgende Daten erfasst:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
              <li>IP-Adresse</li>
              <li>Browsertyp und -version</li>
              <li>Betriebssystem</li>
              <li>Referrer-URL</li>
              <li>Uhrzeit der Serveranfrage</li>
            </ul>
            <h3 className="text-lg font-medium text-foreground mt-4 mb-2">Bei der Nutzung der Software:</h3>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Liegenschaftsdaten (Adresse, Größe, etc.)</li>
              <li>Mieterdaten (Name, Kontaktdaten, Mietverträge)</li>
              <li>Finanzdaten (Mieten, Zahlungen, Betriebskosten)</li>
              <li>Bankverbindungen (IBAN)</li>
              <li>Zählerstände</li>
              <li>Heizkostendaten</li>
              <li>Schadensmeldungen</li>
              <li>Dokumente</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">3. Zweck der Datenverarbeitung</h2>
            <p>Die erhobenen Daten werden verwendet für:</p>
            <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
              <li>Bereitstellung und Betrieb der Hausverwaltungssoftware</li>
              <li>Verwaltung Ihres Benutzerkontos</li>
              <li>Abrechnung und Zahlungsabwicklung</li>
              <li>Kommunikation bezüglich Ihres Kontos und des Services</li>
              <li>Verbesserung unserer Dienste</li>
              <li>Durchführung von Betriebskosten- und Heizkostenabrechnungen gemäß MRG und HeizKG</li>
              <li>Erstellung gesetzlich vorgeschriebener Dokumente und Abrechnungen</li>
              <li>KI-gestützte Dokumentenverarbeitung (nur bei Aktivierung des KI-Autopiloten)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">4. Rechtsgrundlage</h2>
            <p>
              Die Verarbeitung Ihrer Daten erfolgt auf Grundlage von Art. 6 Abs. 1 DSGVO:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4 mt-2">
              <li>
                <span className="font-medium text-foreground">Art. 6 Abs. 1 lit. b DSGVO – Vertragserfüllung:</span>{' '}
                Bereitstellung der Software, Abrechnung von Leistungen
              </li>
              <li>
                <span className="font-medium text-foreground">Art. 6 Abs. 1 lit. c DSGVO – Rechtliche Verpflichtung:</span>{' '}
                Aufbewahrungspflichten gemäß BAO §132, UStG
              </li>
              <li>
                <span className="font-medium text-foreground">Art. 6 Abs. 1 lit. f DSGVO – Berechtigte Interessen:</span>{' '}
                Systemsicherheit, Missbrauchsprävention
              </li>
              <li>
                <span className="font-medium text-foreground">Art. 6 Abs. 1 lit. a DSGVO – Einwilligung:</span>{' '}
                Newsletter, KI-Features, optionale Analysen
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">5. Aufbewahrungsfristen und Löschung</h2>
            <p>
              Personenbezogene Daten werden nur so lange gespeichert, wie es für die jeweiligen Zwecke
              erforderlich ist oder gesetzliche Aufbewahrungsfristen bestehen.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm border border-border rounded-lg">
                <thead>
                  <tr className="bg-muted">
                    <th className="text-left p-3 font-medium text-foreground border-b border-border">Datenkategorie</th>
                    <th className="text-left p-3 font-medium text-foreground border-b border-border">Aufbewahrungsfrist</th>
                    <th className="text-left p-3 font-medium text-foreground border-b border-border">Rechtsgrundlage</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border">
                    <td className="p-3">Vertragsdaten</td>
                    <td className="p-3">7 Jahre nach Vertragsende</td>
                    <td className="p-3">BAO §132</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="p-3">Finanzdaten / Buchführung</td>
                    <td className="p-3">7 Jahre</td>
                    <td className="p-3">BAO §132 Abs. 1</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="p-3">Grundstücksbezogene Unterlagen</td>
                    <td className="p-3">22 Jahre</td>
                    <td className="p-3">§18 UStG</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="p-3">Betriebskostenabrechnungen</td>
                    <td className="p-3">7 Jahre</td>
                    <td className="p-3">BAO §132</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="p-3">Heizkostenabrechnungen</td>
                    <td className="p-3">7 Jahre</td>
                    <td className="p-3">HeizKG + BAO §132</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="p-3">Server-Logs</td>
                    <td className="p-3">90 Tage</td>
                    <td className="p-3">Berechtigtes Interesse</td>
                  </tr>
                  <tr>
                    <td className="p-3">Bewerberdaten</td>
                    <td className="p-3">6 Monate nach Absage</td>
                    <td className="p-3">Berechtigtes Interesse</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-4">
              Nach Ablauf der jeweiligen Frist erfolgt eine automatische Löschung oder Anonymisierung der Daten.
            </p>
            <p className="mt-2 text-sm">
              Die Löschung erfolgt automatisch nach Ablauf der gesetzlichen Aufbewahrungsfristen, sofern
              keine längere Aufbewahrung gesetzlich vorgeschrieben ist.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">6. Datensicherheit</h2>
            <p>
              Wir setzen technische und organisatorische Sicherheitsmaßnahmen (TOMs) ein, um Ihre Daten
              gegen Manipulation, Verlust, Zerstörung oder unbefugten Zugriff zu schützen. Unsere
              Sicherheitsmaßnahmen werden entsprechend der technologischen Entwicklung fortlaufend
              verbessert.
            </p>
            <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
              <li>Verschlüsselte Datenübertragung (TLS 1.2+)</li>
              <li>Verschlüsselte Passwörter (bcrypt)</li>
              <li>Row-Level Security (Mandantentrennung in PostgreSQL)</li>
              <li>Rollenbasiertes Berechtigungssystem (5 Stufen)</li>
              <li>Zwei-Faktor-Authentifizierung (TOTP)</li>
              <li>CSRF-Schutz und Rate-Limiting</li>
              <li>PII-Redaktion in Logs</li>
              <li>Regelmäßige Datensicherungen mit Point-in-Time Recovery</li>
              <li>HTTP-Sicherheitsheader (CSP, HSTS, X-Frame-Options)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">7. Ihre Rechte</h2>
            <p>Sie haben folgende Rechte bezüglich Ihrer personenbezogenen Daten:</p>
            <ul className="list-disc list-inside space-y-2 ml-4 mt-2">
              <li>
                <span className="font-medium text-foreground">Recht auf Auskunft (Art. 15 DSGVO):</span>{' '}
                Sie können Auskunft über die von uns verarbeiteten Daten verlangen.
              </li>
              <li>
                <span className="font-medium text-foreground">Recht auf Berichtigung (Art. 16 DSGVO):</span>{' '}
                Sie können die Berichtigung unrichtiger Daten verlangen.
              </li>
              <li>
                <span className="font-medium text-foreground">Recht auf Löschung (Art. 17 DSGVO):</span>{' '}
                Sie können die Löschung Ihrer Daten verlangen, sofern keine gesetzlichen Aufbewahrungsfristen entgegenstehen.
              </li>
              <li>
                <span className="font-medium text-foreground">Recht auf Einschränkung (Art. 18 DSGVO):</span>{' '}
                Sie können die Einschränkung der Verarbeitung verlangen.
              </li>
              <li>
                <span className="font-medium text-foreground">Recht auf Datenübertragbarkeit (Art. 20 DSGVO):</span>{' '}
                Sie können Ihre Daten in einem gängigen Format (CSV, XLSX) erhalten.
              </li>
              <li>
                <span className="font-medium text-foreground">Widerspruchsrecht (Art. 21 DSGVO):</span>{' '}
                Sie können der Verarbeitung aufgrund berechtigter Interessen widersprechen.
              </li>
              <li>
                <span className="font-medium text-foreground">Beschwerderecht:</span>{' '}
                Sie haben das Recht, sich bei der Österreichischen Datenschutzbehörde (DSB) zu beschweren:{' '}
                <a href="mailto:dsb@dsb.gv.at" className="text-primary hover:underline">dsb@dsb.gv.at</a>,{' '}
                <a href="https://www.dsb.gv.at" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  https://www.dsb.gv.at
                </a>
              </li>
            </ul>
            <p className="mt-4">
              Zur Ausübung Ihrer Rechte wenden Sie sich bitte an:{' '}
              <a href="mailto:datenschutz@immoflowme.at" className="text-primary hover:underline">
                datenschutz@immoflowme.at
              </a>
            </p>
            <p className="mt-2 text-sm">
              Wir beantworten Ihre Anfrage innerhalb von 30 Tagen.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">8. Cookies</h2>
            <p>
              Unsere Website verwendet Cookies. Bei Cookies handelt es sich um kleine Textdateien,
              die auf Ihrem Endgerät gespeichert werden.
            </p>
            <h3 className="text-lg font-medium text-foreground mt-4 mb-2">Technisch notwendige Cookies:</h3>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Session-Cookie (für die Authentifizierung)</li>
              <li>CSRF-Token (für den Schutz vor Cross-Site-Request-Forgery)</li>
              <li>Cookie-Consent-Präferenz</li>
            </ul>
            <h3 className="text-lg font-medium text-foreground mt-4 mb-2">Optionale Cookies (nur mit Einwilligung):</h3>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Analyse-Cookies zur Verbesserung unseres Angebots</li>
            </ul>
            <p className="mt-4">
              Wir verwenden keine Tracking-Cookies von Drittanbietern.
            </p>
            <p className="mt-2">
              Sie können Ihre Einwilligung jederzeit über den Cookie-Banner widerrufen.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">9. Sub-Auftragsverarbeiter</h2>
            <p>
              Zur Erbringung unserer Dienstleistungen setzen wir folgende Sub-Auftragsverarbeiter ein:
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm border border-border rounded-lg">
                <thead>
                  <tr className="bg-muted">
                    <th className="text-left p-3 font-medium text-foreground border-b border-border">Dienstleister</th>
                    <th className="text-left p-3 font-medium text-foreground border-b border-border">Zweck</th>
                    <th className="text-left p-3 font-medium text-foreground border-b border-border">Standort</th>
                    <th className="text-left p-3 font-medium text-foreground border-b border-border">Garantien</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border">
                    <td className="p-3">Neon Inc.</td>
                    <td className="p-3">Datenbank-Hosting</td>
                    <td className="p-3">EU</td>
                    <td className="p-3">DSGVO-konform, EU-Hosting</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="p-3">Replit Inc.</td>
                    <td className="p-3">Anwendungs-Hosting</td>
                    <td className="p-3">EU/US</td>
                    <td className="p-3">Standardvertragsklauseln</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="p-3">Stripe Inc.</td>
                    <td className="p-3">Zahlungsabwicklung</td>
                    <td className="p-3">EU</td>
                    <td className="p-3">PCI-DSS, Standardvertragsklauseln</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="p-3">Resend Inc.</td>
                    <td className="p-3">E-Mail-Versand</td>
                    <td className="p-3">EU/US</td>
                    <td className="p-3">Standardvertragsklauseln</td>
                  </tr>
                  <tr>
                    <td className="p-3">OpenAI Inc.</td>
                    <td className="p-3">KI-Features (optional)</td>
                    <td className="p-3">US</td>
                    <td className="p-3">Standardvertragsklauseln, nur bei Aktivierung</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-4">
              Eine aktuelle Liste unserer Sub-Auftragsverarbeiter finden Sie in unserem{' '}
              <Link to="/avv" className="text-primary hover:underline">
                Auftragsverarbeitungsvertrag (AVV)
              </Link>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">10. Hosting</h2>
            <p>
              Unsere Website und Anwendung werden auf Servern von vertrauenswürdigen Cloud-Anbietern
              gehostet, die die Anforderungen der DSGVO erfüllen. Die Datenbank wird über Neon Inc.
              (PostgreSQL) mit Standort in der EU betrieben. Ihre Daten werden primär in der
              Europäischen Union gespeichert.
            </p>
            <p className="mt-2">
              Für US-basierte Sub-Auftragsverarbeiter bestehen Standardvertragsklauseln (SCCs) gemäß
              Art. 46 Abs. 2 lit. c DSGVO als geeignete Garantien für den Datentransfer.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">11. Datenübermittlung in Drittländer</h2>
            <p>
              Einige unserer Sub-Auftragsverarbeiter haben ihren Sitz in den USA. Der Datentransfer
              in diese Drittländer ist durch EU-Standardvertragsklauseln (Durchführungsbeschluss
              2021/914 der Europäischen Kommission) abgesichert.
            </p>
            <p className="mt-2">
              Wir haben ein Transfer Impact Assessment (TIA) durchgeführt, um sicherzustellen, dass
              Ihre Daten auch bei der Übermittlung in Drittländer angemessen geschützt sind.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">12. Änderungen</h2>
            <p>
              Wir behalten uns vor, diese Datenschutzerklärung anzupassen, um sie stets an die
              aktuellen rechtlichen Anforderungen anzupassen oder um Änderungen unserer Leistungen
              umzusetzen.
            </p>
            <p className="mt-2 text-sm">Stand: Februar 2026</p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-border flex flex-wrap gap-6 text-sm">
          <Link to="/impressum" className="text-muted-foreground hover:text-foreground">
            Impressum
          </Link>
          <Link to="/agb" className="text-muted-foreground hover:text-foreground">
            AGB
          </Link>
          <Link to="/avv" className="text-muted-foreground hover:text-foreground">
            AVV
          </Link>
          <Link to="/sla" className="text-muted-foreground hover:text-foreground">
            SLA
          </Link>
        </div>
      </main>
    </div>
  );
}