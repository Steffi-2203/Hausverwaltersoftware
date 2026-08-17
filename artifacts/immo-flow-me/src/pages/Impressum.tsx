import { Link } from 'react-router-dom';
import { ArrowLeft, Building2, Mail, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Impressum() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-xl text-foreground">ImmoFlowMe</span>
          </Link>
          <Link to="/">
            <Button variant="ghost" size="sm" data-testid="button-back-impressum">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Zurück
            </Button>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl font-bold text-foreground mb-8">Impressum</h1>

        <div className="space-y-8 text-muted-foreground">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">Angaben gemäß § 5 ECG</h2>
            <div className="space-y-2">
              <p className="font-medium text-foreground">Stephania Pfeffer - ImmoFlowMe</p>
              <p>[Adresse wird ergänzt]</p>
              <p>Einzelunternehmen nach österreichischem Recht</p>
              <p>UID-Nummer: [wird nach Erteilung ergänzt]</p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">Kontakt</h2>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                <a href="mailto:kontakt@immoflowme.at" className="text-primary hover:underline">
                  kontakt@immoflowme.at
                </a>
              </div>
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4" />
                <a href="https://www.immoflowme.at" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  https://www.immoflowme.at
                </a>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">Unternehmensgegenstand</h2>
            <p>
              Entwicklung und Betrieb einer webbasierten Hausverwaltungssoftware für 
              professionelle Hausverwaltungen jeder Größe sowie Privatvermieter in Österreich.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">Aufsichtsbehörde</h2>
            <p>
              Österreichische Datenschutzbehörde (DSB), Barichgasse 40-42, 1030 Wien, dsb@dsb.gv.at, <a href="https://www.dsb.gv.at" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">https://www.dsb.gv.at</a>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">EU-Streitschlichtung</h2>
            <p>
              Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:{' '}
              <a 
                href="https://ec.europa.eu/consumers/odr" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                https://ec.europa.eu/consumers/odr
              </a>
            </p>
            <p className="mt-2">
              Unsere E-Mail-Adresse finden Sie oben im Impressum.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">Haftung für Inhalte</h2>
            <p>
              Als Diensteanbieter sind wir gemäß § 7 Abs.1 ECG für eigene Inhalte auf diesen Seiten 
              nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 ECG sind wir als 
              Diensteanbieter jedoch nicht unter der Pflicht, übermittelte oder gespeicherte fremde 
              Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige 
              Tätigkeit hinweisen.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">Haftung für Links</h2>
            <p>
              Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen 
              Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen. 
              Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der 
              Seiten verantwortlich.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">Urheberrecht</h2>
            <p>
              Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen 
              dem österreichischen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede 
              Art der Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen 
              Zustimmung des jeweiligen Autors bzw. Erstellers.
            </p>
          </section>
        </div>

        {/* Footer Links */}
        <div className="mt-12 pt-8 border-t border-border flex flex-wrap gap-6 text-sm">
          <Link to="/datenschutz" className="text-muted-foreground hover:text-foreground">
            Datenschutz
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