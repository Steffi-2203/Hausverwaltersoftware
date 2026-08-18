/**
 * Job-Queue-Service mit at-least-once-Semantik und Idempotenz-Schutz (Task #125, #182).
 *
 * ## Zwei-Schicht-Idempotenz
 *
 * ### Schicht 1 — Handler-Level (primäre Garantie, für nicht-idempotente Handler PFLICHT)
 *
 * Handler mit Außenwirkung (E-Mail, Buchungszeile, …) MÜSSEN `ctx.jobId` als
 * Idempotenz-Schlüssel an ihrer Effekt-Einstiegsstelle nutzen:
 *
 *   A) Für Resend-E-Mails — Provider-seitiger Schutz:
 *      ```ts
 *      await sendEmail({ ..., idempotencyKey: ctx.jobId });
 *      ```
 *
 *   B) Für Datenbankzeilen — transaktionaler Schutz über eine job-lokale
 *      Spalte oder einen UNIQUE-Key auf der Zieltabelle:
 *      ```ts
 *      // INSERT ... WHERE NOT EXISTS (SELECT 1 FROM ... WHERE source_job_id = ctx.jobId)
 *      // oder: ON CONFLICT (source_job_id) DO NOTHING
 *      ```
 *
 *   Damit ist selbst das Szenario "Effekt erzeugt, Handler wirft danach" abgesichert:
 *   Der Retry-Versuch erkennt den bereits vorhandenen Schlüssel und beendet sich ohne
 *   Doppelwirkung.
 *
 * ### Schicht 2 — Infrastruktur-Level (Abschluss-Buchhaltung, defense-in-depth)
 *
 * processNext() setzt NACH erfolgreichem Handler-Lauf `job_queue.handler_completed_at`
 * (ein Feld das kein Client beschreiben kann — job_queue ist nicht über HTTP mutierbar).
 * Wenn das folgende `UPDATE status='completed'` fehlschlägt, erkennt ein Retry-Versuch
 * das gesetzte Feld und überspringt den Handler, ohne ihn erneut aufzurufen.
 *
 * SICHERHEITSHINWEIS: Frühere Versionen nutzten `idempotency_keys` für diesen Marker.
 * Das war unsicher, weil ein Client via `Idempotency-Key: job:<uuid>` HTTP-Header einen
 * Marker fälschen und so einen Job ohne Wirkung als erledigt markieren konnte.
 * `job_queue.handler_completed_at` ist ausschließlich intern beschreibbar.
 *
 * ## Handler-Inventar
 *
 * | Job-Typ                    | Registriert in              | Idempotent | Mechanismus            |
 * |----------------------------|-----------------------------|------------|------------------------|
 * | (Test-Handler)             | job-queue-*.test.ts         | ja (Tests) | zustandslos            |
 * | (künftige E-Mail-Jobs)     | z.B. leaseExpiryService     | erwartet   | sendEmail idempKey     |
 * | (künftige Buchungs-Jobs)   | z.B. zahlungsService        | erwartet   | source_job_id UNIQUE   |
 */

import { rootDb as db } from "../db";
import { withOrgContext } from "../db";
import { jobQueue } from "../../shared/schema";
import { eq, sql, isNotNull } from "drizzle-orm";

/** Kontext der dem Handler bei jeder Ausführung übergeben wird. */
export interface JobHandlerCtx {
  /**
   * Stabiler, eindeutiger Job-Bezeichner — muss als Idempotenz-Schlüssel an der
   * äußersten Effekt-Einstiegsstelle des Handlers genutzt werden.
   *
   * Für E-Mails:     `sendEmail({ ..., idempotencyKey: ctx.jobId })`
   * Für DB-Effekte:  Zieltabelle hat `source_job_id UUID UNIQUE`-Spalte,
   *                  INSERT mit `ON CONFLICT (source_job_id) DO NOTHING`.
   */
  jobId: string;
}

/**
 * Handler-Signatur. Das zweite Argument ist optional — bestehende Handler ohne ctx bleiben gültig.
 * Neue Handler mit Außenwirkung müssen ctx.jobId für Idempotenz nutzen (siehe Kommentar oben).
 */
export type JobHandler = (payload: any, ctx: JobHandlerCtx) => Promise<any>;

export class JobQueueService {
  private handlers: Map<string, JobHandler> = new Map();
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  registerHandler(type: string, handler: JobHandler) {
    this.handlers.set(type, handler);
  }

  async enqueue(type: string, payload: any, organizationId?: string, createdBy?: string): Promise<string> {
    const [job] = await db.insert(jobQueue).values({
      type,
      payload,
      organizationId,
      createdBy,
      status: 'pending',
    }).returning();
    return job.id;
  }

  async claimNextJob(): Promise<typeof jobQueue.$inferSelect | null> {
    const result = await db.execute(sql`
      UPDATE job_queue
      SET status = 'processing', started_at = now(), attempts = attempts + 1
      WHERE id = (
        SELECT id FROM job_queue
        WHERE status = 'pending' AND (attempts < max_attempts OR max_attempts IS NULL)
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);
    return (result.rows?.[0] as any) || null;
  }

  async processNext(): Promise<boolean> {
    const job = await this.claimNextJob();
    if (!job) return false;

    const handler = this.handlers.get(job.type);
    if (!handler) {
      await db.update(jobQueue)
        .set({ status: 'failed', error: `No handler for job type: ${job.type}`, completedAt: new Date() })
        .where(eq(jobQueue.id, job.id));
      return true;
    }

    // ── Schicht 2: Abschluss-Buchhaltung (defense-in-depth) ───────────────
    // handler_completed_at ist ein internes Feld von job_queue — kein Client
    // kann es über HTTP setzen. Damit ist es fälschungssicher als Marker nutzbar.
    //
    // War handler_completed_at bereits gesetzt (z.B. weil der Handler erfolgreich
    // war, aber UPDATE status='completed' danach fehlschlug), überspringen wir
    // den Handler und schließen den Job nur noch ab.
    const handlerAlreadyCompleted =
      (job as any).handler_completed_at != null ||
      (job as any).handlerCompletedAt != null;

    if (handlerAlreadyCompleted) {
      console.log(`[JobQueue] Job ${job.id} (${job.type}): handler_completed_at gesetzt — Handler übersprungen`);
      await db.update(jobQueue)
        .set({ status: 'completed', completedAt: new Date() })
        .where(eq(jobQueue.id, job.id));
      return true;
    }

    // claimNextJob liefert eine rohe SQL-Zeile (snake_case), enqueue-Pfade
    // liefern camelCase — beide Formen abdecken.
    const organizationId: string | null =
      (job as any).organization_id ?? (job as any).organizationId ?? null;

    const ctx: JobHandlerCtx = { jobId: job.id };

    try {
      // Org-gebundene Jobs laufen automatisch im richtigen Mandanten-Kontext.
      const result = organizationId
        ? await withOrgContext(organizationId, () => handler(job.payload, ctx))
        : await handler(job.payload, ctx);

      // Schritt 1: handler_completed_at setzen BEVOR status='completed'.
      // Schlägt Schritt 2 fehl, erkennt der nächste Retry-Versuch das gesetzte
      // Feld und überspringt den Handler (Abschluss-Buchhaltung, Schicht 2).
      await db.update(jobQueue)
        .set({ handlerCompletedAt: new Date() })
        .where(eq(jobQueue.id, job.id));

      // Schritt 2: Job als abgeschlossen markieren.
      await db.update(jobQueue)
        .set({ status: 'completed', result, completedAt: new Date() })
        .where(eq(jobQueue.id, job.id));
    } catch (err: any) {
      // Handler hat geworfen — handler_completed_at bleibt null → Job kann
      // wiederholt werden. Handler müssen ctx.jobId für Schicht-1-Schutz nutzen.
      const attempts = (job.attempts || 0);
      const maxAttempts = job.maxAttempts || 3;
      const newStatus = attempts >= maxAttempts ? 'failed' : 'pending';
      await db.update(jobQueue)
        .set({ status: newStatus, error: err.message || String(err), completedAt: newStatus === 'failed' ? new Date() : null })
        .where(eq(jobQueue.id, job.id));
    }
    return true;
  }

  startPolling(intervalMs: number = 5000) {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(async () => {
      try {
        while (await this.processNext()) {}
      } catch (err) {
        console.error('[JobQueue] Polling error:', err);
      }
    }, intervalMs);
    console.log(`[JobQueue] Polling started (every ${intervalMs}ms)`);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      console.log('[JobQueue] Polling stopped');
    }
  }

  async getJobStatus(jobId: string) {
    const [job] = await db.select().from(jobQueue).where(eq(jobQueue.id, jobId)).limit(1);
    return job || null;
  }

  async getJobsByOrganization(organizationId: string) {
    return db.select().from(jobQueue)
      .where(eq(jobQueue.organizationId, organizationId))
      .orderBy(sql`created_at DESC`)
      .limit(50);
  }
}

export const jobQueueService = new JobQueueService();
