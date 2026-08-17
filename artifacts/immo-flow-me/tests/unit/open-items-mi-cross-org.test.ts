/**
 * Task #105: Org-Grenz-Isolation für den monthly_invoices-Abschnitt von
 * GET /api/open-items (der bestehende Cross-Org-Test in open-items-weg.test.ts
 * deckt nur den WEG-Abschnitt ab).
 *
 * Setup: Org A besitzt eine offene Mieter-Vorschreibung (monthly_invoice),
 * Org B hat keine eigenen Daten. Erwartung:
 *  - GET /api/open-items als Org B: kein Item von Org A (weder monthly_invoice
 *    noch sonst etwas)
 *  - GET /api/open-items?propertyId=<OrgA-Prop> als Org B: ebenfalls leer
 *  - Kontrolle: Org A sieht die eigene Vorschreibung (Test testet nicht ins Leere)
 *
 * node:test-Variante (läuft bei jedem Build via `pnpm test`), Muster wie die
 * Cross-Org-Suite in open-items-weg.test.ts.
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";

import { rootDb as db } from "../../server/db";
import openItemsRouter from "../../server/routes/openItemsRoutes";
import { addOrgContext } from "../helpers/withOrgContext";

// ── Testdaten-IDs ────────────────────────────────────────────────────────────
const orgAId  = randomUUID();
const orgBId  = randomUUID();
const userA   = randomUUID();
const userB   = randomUUID();
const propA   = randomUUID();
const unitA   = randomUUID();
const tenantA = randomUUID();
const miOrgA  = randomUUID(); // offene monthly_invoice in Org A

function buildApp(orgId: string, uid: string) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: uid, organizationId: orgId };
    next();
  });
  addOrgContext(app, orgId);
  app.use(openItemsRouter);
  return app;
}

const appA = buildApp(orgAId, userA);
const appB = buildApp(orgBId, userB);

describe("GET /api/open-items — Org-Isolation für Mieter-Vorschreibungen (monthly_invoices)", () => {
  before(async () => {
    // Org A mit Liegenschaft, Einheit, Mieter und offener Vorschreibung
    await db.execute(sql`
      INSERT INTO organizations (id, name) VALUES (${orgAId}::uuid, 'MI-XOrg-A') ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO profiles (id, email, organization_id)
      VALUES (${userA}::uuid, ${"mixorga-" + userA.slice(0, 8) + "@test.at"}, ${orgAId}::uuid)
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
      VALUES (${propA}::uuid, ${orgAId}::uuid, 'MI-XObj-A', 'Str 1', 'Wien', '1010', 'mietverwaltung')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO units (id, property_id, top_nummer, type, status)
      VALUES (${unitA}::uuid, ${propA}::uuid, 'Top 1', 'wohnung', 'aktiv')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO tenants (id, unit_id, first_name, last_name, email, status)
      VALUES (${tenantA}::uuid, ${unitA}::uuid, 'Max', 'MieterA',
              ${"mixorga-t-" + tenantA.slice(0, 8) + "@test.at"}, 'aktiv')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO monthly_invoices
        (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, status, faellig_am)
      VALUES (${miOrgA}::uuid, ${tenantA}::uuid, ${unitA}::uuid,
              2043, 1, 800.00, 800.00, 'offen', '2043-01-15')
      ON CONFLICT DO NOTHING
    `);

    // Org B: leere fremde Org
    await db.execute(sql`
      INSERT INTO organizations (id, name) VALUES (${orgBId}::uuid, 'MI-XOrg-B') ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO profiles (id, email, organization_id)
      VALUES (${userB}::uuid, ${"mixorgb-" + userB.slice(0, 8) + "@test.at"}, ${orgBId}::uuid)
      ON CONFLICT DO NOTHING
    `);
  });

  after(async () => {
    try {
      await db.execute(sql`DELETE FROM monthly_invoices WHERE id = ${miOrgA}::uuid`);
      await db.execute(sql`DELETE FROM tenants    WHERE id = ${tenantA}::uuid`);
      await db.execute(sql`DELETE FROM units      WHERE id = ${unitA}::uuid`);
      await db.execute(sql`DELETE FROM properties WHERE id = ${propA}::uuid`);
      await db.execute(sql`DELETE FROM profiles   WHERE id IN (${userA}::uuid, ${userB}::uuid)`);
      await db.execute(sql`DELETE FROM organizations WHERE id IN (${orgAId}::uuid, ${orgBId}::uuid)`);
    } catch (err) {
      console.warn("MI-CrossOrg-Cleanup (non-fatal):", (err as Error).message);
    }
  });

  test("Kontrolle: Org A sieht die eigene offene Mieter-Vorschreibung", async () => {
    const res = await request(appA).get("/api/open-items").expect(200);
    const item = res.body.find((i: any) => i.id === miOrgA);
    assert.ok(item, "Org A muss die eigene monthly_invoice sehen");
    assert.equal(item.source, "monthly_invoice");
  });

  test("Ungefiltert: Org B sieht keine Mieter-Vorschreibung von Org A", async () => {
    const res = await request(appB).get("/api/open-items").expect(200);
    const ids = res.body.map((i: any) => i.id);
    assert.ok(!ids.includes(miOrgA), "Org B darf die monthly_invoice von Org A nicht sehen");
    const miItems = res.body.filter((i: any) => i.source === "monthly_invoice");
    assert.equal(miItems.length, 0, "Org B (leer) darf keinerlei monthly_invoice-Items sehen");
  });

  test("propertyId=<OrgA-Prop>: Org B bekommt trotzdem keine Items von Org A", async () => {
    const res = await request(appB)
      .get(`/api/open-items?propertyId=${propA}`)
      .expect(200);
    assert.equal(res.body.length, 0, "Fremde propertyId darf für Org B keine Items liefern");
  });

  test("tenantId=<OrgA-Mieter>: Org B bekommt keine Items des fremden Mieters", async () => {
    const res = await request(appB)
      .get(`/api/open-items?tenantId=${tenantA}`)
      .expect(200);
    const ids = res.body.map((i: any) => i.id);
    assert.ok(!ids.includes(miOrgA));
    assert.equal(res.body.filter((i: any) => i.source === "monthly_invoice").length, 0);
  });
});
