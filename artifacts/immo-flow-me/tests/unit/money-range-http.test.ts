/**
 * HTTP-Stichproben-Tests: Geld-Schreibpfade lehnen zu große/ungültige Beträge
 * mit 400 + Feldname ab statt mit generischem 500 (Task #147).
 *
 * Geprüfte Endpunkte (echte Router, echte DB):
 *   1. POST /api/owner-payouts      (financeRoutes, numeric(12,2))
 *   2. POST /api/sepa-collections   (financeRoutes, numeric(10,2) → engere Grenze)
 *   3. POST /api/kautionen          (kautionRoutes, numeric(12,2))
 *
 * Jeweils: Grenzwert wird akzeptiert, Überschreitung → 400 mit Feldname.
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";

import { rootDb as db } from "../../server/db";
import financeRoutes from "../../server/routes/financeRoutes";
import kautionRoutes from "../../server/routes/kautionRoutes";
import accountingRoutes from "../../server/routes/accountingRoutes";
import heatBillingRoutes from "../../server/routes/heatBillingRoutes";
import eaRechnungRoutes from "../../server/routes/eaRechnungRoutes";
import richtwertRoutes from "../../server/routes/richtwertRoutes";
import { addOrgContext } from "../helpers/withOrgContext";

const orgId = randomUUID();
const profileId = randomUUID();
const ownerId = randomUUID();
const propertyOwnerId = randomUUID();
const propId = randomUUID();
const unitId = randomUUID();
const tenantId = randomUUID();
const paymentId = randomUUID();
const invoiceId = randomUUID();
const email = `money-range-${profileId.slice(0, 8)}@test.local`;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: profileId, organizationId: orgId };
    next();
  });
  addOrgContext(app, orgId);
  app.use(financeRoutes);
  app.use(kautionRoutes);
  app.use(accountingRoutes);
  app.use(heatBillingRoutes);
  app.use(eaRechnungRoutes);
  app.use(richtwertRoutes);
  return app;
}

const app = buildApp();

describe("Geld-Schreibpfade: 400 statt 500 bei zu großen Beträgen", () => {
  before(async () => {
    await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'MoneyRange-Org') ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${profileId}::uuid, ${email}, ${orgId}::uuid) ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${profileId}::uuid, 'admin') ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO properties (id, organization_id, name, address, city, postal_code) VALUES (${propId}::uuid, ${orgId}::uuid, 'MR-Obj', 'Testgasse 2', 'Wien', '1010') ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO units (id, property_id, top_nummer, type, status, flaeche) VALUES (${unitId}::uuid, ${propId}::uuid, 'MR-Top1', 'wohnung', 'aktiv', 100) ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO tenants (id, unit_id, first_name, last_name, email, status) VALUES (${tenantId}::uuid, ${unitId}::uuid, 'Money', 'Range', ${"mr-tenant-" + tenantId.slice(0, 8) + "@test.local"}, 'aktiv') ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO owners (id, organization_id, first_name, last_name) VALUES (${ownerId}::uuid, ${orgId}::uuid, 'Money', 'Owner') ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, status) VALUES (${invoiceId}::uuid, ${tenantId}::uuid, ${unitId}::uuid, 2044, 3, 0, 99999999.99, 'offen') ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO payments (id, tenant_id, betrag, buchungs_datum) VALUES (${paymentId}::uuid, ${tenantId}::uuid, 99999999.99, '2044-03-01') ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO property_owners (id, property_id, owner_id) VALUES (${propertyOwnerId}::uuid, ${propId}::uuid, ${ownerId}::uuid) ON CONFLICT DO NOTHING`);
  });

  after(async () => {
    await db.execute(sql`DELETE FROM heat_billing_audit_log WHERE run_id IN (SELECT id FROM heat_billing_runs WHERE organization_id = ${orgId}::uuid)`);
    await db.execute(sql`DELETE FROM heat_billing_lines WHERE run_id IN (SELECT id FROM heat_billing_runs WHERE organization_id = ${orgId}::uuid)`);
    await db.execute(sql`DELETE FROM heat_billing_runs WHERE organization_id = ${orgId}::uuid`);
    await db.execute(sql`DELETE FROM kautions_bewegungen WHERE kaution_id IN (SELECT id FROM kautionen WHERE organization_id = ${orgId}::uuid)`);
    await db.execute(sql`DELETE FROM kautionen WHERE organization_id = ${orgId}::uuid`);
    await db.execute(sql`DELETE FROM owner_payouts WHERE organization_id = ${orgId}::uuid`);
    await db.execute(sql`DELETE FROM sepa_collections WHERE organization_id = ${orgId}::uuid`);
    // payment_allocations ist per Trigger unveränderlich (Ledger) — für den
    // Fixture-Abbau kurzzeitig deaktivieren (Muster aus ledger-immutable-triggers.test.ts)
    await db.execute(sql`ALTER TABLE payment_allocations DISABLE TRIGGER ALL`);
    try {
      await db.execute(sql`DELETE FROM payment_allocations WHERE payment_id = ${paymentId}::uuid`);
    } finally {
      await db.execute(sql`ALTER TABLE payment_allocations ENABLE TRIGGER ALL`);
    }
    await db.execute(sql`DELETE FROM payments WHERE id = ${paymentId}::uuid`);
    await db.execute(sql`DELETE FROM monthly_invoices WHERE id = ${invoiceId}::uuid`);
    await db.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`);
    await db.execute(sql`DELETE FROM units WHERE id = ${unitId}::uuid`);
    await db.execute(sql`DELETE FROM property_owners WHERE id = ${propertyOwnerId}::uuid`);
    await db.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
    await db.execute(sql`DELETE FROM owners WHERE id = ${ownerId}::uuid`);
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${profileId}::uuid`);
    await db.execute(sql`DELETE FROM profiles WHERE id = ${profileId}::uuid`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
  });

  // ── 1. POST /api/owner-payouts ─────────────────────────────────────────────
  test("owner-payouts: Grenzwert 9.999.999.999,99 wird akzeptiert", async () => {
    const res = await request(app).post("/api/owner-payouts").send({
      owner_id: propertyOwnerId,
      property_id: propId,
      period_from: "2026-01-01",
      period_to: "2026-01-31",
      net_payout: "9999999999.99",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.net_payout, "9999999999.99");
  });

  test("owner-payouts: 11 Vorkommastellen → 400 mit Feldname", async () => {
    const res = await request(app).post("/api/owner-payouts").send({
      owner_id: propertyOwnerId,
      property_id: propId,
      period_from: "2026-01-01",
      period_to: "2026-01-31",
      net_payout: "10000000000",
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.ok(res.body.error.includes("net_payout"), res.body.error);
  });

  test("owner-payouts: nicht-numerischer Betrag → 400", async () => {
    const res = await request(app).post("/api/owner-payouts").send({
      owner_id: propertyOwnerId,
      property_id: propId,
      period_from: "2026-01-01",
      period_to: "2026-01-31",
      total_income: "abc",
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes("total_income"), res.body.error);
  });

  // ── 2. POST /api/sepa-collections (numeric(10,2) → max 8 Vorkommastellen) ──
  test("sepa-collections: Grenzwert 99.999.999,99 wird akzeptiert", async () => {
    const res = await request(app).post("/api/sepa-collections").send({
      month: 2,
      year: 2026,
      total_amount: "99999999.99",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.total_amount, "99999999.99");
  });

  test("sepa-collections: 9 Vorkommastellen → 400 mit Feldname (kein 500 aus numeric(10,2))", async () => {
    const res = await request(app).post("/api/sepa-collections").send({
      month: 3,
      year: 2026,
      total_amount: "100000000",
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.ok(res.body.error.includes("total_amount"), res.body.error);
  });

  // ── 3. POST /api/kautionen ─────────────────────────────────────────────────
  test("kautionen: Grenzwert 9.999.999.999,99 wird akzeptiert", async () => {
    const res = await request(app).post("/api/kautionen").send({
      tenant_id: tenantId,
      unit_id: unitId,
      betrag: "9999999999.99",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.betrag, "9999999999.99");
  });

  test("kautionen: zu großer Betrag → 400 mit Feldname", async () => {
    const res = await request(app).post("/api/kautionen").send({
      tenant_id: tenantId,
      unit_id: unitId,
      betrag: "10000000000",
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.ok(res.body.error.includes("betrag"), res.body.error);
  });

  // ── 4. POST /api/payments/allocate (payment_allocations numeric(10,2)) ─────
  test("payments/allocate: Grenzwert 99.999.999,99 wird akzeptiert", async () => {
    const res = await request(app).post("/api/payments/allocate").send({
      paymentId,
      invoiceId,
      amount: "99999999.99",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.appliedAmount, "99999999.99");
  });

  test("payments/allocate: 9 Vorkommastellen → 400 mit Feldname (kein 500 aus numeric(10,2))", async () => {
    const res = await request(app).post("/api/payments/allocate").send({
      paymentId,
      invoiceId,
      amount: "100000000",
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.ok(res.body.error.includes("amount"), res.body.error);
  });

  // ── 5. POST /api/payments/split ────────────────────────────────────────────
  test("payments/split: Grenzwert 99.999.999,99 wird akzeptiert", async () => {
    const res = await request(app).post("/api/payments/split").send({
      paymentAmount: "99999999.99",
      tenantId,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  test("payments/split: 9 Vorkommastellen → 400 mit Feldname", async () => {
    const res = await request(app).post("/api/payments/split").send({
      paymentAmount: "100000000",
      tenantId,
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.ok(res.body.error.includes("paymentAmount"), res.body.error);
  });

  test("kautionen: ungültiger Zinssatz → 400", async () => {
    const res = await request(app).post("/api/kautionen").send({
      tenant_id: tenantId,
      unit_id: unitId,
      betrag: "1000",
      zinssatz: "150",
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.ok(res.body.error.includes("zinssatz"), res.body.error);
  });

  // ── 6. POST /api/heizkosten/runs (heat_billing_runs numeric(12,2)) ─────────
  test("heizkosten: 11 Vorkommastellen → 400 mit Feldname", async () => {
    const res = await request(app).post("/api/heizkosten/runs").send({
      propertyId: propId,
      periodFrom: "2044-01-01",
      periodTo: "2044-12-31",
      heatingSupplyCost: "10000000000",
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.ok(res.body.error.includes("heatingSupplyCost"), res.body.error);
  });

  test("heizkosten: gültige Einzelkosten mit überlaufender Gesamtsumme → 400 statt 500", async () => {
    const maxRunAmount = "9999999999.99";
    const runResponse = await request(app).post("/api/heizkosten/runs").send({
      propertyId: propId,
      periodFrom: "2045-01-01",
      periodTo: "2045-12-31",
      heatingSupplyCost: maxRunAmount,
      hotWaterSupplyCost: maxRunAmount,
      maintenanceCost: maxRunAmount,
      meterReadingCost: maxRunAmount,
    });
    assert.equal(runResponse.status, 200, JSON.stringify(runResponse.body));

    const computeResponse = await request(app).post("/api/heizkosten/compute").send({
      runId: runResponse.body.id,
      unitData: [{ unitId, prepayment: "0" }],
    });
    assert.equal(computeResponse.status, 400, JSON.stringify(computeResponse.body));
    assert.ok(computeResponse.body.error.includes("totalCost"), computeResponse.body.error);
  });

  // ── 7. POST /api/ea-rechnung/bookings (ea_bookings numeric(10,2)) ─────────
  test("E/A-Rechnung: 9 Vorkommastellen → 400 mit Feldname", async () => {
    const res = await request(app).post("/api/ea-rechnung/bookings").send({
      propertyId: propId,
      type: "ausgabe",
      date: "2044-03-10",
      amount: "100000000",
      description: "Zu großer Testbetrag",
      category: "Test",
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.ok(res.body.error.includes("amount"), res.body.error);
  });

  // ── 8. POST /api/richtwert/calculate (fixe Stellplatzkosten) ──────────────
  test("Richtwert: zu große Stellplatzkosten → 400 mit Feldname", async () => {
    const res = await request(app).post("/api/richtwert/calculate").send({
      bundesland: "Wien",
      nutzflaeche: 50,
      garageStellplatz: "100000000",
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.ok(res.body.error.includes("garageStellplatz"), res.body.error);
  });
});
