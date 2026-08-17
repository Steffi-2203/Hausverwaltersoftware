/**
 * VpiImportPanel
 *
 * Zeigt Optionen zum Importieren von VPI-Daten:
 * 1. Auto-Import von Statistik Austria OGD-API
 * 2. CSV-Upload (Paste oder Datei)
 *
 * Wird auch als Warn-Banner angezeigt wenn die VPI-Tabelle leer ist.
 */
import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Download, Upload, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp,
  RefreshCw, Loader2, Info, ExternalLink,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  source: string;
}

interface VpiImportPanelProps {
  /** Anzahl der aktuell in der DB gespeicherten VPI-Werte */
  vpiCount: number;
  /** Callback nach erfolgreichem Import zum Neuladein der Werte */
  onImported?: () => void;
}

export function VpiImportPanel({ vpiCount, onImported }: VpiImportPanelProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(vpiCount === 0); // bei leerer DB automatisch aufklappen
  const [autoLoading, setAutoLoading] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['/api/vpi/values'] });
    onImported?.();
  };

  // ── Auto-Import ───────────────────────────────────────────────────────────
  const handleAutoImport = async () => {
    setAutoLoading(true);
    setLastResult(null);
    try {
      const res = await fetch('/api/vpi/import', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setLastResult(data as ImportResult);
      toast({
        title: 'Import erfolgreich',
        description: `${data.imported} VPI-Werte von Statistik Austria importiert.`,
      });
      invalidate();
    } catch (err: any) {
      toast({
        title: 'Auto-Import fehlgeschlagen',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setAutoLoading(false);
    }
  };

  // ── CSV-Import ─────────────────────────────────────────────────────────────
  const handleCsvImport = async () => {
    if (!csvText.trim()) {
      toast({ title: 'Kein CSV-Inhalt', description: 'Bitte CSV-Text einfügen oder Datei auswählen.', variant: 'destructive' });
      return;
    }
    setCsvLoading(true);
    setLastResult(null);
    try {
      const res = await fetch('/api/vpi/import-csv', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: csvText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setLastResult(data as ImportResult);
      toast({
        title: 'CSV-Import erfolgreich',
        description: `${data.imported} VPI-Werte importiert.`,
      });
      setCsvText('');
      invalidate();
    } catch (err: any) {
      toast({
        title: 'CSV-Import fehlgeschlagen',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setCsvLoading(false);
    }
  };

  // Datei auswählen → Text in Textarea laden
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText(String(ev.target?.result ?? ''));
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  return (
    <div className="space-y-3">
      {/* Warn-Banner bei leerer VPI-Tabelle */}
      {vpiCount === 0 && (
        <Alert variant="destructive" data-testid="alert-vpi-empty">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>VPI-Tabelle leer</AlertTitle>
          <AlertDescription>
            Für VPI-Anpassungen werden aktuelle Indexwerte benötigt.
            Importieren Sie VPI-Daten von Statistik Austria oder tragen Sie Werte manuell ein.
            Solange keine Werte vorhanden sind, schlägt die Prüfung auf fällige Anpassungen fehl.
          </AlertDescription>
        </Alert>
      )}

      <Collapsible open={open} onOpenChange={setOpen}>
        <Card>
          <CardHeader className="pb-3">
            <CollapsibleTrigger asChild>
              <div className="flex items-center justify-between cursor-pointer select-none">
                <div className="flex items-center gap-2">
                  <Download className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">VPI-Daten importieren</CardTitle>
                  {vpiCount > 0 && (
                    <Badge variant="secondary">{vpiCount} Werte gespeichert</Badge>
                  )}
                  {vpiCount === 0 && (
                    <Badge variant="destructive">Keine Werte vorhanden</Badge>
                  )}
                </div>
                {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CollapsibleTrigger>
          </CardHeader>

          <CollapsibleContent>
            <CardContent className="space-y-5 pt-0">
              {/* Option 1: Auto-Import */}
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <RefreshCw className="h-5 w-5 mt-0.5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">Auto-Import von Statistik Austria</p>
                    <p className="text-sm text-muted-foreground">
                      Lädt VPI-Indexwerte (Basis 2020=100) direkt von{' '}
                      <a
                        href="https://data.statistik.gv.at"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline inline-flex items-center gap-0.5"
                      >
                        data.statistik.gv.at
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      . Benötigt Internetzugang.
                    </p>
                  </div>
                </div>
                <Button
                  onClick={handleAutoImport}
                  disabled={autoLoading || csvLoading}
                  data-testid="button-vpi-auto-import"
                  className="w-full sm:w-auto"
                >
                  {autoLoading
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Wird importiert…</>
                    : <><Download className="h-4 w-4 mr-2" /> Von Statistik Austria importieren</>
                  }
                </Button>
              </div>

              {/* Option 2: CSV-Upload */}
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <Upload className="h-5 w-5 mt-0.5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">CSV-Upload (manuell)</p>
                    <p className="text-sm text-muted-foreground">
                      Laden Sie die VPI-CSV-Datei von{' '}
                      <a
                        href="https://www.statistik.at/statistiken/preise/verbraucherpreisindex-vpi/ergebnisse"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline inline-flex items-center gap-0.5"
                      >
                        statistik.at
                        <ExternalLink className="h-3 w-3" />
                      </a>{' '}
                      herunter und fügen Sie den Inhalt ein oder wählen Sie die Datei.
                    </p>
                  </div>
                </div>

                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    <strong>Unterstützte Formate:</strong><br />
                    • Matrix: <code>Jahr;Jän;Feb;Mär;…</code><br />
                    • Liste: <code>Jahr;Monat;VPI</code><br />
                    Dezimaltrennzeichen Komma oder Punkt; Semikolon-getrennt.
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fileRef.current?.click()}
                      disabled={csvLoading}
                      data-testid="button-vpi-file-select"
                    >
                      <Upload className="h-3.5 w-3.5 mr-1.5" /> Datei auswählen
                    </Button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".csv,.txt,.ods"
                      className="hidden"
                      onChange={handleFile}
                    />
                  </div>
                  <Textarea
                    placeholder={'Jahr;Jän;Feb;Mär;Apr;Mai;Jun;Jul;Aug;Sep;Okt;Nov;Dez\n2020;100,0;100,4;100,2;...\n2021;100,8;...'}
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    rows={5}
                    className="font-mono text-xs"
                    data-testid="textarea-vpi-csv"
                  />
                  <Button
                    onClick={handleCsvImport}
                    disabled={csvLoading || autoLoading || !csvText.trim()}
                    data-testid="button-vpi-csv-import"
                    className="w-full sm:w-auto"
                  >
                    {csvLoading
                      ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Wird importiert…</>
                      : <><Upload className="h-4 w-4 mr-2" /> CSV importieren</>
                    }
                  </Button>
                </div>
              </div>

              {/* Ergebnis des letzten Imports */}
              {lastResult && (
                <Alert
                  variant={lastResult.imported > 0 ? 'default' : 'destructive'}
                  data-testid="alert-import-result"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>Import abgeschlossen</AlertTitle>
                  <AlertDescription>
                    <span className="font-medium">{lastResult.imported}</span> Werte importiert
                    {lastResult.skipped > 0 && (
                      <>, <span className="font-medium">{lastResult.skipped}</span> übersprungen</>
                    )}
                    {lastResult.errors.length > 0 && (
                      <ul className="mt-2 text-xs list-disc ml-4">
                        {lastResult.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                        {lastResult.errors.length > 5 && <li>…und {lastResult.errors.length - 5} weitere</li>}
                      </ul>
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}
