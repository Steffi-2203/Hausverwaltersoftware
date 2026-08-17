import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Building2, Clock, CheckCircle2, Loader2, Mail, Copy, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

export default function DemoRequestPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [activationUrl, setActivationUrl] = useState("");
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/demo/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess(true);
        if (data.activationUrl) {
          setActivationUrl(data.activationUrl);
        }
      } else {
        setError(data.error || "Fehler beim Anfordern der Demo");
      }
    } catch (err) {
      setError("Netzwerkfehler. Bitte versuchen Sie es später erneut.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(activationUrl);
    toast({
      title: "Link kopiert!",
      description: "Der Aktivierungslink wurde in die Zwischenablage kopiert.",
    });
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mb-4">
              <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle className="text-2xl">Demo bereit!</CardTitle>
            <CardDescription>
              Ihr Demo-Zugang für <strong>{email}</strong> wurde erstellt.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {activationUrl && (
              <div className="space-y-3">
                <Button 
                  className="w-full" 
                  size="lg"
                  onClick={() => window.location.href = activationUrl}
                  data-testid="button-start-demo"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Demo jetzt starten
                </Button>
                <div className="relative">
                  <Input 
                    value={activationUrl} 
                    readOnly 
                    className="pr-10 text-xs"
                    data-testid="input-activation-url"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                    onClick={copyToClipboard}
                    data-testid="button-copy-link"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Kopieren Sie den Link oder teilen Sie ihn direkt.
                </p>
              </div>
            )}
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground pt-2">
              <Mail className="w-4 h-4" />
              <span>Falls eine E-Mail gesendet wurde, prüfen Sie auch den Spam-Ordner</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
      <div className="w-full max-w-4xl grid md:grid-cols-2 gap-8 items-center">
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <Building2 className="w-10 h-10 text-blue-600" />
            <h1 className="text-3xl font-bold">ImmoFlowMe</h1>
          </div>
          <h2 className="text-4xl font-bold leading-tight">
            Testen Sie unsere Hausverwaltungssoftware
          </h2>
          <p className="text-lg text-muted-foreground">
            Erleben Sie alle Funktionen von ImmoFlowMe mit realistischen Beispieldaten - 
            kostenlos und unverbindlich.
          </p>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0">
                <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="font-semibold">30 Minuten Demo-Zugang</h3>
                <p className="text-sm text-muted-foreground">
                  Genug Zeit, um alle wichtigen Funktionen zu testen
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="font-semibold">Realistische Beispieldaten</h3>
                <p className="text-sm text-muted-foreground">
                  Wiener Altbau, Grazer Neubau - echte österreichische Szenarien
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="font-semibold">MRG-konform</h3>
                <p className="text-sm text-muted-foreground">
                  Betriebskostenabrechnung, Mahnwesen, VPI-Indexierung
                </p>
              </div>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Demo anfordern</CardTitle>
            <CardDescription>
              Geben Sie Ihre E-Mail-Adresse ein, um einen Demo-Link zu erhalten.
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
                <Label htmlFor="email">E-Mail-Adresse</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="ihre@email.at"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  data-testid="input-demo-email"
                />
              </div>
              <Button 
                type="submit" 
                className="w-full" 
                disabled={isSubmitting}
                data-testid="button-request-demo"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Wird gesendet...
                  </>
                ) : (
                  "Demo-Link anfordern"
                )}
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                Keine Kreditkarte erforderlich. Kein Abo-Zwang.
              </p>
              <div className="text-center text-sm">
                <span className="text-muted-foreground">Bereits registriert? </span>
                <Link to="/login" className="text-blue-600 hover:underline">
                  Anmelden
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
