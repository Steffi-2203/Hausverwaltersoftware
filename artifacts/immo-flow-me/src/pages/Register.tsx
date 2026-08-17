import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Loader2, UserPlus, Eye, EyeOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import immoflowLogo from '@/assets/immoflowme-logo.png';

export default function Register() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite');
  
  const { isAuthenticated, loading, signUp } = useAuth();
  const { toast } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated && !loading) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, loading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast({
        title: "Fehler",
        description: "Bitte alle Pflichtfelder ausfüllen",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 8) {
      toast({
        title: "Fehler",
        description: "Das Passwort muss mindestens 8 Zeichen lang sein",
        variant: "destructive",
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        title: "Fehler",
        description: "Die Passwörter stimmen nicht überein",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    
    try {
      await signUp(email, password, fullName || undefined);
      
      toast({
        title: "Erfolgreich registriert",
        description: "Willkommen bei ImmoFlowMe!",
      });
      
      navigate('/dashboard', { replace: true });
    } catch (error: any) {
      // Privilegiertes Konto (Verwalter/Admin): Registrierung führt direkt
      // in die verpflichtende 2FA-Einrichtung statt in eine Vollsession.
      if (error.code === '2FA_SETUP_REQUIRED') {
        toast({
          title: "Konto erstellt",
          description: "Bitte richten Sie jetzt die Zwei-Faktor-Authentifizierung ein.",
        });
        navigate('/2fa-einrichten', { replace: true });
        return;
      }
      toast({
        title: "Registrierung fehlgeschlagen",
        description: error.message || "Ein Fehler ist aufgetreten",
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
              <img src={immoflowLogo} alt="ImmoFlowMe" className="h-16 w-auto" />
            </div>
            <CardTitle className="text-2xl font-bold">
              {inviteToken ? 'Einladung annehmen' : 'Registrieren'}
            </CardTitle>
            <CardDescription>
              {inviteToken 
                ? 'Erstellen Sie Ihr Konto, um die Einladung anzunehmen'
                : 'Erstellen Sie Ihr Konto bei ImmoFlowMe'}
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Vollständiger Name</Label>
                <Input
                  id="fullName"
                  type="text"
                  placeholder="Max Mustermann"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  disabled={isSubmitting}
                  data-testid="input-fullname"
                  autoComplete="name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">E-Mail *</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="ihre@email.at"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isSubmitting}
                  required
                  data-testid="input-email"
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Passwort * (min. 8 Zeichen)</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Ihr Passwort"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isSubmitting}
                    required
                    data-testid="input-password"
                    autoComplete="new-password"
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
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Passwort bestätigen *</Label>
                <Input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  placeholder="Passwort wiederholen"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isSubmitting}
                  required
                  data-testid="input-confirm-password"
                  autoComplete="new-password"
                />
              </div>
              <Button 
                type="submit"
                className="w-full" 
                size="lg"
                disabled={isSubmitting}
                data-testid="button-register"
              >
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <UserPlus className="mr-2 h-5 w-5" />
                )}
                Registrieren
              </Button>
            </CardContent>
          </form>
          <CardFooter className="flex flex-col gap-4 text-center text-sm text-muted-foreground">
            <p>
              Bereits registriert?{' '}
              <Link to="/login" className="text-primary hover:underline">
                Zur Anmeldung
              </Link>
            </p>
            <div className="flex gap-4 justify-center text-xs flex-wrap">
              <Link to="/impressum" className="hover:underline">Impressum</Link>
              <Link to="/datenschutz" className="hover:underline">Datenschutz</Link>
              <Link to="/agb" className="hover:underline">AGB</Link>
              <Link to="/avv" className="hover:underline">AVV</Link>
              <Link to="/sla" className="hover:underline">SLA</Link>
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
