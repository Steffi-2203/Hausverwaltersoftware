/**
 * Service-Level-Regressionstests für paymentSplittingService — Cent-Arithmetik.
 *
 * Diese Tests rufen allocatePaymentToInvoice direkt auf der echten DB auf
 * und verifizieren, dass:
 *  - Mehrfach-Zuteilungen (Multi-Allocation) cent-exakt aggregiert werden
 *  - Statusübergänge (offen → teilbezahlt → bezahlt) an der richtigen Cent-Schwelle auslösen
 *  - Ein-Cent-Restbetrag korrekt als teilbezahlt erkannt wird, nicht als bezahlt
 *  - Float-Drift bei float-kritischen Beträgen (z. B. 3 × 333.34 €) ausbleibt
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";

import { rootDb as db, withOrgContext } from "../../server/db";
import {
  allocatePaymentToInvoice,
} from "../../server/services/paymentSplittingService";
import { toCents, fromCents } from "../../server/lib/money";

// ── Fixture-IDs ──────────────────────────────────────────────────────────────
const orgId  = randomUUID();
const propId = randomUUID();
const unitId = randomUUID();
const tenId  = randomUUID();
// Rechnungen
const inv1   = randomUUID(); // Standardrechnung  925.00 €
const inv2   = randomUUID(); // Float-kritisch  1000.01 € (Partial × 2)
const inv3   = randomUUID(); // Ein-Cent-Probe     0.01 €
// Zahlungen
const pay1   = randomUUID();
const pay2   = randomUUID();
const pay3   = randomUUID();
const pay4   = randomUUID();

async function seed() {
  const email = `alloc-cents-${orgId.slice(0, 8)}@test.at`;
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'AllocCentsOrg') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${tenId}::uuid, ${email}, ${orgId}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'AC-Obj', 'Str 1', 'Wien', '1010', 'mietverwaltung')
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO units (id, property_id, top_nummer, type, status) VALUES (${unitId}::uuid, ${propId}::uuid, 'AC1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO tenants (id, unit_id, first_name, last_name, email, status) VALUES (${tenId}::uuid, ${unitId}::uuid, 'Test', 'Alloc', ${email}, 'aktiv') ON CONFLICT DO NOTHING`);

  // Rechnung 1: 925.00 € (650 Miete + 180 BK + 95 HK)
  await db.execute(sql`
    INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, betriebskosten, heizungskosten, gesamtbetrag, status, faellig_am)
    VALUES (${inv1}::uuid, ${tenId}::uuid, ${unitId}::uuid, 2090, 1, 650.00, 180.00, 95.00, 925.00, 'offen', '2090-01-31')
    ON CONFLICT DO NOTHING`);

  // Rechnung 2: 1000.01 € — float-kritisch
  await db.execute(sql`
    INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, status, faellig_am)
    VALUES (${inv2}::uuid, ${tenId}::uuid, ${unitId}::uuid, 2090, 2, 1000.01, 1000.01, 'offen', '2090-02-28')
    ON CONFLICT DO NOTHING`);

  // Rechnung 3: 0.01 € — Ein-Cent-Test
  await db.execute(sql`
    INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, status, faellig_am)
    VALUES (${inv3}::uuid, ${tenId}::uuid, ${unitId}::uuid, 2090, 3, 0.01, 0.01, 'offen', '2090-03-31')
    ON CONFLICT DO NOTHING`);

  // Zahlungen
  for (const [payId, betrag] of [[pay1, '925.00'], [pay2, '333.34'], [pay3, '333.34'], [pay4, '0.01']] as const) {
    await db.execute(sql`
      INSERT INTO payments (id, tenant_id, betrag, buchungs_datum, payment_type)
      VALUES (${payId}::uuid, ${tenId}::uuid, ${betrag}::numeric, '2090-01-15', 'ueberweisung')
      ON CONFLICT DO NOTHING`);
  }
}

async function cleanup() {
  try {
    await db.execute(sql`ALTER TABLE payment_allocations DISABLE TRIGGER ALL`);
    try {
      await db.execute(sql`DELETE FROM payment_allocations WHERE invoice_id IN (${inv1}::uuid, ${inv2}::uuid, ${inv3}::uuid)`);
    } finally {
      await db.execute(sql`ALTER TABLE payment_allocations ENABLE TRIGGER ALL`);
    }
    await db.execute(sql`DELETE FROM payments WHERE id IN (${pay1}::uuid, ${pay2}::uuid, ${pay3}::uuid, ${pay4}::uuid)`);
    await db.execute(sql`DELETE FROM monthly_invoices WHERE id IN (${inv1}::uuid, ${inv2}::uuid, ${inv3}::uuid)`);
    await db.execute(sql`DELETE FROM tenants WHERE id = ${tenId}::uuid`);
    await db.execute(sql`DELETE FROM units WHERE id = ${unitId}::uuid`);
    await db.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
    await db.execute(sql`DELETE FROM profiles WHERE id = ${tenId}::uuid`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
  } catch (err) {
    console.warn("AllocCents-Cleanup (non-fatal):", (err as Error).message);
  }
}

async function getInvoice(id: string) {
  const r = await db.execute(sql`SELECT status, paid_amount::numeric AS paid FROM monthly_invoices WHERE id = ${id}::uuid`);
  const row = (r.rows ?? r)[0] as any;
  return { status: row.status as string, paidCents: toCents(String(row.paid ?? 0)) };
}

async function countAllocations(invoiceId: string) {
  const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM payment_allocations WHERE invoice_id = ${invoiceId}::uuid`);
  return Number(((r.rows ?? r)[0] as any).n);
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe("allocatePaymentToInvoice — Cent-Arithmetik (DB-Level)", () => {
  before(async () => { await seed(); });
  after(async () => { await cleanup(); });

  it("Vollzahlung: Status wird 'bezahlt', paid_amount exakt 92500 Cents", async () => {
    await withOrgContext(orgId, () => allocatePaymentToInvoice(pay1, inv1, 925.00, orgId));

    const { status, paidCents } = await getInvoice(inv1);
    assert.equal(status, "bezahlt", "Status nach vollständiger Zahlung muss 'bezahlt' sein");
    assert.equal(paidCents, 92500, "paid_amount muss exakt 92500 Cents sein");
    assert.equal(await countAllocations(inv1), 1);
  });

  it("Ein-Cent-Probe: 0.01 € Zahlung setzt Status auf 'bezahlt', kein Float-Fehler", async () => {
    await withOrgContext(orgId, () => allocatePaymentToInvoice(pay4, inv3, 0.01, orgId));

    const { status, paidCents } = await getInvoice(inv3);
    assert.equal(status, "bezahlt", "0.01 € auf 0.01 € Rechnung = bezahlt");
    assert.equal(paidCents, 1, "paid_amount muss exakt 1 Cent sein");
  });

  it("Multi-Allocation: 2 × 333.34 € aggregiert in Cents — kein Float-Drift", async () => {
    // Erste Teilzahlung: 333.34 € → teilbezahlt
    await withOrgContext(orgId, () => allocatePaymentToInvoice(pay2, inv2, 333.34, orgId));
    const after1 = await getInvoice(inv2);
    assert.equal(after1.status, "teilbezahlt");
    assert.equal(after1.paidCents, toCents(333.34), "nach erster Teilzahlung: 33334 Cents");

    // Zweite Teilzahlung: 333.34 € → immer noch teilbezahlt (33334 + 33334 = 66668 < 100001)
    await withOrgContext(orgId, () => allocatePaymentToInvoice(pay3, inv2, 333.34, orgId));
    const after2 = await getInvoice(inv2);
    assert.equal(after2.status, "teilbezahlt", "nach zwei Teilzahlungen noch nicht bezahlt");
    assert.equal(after2.paidCents, toCents(333.34) + toCents(333.34),
      `Aggregat muss 66668 Cents sein, ist: ${after2.paidCents}`);

    // Verbleibender Rest: 1000.01 - 666.68 = 333.33 €
    const expectedRemainingCents = toCents(1000.01) - after2.paidCents;
    assert.equal(fromCents(expectedRemainingCents), 333.33, "Restbetrag exakt 333.33 €");

    // DB-Aggregat der Zuteilungen muss gleich paid_amount sein
    const allocTotal = await db.execute(sql`
      SELECT COALESCE(SUM(applied_amount::numeric), 0)::numeric AS total
      FROM payment_allocations WHERE invoice_id = ${inv2}::uuid`);
    const allocTotalCents = toCents(String(((allocTotal.rows ?? allocTotal)[0] as any).total ?? 0));
    assert.equal(allocTotalCents, after2.paidCents,
      "SUM(applied_amount) in Cents muss gleich paid_amount sein");
  });

  it("Cent-Schwelle: 99.99 € auf 100.00 € Rechnung → 'teilbezahlt', nicht 'bezahlt'", async () => {
    const invX = randomUUID();
    const payX = randomUUID();
    await db.execute(sql`
      INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, status, faellig_am)
      VALUES (${invX}::uuid, ${tenId}::uuid, ${unitId}::uuid, 2090, 4, 100.00, 100.00, 'offen', '2090-04-30')
      ON CONFLICT DO NOTHING`);
    await db.execute(sql`
      INSERT INTO payments (id, tenant_id, betrag, buchungs_datum, payment_type)
      VALUES (${payX}::uuid, ${tenId}::uuid, 99.99::numeric, '2090-01-20', 'ueberweisung')
      ON CONFLICT DO NOTHING`);

    try {
      await withOrgContext(orgId, () => allocatePaymentToInvoice(payX, invX, 99.99, orgId));
      const { status, paidCents } = await getInvoice(invX);
      assert.equal(status, "teilbezahlt", "99.99 € auf 100.00 € Rechnung darf NICHT 'bezahlt' sein");
      assert.equal(paidCents, toCents(99.99), "paid_amount = 9999 Cents");
    } finally {
      await db.execute(sql`ALTER TABLE payment_allocations DISABLE TRIGGER ALL`);
      try { await db.execute(sql`DELETE FROM payment_allocations WHERE invoice_id = ${invX}::uuid`); } finally {
        await db.execute(sql`ALTER TABLE payment_allocations ENABLE TRIGGER ALL`);
      }
      await db.execute(sql`DELETE FROM payments WHERE id = ${payX}::uuid`);
      await db.execute(sql`DELETE FROM monthly_invoices WHERE id = ${invX}::uuid`);
    }
  });
});
