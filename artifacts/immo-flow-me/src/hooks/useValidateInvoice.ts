import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

export interface InvoiceData {
  lieferant?: string | null;
  rechnungsnummer?: string | null;
  rechnungsdatum?: string | null;
  leistungszeitraum_von?: string | null;
  leistungszeitraum_bis?: string | null;
  nettobetrag?: number | null;
  ust_satz?: number | null;
  ust_betrag?: number | null;
  bruttobetrag?: number | null;
  zahlungsziel?: string | null;
  iban?: string | null;
  kategorie?: string | null;
  expense_type?: string | null;
  [key: string]: any;
}

export interface UnsicheresFeld {
  feld: string;
  grund: string;
}

export interface ValidationReport {
  ist_valide: boolean;
  gefundene_fehler: string[];
  vorgenommene_korrekturen: string[];
  unsichere_felder: UnsicheresFeld[];
  hinweise: string[];
}

export interface ValidationResult {
  korrigierte_daten: InvoiceData;
  validierungsbericht: ValidationReport;
}

export function useValidateInvoice() {
  return useMutation({
    mutationFn: async (invoiceData: InvoiceData): Promise<ValidationResult> => {
      const response = await fetch('/api/functions/validate-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ daten: invoiceData }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Validierung fehlgeschlagen');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      const report = data.validierungsbericht;
      
      if (!report.ist_valide) {
        toast.error('Validierung fehlgeschlagen', {
          description: `${report.gefundene_fehler.length} Fehler gefunden`
        });
      } else if (report.vorgenommene_korrekturen.length > 0) {
        toast.success('Daten validiert und korrigiert', {
          description: `${report.vorgenommene_korrekturen.length} Korrektur(en)`
        });
      } else if (report.hinweise.length > 0) {
        toast.info('Validierung erfolgreich', {
          description: `${report.hinweise.length} Hinweis(e)`
        });
      } else {
        toast.success('Validierung erfolgreich - keine Fehler');
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Fehler bei der Validierung';
      toast.error(message);
      console.error('Validation error:', error);
    },
  });
}
