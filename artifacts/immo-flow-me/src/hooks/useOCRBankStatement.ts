import { useState, useCallback } from 'react';
import { toast } from 'sonner';

export interface BankStatementLine {
  datum: string;
  betrag: number;
  verwendungszweck: string;
  auftraggeber_empfaenger: string | null;
  iban: string | null;
  buchungstext: string | null;
}

export interface OCRBankStatementResult {
  kontoinhaber: string | null;
  iban: string | null;
  auszugsnummer: string | null;
  zeitraum_von: string | null;
  zeitraum_bis: string | null;
  buchungen: BankStatementLine[];
  validierung: {
    ist_valide: boolean;
    warnungen: string[];
    erkannte_zeilen: number;
  };
}

export interface MatchedBankLine extends BankStatementLine {
  id: string;
  matchedUnitId: string | null;
  matchedTenantId: string | null;
  matchedPropertyId: string | null;
  confidence: number;
  matchReason: string;
  matchType: 'exact' | 'fuzzy' | 'learned' | 'none';
  selected: boolean;
  categoryId: string | null;
  isRentalIncome: boolean;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix (e.g., "data:image/png;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
  });
}

export function useOCRBankStatement() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<OCRBankStatementResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const processFile = useCallback(async (file: File): Promise<OCRBankStatementResult | null> => {
    setIsProcessing(true);
    setError(null);
    setResult(null);

    try {
      // Validate file type
      const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
      if (!validTypes.includes(file.type)) {
        throw new Error('Ungültiger Dateityp. Bitte PDF, JPG oder PNG hochladen.');
      }

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        throw new Error('Datei zu groß. Maximal 10MB erlaubt.');
      }

      const imageBase64 = await fileToBase64(file);
      const mimeType = file.type;

      console.log('Sending bank statement for OCR processing...');

      const response = await fetch('/api/functions/ocr-bank-statement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          imageBase64, 
          mimeType 
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'OCR-Analyse fehlgeschlagen');
      }
      
      const result = await response.json();
      const ocrResult = result.data as OCRBankStatementResult;
      setResult(ocrResult);
      
      if (ocrResult.validierung.ist_valide) {
        toast.success('Kontoauszug analysiert', {
          description: `${ocrResult.buchungen.length} Buchungen erkannt`
        });
      } else {
        toast.warning('Kontoauszug analysiert - mit Warnungen', {
          description: ocrResult.validierung.warnungen.join(', ')
        });
      }
      
      return ocrResult;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unbekannter Fehler';
      setError(errorMessage);
      
      // Handle specific error codes
      if (errorMessage.includes('Rate limit') || errorMessage.includes('429')) {
        toast.error('Zu viele Anfragen', {
          description: 'Bitte warten Sie einen Moment und versuchen Sie es erneut.'
        });
      } else if (errorMessage.includes('402') || errorMessage.includes('Guthaben')) {
        toast.error('AI-Guthaben aufgebraucht', {
          description: 'Bitte laden Sie Ihr Lovable AI Guthaben auf.'
        });
      } else {
        toast.error('OCR-Fehler', { description: errorMessage });
      }
      
      return null;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setIsProcessing(false);
  }, []);

  return {
    processFile,
    isProcessing,
    result,
    error,
    reset
  };
}
