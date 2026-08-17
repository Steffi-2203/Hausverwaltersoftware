import { Link } from 'react-router-dom';
import { ArrowLeft, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AVV() {
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
            <Button variant="ghost" size="sm" data-testid="button-back-avv">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Zurück
            </Button>
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl font-bold text-foreground mb-2">Auftragsverarbeitungsvertrag (AVV)</h1>
        <p className="text-sm text-muted-foreground mb-4">Stand: Februar 2026</p>

        <div className="rounded-md border border-border bg-card p-4 mb-8">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">Hinweis:</span> Dieser AVV dient als Muster und sollte vor Verwendung von einem Rechtsanwalt geprüft werden.
          </p>
        </div>

        <div className="space-y-8 text-muted-foreground">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">Präambel</h2>
            <p>
              Dieser Auftragsverarbeitungsvertrag (nachfolgend „AVV") wird gemäß Art. 28 der Verordnung (EU) 2016/679 
              (Datenschutz-Grundverordnung, nachfolgend „DSGVO") zwischen dem Kunden der SaaS-Plattform ImmoFlowMe 
              (nachfolgend „Verantwortlicher") und Stephania Pfeffer – ImmoFlowMe, als Betreiberin der 
              SaaS-Hausverwaltungssoftware ImmoFlowMe (nachfolgend „Auftragsverarbeiter"), geschlossen.
            </p>
            <p className="mt-2">
              Der Verantwortliche ist eine Hausverwaltung oder ein Immobilienverwalter, der die Software ImmoFlowMe 
              zur Verwaltung von Liegenschaften, Mietverhältnissen und damit verbundenen personenbezogenen Daten nutzt. 
              Der Auftragsverarbeiter stellt die technische Infrastruktur und den Betrieb der Software bereit und 
              verarbeitet personenbezogene Daten ausschließlich im Auftrag und nach Weisung des Verantwortlichen.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">§ 1 Gegenstand und Dauer</h2>
            <p>
              (1) Gegenstand dieses AVV ist die Verarbeitung personenbezogener Daten durch den Auftragsverarbeiter 
              im Rahmen der Bereitstellung der SaaS-Hausverwaltungssoftware ImmoFlowMe. Die Software dient der 
              digitalen Verwaltung von Liegenschaften, Mietverhältnissen, Eigentümerverhältnissen, Abrechnungen, 
              Dokumenten und der Kommunikation mit Mietern, Eigentümern und Dienstleistern.
            </p>
            <p className="mt-2">
              (2) Die Dauer dieses AVV richtet sich nach der Laufzeit des zwischen dem Verantwortlichen und dem 
              Auftragsverarbeiter geschlossenen Hauptvertrages (Nutzungsvertrag/Abonnement). Der AVV endet 
              automatisch mit Beendigung des Hauptvertrages, unbeschadet etwaiger Aufbewahrungspflichten gemäß § 10 
              dieses AVV.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">§ 2 Art und Zweck der Verarbeitung</h2>
            <p>
              Die Verarbeitung personenbezogener Daten erfolgt zum Zweck der Bereitstellung und des Betriebs der 
              SaaS-Hausverwaltungssoftware ImmoFlowMe. Dies umfasst insbesondere:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Hosting und Speicherung von Hausverwaltungsdaten in der Cloud</li>
              <li>Verarbeitung von Mieterdaten (Stammdaten, Mietverträge, Zahlungen)</li>
              <li>Verarbeitung von Eigentümerdaten (Stammdaten, Abrechnungen, Ausschüttungen)</li>
              <li>Verarbeitung von Finanzdaten (Vorschreibungen, Zahlungseingänge, Betriebskostenabrechnungen)</li>
              <li>Dokumentenverwaltung und -speicherung</li>
              <li>E-Mail-Kommunikation und Benachrichtigungen</li>
              <li>Erstellung von Berichten und Auswertungen</li>
              <li>Optionale KI-gestützte Analyse und Textverarbeitung</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">§ 3 Kategorien betroffener Personen</h2>
            <p>Die von der Verarbeitung betroffenen Personenkategorien umfassen:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Mieterinnen und Mieter der verwalteten Liegenschaften</li>
              <li>Eigentümerinnen und Eigentümer der verwalteten Liegenschaften</li>
              <li>Mitarbeiterinnen und Mitarbeiter der Hausverwaltung (des Verantwortlichen)</li>
              <li>Dienstleister und Auftragnehmer (z. B. Handwerker, Hausbesorger, Versicherungen)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">§ 4 Kategorien personenbezogener Daten</h2>
            <p>Folgende Kategorien personenbezogener Daten werden verarbeitet:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Vor- und Nachnamen</li>
              <li>Anschriften und Wohnadressen</li>
              <li>Kontaktdaten (E-Mail-Adressen, Telefonnummern)</li>
              <li>Bankverbindungen (IBAN, BIC) und Zahlungsdaten</li>
              <li>Mietvertragsdaten (Mietbeginn, Mietende, Mietzins, Kaution)</li>
              <li>Zahlungsdaten (Vorschreibungen, Zahlungseingänge, offene Posten)</li>
              <li>Zählerstände und Verbrauchsdaten</li>
              <li>Korrespondenz (E-Mails, Nachrichten, Mahnungen, Protokolle)</li>
              <li>Dokumente (Verträge, Rechnungen, Bescheide, Protokolle)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">§ 5 Pflichten des Auftragsverarbeiters</h2>
            <p>Der Auftragsverarbeiter verpflichtet sich:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>
                Personenbezogene Daten ausschließlich auf dokumentierte Weisung des Verantwortlichen zu verarbeiten, 
                es sei denn, der Auftragsverarbeiter ist nach dem Recht der Union oder der Mitgliedstaaten, dem er 
                unterliegt, zur Verarbeitung verpflichtet (Art. 28 Abs. 3 lit. a DSGVO).
              </li>
              <li>
                Sicherzustellen, dass sich die zur Verarbeitung der personenbezogenen Daten befugten Personen zur 
                Vertraulichkeit verpflichtet haben oder einer angemessenen gesetzlichen Verschwiegenheitspflicht 
                unterliegen (Art. 28 Abs. 3 lit. b DSGVO).
              </li>
              <li>
                Alle gemäß Art. 32 DSGVO erforderlichen technisch-organisatorischen Maßnahmen (TOM) zu ergreifen 
                (siehe § 6 dieses AVV).
              </li>
              <li>
                Den Verantwortlichen bei der Erfüllung der Pflichten aus den Art. 32 bis 36 DSGVO zu unterstützen, 
                insbesondere bei der Beantwortung von Anfragen betroffener Personen gemäß Art. 15 bis 22 DSGVO.
              </li>
              <li>
                Nach Abschluss der Verarbeitungstätigkeiten alle personenbezogenen Daten nach Wahl des 
                Verantwortlichen zu löschen oder zurückzugeben, sofern nicht eine gesetzliche Aufbewahrungspflicht 
                besteht (siehe § 10 dieses AVV).
              </li>
              <li>
                Dem Verantwortlichen alle erforderlichen Informationen zum Nachweis der Einhaltung der in Art. 28 
                DSGVO niedergelegten Pflichten zur Verfügung zu stellen und Überprüfungen einschließlich Inspektionen 
                zu ermöglichen (siehe § 11 dieses AVV).
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">§ 6 Technisch-organisatorische Maßnahmen (TOM)</h2>
            <p>
              Der Auftragsverarbeiter hat folgende technisch-organisatorische Maßnahmen gemäß Art. 32 DSGVO 
              implementiert:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>
                <span className="font-medium text-foreground">Verschlüsselung der Datenübertragung:</span> Sämtliche 
                Datenübertragungen erfolgen über SSL/TLS-verschlüsselte Verbindungen (HTTPS).
              </li>
              <li>
                <span className="font-medium text-foreground">Rollenbasierte Zugriffskontrolle:</span> Implementierung 
                eines 5-stufigen Rollenmodells (Admin, Manager, Buchhalter, Mitarbeiter, Nur-Lesen) zur 
                Beschränkung des Datenzugriffs nach dem Need-to-know-Prinzip.
              </li>
              <li>
                <span className="font-medium text-foreground">Row-Level Security (RLS):</span> PostgreSQL 
                Row-Level-Security-Policies stellen sicher, dass Mandanten ausschließlich auf ihre eigenen Daten 
                zugreifen können (Mandantentrennung).
              </li>
              <li>
                <span className="font-medium text-foreground">Passwort-Hashing:</span> Sämtliche Passwörter werden 
                mittels bcrypt gehasht und gesalzen gespeichert.
              </li>
              <li>
                <span className="font-medium text-foreground">Audit-Logging:</span> Alle sicherheitsrelevanten 
                Aktionen werden protokolliert (Zugriffe, Änderungen, Löschungen).
              </li>
              <li>
                <span className="font-medium text-foreground">Regelmäßige Datensicherung:</span> Automatische Backups 
                der Datenbank über Neon mit Point-in-Time Recovery.
              </li>
              <li>
                <span className="font-medium text-foreground">CSRF-Schutz:</span> Implementierung von 
                Cross-Site-Request-Forgery-Schutzmaßnahmen.
              </li>
              <li>
                <span className="font-medium text-foreground">Rate Limiting:</span> Begrenzung der Anzahl von 
                API-Anfragen zum Schutz vor Brute-Force- und DDoS-Angriffen.
              </li>
              <li>
                <span className="font-medium text-foreground">PII-Schwärzung in Logs:</span> Personenbezogene Daten 
                werden in Anwendungsprotokollen automatisch geschwärzt (PII Redaction).
              </li>
              <li>
                <span className="font-medium text-foreground">Zwei-Faktor-Authentifizierung (2FA):</span> Unterstützung 
                von Zwei-Faktor-Authentifizierung für zusätzliche Kontosicherheit.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">§ 7 Sub-Auftragsverarbeiter</h2>
            <p>
              (1) Der Verantwortliche erteilt dem Auftragsverarbeiter die allgemeine Genehmigung, weitere 
              Auftragsverarbeiter (Sub-Auftragsverarbeiter) hinzuzuziehen. Der Auftragsverarbeiter informiert den 
              Verantwortlichen über jede beabsichtigte Änderung in Bezug auf die Hinzuziehung oder die Ersetzung 
              von Sub-Auftragsverarbeitern.
            </p>
            <p className="mt-2">
              (2) Folgende Sub-Auftragsverarbeiter werden derzeit eingesetzt:
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse border border-border text-sm">
                <thead>
                  <tr className="bg-card">
                    <th className="border border-border px-4 py-2 text-left text-foreground font-semibold">Unternehmen</th>
                    <th className="border border-border px-4 py-2 text-left text-foreground font-semibold">Zweck</th>
                    <th className="border border-border px-4 py-2 text-left text-foreground font-semibold">Standort</th>
                    <th className="border border-border px-4 py-2 text-left text-foreground font-semibold">Anmerkung</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-border px-4 py-2 font-medium text-foreground">Neon Inc.</td>
                    <td className="border border-border px-4 py-2">Datenbank-Hosting (PostgreSQL)</td>
                    <td className="border border-border px-4 py-2">EU</td>
                    <td className="border border-border px-4 py-2">—</td>
                  </tr>
                  <tr>
                    <td className="border border-border px-4 py-2 font-medium text-foreground">Replit Inc.</td>
                    <td className="border border-border px-4 py-2">Applikations-Hosting</td>
                    <td className="border border-border px-4 py-2">EU/US</td>
                    <td className="border border-border px-4 py-2">—</td>
                  </tr>
                  <tr>
                    <td className="border border-border px-4 py-2 font-medium text-foreground">Stripe Inc.</td>
                    <td className="border border-border px-4 py-2">Zahlungsabwicklung</td>
                    <td className="border border-border px-4 py-2">EU</td>
                    <td className="border border-border px-4 py-2">—</td>
                  </tr>
                  <tr>
                    <td className="border border-border px-4 py-2 font-medium text-foreground">Resend Inc.</td>
                    <td className="border border-border px-4 py-2">E-Mail-Zustellung</td>
                    <td className="border border-border px-4 py-2">EU/US</td>
                    <td className="border border-border px-4 py-2">—</td>
                  </tr>
                  <tr>
                    <td className="border border-border px-4 py-2 font-medium text-foreground">OpenAI Inc.</td>
                    <td className="border border-border px-4 py-2">KI-Funktionen (optional)</td>
                    <td className="border border-border px-4 py-2">US</td>
                    <td className="border border-border px-4 py-2">
                      Datenübermittlung in die USA auf Grundlage von Standardvertragsklauseln (SCC) gemäß 
                      Art. 46 Abs. 2 lit. c DSGVO. KI-Funktionen sind optional und können vom Verantwortlichen 
                      deaktiviert werden.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-4">
              (3) Der Verantwortliche hat das Recht, gegen die Hinzuziehung neuer oder die Ersetzung bestehender 
              Sub-Auftragsverarbeiter Einspruch zu erheben. Der Einspruch muss innerhalb von 14 Tagen nach 
              Benachrichtigung schriftlich beim Auftragsverarbeiter eingehen. Erhebt der Verantwortliche 
              berechtigten Einspruch, wird der Auftragsverarbeiter den betreffenden Sub-Auftragsverarbeiter nicht 
              einsetzen oder eine angemessene Alternative anbieten.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">§ 8 Meldung von Datenschutzverletzungen</h2>
            <p>
              (1) Der Auftragsverarbeiter unterrichtet den Verantwortlichen unverzüglich, nachdem ihm eine 
              Verletzung des Schutzes personenbezogener Daten bekannt geworden ist. Die Meldung erfolgt 
              grundsätzlich innerhalb von 72 Stunden nach Bekanntwerden der Verletzung, um dem Verantwortlichen 
              die Einhaltung seiner Meldepflicht gemäß Art. 33 DSGVO gegenüber der Aufsichtsbehörde zu 
              ermöglichen.
            </p>
            <p className="mt-2">
              (2) Die Meldung enthält mindestens folgende Informationen:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Beschreibung der Art der Verletzung des Schutzes personenbezogener Daten</li>
              <li>Kategorien und ungefähre Anzahl der betroffenen Personen</li>
              <li>Kategorien und ungefähre Anzahl der betroffenen Datensätze</li>
              <li>Beschreibung der wahrscheinlichen Folgen der Verletzung</li>
              <li>Beschreibung der ergriffenen oder vorgeschlagenen Maßnahmen zur Behebung der Verletzung</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">§ 9 Unterstützungspflichten</h2>
            <p>
              (1) Der Auftragsverarbeiter unterstützt den Verantwortlichen unter Berücksichtigung der Art der 
              Verarbeitung und der ihm zur Verfügung stehenden Informationen bei:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>
                Der Durchführung einer Datenschutz-Folgenabschätzung (DSFA) gemäß Art. 35 DSGVO, soweit dies 
                für die vom Auftragsverarbeiter durchgeführte Verarbeitung erforderlich ist.
              </li>
              <li>
                Der Beantwortung von Anfragen betroffener Personen hinsichtlich der Ausübung ihrer Rechte gemäß 
                Art. 15 bis 22 DSGVO (Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit, 
                Widerspruch).
              </li>
              <li>
                Der Erfüllung der Meldepflichten bei Datenschutzverletzungen gemäß Art. 33 und Art. 34 DSGVO.
              </li>
              <li>
                Der Dokumentation aller Verarbeitungstätigkeiten gemäß Art. 30 Abs. 2 DSGVO.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">§ 10 Löschung und Rückgabe</h2>
            <p>
              (1) Nach Beendigung des Hauptvertrages stellt der Auftragsverarbeiter dem Verantwortlichen 
              innerhalb von 30 Tagen die Möglichkeit zur Verfügung, sämtliche personenbezogene Daten in einem 
              gängigen, maschinenlesbaren Format zu exportieren (Datenexport).
            </p>
            <p className="mt-2">
              (2) Nach Ablauf der 30-Tage-Frist oder nach erfolgtem Datenexport löscht der Auftragsverarbeiter 
              sämtliche personenbezogene Daten des Verantwortlichen unwiderruflich, es sei denn, gesetzliche 
              Aufbewahrungspflichten stehen dem entgegen.
            </p>
            <p className="mt-2">
              (3) Folgende gesetzliche Aufbewahrungsfristen nach österreichischem Recht sind zu beachten:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>
                <span className="font-medium text-foreground">7 Jahre:</span> Finanzdaten und Buchungsbelege 
                gemäß § 132 Bundesabgabenordnung (BAO).
              </li>
              <li>
                <span className="font-medium text-foreground">22 Jahre:</span> Unterlagen betreffend 
                Grundstücke gemäß § 18 Abs. 10 UStG (Umsatzsteuergesetz) in Verbindung mit der 
                Aufbewahrungspflicht für Immobiliengeschäfte.
              </li>
            </ul>
            <p className="mt-2">
              (4) Der Auftragsverarbeiter bestätigt dem Verantwortlichen die vollständige Löschung der Daten 
              schriftlich, sobald diese durchgeführt wurde.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">§ 11 Nachweispflichten und Kontrollrechte</h2>
            <p>
              (1) Der Auftragsverarbeiter stellt dem Verantwortlichen alle erforderlichen Informationen zum 
              Nachweis der Einhaltung der in Art. 28 DSGVO niedergelegten Pflichten zur Verfügung.
            </p>
            <p className="mt-2">
              (2) Der Verantwortliche hat das Recht, Überprüfungen – einschließlich Inspektionen – durchzuführen 
              oder durch einen beauftragten Prüfer durchführen zu lassen. Solche Überprüfungen sind mit 
              angemessener Vorankündigung (mindestens 14 Werktage) und unter Wahrung der Vertraulichkeit 
              durchzuführen.
            </p>
            <p className="mt-2">
              (3) Die Kosten einer solchen Überprüfung werden zwischen dem Verantwortlichen und dem 
              Auftragsverarbeiter anteilig getragen, sofern die Überprüfung nicht aufgrund eines begründeten 
              Verdachts auf einen Verstoß gegen die Bestimmungen dieses AVV oder der DSGVO veranlasst wird. 
              In letzterem Fall trägt der Auftragsverarbeiter die Kosten.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">§ 12 Schlussbestimmungen</h2>
            <p>
              (1) Dieser AVV unterliegt österreichischem Recht. Gerichtsstand ist der Sitz des 
              Auftragsverarbeiters in Österreich, soweit gesetzlich zulässig.
            </p>
            <p className="mt-2">
              (2) Sollten einzelne Bestimmungen dieses AVV unwirksam oder undurchführbar sein oder werden, so 
              bleibt die Wirksamkeit der übrigen Bestimmungen hiervon unberührt. An die Stelle der unwirksamen 
              oder undurchführbaren Bestimmung tritt eine solche, die dem wirtschaftlichen Zweck der unwirksamen 
              oder undurchführbaren Bestimmung am nächsten kommt (Salvatorische Klausel).
            </p>
            <p className="mt-2">
              (3) Änderungen und Ergänzungen dieses AVV bedürfen der Schriftform. Dies gilt auch für die 
              Aufhebung dieses Schriftformerfordernisses.
            </p>
            <p className="mt-2">
              (4) Dieser AVV ist Bestandteil des Hauptvertrages zwischen dem Verantwortlichen und dem 
              Auftragsverarbeiter über die Nutzung der SaaS-Plattform ImmoFlowMe.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-border flex flex-wrap gap-6 text-sm">
          <Link to="/impressum" className="text-muted-foreground hover:text-foreground">
            Impressum
          </Link>
          <Link to="/datenschutz" className="text-muted-foreground hover:text-foreground">
            Datenschutz
          </Link>
          <Link to="/agb" className="text-muted-foreground hover:text-foreground">
            AGB
          </Link>
          <Link to="/sla" className="text-muted-foreground hover:text-foreground">
            SLA
          </Link>
        </div>
      </main>
    </div>
  );
}