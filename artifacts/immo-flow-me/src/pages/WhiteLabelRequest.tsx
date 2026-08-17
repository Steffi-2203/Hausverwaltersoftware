import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Building2, CheckCircle2, Loader2, Palette, Shield, Users, Headphones, Globe } from "lucide-react";
import { Link } from "react-router-dom";

export default function WhiteLabelRequestPage() {
  const [formData, setFormData] = useState({
    companyName: "",
    contactPerson: "",
    email: "",
    phone: "",
    propertyCount: "",
    unitCount: "",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/white-label/inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess(true);
      } else {
        setError(data.error || "Fehler beim Senden der Anfrage");
      }
    } catch (err) {
      setError("Netzwerkfehler. Bitte versuchen Sie es später erneut.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 to-purple-100 dark:from-gray-900 dark:to-indigo-950 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mb-4">
              <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle className="text-2xl">Anfrage erhalten!</CardTitle>
            <CardDescription className="text-base">
              Vielen Dank für Ihr Interesse an ImmoFlowMe White Label.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-center text-muted-foreground">
              Wir haben Ihre Anfrage erhalten und melden uns in Kürze bei Ihnen 
              unter <strong>{formData.email}</strong>.
            </p>
            <div className="pt-4 text-center">
              <Link to="/">
                <Button variant="outline" data-testid="button-back-home">
                  Zurück zur Startseite
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-100 dark:from-gray-900 dark:to-indigo-950 p-4 py-12">
      <div className="w-full max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Building2 className="w-10 h-10 text-indigo-600" />
            <h1 className="text-3xl font-bold">ImmoFlowMe White Label</h1>
          </div>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Ihre eigene Hausverwaltungssoftware - mit Ihrem Logo, Ihren Farben, Ihrem Namen
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-8 items-start">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="w-5 h-5 text-indigo-600" />
                  Was ist White Label?
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground">
                  Mit ImmoFlowMe White Label erhalten Sie eine vollständig gebrandete 
                  Hausverwaltungssoftware, die unter Ihrem eigenen Namen läuft. Ihre 
                  Kunden sehen nur Ihre Marke - ImmoFlowMe bleibt im Hintergrund.
                </p>
              </CardContent>
            </Card>

            <div className="grid sm:grid-cols-2 gap-4">
              <Card className="hover-elevate">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center flex-shrink-0">
                      <Palette className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold">Eigenes Branding</h3>
                      <p className="text-sm text-muted-foreground">
                        Ihr Logo, Ihre Farben, Ihr Name
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="hover-elevate">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center flex-shrink-0">
                      <Globe className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold">Eigene Domain</h3>
                      <p className="text-sm text-muted-foreground">
                        portal.ihre-firma.at möglich
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="hover-elevate">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center flex-shrink-0">
                      <Shield className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold">MRG-konform</h3>
                      <p className="text-sm text-muted-foreground">
                        Volle österreichische Compliance
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="hover-elevate">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center flex-shrink-0">
                      <Headphones className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold">Persönlicher Support</h3>
                      <p className="text-sm text-muted-foreground">
                        Dedizierter Ansprechpartner
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-600" />
                  Preismodell
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between items-center p-3 bg-muted rounded-lg">
                    <span>Monatliche Lizenz</span>
                    <span className="font-bold">ab 299 EUR/Monat</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-muted rounded-lg">
                    <span>Einmalige Einrichtung</span>
                    <span className="font-bold">ab 500 EUR</span>
                  </div>
                  <p className="text-sm text-muted-foreground pt-2">
                    Preise variieren je nach Anzahl der Benutzer und gewünschtem Funktionsumfang.
                    Kontaktieren Sie uns für ein individuelles Angebot.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="sticky top-4">
            <CardHeader>
              <CardTitle>Unverbindliche Anfrage</CardTitle>
              <CardDescription>
                Füllen Sie das Formular aus und wir melden uns bei Ihnen.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label htmlFor="companyName">Firmenname *</Label>
                  <Input
                    id="companyName"
                    name="companyName"
                    value={formData.companyName}
                    onChange={handleChange}
                    placeholder="Mustermann Hausverwaltung GmbH"
                    required
                    data-testid="input-company-name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contactPerson">Ansprechpartner *</Label>
                  <Input
                    id="contactPerson"
                    name="contactPerson"
                    value={formData.contactPerson}
                    onChange={handleChange}
                    placeholder="Max Mustermann"
                    required
                    data-testid="input-contact-person"
                  />
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">E-Mail *</Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      value={formData.email}
                      onChange={handleChange}
                      placeholder="office@firma.at"
                      required
                      data-testid="input-email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Telefon</Label>
                    <Input
                      id="phone"
                      name="phone"
                      type="tel"
                      value={formData.phone}
                      onChange={handleChange}
                      placeholder="+43 1 234 5678"
                      data-testid="input-phone"
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="propertyCount">Anzahl Objekte</Label>
                    <Input
                      id="propertyCount"
                      name="propertyCount"
                      type="number"
                      min="0"
                      value={formData.propertyCount}
                      onChange={handleChange}
                      placeholder="z.B. 50"
                      data-testid="input-property-count"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="unitCount">Anzahl Einheiten</Label>
                    <Input
                      id="unitCount"
                      name="unitCount"
                      type="number"
                      min="0"
                      value={formData.unitCount}
                      onChange={handleChange}
                      placeholder="z.B. 500"
                      data-testid="input-unit-count"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="message">Nachricht</Label>
                  <Textarea
                    id="message"
                    name="message"
                    value={formData.message}
                    onChange={handleChange}
                    placeholder="Ihre Fragen oder Anforderungen..."
                    rows={4}
                    data-testid="textarea-message"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  disabled={isSubmitting}
                  data-testid="button-submit-inquiry"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Wird gesendet...
                    </>
                  ) : (
                    "Anfrage senden"
                  )}
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  Mit dem Absenden stimmen Sie unseren{" "}
                  <Link to="/datenschutz" className="underline">Datenschutzbestimmungen</Link>{" "}
                  zu.
                </p>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 text-center">
          <Link to="/" className="text-sm text-muted-foreground hover:underline">
            Zurück zur Startseite
          </Link>
        </div>
      </div>
    </div>
  );
}
