import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Download, Trash2, Shield, AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export function PrivacySettings() {
  const { user, signOut } = useAuth();
  const [isExporting, setIsExporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleExportData = async () => {
    if (!user) return;
    
    setIsExporting(true);
    try {
      const response = await fetch('/api/functions/export-user-data', {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Export fehlgeschlagen');
      }

      const data = await response.json();

      // Create and download JSON file
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `meine-daten-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('Ihre Daten wurden erfolgreich exportiert.');
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Fehler beim Exportieren der Daten. Bitte versuchen Sie es später erneut.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;

    setIsDeleting(true);
    try {
      const response = await fetch('/api/functions/delete-account', {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Löschen fehlgeschlagen');
      }

      toast.success('Ihr Konto wurde gelöscht.');
      await signOut();
    } catch (error) {
      console.error('Delete error:', error);
      toast.error('Fehler beim Löschen des Kontos. Bitte kontaktieren Sie den Support.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Data Export - GDPR Art. 20 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Datenexport (DSGVO Art. 20)
          </CardTitle>
          <CardDescription>
            Laden Sie eine Kopie Ihrer personenbezogenen Daten herunter
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Gemäß DSGVO Artikel 20 haben Sie das Recht, Ihre personenbezogenen Daten in einem
            strukturierten, gängigen und maschinenlesbaren Format zu erhalten.
          </p>
          <Button onClick={handleExportData} disabled={isExporting}>
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Exportiere...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Meine Daten exportieren
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Account Deletion - GDPR Art. 17 */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Konto löschen (DSGVO Art. 17)
          </CardTitle>
          <CardDescription>
            Löschen Sie Ihr Konto und alle damit verbundenen Daten
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 mb-4">
            <div className="flex gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-destructive">Achtung: Diese Aktion ist unwiderruflich!</p>
                <p className="text-muted-foreground mt-1">
                  Alle Ihre Daten werden dauerhaft gelöscht, einschließlich:
                </p>
                <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                  <li>Profil- und Kontoinformationen</li>
                  <li>Alle Liegenschaften und Einheiten</li>
                  <li>Mieter- und Zahlungsdaten</li>
                  <li>Dokumente und Abrechnungen</li>
                </ul>
              </div>
            </div>
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={isDeleting}>
                {isDeleting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Lösche...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Konto unwiderruflich löschen
                  </>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                  Konto wirklich löschen?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Diese Aktion kann nicht rückgängig gemacht werden. Alle Ihre Daten werden
                  dauerhaft aus unseren Systemen entfernt. Sie verlieren den Zugang zu allen
                  Liegenschaften, Mietern und Dokumenten.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteAccount}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Ja, Konto löschen
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      {/* Privacy Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Ihre Datenschutzrechte
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground space-y-3">
            <p>
              Gemäß der DSGVO haben Sie folgende Rechte bezüglich Ihrer personenbezogenen Daten:
            </p>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>Auskunftsrecht (Art. 15):</strong> Sie können jederzeit Auskunft über Ihre gespeicherten Daten verlangen.</li>
              <li><strong>Berichtigungsrecht (Art. 16):</strong> Sie können unrichtige Daten korrigieren lassen.</li>
              <li><strong>Löschungsrecht (Art. 17):</strong> Sie können die Löschung Ihrer Daten verlangen.</li>
              <li><strong>Einschränkungsrecht (Art. 18):</strong> Sie können die Verarbeitung Ihrer Daten einschränken.</li>
              <li><strong>Datenportabilität (Art. 20):</strong> Sie können Ihre Daten in einem gängigen Format erhalten.</li>
              <li><strong>Widerspruchsrecht (Art. 21):</strong> Sie können der Verarbeitung Ihrer Daten widersprechen.</li>
            </ul>
            <p className="pt-2">
              Bei Fragen zum Datenschutz wenden Sie sich bitte an{' '}
              <a href="mailto:datenschutz@immoflow.at" className="text-primary underline">
                datenschutz@immoflow.at
              </a>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
