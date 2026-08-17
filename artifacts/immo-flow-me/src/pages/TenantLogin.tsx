import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Loader2, LogIn, Eye, EyeOff, KeyRound, CheckCircle, Building2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import immoflowLogo from '@/assets/immoflowme-logo.png';

export default function TenantLogin() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const inviteToken = searchParams.get('invite');

  const [mode, setMode] = useState<'login' | 'set-password' | 'checking-invite'>( 
    inviteToken ? 'checking-invite' : 'login'
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inviteValid, setInviteValid] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [setupComplete, setSetupComplete] = useState(false);

  useEffect(() => {
    if (inviteToken) {
      checkInvite(inviteToken);
    }
    checkSession();
  }, [inviteToken]);

  async function checkSession() {
    try {
      const res = await fetch('/api/tenant-auth/session', { credentials: 'include' });
      const data = await res.json();
      if (data.authenticated) {
        navigate('/mieter-portal', { replace: true });
      }
    } catch {}
  }

  async function checkInvite(token: string) {
    try {
      const res = await fetch(`/api/tenant-auth/invite/${token}`, { credentials: 'include' });
      const data = await res.json();
      if (data.valid) {
        setInviteValid(true);
        setInviteEmail(data.email);
        setMode('set-password');
      } else {
        setMode('login');
        toast({
          title: "Einladung ungültig",
          description: "Dieser Einladungslink ist abgelaufen oder ungültig. Bitte kontaktieren Sie Ihre Hausverwaltung.",
          variant: "destructive",
        });
      }
    } catch {
      setMode('login');
      toast({
        title: "Fehler",
        description: "Einladung konnte nicht überprüft werden.",
        variant: "destructive",
      });
    }
  }

  async function handleLogin(e: React.FormEvent) {
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
    try {
      const res = await fetch('/api/tenant-auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        navigate('/mieter-portal', { replace: true });
      } else {
        toast({
          title: "Anmeldung fehlgeschlagen",
          description: data.error || "Ungültige E-Mail oder Passwort",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Fehler",
        description: "Verbindung zum Server fehlgeschlagen",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast({
        title: "Passwort zu kurz",
        description: "Das Passwort muss mindestens 8 Zeichen lang sein",
        variant: "destructive",
      });
      return;
    }
    if (password !== confirmPassword) {
      toast({
        title: "Passwörter stimmen nicht überein",
        description: "Bitte überprüfen Sie die Eingabe",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/tenant-auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token: inviteToken, password }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSetupComplete(true);
        setTimeout(() => {
          navigate('/mieter-portal', { replace: true });
        }, 2000);
      } else {
        toast({
          title: "Fehler",
          description: data.error || "Passwort konnte nicht gesetzt werden",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Fehler",
        description: "Verbindung zum Server fehlgeschlagen",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (mode === 'checking-invite') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Einladung wird überprüft...</p>
        </div>
      </div>
    );
  }

  if (setupComplete) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckCircle className="h-16 w-16 text-green-600 mb-4" />
            <h2 className="text-xl font-semibold mb-2">Zugang eingerichtet</h2>
            <p className="text-muted-foreground text-center">
              Ihr Mieterportal-Zugang wurde erfolgreich eingerichtet. Sie werden weitergeleitet...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-4">
            <div className="flex justify-center">
              <img src={immoflowLogo} alt="ImmoFlowMe" className="h-16 w-auto" />
            </div>
            {mode === 'login' ? (
              <>
                <CardTitle className="text-2xl font-bold" data-testid="text-tenant-login-title">
                  Mieterportal
                </CardTitle>
                <CardDescription>
                  Melden Sie sich mit Ihren Zugangsdaten an
                </CardDescription>
              </>
            ) : (
              <>
                <CardTitle className="text-2xl font-bold" data-testid="text-set-password-title">
                  Zugang einrichten
                </CardTitle>
                <CardDescription>
                  Setzen Sie Ihr Passwort für das Mieterportal
                </CardDescription>
                {inviteEmail && (
                  <p className="text-sm text-muted-foreground">
                    Konto: <span className="font-medium text-foreground">{inviteEmail}</span>
                  </p>
                )}
              </>
            )}
          </CardHeader>

          <CardContent>
            {mode === 'login' ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">E-Mail-Adresse</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="mieter@beispiel.at"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    data-testid="input-tenant-email"
                    autoComplete="email"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Passwort</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Ihr Passwort"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      data-testid="input-tenant-password"
                      autoComplete="current-password"
                      required
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0"
                      onClick={() => setShowPassword(!showPassword)}
                      data-testid="button-toggle-password"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting}
                  data-testid="button-tenant-login"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <LogIn className="h-4 w-4 mr-2" />
                  )}
                  Anmelden
                </Button>
              </form>
            ) : (
              <form onSubmit={handleSetPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">Neues Passwort</Label>
                  <div className="relative">
                    <Input
                      id="new-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Mindestens 8 Zeichen"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      data-testid="input-new-password"
                      autoComplete="new-password"
                      required
                      minLength={8}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0"
                      onClick={() => setShowPassword(!showPassword)}
                      data-testid="button-toggle-new-password"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Passwort bestätigen</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="Passwort wiederholen"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    data-testid="input-confirm-password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting}
                  data-testid="button-set-password"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <KeyRound className="h-4 w-4 mr-2" />
                  )}
                  Zugang einrichten
                </Button>
              </form>
            )}
          </CardContent>

          <CardFooter className="flex flex-col gap-3 text-center">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Building2 className="h-4 w-4" />
              <span>Bereitgestellt von Ihrer Hausverwaltung</span>
            </div>
            <Link to="/" className="text-sm text-primary hover:underline" data-testid="link-back-home">
              Zurück zur Startseite
            </Link>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
