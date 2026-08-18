/**
 * Task #182: Idempotenz von Job-Handlern absichern.
 *
 * Nachgewiesen werden vier Eigenschaften:
 *
 * 1. HANDLER-LEVEL (primäre Garantie):
 *    Ein Handler der ctx.jobId als Effekt-Schlüssel nutzt erzeugt seinen
 *    Außeneffekt genau einmal — selbst wenn er NACH dem Effekt wirft und
 *    der Job erneut ausgeführt wird (at-least-once-Szenario).
 *
 * 2. INFRASTRUKTUR-LEVEL (defense-in-depth):
 *    processNext() überspringt den Handler wenn handler_completed_at in
 *    job_queue gesetzt ist. Da job_queue nicht über HTTP mutierbar ist,
 *    kann kein Client dieses Feld vorbelegen (Sicherheitsgarantie).
 *
 * 3. FEHLER-PFAD:
 *    Ein Handler der wirft lässt handler_completed_at null → Job wird
 *    korrekt wiederholt, kein verfrühter Abschluss.
 *
 * 4. SICHERHEIT:
 *    Ein HTTP-Request mit Idempotency-Key-Header kann handler_completed_at
 *    nicht setzen → kein Fälschen des Abschluss-Markers.
 *
 * Cleanup: ausschließlich die in diesem Modul erzeugten Job-Einträge und
 * Idempotenz-Schlüssel werden gelöscht (keine Breitenbereinigung).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql, eq, inArray } from 'drizzle-orm';
import { rootDb } from '../../server/db';
import { jobQueue, idempotencyKeys } from '../../shared/schema';
import { JobQueueService } from '../../server/services/jobQueueService';
import { setupRLS } from '../../server/lib/rlsPolicies';

const createdJobIds: string[] = [];
const createdEffectKeys: string[] = [];

before(async () => {
  await setupRLS();
});

after(async () => {
  // Gezieltes Cleanup — nur die in diesem Modul erzeugten Einträge.
  if (createdJobIds.length > 0) {
    await rootDb.delete(jobQueue).where(inArray(jobQueue.id, createdJobIds));
  }
  if (createdEffectKeys.length > 0) {
    await rootDb.delete(idempotencyKeys).where(inArray(idempotencyKeys.key, createdEffectKeys));
  }
});

// ── Hilfsfunktionen ────────────────────────────────────────────────────────

async function enqueue(svc: JobQueueService, type: string, payload: unknown = {}): Promise<string> {
  const id = await svc.enqueue(type, payload);
  createdJobIds.push(id);
  return id;
}

function trackEffectKey(key: string): string {
  createdEffectKeys.push(key);
  return key;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Schicht 1 — Handler-Level: Teileffekt + Wurf → kein Doppeleffekt beim Retry', () => {

  it('Handler der nach seinem Effekt wirft erzeugt den Effekt beim Retry nicht erneut', async () => {
    const svc = new JobQueueService();
    let effectCount = 0;
    let callCount = 0;
    const TYPE = 'test-idem-partial-throw';
    const jobId = await enqueue(svc, TYPE);

    svc.registerHandler(TYPE, async (_payload, ctx) => {
      callCount++;

      // ── Schicht 1: Handler-Level-Dedup ───────────────────────────────
      // Effekt-Slot atomar beanspruchen. ON CONFLICT DO NOTHING verhindert,
      // dass ein Retry denselben Effekt ein zweites Mal erzeugt — unabhängig
      // davon ob der Handler damals geworfen hat oder nicht.
      const eKey = trackEffectKey(`effect:${ctx.jobId}`);
      const [claimed] = await rootDb
        .insert(idempotencyKeys)
        .values({ key: eKey, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) })
        .onConflictDoNothing()
        .returning({ id: idempotencyKeys.id });

      if (!claimed) {
        // Effekt-Slot belegt → sauber beenden ohne Doppelwirkung
        return { alreadyDone: true };
      }

      // Tatsächlicher Außeneffekt (z.B. E-Mail senden, Buchungszeile anlegen)
      effectCount++;

      // Simulierter Absturz NACH dem Effekt
      if (callCount === 1) {
        throw new Error('simulierter Transient-Fehler nach Effekt');
      }

      return { effectCount };
    });

    // ── Lauf 1: Effekt tritt auf, Handler wirft danach ─────────────────
    await svc.processNext();

    const afterThrow = await svc.getJobStatus(jobId);
    assert.notEqual(afterThrow?.status, 'completed', 'Job darf nach Wurf nicht completed sein');
    assert.equal(effectCount, 1, 'Effekt muss nach erstem Lauf genau 1× aufgetreten sein');

    // handler_completed_at darf NICHT gesetzt sein (Handler warf)
    assert.equal(afterThrow?.handlerCompletedAt, null, 'handlerCompletedAt darf bei Fehler nicht gesetzt sein');

    // ── Lauf 2 (Retry): Effekt-Slot belegt → kein Doppeleffekt ────────
    await svc.processNext();

    assert.equal(effectCount, 1, 'Effekt darf beim Retry NICHT erneut auftreten');
    assert.equal(callCount, 2, 'Handler muss beim Retry aufgerufen worden sein (um Guard zu prüfen)');

    const afterRetry = await svc.getJobStatus(jobId);
    assert.equal(afterRetry?.status, 'completed',
      `Job muss nach erfolgreichem Retry completed sein: ${afterRetry?.error ?? ''}`);
  });

});

describe('Schicht 2 — Infrastruktur: handler_completed_at-Feld verhindert Doppelaufruf', () => {

  it('Handler wird übersprungen wenn handler_completed_at gesetzt (simulate: completed-UPDATE fehlgeschlagen)', async () => {
    const svc = new JobQueueService();
    let callCount = 0;
    const TYPE = 'test-idem-completion-guard';
    const jobId = await enqueue(svc, TYPE);

    svc.registerHandler(TYPE, async (_payload, ctx) => {
      callCount++;
      return { jobId: ctx.jobId };
    });

    // ── Lauf 1: normal erfolgreich ─────────────────────────────────────
    await svc.processNext();
    assert.equal(callCount, 1);

    const afterFirst = await svc.getJobStatus(jobId);
    assert.equal(afterFirst?.status, 'completed');
    assert.ok(afterFirst?.handlerCompletedAt != null, 'handler_completed_at muss nach erfolgreichem Lauf gesetzt sein');

    // ── Simulate: UPDATE status='completed' fehlgeschlagen → status zurücksetzen
    await rootDb.execute(
      sql`UPDATE job_queue SET status = 'pending', attempts = 0 WHERE id = ${jobId}::uuid`,
    );

    // ── Lauf 2: handler_completed_at gesetzt → Handler wird übersprungen
    await svc.processNext();

    assert.equal(callCount, 1, 'Handler darf beim Retry NICHT erneut aufgerufen werden');

    const afterGuard = await svc.getJobStatus(jobId);
    assert.equal(afterGuard?.status, 'completed', 'Job muss nach Guard-Pfad completed sein');
  });

  it('ctx.jobId ist stabil und entspricht der echten Job-ID', async () => {
    const svc = new JobQueueService();
    const captured: string[] = [];
    const TYPE = 'test-idem-ctx-jobid';
    const jobId = await enqueue(svc, TYPE);

    svc.registerHandler(TYPE, async (_payload, ctx) => {
      captured.push(ctx.jobId);
    });

    await svc.processNext();

    assert.equal(captured.length, 1, 'Handler muss genau einmal aufgerufen worden sein');
    assert.equal(captured[0], jobId, 'ctx.jobId muss der echten Job-ID entsprechen');
  });

  it('SICHERHEIT: handler_completed_at kann nicht via HTTP-Idempotency-Key gefälscht werden', async () => {
    // Der Abschluss-Marker liegt in job_queue.handler_completed_at — einem Feld,
    // das ausschließlich durch jobQueueService.processNext() geschrieben wird.
    // Ein Client kann über die HTTP-Idempotency-Key-Middleware keinen Eintrag
    // in job_queue erzeugen; idempotency_keys ist eine separate Tabelle.
    //
    // Dieser Test beweist: Ein Eintrag in idempotency_keys mit dem Schlüssel
    // 'job:<uuid>' (wie ihn ein Client per Header setzen könnte) verhindert
    // NICHT, dass processNext() den Handler aufruft — weil processNext() nur
    // noch job_queue.handler_completed_at prüft.

    const svc = new JobQueueService();
    let callCount = 0;
    const TYPE = 'test-idem-security-forge';
    const jobId = await enqueue(svc, TYPE);

    svc.registerHandler(TYPE, async () => {
      callCount++;
      return { ok: true };
    });

    // Fälschen des früheren Markers: Client setzt 'job:<uuid>' in idempotency_keys.
    // (Dieser Eintrag wird nach dem Test als createdEffectKey bereinigt.)
    const forgedKey = trackEffectKey(`job:${jobId}`);
    await rootDb.insert(idempotencyKeys).values({
      key: forgedKey,
      expiresAt: new Date(Date.now() + 60_000),
    }).onConflictDoNothing();

    // processNext() darf den Handler TROTZDEM aufrufen — gefälschter idem-Key
    // hat keinen Einfluss mehr, da wir jetzt handler_completed_at prüfen.
    await svc.processNext();

    assert.equal(callCount, 1, 'Handler muss aufgerufen worden sein — gefälschter idempotency_key darf keine Wirkung haben');

    const job = await svc.getJobStatus(jobId);
    assert.equal(job?.status, 'completed', 'Job muss completed sein');
    assert.ok(job?.handlerCompletedAt != null, 'handlerCompletedAt muss durch processNext() gesetzt worden sein');
  });

});

describe('Fehler-Pfad: kein Abschluss-Marker bei Handler-Fehler → Retry möglich', () => {

  it('Handler der wirft lässt handler_completed_at null und kann wiederholt werden', async () => {
    const svc = new JobQueueService();
    let attempts = 0;
    const TYPE = 'test-idem-error-no-marker';
    const jobId = await enqueue(svc, TYPE);

    svc.registerHandler(TYPE, async () => {
      attempts++;
      if (attempts < 2) throw new Error('transient');
      return { ok: true };
    });

    // Lauf 1: wirft
    await svc.processNext();
    const afterError = await svc.getJobStatus(jobId);
    assert.notEqual(afterError?.status, 'completed');
    assert.equal(afterError?.handlerCompletedAt, null,
      'handler_completed_at darf bei Handler-Fehler nicht gesetzt sein');

    // Lauf 2: erfolgreich
    await svc.processNext();
    assert.equal(attempts, 2, 'Handler muss 2× aufgerufen worden sein');

    const afterSuccess = await svc.getJobStatus(jobId);
    assert.equal(afterSuccess?.status, 'completed');
    assert.ok(afterSuccess?.handlerCompletedAt != null,
      'handler_completed_at muss nach erfolgreichem Lauf gesetzt sein');
  });

});
