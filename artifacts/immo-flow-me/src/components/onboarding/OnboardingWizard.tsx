import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Building2, Home, CheckCircle2, ArrowRight, ArrowLeft, X } from 'lucide-react';
import { useCreateProperty } from '@/hooks/useProperties';

interface OnboardingWizardProps {
  onComplete: () => void;
  onSkip?: () => void;
}

const steps = [
  {
    id: 'welcome',
    title: 'Willkommen bei ImmoFlowMe',
    description: 'Ihre professionelle Hausverwaltungs-Software für Österreich',
  },
  {
    id: 'property',
    title: 'Erste Liegenschaft anlegen',
    description: 'Beginnen Sie mit Ihrer ersten Immobilie',
  },
  {
    id: 'done',
    title: 'Geschafft!',
    description: 'Sie können jetzt loslegen',
  },
];

export function OnboardingWizard({ onComplete, onSkip }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [propertyData, setPropertyData] = useState({
    name: '',
    address: '',
    city: '',
    postal_code: '',
  });
  const [propertyCreated, setPropertyCreated] = useState(false);

  const createProperty = useCreateProperty();
  const progress = ((currentStep + 1) / steps.length) * 100;

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleCreateProperty = async () => {
    if (!propertyData.name || !propertyData.address || !propertyData.city || !propertyData.postal_code) {
      return;
    }

    try {
      await createProperty.mutateAsync(propertyData);
      setPropertyCreated(true);
      handleNext();
    } catch (error) {
      console.error('Error creating property:', error);
    }
  };

  const handleSkipProperty = () => {
    handleNext();
  };

  const handleFinish = () => {
    onComplete();
  };

  const handleSkipAll = () => {
    if (onSkip) {
      onSkip();
    } else {
      onComplete();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <Card className="w-full max-w-lg shadow-xl">
        <CardHeader className="relative">
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-4 top-4"
            onClick={handleSkipAll}
          >
            <X className="h-4 w-4" />
          </Button>
          <div className="mb-4">
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground mt-2">
              Schritt {currentStep + 1} von {steps.length}
            </p>
          </div>
          <CardTitle className="text-xl">{steps[currentStep].title}</CardTitle>
          <CardDescription>{steps[currentStep].description}</CardDescription>
        </CardHeader>

        <CardContent>
          {/* Step 1: Welcome */}
          {currentStep === 0 && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-muted flex flex-col items-center text-center">
                  <Building2 className="h-8 w-8 text-primary mb-2" />
                  <p className="text-sm font-medium">Liegenschaften</p>
                  <p className="text-xs text-muted-foreground">Verwalten Sie alle Ihre Immobilien</p>
                </div>
                <div className="p-4 rounded-lg bg-muted flex flex-col items-center text-center">
                  <Home className="h-8 w-8 text-primary mb-2" />
                  <p className="text-sm font-medium">Einheiten & Mieter</p>
                  <p className="text-xs text-muted-foreground">Wohnungen, Geschäfte, Garagen</p>
                </div>
              </div>

              <div className="text-sm text-muted-foreground">
                <p className="mb-2">ImmoFlowMe bietet Ihnen:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>MRG-konforme Betriebskostenabrechnungen</li>
                  <li>Automatisches Zahlungs-Matching</li>
                  <li>USt-Voranmeldung für Österreich</li>
                  <li>PDF-Export aller Abrechnungen</li>
                </ul>
              </div>

              <Button className="w-full" onClick={handleNext}>
                Loslegen
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          )}

          {/* Step 2: Create Property */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div className="space-y-3">
                <Input
                  placeholder="Name (z.B. Bahnhofstraße 12)"
                  value={propertyData.name}
                  onChange={(e) => setPropertyData({ ...propertyData, name: e.target.value })}
                />
                <Input
                  placeholder="Adresse"
                  value={propertyData.address}
                  onChange={(e) => setPropertyData({ ...propertyData, address: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    placeholder="PLZ"
                    value={propertyData.postal_code}
                    onChange={(e) => setPropertyData({ ...propertyData, postal_code: e.target.value })}
                  />
                  <Input
                    placeholder="Stadt"
                    value={propertyData.city}
                    onChange={(e) => setPropertyData({ ...propertyData, city: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={handleBack}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Zurück
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleCreateProperty}
                  disabled={createProperty.isPending || !propertyData.name}
                >
                  {createProperty.isPending ? 'Wird erstellt...' : 'Liegenschaft anlegen'}
                </Button>
              </div>

              <Button
                variant="ghost"
                className="w-full text-muted-foreground"
                onClick={handleSkipProperty}
              >
                Später anlegen
              </Button>
            </div>
          )}

          {/* Step 3: Done */}
          {currentStep === 2 && (
            <div className="space-y-6 text-center">
              <div className="flex justify-center">
                <CheckCircle2 className="h-16 w-16 text-success" />
              </div>

              {propertyCreated ? (
                <div>
                  <p className="text-lg font-medium mb-2">Ihre erste Liegenschaft wurde angelegt!</p>
                  <p className="text-muted-foreground">
                    Sie können jetzt Einheiten und Mieter hinzufügen.
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-lg font-medium mb-2">Bereit zum Starten!</p>
                  <p className="text-muted-foreground">
                    Sie können jederzeit Liegenschaften über das Menü anlegen.
                  </p>
                </div>
              )}

              <Button className="w-full" onClick={handleFinish}>
                Zum Dashboard
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
