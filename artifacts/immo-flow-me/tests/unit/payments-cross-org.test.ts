/**
 * Task #121: Cross-Org-Schutz für POST /api/payments.
 *
 * Es darf nicht möglich sein, dass ein User von Org A eine Zahlung auf einen
 * Mieter von Org B bucht (Fehlbuchung → falsche offene Posten/Mahnläufe).
 *
 * Die Route prüft die Kette tenant → unit → property.organizationId gegen die
 * Session-Org; unter RLS ist der fremde Mieter zusätzlich unsichtbar (→ 404).
 * Beides ist eine korrekte Ablehnung — der Test akzeptiert 403 oder 404 und
 * verifiziert zusätzlich, dass KEINE Zahlung in der DB entstanden ist.
 *
 * node:test-Variante (läuft bei jedem Build), Muster wie
 * tests/unit/open-items-mi-cross-org.test.ts / write-cross-org.test.ts.
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";

import { rootDb as db } from "../../server/db";
import paymentRouter from "../../server/routes/paymentRoutes";
import { addOrgContext } from "../helpers/withOrgContext";

// ── Testdaten-IDs ────────────────────────────────────────────────────────────
const orgAId = randomUUID();
const orgBId = randomUUID();
const userA  = randomUUID(); // admin in Org A
const propA  = randomUUID();
const propB  = randomUUID();
const unitA  = randomUUID();
const unitB  = randomUUID();
const tenA   = randomUUID(); // eigener Mieter (Org A)
const tenB   = randomUUID(); // fremder Mieter (Org B)
const invA   = randomUUID(); // Rechnung Org A (Mieter A)
const invB   = randomUUID(); // Rechnung Org B (Mieter B)

const createdPaymentIds: string[] = [];

function buildApp(orgId: string, uid: string) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: uid, email: "payx-" + uid.slice(0, 8) + "@test.at", organizationId: orgId };
    next();
  });
  addOrgContext(app, orgId);
  app.use(paymentRouter);
  return app;
}

const appA = buildApp(orgAId, userA);

async function seed() {
  const e = (p: string, id: string) => `${p}-${id.slice(0, 8)}@payx.at`;

  // Org A: Property/Unit/Mieter + admin-User
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgAId}::uuid, 'PayX-OrgA') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${userA}::uuid, ${e("ua", userA)}, ${orgAId}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${userA}::uuid, 'admin') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propA}::uuid, ${orgAId}::uuid, 'PayX-ObjA', 'Str 1', 'Wien', '1010', 'mietverwaltung')
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO units (id, property_id, top_nummer, type, status) VALUES (${unitA}::uuid, ${propA}::uuid, 'A1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO tenants (id, unit_id, first_name, last_name, email, status) VALUES (${tenA}::uuid, ${unitA}::uuid, 'TenA', 'PayX', ${e("tenA", tenA)}, 'aktiv') ON CONFLICT DO NOTHING`);

  // Org B: Property/Unit/Mieter (Angriffsziel)
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgBId}::uuid, 'PayX-OrgB') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propB}::uuid, ${orgBId}::uuid, 'PayX-ObjB', 'Str 2', 'Wien', '1010', 'mietverwaltung')
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO units (id, property_id, top_nummer, type, status) VALUES (${unitB}::uuid, ${propB}::uuid, 'B1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO tenants (id, unit_id, first_name, last_name, email, status) VALUES (${tenB}::uuid, ${unitB}::uuid, 'TenB', 'PayX', ${e("tenB", tenB)}, 'aktiv') ON CONFLICT DO NOTHING`);

  // Rechnungen: je eine offene Vorschreibung pro Org
  await db.execute(sql`
    INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, status, faellig_am)
    VALUES (${invA}::uuid, ${tenA}::uuid, ${unitA}::uuid, 2046, 1, 500.00, 500.00, 'offen', '2046-01-31')
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, status, faellig_am)
    VALUES (${invB}::uuid, ${tenB}::uuid, ${unitB}::uuid, 2046, 1, 300.00, 300.00, 'offen', '2046-01-31')
    ON CONFLICT DO NOTHING`);
}

async function cleanup() {
  try {
    // payment_allocations sind append-only (BEFORE DELETE Trigger) —
    // fürs Test-Cleanup Trigger kurz deaktivieren (rootDb, wie in ledger-immutable-triggers.test.ts)
    await db.execute(sql`ALTER TABLE payment_allocations DISABLE TRIGGER ALL`);
    try {
      await db.execute(sql`DELETE FROM payment_allocations WHERE payment_id IN (SELECT id FROM payments WHERE tenant_id IN (${tenA}::uuid, ${tenB}::uuid))`);
    } finally {
      await db.execute(sql`ALTER TABLE payment_allocations ENABLE TRIGGER ALL`);
    }
    await db.execute(sql`DELETE FROM payments   WHERE tenant_id IN (${tenA}::uuid, ${tenB}::uuid)`);
    await db.execute(sql`DELETE FROM monthly_invoices WHERE id IN (${invA}::uuid, ${invB}::uuid)`);
    await db.execute(sql`DELETE FROM tenants    WHERE id IN (${tenA}::uuid, ${tenB}::uuid)`);
    await db.execute(sql`DELETE FROM units      WHERE id IN (${unitA}::uuid, ${unitB}::uuid)`);
    await db.execute(sql`DELETE FROM properties WHERE id IN (${propA}::uuid, ${propB}::uuid)`);
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${userA}::uuid`);
    await db.execute(sql`DELETE FROM profiles   WHERE id = ${userA}::uuid`);
    await db.execute(sql`DELETE FROM organizations WHERE id IN (${orgAId}::uuid, ${orgBId}::uuid)`);
  } catch (err) {
    console.warn("PayX-Cleanup (non-fatal):", (err as Error).message);
  }
}

async function countPaymentsFor(tenantId: string): Promise<number> {
  const r: any = await db.execute(sql`SELECT count(*)::int AS n FROM payments WHERE tenant_id = ${tenantId}::uuid`);
  return (r.rows?.[0]?.n ?? r[0]?.n) as number;
}

describe("POST /api/payments — Cross-Org-Schutz (Zahlung auf fremden Mieter)", () => {
  before(async () => { await seed(); });
  after(async () => { await cleanup(); });

  test("Positivfall: Zahlung auf eigenen Mieter (Org A) wird angelegt", async () => {
    const res = await request(appA)
      .post("/api/payments")
      .send({ tenant_id: tenA, betrag: "100.00", buchungs_datum: "2046-01-15", payment_type: "ueberweisung" })
      .expect(200);
    assert.equal(res.body.tenantId, tenA);
    assert.ok(res.body.id);
    createdPaymentIds.push(res.body.id);
    assert.equal(await countPaymentsFor(tenA), 1);
  });

  test("Cross-Org: Zahlung auf Mieter von Org B wird abgelehnt (403/404) und NICHT gespeichert", async () => {
    const res = await request(appA)
      .post("/api/payments")
      .send({ tenant_id: tenB, betrag: "250.00", buchungs_datum: "2046-01-15", payment_type: "ueberweisung" });
    // Identischer valider Payload wie im Positivfall, nur tenant_id fremd:
    // muss als Autorisierungsfehler (403) oder RLS-Unsichtbarkeit (404) enden —
    // NICHT 400, sonst könnte ein Validierungsfehler den fehlenden Org-Check maskieren.
    assert.ok(
      [403, 404].includes(res.status),
      `Erwartet Ablehnung (403/404), bekam ${res.status}: ${JSON.stringify(res.body)}`,
    );
    // Entscheidend: keine Fehlbuchung in der DB
    assert.equal(await countPaymentsFor(tenB), 0, "Es darf keine Zahlung auf den fremden Mieter existieren");
  });

  test("Cross-Org mit erratener eigener Unit im Body ändert nichts: tenant_id entscheidet", async () => {
    // Angreifer kennt evtl. Feldnamen — zusätzliche Felder dürfen den Schutz nicht umgehen
    const res = await request(appA)
      .post("/api/payments")
      .send({ tenant_id: tenB, betrag: "99.00", buchungs_datum: "2046-02-15", payment_type: "ueberweisung", unit_id: unitA, organization_id: orgAId });
    assert.ok([403, 404].includes(res.status));
    assert.equal(await countPaymentsFor(tenB), 0);
  });

  test("POST: eigener Mieter + fremde invoice_id (Org B) wird abgelehnt und NICHT gespeichert", async () => {
    const before = await countPaymentsFor(tenA);
    const res = await request(appA)
      .post("/api/payments")
      .send({ tenant_id: tenA, betrag: "50.00", buchungs_datum: "2046-03-15", payment_type: "ueberweisung", invoice_id: invB });
    assert.ok(
      [403, 404].includes(res.status),
      `Erwartet Ablehnung (403/404), bekam ${res.status}: ${JSON.stringify(res.body)}`,
    );
    assert.equal(await countPaymentsFor(tenA), before, "Keine Zahlung mit fremder Rechnung darf entstehen");
  });

  test("POST: eigener Mieter + eigene invoice_id funktioniert (Positivfall)", async () => {
    const res = await request(appA)
      .post("/api/payments")
      .send({ tenant_id: tenA, betrag: "50.00", buchungs_datum: "2046-03-16", payment_type: "ueberweisung", invoice_id: invA })
      .expect(200);
    createdPaymentIds.push(res.body.id);
    assert.equal(res.body.invoiceId, invA);
  });

  test("PATCH: bestehende Zahlung kann nicht auf fremde invoice_id (Org B) umgehängt werden", async () => {
    assert.ok(createdPaymentIds.length > 0, "Positivfall muss zuvor eine Zahlung angelegt haben");
    const paymentId = createdPaymentIds[0];
    const res = await request(appA)
      .patch(`/api/payments/${paymentId}`)
      .send({ invoice_id: invB });
    assert.ok(
      [403, 404].includes(res.status),
      `Erwartet Ablehnung (403/404), bekam ${res.status}: ${JSON.stringify(res.body)}`,
    );
    const row: any = await db.execute(sql`SELECT invoice_id FROM payments WHERE id = ${paymentId}::uuid`);
    const invoiceId = (row.rows?.[0] ?? row[0])?.invoice_id;
    assert.notEqual(invoiceId, invB, "Zahlung darf nicht mit fremder Rechnung verknüpft sein");
  });

  test("POST /api/payment-allocations: eigene Zahlung + fremde Rechnung (Org B) wird abgelehnt, keine Zuordnung entsteht", async () => {
    assert.ok(createdPaymentIds.length > 0);
    const paymentId = createdPaymentIds[0];
    const res = await request(appA)
      .post("/api/payment-allocations")
      .send({ paymentId, invoiceId: invB, appliedAmount: "10.00" });
    assert.ok(
      [403, 404].includes(res.status),
      `Erwartet Ablehnung (403/404), bekam ${res.status}: ${JSON.stringify(res.body)}`,
    );
    const row: any = await db.execute(sql`SELECT count(*)::int AS n FROM payment_allocations WHERE invoice_id = ${invB}::uuid`);
    assert.equal((row.rows?.[0] ?? row[0]).n, 0, "Keine Cross-Org-Zuordnung darf existieren");
  });

  test("POST /api/payment-allocations: eigene Zahlung + eigene Rechnung funktioniert (Positivfall)", async () => {
    const paymentId = createdPaymentIds[0];
    const res = await request(appA)
      .post("/api/payment-allocations")
      .send({ paymentId, invoiceId: invA, appliedAmount: "10.00" })
      .expect(201);
    assert.equal(res.body.invoiceId, invA);
  });

  test("DELETE /api/payments/:id → 405 (Löschen nicht erlaubt)", async () => {
    // Zahlung ist unveränderlich — Löschen ist prinzipiell verboten.
    // Der Endpunkt gibt 405 zurück, bevor er überhaupt die DB berührt.
    // Kein bestehender Datensatz nötig — der Handler prüft die ID gar nicht.
    const fakeId = randomUUID();
    const res = await request(appA)
      .delete(`/api/payments/${fakeId}`)
      .expect(405);
    assert.equal(res.body.code, "PAYMENT_DELETE_NOT_ALLOWED");
    assert.ok(
      res.body.error.includes("nicht gelöscht"),
      `Erwarte Hinweis auf Storno, bekam: ${res.body.error}`,
    );
  });

  // ── Task #175: geschützte Felder sauber abfangen ───────────────────────────

  test("PATCH betrag → 422 mit Storno-Hinweis (Vorab-Prüfung)", async () => {
    assert.ok(createdPaymentIds.length > 0, "Positivfall muss zuvor eine Zahlung angelegt haben");
    const paymentId = createdPaymentIds[0];
    const res = await request(appA)
      .patch(`/api/payments/${paymentId}`)
      .send({ betrag: "9999.00" })
      .expect(422);
    assert.equal(res.body.code, "PAYMENT_IMMUTABLE_FIELD");
    assert.ok(
      res.body.error.includes("Storno") || res.body.error.includes("Gegenbuchung"),
      `Erwarte Storno-Hinweis, bekam: ${res.body.error}`,
    );
    assert.ok(
      Array.isArray(res.body.fields) && res.body.fields.includes("betrag"),
      `Erwarte 'betrag' in fields, bekam: ${JSON.stringify(res.body.fields)}`,
    );
    // Betrag darf sich nicht geändert haben
    const row: any = await db.execute(sql`SELECT betrag FROM payments WHERE id = ${paymentId}::uuid`);
    const betrag = Number((row.rows?.[0] ?? row[0])?.betrag);
    assert.notEqual(betrag, 9999, "Betrag darf nicht verändert worden sein");
  });

  test("PATCH buchungs_datum → 422 mit Storno-Hinweis", async () => {
    assert.ok(createdPaymentIds.length > 0);
    const paymentId = createdPaymentIds[0];
    const res = await request(appA)
      .patch(`/api/payments/${paymentId}`)
      .send({ buchungs_datum: "2099-12-31" })
      .expect(422);
    assert.equal(res.body.code, "PAYMENT_IMMUTABLE_FIELD");
  });

  test("PATCH notizen → 200 (erlaubtes Feld bleibt änderbar)", async () => {
    assert.ok(createdPaymentIds.length > 0);
    const paymentId = createdPaymentIds[0];
    const res = await request(appA)
      .patch(`/api/payments/${paymentId}`)
      .send({ notizen: "Testkorretur-Notiz 175" })
      .expect(200);
    assert.equal(res.body.notizen, "Testkorretur-Notiz 175");
  });
});
