/**
 * MRG-Check Endpoint — HTTP-Integrationstests
 *
 * Testet GET /api/tenants/:id/mrg-check über den echten HTTP-Layer (supertest)
 * mit einer minimalen Express-App, die richtwertRoutes einbindet und die
 * Session-Authentifizierung per Middleware-Inject simuliert.
 *
 * Kernszenarien:
 *  1. Nicht authentifiziert → 401
 *  2. mietrecht_typ=NULL → Warnung unterdrückt
 *  3. mietrecht_typ='frei' → Warnung unterdrückt
 *  4. mietrecht_typ='richtwert', unbefristeter Lease (befristet=false, end_date=NULL) → Berechnung
 *  5. Befristeter Lease: befristet=false, end_date gesetzt → 25 % Abschlag korrekt angewandt
 *  6. Org-Isolation: Tenant einer anderen Org ist nicht abrufbar
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { db } from '../../server/db';
import { sql, eq, and } from 'drizzle-orm';
import { properties, tenants, units, leases, organizations, profiles } from '@shared/schema';
import { v4 as uuidv4 } from 'uuid';
import richtwertRoutes from '../../server/routes/richtwertRoutes';
import { setupTestDb, teardownTestDb } from '../helpers/db';

// ── Testdaten ────────────────────────────────────────────────────────────────
const orgId   = uuidv4();
const orgBId  = uuidv4();
const userId  = uuidv4();
const propRichtwert = uuidv4();
const propFrei      = uuidv4();
const propNull      = uuidv4();
const propOrgB      = uuidv4();
const unitRichtwert   = uuidv4();
const unitFrei        = uuidv4();
const unitNull        = uuidv4();
const unitBefristet   = uuidv4();    // Lease hat end_date aber befristet=false (default)
const unitOrgB        = uuidv4();
const tenantRichtwert = uuidv4();
const tenantFrei      = uuidv4();
const tenantNull      = uuidv4();
const tenantBefristet = uuidv4();
const tenantOrgB      = uuidv4();

// ── Express-Testapp ──────────────────────────────────────────────────────────
/**
 * Minimale Express-App mit echter richtwertRoutes.
 * Die Session-Middleware injiziert userId (und organizationId für RLS-Middleware).
 * isAuthenticated prüft req.session?.userId — daher reicht das Session-Inject.
 */
function buildTestApp(sessionUserId: string | null) {
  const app = express();
  app.use(express.json());

  // Session-Inject: simuliert eine authentifizierte Session
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: sessionUserId, organizationId: orgId };
    next();
  });

  app.use(richtwertRoutes);
  return app;
}

// Authentifizierte App (Org A)
const authApp = buildTestApp(userId);
// Nicht authentifizierte App
const anonApp = buildTestApp(null);

// ── Seed & Cleanup ───────────────────────────────────────────────────────────
async function seedMrgHttpTestData() {
  await db.execute(sql`
    INSERT INTO organizations (id, name, created_at) VALUES
      (${orgId}::uuid,  'MRG-HTTP-Org-A', NOW()),
      (${orgBId}::uuid, 'MRG-HTTP-Org-B', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO profiles (id, email, organization_id, created_at) VALUES
      (${userId}::uuid, 'mrg-http@example.com', ${orgId}::uuid, NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  // Liegenschaften mit verschiedenen mietrecht_typ-Werten
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, bundesland, mietrecht_typ, created_at) VALUES
      (${propRichtwert}::uuid, ${orgId}::uuid,  'HTTP-Richtwert', 'A1', 'Wien', '1010', 'Wien', 'richtwert', NOW()),
      (${propFrei}::uuid,      ${orgId}::uuid,  'HTTP-Frei',      'A2', 'Wien', '1010', 'Wien', 'frei',      NOW()),
      (${propNull}::uuid,      ${orgId}::uuid,  'HTTP-Null',      'A3', 'Wien', '1010', NULL,   NULL,        NOW()),
      (${propOrgB}::uuid,      ${orgBId}::uuid, 'HTTP-OrgB',      'B1', 'Wien', '1010', 'Wien', 'richtwert', NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  // Einheiten 75 m² (Richtwert Wien: 6,67 €/m² × 75 = 500,25 €)
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status, flaeche, created_at) VALUES
      (${unitRichtwert}::uuid, ${propRichtwert}::uuid, 'T1', 'wohnung', 'aktiv', 75, NOW()),
      (${unitFrei}::uuid,      ${propFrei}::uuid,      'T1', 'wohnung', 'aktiv', 75, NOW()),
      (${unitNull}::uuid,      ${propNull}::uuid,      'T1', 'wohnung', 'aktiv', 75, NOW()),
      (${unitBefristet}::uuid, ${propRichtwert}::uuid, 'T2', 'wohnung', 'aktiv', 75, NOW()),
      (${unitOrgB}::uuid,      ${propOrgB}::uuid,      'T1', 'wohnung', 'aktiv', 75, NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  // Mieter — Grundmiete 900 € deutlich über Richtwert 500,25 €
  await db.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, mietbeginn, grundmiete, created_at) VALUES
      (${tenantRichtwert}::uuid, ${unitRichtwert}::uuid, 'Max', 'R', 'r@t.at', 'aktiv', '2024-01-01', 900, NOW()),
      (${tenantFrei}::uuid,      ${unitFrei}::uuid,      'Eva', 'F', 'f@t.at', 'aktiv', '2024-01-01', 900, NOW()),
      (${tenantNull}::uuid,      ${unitNull}::uuid,      'Tom', 'N', 'n@t.at', 'aktiv', '2024-01-01', 900, NOW()),
      (${tenantBefristet}::uuid, ${unitBefristet}::uuid, 'Pia', 'B', 'b@t.at', 'aktiv', '2024-01-01', 900, NOW()),
      (${tenantOrgB}::uuid,      ${unitOrgB}::uuid,      'Bob', 'O', 'o@t.at', 'aktiv', '2024-01-01', 900, NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  // Unbefristeter Lease (befristet=false, end_date=NULL)
  await db.execute(sql`
    INSERT INTO leases (id, tenant_id, unit_id, start_date, end_date, grundmiete, status, befristet, created_at)
    VALUES (gen_random_uuid(), ${tenantRichtwert}::uuid, ${unitRichtwert}::uuid,
            '2024-01-01', NULL, 900, 'aktiv', false, NOW())
    ON CONFLICT DO NOTHING
  `);

  // Befristeter Lease — NUR end_date gesetzt, befristet bleibt beim DEFAULT false.
  // Dieser Test prüft, ob der Endpoint befristung korrekt aus end_date ableitet.
  await db.execute(sql`
    INSERT INTO leases (id, tenant_id, unit_id, start_date, end_date, grundmiete, status, befristet, befristung_ende, created_at)
    VALUES (gen_random_uuid(), ${tenantBefristet}::uuid, ${unitBefristet}::uuid,
            '2024-01-01', '2027-12-31', 900, 'aktiv', false, '2027-12-31', NOW())
    ON CONFLICT DO NOTHING
  `);
}

async function cleanupMrgHttpTestData() {
  const tids = [tenantRichtwert, tenantFrei, tenantNull, tenantBefristet, tenantOrgB];
  for (const tid of tids) {
    await db.execute(sql`DELETE FROM leases WHERE tenant_id = ${tid}::uuid`);
  }
  await db.execute(sql`DELETE FROM tenants WHERE id IN (${tenantRichtwert}::uuid, ${tenantFrei}::uuid, ${tenantNull}::uuid, ${tenantBefristet}::uuid, ${tenantOrgB}::uuid)`);
  await db.execute(sql`DELETE FROM units WHERE id IN (${unitRichtwert}::uuid, ${unitFrei}::uuid, ${unitNull}::uuid, ${unitBefristet}::uuid, ${unitOrgB}::uuid)`);
  await db.execute(sql`DELETE FROM properties WHERE id IN (${propRichtwert}::uuid, ${propFrei}::uuid, ${propNull}::uuid, ${propOrgB}::uuid)`);
  await db.execute(sql`DELETE FROM profiles WHERE id = ${userId}::uuid`);
  await db.execute(sql`DELETE FROM organizations WHERE id IN (${orgId}::uuid, ${orgBId}::uuid)`);
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe('MRG-Check HTTP-Endpoint (GET /api/tenants/:id/mrg-check)', () => {
  beforeAll(async () => {
    await setupTestDb();
    await seedMrgHttpTestData();
  });

  afterAll(async () => {
    await cleanupMrgHttpTestData();
    await teardownTestDb();
  });

  test('nicht authentifiziert → 401', async () => {
    const res = await request(anonApp).get(`/api/tenants/${tenantRichtwert}/mrg-check`);
    expect(res.status).toBe(401);
  });

  test('mietrecht_typ=NULL → Warnung unterdrückt (ueberschritten=false)', async () => {
    const res = await request(authApp).get(`/api/tenants/${tenantNull}/mrg-check`);
    expect(res.status).toBe(200);
    expect(res.body.ueberschritten).toBe(false);
    expect(res.body.zulassigerHmz).toBeNull();
  });

  test("mietrecht_typ='frei' → Warnung unterdrückt", async () => {
    const res = await request(authApp).get(`/api/tenants/${tenantFrei}/mrg-check`);
    expect(res.status).toBe(200);
    expect(res.body.ueberschritten).toBe(false);
    expect(res.body.zulassigerHmz).toBeNull();
  });

  test("mietrecht_typ='richtwert', unbefristeter Lease → Überschreitung korrekt berechnet", async () => {
    const res = await request(authApp).get(`/api/tenants/${tenantRichtwert}/mrg-check`);
    expect(res.status).toBe(200);
    // Grundmiete 900 > Richtwert Wien 6,67 × 75 m² = 500,25 → Überschreitung
    expect(res.body.ueberschritten).toBe(true);
    expect(typeof res.body.zulassigerHmz).toBe('number');
    // Unbefristeter Vertrag: kein Befristungsabschlag
    expect(res.body.zulassigerHmz).toBeGreaterThan(375);
  });

  test('befristeter Lease (befristet=false, end_date gesetzt) → 25 % Abschlag korrekt angewandt', async () => {
    const res = await request(authApp).get(`/api/tenants/${tenantBefristet}/mrg-check`);
    expect(res.status).toBe(200);
    expect(res.body.ueberschritten).toBe(true);
    // Mit 25 % Befristungsabschlag: 500,25 × 0,75 = 375,19
    // Ohne Abschlag wäre zulässiger HMZ ≈ 500,25
    // → mit Abschlag muss zulässiger HMZ kleiner als 500 sein
    expect(res.body.zulassigerHmz).toBeLessThan(500);
    expect(res.body.zulassigerHmz).toBeGreaterThan(300);  // Plausibilitätsprüfung
  });

  test('Org-Isolation: Tenant der Org B → 404 (nicht abrufbar für Org A)', async () => {
    const res = await request(authApp).get(`/api/tenants/${tenantOrgB}/mrg-check`);
    expect(res.status).toBe(404);
  });
});
