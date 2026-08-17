/**
 * WEG-Jahresabrechnung PDF-Route — Integrationstests
 *
 * Prüft:
 *  1. GET /api/weg/settlement/:id/pdf liefert text/html (nicht 404 durch falsche Routen-Reihenfolge)
 *  2. Route-Vorrang: /settlement/<uuid>/pdf wird NICHT von /:propertyId/:year abgefangen
 *  3. 404 bei unbekannter settlement_id
 *  4. 401 ohne Session
 *  5. GET /api/weg/settlements liefert Liste (leeres Array oder Array mit Einträgen)
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { rootDb as db } from '../../server/db';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import wegRouter from '../../server/routes/wegRoutes';
import { setupTestDb, teardownTestDb } from '../helpers/db';

// ── Testdaten ────────────────────────────────────────────────────────────────
const orgId   = uuidv4();
const userId  = uuidv4();
const propId  = uuidv4();
let settlementId: string;

// ── Express-Testapp ──────────────────────────────────────────────────────────
function buildApp(uid: string | null = userId) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: uid, organizationId: orgId };
    next();
  });
  app.use(wegRouter);
  return app;
}

const authApp = buildApp();
const anonApp = buildApp(null);

// ── Seed & Cleanup ────────────────────────────────────────────────────────────
async function seed() {
  await db.execute(sql`
    INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'PDF-Test-Org') ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO profiles (id, email, organization_id)
    VALUES (${userId}::uuid, 'pdf-test@test.at', ${orgId}::uuid) ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'PDF-Obj', 'Str 1', 'Wien', '1010', 'weg') ON CONFLICT DO NOTHING
  `);
  // A minimal weg_settlement row
  const res = await db.execute(sql`
    INSERT INTO weg_settlements
      (id, organization_id, property_id, year, total_expenses, total_prepayments,
       total_difference, owner_count, total_mea, reserve_fund_balance, status)
    VALUES
      (gen_random_uuid(), ${orgId}::uuid, ${propId}::uuid, 2029,
       '1000.00', '800.00', '200.00', 2, '100.0000', '500.00', 'entwurf')
    RETURNING id
  `);
  settlementId = (res.rows as any[])[0].id;
}

async function cleanup() {
  await db.execute(sql`DELETE FROM weg_settlements WHERE id = ${settlementId}::uuid`);
  await db.execute(sql`DELETE FROM properties    WHERE id = ${propId}::uuid`);
  await db.execute(sql`DELETE FROM profiles      WHERE id = ${userId}::uuid`);
  await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('WEG Jahresabrechnung — PDF-Route & Listendpunkt', () => {
  beforeAll(async () => {
    await setupTestDb();
    await seed();
  });

  afterAll(async () => {
    await cleanup();
    await teardownTestDb();
  });

  test('GET /api/weg/settlement/:id/pdf → 200 text/html (nicht 404 durch Routen-Kollision)', async () => {
    const res = await request(authApp)
      .get(`/api/weg/settlement/${settlementId}/pdf`);

    // The route must reach the PDF handler, not the /:propertyId/:year handler
    // (which would fail property lookup and return 404 or 500)
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    // Must contain HTML markup from the renderer
    expect(res.text).toMatch(/<html/i);
  });

  test('PDF-Response enthält window.print() Auto-Trigger', async () => {
    const res = await request(authApp)
      .get(`/api/weg/settlement/${settlementId}/pdf`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('window.print()');
  });

  test('PDF-Response hat Content-Disposition inline-Header', async () => {
    const res = await request(authApp)
      .get(`/api/weg/settlement/${settlementId}/pdf`);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/inline/);
    expect(res.headers['content-disposition']).toMatch(/weg-abrechnung/);
  });

  test('GET /api/weg/settlement/<unknown-uuid>/pdf → 404', async () => {
    const res = await request(authApp)
      .get(`/api/weg/settlement/${uuidv4()}/pdf`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/nicht gefunden/i);
  });

  test('GET /api/weg/settlement/:id/pdf ohne Auth → 401', async () => {
    const res = await request(anonApp)
      .get(`/api/weg/settlement/${settlementId}/pdf`);

    expect(res.status).toBe(401);
  });

  test('GET /api/weg/settlements → 200 Array (enthält erstellte Abrechnung)', async () => {
    const res = await request(authApp)
      .get('/api/weg/settlements');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.find((s: any) => s.id === settlementId);
    expect(found).toBeDefined();
    expect(found.year).toBe(2029);
    expect(found.status).toBe('entwurf');
  });

  test('GET /api/weg/settlements?propertyId=<known> → enthält nur Abrechnungen dieser Liegenschaft', async () => {
    const res = await request(authApp)
      .get(`/api/weg/settlements?propertyId=${propId}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.every((s: any) => s.property_id === propId)).toBe(true);
  });

  test('GET /api/weg/settlements ohne Auth → 401', async () => {
    const res = await request(anonApp)
      .get('/api/weg/settlements');

    expect(res.status).toBe(401);
  });
});
