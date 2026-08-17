import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  ClipboardList,
  ArrowRight,
  ArrowLeft,
  Check,
  Calculator,
  AlertTriangle,
  UserPlus,
  TrendingUp,
  Mail,
  Clock,
  X,
} from 'lucide-react';

interface WorkflowStep {
  title: string;
  description: string;
  linkLabel?: string;
  linkTo?: string;
}

interface WorkflowDefinition {
  id: string;
  title: string;
  description: string;
  icon: typeof ClipboardList;
  estimatedMinutes: number;
  steps: WorkflowStep[];
}

const workflows: WorkflowDefinition[] = [
  {
    id: 'bk-settlement',
    title: 'Betriebskostenabrechnung',
    description: 'Erstellen Sie die j\u00e4hrliche Betriebskostenabrechnung f\u00fcr Ihre Liegenschaften mit automatischer Verteilung nach Schl\u00fcssel.',
    icon: Calculator,
    estimatedMinutes: 30,
    steps: [
      {
        title: 'Liegenschaft ausw\u00e4hlen',
        description: 'W\u00e4hlen Sie die Liegenschaft aus, f\u00fcr die Sie die Betriebskostenabrechnung erstellen m\u00f6chten. Stellen Sie sicher, dass alle Einheiten und Mieter korrekt erfasst sind.',
        linkLabel: 'Zur Liegenschaftsansicht',
        linkTo: '/liegenschaften',
      },
      {
        title: 'Abrechnungszeitraum festlegen',
        description: 'Legen Sie das Abrechnungsjahr fest. In der Regel wird das Vorjahr abgerechnet. Der Zeitraum muss mit dem Wirtschaftsjahr \u00fcbereinstimmen.',
        linkLabel: 'Zur BK-Abrechnung',
        linkTo: '/abrechnung',
      },
      {
        title: 'Kosten pr\u00fcfen',
        description: 'Pr\u00fcfen Sie alle umlagef\u00e4higen Betriebskosten f\u00fcr den gew\u00e4hlten Zeitraum. Kontrollieren Sie, ob alle Rechnungen erfasst und den richtigen Kostenarten zugeordnet sind.',
        linkLabel: 'Zur Kostenansicht',
        linkTo: '/kosten',
      },
      {
        title: 'Verteilungsschl\u00fcssel kontrollieren',
        description: '\u00dcberpr\u00fcfen Sie die Verteilungsschl\u00fcssel (MEA, Quadratmeter, Personen) f\u00fcr jede Kostenart. Stellen Sie sicher, dass die Werte bei allen Einheiten korrekt hinterlegt sind.',
        linkLabel: 'Zu den Verteilungsschl\u00fcsseln',
        linkTo: '/einstellungen?tab=distribution',
      },
      {
        title: 'Abrechnung generieren',
        description: 'Generieren Sie die Betriebskostenabrechnung. Das System berechnet die Verteilung automatisch und erstellt individuelle Abrechnungen pro Mieter.',
        linkLabel: 'Zur BK-Abrechnung',
        linkTo: '/abrechnung',
      },
      {
        title: 'Versand & Archivierung',
        description: 'Versenden Sie die Abrechnungen per E-Mail an die Mieter und archivieren Sie die Dokumente. Beachten Sie die gesetzliche Frist von 6 Monaten nach Ende des Abrechnungszeitraums.',
        linkLabel: 'Zu den Dokumenten',
        linkTo: '/dokumente',
      },
    ],
  },
  {
    id: 'dunning-run',
    title: 'Mahnlauf',
    description: 'F\u00fchren Sie einen strukturierten Mahnlauf f\u00fcr \u00fcberf\u00e4llige Zahlungen durch und generieren Sie Mahnschreiben.',
    icon: AlertTriangle,
    estimatedMinutes: 15,
    steps: [
      {
        title: 'Stichtag festlegen',
        description: 'Legen Sie den Stichtag f\u00fcr den Mahnlauf fest. Alle Zahlungen, die zu diesem Datum \u00fcberf\u00e4llig sind, werden ber\u00fccksichtigt.',
        linkLabel: 'Zum Mahnwesen',
        linkTo: '/zahlungen?tab=dunning',
      },
      {
        title: '\u00dcberf\u00e4llige Zahlungen pr\u00fcfen',
        description: 'Pr\u00fcfen Sie die Liste der \u00fcberf\u00e4lligen Zahlungen. Kontrollieren Sie, ob eingegangene Zahlungen bereits verbucht wurden und ob Ratenzahlungsvereinbarungen bestehen.',
        linkLabel: 'Zur Zahlungs\u00fcbersicht',
        linkTo: '/zahlungen',
      },
      {
        title: 'Mahnstufe zuweisen',
        description: 'Weisen Sie jedem offenen Posten die passende Mahnstufe zu (1. Mahnung, 2. Mahnung, letzte Mahnung). Beachten Sie die gesetzlichen Vorschriften des MRG.',
        linkLabel: 'Zum Mahnwesen',
        linkTo: '/zahlungen?tab=dunning',
      },
      {
        title: 'Mahnschreiben generieren',
        description: 'Generieren Sie die Mahnschreiben f\u00fcr alle ausgew\u00e4hlten Posten. Die Schreiben enthalten automatisch die korrekten Betr\u00e4ge, Fristen und Bankverbindungen.',
        linkLabel: 'Zu den Serienbriefen',
        linkTo: '/serienbriefe',
      },
      {
        title: 'Versand',
        description: 'Versenden Sie die Mahnschreiben per E-Mail oder drucken Sie diese zum postalischen Versand aus. Dokumentieren Sie den Versand f\u00fcr die Nachweisf\u00fchrung.',
        linkLabel: 'Zu den Dokumenten',
        linkTo: '/dokumente',
      },
    ],
  },
  {
    id: 'rent-adjustment',
    title: 'Mietanpassung / VPI',
    description: 'Passen Sie die Mieten basierend auf dem Verbraucherpreisindex (VPI) an und erstellen Sie die gesetzlich vorgeschriebenen Ank\u00fcndigungen.',
    icon: TrendingUp,
    estimatedMinutes: 20,
    steps: [
      {
        title: 'Mieter oder Liegenschaft ausw\u00e4hlen',
        description: 'W\u00e4hlen Sie die Mieter oder eine gesamte Liegenschaft aus, f\u00fcr die eine Mietanpassung durchgef\u00fchrt werden soll. Pr\u00fcfen Sie die vertraglichen Indexierungsklauseln.',
        linkLabel: 'Zur Mieteransicht',
        linkTo: '/mieter',
      },
      {
        title: 'VPI-Index aktuell pr\u00fcfen',
        description: 'Pr\u00fcfen Sie den aktuellen Verbraucherpreisindex (VPI 2020) der Statistik Austria. Vergleichen Sie den aktuellen Index mit dem Basisindex aus dem Mietvertrag.',
        linkLabel: 'Zur VPI-Anpassung',
        linkTo: '/zahlungen?tab=vpi',
      },
      {
        title: 'Neue Miete berechnen',
        description: 'Berechnen Sie die neue Miete basierend auf der Indexver\u00e4nderung. Das System ber\u00fccksichtigt automatisch die Schwellenwerte und Rundungsregeln.',
        linkLabel: 'Zur VPI-Anpassung',
        linkTo: '/zahlungen?tab=vpi',
      },
      {
        title: 'Ank\u00fcndigung erstellen',
        description: 'Erstellen Sie das gesetzlich vorgeschriebene Ank\u00fcndigungsschreiben. Beachten Sie die Ank\u00fcndigungsfrist von mindestens 14 Tagen vor Wirksamkeit.',
        linkLabel: 'Zu den Serienbriefen',
        linkTo: '/serienbriefe',
      },
      {
        title: 'Mietanpassung durchf\u00fchren',
        description: 'F\u00fchren Sie die Mietanpassung im System durch. Die neuen Betr\u00e4ge werden automatisch in den Vorschreibungen ber\u00fccksichtigt.',
        linkLabel: 'Zur VPI-Anpassung',
        linkTo: '/zahlungen?tab=vpi',
      },
    ],
  },
  {
    id: 'new-tenant',
    title: 'Neuer Mieter einziehen',
    description: 'F\u00fchren Sie alle Schritte f\u00fcr den Einzug eines neuen Mieters durch \u2013 von der Datenerfassung bis zum Willkommensschreiben.',
    icon: UserPlus,
    estimatedMinutes: 25,
    steps: [
      {
        title: 'Einheit ausw\u00e4hlen',
        description: 'W\u00e4hlen Sie die freie Einheit aus, in die der neue Mieter einziehen soll. Pr\u00fcfen Sie, ob die Einheit aktuell als leer gemeldet ist und alle Daten korrekt sind.',
        linkLabel: 'Zur Einheitenansicht',
        linkTo: '/einheiten',
      },
      {
        title: 'Mieterdaten erfassen',
        description: 'Erfassen Sie alle relevanten Daten des neuen Mieters: Name, Adresse, Kontaktdaten, Geburtsdatum und steuerliche Informationen.',
        linkLabel: 'Neuen Mieter anlegen',
        linkTo: '/mieter/neu',
      },
      {
        title: 'Mietvertrag anlegen',
        description: 'Legen Sie den Mietvertrag mit Mietbeginn, Hauptmietzins, Betriebskostenvorschuss und Vertragslaufzeit an. Beachten Sie die MRG-Konformit\u00e4t.',
        linkLabel: 'Zur Mieteransicht',
        linkTo: '/mieter',
      },
      {
        title: 'Kaution erfassen',
        description: 'Erfassen Sie die vereinbarte Kaution. Dokumentieren Sie den Eingang und die Veranlagung des Kautionsbetrags auf einem separaten Sparkonto.',
        linkLabel: 'Zur Zahlungs\u00fcbersicht',
        linkTo: '/zahlungen',
      },
      {
        title: 'SEPA-Mandat einrichten',
        description: 'Richten Sie das SEPA-Lastschriftmandat ein, sofern der Mieter einer automatischen Abbuchung zugestimmt hat. Erfassen Sie IBAN und Mandatsreferenz.',
        linkLabel: 'Zur Buchhaltung',
        linkTo: '/buchhaltung',
      },
      {
        title: 'Willkommensschreiben senden',
        description: 'Senden Sie dem neuen Mieter ein Willkommensschreiben mit allen wichtigen Informationen: Hausordnung, Ansprechpartner, M\u00fcllabfuhrplan und Schl\u00fcssel\u00fcbergabe.',
        linkLabel: 'Zu den Serienbriefen',
        linkTo: '/serienbriefe',
      },
    ],
  },
];

export default function GuidedWorkflows() {
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowDefinition | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  const startWorkflow = (workflow: WorkflowDefinition) => {
    setActiveWorkflow(workflow);
    setCurrentStep(0);
    setCompletedSteps(new Set());
  };

  const closeWorkflow = () => {
    setActiveWorkflow(null);
    setCurrentStep(0);
    setCompletedSteps(new Set());
  };

  const goNext = () => {
    if (!activeWorkflow) return;
    setCompletedSteps(prev => new Set([...prev, currentStep]));
    if (currentStep < activeWorkflow.steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const goBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const progressPercent = activeWorkflow
    ? ((completedSteps.size) / activeWorkflow.steps.length) * 100
    : 0;

  const isLastStep = activeWorkflow ? currentStep === activeWorkflow.steps.length - 1 : false;

  return (
    <MainLayout title="Workflow-Assistenten" subtitle="Schritt-f\u00fcr-Schritt-Anleitungen f\u00fcr h\u00e4ufige Verwaltungsaufgaben">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {workflows.map((workflow) => (
            <Card
              key={workflow.id}
              className="hover-elevate cursor-pointer"
              data-testid={`card-workflow-${workflow.id}`}
              onClick={() => startWorkflow(workflow)}
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-primary/10">
                      <workflow.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{workflow.title}</CardTitle>
                      <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>ca. {workflow.estimatedMinutes} Min.</span>
                      </div>
                    </div>
                  </div>
                  <Badge variant="secondary">{workflow.steps.length} Schritte</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>{workflow.description}</CardDescription>
                <Button
                  className="mt-4 w-full"
                  data-testid={`button-start-workflow-${workflow.id}`}
                >
                  Workflow starten
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Dialog open={!!activeWorkflow} onOpenChange={(open) => { if (!open) closeWorkflow(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="dialog-workflow-wizard">
          {activeWorkflow && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-primary/10">
                      <activeWorkflow.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <DialogTitle>{activeWorkflow.title}</DialogTitle>
                      <DialogDescription>
                        Schritt {currentStep + 1} von {activeWorkflow.steps.length}
                      </DialogDescription>
                    </div>
                  </div>
                  <Badge variant="outline">
                    {completedSteps.size} / {activeWorkflow.steps.length} erledigt
                  </Badge>
                </div>
              </DialogHeader>

              <div className="space-y-6 mt-2">
                <Progress value={progressPercent} className="h-2" data-testid="progress-workflow" />

                <div className="flex gap-2 overflow-x-auto pb-2">
                  {activeWorkflow.steps.map((step, index) => {
                    const isCompleted = completedSteps.has(index);
                    const isCurrent = index === currentStep;
                    return (
                      <button
                        key={index}
                        onClick={() => setCurrentStep(index)}
                        data-testid={`button-step-indicator-${index}`}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                          isCurrent
                            ? 'bg-primary text-primary-foreground'
                            : isCompleted
                              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {isCompleted ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <span>{index + 1}</span>
                        )}
                        <span className="hidden sm:inline">{step.title}</span>
                      </button>
                    );
                  })}
                </div>

                <Card data-testid={`card-step-content-${currentStep}`}>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <span className="flex items-center justify-center h-7 w-7 rounded-full bg-primary text-primary-foreground text-sm font-bold">
                        {completedSteps.has(currentStep) ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          currentStep + 1
                        )}
                      </span>
                      {activeWorkflow.steps[currentStep].title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-muted-foreground leading-relaxed">
                      {activeWorkflow.steps[currentStep].description}
                    </p>
                    {activeWorkflow.steps[currentStep].linkTo && (
                      <Button variant="outline" asChild data-testid={`link-step-action-${currentStep}`}>
                        <Link to={activeWorkflow.steps[currentStep].linkTo!}>
                          {activeWorkflow.steps[currentStep].linkLabel}
                          <ArrowRight className="h-4 w-4 ml-2" />
                        </Link>
                      </Button>
                    )}
                  </CardContent>
                </Card>

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Button
                    variant="ghost"
                    onClick={closeWorkflow}
                    data-testid="button-cancel-workflow"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Workflow abbrechen
                  </Button>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={goBack}
                      disabled={currentStep === 0}
                      data-testid="button-step-back"
                    >
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Zur\u00fcck
                    </Button>
                    {isLastStep ? (
                      <Button
                        onClick={() => {
                          setCompletedSteps(prev => new Set([...prev, currentStep]));
                          closeWorkflow();
                        }}
                        data-testid="button-step-finish"
                      >
                        <Check className="h-4 w-4 mr-2" />
                        Abschlie\u00dfen
                      </Button>
                    ) : (
                      <Button
                        onClick={goNext}
                        data-testid="button-step-next"
                      >
                        Weiter
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
