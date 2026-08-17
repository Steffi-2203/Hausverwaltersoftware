/**
 * Task #163: Cross-Org-Absicherung des Excel-Exports der OP-Liste
 *
 * Verifiziert, dass GET /api/accounting/export/op-liste als Org B
 * keinerlei Zeilen von Org A enthält — weder aus monthly_invoices
 * noch aus weg_vorschreibungen — auch nicht bei gesetztem propertyId-Filter.
 *
 * Muster: tests/unit/open-items-mi-cross-org.test.ts
 * XLSX-Parsing: tests/unit/xlsx-op-liste-weg.test.ts
 *
 * Ausführen:
 *   node --import=./node_modules/tsx/dist/esm/index.cjs --test \
 *     tests/unit/op-export-cross-org.test.ts
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import * as XLSX from "xlsx";

import { rootDb as db } from "../../server/db";
import openItemsRouter from "../../server/routes/openItemsRoutes";
import { addOrgContext } from "../helpers/withOrgContext";

// ── Testdaten-IDs ─────────────────────────────────────────────────────────────
const orgAId   = randomUUID();
const orgBId   = randomUUID();
const userA    = randomUUID();
const userB    = randomUUID();
const propA    = randomUUID();
const unitA    = randomUUID();
const tenantA  = randomUUID();
const ownerA   = randomUUID();
const miA      = randomUUID(); // monatliche Vorschreibung Org A
const wegA     = randomUUID(); // WEG-Vorschreibung Org A

// ── Hilfsfunktionen: XLSX-Antwort als Binär-Stream lesen und parsen ──────────
// Zeilen 0–3 sind Titel/Org/Datum/Leerzeile; Zeile 4 = Header; ab Zeile 5 Daten.
const DATA_START_IDX = 5;

/**
 * Custom supertest-Parser für XLSX (MIME: application/vnd.openxmlformats-*).
 * Supertest kennt diesen MIME-Typ nicht und gibt sonst ein leeres Object zurück.
 */
function xlsxParser(res: any, callback: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
  res.on("error", (err: Error) => callback(err, Buffer.alloc(0)));
}

function parseXlsx(buf: Buffer): string[][] {
  const wb  = XLSX.read(buf, { type: "buffer" });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  return aoa.map((row) => row.map((cell: any) => String(cell ?? "")));
}

/** Datenzellen ab Zeile DATA_START_IDX (nach Titel/Org/Datum/Leerzeile/Header). */
function dataRows(sheet: string[][]): string[][] {
  return sheet.slice(DATA_START_IDX);
}

// ── App-Builder ───────────────────────────────────────────────────────────────
function buildApp(orgId: string, uid: string, orgName = "TestOrg") {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: uid, organizationId: orgId, organizationName: orgName };
    (req as any).user    = { organizationId: orgId };
    next();
  });
  addOrgContext(app, orgId);
  app.use(openItemsRouter);
  return app;
}

const appA = buildApp(orgAId, userA, "XExport-Org-A");
const appB = buildApp(orgBId, userB, "XExport-Org-B");

// ── DB-Setup / Teardown ───────────────────────────────────────────────────────
describe("GET /api/accounting/export/op-liste — Cross-Org-Isolation (XLSX)", () => {
  before(async () => {
    // Org A mit Liegenschaft, Einheit, Mieter, Eigentümer
    await db.execute(sql`
      INSERT INTO organizations (id, name)
      VALUES (${orgAId}::uuid, 'XExport-Org-A') ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO profiles (id, email, organization_id)
      VALUES (${userA}::uuid, ${"xexport-a-" + userA.slice(0, 8) + "@test.at"}, ${orgAId}::uuid)
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
      VALUES (${propA}::uuid, ${orgAId}::uuid, 'XExport-Obj-A', 'Exportstr 1', 'Wien', '1010', 'mietverwaltung')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO units (id, property_id, top_nummer, type, status)
      VALUES (${unitA}::uuid, ${propA}::uuid, 'Top X1', 'wohnung', 'aktiv')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO tenants (id, unit_id, first_name, last_name, email, status)
      VALUES (${tenantA}::uuid, ${unitA}::uuid, 'Export', 'MieterA',
              ${"xexport-t-" + tenantA.slice(0, 8) + "@test.at"}, 'aktiv')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO owners (id, organization_id, first_name, last_name)
      VALUES (${ownerA}::uuid, ${orgAId}::uuid, 'Export', 'EigentuemerA')
      ON CONFLICT DO NOTHING
    `);

    // Offene Mieter-Vorschreibung in Org A
    await db.execute(sql`
      INSERT INTO monthly_invoices
        (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, status, faellig_am)
      VALUES (${miA}::uuid, ${tenantA}::uuid, ${unitA}::uuid,
              2044, 3, 900.00, 900.00, 'offen', '2044-03-15')
      ON CONFLICT DO NOTHING
    `);

    // Offene WEG-Vorschreibung in Org A
    await db.execute(sql`
      INSERT INTO weg_vorschreibungen
        (id, organization_id, property_id, unit_id, owner_id,
         year, month, mea_share, betriebskosten, gesamtbetrag, status, faellig_am)
      VALUES (${wegA}::uuid, ${orgAId}::uuid, ${propA}::uuid, ${unitA}::uuid, ${ownerA}::uuid,
              2044, 3, 100.0000, 350.00, 350.00, 'offen', '2044-03-15')
      ON CONFLICT DO NOTHING
    `);

    // Org B: leere fremde Organisation
    await db.execute(sql`
      INSERT INTO organizations (id, name)
      VALUES (${orgBId}::uuid, 'XExport-Org-B') ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO profiles (id, email, organization_id)
      VALUES (${userB}::uuid, ${"xexport-b-" + userB.slice(0, 8) + "@test.at"}, ${orgBId}::uuid)
      ON CONFLICT DO NOTHING
    `);
  });

  after(async () => {
    try {
      await db.execute(sql`DELETE FROM weg_vorschreibungen WHERE id = ${wegA}::uuid`);
      await db.execute(sql`DELETE FROM monthly_invoices    WHERE id = ${miA}::uuid`);
      await db.execute(sql`DELETE FROM tenants             WHERE id = ${tenantA}::uuid`);
      await db.execute(sql`DELETE FROM owners              WHERE id = ${ownerA}::uuid`);
      await db.execute(sql`DELETE FROM units               WHERE id = ${unitA}::uuid`);
      await db.execute(sql`DELETE FROM properties          WHERE id = ${propA}::uuid`);
      await db.execute(sql`DELETE FROM profiles WHERE id IN (${userA}::uuid, ${userB}::uuid)`);
      await db.execute(sql`DELETE FROM organizations WHERE id IN (${orgAId}::uuid, ${orgBId}::uuid)`);
    } catch (err) {
      console.warn("XExport-CrossOrg-Cleanup (non-fatal):", (err as Error).message);
    }
  });

  // ── Kontrolle: Org A sieht beide eigenen Zeilen ──────────────────────────
  test("Kontrolle: Org A Export enthält die eigene Mieter-Vorschreibung", async () => {
    const res = await request(appA)
      .get("/api/accounting/export/op-liste")
      .buffer(true).parse(xlsxParser)
      .expect(200);

    const sheet = parseXlsx(res.body);
    const rows  = dataRows(sheet);
    const ids   = rows.map((r) => r[0]); // Spalte 0 = Rechnungsnummer/ID
    assert.ok(ids.some((id) => id === miA || rows.flat().includes(miA)),
      `Org A muss die monthly_invoice ${miA} im Export sehen`);
  });

  test("Kontrolle: Org A Export enthält die eigene WEG-Vorschreibung", async () => {
    const res = await request(appA)
      .get("/api/accounting/export/op-liste")
      .buffer(true).parse(xlsxParser)
      .expect(200);

    const sheet    = parseXlsx(res.body);
    const rows     = dataRows(sheet);
    const allCells = rows.flat();
    assert.ok(
      allCells.some((c) => c === wegA) ||
        rows.some((r) => r[1] === "WEG-Eigentuemervorschreibung"),
      "Org A muss eine WEG-Zeile im Export sehen",
    );
  });

  // ── Isolation: Org B bekommt keine Org-A-Daten ───────────────────────────
  test("Ungefiltert: Org B Export ist leer — keine Daten von Org A", async () => {
    const res = await request(appB)
      .get("/api/accounting/export/op-liste")
      .buffer(true).parse(xlsxParser)
      .expect(200);

    const sheet   = parseXlsx(res.body);
    const rows    = dataRows(sheet);
    const allText = rows.flat().join(" ");

    // Org-A-IDs dürfen nicht im Export von Org B auftauchen
    assert.ok(!allText.includes(miA),  `monthly_invoice ${miA} von Org A darf Org B nicht sehen`);
    assert.ok(!allText.includes(wegA), `WEG-Vorschreibung ${wegA} von Org A darf Org B nicht sehen`);

    // Keine einzige Datenzeile (nur Header-Bereich)
    const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
    assert.equal(nonEmpty.length, 0, "Org B (leer) darf keinerlei Exportzeilen sehen");
  });

  test("propertyId=<OrgA-Prop>: Org B bekommt trotzdem keine Zeilen von Org A", async () => {
    const res = await request(appB)
      .get(`/api/accounting/export/op-liste?propertyId=${propA}`)
      .buffer(true).parse(xlsxParser)
      .expect(200);

    const sheet   = parseXlsx(res.body);
    const rows    = dataRows(sheet);
    const allText = rows.flat().join(" ");

    assert.ok(!allText.includes(miA),  "Org B darf monthly_invoice von Org A mit fremder propertyId nicht sehen");
    assert.ok(!allText.includes(wegA), "Org B darf WEG-Vorschreibung von Org A mit fremder propertyId nicht sehen");

    const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
    assert.equal(nonEmpty.length, 0, "Filter auf fremde propertyId liefert für Org B leeren Export");
  });

  // ── Vollständigkeit: Org A sieht beide Typen gleichzeitig ────────────────
  test("Org A Export enthält sowohl Mieter- als auch WEG-Zeilen", async () => {
    const res = await request(appA)
      .get("/api/accounting/export/op-liste")
      .buffer(true).parse(xlsxParser)
      .expect(200);

    const sheet  = parseXlsx(res.body);
    const rows   = dataRows(sheet);
    const types  = rows.map((r) => r[1]); // Spalte 1 = "Typ"

    const hasMieter = types.some((t) => t === "Mieter");
    const hasWeg    = types.some((t) => t === "WEG-Eigentuemervorschreibung");
    assert.ok(hasMieter, "Org A Export muss mindestens eine Mieter-Zeile enthalten");
    assert.ok(hasWeg,    "Org A Export muss mindestens eine WEG-Zeile enthalten");
  });
});
