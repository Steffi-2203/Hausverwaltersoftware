import { useState, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FileImage, Upload, Loader2, AlertCircle, CheckCircle, Sparkles, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

async function convertPdfToImages(file: File): Promise<Blob[]> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;
    const blobs: Blob[] = [];
    
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      
      const scale = 2;
      const viewport = page.getViewport({ scale });
      
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Canvas context konnte nicht erstellt werden');
      }
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      await page.render({
        canvasContext: context,
        viewport: viewport,
      }).promise;
      
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) {
            resolve(b);
          } else {
            reject(new Error(`PDF-Seite ${pageNum} konnte nicht konvertiert werden`));
          }
        }, 'image/png', 0.95);
      });
      blobs.push(blob);
    }
    
    return blobs;
  } catch (error: any) {
    console.error('PDF conversion error:', error);
    throw new Error(`PDF-Konvertierung fehlgeschlagen: ${error.message || 'Unbekannter Fehler'}`);
  }
}

interface PdfScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  units: Array<{ id: string; top_nummer: string }>;
  onSuccess: () => void;
}

interface ExtractedTenantData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  mietbeginn: string;
  grundmiete: number;
  grundmieteUst?: number;
  betriebskostenVorschuss: number;
  heizkostenVorschuss: number;
  wasserkostenVorschuss: number;
  warmwasserkostenVorschuss: number;
  sonstigeKosten?: Record<string, { betrag: number; ust: number; schluessel?: string }>;
  kaution: number;
  topNummer: string;
  address: string;
  nutzungsart?: string;
  notes: string;
}

interface SaveResult {
  tenant: ExtractedTenantData;
  success: boolean;
  error?: string;
}

interface ScanError {
  page: number;
  error: string;
}

export function PdfScanDialog({ open, onOpenChange, propertyId, units, onSuccess }: PdfScanDialogProps) {
  const [step, setStep] = useState<'upload' | 'scanning' | 'saving' | 'done'>('upload');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, phase: '' });
  const [results, setResults] = useState<SaveResult[]>([]);
  const [scanErrors, setScanErrors] = useState<ScanError[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const successCount = results.filter(r => r.success).length;
  const errorCount = results.filter(r => !r.success).length;

  const reset = useCallback(() => {
    setStep('upload');
    setPreviewUrl(null);
    setError(null);
    setIsDragging(false);
    setProgress({ current: 0, total: 0, phase: '' });
    setResults([]);
    setScanErrors([]);
  }, []);

  const saveAllTenants = async (tenants: ExtractedTenantData[]) => {
    const saveResults: SaveResult[] = [];
    const createdUnitsCache = new Map<string, string>();
    
    for (let i = 0; i < tenants.length; i++) {
      const tenant = tenants[i];
      setProgress({ current: i + 1, total: tenants.length, phase: `${tenant.firstName} ${tenant.lastName}` });
      
      try {
        if (!tenant.firstName?.trim() || !tenant.lastName?.trim()) {
          saveResults.push({ 
            tenant, 
            success: false, 
            error: 'Name fehlt' 
          });
          continue;
        }

        let unitId = '';
        const topNummerKey = tenant.topNummer?.toLowerCase().trim() || '';
        
        const matchedUnit = units.find(u => 
          u.top_nummer.toLowerCase() === topNummerKey
        );
        
        if (matchedUnit) {
          unitId = matchedUnit.id;
        } else if (createdUnitsCache.has(topNummerKey)) {
          unitId = createdUnitsCache.get(topNummerKey)!;
        } else if (tenant.topNummer?.trim()) {
          try {
            const unitResponse = await apiRequest('POST', '/api/units', {
              property_id: propertyId,
              top_nummer: tenant.topNummer.trim(),
              type: 'wohnung',
              status: 'vermietet',
              flaeche: '0',
            });
            const unitData = await unitResponse.json();
            if (unitData?.id) {
              unitId = unitData.id;
              createdUnitsCache.set(topNummerKey, unitId);
            }
          } catch (unitError: any) {
            saveResults.push({ 
              tenant, 
              success: false, 
              error: `Einheit "${tenant.topNummer}" konnte nicht erstellt werden` 
            });
            continue;
          }
        } else {
          saveResults.push({ 
            tenant, 
            success: false, 
            error: 'Keine Einheit erkannt' 
          });
          continue;
        }

        await apiRequest('POST', '/api/tenants', {
          unit_id: unitId,
          first_name: tenant.firstName,
          last_name: tenant.lastName,
          email: tenant.email || null,
          phone: tenant.phone || null,
          mietbeginn: tenant.mietbeginn || new Date().toISOString().split('T')[0],
          grundmiete: tenant.grundmiete || 0,
          betriebskosten_vorschuss: tenant.betriebskostenVorschuss || 0,
          heizungskosten_vorschuss: tenant.heizkostenVorschuss || 0,
          wasserkosten_vorschuss: tenant.wasserkostenVorschuss || 0,
          warmwasserkosten_vorschuss: tenant.warmwasserkostenVorschuss || 0,
          sonstigeKosten: tenant.sonstigeKosten || null,
          kaution: tenant.kaution || null,
          notes: tenant.notes || null,
          status: 'aktiv',
        });

        saveResults.push({ tenant, success: true });
      } catch (err: any) {
        saveResults.push({ 
          tenant, 
          success: false, 
          error: err.message || 'Speichern fehlgeschlagen' 
        });
      }
    }
    
    return saveResults;
  };

  const handleFileSelect = useCallback(async (selectedFile: File) => {
    const isImage = selectedFile.type.startsWith('image/');
    const isPdf = selectedFile.type === 'application/pdf';

    if (!isImage && !isPdf) {
      toast({ 
        title: 'Ungültiges Format', 
        description: 'Bitte laden Sie ein Bild (JPG, PNG) oder PDF hoch.', 
        variant: 'destructive' 
      });
      return;
    }

    setStep('scanning');
    setError(null);
    setResults([]);
    setScanErrors([]);

    try {
      let imagesToProcess: Blob[] = [];
      let previewBlob: Blob = selectedFile;
      const pageErrors: ScanError[] = [];

      if (isPdf) {
        setProgress({ current: 0, total: 0, phase: 'PDF wird konvertiert...' });
        try {
          imagesToProcess = await convertPdfToImages(selectedFile);
          previewBlob = imagesToProcess[0];
          setProgress({ current: 0, total: imagesToProcess.length, phase: 'Seiten werden analysiert...' });
        } catch (pdfError: any) {
          setError(`PDF-Konvertierung fehlgeschlagen: ${pdfError.message}. Bitte laden Sie stattdessen einen Screenshot hoch.`);
          setStep('upload');
          return;
        }
      } else {
        imagesToProcess = [selectedFile];
        setProgress({ current: 0, total: 1, phase: 'Bild wird analysiert...' });
      }

      const previewUrl = URL.createObjectURL(previewBlob);
      setPreviewUrl(previewUrl);

      const allTenants: ExtractedTenantData[] = [];

      for (let i = 0; i < imagesToProcess.length; i++) {
        const imageBlob = imagesToProcess[i];
        setProgress({ current: i + 1, total: imagesToProcess.length, phase: `Seite ${i + 1} von ${imagesToProcess.length}` });

        const formData = new FormData();
        formData.append('file', imageBlob, 'page.png');
        formData.append('propertyId', propertyId);

        const response = await fetch('/api/ocr/tenant', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });

        const responseText = await response.text();
        
        let data;
        try {
          data = JSON.parse(responseText);
        } catch (parseError) {
          pageErrors.push({ page: i + 1, error: 'Ungültige Server-Antwort' });
          continue;
        }

        if (!response.ok) {
          pageErrors.push({ page: i + 1, error: data.message || 'OCR-Fehler' });
          continue;
        }
        
        if (data.tenants && Array.isArray(data.tenants)) {
          for (const t of data.tenants) {
            allTenants.push(t);
          }
        }
      }

      setScanErrors(pageErrors);

      if (allTenants.length === 0) {
        if (pageErrors.length > 0) {
          setError(`Keine Mieter erkannt. ${pageErrors.length} Seite(n) mit Fehlern.`);
        } else {
          setError('Keine Mieter im Dokument gefunden. Bitte prüfen Sie, ob das Dokument Mieterdaten enthält.');
        }
        setStep('upload');
        return;
      }

      setStep('saving');
      setProgress({ current: 0, total: allTenants.length, phase: 'Mieter werden angelegt...' });
      
      const saveResults = await saveAllTenants(allTenants);
      setResults(saveResults);
      
      const successCount = saveResults.filter(r => r.success).length;
      if (successCount > 0) {
        onSuccess();
      }
      
      setStep('done');
    } catch (err: any) {
      setError(err.message || 'Ein Fehler ist aufgetreten');
      setStep('upload');
    }
  }, [propertyId, units, toast, onSuccess]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  }, [handleFileSelect]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) reset(); onOpenChange(isOpen); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Dokument scannen (KI-Erkennung)
          </DialogTitle>
          <DialogDescription>
            Laden Sie einen Mietvertrag oder eine Vorschreibung hoch - alle erkannten Mieter werden automatisch angelegt.
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="py-6">
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div 
              className={cn(
                "border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors",
                isDragging 
                  ? "border-primary bg-primary/5" 
                  : "border-muted-foreground/25 hover:border-primary/50"
              )}
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              data-testid="dropzone-pdf-scan"
            >
              <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-lg font-medium mb-2">Dokument hochladen</p>
              <p className="text-sm text-muted-foreground mb-4">
                Ziehen Sie eine Datei hierher oder klicken Sie zum Auswählen
              </p>
              <p className="text-xs text-muted-foreground">
                Unterstützt: Bilder (JPG, PNG) und PDF-Dokumente
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,application/pdf"
              className="hidden"
              onChange={handleFileChange}
              data-testid="input-pdf-scan"
            />
          </div>
        )}

        {(step === 'scanning' || step === 'saving') && (
          <div className="py-12 text-center">
            <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary mb-4" />
            <p className="text-lg font-medium mb-2">
              {step === 'scanning' ? 'KI analysiert Dokument...' : 'Mieter werden angelegt...'}
            </p>
            {progress.total > 0 && (
              <div className="mt-4 space-y-2">
                <div className="w-full bg-muted rounded-full h-2.5">
                  <div 
                    className="bg-primary h-2.5 rounded-full transition-all duration-300" 
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  {progress.phase} ({progress.current}/{progress.total})
                </p>
              </div>
            )}
            {previewUrl && step === 'scanning' && (
              <div className="mt-6 max-w-xs mx-auto">
                <img 
                  src={previewUrl} 
                  alt="Vorschau" 
                  className="rounded-lg border border-border shadow-sm"
                />
              </div>
            )}
          </div>
        )}

        {step === 'done' && (
          <div className="py-8">
            <div className="text-center mb-6">
              {successCount > 0 ? (
                <CheckCircle className="h-16 w-16 text-success mx-auto mb-4" />
              ) : (
                <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
              )}
              <p className="text-xl font-semibold mb-2">
                {successCount > 0 
                  ? `${successCount} Mieter erfolgreich angelegt!` 
                  : 'Keine Mieter angelegt'}
              </p>
              {errorCount > 0 && (
                <p className="text-muted-foreground">
                  {errorCount} Mieter konnten nicht angelegt werden
                </p>
              )}
              {scanErrors.length > 0 && (
                <p className="text-sm text-amber-600 dark:text-amber-400 mt-2">
                  {scanErrors.length} Seite(n) mit Scan-Fehlern
                </p>
              )}
            </div>

            {scanErrors.length > 0 && (
              <div className="mb-4">
                <p className="text-sm font-medium mb-2">Scan-Fehler:</p>
                <div className="space-y-1">
                  {scanErrors.map((err, idx) => (
                    <div key={idx} className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 p-2 rounded">
                      Seite {err.page}: {err.error}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {results.length > 0 && (
              <div className="max-h-60 overflow-y-auto space-y-2 mb-6">
                {results.map((result, idx) => (
                  <div 
                    key={idx}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-lg border",
                      result.success 
                        ? "bg-success/10 border-success/30" 
                        : "bg-destructive/10 border-destructive/30"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {result.success ? (
                        <CheckCircle className="h-4 w-4 text-success flex-shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                      )}
                      <span className="font-medium">
                        {result.tenant.firstName} {result.tenant.lastName}
                      </span>
                      {result.tenant.topNummer && (
                        <span className="text-sm text-muted-foreground">
                          ({result.tenant.topNummer})
                        </span>
                      )}
                    </div>
                    {result.error && (
                      <span className="text-sm text-destructive">{result.error}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <DialogFooter className="justify-center gap-2">
              <Button variant="outline" onClick={reset} data-testid="button-scan-another">
                Weiteres Dokument scannen
              </Button>
              <Button onClick={() => onOpenChange(false)} data-testid="button-close-scan">
                Schließen
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
