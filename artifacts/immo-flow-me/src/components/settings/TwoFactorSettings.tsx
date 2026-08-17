import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ShieldCheck, ShieldOff, Loader2, Copy, Download, KeyRound } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

export function TwoFactorSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery<{ isEnabled: boolean; hasBackupCodes: boolean }>({
    queryKey: ['/api/2fa/status'],
  });

  const [setupDialog, setSetupDialog] = useState(false);
  const [disableDialog, setDisableDialog] = useState(false);
  const [setupStep, setSetupStep] = useState<'qr' | 'verify' | 'backup'>('qr');
  const [qrData, setQrData] = useState<{ qrCodeDataUrl: string; secret: string } | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableToken, setDisableToken] = useState('');

  const startSetup = async () => {
    setIsProcessing(true);
    try {
      const response = await apiRequest('POST', '/api/2fa/setup');
      const data = await response.json();
      setQrData({ qrCodeDataUrl: data.qrCodeDataUrl, secret: data.secret });
      setSetupStep('qr');
      setSetupDialog(true);
    } catch (error: any) {
      toast({
        title: "Fehler",
        description: error.message || "2FA-Einrichtung fehlgeschlagen",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const verifySetup = async () => {
    if (verifyCode.length !== 6) return;
    setIsProcessing(true);
    try {
      const response = await apiRequest('POST', '/api/2fa/verify-setup', { token: verifyCode });
      const data = await response.json();
      setBackupCodes(data.backupCodes);
      setSetupStep('backup');
      queryClient.invalidateQueries({ queryKey: ['/api/2fa/status'] });
      toast({
        title: "Erfolg",
        description: "Zwei-Faktor-Authentifizierung wurde aktiviert",
      });
    } catch (error: any) {
      toast({
        title: "Verifizierung fehlgeschlagen",
        description: error.message || "Ungültiger Code",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      setVerifyCode('');
    }
  };

  const disable2FA = async () => {
    if (!disablePassword || !disableToken) return;
    setIsProcessing(true);
    try {
      await apiRequest('POST', '/api/2fa/disable', {
        password: disablePassword,
        token: disableToken,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/2fa/status'] });
      setDisableDialog(false);
      setDisablePassword('');
      setDisableToken('');
      toast({
        title: "2FA deaktiviert",
        description: "Die Zwei-Faktor-Authentifizierung wurde deaktiviert",
      });
    } catch (error: any) {
      toast({
        title: "Fehler",
        description: error.message || "Deaktivierung fehlgeschlagen",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const copySecret = () => {
    if (qrData?.secret) {
      navigator.clipboard.writeText(qrData.secret);
      toast({ title: "Kopiert", description: "Geheimer Schlüssel in die Zwischenablage kopiert" });
    }
  };

  const downloadBackupCodes = () => {
    const content = [
      "ImmoFlowMe - Backup-Codes für Zwei-Faktor-Authentifizierung",
      "============================================================",
      "",
      "Bewahren Sie diese Codes sicher auf.",
      "Jeder Code kann nur einmal verwendet werden.",
      "",
      ...backupCodes.map((code, i) => `${i + 1}. ${code}`),
      "",
      `Generiert am: ${new Date().toLocaleDateString('de-DE')}`,
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'immoflowme-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Zwei-Faktor-Authentifizierung
          </CardTitle>
          <CardDescription>
            Schützen Sie Ihr Konto mit einer zusätzlichen Sicherheitsebene
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">Status:</span>
              {status?.isEnabled ? (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid="badge-2fa-enabled">
                  Aktiviert
                </Badge>
              ) : (
                <Badge variant="secondary" data-testid="badge-2fa-disabled">
                  Nicht aktiviert
                </Badge>
              )}
            </div>
            {status?.isEnabled ? (
              <Button
                variant="outline"
                onClick={() => setDisableDialog(true)}
                data-testid="button-disable-2fa"
              >
                <ShieldOff className="h-4 w-4 mr-2" />
                2FA deaktivieren
              </Button>
            ) : (
              <Button
                onClick={startSetup}
                disabled={isProcessing}
                data-testid="button-enable-2fa"
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4 mr-2" />
                )}
                2FA aktivieren
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Verwenden Sie eine Authenticator-App wie Google Authenticator, Authy oder Microsoft Authenticator,
            um bei jeder Anmeldung einen zusätzlichen Sicherheitscode zu generieren.
          </p>
        </CardContent>
      </Card>

      <Dialog open={setupDialog} onOpenChange={(open) => {
        if (!open && setupStep !== 'backup') {
          setSetupDialog(false);
          setQrData(null);
          setVerifyCode('');
          setSetupStep('qr');
        }
        if (!open && setupStep === 'backup') {
          setSetupDialog(false);
          setQrData(null);
          setVerifyCode('');
          setBackupCodes([]);
          setSetupStep('qr');
        }
      }}>
        <DialogContent className="max-w-md">
          {setupStep === 'qr' && qrData && (
            <>
              <DialogHeader>
                <DialogTitle>2FA einrichten</DialogTitle>
                <DialogDescription>
                  Scannen Sie den QR-Code mit Ihrer Authenticator-App
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex justify-center p-4 bg-white rounded-md">
                  <img
                    src={qrData.qrCodeDataUrl}
                    alt="QR-Code für 2FA"
                    className="w-48 h-48"
                    data-testid="img-2fa-qrcode"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">
                    Oder geben Sie den Schlüssel manuell ein:
                  </Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-muted rounded-md text-sm font-mono break-all" data-testid="text-2fa-secret">
                      {qrData.secret}
                    </code>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={copySecret}
                      data-testid="button-copy-secret"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={() => setSetupStep('verify')}
                  data-testid="button-next-verify"
                >
                  Weiter zur Verifizierung
                </Button>
              </div>
            </>
          )}

          {setupStep === 'verify' && (
            <>
              <DialogHeader>
                <DialogTitle>Code verifizieren</DialogTitle>
                <DialogDescription>
                  Geben Sie den 6-stelligen Code aus Ihrer Authenticator-App ein
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="verify-code">Bestätigungscode</Label>
                  <Input
                    id="verify-code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder="000000"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    disabled={isProcessing}
                    data-testid="input-verify-setup-code"
                    autoComplete="one-time-code"
                    className="text-center tracking-widest font-mono text-lg"
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={verifySetup}
                  disabled={isProcessing || verifyCode.length !== 6}
                  data-testid="button-confirm-2fa-setup"
                >
                  {isProcessing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4 mr-2" />
                  )}
                  2FA aktivieren
                </Button>
              </div>
            </>
          )}

          {setupStep === 'backup' && backupCodes.length > 0 && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5" />
                  Backup-Codes
                </DialogTitle>
                <DialogDescription>
                  Speichern Sie diese Codes sicher ab. Sie können verwendet werden, falls Sie keinen Zugang zu Ihrer Authenticator-App haben. Jeder Code kann nur einmal verwendet werden.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 p-4 bg-muted rounded-md">
                  {backupCodes.map((code, index) => (
                    <code
                      key={index}
                      className="px-2 py-1 text-center font-mono text-sm"
                      data-testid={`text-backup-code-${index}`}
                    >
                      {code}
                    </code>
                  ))}
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={downloadBackupCodes}
                  data-testid="button-download-backup-codes"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Codes herunterladen
                </Button>
                <Button
                  className="w-full"
                  onClick={() => {
                    setSetupDialog(false);
                    setQrData(null);
                    setVerifyCode('');
                    setBackupCodes([]);
                    setSetupStep('qr');
                  }}
                  data-testid="button-close-backup-dialog"
                >
                  Fertig
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={disableDialog} onOpenChange={setDisableDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>2FA deaktivieren</DialogTitle>
            <DialogDescription>
              Geben Sie Ihr Passwort und einen aktuellen 2FA-Code ein, um die Zwei-Faktor-Authentifizierung zu deaktivieren.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="disable-password">Passwort</Label>
              <Input
                id="disable-password"
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                disabled={isProcessing}
                data-testid="input-disable-password"
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="disable-token">2FA-Code</Label>
              <Input
                id="disable-token"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                value={disableToken}
                onChange={(e) => setDisableToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                disabled={isProcessing}
                data-testid="input-disable-token"
                autoComplete="one-time-code"
                className="text-center tracking-widest font-mono text-lg"
              />
            </div>
            <Button
              variant="destructive"
              className="w-full"
              onClick={disable2FA}
              disabled={isProcessing || !disablePassword || disableToken.length !== 6}
              data-testid="button-confirm-disable-2fa"
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ShieldOff className="h-4 w-4 mr-2" />
              )}
              2FA deaktivieren
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
