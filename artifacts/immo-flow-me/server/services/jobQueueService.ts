// job_queue ist eine systemübergreifende Service-Tabelle (kein org_id-Filter).
// Sie ist in ORG_POLICY_EXCLUDES und wird daher mit rootDb (Superuser) abgefragt,
// nicht mit dem org-gebundenen `db`-Proxy.
import { rootDb as db, withOrgContext } from "../db";
import { jobQueue } from "../../shared/schema";
import { eq, and, sql, lt } from "drizzle-orm";

export class JobQueueService {
  private handlers: Map<string, (payload: any) => Promise<any>> = new Map();
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  registerHandler(type: string, handler: (payload: any) => Promise<any>) {
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

    // claimNextJob liefert eine rohe SQL-Zeile (snake_case), enqueue-Pfade
    // liefern camelCase — beide Formen abdecken.
    const organizationId: string | null =
      (job as any).organization_id ?? (job as any).organizationId ?? null;

    try {
      // Org-gebundene Jobs laufen automatisch im richtigen Mandanten-Kontext
      // (RLS: app.current_org). System-Jobs (ohne organization_id) wie bisher.
      const result = organizationId
        ? await withOrgContext(organizationId, () => handler(job.payload))
        : await handler(job.payload);
      await db.update(jobQueue)
        .set({ status: 'completed', result, completedAt: new Date() })
        .where(eq(jobQueue.id, job.id));
    } catch (err: any) {
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
