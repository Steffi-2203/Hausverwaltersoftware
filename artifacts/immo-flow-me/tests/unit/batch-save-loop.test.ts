/**
 * runBatchSaveLoop — Unit-Tests
 *
 * Prüft:
 * 1. Audit-Fehler bei einem Item überspringt nur dieses Item — die Schleife läuft weiter
 * 2. Ungültiger / fehlender Betrag → failed outcome (kein silent skip)
 * 3. Fehlendes edited-State → failed outcome
 * 4. Duplicate-Dateinamen werden über batchItemId korrekt unterschieden
 * 5. Retry: ein zuvor fehlgeschlagenes Item mit gültigem Betrag wird beim zweiten Aufruf gespeichert
 * 6. Alle Outcomes sind in derselben Reihenfolge wie die input-Items
 */
import { describe, test, before } from 'node:test';
import { strict as assert } from 'node:assert';

import { runBatchSaveLoop, type BatchSaveItemInput, type BatchSaveDeps, type BatchSaveConfig } from '../../src/lib/batchOcrUtils.js';

// ── Hilfsfunktionen ─────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<BatchSaveItemInput> & { batchItemId: string }): BatchSaveItemInput {
  return {
    fileName: 'rechnung.pdf',
    edited: {
      bezeichnung: 'Wien Energie',
      betrag: '123,45',
      datum: '2026-03-15',
      beleg_nummer: '',
      category: 'betriebskosten_umlagefaehig',
      expense_type: 'strom',
      notizen: '',
    },
    ...overrides,
  };
}

const noop = async () => {};
const failAudit = async () => { throw new Error('Audit-Server nicht erreichbar'); };

function makeDeps(overrides: Partial<BatchSaveDeps> = {}): BatchSaveDeps {
  return {
    uploadFile: async () => undefined,
    postAudit: noop,
    createExpense: noop,
    ...overrides,
  };
}

const cfg: BatchSaveConfig = { propertyId: 'prop-1' };

// ── Tests ────────────────────────────────────────────────────────────────────────

describe('runBatchSaveLoop', () => {

  test('Leere Liste → leeres Outcomes-Array', async () => {
    const outcomes = await runBatchSaveLoop([], cfg, makeDeps());
    assert.deepEqual(outcomes, []);
  });

  test('Gültiges Item → success=true', async () => {
    const outcomes = await runBatchSaveLoop(
      [makeItem({ batchItemId: 'a' })],
      cfg,
      makeDeps(),
    );
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].batchItemId, 'a');
    assert.equal(outcomes[0].success, true);
    assert.equal(outcomes[0].error, undefined);
  });

  test('Audit-Fehler bei Item 0 → failed; Item 1 danach → success', async () => {
    let createCalled = 0;
    const items = [
      makeItem({ batchItemId: '0', fileName: 'rg1.pdf', originalOcr: {
        bezeichnung: 'Original', betrag: '100,00', datum: '2026-01-01',
        beleg_nummer: '', category: 'betriebskosten_umlagefaehig', expense_type: 'strom',
      }}),
      makeItem({ batchItemId: '1', fileName: 'rg2.pdf' }),
    ];
    // Item 0 hat abweichenden Betrag → Audit wird aufgerufen und schlägt fehl
    items[0].edited!.betrag = '200,00'; // triggert hasChanges=true

    const outcomes = await runBatchSaveLoop(items, cfg, makeDeps({
      postAudit: failAudit,
      createExpense: async () => { createCalled++; },
    }));

    assert.equal(outcomes.length, 2);
    assert.equal(outcomes[0].batchItemId, '0');
    assert.equal(outcomes[0].success, false);
    assert.ok(outcomes[0].error?.includes('Audit-Server'));

    assert.equal(outcomes[1].batchItemId, '1');
    assert.equal(outcomes[1].success, true);
    // createExpense nur für Item 1 gerufen (Item 0 ist vor createExpense abgebrochen)
    assert.equal(createCalled, 1);
  });

  test('Fehlendes edited-State → failed outcome, kein silent skip', async () => {
    const item = makeItem({ batchItemId: 'no-edit' });
    delete (item as any).edited;

    const outcomes = await runBatchSaveLoop([item], cfg, makeDeps());
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].success, false);
    assert.ok(outcomes[0].error?.includes('Formulardaten'));
  });

  test('Betrag 0 → failed outcome', async () => {
    const item = makeItem({ batchItemId: 'zero', edited: { ...makeItem({ batchItemId: 'x' }).edited!, betrag: '0' } });
    const outcomes = await runBatchSaveLoop([item], cfg, makeDeps());
    assert.equal(outcomes[0].success, false);
    assert.ok(outcomes[0].error?.includes('Betrag'));
  });

  test('Negativer Betrag → failed outcome', async () => {
    const item = makeItem({ batchItemId: 'neg', edited: { ...makeItem({ batchItemId: 'x' }).edited!, betrag: '-10,00' } });
    const outcomes = await runBatchSaveLoop([item], cfg, makeDeps());
    assert.equal(outcomes[0].success, false);
    assert.ok(outcomes[0].error?.includes('Betrag'));
  });

  test('Nicht-numerischer Betrag → failed outcome', async () => {
    const item = makeItem({ batchItemId: 'nan', edited: { ...makeItem({ batchItemId: 'x' }).edited!, betrag: 'abc' } });
    const outcomes = await runBatchSaveLoop([item], cfg, makeDeps());
    assert.equal(outcomes[0].success, false);
  });

  test('Duplicate-Dateinamen — outcomes via batchItemId korrekt unterschieden', async () => {
    const createLog: string[] = [];
    const items = [
      makeItem({ batchItemId: 'dup-0', fileName: 'gleich.pdf' }),
      makeItem({ batchItemId: 'dup-1', fileName: 'gleich.pdf' }),
    ];
    const outcomes = await runBatchSaveLoop(items, cfg, makeDeps({
      createExpense: async (data) => { createLog.push(data.bezeichnung); },
    }));
    assert.equal(outcomes.length, 2);
    assert.equal(outcomes[0].batchItemId, 'dup-0');
    assert.equal(outcomes[1].batchItemId, 'dup-1');
    assert.ok(outcomes.every(o => o.success));
  });

  test('Outcomes in Eingangsreihenfolge — auch bei Fehlern', async () => {
    const items = [
      makeItem({ batchItemId: '0' }),
      makeItem({ batchItemId: '1', edited: { ...makeItem({ batchItemId: 'x' }).edited!, betrag: '0' } }),
      makeItem({ batchItemId: '2' }),
    ];
    const outcomes = await runBatchSaveLoop(items, cfg, makeDeps());
    assert.equal(outcomes.map(o => o.batchItemId).join(','), '0,1,2');
    assert.equal(outcomes[0].success, true);
    assert.equal(outcomes[1].success, false);
    assert.equal(outcomes[2].success, true);
  });

  test('Retry: failed item (Audit-Fehler) kann mit funktionierendem Audit gespeichert werden', async () => {
    // Simuliert: erster Aufruf schlägt fehl, zweiter Aufruf (Retry) gelingt
    const item = makeItem({ batchItemId: 'retry', fileName: 'rg.pdf', originalOcr: {
      bezeichnung: 'Original', betrag: '100,00', datum: '2026-01-01',
      beleg_nummer: '', category: 'betriebskosten_umlagefaehig', expense_type: 'strom',
    }});
    item.edited!.betrag = '200,00'; // triggert Audit

    // Erster Versuch: Audit schlägt fehl
    const first = await runBatchSaveLoop([item], cfg, makeDeps({ postAudit: failAudit }));
    assert.equal(first[0].success, false);

    // Zweiter Versuch (Retry) mit funktionierendem Audit-Endpoint
    let createCalled = false;
    const second = await runBatchSaveLoop([item], cfg, makeDeps({
      postAudit: noop,
      createExpense: async () => { createCalled = true; },
    }));
    assert.equal(second[0].success, true);
    assert.ok(createCalled, 'createExpense wurde beim Retry aufgerufen');
  });

  test('createExpense-Fehler → failed outcome, batchItemId erhalten', async () => {
    const outcomes = await runBatchSaveLoop(
      [makeItem({ batchItemId: 'db-err' })],
      cfg,
      makeDeps({ createExpense: async () => { throw new Error('DB-Verbindung verloren'); } }),
    );
    assert.equal(outcomes[0].success, false);
    assert.equal(outcomes[0].batchItemId, 'db-err');
    assert.ok(outcomes[0].error?.includes('DB-Verbindung'));
  });

});
