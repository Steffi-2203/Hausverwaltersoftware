import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, ShieldCheck, Copy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { setAuthToken } from '@/lib/queryClient';

/**
 * Pflicht-2FA-Einrichtung nach dem Login (staged enrollment).
 * Wird erreicht, wenn der Login-Endpunkt 403 + code "2FA_SETUP_REQUIRED"
 * liefert. Die Session enthält dann nur pending2FASetupUserId — Vollzugang
 * gibt es erst nach erfolgreicher Verifizierung.
 */
export default function TwoFactorEnrollment() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [loading, setLoading] = useState(true);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 'enrollment' = staged Login-Flow (pending2FASetupUserId, kein Vollzugang);
  // 'session'    = bereits angemeldeter Nutzer ohne 2FA (z.B. Magic-Login,
  //                nachträglich vergebene Rolle) → normale Setup-Endpunkte.
  const [mode, setMode] = useState<'enrollment' | 'session'>('enrollment');

  useEffect(() => {
    (async () => {
      try {
        // Zuerst staged Enrollment versuchen (Login-Flow)...
        let res = await fetch('/api/2fa/enrollment-setup', {
          method: 'POST',
          credentials: 'include',
        });
        let data = await res.json();
        // ...sonst Fallback auf den Setup-Pfad für angemeldete Nutzer.
        if (res.status === 403) {
          res = await fetch('/api/2fa/setup', { method: 'POST', credentials: 'include' });
          data = await res.json();
          if (res.ok) setMode('session');
        }
        if (!res.ok) {
          setError(data.error || 'Einrichtung nicht möglich. Bitte erneut anmelden.');
          return;
        }
        setQrCode(data.qrCodeDataUrl);
        setSecret(data.secret);
      } catch {
        setError('Verbindungsfehler. Bitte erneut anmelden.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    setVerifying(true);
    try {
      const verifyUrl = mode === 'session' ? '/api/2fa/verify-setup' : '/api/2fa/enrollment-verify';
      const res = await fetch(verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'Fehler', description: data.error || 'Ungültiger Code', variant: 'destructive' });
        return;
      }
      if (data.token) setAuthToken(data.token);
      if (data.id) {
        queryClient.setQueryData(['/api/auth/user'], {
          id: data.id,
          email: data.email,
          fullName: data.fullName,
          organizationId: data.organizationId,
          roles: data.roles,
        });
      } else {
        // Session-Modus (verify-setup): Nutzerdaten unverändert, nur neu laden
        queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      }
      setBackupCodes(data.backupCodes || []);
    } catch (err: any) {
      toast({ title: 'Fehler', description: err.message, variant: 'destructive' });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Zwei-Faktor-Authentifizierung einrichten
          </CardTitle>
          <CardDescription>
            Für Verwalter- und Admin-Konten ist 2FA verpflichtend. Scannen Sie den
            QR-Code mit einer Authenticator-App (z.B. Google Authenticator) und
            bestätigen Sie mit dem angezeigten Code.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && (
            <div className="flex justify-center py-8" data-testid="enrollment-loader">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && (
            <div className="space-y-4">
              <p className="text-sm text-destructive" data-testid="enrollment-error">{error}</p>
              <Button className="w-full" onClick={() => navigate('/login')}>Zur Anmeldung</Button>
            </div>
          )}
          {backupCodes ? (
            <div className="space-y-4" data-testid="backup-codes">
              <p className="text-sm font-medium">
                2FA ist aktiv. Speichern Sie diese Backup-Codes an einem sicheren Ort —
                sie werden nur einmal angezeigt:
              </p>
              <div className="grid grid-cols-2 gap-2 rounded-md border p-3 font-mono text-sm">
                {backupCodes.map((c) => (<span key={c}>{c}</span>))}
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  navigator.clipboard.writeText(backupCodes.join('\n'));
                  toast({ title: 'Kopiert', description: 'Backup-Codes in die Zwischenablage kopiert' });
                }}
              >
                <Copy className="h-4 w-4 mr-2" /> Codes kopieren
              </Button>
              <Button className="w-full" onClick={() => { window.location.href = '/dashboard'; }} data-testid="button-continue">
                Weiter zum Dashboard
              </Button>
            </div>
          ) : (
            !loading && !error && (
              <form onSubmit={handleVerify} className="space-y-4">
                {qrCode && (
                  <div className="flex justify-center">
                    <img src={qrCode} alt="2FA QR-Code" className="h-48 w-48" data-testid="qr-code" />
                  </div>
                )}
                {secret && (
                  <p className="text-xs text-muted-foreground break-all text-center">
                    Manuelle Eingabe: <span className="font-mono">{secret}</span>
                  </p>
                )}
                <div className="space-y-2">
                  <Label htmlFor="totp">6-stelliger Code</Label>
                  <Input
                    id="totp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    data-testid="input-totp"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={verifying || !token.trim()} data-testid="button-verify">
                  {verifying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Aktivieren
                </Button>
              </form>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}
