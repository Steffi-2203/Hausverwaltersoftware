/**
 * GET /api/open-items — WEG-Teilzahlungen Integrationstests
 *
 * Prueft dass:
 *  1. WEG-Vorschreibungen mit source='weg' und paid_amount erscheinen
 *  2. propertyId-Filter schliesst WEG-Items der richtigen Liegenschaft ein
 *     und WEG-Items anderer Liegenschaften (gleiche Org) aus
 *  3. tenantId-Filter schliesst WEG-Items vollstaendig aus
 *  4. PATCH /api/weg/vorschreibungen/:id/status → status='teilbezahlt' + paid_amount
 *     ist danach im GET /api/open-items sichtbar
 *  5. Org-Grenz-Isolation: Org B sieht nie WEG-Items von Org A
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
import wegRouter from '../../server/routes/wegRoutes';

// ── Testdaten-IDs ─────────────────────────────────────────────────────────────
const orgId    = uuidv4();
const userId   = uuidv4();

// Liegenschaft A — hat WEG-Vorschreibungen
const propA    = uuidv4();
const unitA    = uuidv4();
const ownerId  = uuidv4();

// Liegenschaft B — zweite Liegenschaft in derselben Org (für propertyId-Filter-Test)
const propB    = uuidv4();
const unitB    = uuidv4();
const ownerB   = uuidv4();

// Mieter in Liegenschaft A (für monthly_invoice + tenantId-Filter-Test)
const tenantId = uuidv4();

// WEG-Vorschreibungen
const wvOffen          = uuidv4(); // offen, Prop A → erscheint in offener OP-Liste
const wvTeilbezahlt    = uuidv4(); // teilbezahlt, Prop A, paid_amount=80 → erscheint mit paid_amount
const wvBezahlt        = uuidv4(); // bezahlt, Prop A → darf NICHT erscheinen
const wvPropB          = uuidv4(); // offen, Prop B → erscheint nur bei propertyId=propB
const wvFuerPatch      = uuidv4(); // offen, Prop A → wird per PATCH zu teilbezahlt

// Monthly invoice (Mieter-Rechnung in Prop A — für tenantId-Test)
const miId = uuidv4();

// ── Test-App ─────────────────────────────────────────────────────────────────
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

const app = buildApp(orgId);

// ── Seed ─────────────────────────────────────────────────────────────────────
async function seed() {
  // Org & User
  await db.execute(sql`
    INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'OI-WEG-Org') ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO profiles (id, email, organization_id)
    VALUES (${userId}::uuid, ${'oiweg-' + userId.slice(0,8) + '@test.at'}, ${orgId}::uuid)
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO user_roles (user_id, role) VALUES (${userId}::uuid, 'admin') ON CONFLICT DO NOTHING
  `);

  // Liegenschaft A (WEG)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propA}::uuid, ${orgId}::uuid, 'OI-WEG-ObjA', 'Str 1', 'Wien', '1010', 'weg')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status)
    VALUES (${unitA}::uuid, ${propA}::uuid, 'Top 1', 'wohnung', 'aktiv')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name, email)
    VALUES (${ownerId}::uuid, ${orgId}::uuid, 'Anna', 'EigA', ${'oiweg-ownA-' + ownerId.slice(0,8) + '@test.at'})
    ON CONFLICT DO NOTHING
  `);

  // Liegenschaft B (WEG)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propB}::uuid, ${orgId}::uuid, 'OI-WEG-ObjB', 'Str 2', 'Wien', '1010', 'weg')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status)
    VALUES (${unitB}::uuid, ${propB}::uuid, 'Top 1', 'wohnung', 'aktiv')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name, email)
    VALUES (${ownerB}::uuid, ${orgId}::uuid, 'Bob', 'EigB', ${'oiweg-ownB-' + ownerB.slice(0,8) + '@test.at'})
    ON CONFLICT DO NOTHING
  `);

  // Mieter (für monthly_invoice) — tenants hat keine organization_id-Spalte
  await db.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status)
    VALUES (${tenantId}::uuid, ${unitA}::uuid, 'Max', 'Mieter', ${'oiweg-t-' + tenantId.slice(0,8) + '@test.at'}, 'aktiv')
    ON CONFLICT DO NOTHING
  `);

  // ─── WEG-Vorschreibungen (weg_vorschreibungen) ───────────────────────────────
  // gesamtbetrag=300, offen → outstanding=300
  await db.execute(sql`
    INSERT INTO weg_vorschreibungen
      (id, organization_id, property_id, unit_id, owner_id,
       year, month, mea_share, betriebskosten, ruecklage, instandhaltung,
       verwaltungshonorar, heizung, ust, gesamtbetrag, status, faellig_am)
    VALUES (${wvOffen}::uuid, ${orgId}::uuid, ${propA}::uuid, ${unitA}::uuid, ${ownerId}::uuid,
            2031, 1, 10, 200, 50, 20, 20, 10, 0, 300.00, 'offen', '2031-01-31')
    ON CONFLICT DO NOTHING
  `);

  // gesamtbetrag=200, teilbezahlt, paid_amount=80 → outstanding=120
  await db.execute(sql`
    INSERT INTO weg_vorschreibungen
      (id, organization_id, property_id, unit_id, owner_id,
       year, month, mea_share, betriebskosten, ruecklage, instandhaltung,
       verwaltungshonorar, heizung, ust, gesamtbetrag, paid_amount, status, faellig_am)
    VALUES (${wvTeilbezahlt}::uuid, ${orgId}::uuid, ${propA}::uuid, ${unitA}::uuid, ${ownerId}::uuid,
            2031, 2, 10, 130, 30, 15, 15, 10, 0, 200.00, 80.00, 'teilbezahlt', '2031-02-28')
    ON CONFLICT DO NOTHING
  `);

  // gesamtbetrag=150, bezahlt → darf in OP-Liste nicht erscheinen
  await db.execute(sql`
    INSERT INTO weg_vorschreibungen
      (id, organization_id, property_id, unit_id, owner_id,
       year, month, mea_share, betriebskosten, ruecklage, instandhaltung,
       verwaltungshonorar, heizung, ust, gesamtbetrag, paid_amount, status, faellig_am)
    VALUES (${wvBezahlt}::uuid, ${orgId}::uuid, ${propA}::uuid, ${unitA}::uuid, ${ownerId}::uuid,
            2031, 3, 10, 100, 25, 10, 10, 5, 0, 150.00, 150.00, 'bezahlt', '2031-03-31')
    ON CONFLICT DO NOTHING
  `);

  // gesamtbetrag=250, offen — in Prop B
  await db.execute(sql`
    INSERT INTO weg_vorschreibungen
      (id, organization_id, property_id, unit_id, owner_id,
       year, month, mea_share, betriebskosten, ruecklage, instandhaltung,
       verwaltungshonorar, heizung, ust, gesamtbetrag, status, faellig_am)
    VALUES (${wvPropB}::uuid, ${orgId}::uuid, ${propB}::uuid, ${unitB}::uuid, ${ownerB}::uuid,
            2031, 1, 10, 170, 40, 15, 15, 10, 0, 250.00, 'offen', '2031-01-31')
    ON CONFLICT DO NOTHING
  `);

  // Für PATCH-Test: offen, gesamtbetrag=400 → wird in Test zu teilbezahlt (paid_amount=150)
  await db.execute(sql`
    INSERT INTO weg_vorschreibungen
      (id, organization_id, property_id, unit_id, owner_id,
       year, month, mea_share, betriebskosten, ruecklage, instandhaltung,
       verwaltungshonorar, heizung, ust, gesamtbetrag, status, faellig_am)
    VALUES (${wvFuerPatch}::uuid, ${orgId}::uuid, ${propA}::uuid, ${unitA}::uuid, ${ownerId}::uuid,
            2031, 4, 10, 270, 70, 25, 25, 10, 0, 400.00, 'offen', '2031-04-30')
    ON CONFLICT DO NOTHING
  `);

  // Mieter-Rechnung (monthly_invoice) in Prop A, tenantId gesetzt
  await db.execute(sql`
    INSERT INTO monthly_invoices
      (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, status, faellig_am)
    VALUES (${miId}::uuid, ${tenantId}::uuid, ${unitA}::uuid,
            2031, 1, 900.00, 900.00, 'offen', '2031-01-15')
    ON CONFLICT DO NOTHING
  `);
}

async function cleanup() {
  try {
    await db.execute(sql`DELETE FROM monthly_invoices WHERE id = ${miId}::uuid`);
    await db.execute(sql`DELETE FROM weg_vorschreibungen WHERE id IN (
      ${wvOffen}::uuid, ${wvTeilbezahlt}::uuid, ${wvBezahlt}::uuid,
      ${wvPropB}::uuid, ${wvFuerPatch}::uuid
    )`);
    await db.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`);
    await db.execute(sql`DELETE FROM owners WHERE id IN (${ownerId}::uuid, ${ownerB}::uuid)`);
    await db.execute(sql`DELETE FROM units WHERE id IN (${unitA}::uuid, ${unitB}::uuid)`);
    await db.execute(sql`DELETE FROM properties WHERE id IN (${propA}::uuid, ${propB}::uuid)`);
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM profiles WHERE id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
  } catch (err) {
    console.warn('Cleanup-Fehler (non-fatal):', (err as Error).message);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('GET /api/open-items — WEG-Vorschreibungen Sichtbarkeit und Felder', () => {
  beforeAll(async () => { await seed(); });
  afterAll(async  () => { await cleanup(); });

  test('WEG-Items erscheinen mit source="weg"', async () => {
    const res = await request(app).get('/api/open-items').expect(200);
    const wegItems = res.body.filter((i: any) => i.source === 'weg');
    expect(wegItems.length).toBeGreaterThan(0);
  });

  test('WEG-Items haben paid_amount im Response (auch null für offen)', async () => {
    const res = await request(app).get('/api/open-items').expect(200);
    const wegItems = res.body.filter((i: any) => i.source === 'weg');
    // Alle WEG-Items müssen den Schlüssel paid_amount enthalten (Wert darf null sein)
    for (const item of wegItems) {
      expect(Object.prototype.hasOwnProperty.call(item, 'paid_amount')).toBe(true);
    }
  });

  test('Teilbezahlte WEG-Vorschreibung enthält korrekten paid_amount-Wert', async () => {
    const res = await request(app).get('/api/open-items').expect(200);
    const teilbezahlt = res.body.find((i: any) => i.id === wvTeilbezahlt);
    expect(teilbezahlt).toBeDefined();
    expect(teilbezahlt.source).toBe('weg');
    expect(Number(teilbezahlt.paid_amount)).toBeCloseTo(80, 1);
  });

  test('Bezahlte WEG-Vorschreibung erscheint NICHT in der OP-Liste', async () => {
    const res = await request(app).get('/api/open-items').expect(200);
    const ids = res.body.map((i: any) => i.id);
    expect(ids).not.toContain(wvBezahlt);
  });

  test('monthly_invoice (Mieter-Rechnung) erscheint mit source="monthly_invoice"', async () => {
    const res = await request(app).get('/api/open-items').expect(200);
    const mi = res.body.find((i: any) => i.id === miId);
    expect(mi).toBeDefined();
    expect(mi.source).toBe('monthly_invoice');
  });
});

describe('GET /api/open-items?propertyId — WEG-Items propertyId-Filter', () => {
  beforeAll(async () => { await seed(); });
  afterAll(async  () => { await cleanup(); });

  test('propertyId=propA: WEG-Items von Prop A erscheinen', async () => {
    const res = await request(app)
      .get(`/api/open-items?propertyId=${propA}`)
      .expect(200);

    const ids = res.body.map((i: any) => i.id);
    expect(ids).toContain(wvOffen);
    expect(ids).toContain(wvTeilbezahlt);
  });

  test('propertyId=propA: WEG-Items von Prop B erscheinen NICHT', async () => {
    const res = await request(app)
      .get(`/api/open-items?propertyId=${propA}`)
      .expect(200);

    const ids = res.body.map((i: any) => i.id);
    expect(ids).not.toContain(wvPropB);
  });

  test('propertyId=propB: WEG-Items von Prop B erscheinen, Prop A nicht', async () => {
    const res = await request(app)
      .get(`/api/open-items?propertyId=${propB}`)
      .expect(200);

    const ids = res.body.map((i: any) => i.id);
    expect(ids).toContain(wvPropB);
    expect(ids).not.toContain(wvOffen);
    expect(ids).not.toContain(wvTeilbezahlt);
  });
});

describe('GET /api/open-items?tenantId — WEG-Items bei tenantId-Filter ausgeschlossen', () => {
  beforeAll(async () => { await seed(); });
  afterAll(async  () => { await cleanup(); });

  test('tenantId-Filter: keine WEG-Items im Response', async () => {
    const res = await request(app)
      .get(`/api/open-items?tenantId=${tenantId}`)
      .expect(200);

    const wegItems = res.body.filter((i: any) => i.source === 'weg');
    expect(wegItems.length).toBe(0);
  });

  test('tenantId-Filter: die Mieter-Rechnung ist noch im Response', async () => {
    const res = await request(app)
      .get(`/api/open-items?tenantId=${tenantId}`)
      .expect(200);

    const ids = res.body.map((i: any) => i.id);
    expect(ids).toContain(miId);
  });

  test('tenantId-Filter: WEG-IDs (wvOffen, wvTeilbezahlt) fehlen', async () => {
    const res = await request(app)
      .get(`/api/open-items?tenantId=${tenantId}`)
      .expect(200);

    const ids = res.body.map((i: any) => i.id);
    expect(ids).not.toContain(wvOffen);
    expect(ids).not.toContain(wvTeilbezahlt);
  });
});

describe('PATCH /api/weg/vorschreibungen/:id/status → GET /api/open-items', () => {
  beforeAll(async () => { await seed(); });
  afterAll(async  () => { await cleanup(); });

  test('PATCH auf teilbezahlt → GET zeigt paid_amount korrekt', async () => {
    // Vor dem PATCH: wvFuerPatch ist offen, paid_amount=null
    const resBefore = await request(app).get('/api/open-items').expect(200);
    const before = resBefore.body.find((i: any) => i.id === wvFuerPatch);
    expect(before).toBeDefined();
    expect(before.status).toBe('offen');
    expect(before.paid_amount == null || Number(before.paid_amount) === 0).toBe(true);

    // PATCH: status → teilbezahlt, paid_amount = 150
    const patchRes = await request(app)
      .patch(`/api/weg/vorschreibungen/${wvFuerPatch}/status`)
      .send({ status: 'teilbezahlt', paid_amount: 150 })
      .expect(200);

    expect(patchRes.body.status).toBe('teilbezahlt');
    expect(Number(patchRes.body.paid_amount)).toBeCloseTo(150, 1);

    // GET nach PATCH: paid_amount sichtbar
    const resAfter = await request(app).get('/api/open-items').expect(200);
    const after = resAfter.body.find((i: any) => i.id === wvFuerPatch);
    expect(after).toBeDefined();
    expect(after.status).toBe('teilbezahlt');
    expect(Number(after.paid_amount)).toBeCloseTo(150, 1);
    expect(after.source).toBe('weg');
  });

  test('PATCH auf teilbezahlt → Outstanding im GET korrekt ablesbar (gesamt − paid)', async () => {
    const res = await request(app).get('/api/open-items').expect(200);
    const item = res.body.find((i: any) => i.id === wvFuerPatch);
    expect(item).toBeDefined();
    // gesamtbetrag=400, nach PATCH paid_amount=150 → Restschuld=250
    const outstanding = Number(item.gesamtbetrag) - Number(item.paid_amount);
    expect(outstanding).toBeCloseTo(250, 1);
  });

  test('PATCH auf bezahlt → Vorschreibung verschwindet aus OP-Liste', async () => {
    // Status: wvFuerPatch ist nach dem vorherigen Test teilbezahlt
    // Jetzt auf bezahlt setzen
    await request(app)
      .patch(`/api/weg/vorschreibungen/${wvFuerPatch}/status`)
      .send({ status: 'bezahlt' })
      .expect(200);

    const res = await request(app).get('/api/open-items').expect(200);
    const ids = res.body.map((i: any) => i.id);
    expect(ids).not.toContain(wvFuerPatch);
  });
});

// ── Cross-Org-Testdaten ────────────────────────────────────────────────────────
// Separate UUIDs — kein Bezug zu den oben definierten orgId/propA usw.
const xOrgAId  = uuidv4();  // Org A des Cross-Org-Tests
const xOrgBId  = uuidv4();  // fremde Org B
const xUserA   = uuidv4();
const xUserB   = uuidv4();
const xPropA   = uuidv4();  // Liegenschaft von Org A
const xUnitA   = uuidv4();
const xOwnerA  = uuidv4();
const xWvOrgA  = uuidv4();  // WEG-Vorschreibung in Org A (offen)

describe('GET /api/open-items — Org-Grenz-Isolation: Org-B sieht keine WEG-Items von Org-A', () => {
  // App, die als Org-B authentifiziert ist
  const appB = buildApp(xOrgBId, xUserB);

  beforeAll(async () => {
    // Org A anlegen
    await db.execute(sql`
      INSERT INTO organizations (id, name)
      VALUES (${xOrgAId}::uuid, 'CrossOrg-A')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO profiles (id, email, organization_id)
      VALUES (${xUserA}::uuid, ${'xorga-' + xUserA.slice(0, 8) + '@test.at'}, ${xOrgAId}::uuid)
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
      VALUES (${xPropA}::uuid, ${xOrgAId}::uuid, 'CrossObj-A', 'Str 1', 'Wien', '1010', 'weg')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO units (id, property_id, top_nummer, type, status)
      VALUES (${xUnitA}::uuid, ${xPropA}::uuid, 'Top 1', 'wohnung', 'aktiv')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO owners (id, organization_id, first_name, last_name, email)
      VALUES (${xOwnerA}::uuid, ${xOrgAId}::uuid, 'Anna', 'OrgA',
              ${'xorga-own-' + xOwnerA.slice(0, 8) + '@test.at'})
      ON CONFLICT DO NOTHING
    `);
    // WEG-Vorschreibung in Org A (offen) — darf Org B nie sehen
    await db.execute(sql`
      INSERT INTO weg_vorschreibungen
        (id, organization_id, property_id, unit_id, owner_id,
         year, month, mea_share, betriebskosten, ruecklage, instandhaltung,
         verwaltungshonorar, heizung, ust, gesamtbetrag, status, faellig_am)
      VALUES (${xWvOrgA}::uuid, ${xOrgAId}::uuid, ${xPropA}::uuid, ${xUnitA}::uuid, ${xOwnerA}::uuid,
              2042, 1, 10, 200, 50, 20, 20, 10, 0, 300.00, 'offen', '2042-01-31')
      ON CONFLICT DO NOTHING
    `);

    // Org B anlegen (keine eigenen WEG-Daten — leere Org)
    await db.execute(sql`
      INSERT INTO organizations (id, name)
      VALUES (${xOrgBId}::uuid, 'CrossOrg-B')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO profiles (id, email, organization_id)
      VALUES (${xUserB}::uuid, ${'xorgb-' + xUserB.slice(0, 8) + '@test.at'}, ${xOrgBId}::uuid)
      ON CONFLICT DO NOTHING
    `);
  });

  afterAll(async () => {
    try {
      await db.execute(sql`DELETE FROM weg_vorschreibungen WHERE id = ${xWvOrgA}::uuid`);
      await db.execute(sql`DELETE FROM owners     WHERE id = ${xOwnerA}::uuid`);
      await db.execute(sql`DELETE FROM units      WHERE id = ${xUnitA}::uuid`);
      await db.execute(sql`DELETE FROM properties WHERE id = ${xPropA}::uuid`);
      await db.execute(sql`DELETE FROM profiles   WHERE id IN (${xUserA}::uuid, ${xUserB}::uuid)`);
      await db.execute(sql`DELETE FROM organizations WHERE id IN (${xOrgAId}::uuid, ${xOrgBId}::uuid)`);
    } catch (err) {
      console.warn('Cross-Org-Cleanup (non-fatal):', (err as Error).message);
    }
  });

  test('Ungefiltert: Org-B sieht keine WEG-Items von Org-A', async () => {
    const res = await request(appB).get('/api/open-items').expect(200);
    const ids = res.body.map((i: any) => i.id);
    expect(ids).not.toContain(xWvOrgA);
  });

  test('Ungefiltert: Org-B hat keine weg-Items im Response (eigene Org ist leer)', async () => {
    const res = await request(appB).get('/api/open-items').expect(200);
    const wegItems = res.body.filter((i: any) => i.source === 'weg');
    expect(wegItems.length).toBe(0);
  });

  test('propertyId=xPropA (fremde Liegenschaft): Org-B bekommt trotzdem keine WEG-Items von Org-A', async () => {
    // Sichergestellt durch eq(properties.organizationId, orgId) im WEG-Abschnitt
    const res = await request(appB)
      .get(`/api/open-items?propertyId=${xPropA}`)
      .expect(200);
    const ids = res.body.map((i: any) => i.id);
    expect(ids).not.toContain(xWvOrgA);
  });

  test('propertyId=xPropA: keine weg-Items im Response fuer Org-B', async () => {
    const res = await request(appB)
      .get(`/api/open-items?propertyId=${xPropA}`)
      .expect(200);
    const wegItems = res.body.filter((i: any) => i.source === 'weg');
    expect(wegItems.length).toBe(0);
  });
});
