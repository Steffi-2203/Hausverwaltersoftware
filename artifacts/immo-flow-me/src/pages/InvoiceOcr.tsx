import { useState, useRef } from 'react';
import { ScanLine, Upload, Lock, Sparkles, Loader2, Check, FileText, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useKiAutopilot } from '@/hooks/useKiAutopilot';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Link } from 'react-router-dom';

interface ValidationReport {
  confidence_score?: number;
  unsichere_felder?: string[];
  warnungen?: string[];
  fehler?: string[];
}

interface ExtractedInvoice {
  lieferant: string;
  rechnungsnummer: string;
  rechnungsdatum: string;
  bruttobetrag: number;
  nettobetrag: number;
  ustBetrag: number;
  ustSatz: number;
  beschreibung: string;
  kategorie: string;
  needs_review?: boolean;
  validierung?: ValidationReport;
  ocrDocumentId?: string;
}

interface TransferResult {
  created: boolean;
  alreadyTransferred: boolean;
  incomingInvoiceId: string;
  journalEntryId: string;
  expenseId: string;
}

export default function InvoiceOcr() {
  const { isActive, isLoading: kiLoading } = useKiAutopilot();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedInvoice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [transferResult, setTransferResult] = useState<TransferResult | null>(null);
  const originalExtractedRef = useRef<ExtractedInvoice | null>(null);

  const { data: properties } = useQuery<any[]>({
    queryKey: ['/api/properties'],
    enabled: isActive,
  });

  const [selectedProperty, setSelectedProperty] = useState('');

  if (kiLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isActive) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Lock className="h-8 w-8 text-muted-foreground" />
            </div>
            <CardTitle>KI-Autopilot erforderlich</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground">
              Die KI-Rechnungserkennung ist Teil des KI-Autopilot Add-ons.
            </p>
            <Link to="/checkout?plan=ki-autopilot">
              <Button data-testid="button-upgrade-ki">
                <Sparkles className="mr-2 h-4 w-4" />
                KI-Autopilot aktivieren
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleUpload = async (file: File) => {
    if (!file) return;

    setUploading(true);
    setExtracted(null);
    setTransferResult(null);

    try {
      const csrfMatch = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
      const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : null;

      const formData = new FormData();
      formData.append('file', file);

      const headers: Record<string, string> = {};
      if (csrfToken) headers['x-csrf-token'] = csrfToken;

      const response = await fetch('/api/ki/invoice-ocr', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) throw new Error('Erkennung fehlgeschlagen');

      const data = await response.json();
      setExtracted(data);
      originalExtractedRef.current = data;
    } catch {
      toast({ title: 'Fehler', description: 'Rechnung konnte nicht analysiert werden.', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const handleConfirm = async () => {
    if (!extracted) return;
    setConfirming(true);

    try {
      const csrfMatch = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
      const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : null;

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrfToken) headers['x-csrf-token'] = csrfToken;

      const response = await fetch('/api/ocr/invoice-transfer', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          ...extracted,
          propertyId: selectedProperty || undefined,
          source: 'web_ocr',
          originalData: originalExtractedRef.current,
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Buchung fehlgeschlagen');

      setTransferResult(result);
      toast({
        title: result.alreadyTransferred ? 'Bereits übernommen' : 'Buchhaltung vollständig erstellt',
        description: result.alreadyTransferred
          ? 'Dieser OCR-Vorgang war bereits als Eingangsrechnung, Buchung und Kostenposition gespeichert.'
          : 'Eingangsrechnung, Journalsatz und abrechnungsrelevante Kostenposition wurden erstellt.',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/expenses'] });
      queryClient.invalidateQueries({ queryKey: ['/api/incoming-invoices'] });
    } catch (error) {
      toast({
        title: 'Übernahme nicht möglich',
        description: error instanceof Error ? error.message : 'Buchung konnte nicht erstellt werden.',
        variant: 'destructive',
      });
    } finally {
      setConfirming(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <ScanLine className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold" data-testid="text-invoice-ocr-title">KI-Rechnungserkennung</h1>
        <Badge variant="secondary">KI-Autopilot</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rechnung hochladen</CardTitle>
          <CardDescription>Laden Sie ein Bild oder PDF einer Rechnung hoch. Die KI extrahiert automatisch alle relevanten Daten.</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
              dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'
            }`}
            data-testid="dropzone-invoice"
          >
            {uploading ? (
              <div className="space-y-2">
                <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
                <p className="text-sm text-muted-foreground">Rechnung wird analysiert...</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="h-10 w-10 mx-auto text-muted-foreground" />
                <p className="font-medium">Rechnung hierher ziehen oder klicken</p>
                <p className="text-sm text-muted-foreground">PDF, JPG oder PNG (max. 15 MB)</p>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            onChange={handleFileSelect}
            className="hidden"
            data-testid="input-file-upload"
          />
        </CardContent>
      </Card>

      {extracted && (() => {
        const score = extracted.validierung?.confidence_score;
        const unsichere = extracted.validierung?.unsichere_felder ?? [];
        const warnungen = extracted.validierung?.warnungen ?? [];
        const fehler = extracted.validierung?.fehler ?? [];
        const isUnsicher = (field: string) =>
          unsichere.some(f => f.toLowerCase().includes(field.toLowerCase()));
        const fieldClass = (field: string) =>
          isUnsicher(field) ? 'ring-2 ring-yellow-400/60 rounded-md' : '';

        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 flex-wrap">
                <FileText className="h-5 w-5" />
                Erkannte Rechnungsdaten
                {/* Confidence Badge */}
                {score !== undefined && (
                  score >= 0.85
                    ? <Badge className="bg-green-600 text-white gap-1 text-xs"><CheckCircle className="h-3 w-3" />Hohe Sicherheit ({Math.round(score * 100)}%)</Badge>
                    : score >= 0.6
                    ? <Badge className="bg-yellow-500 text-black gap-1 text-xs"><AlertTriangle className="h-3 w-3" />Bitte prüfen ({Math.round(score * 100)}%)</Badge>
                    : <Badge className="bg-red-600 text-white gap-1 text-xs"><XCircle className="h-3 w-3" />Niedrige Sicherheit ({Math.round(score * 100)}%)</Badge>
                )}
                {extracted.needs_review && (
                  <Badge variant="outline" className="border-amber-500 text-amber-700 text-xs">Überprüfung empfohlen</Badge>
                )}
              </CardTitle>
              {unsichere.length > 0 && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                  <span className="inline-block w-3 h-3 rounded-sm bg-yellow-400/60 border border-yellow-500" />
                  Unsichere Felder hervorgehoben: {unsichere.join(', ')}
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {transferResult && (
                <div className="flex items-start gap-2 rounded-md border border-green-600/40 bg-green-50 p-3 text-sm text-green-900 dark:bg-green-950/30 dark:text-green-100" data-testid="ocr-transfer-result">
                  <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">
                      {transferResult.alreadyTransferred ? 'Bereits in der Buchhaltung übernommen.' : 'Erfolgreich in die Buchhaltung übernommen.'}
                    </p>
                    <p className="mt-1 text-xs opacity-90">
                      Eingangsrechnung, Journalsatz und Kostenposition sind verknüpft gespeichert.
                    </p>
                  </div>
                </div>
              )}
              {/* Fehler & Warnungen */}
              {(fehler.length > 0 || warnungen.length > 0) && (
                <div className="space-y-2">
                  {fehler.map((f, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">
                      <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />{f}
                    </div>
                  ))}
                  {warnungen.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-md border border-yellow-400 bg-yellow-50 dark:bg-yellow-950/20 p-2 text-sm text-yellow-800 dark:text-yellow-200">
                      <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />{w}
                    </div>
                  ))}
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium flex items-center gap-1">
                    Lieferant{isUnsicher('lieferant') && <AlertTriangle className="h-3 w-3 text-yellow-500" />}
                  </label>
                  <Input
                    className={fieldClass('lieferant')}
                    value={extracted.lieferant || ''}
                    onChange={e => setExtracted({ ...extracted, lieferant: e.target.value })}
                    data-testid="input-vendor"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium flex items-center gap-1">
                    Rechnungsnummer{isUnsicher('rechnungsnummer') && <AlertTriangle className="h-3 w-3 text-yellow-500" />}
                  </label>
                  <Input
                    className={fieldClass('rechnungsnummer')}
                    value={extracted.rechnungsnummer || ''}
                    onChange={e => setExtracted({ ...extracted, rechnungsnummer: e.target.value })}
                    data-testid="input-invoice-number"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium flex items-center gap-1">
                    Rechnungsdatum{isUnsicher('rechnungsdatum') && <AlertTriangle className="h-3 w-3 text-yellow-500" />}
                  </label>
                  <Input
                    type="date"
                    className={fieldClass('rechnungsdatum')}
                    value={extracted.rechnungsdatum || ''}
                    onChange={e => setExtracted({ ...extracted, rechnungsdatum: e.target.value })}
                    data-testid="input-invoice-date"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium flex items-center gap-1">
                    Bruttobetrag (EUR){isUnsicher('bruttobetrag') && <AlertTriangle className="h-3 w-3 text-yellow-500" />}
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    className={fieldClass('bruttobetrag')}
                    value={extracted.bruttobetrag || 0}
                    onChange={e => setExtracted({ ...extracted, bruttobetrag: parseFloat(e.target.value) || 0 })}
                    data-testid="input-gross-amount"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Nettobetrag (EUR)</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={extracted.nettobetrag || 0}
                    onChange={e => setExtracted({ ...extracted, nettobetrag: parseFloat(e.target.value) || 0 })}
                    data-testid="input-net-amount"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">USt-Betrag (EUR)</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={extracted.ustBetrag || 0}
                    onChange={e => setExtracted({ ...extracted, ustBetrag: parseFloat(e.target.value) || 0 })}
                    data-testid="input-vat-amount"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">USt-Satz (%)</label>
                  <Input
                    type="number"
                    value={extracted.ustSatz || 20}
                    onChange={e => setExtracted({ ...extracted, ustSatz: parseFloat(e.target.value) || 20 })}
                    data-testid="input-vat-rate"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Kategorie</label>
                  <Input
                    value={extracted.kategorie || ''}
                    onChange={e => setExtracted({ ...extracted, kategorie: e.target.value })}
                    data-testid="input-category"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium flex items-center gap-1">
                    Beschreibung{isUnsicher('beschreibung') && <AlertTriangle className="h-3 w-3 text-yellow-500" />}
                  </label>
                  <Input
                    className={fieldClass('beschreibung')}
                    value={extracted.beschreibung || ''}
                    onChange={e => setExtracted({ ...extracted, beschreibung: e.target.value })}
                    data-testid="input-description"
                  />
                </div>
                {properties && properties.length > 0 && (
                  <div className="md:col-span-2">
                    <label className="text-sm font-medium">Liegenschaft zuordnen</label>
                    <select
                      value={selectedProperty}
                      onChange={e => setSelectedProperty(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      data-testid="select-property"
                    >
                      <option value="">Liegenschaft auswählen</option>
                      {properties.map((p: any) => (
                        <option key={p.id} value={p.id}>{p.address}, {p.city}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div className="flex justify-end">
                <Button onClick={handleConfirm} disabled={confirming || Boolean(transferResult)} data-testid="button-confirm-booking">
                  {confirming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                  {transferResult ? 'Bereits übernommen' : 'In Buchhaltung übernehmen'}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}
