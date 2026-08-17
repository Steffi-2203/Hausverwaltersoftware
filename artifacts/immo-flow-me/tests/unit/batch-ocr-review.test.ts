/**
 * Batch-OCR-Review — Unit-Tests
 *
 * Prüft:
 * 1. countUnreviewedSelected: blockiert Speichern korrekt
 * 2. buildBatchOcrAuditPayload: erkennt Änderungen zuverlässig,
 *    produziert keinen Eintrag wenn nichts geändert wurde,
 *    verwendet semantisch korrekte Felder (originalOcr-Snapshot)
 */
import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  countUnreviewedSelected,
  buildBatchOcrAuditPayload,
  type BatchOcrOriginalSnapshot,
} from '../../src/lib/batchOcrUtils.js';

// ── Hilfsfunktionen ────────────────────────────────────────────────────────────

const baseSnapshot = (): BatchOcrOriginalSnapshot => ({
  bezeichnung:  'Wien Energie',
  betrag:       '123,45',
  datum:        '2026-01-15',
  beleg_nummer: 'RE-001',
  category:     'betriebskosten_umlagefaehig',
  expense_type: 'strom',
});

// ── countUnreviewedSelected ────────────────────────────────────────────────────

describe('countUnreviewedSelected', () => {
  test('Keine needs_review-Items → 0', () => {
    const items = [
      { selected: true, saved: false, needs_review: false },
      { selected: true, saved: false, needs_review: undefined },
    ];
    assert.equal(countUnreviewedSelected(items), 0);
  });

  test('Flagged Item aber nicht ausgewählt → zählt nicht', () => {
    const items = [
      { selected: false, saved: false, needs_review: true, reviewed: false },
    ];
    assert.equal(countUnreviewedSelected(items), 0);
  });

  test('Flagged Item bereits gespeichert → zählt nicht', () => {
    const items = [
      { selected: true, saved: true, needs_review: true, reviewed: false },
    ];
    assert.equal(countUnreviewedSelected(items), 0);
  });

  test('Flagged Item bereits geprüft (reviewed=true) → zählt nicht', () => {
    const items = [
      { selected: true, saved: false, needs_review: true, reviewed: true },
    ];
    assert.equal(countUnreviewedSelected(items), 0);
  });

  test('Ausgewähltes ungeprüftes flagged Item → zählt', () => {
    const items = [
      { selected: true, saved: false, needs_review: true, reviewed: false },
    ];
    assert.equal(countUnreviewedSelected(items), 1);
  });

  test('Gemischte Liste — nur ungeprüfte zählen', () => {
    const items = [
      { selected: true,  saved: false, needs_review: false },          // OK
      { selected: true,  saved: false, needs_review: true, reviewed: true },  // geprüft
      { selected: true,  saved: false, needs_review: true, reviewed: false }, // BLOCK
      { selected: false, saved: false, needs_review: true, reviewed: false }, // nicht gewählt
      { selected: true,  saved: true,  needs_review: true, reviewed: false }, // gespeichert
    ];
    assert.equal(countUnreviewedSelected(items), 1);
  });

  test('Alle drei flagged Items ungeprüft → 3', () => {
    const items = Array.from({ length: 3 }, () => ({
      selected: true, saved: false, needs_review: true, reviewed: false,
    }));
    assert.equal(countUnreviewedSelected(items), 3);
  });
});

// ── buildBatchOcrAuditPayload ─────────────────────────────────────────────────

describe('buildBatchOcrAuditPayload', () => {
  test('Kein originalOcr-Snapshot (kein OCR) → null', () => {
    const item = {
      edited: { ...baseSnapshot(), notizen: '' },
    };
    assert.equal(buildBatchOcrAuditPayload(item), null);
  });

  test('Kein edited-State → null', () => {
    const item = { originalOcr: baseSnapshot() };
    assert.equal(buildBatchOcrAuditPayload(item), null);
  });

  test('Unveränderte Felder → hasChanges=false, kein Payload', () => {
    const snap = baseSnapshot();
    const item = {
      originalOcr: snap,
      edited: { ...snap, notizen: 'IBAN: AT...' }, // notizen zählt nicht
    };
    const result = buildBatchOcrAuditPayload(item);
    assert.ok(result !== null);
    assert.equal(result.hasChanges, false);
    assert.equal(result.originalData, undefined);
    assert.equal(result.correctedData, undefined);
  });

  test('Bezeichnung geändert → hasChanges=true, korrekte Felder', () => {
    const snap = baseSnapshot();
    const item = {
      originalOcr: snap,
      edited: { ...snap, bezeichnung: 'Wien Energie GmbH', notizen: '' },
      validierung: { confidence_score: 0.62 },
    };
    const result = buildBatchOcrAuditPayload(item);
    assert.ok(result !== null);
    assert.equal(result.hasChanges, true);
    // originalData.lieferant kommt aus originalOcr.bezeichnung
    assert.equal(result.originalData?.lieferant, 'Wien Energie');
    assert.equal(result.correctedData?.lieferant, 'Wien Energie GmbH');
    assert.equal(result.originalData?.confidence_score, '0.62');
  });

  test('Betrag geändert → erkannt', () => {
    const snap = baseSnapshot();
    const item = {
      originalOcr: snap,
      edited: { ...snap, betrag: '456,78', notizen: '' },
    };
    const result = buildBatchOcrAuditPayload(item);
    assert.ok(result !== null && result.hasChanges);
    assert.equal(result.originalData?.betrag, '123,45');
    assert.equal(result.correctedData?.betrag, '456,78');
  });

  test('Kategorie geändert → erkannt', () => {
    const snap = baseSnapshot();
    const item = {
      originalOcr: snap,
      edited: { ...snap, category: 'instandhaltung', notizen: '' },
    };
    const result = buildBatchOcrAuditPayload(item);
    assert.ok(result !== null && result.hasChanges);
    assert.equal(result.originalData?.kategorie, 'betriebskosten_umlagefaehig');
    assert.equal(result.correctedData?.kategorie, 'instandhaltung');
  });

  test('Confidence_score fehlt → kein Fehler, undefined im Payload', () => {
    const snap = baseSnapshot();
    const item = {
      originalOcr: snap,
      edited: { ...snap, datum: '2026-02-01', notizen: '' },
      // validierung fehlt absichtlich
    };
    const result = buildBatchOcrAuditPayload(item);
    assert.ok(result !== null && result.hasChanges);
    assert.equal(result.originalData?.confidence_score, undefined);
  });

  test('Nur notizen geändert → hasChanges=false (notizen ist kein OCR-Feld)', () => {
    const snap = baseSnapshot();
    const item = {
      originalOcr: snap,
      edited: { ...snap, notizen: 'Geänderte Notiz' },
    };
    const result = buildBatchOcrAuditPayload(item);
    assert.ok(result !== null);
    assert.equal(result.hasChanges, false);
  });
});
