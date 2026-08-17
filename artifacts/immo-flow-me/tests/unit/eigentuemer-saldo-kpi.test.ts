/**
 * Eigentümer-Saldo KPI — Integrationstests
 *
 * Prüft dass:
 *  1. GET /api/open-items/kpis: teilbezahlte WEG-Vorschreibungen werden korrekt
 *     als (gesamtbetrag − paid_amount) gezählt, nicht als Vollbetrag
 *  2. GET /api/weg/budget-plans/:id/vorschreibungen: paid_amount ist im Response enthalten
 *     (monthly_invoices mit weg_budget_plan_id)
 *  3. Org-Grenze: KPI-Endpunkt zeigt nur eigene Vorschreibungen
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
import wegRouter      from '../../server/routes/wegRoutes';

// ── IDs ───────────────────────────────────────────────────────────────────────
const orgId   = uuidv4();
const userId  = uuidv4();
const propId  = uuidv4();
const unitId  = uuidv4();
const ownerId = uuidv4();
const planId  = uuidv4();  // weg_budget_plans id — für monthly_invoices

// IDs für weg_vorschreibungen (KPI-Test)
const wvOffen       = uuidv4(); // offen,       gesamtbetrag=300, paid_amount=null → outstanding=300
const wvTeilbezahlt = uuidv4(); // teilbezahlt, gesamtbetrag=200, paid_amount=80  → outstanding=120
const wvBezahlt     = uuidv4(); // bezahlt,     gesamtbetrag=150, paid_amount=150 → vom Filter ausgeschlossen (status='bezahlt')

// ID für monthly_invoices (Budget-Plan-Vorschreibungen-Test)
const miTeilbezahlt = uuidv4(); // monthly_invoice mit weg_budget_plan_id und paid_amount

// ── Test-App-Builder ─────────────────────────────────────────────────────────
function buildApp(orgId_: string | null, uid: string = userId) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: uid, organizationId: orgId_ };
    next();
  });
  addOrgContext(app, orgId_);
  app.use(openItemsRouter);
  app.use(wegRouter);
  return app;
}

const authApp = buildApp(orgId);

// ── Seed ─────────────────────────────────────────────────────────────────────
async function seed() {
  await db.execute(sql`
    INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'EigSaldo-Org') ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO profiles (id, email, organization_id)
    VALUES (${userId}::uuid, ${'esaldo-' + userId.slice(0,8) + '@test.at'}, ${orgId}::uuid)
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO user_roles (user_id, role) VALUES (${userId}::uuid, 'admin') ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'EigSaldo-Obj', 'Str 1', 'Wien', '1010', 'weg')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status)
    VALUES (${unitId}::uuid, ${propId}::uuid, 'Top 1', 'wohnung', 'aktiv')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name, email)
    VALUES (${ownerId}::uuid, ${orgId}::uuid, 'Test', 'Owner', ${'owner-' + ownerId.slice(0,8) + '@test.at'})
    ON CONFLICT DO NOTHING
  `);

  // Budget-Plan für monthly_invoices-Test
  await db.execute(sql`
    INSERT INTO weg_budget_plans (id, organization_id, property_id, year, status, total_amount)
    VALUES (${planId}::uuid, ${orgId}::uuid, ${propId}::uuid, 2030, 'beschlossen', 10000)
    ON CONFLICT DO NOTHING
  `);

  // ─── weg_vorschreibungen für KPI-Test ───────────────────────────────────
  // 1) offen, 300 €, kein paid_amount → outstanding = 300
  await db.execute(sql`
    INSERT INTO weg_vorschreibungen
      (id, organization_id, property_id, unit_id, owner_id,
       year, month, mea_share, betriebskosten, ruecklage, instandhaltung,
       verwaltungshonorar, heizung, ust, gesamtbetrag, status, faellig_am)
    VALUES
      (${wvOffen}::uuid, ${orgId}::uuid, ${propId}::uuid, ${unitId}::uuid, ${ownerId}::uuid,
       2030, 1, 10.00, 200, 50, 20, 20, 10, 0, 300.00, 'offen', '2030-01-31')
    ON CONFLICT DO NOTHING
  `);

  // 2) teilbezahlt, 200 €, paid_amount=80 → outstanding = 120
  await db.execute(sql`
    INSERT INTO weg_vorschreibungen
      (id, organization_id, property_id, unit_id, owner_id,
       year, month, mea_share, betriebskosten, ruecklage, instandhaltung,
       verwaltungshonorar, heizung, ust, gesamtbetrag, paid_amount, status, faellig_am)
    VALUES
      (${wvTeilbezahlt}::uuid, ${orgId}::uuid, ${propId}::uuid, ${unitId}::uuid, ${ownerId}::uuid,
       2030, 2, 10.00, 130, 30, 15, 15, 10, 0, 200.00, 80.00, 'teilbezahlt', '2030-02-28')
    ON CONFLICT DO NOTHING
  `);

  // 3) bezahlt, 150 €, paid_amount=150 → vom KPI-Filter ausgeschlossen (status='bezahlt')
  await db.execute(sql`
    INSERT INTO weg_vorschreibungen
      (id, organization_id, property_id, unit_id, owner_id,
       year, month, mea_share, betriebskosten, ruecklage, instandhaltung,
       verwaltungshonorar, heizung, ust, gesamtbetrag, paid_amount, status, faellig_am)
    VALUES
      (${wvBezahlt}::uuid, ${orgId}::uuid, ${propId}::uuid, ${unitId}::uuid, ${ownerId}::uuid,
       2030, 3, 10.00, 100, 25, 10, 10, 5, 0, 150.00, 150.00, 'bezahlt', '2030-03-31')
    ON CONFLICT DO NOTHING
  `);

  // ─── monthly_invoice mit weg_budget_plan_id (für Budget-Plan-Vorschreibungen-Test) ───
  // teilbezahlt, gesamtbetrag=250, paid_amount=100 → outstanding=150
  await db.execute(sql`
    INSERT INTO monthly_invoices
      (id, unit_id, owner_id, weg_budget_plan_id,
       year, month, grundmiete, gesamtbetrag, paid_amount, status, faellig_am)
    VALUES
      (${miTeilbezahlt}::uuid, ${unitId}::uuid, ${ownerId}::uuid, ${planId}::uuid,
       2030, 4, 0, 250.00, 100.00, 'teilbezahlt', '2030-04-30')
    ON CONFLICT DO NOTHING
  `);
}

async function cleanup() {
  try {
    await db.execute(sql`DELETE FROM monthly_invoices WHERE id = ${miTeilbezahlt}::uuid`);
    await db.execute(sql`DELETE FROM weg_vorschreibungen WHERE id IN (${wvOffen}::uuid, ${wvTeilbezahlt}::uuid, ${wvBezahlt}::uuid)`);
    await db.execute(sql`DELETE FROM weg_budget_plans WHERE id = ${planId}::uuid`);
    await db.execute(sql`DELETE FROM owners WHERE id = ${ownerId}::uuid`);
    await db.execute(sql`DELETE FROM units WHERE id = ${unitId}::uuid`);
    await db.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM profiles WHERE id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
  } catch (err) {
    console.warn('Cleanup-Fehler (non-fatal):', (err as Error).message);
  }
}

// ── Tests: KPI-Endpunkt ───────────────────────────────────────────────────────
describe('GET /api/open-items/kpis — WEG-Vorschreibungen mit paid_amount', () => {
  beforeAll(async () => { await seed(); });
  afterAll(async  () => { await cleanup(); });

  test('totalOpenAmount berücksichtigt paid_amount bei teilbezahlt (nicht Bruttobetrag)', async () => {
    const res = await request(authApp)
      .get(`/api/open-items/kpis?propertyId=${propId}`)
      .expect(200);

    // Erwarteter offener Betrag aus weg_vorschreibungen:
    //   wvOffen       300 − 0  = 300
    //   wvTeilbezahlt 200 − 80 = 120
    //   wvBezahlt ist 'bezahlt' → vom Filter status != 'bezahlt' ausgeschlossen
    // Plus monthly_invoice (miTeilbezahlt):
    //   250 − 100 = 150
    // Gesamt = 300 + 120 + 150 = 570
    const totalOpenAmount = Number(res.body.totalOpenAmount);
    expect(totalOpenAmount).toBeCloseTo(570, 1);
  });

  test('totalOpen-Anzahl zählt offen + teilbezahlt aus beiden Tabellen, nicht bezahlt', async () => {
    const res = await request(authApp)
      .get(`/api/open-items/kpis?propertyId=${propId}`)
      .expect(200);

    // 2 aus weg_vorschreibungen (offen + teilbezahlt) + 1 aus monthly_invoices (teilbezahlt) = 3
    expect(res.body.totalOpen).toBe(3);
  });

  test('Bruttobetrag-Fehler: ohne paid_amount-Abzug wären 750 statt 570', async () => {
    // 300 + 200 + 250 = 750 (Brutto-Fehler ohne Abzug)
    // 300 + 120 + 150 = 570 (korrekt nach Abzug)
    const res = await request(authApp)
      .get(`/api/open-items/kpis?propertyId=${propId}`)
      .expect(200);

    const totalOpenAmount = Number(res.body.totalOpenAmount);
    expect(totalOpenAmount).not.toBeCloseTo(750, 0);
    expect(totalOpenAmount).toBeCloseTo(570, 1);
  });

  test('Org-Grenze: andere Org sieht 0 offene Posten für diese Liegenschaft', async () => {
    const otherOrg  = uuidv4();
    const otherUser = uuidv4();
    await db.execute(sql`
      INSERT INTO organizations (id, name) VALUES (${otherOrg}::uuid, 'EigSaldo-OtherOrg') ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO profiles (id, email, organization_id)
      VALUES (${otherUser}::uuid, ${'esaldo-other-' + otherUser.slice(0,8) + '@test.at'}, ${otherOrg}::uuid)
      ON CONFLICT DO NOTHING
    `);
    try {
      const otherApp = buildApp(otherOrg, otherUser);
      const res = await request(otherApp)
        .get(`/api/open-items/kpis?propertyId=${propId}`)
        .expect(200);
      expect(Number(res.body.totalOpenAmount)).toBe(0);
    } finally {
      await db.execute(sql`DELETE FROM profiles WHERE id = ${otherUser}::uuid`);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${otherOrg}::uuid`);
    }
  });

  test('KPI ohne propertyId-Filter summiert alle offenen WEG-Positionen der Org', async () => {
    const res = await request(authApp)
      .get('/api/open-items/kpis')
      .expect(200);

    // Muss mindestens die 570 € aus diesem Test enthalten
    const totalOpenAmount = Number(res.body.totalOpenAmount);
    expect(totalOpenAmount).toBeGreaterThanOrEqual(570);
  });
});

// ── Tests: Budget-Plan-Vorschreibungen ────────────────────────────────────────
describe('GET /api/weg/budget-plans/:id/vorschreibungen — paid_amount im Response', () => {
  beforeAll(async () => { await seed(); });
  afterAll(async  () => { await cleanup(); });

  test('teilbezahlte Vorschreibung (monthly_invoice) enthält paid_amount im Response', async () => {
    const res = await request(authApp)
      .get(`/api/weg/budget-plans/${planId}/vorschreibungen`)
      .expect(200);

    const teilbezahlt = res.body.find((v: any) => v.id === miTeilbezahlt);
    expect(teilbezahlt).toBeDefined();
    expect(Number(teilbezahlt.paid_amount)).toBeCloseTo(100, 1);
  });

  test('paid_amount korrekt im camelCase-snakeCase-Mapping (objectToSnakeCase)', async () => {
    const res = await request(authApp)
      .get(`/api/weg/budget-plans/${planId}/vorschreibungen`)
      .expect(200);

    // objectToSnakeCase konvertiert paidAmount → paid_amount
    const inv = res.body.find((v: any) => v.id === miTeilbezahlt);
    expect(inv).toBeDefined();
    expect(inv).toHaveProperty('paid_amount');
    expect(inv.paidAmount).toBeUndefined(); // camelCase darf nicht im Response sein
  });

  test('offener Restbetrag ist korrekt berechenbar: gesamtbetrag − paid_amount', async () => {
    const res = await request(authApp)
      .get(`/api/weg/budget-plans/${planId}/vorschreibungen`)
      .expect(200);

    const inv = res.body.find((v: any) => v.id === miTeilbezahlt);
    expect(inv).toBeDefined();
    const outstanding = Number(inv.gesamtbetrag) - Number(inv.paid_amount);
    expect(outstanding).toBeCloseTo(150, 1);  // 250 − 100
  });
});
