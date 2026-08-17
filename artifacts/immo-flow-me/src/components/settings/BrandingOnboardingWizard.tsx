import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Palette, Image, Mail, ArrowRight, ArrowLeft, Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toast } from "sonner";

interface BrandingOnboardingWizardProps {
  organizationId: string;
  onComplete: () => void;
}

const steps = [
  { id: 1, title: "Markenname", description: "Wie soll Ihre Software heißen?", icon: Palette },
  { id: 2, title: "Logo", description: "Laden Sie Ihr Logo hoch", icon: Image },
  { id: 3, title: "Kontakt", description: "Support-E-Mail für Ihre Kunden", icon: Mail },
];

export function BrandingOnboardingWizard({ organizationId, onComplete }: BrandingOnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({
    brandName: "",
    logoUrl: "",
    primaryColor: "#3b82f6",
    supportEmail: "",
  });

  const updateBranding = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await apiRequest("PATCH", `/api/organizations/${organizationId}`, data);
      return response.json();
    },
    onSuccess: () => {
      toast.success("Branding wurde erfolgreich eingerichtet!");
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
      onComplete();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Fehler beim Speichern");
    },
  });

  const handleNext = () => {
    if (currentStep < steps.length) {
      setCurrentStep(currentStep + 1);
    } else {
      updateBranding.mutate(formData);
    }
  };

  const handlePrev = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return formData.brandName.trim().length > 0;
      case 2:
        return true;
      case 3:
        return formData.supportEmail.includes("@") || formData.supportEmail === "";
      default:
        return true;
    }
  };

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">White-Label Einrichtung</CardTitle>
        <CardDescription>
          Konfigurieren Sie Ihre eigene Hausverwaltungssoftware in 3 einfachen Schritten
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex justify-between mb-8">
          {steps.map((step) => {
            const Icon = step.icon;
            const isActive = currentStep === step.id;
            const isCompleted = currentStep > step.id;
            return (
              <div key={step.id} className="flex flex-col items-center flex-1">
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center mb-2 transition-colors ${
                    isCompleted
                      ? "bg-green-500 text-white"
                      : isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {isCompleted ? <CheckCircle2 className="h-6 w-6" /> : <Icon className="h-6 w-6" />}
                </div>
                <span className={`text-sm font-medium ${isActive ? "text-primary" : "text-muted-foreground"}`}>
                  {step.title}
                </span>
              </div>
            );
          })}
        </div>

        <div className="min-h-[200px]">
          {currentStep === 1 && (
            <div className="space-y-6">
              <div className="text-center mb-6">
                <h3 className="text-lg font-semibold">Wie soll Ihre Software heißen?</h3>
                <p className="text-muted-foreground">
                  Dieser Name erscheint in der Navigation und für Ihre Kunden
                </p>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="brandName">Markenname *</Label>
                  <Input
                    id="brandName"
                    value={formData.brandName}
                    onChange={(e) => setFormData({ ...formData, brandName: e.target.value })}
                    placeholder="z.B. Mustermann Immo-Portal"
                    className="text-lg"
                    data-testid="input-wizard-brand-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="primaryColor">Primärfarbe</Label>
                  <div className="flex gap-3">
                    <Input
                      id="primaryColor"
                      type="color"
                      value={formData.primaryColor}
                      onChange={(e) => setFormData({ ...formData, primaryColor: e.target.value })}
                      className="w-16 h-10 p-1 cursor-pointer"
                      data-testid="input-wizard-primary-color"
                    />
                    <Input
                      value={formData.primaryColor}
                      onChange={(e) => setFormData({ ...formData, primaryColor: e.target.value })}
                      placeholder="#3b82f6"
                      className="flex-1"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-6">
              <div className="text-center mb-6">
                <h3 className="text-lg font-semibold">Ihr Logo hochladen</h3>
                <p className="text-muted-foreground">
                  Das Logo erscheint in der Navigation (optional)
                </p>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="logoUrl">Logo-URL</Label>
                  <Input
                    id="logoUrl"
                    value={formData.logoUrl}
                    onChange={(e) => setFormData({ ...formData, logoUrl: e.target.value })}
                    placeholder="https://ihre-firma.at/logo.png"
                    data-testid="input-wizard-logo-url"
                  />
                  <p className="text-xs text-muted-foreground">
                    Geben Sie die URL zu Ihrem Logo an (PNG oder SVG empfohlen, max. 200px Höhe)
                  </p>
                </div>
                {formData.logoUrl && (
                  <div className="p-4 bg-muted rounded-lg text-center">
                    <p className="text-sm text-muted-foreground mb-2">Vorschau:</p>
                    <img
                      src={formData.logoUrl}
                      alt="Logo Vorschau"
                      className="max-h-16 mx-auto object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-6">
              <div className="text-center mb-6">
                <h3 className="text-lg font-semibold">Support-Kontakt</h3>
                <p className="text-muted-foreground">
                  An diese E-Mail werden Support-Anfragen Ihrer Kunden gesendet
                </p>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="supportEmail">Support E-Mail</Label>
                  <Input
                    id="supportEmail"
                    type="email"
                    value={formData.supportEmail}
                    onChange={(e) => setFormData({ ...formData, supportEmail: e.target.value })}
                    placeholder="support@ihre-firma.at"
                    data-testid="input-wizard-support-email"
                  />
                </div>
              </div>

              <div className="mt-8 p-4 bg-muted rounded-lg">
                <h4 className="font-semibold mb-2">Zusammenfassung:</h4>
                <ul className="space-y-1 text-sm">
                  <li><strong>Markenname:</strong> {formData.brandName}</li>
                  <li><strong>Logo:</strong> {formData.logoUrl || "Nicht gesetzt"}</li>
                  <li><strong>Primärfarbe:</strong> <span className="inline-block w-4 h-4 rounded" style={{ backgroundColor: formData.primaryColor }}></span> {formData.primaryColor}</li>
                  <li><strong>Support E-Mail:</strong> {formData.supportEmail || "Nicht gesetzt"}</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between mt-8 pt-4 border-t">
          <Button
            variant="outline"
            onClick={handlePrev}
            disabled={currentStep === 1}
            data-testid="button-wizard-prev"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Zurück
          </Button>
          <Button
            onClick={handleNext}
            disabled={!canProceed() || updateBranding.isPending}
            data-testid="button-wizard-next"
          >
            {updateBranding.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            {currentStep === steps.length ? (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Einrichtung abschließen
              </>
            ) : (
              <>
                Weiter
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
