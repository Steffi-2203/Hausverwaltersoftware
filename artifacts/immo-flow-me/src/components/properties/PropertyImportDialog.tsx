import { useState, useRef } from 'react';
import Papa from 'papaparse';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle, Download, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';
import { useQueryClient } from '@tanstack/react-query';

interface PropertyImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface ParsedRow {
  [key: string]: string;
}

interface ColumnMapping {
  name: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  buildingYear: string;
  totalQm: string;
  totalMea: string;
}

const defaultMapping: ColumnMapping = {
  name: '',
  address: '',
  city: '',
  postalCode: '',
  country: '',
  buildingYear: '',
  totalQm: '',
  totalMea: '',
};

export function PropertyImportDialog({ open, onOpenChange, onSuccess }: PropertyImportDialogProps) {
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview' | 'importing' | 'done'>('upload');
  const [csvData, setCsvData] = useState<ParsedRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>(defaultMapping);
  const [errors, setErrors] = useState<string[]>([]);
  const [importResults, setImportResults] = useState<{ success: number; failed: number; skipped: number }>({ success: 0, failed: 0, skipped: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const downloadTemplate = () => {
    const templateContent = 'Name;Adresse;Stadt;PLZ;Land;Baujahr;Fläche m²;MEA gesamt\nWohnhaus Musterstraße;Musterstraße 1;Wien;1010;Österreich;1985;450;1000\nBürogebäude Hauptplatz;Hauptplatz 5;Graz;8010;Österreich;2005;1200;2500';
    const blob = new Blob([templateContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'liegenschaften-import-vorlage.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

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
      delimiter: '',
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
        csvHeaders.forEach(header => {
          const lowerHeader = header.toLowerCase();
          if (lowerHeader.includes('name') || lowerHeader.includes('bezeichnung') || lowerHeader.includes('objekt')) {
            autoMapping.name = header;
          } else if (lowerHeader.includes('adresse') || lowerHeader.includes('straße') || lowerHeader.includes('strasse')) {
            autoMapping.address = header;
          } else if (lowerHeader.includes('stadt') || lowerHeader.includes('ort')) {
            autoMapping.city = header;
          } else if (lowerHeader.includes('plz') || lowerHeader.includes('postleitzahl')) {
            autoMapping.postalCode = header;
          } else if (lowerHeader.includes('land') || lowerHeader.includes('country')) {
            autoMapping.country = header;
          } else if (lowerHeader.includes('baujahr') || lowerHeader.includes('jahr') || lowerHeader.includes('year')) {
            autoMapping.buildingYear = header;
          } else if (lowerHeader.includes('fläche') || lowerHeader.includes('flaeche') || lowerHeader.includes('qm') || lowerHeader.includes('m²')) {
            autoMapping.totalQm = header;
          } else if (lowerHeader.includes('mea') || lowerHeader.includes('miteigentum')) {
            autoMapping.totalMea = header;
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
    if (!mapping.name) validationErrors.push('Name ist erforderlich');
    if (!mapping.address) validationErrors.push('Adresse ist erforderlich');
    if (!mapping.city) validationErrors.push('Stadt ist erforderlich');
    if (!mapping.postalCode) validationErrors.push('PLZ ist erforderlich');
    setErrors(validationErrors);
    return validationErrors.length === 0;
  };

  const handleProceedToPreview = () => {
    if (validateMapping()) {
      setStep('preview');
    }
  };

  const parseNumber = (value: string | undefined): number | null => {
    if (!value) return null;
    const cleanValue = value.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
    const num = parseFloat(cleanValue);
    return isNaN(num) ? null : num;
  };

  const parseYear = (value: string | undefined): number | null => {
    if (!value) return null;
    const num = parseInt(value.replace(/\D/g, ''), 10);
    return isNaN(num) || num < 1000 || num > 2100 ? null : num;
  };

  const handleImport = async () => {
    if (!user) {
      toast({ title: 'Fehler', description: 'Sie müssen angemeldet sein.', variant: 'destructive' });
      return;
    }

    setStep('importing');
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const importErrors: string[] = [];

    for (const row of csvData) {
      const name = row[mapping.name]?.trim();
      const address = row[mapping.address]?.trim();
      const city = row[mapping.city]?.trim();
      const postalCode = row[mapping.postalCode]?.trim();

      if (!name || !address || !city || !postalCode) {
        importErrors.push(`Zeile übersprungen: Pflichtfelder fehlen`);
        skippedCount++;
        continue;
      }

      // Check for duplicates
      try {
        const checkResponse = await fetch(`/api/properties?name=${encodeURIComponent(name)}&address=${encodeURIComponent(address)}&limit=1`, {
          credentials: 'include',
        });
        if (checkResponse.ok) {
          const existing = await checkResponse.json();
          if (existing && existing.length > 0) {
            importErrors.push(`"${name}" existiert bereits - übersprungen`);
            skippedCount++;
            continue;
          }
        }
      } catch (err) {
        console.warn('Could not check for existing property:', err);
      }

      const propertyId = crypto.randomUUID();
      const propertyData = {
        id: propertyId,
        name,
        address,
        city,
        postal_code: postalCode,
        country: mapping.country ? row[mapping.country]?.trim() || 'Österreich' : 'Österreich',
        building_year: mapping.buildingYear ? parseYear(row[mapping.buildingYear]) : null,
        total_qm: mapping.totalQm ? parseNumber(row[mapping.totalQm]) || 0 : 0,
        total_mea: mapping.totalMea ? parseNumber(row[mapping.totalMea]) || 0 : 0,
      };

      try {
        await apiRequest('POST', '/api/properties', propertyData);
      } catch (createError: any) {
        importErrors.push(`${name}: ${createError.message}`);
        failedCount++;
        continue;
      }

      // Assign current user as manager
      try {
        await apiRequest('POST', '/api/property-managers', {
          user_id: user.id,
          property_id: propertyId,
        });
      } catch (assignError) {
        console.warn(`Could not assign manager for ${name}:`, assignError);
      }

      successCount++;
    }

    setImportResults({ success: successCount, failed: failedCount, skipped: skippedCount });
    setErrors(importErrors);
    setStep('done');

    if (successCount > 0) {
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      queryClient.invalidateQueries({ queryKey: ['property_managers'] });
      onSuccess();
    }
  };

  const getMappedPreviewData = () => {
    return csvData.slice(0, 5).map(row => ({
      name: row[mapping.name] || '-',
      address: row[mapping.address] || '-',
      city: row[mapping.city] || '-',
      postalCode: row[mapping.postalCode] || '-',
      country: mapping.country ? row[mapping.country] || 'Österreich' : 'Österreich',
      buildingYear: mapping.buildingYear ? parseYear(row[mapping.buildingYear]) : null,
      totalQm: mapping.totalQm ? parseNumber(row[mapping.totalQm]) : null,
    }));
  };

  const renderMappingSelect = (
    label: string,
    field: keyof ColumnMapping,
    required: boolean = false
  ) => (
    <div>
      <Label>{label}{required && ' *'}</Label>
      <Select
        value={mapping[field] || 'none'}
        onValueChange={(v) => setMapping({ ...mapping, [field]: v === 'none' ? '' : v })}
      >
        <SelectTrigger>
          <SelectValue placeholder="Spalte wählen" />
        </SelectTrigger>
        <SelectContent>
          {!required && <SelectItem value="none">— Keine —</SelectItem>}
          {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) reset(); onOpenChange(open); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Liegenschaften aus CSV importieren
          </DialogTitle>
          <DialogDescription>
            Importieren Sie mehrere Liegenschaften aus einer CSV-Datei
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="py-8">
            <div className="flex justify-end mb-4">
              <Button variant="outline" size="sm" onClick={downloadTemplate}>
                <Download className="h-4 w-4 mr-2" />
                CSV-Vorlage herunterladen
              </Button>
            </div>
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
                Pflichtfelder: Name, Adresse, Stadt, PLZ | Optional: Land, Baujahr, Fläche, MEA
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
                <AlertDescription>{errors.join(', ')}</AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-2 gap-4">
              {renderMappingSelect('Name', 'name', true)}
              {renderMappingSelect('Adresse', 'address', true)}
              {renderMappingSelect('Stadt', 'city', true)}
              {renderMappingSelect('PLZ', 'postalCode', true)}
              {renderMappingSelect('Land', 'country')}
              {renderMappingSelect('Baujahr', 'buildingYear')}
              {renderMappingSelect('Fläche (m²)', 'totalQm')}
              {renderMappingSelect('MEA gesamt', 'totalMea')}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('upload')}>Zurück</Button>
              <Button onClick={handleProceedToPreview}>Weiter zur Vorschau</Button>
            </DialogFooter>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Vorschau der ersten {Math.min(5, csvData.length)} von {csvData.length} Liegenschaften:
            </p>

            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Adresse</TableHead>
                    <TableHead>Stadt</TableHead>
                    <TableHead>PLZ</TableHead>
                    <TableHead>Land</TableHead>
                    <TableHead className="text-right">Baujahr</TableHead>
                    <TableHead className="text-right">Fläche</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {getMappedPreviewData().map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>{row.address}</TableCell>
                      <TableCell>{row.city}</TableCell>
                      <TableCell>{row.postalCode}</TableCell>
                      <TableCell>{row.country}</TableCell>
                      <TableCell className="text-right">{row.buildingYear || '-'}</TableCell>
                      <TableCell className="text-right">{row.totalQm ? `${row.totalQm.toLocaleString('de-AT')} m²` : '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('mapping')}>Zurück</Button>
              <Button onClick={handleImport}>
                {csvData.length} Liegenschaften importieren
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'importing' && (
          <div className="py-12 text-center">
            <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary mb-4" />
            <p className="text-lg font-medium">Import läuft...</p>
            <p className="text-sm text-muted-foreground">Bitte warten Sie, während die Daten importiert werden.</p>
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-6">
            <div className="py-8 text-center">
              <CheckCircle className="h-12 w-12 mx-auto text-success mb-4" />
              <p className="text-lg font-medium mb-2">Import abgeschlossen</p>
              <div className="flex justify-center gap-6 text-sm">
                <span className="text-success">{importResults.success} erfolgreich</span>
                {importResults.skipped > 0 && <span className="text-warning">{importResults.skipped} übersprungen</span>}
                {importResults.failed > 0 && <span className="text-destructive">{importResults.failed} fehlgeschlagen</span>}
              </div>
            </div>

            {errors.length > 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <ul className="list-disc list-inside max-h-32 overflow-y-auto">
                    {errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button onClick={() => { reset(); onOpenChange(false); }}>Schließen</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
