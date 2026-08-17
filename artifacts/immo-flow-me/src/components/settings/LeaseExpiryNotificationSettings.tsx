import { useState, useEffect } from 'react';
import { Bell, Loader2, Save, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface LeaseExpirySettings {
  leaseExpiryNotificationsEnabled: boolean;
  leaseExpiryThresholds: number[];
}

const AVAILABLE_THRESHOLDS = [
  { value: 90, label: '90 Tage vorher' },
  { value: 60, label: '60 Tage vorher' },
  { value: 30, label: '30 Tage vorher' },
];

export function LeaseExpiryNotificationSettings() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [enabled, setEnabled] = useState(true);
  const [thresholds, setThresholds] = useState<number[]>([90, 60, 30]);

  // Load current settings on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings/lease-expiry', { credentials: 'include' });
        if (!res.ok) throw new Error('Laden fehlgeschlagen');
        const data: LeaseExpirySettings = await res.json();
        if (!cancelled) {
          setEnabled(data.leaseExpiryNotificationsEnabled);
          setThresholds(data.leaseExpiryThresholds ?? [90, 60, 30]);
        }
      } catch {
        toast({
          title: 'Einstellungen konnten nicht geladen werden',
          variant: 'destructive',
        });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [toast]);

  function toggleThreshold(value: number, checked: boolean) {
    setThresholds((prev) =>
      checked ? [...prev, value].sort((a, b) => b - a) : prev.filter((t) => t !== value),
    );
  }

  async function handleSave() {
    if (enabled && thresholds.length === 0) {
      toast({
        title: 'Bitte mindestens einen Erinnerungszeitpunkt auswählen',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    setSaved(false);
    try {
      await apiRequest('PUT', '/api/settings/lease-expiry', {
        leaseExpiryNotificationsEnabled: enabled,
        leaseExpiryThresholds: thresholds,
      });
      setSaved(true);
      toast({ title: 'Einstellungen gespeichert' });
      setTimeout(() => setSaved(false), 3000);
    } catch {
      toast({
        title: 'Speichern fehlgeschlagen',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Erinnerungen bei auslaufenden Mietverträgen
        </CardTitle>
        <CardDescription>
          ImmoFlowMe sendet automatisch eine E-Mail-Zusammenfassung an die Organisations-E-Mail-Adresse,
          wenn befristete Mietverträge dem Ablauf nahekommen (§ 29 MRG).
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Enable/disable toggle */}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="expiry-notifications-enabled" className="text-base font-medium">
              Ablauf-Erinnerungen aktivieren
            </Label>
            <p className="text-sm text-muted-foreground">
              Tägliche Prüfung und automatischer E-Mail-Versand an die Organisations-E-Mail
            </p>
          </div>
          <Switch
            id="expiry-notifications-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        {/* Threshold checkboxes */}
        <div className={enabled ? '' : 'opacity-40 pointer-events-none'}>
          <p className="text-sm font-medium mb-3">Erinnerungszeitpunkte</p>
          <div className="space-y-3">
            {AVAILABLE_THRESHOLDS.map(({ value, label }) => (
              <div key={value} className="flex items-center gap-3">
                <Checkbox
                  id={`threshold-${value}`}
                  checked={thresholds.includes(value)}
                  onCheckedChange={(checked) => toggleThreshold(value, Boolean(checked))}
                  disabled={!enabled}
                />
                <Label
                  htmlFor={`threshold-${value}`}
                  className="cursor-pointer font-normal"
                >
                  {label}
                </Label>
              </div>
            ))}
          </div>
          {enabled && thresholds.length === 0 && (
            <p className="text-sm text-destructive mt-2">
              Bitte mindestens einen Zeitpunkt auswählen.
            </p>
          )}
        </div>

        {/* Info box */}
        <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
          Die E-Mail enthält Mietername, Einheit, Liegenschaft, das genaue Befristungsende
          und einen Direktlink zur Mieter-Detailseite. Jede Erinnerung wird pro Mietvertrag
          nur einmal versendet.
        </div>

        {/* Save button */}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Speichern…
              </>
            ) : saved ? (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
                Gespeichert
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Speichern
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
