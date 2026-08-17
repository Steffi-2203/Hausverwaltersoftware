import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Cookie, Shield, BarChart3, Megaphone } from 'lucide-react';
import { Link } from 'react-router-dom';

const COOKIE_CONSENT_KEY = 'immoflow-cookie-consent';
const CONSENT_VERSION = '2.0';

interface CookiePreferences {
  necessary: boolean;
  analytics: boolean;
  marketing: boolean;
  consentDate: string;
  consentVersion: string;
}

async function persistConsentToServer(consentType: string, granted: boolean) {
  try {
    await fetch('/api/dsgvo/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        consentType,
        granted,
        consentVersion: CONSENT_VERSION,
        legalBasis: 'Art. 6 Abs. 1 lit. a DSGVO - Einwilligung',
      }),
    });
  } catch {
    // Silent fail - localStorage is the primary storage
  }
}

function getInitialShowState(): boolean {
  try {
    const stored = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!stored) return true;
    const parsed = JSON.parse(stored);
    return parsed.consentVersion !== CONSENT_VERSION;
  } catch {
    return true;
  }
}

export function hasCookieConsent(): boolean {
  try {
    const stored = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!stored) return false;
    const parsed = JSON.parse(stored);
    return parsed.consentVersion === CONSENT_VERSION;
  } catch {
    return false;
  }
}

export function CookieConsent() {
  const [showBanner, setShowBanner] = useState(getInitialShowState);
  const [showSettings, setShowSettings] = useState(false);
  const [preferences, setPreferences] = useState<CookiePreferences>({
    necessary: true,
    analytics: false,
    marketing: false,
    consentDate: '',
    consentVersion: CONSENT_VERSION,
  });

  const savePreferences = (prefs: CookiePreferences) => {
    const prefsWithDate = {
      ...prefs,
      consentDate: new Date().toISOString(),
      consentVersion: CONSENT_VERSION,
    };
    localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(prefsWithDate));
    setShowBanner(false);
    setShowSettings(false);

    persistConsentToServer('necessary', true);
    persistConsentToServer('analytics', prefs.analytics);
    persistConsentToServer('marketing', prefs.marketing);
  };

  const acceptAll = () => {
    savePreferences({
      necessary: true,
      analytics: true,
      marketing: true,
      consentDate: '',
      consentVersion: CONSENT_VERSION,
    });
  };

  const acceptNecessary = () => {
    savePreferences({
      necessary: true,
      analytics: false,
      marketing: false,
      consentDate: '',
      consentVersion: CONSENT_VERSION,
    });
  };

  const saveCustomPreferences = () => {
    savePreferences(preferences);
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[9999] flex justify-center p-4" data-testid="cookie-consent-banner">
      <Card className="w-full max-w-lg animate-in slide-in-from-bottom-4 shadow-lg border">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <Cookie className="h-5 w-5" />
            Cookie-Einstellungen
          </CardTitle>
          <CardDescription>
            Wir verwenden Cookies, um Ihre Erfahrung zu verbessern. Bitte waehlen Sie Ihre Praeferenzen. Ihre Entscheidung wird DSGVO-konform protokolliert.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {showSettings ? (
            <>
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2 p-3 rounded-md bg-muted/50">
                  <div className="space-y-0.5">
                    <Label className="font-medium flex items-center gap-2">
                      <Shield className="h-4 w-4 text-green-600" />
                      Erforderliche Cookies
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Notwendig fuer die Grundfunktionen der Website (Session, Sicherheit)
                    </p>
                  </div>
                  <Switch checked={true} disabled data-testid="switch-necessary-cookies" />
                </div>

                <div className="flex items-center justify-between gap-2 p-3 rounded-md bg-muted/50">
                  <div className="space-y-0.5">
                    <Label className="font-medium flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" />
                      Analyse-Cookies
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Helfen uns zu verstehen, wie Sie die Website nutzen
                    </p>
                  </div>
                  <Switch
                    checked={preferences.analytics}
                    onCheckedChange={(checked) =>
                      setPreferences((prev) => ({ ...prev, analytics: checked }))
                    }
                    data-testid="switch-analytics-cookies"
                  />
                </div>

                <div className="flex items-center justify-between gap-2 p-3 rounded-md bg-muted/50">
                  <div className="space-y-0.5">
                    <Label className="font-medium flex items-center gap-2">
                      <Megaphone className="h-4 w-4" />
                      Marketing-Cookies
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Ermoeglichen personalisierte Inhalte
                    </p>
                  </div>
                  <Switch
                    checked={preferences.marketing}
                    onCheckedChange={(checked) =>
                      setPreferences((prev) => ({ ...prev, marketing: checked }))
                    }
                    data-testid="switch-marketing-cookies"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowSettings(false)} className="flex-1" data-testid="button-cookie-back">
                  Zurueck
                </Button>
                <Button onClick={saveCustomPreferences} className="flex-1" data-testid="button-cookie-save-custom">
                  Auswahl speichern
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Diese Website verwendet Cookies. Erforderliche Cookies sind fuer die Grundfunktionen
                notwendig. Optionale Cookies helfen uns, die Website zu verbessern.{' '}
                <Link to="/datenschutz" className="text-primary underline" data-testid="link-privacy-policy">
                  Mehr erfahren
                </Link>
              </p>

              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                <Button variant="outline" onClick={acceptNecessary} className="flex-1" data-testid="button-cookie-necessary-only">
                  Nur erforderliche
                </Button>
                <Button variant="outline" onClick={() => setShowSettings(true)} className="flex-1" data-testid="button-cookie-settings">
                  Einstellungen
                </Button>
                <Button onClick={acceptAll} className="flex-1" data-testid="button-cookie-accept-all">
                  Alle akzeptieren
                </Button>
              </div>
            </>
          )}

          <p className="text-xs text-muted-foreground text-center pt-1">
            Consent-Version {CONSENT_VERSION} | Ihre Einwilligung wird gemaess DSGVO Art. 7 Abs. 1 nachweisbar gespeichert.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export function useCookieConsent() {
  const [preferences, setPreferences] = useState<CookiePreferences | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (stored) {
      try {
        setPreferences(JSON.parse(stored));
      } catch {
        setPreferences(null);
      }
    }
  }, []);

  return preferences;
}
