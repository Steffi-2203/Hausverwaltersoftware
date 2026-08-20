import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Loader2, LogIn, Eye, EyeOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { setAuthToken, clearAuthToken } from '@/lib/queryClient';
import immoflowLogo from '@/assets/immoflowme-logo.png';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, loading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [debugInfo, setDebugInfo] = useState('');
  const processedMagicToken = useRef<string | null>(null);

  useEffect(() => {
    const magicToken = searchParams.get('magic');
    if (magicToken && processedMagicToken.current !== magicToken) {
      processedMagicToken.current = magicToken;
      setIsSubmitting(true);
      setDebugInfo('Auto-Login...');
      fetch('/api/auth/magic-login-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: magicToken }),
        credentials: 'include',
      })
        .then(async (res) => ({ ok: res.ok, result: await res.json() }))
        .then(({ ok, result }) => {
          if (!ok) {
            if (result.code === '2FA_SETUP_REQUIRED') {
              setDebugInfo('2FA-Einrichtung erforderlich...');
              navigate('/2fa-einrichten', { replace: true });
              return;
            }
            setDebugInfo('Fehler: ' + (result.error || 'Unbekannt'));
            setIsSubmitting(false);
            return;
          }

          if (result.token) {
            setAuthToken(result.token);
            queryClient.setQueryData(["/api/auth/user"], {
              id: result.id,
              email: result.email,
              fullName: result.fullName,
              organizationId: result.organizationId,
              roles: result.roles,
            });
            setDebugInfo('Erfolgreich! Weiterleitung...');
            window.location.href = '/dashboard';
          } else {
            setDebugInfo('Fehler: ' + (result.error || 'Unbekannt'));
            setIsSubmitting(false);
          }
        })
        .catch(err => {
          setDebugInfo('Fehler: ' + err.message);
          setIsSubmitting(false);
        });
    }
  }, [searchParams]);

  useEffect(() => {
    if (isAuthenticated && !loading) {
      const from = location.state?.from?.pathname || '/dashboard';
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, loading, navigate, location]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast({
        title: "Fehler",
        description: "Bitte E-Mail und Passwort eingeben",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    setDebugInfo('Sende Anfrage...');
    
    try {
      clearAuthToken();

      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
        credentials: 'include',
      });

      setDebugInfo(`Status: ${response.status}`);

      if (!response.ok) {
        let errorMsg = "Ungültige E-Mail oder Passwort";
        try {
          const errorData = await response.json();
          // Privilegierte Rolle ohne 2FA → verpflichtende Einrichtung
          if (errorData.code === '2FA_SETUP_REQUIRED') {
            setDebugInfo('2FA-Einrichtung erforderlich...');
            navigate('/2fa-einrichten');
            return;
          }
          errorMsg = errorData.error || errorMsg;
        } catch {}
        setDebugInfo(`Fehler: ${errorMsg}`);
        toast({
          title: "Anmeldung fehlgeschlagen",
          description: errorMsg,
          variant: "destructive",
        });
        return;
      }

      const result = await response.json();
      setDebugInfo('Login erfolgreich, weiterleiten...');

      if (result.token) {
        setAuthToken(result.token);
      }

      queryClient.setQueryData(["/api/auth/user"], {
        id: result.id,
        email: result.email,
        fullName: result.fullName,
        organizationId: result.organizationId,
        roles: result.roles,
      });

      const from = location.state?.from?.pathname || '/dashboard';
      window.location.href = from;
    } catch (error: any) {
      setDebugInfo(`Exception: ${error.message}`);
      toast({
        title: "Anmeldung fehlgeschlagen",
        description: error.message || "Ungültige E-Mail oder Passwort",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Laden...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-4">
            <div className="flex justify-center">
              <img src={immoflowLogo} alt="ImmoflowMe" className="h-16 w-auto" />
            </div>
            <CardTitle className="text-2xl font-bold">
              Anmelden
            </CardTitle>
            <CardDescription>
              Melden Sie sich mit Ihrer E-Mail und Passwort an
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-Mail</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="ihre@email.at"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isSubmitting}
                  data-testid="input-email"
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Passwort</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Ihr Passwort"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isSubmitting}
                    data-testid="input-password"
                    autoComplete="current-password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="text-right">
                <Link 
                  to="/reset-password" 
                  className="text-sm text-primary hover:underline"
                  data-testid="link-forgot-password"
                >
                  Passwort vergessen?
                </Link>
              </div>
              <Button 
                type="submit"
                className="w-full" 
                size="lg"
                disabled={isSubmitting}
                data-testid="button-login"
              >
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <LogIn className="mr-2 h-5 w-5" />
                )}
                Anmelden
              </Button>
              {debugInfo && (
                <p className="text-xs text-center text-muted-foreground" data-testid="text-debug-info">
                  {debugInfo}
                </p>
              )}
            </CardContent>
          </form>
          <CardFooter className="flex flex-col gap-4 text-center text-sm text-muted-foreground">
            <p>
              Noch kein Konto? <Link to="/demo" className="text-primary hover:underline">Kostenlos testen</Link>
            </p>
            <div className="flex gap-4 justify-center text-xs flex-wrap">
              <Link to="/impressum" className="hover:underline">Impressum</Link>
              <Link to="/datenschutz" className="hover:underline">Datenschutz</Link>
              <Link to="/agb" className="hover:underline">AGB</Link>
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
