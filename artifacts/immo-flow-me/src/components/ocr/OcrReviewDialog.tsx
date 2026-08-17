/**
 * OcrReviewDialog — zeigt OCR-Ergebnisse zur manuellen Prüfung an
 *
 * Öffnet sich automatisch wenn confidence_score < 0.75 oder Pflichtfelder
 * fehlen (Betrag, Datum, Lieferant). Felder die in unsichere_felder stehen
 * werden gelb hervorgehoben. Korrekturen werden ins Audit-Log geschrieben.
 */
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, CheckCircle, XCircle, Eye, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type OCRResult } from '@/hooks/useOCRInvoice';
import {
  expenseCategoryLabels,
  expenseTypeLabels,
  expenseTypesByCategory,
  type ExpenseCategory,
  type ExpenseType,
} from '@/hooks/useExpenses';

export interface OcrReviewResult {
  lieferant: string;
  betrag: string;
  datum: string;
  rechnungsnummer: string;
  kategorie: ExpenseCategory;
  expense_type: ExpenseType;
  notizen: string;
  beschreibung: string;
  /** Felder die der Nutzer verändert hat (für Audit-Log) */
  corrections: Record<string, { original: string | number | null; corrected: string }>;
}

interface OcrReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ocrResult: OCRResult;
  onConfirm: (result: OcrReviewResult) => void;
  onCancel: () => void;
  fileName?: string;
}

function ConfidenceBadge({ score }: { score: number }) {
  if (score >= 0.85) {
    return (
      <Badge className="bg-green-600 text-white gap-1">
        <CheckCircle className="h-3 w-3" />
        Hohe Sicherheit ({Math.round(score * 100)}%)
      </Badge>
    );
  }
  if (score >= 0.6) {
    return (
      <Badge className="bg-yellow-500 text-black gap-1">
        <AlertTriangle className="h-3 w-3" />
        Mittlere Sicherheit ({Math.round(score * 100)}%)
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-600 text-white gap-1">
      <XCircle className="h-3 w-3" />
      Niedrige Sicherheit ({Math.round(score * 100)}%)
    </Badge>
  );
}

function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    lieferant: 'Lieferant',
    betrag: 'Betrag',
    datum: 'Datum',
    rechnungsnummer: 'Belegnummer',
    kategorie: 'Kategorie',
    expense_type: 'Kostenart',
  };
  return labels[field] ?? field;
}

export function OcrReviewDialog({
  open,
  onOpenChange,
  ocrResult,
  onConfirm,
  onCancel,
  fileName,
}: OcrReviewDialogProps) {
  const confidenceScore = ocrResult.validierung?.confidence_score ?? 1.0;
  const unsichereFelder: string[] = ocrResult.validierung?.unsichere_felder ?? [];
  const warnungen: string[] = ocrResult.validierung?.warnungen ?? [];
  const fehler: string[] = ocrResult.validierung?.fehler ?? [];

  const [form, setForm] = useState({
    lieferant: ocrResult.lieferant ?? '',
    betrag: ocrResult.betrag?.toString().replace('.', ',') ?? '',
    datum: ocrResult.datum ?? new Date().toISOString().split('T')[0],
    rechnungsnummer: ocrResult.rechnungsnummer ?? '',
    kategorie: (ocrResult.kategorie ?? 'betriebskosten_umlagefaehig') as ExpenseCategory,
    expense_type: (ocrResult.expense_type ?? 'sonstiges') as ExpenseType,
    notizen: ocrResult.iban ? `IBAN: ${ocrResult.iban}` : '',
    beschreibung: ocrResult.beschreibung ?? '',
  });

  const isUnsicher = (field: string) =>
    unsichereFelder.some(f => f.toLowerCase().includes(field.toLowerCase()));

  const handleConfirm = () => {
    // Korrekturen ermitteln: Felder die der Nutzer geändert hat
    const originalValues: Record<string, string | number | null> = {
      lieferant: ocrResult.lieferant,
      betrag: ocrResult.betrag?.toString().replace('.', ',') ?? '',
      datum: ocrResult.datum,
      rechnungsnummer: ocrResult.rechnungsnummer,
    };

    const corrections: Record<string, { original: string | number | null; corrected: string }> = {};
    Object.entries(originalValues).forEach(([key, original]) => {
      const corrected = form[key as keyof typeof form] as string;
      const origStr = original?.toString() ?? '';
      if (corrected !== origStr) {
        corrections[key] = { original, corrected };
      }
    });

    onConfirm({ ...form, corrections });
  };

  const fieldClass = (field: string) =>
    cn(
      'transition-colors',
      isUnsicher(field) && 'ring-2 ring-yellow-400/60 rounded-md'
    );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-primary" />
            OCR-Ergebnis prüfen
          </DialogTitle>
          <DialogDescription>
            {fileName && <span className="font-medium">{fileName}</span>}
            {' '}Bitte prüfen und korrigieren Sie die erkannten Daten bevor der Beleg gespeichert wird.
          </DialogDescription>
        </DialogHeader>

        {/* Confidence Banner */}
        <div className="flex items-center justify-between py-1">
          <ConfidenceBadge score={confidenceScore} />
          {unsichereFelder.length > 0 && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm bg-yellow-400/60 border border-yellow-500" />
              Unsichere Felder: {unsichereFelder.map(fieldLabel).join(', ')}
            </span>
          )}
        </div>

        {/* Errors & Warnings */}
        {(fehler.length > 0 || warnungen.length > 0) && (
          <div className="space-y-2">
            {fehler.map((f, i) => (
              <Alert key={i} variant="destructive" className="py-2">
                <XCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">{f}</AlertDescription>
              </Alert>
            ))}
            {warnungen.map((w, i) => (
              <Alert key={i} className="py-2 border-yellow-400 bg-yellow-50 dark:bg-yellow-950/20">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                <AlertDescription className="text-sm text-yellow-800 dark:text-yellow-200">{w}</AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        {/* Editable Form */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1">
              Lieferant
              {isUnsicher('lieferant') && <AlertTriangle className="h-3 w-3 text-yellow-500" />}
            </Label>
            <Input
              className={fieldClass('lieferant')}
              value={form.lieferant}
              onChange={e => setForm(f => ({ ...f, lieferant: e.target.value }))}
              placeholder="Lieferant eingeben"
              data-testid="ocr-review-lieferant"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1">
              Bruttobetrag (€)
              {isUnsicher('betrag') && <AlertTriangle className="h-3 w-3 text-yellow-500" />}
            </Label>
            <Input
              className={fieldClass('betrag')}
              value={form.betrag}
              onChange={e => setForm(f => ({ ...f, betrag: e.target.value }))}
              placeholder="0,00"
              data-testid="ocr-review-betrag"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1">
              Datum
              {isUnsicher('datum') && <AlertTriangle className="h-3 w-3 text-yellow-500" />}
            </Label>
            <Input
              type="date"
              className={fieldClass('datum')}
              value={form.datum}
              onChange={e => setForm(f => ({ ...f, datum: e.target.value }))}
              data-testid="ocr-review-datum"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1">
              Belegnummer
              {isUnsicher('rechnungsnummer') && <AlertTriangle className="h-3 w-3 text-yellow-500" />}
            </Label>
            <Input
              className={fieldClass('rechnungsnummer')}
              value={form.rechnungsnummer}
              onChange={e => setForm(f => ({ ...f, rechnungsnummer: e.target.value }))}
              placeholder="Optional"
              data-testid="ocr-review-rechnungsnummer"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Kategorie</Label>
            <Select
              value={form.kategorie}
              onValueChange={v => {
                const cat = v as ExpenseCategory;
                const types = expenseTypesByCategory[cat];
                setForm(f => ({
                  ...f,
                  kategorie: cat,
                  expense_type: types.includes(f.expense_type) ? f.expense_type : types[0],
                }));
              }}
            >
              <SelectTrigger data-testid="ocr-review-kategorie">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(expenseCategoryLabels).map(([k, l]) => (
                  <SelectItem key={k} value={k}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Kostenart</Label>
            <Select
              value={form.expense_type}
              onValueChange={v => setForm(f => ({ ...f, expense_type: v as ExpenseType }))}
            >
              <SelectTrigger data-testid="ocr-review-expense-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {expenseTypesByCategory[form.kategorie].map(t => (
                  <SelectItem key={t} value={t}>{expenseTypeLabels[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">Beschreibung</Label>
            <Input
              value={form.beschreibung}
              onChange={e => setForm(f => ({ ...f, beschreibung: e.target.value }))}
              placeholder="Kurze Beschreibung der Leistung"
              data-testid="ocr-review-beschreibung"
            />
          </div>
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={onCancel} data-testid="ocr-review-cancel">
            Abbrechen
          </Button>
          <Button
            onClick={handleConfirm}
            data-testid="ocr-review-confirm"
          >
            <Pencil className="h-4 w-4 mr-1.5" />
            Übernehmen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
