/**
 * Task #106: Concurrent Org-Grenz-Isolation für den Haupt-Endpunkt
 * GET /api/open-items (der KPI-Endpunkt ist bereits abgedeckt; die
 * Cross-Org-Suite in open-items-weg.test.ts testet nur sequentiell).
 *
 * Szenario: Org A und Org B mit bekannten WEG- und MI-Daten; 12 parallele
 * Anfragen (6 pro Org). Durch Connection-Pool-Interaktion (app.current_org
 * pro Session-Verbindung) darf keine Antwort Einträge der jeweils anderen
 * Org enthalten.
 *
 * node:test-Variante — läuft bei jedem Build via `pnpm test`.
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
const orgAId = randomUUID();
const orgBId = randomUUID();
const userA  = randomUUID();
const userB  = randomUUID();
const propA  = randomUUID();
const propB  = randomUUID();
const unitA  = randomUUID();
const unitB  = randomUUID();
const ownA   = randomUUID();
const ownB   = randomUUID();
const tenA   = randomUUID();
const wvA    = randomUUID(); // WEG-Vorschreibung Org A (offen)
const wvB    = randomUUID(); // WEG-Vorschreibung Org B (offen)
const miA    = randomUUID(); // monthly_invoice Org A (offen)

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

async function seed() {
  const e = (p: string, id: string) => `${p}-${id.slice(0, 8)}@oi-conc.at`;

  // Org A: WEG-Liegenschaft mit WEG-Vorschreibung + Mieter-Vorschreibung
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgAId}::uuid, 'OI-Conc-OrgA') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${userA}::uuid, ${e("ua", userA)}, ${orgAId}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propA}::uuid, ${orgAId}::uuid, 'OI-Conc-ObjA', 'Str 1', 'Wien', '1010', 'weg')
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO units (id, property_id, top_nummer, type, status) VALUES (${unitA}::uuid, ${propA}::uuid, 'A1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO owners (id, organization_id, first_name, last_name, email) VALUES (${ownA}::uuid, ${orgAId}::uuid, 'OwnA', 'Conc', ${e("ownA", ownA)}) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO tenants (id, unit_id, first_name, last_name, email, status) VALUES (${tenA}::uuid, ${unitA}::uuid, 'TenA', 'Conc', ${e("tenA", tenA)}, 'aktiv') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO weg_vorschreibungen
      (id, organization_id, property_id, unit_id, owner_id,
       year, month, mea_share, betriebskosten, ruecklage, instandhaltung,
       verwaltungshonorar, heizung, ust, gesamtbetrag, status, faellig_am)
    VALUES (${wvA}::uuid, ${orgAId}::uuid, ${propA}::uuid, ${unitA}::uuid, ${ownA}::uuid,
            2045, 1, 10, 280, 60, 25, 25, 10, 0, 400.00, 'offen', '2045-01-31')
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, status, faellig_am)
    VALUES (${miA}::uuid, ${tenA}::uuid, ${unitA}::uuid, 2045, 1, 600.00, 600.00, 'offen', '2045-01-31')
    ON CONFLICT DO NOTHING`);

  // Org B: WEG-Liegenschaft mit eigener WEG-Vorschreibung
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgBId}::uuid, 'OI-Conc-OrgB') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${userB}::uuid, ${e("ub", userB)}, ${orgBId}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propB}::uuid, ${orgBId}::uuid, 'OI-Conc-ObjB', 'Str 2', 'Wien', '1010', 'weg')
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO units (id, property_id, top_nummer, type, status) VALUES (${unitB}::uuid, ${propB}::uuid, 'B1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO owners (id, organization_id, first_name, last_name, email) VALUES (${ownB}::uuid, ${orgBId}::uuid, 'OwnB', 'Conc', ${e("ownB", ownB)}) ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO weg_vorschreibungen
      (id, organization_id, property_id, unit_id, owner_id,
       year, month, mea_share, betriebskosten, ruecklage, instandhaltung,
       verwaltungshonorar, heizung, ust, gesamtbetrag, status, faellig_am)
    VALUES (${wvB}::uuid, ${orgBId}::uuid, ${propB}::uuid, ${unitB}::uuid, ${ownB}::uuid,
            2045, 1, 10, 170, 40, 15, 15, 10, 0, 250.00, 'offen', '2045-01-31')
    ON CONFLICT DO NOTHING`);
}

async function cleanup() {
  try {
    await db.execute(sql`DELETE FROM monthly_invoices    WHERE id = ${miA}::uuid`);
    await db.execute(sql`DELETE FROM weg_vorschreibungen WHERE id IN (${wvA}::uuid, ${wvB}::uuid)`);
    await db.execute(sql`DELETE FROM tenants    WHERE id = ${tenA}::uuid`);
    await db.execute(sql`DELETE FROM owners     WHERE id IN (${ownA}::uuid, ${ownB}::uuid)`);
    await db.execute(sql`DELETE FROM units      WHERE id IN (${unitA}::uuid, ${unitB}::uuid)`);
    await db.execute(sql`DELETE FROM properties WHERE id IN (${propA}::uuid, ${propB}::uuid)`);
    await db.execute(sql`DELETE FROM profiles   WHERE id IN (${userA}::uuid, ${userB}::uuid)`);
    await db.execute(sql`DELETE FROM organizations WHERE id IN (${orgAId}::uuid, ${orgBId}::uuid)`);
  } catch (err) {
    console.warn("OI-Concurrent-Cleanup (non-fatal):", (err as Error).message);
  }
}

// IDs der jeweils fremden Org, die in keiner Antwort auftauchen dürfen
const orgAItemIds = [wvA, miA];
const orgBItemIds = [wvB];

describe("GET /api/open-items — Concurrent Org-Grenz-Isolation (12 parallele Anfragen)", () => {
  before(async () => { await seed(); });
  after(async () => { await cleanup(); });

  test("12 parallele Anfragen (6 Org-A + 6 Org-B): keine Antwort enthält Fremd-Org-Items", async () => {
    const [aResults, bResults] = await Promise.all([
      Promise.all(Array.from({ length: 6 }, () => request(appA).get("/api/open-items").expect(200))),
      Promise.all(Array.from({ length: 6 }, () => request(appB).get("/api/open-items").expect(200))),
    ]);

    for (const res of aResults) {
      const ids = res.body.map((i: any) => i.id);
      // Eigene Daten vollständig sichtbar
      for (const own of orgAItemIds) assert.ok(ids.includes(own), `Org A muss eigenes Item ${own} sehen`);
      // Kein Org-B-Item
      for (const foreign of orgBItemIds) assert.ok(!ids.includes(foreign), "Org-A-Antwort enthält Org-B-Item");
      // Jedes weg-Item muss zur eigenen Liegenschaft gehören
      for (const item of res.body.filter((i: any) => i.source === "weg")) {
        assert.equal(item.propertyId, propA, "weg-Item mit fremder propertyId in Org-A-Antwort");
      }
    }

    for (const res of bResults) {
      const ids = res.body.map((i: any) => i.id);
      for (const own of orgBItemIds) assert.ok(ids.includes(own), `Org B muss eigenes Item ${own} sehen`);
      for (const foreign of orgAItemIds) assert.ok(!ids.includes(foreign), "Org-B-Antwort enthält Org-A-Item");
      for (const item of res.body.filter((i: any) => i.source === "weg")) {
        assert.equal(item.propertyId, propB, "weg-Item mit fremder propertyId in Org-B-Antwort");
      }
      // Org B hat keine Mieter-Vorschreibungen → keine monthly_invoice-Items
      assert.equal(res.body.filter((i: any) => i.source === "monthly_invoice").length, 0);
    }
  });

  test("Wiederholung unter Last: 3 Runden à 12 parallele Anfragen bleiben isoliert", async () => {
    for (let round = 0; round < 3; round++) {
      const results = await Promise.all([
        ...Array.from({ length: 6 }, () => request(appA).get("/api/open-items").expect(200).then(r => ({ org: "A", body: r.body }))),
        ...Array.from({ length: 6 }, () => request(appB).get("/api/open-items").expect(200).then(r => ({ org: "B", body: r.body }))),
      ]);
      for (const { org, body } of results) {
        const ids = body.map((i: any) => i.id);
        const foreign = org === "A" ? orgBItemIds : orgAItemIds;
        for (const f of foreign) {
          assert.ok(!ids.includes(f), `Runde ${round}: Org-${org}-Antwort enthält fremdes Item ${f}`);
        }
      }
    }
  });
});
