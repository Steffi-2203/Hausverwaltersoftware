/**
 * Task #125: Hintergrundjobs mit Org-Daten laufen automatisch im richtigen
 * Mandanten-Kontext.
 *
 * jobQueueService.processNext() muss Jobs mit organization_id in
 * withOrgContext(...) ausführen (RLS: app.current_org gesetzt), während
 * System-Jobs ohne organization_id wie bisher ohne Org-Kontext laufen.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, eq } from 'drizzle-orm';
import { rootDb, db } from '../../server/db';
import { jobQueue, properties } from '../../shared/schema';
import { JobQueueService } from '../../server/services/jobQueueService';
import { setupRLS } from '../../server/lib/rlsPolicies';

const ORG_A = randomUUID();
const ORG_B = randomUUID();
const PROP_A = randomUUID();
const PROP_B = randomUUID();

async function drainQueue(svc: JobQueueService) {
  while (await svc.processNext()) {}
}

before(async () => {
  await setupRLS();
  for (const [org, prop, tag] of [[ORG_A, PROP_A, 'A'], [ORG_B, PROP_B, 'B']] as const) {
    await rootDb.execute(sql`INSERT INTO organizations (id, name) VALUES (${org}::uuid, ${'JobOrg ' + tag})`);
    await rootDb.execute(sql`
      INSERT INTO properties (id, organization_id, name, address, city, postal_code)
      VALUES (${prop}::uuid, ${org}::uuid, ${'JobProp ' + tag}, 'Teststr. 1', 'Wien', '1010')
    `);
  }
});

after(async () => {
  await rootDb.execute(sql`DELETE FROM job_queue WHERE organization_id IN (${ORG_A}::uuid, ${ORG_B}::uuid) OR type LIKE 'test-org-ctx-%'`);
  await rootDb.execute(sql`DELETE FROM properties WHERE id IN (${PROP_A}::uuid, ${PROP_B}::uuid)`);
  await rootDb.execute(sql`DELETE FROM organizations WHERE id IN (${ORG_A}::uuid, ${ORG_B}::uuid)`);
});

test('Job MIT organization_id: Handler sieht via db-Proxy genau die eigene Org', async () => {
  const svc = new JobQueueService();
  let seen: string[] | null = null;
  svc.registerHandler('test-org-ctx-read', async () => {
    // `db` ist der org-gebundene Proxy — funktioniert nur innerhalb eines orgContext.
    const rows = await db.select({ id: properties.id }).from(properties);
    seen = rows.map(r => r.id);
    return { count: rows.length };
  });

  const jobId = await svc.enqueue('test-org-ctx-read', {}, ORG_A);
  await drainQueue(svc);

  const job = await svc.getJobStatus(jobId);
  assert.equal(job?.status, 'completed', job?.error ?? '');
  assert.ok(seen, 'Handler wurde nicht ausgeführt');
  assert.ok(seen!.includes(PROP_A), 'eigene Property muss sichtbar sein');
  assert.ok(!seen!.includes(PROP_B), 'fremde Property darf nicht sichtbar sein');
});

test('Job OHNE organization_id: org-gebundener db-Zugriff schlägt laut fehl (kein stiller 0-Zeilen-Erfolg)', async () => {
  const svc = new JobQueueService();
  svc.registerHandler('test-org-ctx-noorg', async () => {
    const rows = await db.select({ id: properties.id }).from(properties);
    return { count: rows.length };
  });

  const jobId = await svc.enqueue('test-org-ctx-noorg', {}); // kein organizationId
  await drainQueue(svc);

  const job = await svc.getJobStatus(jobId);
  assert.notEqual(job?.status, 'completed', 'Job ohne Org-Kontext darf nicht erfolgreich org-Daten lesen');
  assert.ok(job?.error, 'Fehlermeldung muss gesetzt sein (explizites Scheitern statt 0 Zeilen)');
});

test('System-Job ohne organization_id und ohne Org-Daten läuft weiterhin normal durch', async () => {
  const svc = new JobQueueService();
  svc.registerHandler('test-org-ctx-system', async (payload) => ({ echoed: payload.x }));

  const jobId = await svc.enqueue('test-org-ctx-system', { x: 42 });
  await drainQueue(svc);

  const job = await svc.getJobStatus(jobId);
  assert.equal(job?.status, 'completed', job?.error ?? '');
  assert.equal((job?.result as any)?.echoed, 42);
});

test('Fehler im Handler eines Org-Jobs → Job wird sauber fehlgeschlagen/neu eingeplant, Kontext leakt nicht', async () => {
  const svc = new JobQueueService();
  svc.registerHandler('test-org-ctx-throw', async () => { throw new Error('absichtlich'); });

  const jobId = await svc.enqueue('test-org-ctx-throw', {}, ORG_A);
  await drainQueue(svc);

  const job = await rootDb.select().from(jobQueue).where(eq(jobQueue.id, jobId)).then(r => r[0]);
  assert.ok(job.error?.includes('absichtlich'));
  assert.notEqual(job.status, 'completed');

  // Non-Leak-Beweis: direkt nach dem geworfenen Org-Job darf der db-Proxy
  // außerhalb eines orgContext weiterhin NICHT funktionieren.
  await assert.rejects(async () => {
    await db.select({ id: properties.id }).from(properties);
  });
});
