/**
 * Header-Unveränderlichkeit — Trigger auf payments und monthly_invoices (Task #88)
 *
 * Migration: 20260824_payments_invoice_header_triggers.sql
 *
 * payments:          betrag, buchungs_datum  → UPDATE blockiert
 *                    invoice_id, notizen     → UPDATE erlaubt (legitime App-Flows)
 * monthly_invoices:  year, month, gesamtbetrag → UPDATE blockiert
 *                    status, paid_amount       → UPDATE erlaubt (Zahlungseingang)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rootDb as db, pool } from '../../server/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

const orgId = randomUUID();
const propId = randomUUID();
const unitId = randomUUID();
const tenantId = randomUUID();
const invoiceId = randomUUID();
const paymentId = randomUUID();

/** drizzle wickelt pg-Fehler in DrizzleQueryError — Meldung steckt in error.cause. */
function blockedBy(pattern: RegExp) {
  return (err: unknown) => {
    const messages = [
      (err as any)?.message,
      (err as any)?.cause?.message,
    ].filter(Boolean).join(' | ');
    assert.match(messages, pattern);
    return true;
  };
}

async function triggerExists(triggerName: string, tableName: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname = ${triggerName}
      AND c.relname = ${tableName}
      AND NOT t.tgisinternal
  `);
  return (result.rows?.length ?? 0) > 0;
}

describe('Header-Trigger: payments + monthly_invoices unveränderliche Kernfelder', () => {
  before(async () => {
    await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'HdrTrig-Org')`);
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
      VALUES (${propId}::uuid, ${orgId}::uuid, 'HdrTrig-Haus', 'Teststr. 1', 'Wien', '1010', 'mietverwaltung')
    `);
    await db.execute(sql`
      INSERT INTO units (id, property_id, top_nummer, type, status)
      VALUES (${unitId}::uuid, ${propId}::uuid, 'Top H1', 'wohnung', 'aktiv')
    `);
    await db.execute(sql`
      INSERT INTO tenants (id, unit_id, first_name, last_name, email)
      VALUES (${tenantId}::uuid, ${unitId}::uuid, 'Hdr', 'Trig', 'hdrtrig@test.at')
    `);
    await db.execute(sql`
      INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, status)
      VALUES (${invoiceId}::uuid, ${tenantId}::uuid, ${unitId}::uuid, 2026, 7, 800, 1000, 'offen')
    `);
    await db.execute(sql`
      INSERT INTO payments (id, tenant_id, invoice_id, betrag, buchungs_datum)
      VALUES (${paymentId}::uuid, ${tenantId}::uuid, NULL, 500, '2026-07-05')
    `);
  });

  after(async () => {
    await db.execute(sql`DELETE FROM payments WHERE id = ${paymentId}::uuid`);
    await db.execute(sql`DELETE FROM monthly_invoices WHERE id = ${invoiceId}::uuid`);
    await db.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`);
    await db.execute(sql`DELETE FROM units WHERE id = ${unitId}::uuid`);
    await db.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
  });

  it('Trigger existieren auf beiden Tabellen', async () => {
    assert.equal(await triggerExists('trg_payments_core_immutable', 'payments'), true);
    assert.equal(await triggerExists('trg_monthly_invoices_core_immutable', 'monthly_invoices'), true);
  });

  // ── payments ───────────────────────────────────────────────────────────────

  it('payments.betrag darf nicht geändert werden', async () => {
    await assert.rejects(
      db.execute(sql`UPDATE payments SET betrag = 999 WHERE id = ${paymentId}::uuid`),
      blockedBy(/betrag und buchungs_datum sind nach dem Anlegen unveränderlich/),
    );
  });

  it('payments.buchungs_datum darf nicht geändert werden', async () => {
    await assert.rejects(
      db.execute(sql`UPDATE payments SET buchungs_datum = '2026-08-01' WHERE id = ${paymentId}::uuid`),
      blockedBy(/unveränderlich/),
    );
  });

  it('payments.invoice_id und notizen bleiben aktualisierbar (legitime Flows)', async () => {
    await db.execute(sql`
      UPDATE payments SET invoice_id = ${invoiceId}::uuid, notizen = 'zugeordnet'
      WHERE id = ${paymentId}::uuid
    `);
    const r = await db.execute(sql`SELECT invoice_id, notizen, betrag FROM payments WHERE id = ${paymentId}::uuid`);
    assert.equal((r.rows[0] as any).invoice_id, invoiceId);
    assert.equal((r.rows[0] as any).notizen, 'zugeordnet');
    assert.equal(Number((r.rows[0] as any).betrag), 500);
  });

  it('payments: No-Op-Update mit identischem betrag löst den Trigger nicht aus', async () => {
    await db.execute(sql`UPDATE payments SET betrag = 500 WHERE id = ${paymentId}::uuid`);
  });

  // ── monthly_invoices ───────────────────────────────────────────────────────

  it('monthly_invoices.gesamtbetrag darf nicht geändert werden', async () => {
    await assert.rejects(
      db.execute(sql`UPDATE monthly_invoices SET gesamtbetrag = 1 WHERE id = ${invoiceId}::uuid`),
      blockedBy(/year, month und gesamtbetrag sind nach dem Anlegen/),
    );
  });

  it('monthly_invoices.year und month dürfen nicht geändert werden', async () => {
    await assert.rejects(
      db.execute(sql`UPDATE monthly_invoices SET year = 2027 WHERE id = ${invoiceId}::uuid`),
      blockedBy(/unveränderlich/),
    );
    await assert.rejects(
      db.execute(sql`UPDATE monthly_invoices SET month = 12 WHERE id = ${invoiceId}::uuid`),
      blockedBy(/unveränderlich/),
    );
  });

  it('monthly_invoices: Status-/Zahlungs-Update bleibt erlaubt', async () => {
    await db.execute(sql`
      UPDATE monthly_invoices SET status = 'teilbezahlt', paid_amount = 500 WHERE id = ${invoiceId}::uuid
    `);
    const r = await db.execute(sql`SELECT status, paid_amount, gesamtbetrag FROM monthly_invoices WHERE id = ${invoiceId}::uuid`);
    assert.equal((r.rows[0] as any).status, 'teilbezahlt');
    assert.equal(Number((r.rows[0] as any).paid_amount), 500);
    assert.equal(Number((r.rows[0] as any).gesamtbetrag), 1000);
  });

  it('monthly_invoices: kombiniertes Update (Status + gesamtbetrag) wird blockiert', async () => {
    await assert.rejects(
      db.execute(sql`
        UPDATE monthly_invoices SET status = 'bezahlt', gesamtbetrag = 2000 WHERE id = ${invoiceId}::uuid
      `),
      blockedBy(/unveränderlich/),
    );
    const r = await db.execute(sql`SELECT status FROM monthly_invoices WHERE id = ${invoiceId}::uuid`);
    assert.equal((r.rows[0] as any).status, 'teilbezahlt');
  });

  // ── payments DELETE-Trigger ─────────────────────────────────────────────────

  it('Trigger trg_payments_delete_blocked existiert auf payments', async () => {
    assert.equal(await triggerExists('trg_payments_delete_blocked', 'payments'), true);
  });

  it('DELETE aus App-Kontext (app.current_org gesetzt) → Trigger blockiert', async () => {
    // SET LOCAL ist transaktionsgebunden — wir brauchen eine explizite Transaktion.
    // pool.connect() liefert eine rohe pg-Verbindung (umgeht drizzle-Autocommit).
    const client = await (pool as any).connect();
    try {
      await client.query('BEGIN');
      // SET does not accept parameter placeholders ($1) — use literal interpolation.
      // orgId is a test-generated UUID, no injection risk.
      await client.query(`SET LOCAL "app.current_org" = '${orgId}'`);
      await assert.rejects(
        client.query(`DELETE FROM payments WHERE id = $1`, [paymentId]),
        (err: any) => {
          const msg = err?.message ?? '';
          assert.match(msg, /Löschen ist nicht zulässig/);
          return true;
        },
      );
      // Rollback: nothing was deleted (trigger fired before completion)
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    // Zahlung muss nach dem Trigger-Blockieren noch vorhanden sein
    const r = await db.execute(sql`SELECT id FROM payments WHERE id = ${paymentId}::uuid`);
    assert.equal((r.rows?.length ?? 0), 1, 'Zahlung muss noch in der DB sein');
  });

  it('DELETE ohne App-Kontext (System-Operation via rootDb) → erlaubt; Cleanup funktioniert', async () => {
    // Verifiziert dass das after()-Cleanup dieser Testsuite funktioniert:
    // rootDb läuft ohne app.current_org → Trigger feuert nicht.
    // Wir legen einen zweiten temporären Datensatz an und löschen ihn sofort.
    const tmpId = randomUUID();
    await db.execute(sql`
      INSERT INTO payments (id, tenant_id, betrag, buchungs_datum)
      VALUES (${tmpId}::uuid, ${tenantId}::uuid, 1, '2026-01-01')
    `);
    // rootDb hat kein app.current_org → Delete muss gelingen
    await db.execute(sql`DELETE FROM payments WHERE id = ${tmpId}::uuid`);
    const r = await db.execute(sql`SELECT id FROM payments WHERE id = ${tmpId}::uuid`);
    assert.equal((r.rows?.length ?? 0), 0, 'Temporäre Zahlung muss gelöscht sein');
  });
});
