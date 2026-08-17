/**
 * GET /api/open-items/kpis — Integrationstests
 *
 * Prueft dass:
 *  1. Teilbezahlte MI- und WEG-Positionen mit dem Restbetrag gezaehlt werden,
 *     nicht mit dem Bruttobetrag (kein "paid_amount vergessen"-Fehler)
 *  2. Summen aus monthly_invoices + weg_vorschreibungen addiert,
 *     NICHT verdoppelt werden (kein UNION ALL → UNION → Duplikat-Fehler)
 *  3. Bezahlte Positionen (status='bezahlt') aus beiden Tabellen nicht zaehlen
 *  4. propertyId-Filter schliesst WEG-Vorschreibungen anderer Liegenschaften aus
 *  5. Org-Grenze sequentiell: andere Org sieht 0, nicht fremde Daten
 *  6. Org-Grenze concurrent: 12 parallele Anfragen (6 Org-A + 6 Org-B) —
 *     keine Antwort enthaelt Daten der jeweils anderen Org
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { rootDb as db } from '../../server/db';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import openItemsRouter from '../../server/routes/openItemsRoutes';
import { addOrgContext } from '../helpers/withOrgContext';

// ── Testdaten-IDs ──────────────────────────────────────────────────────────────
const orgId  = uuidv4();
const userId = uuidv4();

// Liegenschaft A — hat MI + WEG Vorschreibungen
const propA  = uuidv4();
const unitA  = uuidv4();
const ownA   = uuidv4();
const tenA   = uuidv4();   // für monthly_invoices (tenant_id)

// Liegenschaft B — nur WEG (für propertyId-Filter-Test)
const propB  = uuidv4();
const unitB  = uuidv4();
const ownB   = uuidv4();

// monthly_invoices (MI) in Prop A
const miOffen       = uuidv4(); // offen,      gesamtbetrag=500  → outstanding=500
const miTeil        = uuidv4(); // teilbezahlt,gesamtbetrag=250, paid=100 → outstanding=150
const miBezahlt     = uuidv4(); // bezahlt,    gesamtbetrag=300  → NICHT gezählt

// weg_vorschreibungen (WEG) in Prop A
const wvOffen       = uuidv4(); // offen,      gesamtbetrag=300  → outstanding=300
const wvTeil        = uuidv4(); // teilbezahlt,gesamtbetrag=200, paid=80 → outstanding=120
const wvBezahlt     = uuidv4(); // bezahlt,    gesamtbetrag=150  → NICHT gezählt

// weg_vorschreibungen in Prop B (selbe Org — für Filter-Test)
const wvPropB       = uuidv4(); // offen,      gesamtbetrag=400  → nur bei propB-Filter sichtbar

// ── Test-App ───────────────────────────────────────────────────────────────────
function buildApp(orgId_: string | null, uid = userId) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: uid, organizationId: orgId_ };
    next();
  });
  addOrgContext(app, orgId_);
  app.use(openItemsRouter);
  return app;
}

const app = buildApp(orgId);

// ── Seed ──────────────────────────────────────────────────────────────────────
async function seed() {
  const email = (prefix: string, id: string) => `${prefix}-${id.slice(0, 8)}@kpi-test.at`;

  await db.execute(sql`
    INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'KPI-Org') ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO profiles (id, email, organization_id)
    VALUES (${userId}::uuid, ${email('kpi-u', userId)}, ${orgId}::uuid)
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${userId}::uuid, 'admin') ON CONFLICT DO NOTHING`);

  // Liegenschaft A
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propA}::uuid, ${orgId}::uuid, 'KPI-ObjA', 'Str 1', 'Wien', '1010', 'weg')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status)
    VALUES (${unitA}::uuid, ${propA}::uuid, 'A1', 'wohnung', 'aktiv')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name, email)
    VALUES (${ownA}::uuid, ${orgId}::uuid, 'OwnA', 'Test', ${email('ownA', ownA)})
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status)
    VALUES (${tenA}::uuid, ${unitA}::uuid, 'TenA', 'Test', ${email('tenA', tenA)}, 'aktiv')
    ON CONFLICT DO NOTHING
  `);

  // Liegenschaft B
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propB}::uuid, ${orgId}::uuid, 'KPI-ObjB', 'Str 2', 'Wien', '1010', 'weg')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status)
    VALUES (${unitB}::uuid, ${propB}::uuid, 'B1', 'wohnung', 'aktiv')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name, email)
    VALUES (${ownB}::uuid, ${orgId}::uuid, 'OwnB', 'Test', ${email('ownB', ownB)})
    ON CONFLICT DO NOTHING
  `);

  // ─── monthly_invoices (MI) in Prop A ────────────────────────────────────────
  // offen, 500 → outstanding 500
  await db.execute(sql`
    INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, status, faellig_am)
    VALUES (${miOffen}::uuid, ${tenA}::uuid, ${unitA}::uuid, 2033, 1, 500.00, 500.00, 'offen', '2033-01-31')
    ON CONFLICT DO NOTHING
  `);
  // teilbezahlt, gesamt=250, paid=100 → outstanding 150
  await db.execute(sql`
    INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, paid_amount, status, faellig_am)
    VALUES (${miTeil}::uuid, ${tenA}::uuid, ${unitA}::uuid, 2033, 2, 250.00, 250.00, 100.00, 'teilbezahlt', '2033-02-28')
    ON CONFLICT DO NOTHING
  `);
  // bezahlt, gesamt=300 → darf NICHT gezählt werden
  await db.execute(sql`
    INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, paid_amount, status, faellig_am)
    VALUES (${miBezahlt}::uuid, ${tenA}::uuid, ${unitA}::uuid, 2033, 3, 300.00, 300.00, 300.00, 'bezahlt', '2033-03-31')
    ON CONFLICT DO NOTHING
  `);

  // ─── weg_vorschreibungen in Prop A ─────────────────────────────────────────
  // offen, 300 → outstanding 300
  await db.execute(sql`
    INSERT INTO weg_vorschreibungen
      (id, organization_id, property_id, unit_id, owner_id,
       year, month, mea_share, betriebskosten, ruecklage, instandhaltung,
       verwaltungshonorar, heizung, ust, gesamtbetrag, status, faellig_am)
    VALUES (${wvOffen}::uuid, ${orgId}::uuid, ${propA}::uuid, ${unitA}::uuid, ${ownA}::uuid,
            2033, 1, 10, 200, 50, 20, 20, 10, 0, 300.00, 'offen', '2033-01-31')
    ON CONFLICT DO NOTHING
  `);
  // teilbezahlt, gesamt=200, paid=80 → outstanding 120
  await db.execute(sql`
    INSERT INTO weg_vorschreibungen
      (id, organization_id, property_id, unit_id, owner_id,
       year, month, mea_share, betriebskosten, ruecklage, instandhaltung,
       verwaltungshonorar, heizung, ust, gesamtbetrag, paid_amount, status, faellig_am)
    VALUES (${wvTeil}::uuid, ${orgId}::uuid, ${propA}::uuid, ${unitA}::uuid, ${ownA}::uuid,
            2033, 2, 10, 130, 30, 15, 15, 10, 0, 200.00, 80.00, 'teilbezahlt', '2033-02-28')
    ON CONFLICT DO NOTHING
  `);
  // bezahlt, 150 → darf NICHT gezählt werden
  await db.execute(sql`
    INSERT INTO weg_vorschreibungen
      (id, organization_id, property_id, unit_id, owner_id,
       year, month, mea_share, betriebskosten, ruecklage, instandhaltung,
       verwaltungshonorar, heizung, ust, gesamtbetrag, paid_amount, status, faellig_am)
    VALUES (${wvBezahlt}::uuid, ${orgId}::uuid, ${propA}::uuid, ${unitA}::uuid, ${ownA}::uuid,
            2033, 3, 10, 100, 25, 10, 10, 5, 0, 150.00, 150.00, 'bezahlt', '2033-03-31')
    ON CONFLICT DO NOTHING
  `);

  // ─── weg_vorschreibung in Prop B (selbe Org) ───────────────────────────────
  // offen, 400 → nur bei propertyId=propB sichtbar
  await db.execute(sql`
    INSERT INTO weg_vorschreibungen
      (id, organization_id, property_id, unit_id, owner_id,
       year, month, mea_share, betriebskosten, ruecklage, instandhaltung,
       verwaltungshonorar, heizung, ust, gesamtbetrag, status, faellig_am)
    VALUES (${wvPropB}::uuid, ${orgId}::uuid, ${propB}::uuid, ${unitB}::uuid, ${ownB}::uuid,
            2033, 1, 10, 270, 70, 25, 25, 10, 0, 400.00, 'offen', '2033-01-31')
    ON CONFLICT DO NOTHING
  `);
}

async function cleanup() {
  try {
    await db.execute(sql`DELETE FROM monthly_invoices WHERE id IN (${miOffen}::uuid, ${miTeil}::uuid, ${miBezahlt}::uuid)`);
    await db.execute(sql`DELETE FROM weg_vorschreibungen WHERE id IN (${wvOffen}::uuid, ${wvTeil}::uuid, ${wvBezahlt}::uuid, ${wvPropB}::uuid)`);
    await db.execute(sql`DELETE FROM tenants    WHERE id = ${tenA}::uuid`);
    await db.execute(sql`DELETE FROM owners     WHERE id IN (${ownA}::uuid, ${ownB}::uuid)`);
    await db.execute(sql`DELETE FROM units      WHERE id IN (${unitA}::uuid, ${unitB}::uuid)`);
    await db.execute(sql`DELETE FROM properties WHERE id IN (${propA}::uuid, ${propB}::uuid)`);
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM profiles   WHERE id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
  } catch (err) {
    console.warn('Cleanup-Fehler (non-fatal):', (err as Error).message);
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────
describe('GET /api/open-items/kpis — Summenberechnung (MI + WEG, keine Verdopplung)', () => {
  beforeAll(async () => { await seed(); });
  afterAll(async () => { await cleanup(); });

  //
  // Prop A enthält:
  //  MI:  offen 500 + teilbezahlt (250−100=150) + bezahlt 300 (ausgeschlossen)
  //  WEG: offen 300 + teilbezahlt (200−80=120)  + bezahlt 150 (ausgeschlossen)
  //  Erwartetes totalOpenAmount = 500 + 150 + 300 + 120 = 1 070
  //  Erwartetes totalOpen       = 4 Positionen (nicht 8 durch Verdopplung)
  //

  test('totalOpenAmount: MI + WEG werden addiert, nicht verdoppelt', async () => {
    const res = await request(app)
      .get(`/api/open-items/kpis?propertyId=${propA}`)
      .expect(200);

    const total = Number(res.body.totalOpenAmount);
    // Korrekte Summe aus Restbeträgen beider Tabellen
    expect(total).toBeCloseTo(1070, 1);
    // Explizite Prüfung gegen Verdopplungs-Bug (2 × 1070)
    expect(total).not.toBeCloseTo(2140, 0);
  });

  test('totalOpen-Anzahl: 4 offene Positionen (2 MI + 2 WEG), nicht 8 durch Verdopplung', async () => {
    const res = await request(app)
      .get(`/api/open-items/kpis?propertyId=${propA}`)
      .expect(200);

    expect(res.body.totalOpen).toBe(4);
  });

  test('Brutto-Fehler-Check: ohne paid_amount-Abzug wären 500+250+300+200=1250, nicht 1070', async () => {
    const res = await request(app)
      .get(`/api/open-items/kpis?propertyId=${propA}`)
      .expect(200);

    const total = Number(res.body.totalOpenAmount);
    expect(total).not.toBeCloseTo(1250, 0);
    expect(total).toBeCloseTo(1070, 1);
  });
});

describe('GET /api/open-items/kpis — Bezahlte Positionen werden ausgeschlossen', () => {
  beforeAll(async () => { await seed(); });
  afterAll(async () => { await cleanup(); });

  test('MI mit status=bezahlt (300) zählt nicht im totalOpenAmount', async () => {
    const res = await request(app)
      .get(`/api/open-items/kpis?propertyId=${propA}`)
      .expect(200);

    const total = Number(res.body.totalOpenAmount);
    // Würde bezahlt-MI gezählt: 1070 + 300 = 1370
    expect(total).not.toBeCloseTo(1370, 0);
    expect(total).toBeCloseTo(1070, 1);
  });

  test('WEG mit status=bezahlt (150) zählt nicht im totalOpenAmount', async () => {
    const res = await request(app)
      .get(`/api/open-items/kpis?propertyId=${propA}`)
      .expect(200);

    const total = Number(res.body.totalOpenAmount);
    // Würde bezahlt-WEG gezählt: 1070 + 150 = 1220
    expect(total).not.toBeCloseTo(1220, 0);
    expect(total).toBeCloseTo(1070, 1);
  });

  test('totalOpen-Anzahl schließt bezahlte Positionen beider Tabellen aus', async () => {
    const res = await request(app)
      .get(`/api/open-items/kpis?propertyId=${propA}`)
      .expect(200);

    // Nur 4 offen: 2 MI (offen + teilbezahlt) + 2 WEG (offen + teilbezahlt)
    expect(res.body.totalOpen).toBe(4);
  });
});

describe('GET /api/open-items/kpis — propertyId-Filter schließt WEG anderer Liegenschaften aus', () => {
  beforeAll(async () => { await seed(); });
  afterAll(async () => { await cleanup(); });

  test('propertyId=propA: WEG aus Prop B (400) erscheint nicht im KPI', async () => {
    const res = await request(app)
      .get(`/api/open-items/kpis?propertyId=${propA}`)
      .expect(200);

    const total = Number(res.body.totalOpenAmount);
    // Mit propB-WEG: 1070 + 400 = 1470
    expect(total).not.toBeCloseTo(1470, 0);
    expect(total).toBeCloseTo(1070, 1);
  });

  test('propertyId=propB: nur WEG von Prop B (400) zählt, Prop A nicht', async () => {
    const res = await request(app)
      .get(`/api/open-items/kpis?propertyId=${propB}`)
      .expect(200);

    const total = Number(res.body.totalOpenAmount);
    expect(total).toBeCloseTo(400, 1);
    // Prop A Items dürfen nicht dabei sein
    expect(total).not.toBeGreaterThan(401);
  });

  test('kein propertyId-Filter summiert alle Org-Positionen (≥ 1070 + 400)', async () => {
    const res = await request(app)
      .get('/api/open-items/kpis')
      .expect(200);

    const total = Number(res.body.totalOpenAmount);
    expect(total).toBeGreaterThanOrEqual(1470);
  });
});

describe('GET /api/open-items/kpis — Org-Grenze', () => {
  beforeAll(async () => { await seed(); });
  afterAll(async () => { await cleanup(); });

  test('andere Org sieht 0 offene Posten für Prop A', async () => {
    const otherOrg  = uuidv4();
    const otherUser = uuidv4();
    await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${otherOrg}::uuid, 'KPI-OtherOrg') ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${otherUser}::uuid, ${'kpi-other-' + otherUser.slice(0,8) + '@test.at'}, ${otherOrg}::uuid) ON CONFLICT DO NOTHING`);
    try {
      const otherApp = buildApp(otherOrg, otherUser);
      const res = await request(otherApp)
        .get(`/api/open-items/kpis?propertyId=${propA}`)
        .expect(200);

      expect(Number(res.body.totalOpenAmount)).toBe(0);
      expect(res.body.totalOpen).toBe(0);
    } finally {
      await db.execute(sql`DELETE FROM profiles      WHERE id = ${otherUser}::uuid`);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${otherOrg}::uuid`);
    }
  });

  test('andere Org sieht auch ohne propertyId-Filter 0 WEG-Positionen aus dieser Org', async () => {
    const otherOrg  = uuidv4();
    const otherUser = uuidv4();
    await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${otherOrg}::uuid, 'KPI-OtherOrg2') ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${otherUser}::uuid, ${'kpi-other2-' + otherUser.slice(0,8) + '@test.at'}, ${otherOrg}::uuid) ON CONFLICT DO NOTHING`);
    try {
      const otherApp = buildApp(otherOrg, otherUser);
      const res = await request(otherApp)
        .get('/api/open-items/kpis')
        .expect(200);

      // Die andere Org hat keine eigenen Daten — muss 0 sehen
      expect(Number(res.body.totalOpenAmount)).toBe(0);
    } finally {
      await db.execute(sql`DELETE FROM profiles      WHERE id = ${otherUser}::uuid`);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${otherOrg}::uuid`);
    }
  });
});

// ── Concurrent-Cross-Org-Testdaten (Jahr 2044 — kein Ueberlapp) ──────────────
//
// Org A: MI offen 600 + WEG offen 400 → erwartetes totalOpenAmount = 1 000
// Org B: MI offen 250                  → erwartetes totalOpenAmount =   250
//
// 12 parallele Requests (6 Org-A + 6 Org-B) werden gleichzeitig gefeuert.
// Jede Antwort muss ausschliesslich den Wert der anfragenden Org enthalten.

const cOrgAId  = uuidv4();
const cOrgBId  = uuidv4();
const cUserA   = uuidv4();
const cUserB   = uuidv4();
const cPropA   = uuidv4();
const cPropB   = uuidv4();
const cUnitA   = uuidv4();
const cUnitB   = uuidv4();
const cOwnA    = uuidv4();
const cOwnB    = uuidv4();
const cTenA    = uuidv4();
const cTenB    = uuidv4();
const cMiA     = uuidv4(); // offen, gesamtbetrag=600  → MI-Beitrag Org A
const cWvA     = uuidv4(); // offen, gesamtbetrag=400  → WEG-Beitrag Org A  → gesamt 1000
const cMiB     = uuidv4(); // offen, gesamtbetrag=250  → Org B gesamt 250

async function seedConcurrent() {
  const e = (p: string, id: string) => `${p}-${id.slice(0, 8)}@kpi-conc.at`;

  // Org A
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${cOrgAId}::uuid, 'KPI-Conc-OrgA') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${cUserA}::uuid, ${e('ca', cUserA)}, ${cOrgAId}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${cPropA}::uuid, ${cOrgAId}::uuid, 'Conc-ObjA', 'Str 1', 'Wien', '1010', 'weg')
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO units (id, property_id, top_nummer, type, status) VALUES (${cUnitA}::uuid, ${cPropA}::uuid, 'A1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO owners (id, organization_id, first_name, last_name, email) VALUES (${cOwnA}::uuid, ${cOrgAId}::uuid, 'OwnA', 'Conc', ${e('ownA', cOwnA)}) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO tenants (id, unit_id, first_name, last_name, email, status) VALUES (${cTenA}::uuid, ${cUnitA}::uuid, 'TenA', 'Conc', ${e('tenA', cTenA)}, 'aktiv') ON CONFLICT DO NOTHING`);
  // MI Org A: offen 600
  await db.execute(sql`
    INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, status, faellig_am)
    VALUES (${cMiA}::uuid, ${cTenA}::uuid, ${cUnitA}::uuid, 2044, 1, 600.00, 600.00, 'offen', '2044-01-31')
    ON CONFLICT DO NOTHING`);
  // WEG Org A: offen 400
  await db.execute(sql`
    INSERT INTO weg_vorschreibungen
      (id, organization_id, property_id, unit_id, owner_id,
       year, month, mea_share, betriebskosten, ruecklage, instandhaltung,
       verwaltungshonorar, heizung, ust, gesamtbetrag, status, faellig_am)
    VALUES (${cWvA}::uuid, ${cOrgAId}::uuid, ${cPropA}::uuid, ${cUnitA}::uuid, ${cOwnA}::uuid,
            2044, 1, 10, 280, 60, 25, 25, 10, 0, 400.00, 'offen', '2044-01-31')
    ON CONFLICT DO NOTHING`);

  // Org B
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${cOrgBId}::uuid, 'KPI-Conc-OrgB') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${cUserB}::uuid, ${e('cb', cUserB)}, ${cOrgBId}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${cPropB}::uuid, ${cOrgBId}::uuid, 'Conc-ObjB', 'Str 2', 'Wien', '1010', 'mietverwaltung')
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO units (id, property_id, top_nummer, type, status) VALUES (${cUnitB}::uuid, ${cPropB}::uuid, 'B1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO owners (id, organization_id, first_name, last_name, email) VALUES (${cOwnB}::uuid, ${cOrgBId}::uuid, 'OwnB', 'Conc', ${e('ownB', cOwnB)}) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO tenants (id, unit_id, first_name, last_name, email, status) VALUES (${cTenB}::uuid, ${cUnitB}::uuid, 'TenB', 'Conc', ${e('tenB', cTenB)}, 'aktiv') ON CONFLICT DO NOTHING`);
  // MI Org B: offen 250
  await db.execute(sql`
    INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, status, faellig_am)
    VALUES (${cMiB}::uuid, ${cTenB}::uuid, ${cUnitB}::uuid, 2044, 1, 250.00, 250.00, 'offen', '2044-01-31')
    ON CONFLICT DO NOTHING`);
}

async function cleanupConcurrent() {
  try {
    await db.execute(sql`DELETE FROM monthly_invoices     WHERE id IN (${cMiA}::uuid, ${cMiB}::uuid)`);
    await db.execute(sql`DELETE FROM weg_vorschreibungen  WHERE id = ${cWvA}::uuid`);
    await db.execute(sql`DELETE FROM tenants  WHERE id IN (${cTenA}::uuid, ${cTenB}::uuid)`);
    await db.execute(sql`DELETE FROM owners   WHERE id IN (${cOwnA}::uuid, ${cOwnB}::uuid)`);
    await db.execute(sql`DELETE FROM units    WHERE id IN (${cUnitA}::uuid, ${cUnitB}::uuid)`);
    await db.execute(sql`DELETE FROM properties WHERE id IN (${cPropA}::uuid, ${cPropB}::uuid)`);
    await db.execute(sql`DELETE FROM profiles WHERE id IN (${cUserA}::uuid, ${cUserB}::uuid)`);
    await db.execute(sql`DELETE FROM organizations WHERE id IN (${cOrgAId}::uuid, ${cOrgBId}::uuid)`);
  } catch (err) {
    console.warn('Concurrent-Cleanup (non-fatal):', (err as Error).message);
  }
}

describe('GET /api/open-items/kpis — Concurrent Org-Grenz-Isolation (12 parallele Anfragen)', () => {
  const appA = buildApp(cOrgAId, cUserA);
  const appB = buildApp(cOrgBId, cUserB);

  beforeAll(async () => { await seedConcurrent(); });
  afterAll(async  () => { await cleanupConcurrent(); });

  test('12 parallele Anfragen (6 Org-A + 6 Org-B): jede Antwort enthaelt nur eigene Org-Daten', async () => {
    // Alle 12 Requests gleichzeitig feuern
    const [aResults, bResults] = await Promise.all([
      Promise.all(
        Array.from({ length: 6 }, () =>
          request(appA).get('/api/open-items/kpis').expect(200),
        ),
      ),
      Promise.all(
        Array.from({ length: 6 }, () =>
          request(appB).get('/api/open-items/kpis').expect(200),
        ),
      ),
    ]);

    // Org A: MI 600 + WEG 400 = 1000 — kein Wert aus Org B (250) darf durchsickern
    for (const res of aResults) {
      const total = Number(res.body.totalOpenAmount);
      expect(total).toBeGreaterThanOrEqual(1000);     // eigene Daten vollstaendig
      expect(total).toBeLessThan(1250);               // kein Org-B-Anteil (1000+250=1250)
    }

    // Org B: MI 250 — kein Wert aus Org A (1000) darf durchsickern
    for (const res of bResults) {
      const total = Number(res.body.totalOpenAmount);
      expect(total).toBeGreaterThanOrEqual(250);      // eigene Daten vollstaendig
      expect(total).toBeLessThan(500);                // kein Org-A-Anteil (250+1000>>500)
    }
  });

  test('Org-A-Antworten: totalOpenAmount exakt 1000 (kein Fremddaten-Leck)', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(appA).get('/api/open-items/kpis').expect(200),
      ),
    );
    for (const res of results) {
      expect(Number(res.body.totalOpenAmount)).toBeCloseTo(1000, 1);
    }
  });

  test('Org-B-Antworten: totalOpenAmount exakt 250 (kein Fremddaten-Leck)', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(appB).get('/api/open-items/kpis').expect(200),
      ),
    );
    for (const res of results) {
      expect(Number(res.body.totalOpenAmount)).toBeCloseTo(250, 1);
    }
  });

  test('Org-A totalOpen-Anzahl unter Last: exakt 2 (MI + WEG)', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(appA).get('/api/open-items/kpis').expect(200),
      ),
    );
    for (const res of results) {
      expect(res.body.totalOpen).toBe(2);
    }
  });

  test('Org-B totalOpen-Anzahl unter Last: exakt 1 (nur MI)', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(appB).get('/api/open-items/kpis').expect(200),
      ),
    );
    for (const res of results) {
      expect(res.body.totalOpen).toBe(1);
    }
  });
});
