import { useState, useRef } from 'react';
import Papa from 'papaparse';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface UnitImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  existingUnits: Array<{ top_nummer: string }>;
  onSuccess: () => void;
}

interface ParsedRow {
  [key: string]: string;
}

interface ColumnMapping {
  topNummer: string;
  type: string;
  qm: string;
  mea: string;
  floor: string;
  vsPersonen: string;
  vsHeizungVerbrauch: string;
  vsWasserVerbrauch: string;
  vsQm: string;
  vsMea: string;
}

const defaultMapping: ColumnMapping = {
  topNummer: '',
  type: '',
  qm: '',
  mea: '',
  floor: '',
  vsPersonen: '',
  vsHeizungVerbrauch: '',
  vsWasserVerbrauch: '',
  vsQm: '',
  vsMea: '',
};

const unitTypeMap: Record<string, string> = {
  'wohnung': 'wohnung',
  'wohn': 'wohnung',
  'geschäft': 'geschaeft',
  'geschaeft': 'geschaeft',
  'gewerbe': 'geschaeft',
  'lokal': 'geschaeft',
  'garage': 'garage',
  'stellplatz': 'stellplatz',
  'parkplatz': 'stellplatz',
  'lager': 'lager',
  'keller': 'lager',
  'sonstiges': 'sonstiges',
};

export function UnitImportDialog({ open, onOpenChange, propertyId, existingUnits, onSuccess }: UnitImportDialogProps) {
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview' | 'importing' | 'done'>('upload');
  const [csvData, setCsvData] = useState<ParsedRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>(defaultMapping);
  const [errors, setErrors] = useState<string[]>([]);
  const [importResults, setImportResults] = useState<{ success: number; failed: number; skipped: number }>({ success: 0, failed: 0, skipped: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const reset = () => {
    setStep('upload');
    setCsvData([]);
    setHeaders([]);
    setMapping(defaultMapping);
    setErrors([]);
    setImportResults({ success: 0, failed: 0, skipped: 0 });
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      encoding: 'UTF-8',
      delimiter: '', // Auto-detect delimiter (comma, semicolon, tab)
      complete: (results) => {
        const data = results.data as ParsedRow[];
        if (data.length === 0) {
          toast({ title: 'Fehler', description: 'Die CSV-Datei ist leer.', variant: 'destructive' });
          return;
        }
        
        const csvHeaders = Object.keys(data[0]);
        setHeaders(csvHeaders);
        setCsvData(data);
        
        // Auto-detect column mapping
        const autoMapping: ColumnMapping = { ...defaultMapping };
        csvHeaders.forEach((header, index) => {
          const lowerHeader = header.toLowerCase().trim();
          
          // First column with empty or no name is often the type
          if (index === 0 && (lowerHeader === '' || !lowerHeader)) {
            autoMapping.type = header;
          } else if (lowerHeader.includes('top') || lowerHeader.includes('nummer') || lowerHeader.includes('einheit')) {
            autoMapping.topNummer = header;
          } else if (lowerHeader.includes('typ') || lowerHeader.includes('art')) {
            autoMapping.type = header;
          } else if (lowerHeader === 'qm' || lowerHeader.includes('fläche') || lowerHeader.includes('flaeche') || lowerHeader.includes('m²') || lowerHeader.includes('quadratmeter')) {
            autoMapping.qm = header;
          } else if (lowerHeader === 'mea' || lowerHeader.includes('miteigentum')) {
            autoMapping.mea = header;
          } else if (lowerHeader.includes('etage') || lowerHeader.includes('stock') || lowerHeader.includes('floor')) {
            autoMapping.floor = header;
          } else if (lowerHeader.includes('person')) {
            autoMapping.vsPersonen = header;
          } else if (lowerHeader.includes('heizung') && lowerHeader.includes('verbrauch')) {
            autoMapping.vsHeizungVerbrauch = header;
          } else if (lowerHeader.includes('wasser') && lowerHeader.includes('verbrauch')) {
            autoMapping.vsWasserVerbrauch = header;
          }
        });
        setMapping(autoMapping);
        setStep('mapping');
      },
      error: (error) => {
        toast({ title: 'Fehler', description: `CSV-Parsing fehlgeschlagen: ${error.message}`, variant: 'destructive' });
      }
    });
  };

  const validateMapping = (): boolean => {
    const validationErrors: string[] = [];
    if (!mapping.topNummer) validationErrors.push('Top/Einheit ist erforderlich');
    setErrors(validationErrors);
    return validationErrors.length === 0;
  };

  const handleProceedToPreview = () => {
    if (validateMapping()) {
      setStep('preview');
    }
  };

  const parseNumber = (value: string | undefined): number => {
    if (!value) return 0;
    // Handle German number format (comma as decimal separator)
    const cleanValue = value.replace(/[€\s‰m²]/g, '').replace(/\./g, '').replace(',', '.');
    const num = parseFloat(cleanValue);
    return isNaN(num) ? 0 : num;
  };

  const parseUnitType = (value: string | undefined): 'wohnung' | 'geschaeft' | 'garage' | 'stellplatz' | 'lager' | 'sonstiges' => {
    if (!value) return 'wohnung';
    const lowerValue = value.toLowerCase().trim();
    return (unitTypeMap[lowerValue] || 'wohnung') as any;
  };

  const isExistingUnit = (topNummer: string): boolean => {
    const cleanTop = topNummer.toString().trim().toLowerCase();
    return existingUnits.some(u => u.top_nummer.toLowerCase() === cleanTop);
  };

  const handleImport = async () => {
    setStep('importing');
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const importErrors: string[] = [];

    for (const row of csvData) {
      const topNummer = row[mapping.topNummer]?.trim();
      
      if (!topNummer) {
        importErrors.push('Zeile ohne Top-Nummer übersprungen');
        skippedCount++;
        continue;
      }

      if (isExistingUnit(topNummer)) {
        importErrors.push(`Einheit "${topNummer}" existiert bereits - übersprungen`);
        skippedCount++;
        continue;
      }

      const unitData = {
        property_id: propertyId,
        top_nummer: topNummer,
        type: parseUnitType(row[mapping.type]),
        qm: parseNumber(row[mapping.qm]),
        mea: parseNumber(row[mapping.mea]),
        floor: mapping.floor ? Math.floor(parseNumber(row[mapping.floor])) || null : null,
        vs_personen: mapping.vsPersonen ? Math.floor(parseNumber(row[mapping.vsPersonen])) : 0,
        vs_heizung_verbrauch: mapping.vsHeizungVerbrauch ? parseNumber(row[mapping.vsHeizungVerbrauch]) : 0,
        vs_wasser_verbrauch: mapping.vsWasserVerbrauch ? parseNumber(row[mapping.vsWasserVerbrauch]) : 0,
        vs_qm: mapping.vsQm ? parseNumber(row[mapping.vsQm]) : parseNumber(row[mapping.qm]),
        vs_mea: mapping.vsMea ? parseNumber(row[mapping.vsMea]) : parseNumber(row[mapping.mea]),
        status: 'leerstand' as const,
      };

      try {
        await apiRequest('POST', '/api/units', unitData);
        successCount++;
      } catch (error: any) {
        importErrors.push(`${topNummer}: ${error.message}`);
        failedCount++;
      }
    }

    setImportResults({ success: successCount, failed: failedCount, skipped: skippedCount });
    setErrors(importErrors);
    setStep('done');

    if (successCount > 0) {
      onSuccess();
    }
  };

  const getMappedPreviewData = () => {
    return csvData.slice(0, 5).map(row => ({
      topNummer: row[mapping.topNummer] || '-',
      type: parseUnitType(row[mapping.type]),
      qm: parseNumber(row[mapping.qm]),
      mea: parseNumber(row[mapping.mea]),
      vsPersonen: mapping.vsPersonen ? Math.floor(parseNumber(row[mapping.vsPersonen])) : 0,
      isDuplicate: isExistingUnit(row[mapping.topNummer] || ''),
    }));
  };

  const unitTypeLabels: Record<string, string> = {
    wohnung: 'Wohnung',
    geschaeft: 'Geschäft',
    garage: 'Garage',
    stellplatz: 'Stellplatz',
    lager: 'Lager',
    sonstiges: 'Sonstiges',
  };

  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) reset(); onOpenChange(open); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Einheiten aus CSV importieren
          </DialogTitle>
          <DialogDescription>
            Importieren Sie Einheiten aus einer CSV-Datei
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="py-8">
            <div 
              className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-12 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-lg font-medium mb-2">CSV-Datei hochladen</p>
              <p className="text-sm text-muted-foreground mb-4">
                Klicken Sie hier oder ziehen Sie eine Datei hierher
              </p>
              <p className="text-xs text-muted-foreground">
                Unterstützte Spalten: Top Nr., Typ, Fläche (m²), MEA, Etage, Personen, Heizungsverbrauch, Wasserverbrauch
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Beispiel Top-Nummern: W1 = Wohnung, L1 = Lokal/Geschäft, G1 = Garage
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>
        )}

        {step === 'mapping' && (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
              {csvData.length} Zeilen gefunden. Ordnen Sie die CSV-Spalten den Feldern zu:
            </p>

            {errors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {errors.join(', ')}
                </AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Top/Einheit *</Label>
                <Select value={mapping.topNummer} onValueChange={(v) => setMapping({ ...mapping, topNummer: v })}>
                  <SelectTrigger><SelectValue placeholder="Spalte wählen" /></SelectTrigger>
                  <SelectContent>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Typ (Wohnung, Geschäft, ...)</Label>
                <Select value={mapping.type || "none"} onValueChange={(v) => setMapping({ ...mapping, type: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Spalte wählen" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Keine (Standard: Wohnung) —</SelectItem>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Fläche (m²)</Label>
                <Select value={mapping.qm || "none"} onValueChange={(v) => setMapping({ ...mapping, qm: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Spalte wählen" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Keine —</SelectItem>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>MEA (‰)</Label>
                <Select value={mapping.mea || "none"} onValueChange={(v) => setMapping({ ...mapping, mea: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Spalte wählen" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Keine —</SelectItem>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Etage</Label>
                <Select value={mapping.floor || "none"} onValueChange={(v) => setMapping({ ...mapping, floor: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Spalte wählen" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Keine —</SelectItem>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Personenanzahl</Label>
                <Select value={mapping.vsPersonen || "none"} onValueChange={(v) => setMapping({ ...mapping, vsPersonen: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Spalte wählen" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Keine —</SelectItem>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Heizungsverbrauch (kWh)</Label>
                <Select value={mapping.vsHeizungVerbrauch || "none"} onValueChange={(v) => setMapping({ ...mapping, vsHeizungVerbrauch: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Spalte wählen" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Keine —</SelectItem>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Wasserverbrauch (m³)</Label>
                <Select value={mapping.vsWasserVerbrauch || "none"} onValueChange={(v) => setMapping({ ...mapping, vsWasserVerbrauch: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Spalte wählen" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Keine —</SelectItem>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('upload')}>Zurück</Button>
              <Button onClick={handleProceedToPreview}>Weiter zur Vorschau</Button>
            </DialogFooter>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Vorschau der ersten 5 Einträge von {csvData.length} gesamt:
            </p>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Top Nr.</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead>Fläche</TableHead>
                  <TableHead>MEA</TableHead>
                  <TableHead>Personen</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {getMappedPreviewData().map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{row.topNummer}</TableCell>
                    <TableCell>{unitTypeLabels[row.type]}</TableCell>
                    <TableCell>{row.qm.toLocaleString('de-AT')} m²</TableCell>
                    <TableCell>{row.mea}‰</TableCell>
                    <TableCell>{row.vsPersonen}</TableCell>
                    <TableCell>
                      {row.isDuplicate ? (
                        <span className="text-warning flex items-center gap-1">
                          <AlertCircle className="h-4 w-4" />
                          Existiert
                        </span>
                      ) : (
                        <span className="text-success flex items-center gap-1">
                          <CheckCircle className="h-4 w-4" />
                          Neu
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Bereits existierende Einheiten (gleiche Top Nr.) werden übersprungen.
              </AlertDescription>
            </Alert>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('mapping')}>Zurück</Button>
              <Button onClick={handleImport}>
                Einheiten importieren
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'importing' && (
          <div className="py-12 text-center">
            <div className="animate-spin h-12 w-12 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-lg">Importiere Einheiten...</p>
          </div>
        )}

        {step === 'done' && (
          <div className="py-8 space-y-4">
            <div className="text-center">
              <CheckCircle className="h-16 w-16 text-success mx-auto mb-4" />
              <p className="text-xl font-semibold mb-2">Import abgeschlossen</p>
              <p className="text-muted-foreground">
                {importResults.success} erfolgreich, {importResults.skipped} übersprungen, {importResults.failed} fehlgeschlagen
              </p>
            </div>

            {errors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <ul className="list-disc list-inside max-h-32 overflow-y-auto">
                    {errors.slice(0, 10).map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                    {errors.length > 10 && <li>... und {errors.length - 10} weitere</li>}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button onClick={() => { reset(); onOpenChange(false); }}>
                Schließen
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
