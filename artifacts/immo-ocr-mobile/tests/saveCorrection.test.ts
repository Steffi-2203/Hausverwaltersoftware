/**
 * Tests for saveCorrection — the pure durable-outbox save function.
 *
 * Mirrors the three scenarios from Task #176:
 *  1. handleSave mit Netzwerkfehler → Eintrag landet in der Queue
 *  2. Startup-Flush: Queue enthält Items + 200-Antwort → Items entfernt
 *  3. 401-Antwort beim Startup-Flush → Flush bricht ab, Item bleibt in Queue
 *
 * All tests use an in-memory storage adapter and fake upload/fetch functions —
 * no React Native, no AsyncStorage, no network.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCorrectionQueue } from '../utils/correctionQueueFactory';
import { saveCorrection, type UploadFn } from '../utils/saveCorrection';
import { flushCorrections, type FetchLike } from '../utils/flushCorrections';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStorage() {
  const store: Record<string, string> = {};
  return {
    getItem:  async (k: string) => store[k] ?? null,
    setItem:  async (k: string, v: string) => { store[k] = v; },
  };
}

const SAMPLE_PAYLOAD = {
  originalData:  { lieferant: 'Alt GmbH', betrag: '100' },
  correctedData: { lieferant: 'Neu GmbH', betrag: '100' },
  source:        'mobile_ocr',
  fileName:      'rechnung.jpg',
};

const DEPS_BASE = { userId: 'user-1' };

function makeUpload(...responses: Array<{ ok: boolean; status: number }>): UploadFn {
  let call = 0;
  return async (_payload, _signal) => {
    const r = responses[call++] ?? { ok: true, status: 200 };
    return { ok: r.ok, status: r.status } as Response;
  };
}

function makeFetch(...responses: Array<{ ok: boolean; status: number }>): FetchLike {
  let call = 0;
  return async () => {
    const r = responses[call++] ?? { ok: true, status: 200 };
    return { ok: r.ok, status: r.status } as Response;
  };
}

// ── Szenario 1: Netzwerkfehler beim Speichern ─────────────────────────────────

describe('saveCorrection — handleSave mit Netzwerkfehler', () => {

  it('Kein Payload (keine Änderungen) → Queue bleibt leer, kein Upload', async () => {
    const queue = createCorrectionQueue(makeStorage());
    let uploadCalled = false;
    const upload: UploadFn = async () => { uploadCalled = true; return { ok: true, status: 200 } as Response; };

    const result = await saveCorrection(null, { ...DEPS_BASE, queue, upload });

    assert.equal(result.outcome, 'no_changes');
    assert.equal(uploadCalled, false);
    assert.equal(await queue.countForUser('user-1'), 0);
  });

  it('Netzwerkfehler → Eintrag landet in der Queue, outcome = queued', async () => {
    // Scenario: handleSave ruft saveCorrection auf; upload wirft einen
    // Netzwerkfehler (kein Internetzugang). Das Item muss in AsyncStorage
    // landen damit es beim nächsten App-Start automatisch nachgesendet wird.
    const storage = makeStorage();
    const queue   = createCorrectionQueue(storage);
    const upload: UploadFn = async () => { throw new TypeError('Network request failed'); };

    const result = await saveCorrection(SAMPLE_PAYLOAD, { ...DEPS_BASE, queue, upload });

    assert.equal(result.outcome, 'queued');
    if (result.outcome === 'queued') assert.equal(result.retryable, false);
    // Kernaussage: Item ist dauerhaft gespeichert
    assert.equal(await queue.countForUser('user-1'), 1, 'Item muss in der Queue sein');

    // Simuliere Neustart: neuer Queue-Handle auf demselben Storage
    const reloaded = createCorrectionQueue(storage);
    const items    = await reloaded.getForUser('user-1');
    assert.equal(items.length, 1, 'Item überlebt Neustart (AsyncStorage-Persistenz)');
    assert.deepEqual(items[0].payload, SAMPLE_PAYLOAD);
  });

  it('503-Antwort → Item in Queue, retryable = true (Server temporär nicht erreichbar)', async () => {
    const queue  = createCorrectionQueue(makeStorage());
    const result = await saveCorrection(SAMPLE_PAYLOAD, {
      ...DEPS_BASE, queue,
      upload: makeUpload({ ok: false, status: 503 }),
    });

    assert.equal(result.outcome, 'queued');
    if (result.outcome === 'queued') assert.equal(result.retryable, true);
    assert.equal(await queue.countForUser('user-1'), 1);
  });

  it('200-Antwort → Item sofort aus Queue entfernt, outcome = uploaded', async () => {
    const queue  = createCorrectionQueue(makeStorage());
    const result = await saveCorrection(SAMPLE_PAYLOAD, {
      ...DEPS_BASE, queue,
      upload: makeUpload({ ok: true, status: 200 }),
    });

    assert.equal(result.outcome, 'uploaded');
    assert.equal(await queue.countForUser('user-1'), 0, 'Queue muss nach Erfolg leer sein');
  });

  it('Timeout (AbortError) → Item bleibt in Queue', async () => {
    const queue  = createCorrectionQueue(makeStorage());
    const upload: UploadFn = async (_p, signal) => {
      // Simuliere einen sofortigen Abort (kein echtes setTimeout nötig)
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      await new Promise((_r, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
      return { ok: true, status: 200 } as Response;
    };
    // timeoutMs = 1 → AbortController fired quasi-sofort im nächsten Microtask
    const result = await saveCorrection(SAMPLE_PAYLOAD, {
      ...DEPS_BASE, queue, upload, timeoutMs: 1,
    });

    assert.equal(result.outcome, 'queued');
    assert.equal(await queue.countForUser('user-1'), 1, 'Item muss nach Timeout in Queue bleiben');
  });

});

// ── Szenario 2: AuthProvider-Startup-Flush ────────────────────────────────────

describe('Startup-Flush: flushPendingCorrections entfernt erfolgreich übertragene Items', () => {

  it('Queue mit vorhandenem Item + 200-Antwort → Item nach Flush entfernt', async () => {
    // Simuliert: App startet, Token vorhanden → flushPendingCorrections() wird
    // aufgerufen → flushCorrections() läuft → Server antwortet mit 200.
    const storage = makeStorage();
    const queue   = createCorrectionQueue(storage);

    // Vorbereitungs-Schritt: Item lag bereits in der Queue (z.B. aus Netzwerkfehler)
    await queue.enqueue('user-1', SAMPLE_PAYLOAD);
    assert.equal(await queue.countForUser('user-1'), 1, 'Ausgangszustand: 1 Item in Queue');

    // Startup-Flush (wie AuthContext.flushPendingCorrections → flushCorrections)
    const n = await flushCorrections({
      token:     'startup-token',
      userId:    'user-1',
      apiDomain: 'example.com',
      queue,
      fetchFn:   makeFetch({ ok: true, status: 200 }),
    });

    assert.equal(n, 1, 'Genau 1 Item wurde übertragen');
    assert.equal(await queue.countForUser('user-1'), 0, 'Queue nach Flush leer');
  });

  it('Vollständiger Lebenszyklus: Netzwerkfehler → Queue → Startup-Flush → leer', async () => {
    // Phase 1: handleSave schlägt fehl → Item in Queue
    const storage = makeStorage();
    const queue   = createCorrectionQueue(storage);
    const saveResult = await saveCorrection(SAMPLE_PAYLOAD, {
      ...DEPS_BASE, queue,
      upload: async () => { throw new TypeError('Network request failed'); },
    });
    assert.equal(saveResult.outcome, 'queued');

    // Phase 2: App-Neustart — Queue-Handle neu, Storage gleich (Persistenz-Check)
    const queueAfterRestart = createCorrectionQueue(storage);
    assert.equal(await queueAfterRestart.countForUser('user-1'), 1, 'Item überlebt Neustart');

    // Phase 3: Startup-Flush mit wiederhergestellter Verbindung
    const n = await flushCorrections({
      token:     'recovered-token',
      userId:    'user-1',
      apiDomain: 'example.com',
      queue:     queueAfterRestart,
      fetchFn:   makeFetch({ ok: true, status: 200 }),
    });
    assert.equal(n, 1, '1 Item nach Neustart erfolgreich übertragen');
    assert.equal(await queueAfterRestart.countForUser('user-1'), 0, 'Queue danach leer');
  });

});

// ── Badge-Aktualisierungs-Regression ─────────────────────────────────────────
// Stellt sicher dass der Scan-Screen das Badge sofort zeigt sobald
// saveCorrection eine Korrektur in die Queue legt — auch ohne Flush.

describe('Badge-Aktualisierung: saveCorrection queued → pendingCount sofort sichtbar', () => {

  it('Nach fehlgeschlagenem Save ist Queue-Count 1 — refreshPendingCount würde 1 liefern', async () => {
    // Diese Test-Variante prüft den Datenpfad den refreshPendingCount() in
    // AuthContext.tsx nutzt: correctionQueue.countForUser(userId).
    // Die React-State-Aktualisierung (setPendingCount) läuft in der App darauf auf.
    const storage = makeStorage();
    const queue   = createCorrectionQueue(storage);

    assert.equal(await queue.countForUser('user-1'), 0, 'Ausgangszustand: Badge = 0');

    // Fehlgeschlagener Save (Netzwerkfehler) — wie review.tsx ihn produziert
    const result = await saveCorrection(SAMPLE_PAYLOAD, {
      userId: 'user-1',
      queue,
      upload: async () => { throw new TypeError('Network request failed'); },
    });

    assert.equal(result.outcome, 'queued', 'saveCorrection muss queued zurückgeben');

    // refreshPendingCount() liest genau diesen Wert:
    const countAfterQueue = await queue.countForUser('user-1');
    assert.equal(countAfterQueue, 1, 'Badge-Wert (countForUser) muss sofort 1 sein');
  });

  it('Nach erfolgreichem Flush ist Queue-Count 0 — Badge verschwindet automatisch', async () => {
    const storage = makeStorage();
    const queue   = createCorrectionQueue(storage);

    // Phase 1: fehlgeschlagener Save → Item in Queue
    const saveResult = await saveCorrection(SAMPLE_PAYLOAD, {
      userId: 'user-1', queue,
      upload: async () => { throw new TypeError('Network request failed'); },
    });
    assert.equal(saveResult.outcome, 'queued');
    assert.equal(await queue.countForUser('user-1'), 1, 'Badge vor Flush = 1');

    // Phase 2: erfolgreicher Flush (App-Start / Foreground-Event)
    await flushCorrections({
      token: 'tok', userId: 'user-1', apiDomain: 'example.com', queue,
      fetchFn: makeFetch({ ok: true, status: 200 }),
    });

    // refreshPendingCount() nach Flush liefert 0 → Badge verschwindet
    const countAfterFlush = await queue.countForUser('user-1');
    assert.equal(countAfterFlush, 0, 'Badge-Wert nach Flush muss 0 sein');
  });

});

// ── Regression: Login nach Logout mit bereits gequeueten Korrekturen ──────────
// Stellt sicher dass pendingCount nach einem erneuten Login korrekt geladen wird.
// Simuliert: User war offline, hat Korrekturen in der Queue → logout → login →
// Badge muss sofort 1 zeigen (ohne Flush abzuwarten).

describe('Login mit vorhandenen Queue-Einträgen → Badge sofort korrekt', () => {

  it('Nach Logout + Re-Login liefert countForUser den korrekten Wert für den Badge', async () => {
    const storage = makeStorage();
    const queue   = createCorrectionQueue(storage);

    // Phase 1: User war eingeloggt, hat offline eine Korrektur gespeichert
    await saveCorrection(SAMPLE_PAYLOAD, {
      userId: 'user-42',
      queue,
      upload: async () => { throw new TypeError('Network request failed'); },
    });
    assert.equal(await queue.countForUser('user-42'), 1, 'Queue vor Logout = 1');

    // Phase 2: Logout → pendingCount im Context würde auf 0 gesetzt
    // (setPendingCount(0) in logout())

    // Phase 3: Re-Login — AuthContext.login() ruft _loadCount(newUser.id) auf.
    // Wir testen den Datenpfad direkt: countForUser muss 1 zurückgeben.
    const countAfterReLogin = await queue.countForUser('user-42');
    assert.equal(
      countAfterReLogin, 1,
      'countForUser nach Re-Login muss 1 sein — Badge darf nicht auf 0 stecken bleiben',
    );
  });

  it('Unterschiedliche User-IDs sind isoliert: Re-Login als anderer User zeigt dessen Badge', async () => {
    const storage = makeStorage();
    const queue   = createCorrectionQueue(storage);

    // User A hat eine Korrektur in der Queue
    await queue.enqueue('user-A', SAMPLE_PAYLOAD);
    // User B hat keine
    assert.equal(await queue.countForUser('user-A'), 1);
    assert.equal(await queue.countForUser('user-B'), 0, 'User-B-Badge muss 0 sein');
  });

});

// ── Szenario 3: 401-Antwort beim Startup-Flush ────────────────────────────────

describe('Startup-Flush mit 401 → Flush bricht ab, Items bleiben in Queue', () => {

  it('401 beim ersten Item → kein Item entfernt, Schleife stoppt sofort', async () => {
    const storage = makeStorage();
    const queue   = createCorrectionQueue(storage);
    await queue.enqueue('user-1', SAMPLE_PAYLOAD);
    await queue.enqueue('user-1', { ...SAMPLE_PAYLOAD, fileName: 'zweite.jpg' });

    let uploadCount = 0;
    const n = await flushCorrections({
      token:     'expired-token',
      userId:    'user-1',
      apiDomain: 'example.com',
      queue,
      fetchFn:   async () => { uploadCount++; return { ok: false, status: 401 } as Response; },
    });

    assert.equal(n, 0, 'Kein Item darf bei 401 entfernt werden');
    assert.equal(uploadCount, 1, 'Schleife stoppt nach erstem 401 (kein zweiter Versuch)');
    assert.equal(
      await queue.countForUser('user-1'), 2,
      'Beide Items bleiben in der Queue — werden bei erneutem Login nachgesendet',
    );
  });

});
