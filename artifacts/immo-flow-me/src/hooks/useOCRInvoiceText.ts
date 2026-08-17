import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ExpenseCategory, ExpenseType } from '@/hooks/useExpenses';

export interface UstPruefung {
  reverse_charge_erkannt: boolean;
  uid_lieferant_valide: boolean | null;
  uid_empfaenger_valide: boolean | null;
  ust_satz_korrekt: boolean;
}

export interface ValidationReport {
  ist_valide: boolean;
  warnungen: string[];
  fehler: string[];
  korrekturen: string[];
  unsichere_felder: string[];
  ust_pruefung: UstPruefung;
}

export interface OCRTextResult {
  rechnungsart: string | null;
  lieferant: string | null;
  lieferant_uid: string | null;
  empfaenger_uid: string | null;
  rechnungsnummer: string | null;
  rechnungsdatum: string | null;
  leistungszeitraum_von: string | null;
  leistungszeitraum_bis: string | null;
  nettobetrag: number | null;
  ust_satz: number | null;
  ust_betrag: number | null;
  bruttobetrag: number | null;
  zahlungsziel: string | null;
  objekt: string | null;
  einheit: string | null;
  iban: string | null;
  bic: string | null;
  kategorie: ExpenseCategory | null;
  expense_type: ExpenseType | null;
  reverse_charge: boolean;
  steuerhinweis: string | null;
  validierung: ValidationReport;
}

export function useOCRInvoiceText() {
  return useMutation({
    mutationFn: async (ocrText: string): Promise<OCRTextResult> => {
      const response = await fetch('/api/functions/ocr-invoice-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ocrText }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'OCR-Analyse fehlgeschlagen');
      }
      
      const result = await response.json();
      return result.data as OCRTextResult;
    },
    onSuccess: (data) => {
      const validation = data.validierung;
      
      // Show Reverse-Charge warning prominently
      if (validation.ust_pruefung.reverse_charge_erkannt) {
        toast.warning('Reverse-Charge Rechnung erkannt', {
          description: 'Steuerschuld geht auf Leistungsempfänger über'
        });
      }
      
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
          description: `${validation.korrekturen.length} Korrektur(en)`
        });
      } else {
        toast.success('Rechnung erfolgreich analysiert');
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Fehler bei der OCR-Analyse';
      toast.error(message);
      console.error('OCR text error:', error);
    },
  });
}
