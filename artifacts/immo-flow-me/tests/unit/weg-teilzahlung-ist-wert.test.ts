/**
 * getOwnerPrepayments() — Teilzahlungen als Ist-Wert (Task #47)
 *
 * Prüft dass die Service-Funktion getOwnerPrepayments() den tatsächlich
 * bezahlten Betrag bei Teilzahlungen korrekt als totalIst anrechnet.
 *
 * Prüfmatrix:
 *   status='bezahlt',     gesamtbetrag=200           → +200
 *   status='teilbezahlt', gesamtbetrag=200, paid=80  → +80  (paidAmount gilt)
 *   status='teilbezahlt', gesamtbetrag=200, paid=NULL→ +0   (sicherer Fallback)
 *   status='offen'                                    → +0   (ignoriert)
 *   status='ueberfaellig'                             → +0   (ignoriert)
 *   Mehrere Vorschreibungen gemischt                  → korrekte Summe
 *
 * Pro Szenario wird auch calculateOwnerSettlement() aufgerufen um
 * sicherzustellen dass das saldo = totalSoll - totalIst korrekt ist.
 */

import { describe, test, before as beforeAll, after as afterAll, afterEach } from 'node:test';
import { expect } from '../helpers/expect';
import { rootDb as db } from '../../server/db';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getOwnerPrepayments, calculateOwnerSettlement } from '../../server/services/wegSettlementService';

// ── Konstanten ────────────────────────────────────────────────────────────────
const YEAR  = 2082;       // Jahr weit in der Vergangenheit — kein Produktions-Konflikt
const orgId = uuidv4();

// Liegenschaft + Einheit + Eigentümer (geteilt für alle Szenarien)
const propId  = uuidv4();
const unitId  = uuidv4();
const ownerId = uuidv4();

// ── Seed ─────────────────────────────────────────────────────────────────────
async function seed() {
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'Teilzahlung-Test-Org') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'Teilzahlung-Liegenschaft', 'Testgasse 47', 'Wien', '1010', 'weg')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status)
    VALUES (${unitId}::uuid, ${propId}::uuid, 'Top 47', 'wohnung', 'aktiv')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name)
    VALUES (${ownerId}::uuid, ${orgId}::uuid, 'Test', 'Teilzahlung')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO weg_unit_owners (property_id, organization_id, unit_id, owner_id, mea_share)
    VALUES (${propId}::uuid, ${orgId}::uuid, ${unitId}::uuid, ${ownerId}::uuid, '1000')
    ON CONFLICT DO NOTHING
  `);
}

// Löscht alle weg_vorschreibungen des Testeigentümers (zwischen den Tests)
async function clearVorschreibungen() {
  await db.execute(sql`DELETE FROM weg_vorschreibungen WHERE owner_id = ${ownerId}::uuid AND year = ${YEAR}`);
}

async function cleanup() {
  await db.execute(sql`DELETE FROM weg_vorschreibungen WHERE owner_id = ${ownerId}::uuid`);
  await db.execute(sql`DELETE FROM weg_unit_owners WHERE property_id = ${propId}::uuid`);
  await db.execute(sql`DELETE FROM expenses WHERE property_id = ${propId}::uuid`);
  await db.execute(sql`DELETE FROM units WHERE id = ${unitId}::uuid`);
  await db.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
  await db.execute(sql`DELETE FROM owners WHERE id = ${ownerId}::uuid`);
  await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
}

// Hilfsfunktion: eine Vorschreibung anlegen
async function insertVorschreibung(params: {
  month: number;
  gesamtbetrag: string;
  status: string;
  paidAmount?: string | null;
}) {
  await db.execute(sql`
    INSERT INTO weg_vorschreibungen
      (organization_id, property_id, unit_id, owner_id, year, month, mea_share, gesamtbetrag, status, paid_amount)
    VALUES
      (${orgId}::uuid, ${propId}::uuid, ${unitId}::uuid, ${ownerId}::uuid,
       ${YEAR}, ${params.month}, '1000', ${params.gesamtbetrag}, ${params.status},
       ${params.paidAmount ?? null})
  `);
}

// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => { await cleanup(); await seed(); });
afterAll(async  () => { await cleanup(); });

// ─────────────────────────────────────────────────────────────────────────────
describe("getOwnerPrepayments() — Einzelstatus-Fälle", () => {
  afterEach(async () => { await clearVorschreibungen(); });

  test("status='bezahlt', gesamtbetrag=200 → totalIst = 200", async () => {
    await insertVorschreibung({ month: 1, gesamtbetrag: "200.00", status: "bezahlt" });
    const ist = await getOwnerPrepayments(ownerId, unitId, YEAR);
    expect(ist).toBe(200);
  });

  test("status='bezahlt', gesamtbetrag=200, paidAmount=80 → totalIst = 200 (gesamtbetrag gilt bei bezahlt)", async () => {
    // Auch wenn paidAmount gesetzt ist: bei status='bezahlt' gilt gesamtbetrag
    await insertVorschreibung({ month: 1, gesamtbetrag: "200.00", status: "bezahlt", paidAmount: "80.00" });
    const ist = await getOwnerPrepayments(ownerId, unitId, YEAR);
    expect(ist).toBe(200);
  });

  test("status='teilbezahlt', gesamtbetrag=200, paidAmount=80 → totalIst = 80", async () => {
    await insertVorschreibung({ month: 1, gesamtbetrag: "200.00", status: "teilbezahlt", paidAmount: "80.00" });
    const ist = await getOwnerPrepayments(ownerId, unitId, YEAR);
    expect(ist).toBe(80);
  });

  test("status='teilbezahlt', paidAmount=NULL → totalIst = 0 (sicherer Fallback)", async () => {
    await insertVorschreibung({ month: 1, gesamtbetrag: "200.00", status: "teilbezahlt", paidAmount: null });
    const ist = await getOwnerPrepayments(ownerId, unitId, YEAR);
    expect(ist).toBe(0);
  });

  test("status='offen' → totalIst = 0 (wird ignoriert)", async () => {
    await insertVorschreibung({ month: 1, gesamtbetrag: "300.00", status: "offen" });
    const ist = await getOwnerPrepayments(ownerId, unitId, YEAR);
    expect(ist).toBe(0);
  });

  test("status='ueberfaellig' → totalIst = 0 (wird ignoriert)", async () => {
    await insertVorschreibung({ month: 1, gesamtbetrag: "300.00", status: "ueberfaellig" });
    const ist = await getOwnerPrepayments(ownerId, unitId, YEAR);
    expect(ist).toBe(0);
  });

  test("keine Vorschreibungen → totalIst = 0", async () => {
    const ist = await getOwnerPrepayments(ownerId, unitId, YEAR);
    expect(ist).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("getOwnerPrepayments() — Mehrere Vorschreibungen gemischt", () => {
  afterEach(async () => { await clearVorschreibungen(); });

  test("bezahlt(200) + teilbezahlt(80) + offen(100) → totalIst = 280", async () => {
    await insertVorschreibung({ month: 1, gesamtbetrag: "200.00", status: "bezahlt" });
    await insertVorschreibung({ month: 2, gesamtbetrag: "200.00", status: "teilbezahlt", paidAmount: "80.00" });
    await insertVorschreibung({ month: 3, gesamtbetrag: "100.00", status: "offen" });
    const ist = await getOwnerPrepayments(ownerId, unitId, YEAR);
    expect(ist).toBe(280);
  });

  test("teilbezahlt(NULL) + teilbezahlt(50) + bezahlt(150) → totalIst = 200", async () => {
    await insertVorschreibung({ month: 1, gesamtbetrag: "200.00", status: "teilbezahlt", paidAmount: null });
    await insertVorschreibung({ month: 2, gesamtbetrag: "100.00", status: "teilbezahlt", paidAmount: "50.00" });
    await insertVorschreibung({ month: 3, gesamtbetrag: "150.00", status: "bezahlt" });
    const ist = await getOwnerPrepayments(ownerId, unitId, YEAR);
    expect(ist).toBe(200);  // 0 + 50 + 150
  });

  test("ueberfaellig(300) + offen(200) + teilbezahlt(30) → totalIst = 30", async () => {
    await insertVorschreibung({ month: 1, gesamtbetrag: "300.00", status: "ueberfaellig" });
    await insertVorschreibung({ month: 2, gesamtbetrag: "200.00", status: "offen" });
    await insertVorschreibung({ month: 3, gesamtbetrag: "200.00", status: "teilbezahlt", paidAmount: "30.00" });
    const ist = await getOwnerPrepayments(ownerId, unitId, YEAR);
    expect(ist).toBe(30);
  });

  test("Alle 12 Monate vollständig bezahlt → korrekte Jahressumme", async () => {
    for (let m = 1; m <= 12; m++) {
      await insertVorschreibung({ month: m, gesamtbetrag: "100.00", status: "bezahlt" });
    }
    const ist = await getOwnerPrepayments(ownerId, unitId, YEAR);
    expect(ist).toBe(1200);
  });

  test("Dezimalwerte werden korrekt summiert (Rundung auf 2 Stellen)", async () => {
    // 33.33 + 33.33 + 33.34 = 100.00 (typischer Teilungsfehler)
    await insertVorschreibung({ month: 1, gesamtbetrag: "33.33", status: "bezahlt" });
    await insertVorschreibung({ month: 2, gesamtbetrag: "33.33", status: "bezahlt" });
    await insertVorschreibung({ month: 3, gesamtbetrag: "33.34", status: "bezahlt" });
    const ist = await getOwnerPrepayments(ownerId, unitId, YEAR);
    expect(ist).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("calculateOwnerSettlement() — saldo = totalSoll - totalIst bei Teilzahlungen", () => {
  // Für dieses Szenario brauchen wir Aufwände damit totalSoll > 0 ist
  const expenseId = uuidv4();

  beforeAll(async () => {
    await clearVorschreibungen();
    // Aufwand 1200 € → totalSoll für den Eigentümer = 1200 € (MEA 1000/1000 = 100%)
    await db.execute(sql`
      INSERT INTO expenses (property_id, category, expense_type, bezeichnung, betrag, datum, year, month, ist_umlagefaehig)
      VALUES (${propId}::uuid, 'betriebskosten_umlagefaehig', 'versicherung', 'Versicherung Test 47',
              '1200.00', ${YEAR + '-06-01'}, ${YEAR}, 6, true)
      ON CONFLICT DO NOTHING
    `);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM expenses WHERE property_id = ${propId}::uuid AND year = ${YEAR}`);
    await clearVorschreibungen();
  });

  afterEach(async () => { await clearVorschreibungen(); });

  test("keine Vorschreibungen: saldo = totalSoll (1200 €)", async () => {
    const { ownerResults } = await calculateOwnerSettlement(propId, YEAR, orgId);
    const r = ownerResults.find(o => o.ownerId === ownerId)!;
    expect(r.totalSoll).toBe(1200);
    expect(r.totalIst).toBe(0);
    expect(r.saldo).toBe(1200);
  });

  test("bezahlt(200): saldo = 1200 - 200 = 1000 €", async () => {
    await insertVorschreibung({ month: 1, gesamtbetrag: "200.00", status: "bezahlt" });
    const { ownerResults } = await calculateOwnerSettlement(propId, YEAR, orgId);
    const r = ownerResults.find(o => o.ownerId === ownerId)!;
    expect(r.totalIst).toBe(200);
    expect(r.saldo).toBe(1000);
  });

  test("teilbezahlt(80 von 200): saldo = 1200 - 80 = 1120 €", async () => {
    await insertVorschreibung({ month: 1, gesamtbetrag: "200.00", status: "teilbezahlt", paidAmount: "80.00" });
    const { ownerResults } = await calculateOwnerSettlement(propId, YEAR, orgId);
    const r = ownerResults.find(o => o.ownerId === ownerId)!;
    expect(r.totalIst).toBe(80);
    expect(r.saldo).toBe(1120);
  });

  test("teilbezahlt(NULL): saldo = 1200 - 0 = 1200 € (kein ungeprüfter Betrag angerechnet)", async () => {
    await insertVorschreibung({ month: 1, gesamtbetrag: "200.00", status: "teilbezahlt", paidAmount: null });
    const { ownerResults } = await calculateOwnerSettlement(propId, YEAR, orgId);
    const r = ownerResults.find(o => o.ownerId === ownerId)!;
    expect(r.totalIst).toBe(0);
    expect(r.saldo).toBe(1200);
  });

  test("offen(300): saldo = 1200 - 0 = 1200 € (offene Vorschreibung zählt nicht)", async () => {
    await insertVorschreibung({ month: 1, gesamtbetrag: "300.00", status: "offen" });
    const { ownerResults } = await calculateOwnerSettlement(propId, YEAR, orgId);
    const r = ownerResults.find(o => o.ownerId === ownerId)!;
    expect(r.totalIst).toBe(0);
    expect(r.saldo).toBe(1200);
  });

  test("gemischt: bezahlt(200) + teilbezahlt(80): saldo = 1200 - 280 = 920 €", async () => {
    await insertVorschreibung({ month: 1, gesamtbetrag: "200.00", status: "bezahlt" });
    await insertVorschreibung({ month: 2, gesamtbetrag: "200.00", status: "teilbezahlt", paidAmount: "80.00" });
    const { ownerResults } = await calculateOwnerSettlement(propId, YEAR, orgId);
    const r = ownerResults.find(o => o.ownerId === ownerId)!;
    expect(r.totalIst).toBe(280);
    expect(r.saldo).toBe(920);
  });

  test("vollständig bezahlt (12 × 100 €): saldo = 1200 - 1200 = 0", async () => {
    for (let m = 1; m <= 12; m++) {
      await insertVorschreibung({ month: m, gesamtbetrag: "100.00", status: "bezahlt" });
    }
    const { ownerResults } = await calculateOwnerSettlement(propId, YEAR, orgId);
    const r = ownerResults.find(o => o.ownerId === ownerId)!;
    expect(r.totalIst).toBe(1200);
    expect(r.saldo).toBe(0);
  });
});
