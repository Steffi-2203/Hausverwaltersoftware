/**
 * Trigger-Verletzungen landen im Audit-Log (Task #89).
 *
 * Ablauf: UPDATE auf ein geschütztes Feld → PostgreSQL-Trigger wirft P0001 →
 * Pool-Interceptor (server/db.ts) meldet an immutableViolationAudit →
 * audit_logs-Eintrag mit action='IMMUTABLE_VIOLATION' auf separater Verbindung.
 */

import { describe, it, before, after } from 'node:test';
import { acquireAuditLogTestLock, releaseAuditLogTestLock } from '../helpers/auditLogTestLock';
import assert from 'node:assert/strict';
import { rootDb as db, appDb, appPool, withOrgContext, activeDb, hasImmutableViolationHandler } from '../../server/db';
import {
  flushImmutableViolationAudits,
  parseViolatedTable,
} from '../../server/lib/immutableViolationAudit';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

const orgId = randomUUID();
const propId = randomUUID();
const unitId = randomUUID();
const tenantId = randomUUID();
const invoiceId = randomUUID();
const paymentId = randomUUID();

const startedAt = new Date();

async function violationEntries(tableName: string) {
  const r = await db.execute(sql`
    SELECT id, table_name, action, details
    FROM audit_logs
    WHERE action = 'IMMUTABLE_VIOLATION'
      AND table_name = ${tableName}
      AND created_at >= ${startedAt.toISOString()}::timestamptz
    ORDER BY created_at DESC
  `);
  return r.rows as Array<{ id: string; table_name: string; action: string; details: any }>;
}

// Serialisierung: audit_logs ist global (kein org-Scope) — Advisory Lock verhindert
// Interferenzen mit anderen Testdateien, die gleichzeitig Audit-Einträge schreiben.
before(async () => { await acquireAuditLogTestLock(); });
after(async () => { await releaseAuditLogTestLock(); });

describe('Handler-Registrierung via db.ts (Skript-Kontext-Nachweis)', () => {
  it('hasImmutableViolationHandler() ist true ohne expliziten server/index.ts-Import', () => {
    // Nach dem Fix registriert server/db.ts den Handler selbst (Bottom-of-file-
    // Import von immutableViolationAudit.ts). Dieser Test importiert server/db.ts
    // direkt (siehe Import oben) — NICHT server/index.ts. Wenn dieser Test
    // besteht, ist bewiesen, dass Skripte, die nur db.ts verwenden, ebenfalls
    // vollständig geschützt sind.
    assert.equal(
      hasImmutableViolationHandler(),
      true,
      'P0001-Audit-Handler muss über db.ts registriert sein, ohne dass index.ts importiert wird',
    );
  });
});

describe('Immutability-Trigger-Verletzungen im Audit-Log', () => {
  before(async () => {
    await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'ViolAudit-Org')`);
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
      VALUES (${propId}::uuid, ${orgId}::uuid, 'ViolAudit-Haus', 'Auditstr. 1', 'Wien', '1010', 'mietverwaltung')
    `);
    await db.execute(sql`
      INSERT INTO units (id, property_id, top_nummer, type, status)
      VALUES (${unitId}::uuid, ${propId}::uuid, 'Top V1', 'wohnung', 'aktiv')
    `);
    await db.execute(sql`
      INSERT INTO tenants (id, unit_id, first_name, last_name, email)
      VALUES (${tenantId}::uuid, ${unitId}::uuid, 'Viol', 'Audit', 'violaudit@test.at')
    `);
    await db.execute(sql`
      INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, gesamtbetrag, status)
      VALUES (${invoiceId}::uuid, ${tenantId}::uuid, ${unitId}::uuid, 2026, 6, 1000, 'offen')
    `);
    await db.execute(sql`
      INSERT INTO payments (id, tenant_id, betrag, buchungs_datum)
      VALUES (${paymentId}::uuid, ${tenantId}::uuid, 300, '2026-06-05')
    `);
  });

  after(async () => {
    // Audit-Einträge bleiben bewusst stehen (Kette ist append-only).
    await db.execute(sql`DELETE FROM payments WHERE id = ${paymentId}::uuid`);
    await db.execute(sql`DELETE FROM monthly_invoices WHERE id = ${invoiceId}::uuid`);
    await db.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`);
    await db.execute(sql`DELETE FROM units WHERE id = ${unitId}::uuid`);
    await db.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
  });

  it('parseViolatedTable erkennt beide Meldungsformate', () => {
    assert.equal(
      parseViolatedTable('invoice_lines-Einträge sind unveränderlich — UPDATE und DELETE sind nicht zulässig.'),
      'invoice_lines',
    );
    assert.equal(
      parseViolatedTable('payments: betrag und buchungs_datum sind nach dem Anlegen unveränderlich.'),
      'payments',
    );
    assert.equal(parseViolatedTable('völlig anderes Format'), 'unbekannt');
  });

  it('blockiertes UPDATE auf payments.betrag erzeugt IMMUTABLE_VIOLATION-Eintrag', async () => {
    await assert.rejects(
      db.execute(sql`UPDATE payments SET betrag = 999 WHERE id = ${paymentId}::uuid`),
    );
    await flushImmutableViolationAudits();

    const entries = await violationEntries('payments');
    assert.ok(entries.length >= 1, 'audit_logs-Eintrag für payments erwartet');
    const details = entries[0].details;
    assert.match(String(details?.errorMessage), /unveränderlich/);
    assert.match(String(details?.query), /UPDATE\s+payments/i);
  });

  it('blockiertes UPDATE auf monthly_invoices.gesamtbetrag erzeugt Eintrag', async () => {
    await assert.rejects(
      db.execute(sql`UPDATE monthly_invoices SET gesamtbetrag = 1 WHERE id = ${invoiceId}::uuid`),
    );
    await flushImmutableViolationAudits();

    const entries = await violationEntries('monthly_invoices');
    assert.ok(entries.length >= 1, 'audit_logs-Eintrag für monthly_invoices erwartet');
    assert.match(String(entries[0].details?.errorMessage), /unveränderlich/);
  });

  it('erlaubte Updates erzeugen KEINEN Verletzungs-Eintrag', async () => {
    const beforeCount = (await violationEntries('payments')).length;
    await db.execute(sql`UPDATE payments SET notizen = 'ok' WHERE id = ${paymentId}::uuid`);
    await flushImmutableViolationAudits();
    const afterCount = (await violationEntries('payments')).length;
    assert.equal(afterCount, beforeCount);
  });

  it('appPool.query (Callback-Pfad in pg-pool) hängt nicht und funktioniert', async () => {
    // Regression: connect(cb)-Override muss den Callback bedienen, sonst hängt pool.query.
    const timer = new Promise((_, rej) => setTimeout(() => rej(new Error('appPool.query hängt')), 5000));
    const r = (await Promise.race([appPool.query('SELECT 1 AS one'), timer])) as any;
    assert.equal(Number(r.rows[0].one), 1);
    const r2 = (await Promise.race([appDb.execute(sql`SELECT 2 AS two`), timer])) as any;
    assert.equal(Number(r2.rows[0].two), 2);
  });

  it('Violation innerhalb von withOrgContext (RLS-Pfad) landet ebenfalls im Audit-Log', async () => {
    const countBefore = (await violationEntries('payments')).length;
    await assert.rejects(
      withOrgContext(orgId, async () => {
        await activeDb().execute(sql`UPDATE payments SET betrag = 777 WHERE id = ${paymentId}::uuid`);
      }),
    );
    await flushImmutableViolationAudits();
    const entries = await violationEntries('payments');
    assert.ok(entries.length > countBefore, 'neuer Eintrag aus dem RLS-Pfad erwartet');
    assert.equal(entries[0].details?.organizationId, orgId);
  });

  it('Audit-Eintrag ist in der HMAC-Kette signiert (chain_hmac gesetzt)', async () => {
    const entries = await violationEntries('payments');
    const r = await db.execute(sql`
      SELECT chain_hmac, chain_seq, hmac_version FROM audit_logs WHERE id = ${entries[0].id}::uuid
    `);
    const row = r.rows[0] as any;
    assert.ok(row.chain_hmac, 'chain_hmac muss gesetzt sein');
    assert.ok(row.chain_seq, 'chain_seq muss gesetzt sein');
    assert.equal(row.hmac_version, 'v5');
  });
});
