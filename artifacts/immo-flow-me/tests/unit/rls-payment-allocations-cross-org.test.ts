/**
 * Task #167: DB-seitiger Cross-Org-Schutz für payment_allocations
 *
 * Testet den BEFORE INSERT Trigger trg_payment_allocations_cross_org auf
 * Datenbankebene — unabhängig von Routing- oder RLS-Schicht.
 *
 * Angriffsvektoren:
 *   A) Direktes INSERT: eigene Zahlung + fremde Rechnung (andere Org) → DB-Fehler
 *   B) Direktes INSERT: eigene Zahlung + fremde Rechnung (anderer Mieter, gleiche Org) → DB-Fehler
 *   C) Positivfall: eigene Zahlung + eigene Rechnung (gleicher Mieter, gleiche Org) → OK
 *   D) NULL invoice_id ist erlaubt (Vorauszahlung) → OK
 *
 * Verbindung: rootDb (BYPASSRLS) — Trigger greift trotzdem (Trigger ≠ RLS).
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';
import { rootDb as db } from '../../server/db';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

// ── Fixture-IDs ───────────────────────────────────────────────────────────────

// Org A — die angreifende Org (eigene Zahlung, will fremde Rechnung zuordnen)
const orgA    = uuidv4();
const propA   = uuidv4();
const unitA   = uuidv4();
const tenA    = uuidv4();
const payA    = uuidv4(); // Zahlung von Org A
const invA    = uuidv4(); // Rechnung Org A / Mieter A (Positivfall)

// Org B — das Angriffsziel
const orgB    = uuidv4();
const propB   = uuidv4();
const unitB   = uuidv4();
const tenB    = uuidv4();
const invB    = uuidv4(); // Rechnung Org B (darf nicht mit payA verknüpft werden)

// Org A, zweiter Mieter (gleiche Org, anderer Mieter)
const unitA2  = uuidv4();
const tenA2   = uuidv4();
const invA2   = uuidv4(); // Rechnung Org A / Mieter A2 (darf nicht mit payA verknüpft werden)

// ── Seed / Cleanup ────────────────────────────────────────────────────────────

async function cleanupAll() {
  // Trigger auf payment_allocations deaktivieren für Cleanup (append-only)
  await db.execute(sql`ALTER TABLE payment_allocations DISABLE TRIGGER ALL`);
  try {
    await db.execute(sql`DELETE FROM payment_allocations WHERE payment_id = ${payA}::uuid`);
  } finally {
    await db.execute(sql`ALTER TABLE payment_allocations ENABLE TRIGGER ALL`);
  }
  await db.execute(sql`DELETE FROM monthly_invoices WHERE id IN (${invA}::uuid, ${invA2}::uuid, ${invB}::uuid)`);
  await db.execute(sql`DELETE FROM payments WHERE id = ${payA}::uuid`);
  await db.execute(sql`DELETE FROM tenants WHERE id IN (${tenA}::uuid, ${tenA2}::uuid, ${tenB}::uuid)`);
  await db.execute(sql`DELETE FROM units WHERE id IN (${unitA}::uuid, ${unitA2}::uuid, ${unitB}::uuid)`);
  await db.execute(sql`DELETE FROM properties WHERE id IN (${propA}::uuid, ${propB}::uuid)`);
  await db.execute(sql`DELETE FROM organizations WHERE id IN (${orgA}::uuid, ${orgB}::uuid)`);
}

async function seedAll() {
  // Org A
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgA}::uuid, 'RLS-PA-OrgA') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propA}::uuid, ${orgA}::uuid, 'RLS-PA-HausA', 'Str 1', 'Wien', '1010', 'mietverwaltung')
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO units (id, property_id, top_nummer, type, status) VALUES (${unitA}::uuid, ${propA}::uuid, 'A1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO units (id, property_id, top_nummer, type, status) VALUES (${unitA2}::uuid, ${propA}::uuid, 'A2', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO tenants (id, unit_id, first_name, last_name, email, status) VALUES (${tenA}::uuid, ${unitA}::uuid, 'TenA', 'RLS', 'tenA-rls-pa@test.at', 'aktiv') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO tenants (id, unit_id, first_name, last_name, email, status) VALUES (${tenA2}::uuid, ${unitA2}::uuid, 'TenA2', 'RLS', 'tenA2-rls-pa@test.at', 'aktiv') ON CONFLICT DO NOTHING`);

  // Zahlung gehört Mieter A (Org A)
  await db.execute(sql`
    INSERT INTO payments (id, tenant_id, betrag, buchungs_datum)
    VALUES (${payA}::uuid, ${tenA}::uuid, 600.00, '2045-03-01')
    ON CONFLICT DO NOTHING`);

  // Rechnung Org A / Mieter A (Positivfall)
  await db.execute(sql`
    INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, status, faellig_am)
    VALUES (${invA}::uuid, ${tenA}::uuid, ${unitA}::uuid, 2045, 3, 500.00, 500.00, 'offen', '2045-03-31')
    ON CONFLICT DO NOTHING`);

  // Rechnung Org A / Mieter A2 (anderer Mieter, gleiche Org)
  await db.execute(sql`
    INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, status, faellig_am)
    VALUES (${invA2}::uuid, ${tenA2}::uuid, ${unitA2}::uuid, 2045, 3, 300.00, 300.00, 'offen', '2045-03-31')
    ON CONFLICT DO NOTHING`);

  // Org B
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgB}::uuid, 'RLS-PA-OrgB') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propB}::uuid, ${orgB}::uuid, 'RLS-PA-HausB', 'Str 2', 'Wien', '1010', 'mietverwaltung')
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO units (id, property_id, top_nummer, type, status) VALUES (${unitB}::uuid, ${propB}::uuid, 'B1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO tenants (id, unit_id, first_name, last_name, email, status) VALUES (${tenB}::uuid, ${unitB}::uuid, 'TenB', 'RLS', 'tenB-rls-pa@test.at', 'aktiv') ON CONFLICT DO NOTHING`);

  // Rechnung Org B (Angriffsziel)
  await db.execute(sql`
    INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, status, faellig_am)
    VALUES (${invB}::uuid, ${tenB}::uuid, ${unitB}::uuid, 2045, 3, 350.00, 350.00, 'offen', '2045-03-31')
    ON CONFLICT DO NOTHING`);
}

beforeAll(async () => { await cleanupAll(); await seedAll(); });
afterAll(async  () => { await cleanupAll(); });

// ── Hilfsfunktion: direktes INSERT in payment_allocations ────────────────────

async function tryInsertAllocation(paymentId: string, invoiceId: string | null, amount = '10.00') {
  const allocId = uuidv4();
  return db.execute(sql`
    INSERT INTO payment_allocations (id, payment_id, invoice_id, applied_amount, allocation_type)
    VALUES (${allocId}::uuid, ${paymentId}::uuid, ${invoiceId ? sql`${invoiceId}::uuid` : sql`NULL`}, ${amount}::numeric, 'manual')
  `);
}

async function countAllocations(invoiceId: string): Promise<number> {
  const r: any = await db.execute(sql`SELECT count(*)::int AS n FROM payment_allocations WHERE invoice_id = ${invoiceId}::uuid`);
  return (r.rows?.[0]?.n ?? r[0]?.n) as number;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/**
 * Hilfsfunktion: prüft dass ein INSERT fehlschlägt und keine Zeile entsteht.
 * Gibt die Fehlermeldung zurück (für optionale Diagnose).
 */
async function expectInsertBlocked(paymentId: string, invoiceId: string): Promise<string> {
  let errorMessage = '';
  let thrown = false;
  try {
    await tryInsertAllocation(paymentId, invoiceId);
  } catch (err: any) {
    thrown = true;
    errorMessage = err.message ?? String(err);
  }
  expect(thrown).toBe(true);
  expect(await countAllocations(invoiceId)).toBe(0);
  return errorMessage;
}

describe('A) Cross-Org: eigene Zahlung + fremde Rechnung (andere Org) → DB-Fehler', () => {
  test('Direktes INSERT auf DB-Ebene wird vom Trigger abgewiesen', async () => {
    // Kern-Assertions: DB muss werfen, keine Zeile darf entstehen.
    await expectInsertBlocked(payA, invB);
  });
});

describe('B) Same-Org, anderer Mieter: Zahlung von Mieter A + Rechnung von Mieter A2 → DB-Fehler', () => {
  test('Trigger prüft auch Mieter-Identität (Defense-in-Depth)', async () => {
    // Trigger muss feuern, da tenA ≠ tenA2 (gleiche Org, anderer Mieter)
    await expectInsertBlocked(payA, invA2);
  });
});

describe('C) Positivfall: eigene Zahlung + eigene Rechnung (gleicher Mieter, gleiche Org) → OK', () => {
  test('Korrekte Zuordnung wird vom Trigger durchgelassen', async () => {
    await tryInsertAllocation(payA, invA, '100.00');
    expect(await countAllocations(invA)).toBeGreaterThanOrEqual(1);
  });
});

// Hinweis: payment_allocations.invoice_id ist NOT NULL (Schema-Constraint) —
// ein NULL-Wert wird bereits vor dem Trigger vom DB-Constraint abgefangen.
// Der NULL-Zweig im Trigger ist daher defensiv für etwaige Schema-Änderungen.
