import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ExpenseCategory, ExpenseType } from '@/hooks/useExpenses';

export interface ValidationReport {
  ist_valide: boolean;
  /** 0.0–1.0: Sicherheits-Score der KI-Erkennung. Unter 0.75 → Review-Pflicht. */
  confidence_score?: number;
  warnungen: string[];
  fehler: string[];
  korrekturen: string[];
  unsichere_felder: string[];
}

export interface OCRResult {
  lieferant: string | null;
  betrag: number | null;
  netto_betrag: number | null;
  datum: string | null;
  rechnungsnummer: string | null;
  iban: string | null;
  ust_betrag: number | null;
  ust_satz: number | null;
  kategorie: ExpenseCategory | null;
  expense_type: ExpenseType | null;
  beschreibung: string | null;
  leistungszeitraum_von: string | null;
  leistungszeitraum_bis: string | null;
  // Leistungsort für Property-Matching
  leistungsort_strasse: string | null;
  leistungsort_plz: string | null;
  leistungsort_stadt: string | null;
  validierung: ValidationReport;
  /**
   * true wenn confidence_score < 0.75 oder Pflichtfelder fehlen.
   * Signalisiert dem Frontend, das Review-Formular zu öffnen.
   */
  needs_review?: boolean;
}

export function useOCRInvoice() {
  return useMutation({
    mutationFn: async (file: File): Promise<OCRResult> => {
      const imageBase64 = await fileToBase64(file);
      
      const response = await fetch('/api/functions/ocr-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          imageBase64, 
          mimeType: file.type 
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'OCR-Analyse fehlgeschlagen');
      }
      
      const result = await response.json();
      // needs_review ist auf dem Top-Level der Antwort, data enthält die eigentlichen Felder
      const data = result.data as OCRResult;
      return { ...data, needs_review: result.needs_review ?? false };
    },
    onSuccess: (data) => {
      const validation = data.validierung;
      
      if (validation.fehler.length > 0) {
        toast.error('Rechnung analysiert - mit Fehlern', {
          description: validation.fehler.join(', ')
        });
      } else if (validation.warnungen.length > 0) {
        toast.warning('Rechnung analysiert - bitte prüfen', {
          description: `${validation.warnungen.length} Warnung(en)`
        });
      } else if (validation.korrekturen.length > 0) {
        toast.success('Rechnung analysiert und korrigiert', {
          description: `${validation.korrekturen.length} Korrektur(en) durchgeführt`
        });
      } else {
        toast.success('Rechnung erfolgreich analysiert');
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Fehler bei der OCR-Analyse';
      toast.error(message);
      console.error('OCR error:', error);
    },
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:image/jpeg;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
