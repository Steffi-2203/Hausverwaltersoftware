import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Key, Copy, RefreshCw, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface ApiKeyStatus {
  hasKey: boolean;
  maskedKey: string | null;
}

function maskKey(key: string): string {
  if (key.length <= 12) return '••••••••';
  return `${key.slice(0, 8)}••••••••${key.slice(-4)}`;
}

export function ApiKeySettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isGenerating, setIsGenerating] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [showKeyDialog, setShowKeyDialog] = useState(false);

  const { data: status, isLoading } = useQuery<ApiKeyStatus>({
    queryKey: ['/api/organization/api-key/status'],
  });

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const res = await apiRequest('POST', '/api/organization/api-key/generate');
      const data = await res.json();
      setNewKey(data.apiKey);
      setShowKeyDialog(true);
      queryClient.invalidateQueries({ queryKey: ['/api/organization/api-key/status'] });
      toast({
        title: 'API-Key generiert',
        description: 'Der neue Key wurde gespeichert. Kopieren Sie ihn jetzt — er wird nur einmal angezeigt.',
      });
    } catch (error: any) {
      toast({
        title: 'Fehler',
        description: error.message || 'Key konnte nicht generiert werden',
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRevoke = async () => {
    setIsRevoking(true);
    try {
      await apiRequest('DELETE', '/api/organization/api-key');
      queryClient.invalidateQueries({ queryKey: ['/api/organization/api-key/status'] });
      toast({
        title: 'API-Key widerrufen',
        description: 'Der Key wurde gelöscht. Bestehende Verbindungen werden sofort abgewiesen.',
        variant: 'destructive',
      });
    } catch (error: any) {
      toast({
        title: 'Fehler',
        description: error.message || 'Key konnte nicht widerrufen werden',
        variant: 'destructive',
      });
    } finally {
      setIsRevoking(false);
    }
  };

  const copyKey = () => {
    if (!newKey) return;
    navigator.clipboard.writeText(newKey);
    toast({ title: 'Kopiert', description: 'API-Key in die Zwischenablage kopiert' });
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
            <Key className="h-5 w-5" />
            Readonly API-Zugang
          </CardTitle>
          <CardDescription>
            Erlaubt externen Systemen lesenden Zugriff auf Ihre Organisationsdaten.
            Der Key gilt ausschließlich für Ihre Organisation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">Status:</span>
              {status?.hasKey ? (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                  Aktiv
                </Badge>
              ) : (
                <Badge variant="secondary">Kein Key gesetzt</Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              {status?.hasKey ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleGenerate}
                    disabled={isGenerating || isRevoking}
                  >
                    {isGenerating ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Key erneuern
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm" disabled={isRevoking}>
                        {isRevoking ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4 mr-2" />
                        )}
                        Widerrufen
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                          <AlertTriangle className="h-5 w-5 text-destructive" />
                          API-Key widerrufen?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          Der Key wird sofort ungültig. Alle externen Systeme die diesen Key verwenden
                          verlieren sofort ihren Zugriff. Diese Aktion kann nicht rückgängig gemacht werden.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleRevoke}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Key widerrufen
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              ) : (
                <Button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  size="sm"
                >
                  {isGenerating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Key className="h-4 w-4 mr-2" />
                  )}
                  Key generieren
                </Button>
              )}
            </div>
          </div>

          {/* Masked key display */}
          {status?.hasKey && status.maskedKey && (
            <div className="p-3 bg-muted rounded-md">
              <p className="text-xs text-muted-foreground mb-1">Aktueller Key (maskiert)</p>
              <code className="font-mono text-sm">{status.maskedKey}</code>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Der vollständige Key wird nur direkt nach der Generierung angezeigt.
            Verwenden Sie ihn als <code className="bg-muted px-1 rounded">X-Api-Key</code> Header
            oder <code className="bg-muted px-1 rounded">api_key</code> Query-Parameter in API-Anfragen.
          </p>
        </CardContent>
      </Card>

      {/* One-time key display dialog */}
      <Dialog open={showKeyDialog} onOpenChange={(open) => {
        if (!open) {
          setShowKeyDialog(false);
          setNewKey(null);
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-green-600" />
              Neuer API-Key generiert
            </DialogTitle>
            <DialogDescription className="text-amber-600 font-medium">
              ⚠️ Kopieren Sie den Key jetzt — er wird nicht erneut angezeigt.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="p-4 bg-muted rounded-md border-2 border-amber-200 dark:border-amber-800">
              <p className="text-xs text-muted-foreground mb-2">Ihr neuer Readonly API-Key:</p>
              <code className="font-mono text-sm break-all select-all">{newKey}</code>
            </div>

            <Button className="w-full" variant="outline" onClick={copyKey}>
              <Copy className="h-4 w-4 mr-2" />
              Key kopieren
            </Button>
          </div>

          <DialogFooter>
            <Button onClick={() => { setShowKeyDialog(false); setNewKey(null); }}>
              Key gespeichert — Schließen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
