/**
 * Reine Utility-Funktionen für Batch-OCR-Review und Audit-Logging.
 * Keine React-Abhängigkeiten — direkt im Node.js-Testrunner importierbar.
 */

// ── Batch-Save-Loop ────────────────────────────────────────────────────────────

export interface BatchSaveItemInput {
  batchItemId: string;
  fileName: string;
  edited?: {
    bezeichnung: string;
    betrag: string;       // Komma als Dezimaltrennzeichen, z.B. "123,45"
    datum: string;
    beleg_nummer: string;
    category: string;
    expense_type: string;
    notizen: string;
  };
  file?: unknown;         // opak für reine Logik — wird an uploadFile durchgereicht
  originalOcr?: BatchOcrOriginalSnapshot & { notizen?: string };
  validierung?: { confidence_score?: number };
}

export interface BatchSaveOutcome {
  batchItemId: string;
  success: boolean;
  error?: string;
}

export interface BatchSaveDeps {
  /** Lädt die Datei hoch und gibt die URL zurück (oder undefined bei Fehler). */
  uploadFile: (file: unknown, propertyId: string) => Promise<string | undefined>;
  /**
   * Schreibt den Audit-Eintrag. Wirft eine Exception wenn der HTTP-Call fehlschlägt.
   * Wird nur aufgerufen wenn `auditPayload.hasChanges === true`.
   */
  postAudit: (payload: {
    originalData: Record<string, string | undefined>;
    correctedData: Record<string, string | undefined>;
    source: string;
    fileName: string;
  }) => Promise<void>;
  /** Legt den Kostenbeleg an. Wirft eine Exception bei Fehler. */
  createExpense: (data: {
    property_id: string;
    category: string;
    expense_type: string;
    bezeichnung: string;
    betrag: number;
    datum: string;
    beleg_nummer?: string;
    notizen?: string;
    year: number;
    month: number;
    beleg_url?: string;
  }) => Promise<void>;
}

export interface BatchSaveConfig {
  propertyId: string;
  abrechnungsjahrConfig?: {
    useCustom: boolean;
    year: number;
    verbrauchsTypes: string[];
  };
}

/**
 * Führt die Batch-Save-Schleife durch. Jedes Item wird unabhängig verarbeitet:
 * ein Fehler bei einem Item (Audit, Upload, oder Datenbankschreiber) überspringt
 * nur dieses Item und die Schleife läuft weiter.
 *
 * Gibt für jedes Item exakt ein Outcome zurück — keyed by batchItemId.
 * Items ohne edited-State oder mit ungültigem Betrag liefern ein failed-Outcome.
 */
export async function runBatchSaveLoop(
  items: BatchSaveItemInput[],
  config: BatchSaveConfig,
  deps: BatchSaveDeps,
): Promise<BatchSaveOutcome[]> {
  const outcomes: BatchSaveOutcome[] = [];

  for (const item of items) {
    const { batchItemId } = item;

    try {
      if (!item.edited) {
        outcomes.push({ batchItemId, success: false, error: 'Keine Formulardaten vorhanden' });
        continue;
      }

      const parsedAmount = parseFloat(item.edited.betrag.replace(',', '.'));
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        outcomes.push({ batchItemId, success: false, error: 'Ungültiger Betrag — bitte korrigieren' });
        continue;
      }

      const date = new Date(item.edited.datum);

      let beleg_url: string | undefined;
      if (item.file) {
        const url = await deps.uploadFile(item.file, config.propertyId);
        if (url) beleg_url = url;
      }

      const isVerbrauchskosten = config.abrechnungsjahrConfig?.verbrauchsTypes.includes(item.edited.expense_type);
      const useAbrechnungsjahr = config.abrechnungsjahrConfig?.useCustom && isVerbrauchskosten;
      const year  = useAbrechnungsjahr ? config.abrechnungsjahrConfig!.year : date.getFullYear();
      const month = useAbrechnungsjahr ? 12 : date.getMonth() + 1;

      // Audit-Log VOR dem Speichern (audit-before-write)
      const auditPayload = buildBatchOcrAuditPayload({
        originalOcr: item.originalOcr,
        edited: item.edited,
        validierung: item.validierung,
      });
      if (auditPayload?.hasChanges && auditPayload.originalData && auditPayload.correctedData) {
        await deps.postAudit({
          originalData: { ...auditPayload.originalData, confidence_score: item.validierung?.confidence_score?.toString() },
          correctedData: auditPayload.correctedData,
          source: 'batch_ocr',
          fileName: item.fileName,
        });
      }

      await deps.createExpense({
        property_id: config.propertyId,
        category: item.edited.category,
        expense_type: item.edited.expense_type,
        bezeichnung: item.edited.bezeichnung.trim(),
        betrag: parsedAmount,
        datum: item.edited.datum,
        beleg_nummer: item.edited.beleg_nummer || undefined,
        notizen: item.edited.notizen || undefined,
        year,
        month,
        beleg_url,
      });

      outcomes.push({ batchItemId, success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      outcomes.push({ batchItemId, success: false, error: message });
    }
  }

  return outcomes;
}

/** Snapshot der original-OCR-Werte, formatidentisch mit dem Edit-Formular. */
export interface BatchOcrOriginalSnapshot {
  bezeichnung: string;  // beschreibung || lieferant || ''
  betrag: string;       // betrag?.toString().replace('.', ',') || ''
  datum: string;        // datum || ISO-Tagesdatum
  beleg_nummer: string; // rechnungsnummer || ''
  category: string;     // kategorie || 'betriebskosten_umlagefaehig'
  expense_type: string; // expense_type || 'sonstiges'
}

/** Minimales Interface — passt zu BatchResultItem ohne React-Imports */
interface AuditableItem {
  selected?: boolean;
  saved?: boolean;
  needs_review?: boolean;
  reviewed?: boolean;
  originalOcr?: BatchOcrOriginalSnapshot;
  edited?: BatchOcrOriginalSnapshot & { notizen?: string };
  validierung?: { confidence_score?: number };
  fileName?: string;
}

/**
 * Zählt ausgewählte, noch nicht gespeicherte Belege die needs_review=true haben
 * aber noch nicht explizit durch den Verwalter geprüft wurden.
 * Gibt 0 zurück wenn alle ausgewählten Belege entweder kein Review benötigen
 * oder bereits als geprüft markiert wurden.
 */
export function countUnreviewedSelected(items: AuditableItem[]): number {
  return items.filter(
    i => i.selected && !i.saved && i.needs_review && !i.reviewed
  ).length;
}

export interface BatchOcrAuditPayload {
  hasChanges: boolean;
  originalData?: Record<string, string | undefined>;
  correctedData?: Record<string, string | undefined>;
}

/**
 * Erstellt den Audit-Payload für einen Batch-OCR-Eintrag.
 * Vergleicht den originalOcr-Snapshot (was die KI erkannt hat) mit den
 * tatsächlich gespeicherten Werten aus dem Edit-Formular.
 *
 * Gibt null zurück wenn kein OCR-Snapshot vorhanden ist (kein OCR-Durchlauf).
 * Gibt { hasChanges: false } zurück wenn keine Felder verändert wurden.
 * Nur dann ist eine Audit-Log-Buchung sinnvoll.
 */
export function buildBatchOcrAuditPayload(item: AuditableItem): BatchOcrAuditPayload | null {
  if (!item.originalOcr || !item.edited) return null;

  const orig = item.originalOcr;
  const edited = item.edited;

  const hasChanges =
    orig.bezeichnung !== edited.bezeichnung ||
    orig.betrag      !== edited.betrag      ||
    orig.datum       !== edited.datum       ||
    orig.beleg_nummer !== edited.beleg_nummer ||
    orig.category    !== edited.category    ||
    orig.expense_type !== edited.expense_type;

  if (!hasChanges) return { hasChanges: false };

  return {
    hasChanges: true,
    originalData: {
      lieferant:        orig.bezeichnung,
      betrag:           orig.betrag,
      datum:            orig.datum,
      rechnungsnummer:  orig.beleg_nummer,
      kategorie:        orig.category,
      expense_type:     orig.expense_type,
      confidence_score: item.validierung?.confidence_score?.toString(),
    },
    correctedData: {
      lieferant:        edited.bezeichnung,
      betrag:           edited.betrag,
      datum:            edited.datum,
      rechnungsnummer:  edited.beleg_nummer,
      kategorie:        edited.category,
      expense_type:     edited.expense_type,
    },
  };
}
