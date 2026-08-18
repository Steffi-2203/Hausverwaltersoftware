/**
 * Lagezuschlag / Abschläge — E2E-Integrationstests
 *
 * Prüft den vollständigen Datenpfad für alle drei Einstiegspunkte:
 *
 * A) POST /api/tenants (Neuanlage mit Lagezuschlag)
 *    → Lease-Spalte lagezuschlag gespeichert
 *    → GET liefert den Wert zurück
 *    → mrg-check berücksichtigt den Zuschlag
 *
 * B) PATCH /api/tenants/:id ohne aktiven Lease
 *    → PATCH mit lagezuschlag legt neuen Lease an
 *    → mrg-check berücksichtigt den Zuschlag
 *
 * C) PATCH /api/tenants/:id mit aktivem Lease (Änderung)
 *    → Lagezuschlag / Abschläge werden in den Lease geschrieben
 *    → GET /api/tenants/:id/mrg-check liefert neuen Höchstmietzins
 *
 * Szenario: Wien, 75 m², Richtwert 6,67 €/m², Grundmiete 520 €
 *   Formel: HMZ = (Richtwert + Lagezuschlag_€/m² + Abschläge_€/m²) × m²
 *
 *   Ohne Zuschlag:        HMZ = 6,67 × 75         = 500,25 → überschritten
 *   Lagezuschlag 0,50 €:  HMZ = (6,67+0,50) × 75  = 537,75 → nicht überschritten
 *   Abschläge −0,50 €:    HMZ = (6,67+0,50−0,50)×75 = 500,25 → überschritten
 *   Lagezuschlag null:    HMZ = (6,67−0,50) × 75  = 462,75 → überschritten
 *
 * Validierung:
 *   lagezuschlag < 0  → 400 (muss ≥ 0 sein)
 *   abschlaege   > 0  → 400 (muss ≤ 0 sein)
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { rootDb, appPool, orgContext } from '../../server/db';
import * as schema from '@shared/schema';
import tenantRoutes from '../../server/routes/tenantRoutes';
import richtwertRoutes from '../../server/routes/richtwertRoutes';

// ── Test-IDs ──────────────────────────────────────────────────────────────────

const orgId    = uuidv4();
const userId   = uuidv4();
const propId   = uuidv4();
const unitId   = uuidv4();
const tenantId = uuidv4();
// Unique email per run — prevents ON-CONFLICT-skip + stale user_roles after aborted runs
const runTag   = uuidv4().slice(0, 8);
let   leaseId: string;

// Extra units/tenants for POST-create and PATCH-no-lease scenarios
const unitId2    = uuidv4(); // for POST-create test
const unitId3    = uuidv4(); // for PATCH-no-lease test
const tenantId3  = uuidv4(); // pre-seeded tenant without a lease
let   postCreatedTenantId: string; // set by the POST-create test

// ── Express-Testapp ───────────────────────────────────────────────────────────

// Eigenes Test-Middleware statt rlsMiddleware:
// rlsMiddleware setzt app.current_org mit SET LOCAL (transaktionslokal).
// db.transaction() im PATCH-Handler committed die äußere Transaktion, wodurch
// app.current_org gecleart wird und der finale db.select() (finalTenant)
// ins Leere läuft. Lösung: set_config(..., false) = session-level — überlebt
// beliebig viele COMMIT-Aufrufe auf derselben Verbindung.
function buildTestMiddleware(sessionUserId: string | null) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).session = { userId: sessionUserId, organizationId: orgId };
    if (!sessionUserId) return next();

    const client = await appPool.connect();
    try {
      // session-level (isLocal=false) — überlebt COMMITs innerhalb des Handlers
      await client.query("SELECT set_config('app.current_org', $1, false)", [orgId]);
      const orgDb = drizzle(client, { schema });

      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        // Sicherheitshalber zurücksetzen, bevor Verbindung in den Pool zurückkehrt
        client.query("SELECT set_config('app.current_org', '', false)").catch(() => {}).finally(() => client.release());
      };
      res.on('finish', release);
      res.on('close',  release);

      orgContext.run({ organizationId: orgId, db: orgDb, client }, next);
    } catch (err) {
      client.release();
      next(err);
    }
  };
}

function buildApp(sessionUserId: string | null) {
  const app = express();
  app.use(express.json());
  app.use(buildTestMiddleware(sessionUserId));
  app.use(tenantRoutes);
  app.use(richtwertRoutes);
  return app;
}

const authApp = buildApp(userId);
const anonApp = buildApp(null);

// ── Seed & Cleanup ────────────────────────────────────────────────────────────

async function seed() {
  await rootDb.execute(sql`
    INSERT INTO organizations (id, name, created_at)
    VALUES (${orgId}::uuid, 'LZ-Test-Org-193', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO profiles (id, email, organization_id, created_at)
    VALUES (${userId}::uuid, ${'lz-t193-' + runTag + '@example.com'}, ${orgId}::uuid, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO user_roles (user_id, role)
    VALUES (${userId}::uuid, 'property_manager')
    ON CONFLICT DO NOTHING
  `);

  await rootDb.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, bundesland, mietrecht_typ, created_at)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'LZ193-Prop', 'Musterstr. 1', 'Wien', '1010', 'Wien', 'richtwert', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  // unit 1: for the main PATCH tests (has active lease)
  await rootDb.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status, flaeche, created_at)
    VALUES (${unitId}::uuid, ${propId}::uuid, 'T1', 'wohnung', 'aktiv', 75, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, mietbeginn, grundmiete, created_at)
    VALUES (${tenantId}::uuid, ${unitId}::uuid, 'Karl', 'Lage', 'k.lage@t.at', 'aktiv', '2024-01-01', 520, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  const lRes = await rootDb.execute(sql`
    INSERT INTO leases (id, tenant_id, unit_id, start_date, end_date, grundmiete, status, befristet, created_at)
    VALUES (gen_random_uuid(), ${tenantId}::uuid, ${unitId}::uuid,
            '2024-01-01', NULL, 520, 'aktiv', false, NOW())
    RETURNING id
  `);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  leaseId = (lRes.rows[0] as any).id as string;

  // unit 2: for POST-create test (no pre-existing tenant — POST creates it)
  await rootDb.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status, flaeche, created_at)
    VALUES (${unitId2}::uuid, ${propId}::uuid, 'T2', 'wohnung', 'aktiv', 75, NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  // unit 3 + tenant3: for PATCH-without-active-lease test (no lease pre-seeded)
  await rootDb.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status, flaeche, created_at)
    VALUES (${unitId3}::uuid, ${propId}::uuid, 'T3', 'wohnung', 'aktiv', 75, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, mietbeginn, grundmiete, created_at)
    VALUES (${tenantId3}::uuid, ${unitId3}::uuid, 'Leas', 'Los', 'leaslos@t.at', 'aktiv', '2024-01-01', 520, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
}

async function cleanup() {
  // Clean up POST-created tenant if it was created
  if (postCreatedTenantId) {
    await rootDb.execute(sql`DELETE FROM leases  WHERE tenant_id = ${postCreatedTenantId}::uuid`);
    await rootDb.execute(sql`DELETE FROM tenants  WHERE id = ${postCreatedTenantId}::uuid`);
  }
  // Clean up PATCH-no-lease tenant
  await rootDb.execute(sql`DELETE FROM leases  WHERE tenant_id = ${tenantId3}::uuid`);
  await rootDb.execute(sql`DELETE FROM tenants  WHERE id = ${tenantId3}::uuid`);
  // Clean up main test tenant
  await rootDb.execute(sql`DELETE FROM leases  WHERE tenant_id = ${tenantId}::uuid`);
  await rootDb.execute(sql`DELETE FROM tenants  WHERE id = ${tenantId}::uuid`);
  // Units
  await rootDb.execute(sql`DELETE FROM units    WHERE id = ${unitId}::uuid`);
  await rootDb.execute(sql`DELETE FROM units    WHERE id = ${unitId2}::uuid`);
  await rootDb.execute(sql`DELETE FROM units    WHERE id = ${unitId3}::uuid`);
  await rootDb.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
  await rootDb.execute(sql`DELETE FROM user_roles  WHERE user_id = ${userId}::uuid`);
  await rootDb.execute(sql`DELETE FROM profiles  WHERE id = ${userId}::uuid`);
  await rootDb.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Lagezuschlag / Abschläge — PATCH tenant → mrg-check E2E', () => {
  beforeAll(async () => { await seed(); });
  afterAll(async () => { await cleanup(); });

  // ── Auth ──────────────────────────────────────────────────────────────────

  test('nicht authentifiziert → 401 bei PATCH', async () => {
    const res = await request(anonApp)
      .patch(`/api/tenants/${tenantId}`)
      .send({ lagezuschlag: 10 });
    expect(res.status).toBe(401);
  });

  // ── GET liefert Lease-Werte ───────────────────────────────────────────────

  test('GET /api/tenants/:id liefert lagezuschlag=null und abschlaege=null vor Ersterfassung', async () => {
    const res = await request(authApp).get(`/api/tenants/${tenantId}`);
    expect(res.status).toBe(200);
    expect(res.body.lagezuschlag).toBeNull();
    expect(res.body.abschlaege).toBeNull();
  });

  // ── Baseline mrg-check ────────────────────────────────────────────────────

  test('[L0] Ohne Lagezuschlag/Abschläge: Grundmiete 520 > HMZ 500,25 → überschritten', async () => {
    const res = await request(authApp).get(`/api/tenants/${tenantId}/mrg-check`);
    expect(res.status).toBe(200);
    expect(res.body.ueberschritten).toBe(true);
    expect(res.body.zulassigerHmz).toBeCloseTo(500.25, 1);
  });

  // ── Validierung: ungültige Werte → 400 ───────────────────────────────────

  test('lagezuschlag negativ (< 0) → 400', async () => {
    const res = await request(authApp)
      .patch(`/api/tenants/${tenantId}`)
      .send({ lagezuschlag: -0.5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lagezuschlag/i);
  });

  test('abschlaege positiv (> 0) → 400', async () => {
    const res = await request(authApp)
      .patch(`/api/tenants/${tenantId}`)
      .send({ abschlaege: 0.5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/abschlaege/i);
  });

  // ── PATCH speichert Lagezuschlag → mrg-check ändert sich ─────────────────

  test('[L1] PATCH lagezuschlag=0.50 €/m²: GET liefert Wert, mrg-check HMZ steigt auf 537,75 → nicht mehr überschritten', async () => {
    const patchRes = await request(authApp)
      .patch(`/api/tenants/${tenantId}`)
      .send({ lagezuschlag: 0.50 });
    expect(patchRes.status).toBe(200);
    // Response liefert aktualisierten Wert
    expect(Number(patchRes.body.lagezuschlag)).toBeCloseTo(0.50, 2);

    // GET gibt den neuen Wert zurück
    const getRes = await request(authApp).get(`/api/tenants/${tenantId}`);
    expect(getRes.status).toBe(200);
    expect(Number(getRes.body.lagezuschlag)).toBeCloseTo(0.50, 2);

    // mrg-check: HMZ = (6,67 + 0,50) × 75 = 537,75 > Grundmiete 520 nicht mehr
    const checkRes = await request(authApp).get(`/api/tenants/${tenantId}/mrg-check`);
    expect(checkRes.status).toBe(200);
    expect(checkRes.body.ueberschritten).toBe(false);
    expect(checkRes.body.zulassigerHmz).toBeCloseTo(537.75, 1);
  });

  // ── PATCH speichert Abschläge → mrg-check ändert sich ────────────────────

  test('[L2] PATCH abschlaege=-0.50 €/m²: HMZ sinkt auf 500,25 → wieder überschritten', async () => {
    const patchRes = await request(authApp)
      .patch(`/api/tenants/${tenantId}`)
      .send({ abschlaege: -0.50 });
    expect(patchRes.status).toBe(200);
    expect(Number(patchRes.body.abschlaege)).toBeCloseTo(-0.50, 2);

    // HMZ = (6,67 + 0,50 − 0,50) × 75 = 6,67 × 75 = 500,25 → 520 > 500,25 überschritten
    const checkRes = await request(authApp).get(`/api/tenants/${tenantId}/mrg-check`);
    expect(checkRes.status).toBe(200);
    expect(checkRes.body.ueberschritten).toBe(true);
    expect(checkRes.body.zulassigerHmz).toBeCloseTo(500.25, 1);
  });

  // ── PATCH löscht Wert (null) ──────────────────────────────────────────────

  test('[L3] PATCH lagezuschlag=null: zurück auf null, HMZ sinkt auf Basis+Abschlag (462,75)', async () => {
    const patchRes = await request(authApp)
      .patch(`/api/tenants/${tenantId}`)
      .send({ lagezuschlag: null });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.lagezuschlag).toBeNull();

    // HMZ = (6,67 + 0 − 0,50) × 75 = 6,17 × 75 = 462,75
    const checkRes = await request(authApp).get(`/api/tenants/${tenantId}/mrg-check`);
    expect(checkRes.status).toBe(200);
    expect(checkRes.body.zulassigerHmz).toBeCloseTo(462.75, 1);
  });

  // ── POST /api/tenants: Neuanlage mit Lagezuschlag ─────────────────────────

  test('[P1] POST /api/tenants mit lagezuschlag=0.50 €/m²: Response + GET + mrg-check korrekt', async () => {
    const postRes = await request(authApp)
      .post('/api/tenants')
      .send({
        unit_id:       unitId2,
        first_name:    'Post',
        last_name:     'LageTest',
        status:        'aktiv',
        mietbeginn:    '2024-01-01',
        grundmiete:    520,
        lagezuschlag:  0.50,
      });
    expect(postRes.status).toBe(200);
    expect(Number(postRes.body.lagezuschlag)).toBeCloseTo(0.50, 2);

    postCreatedTenantId = postRes.body.id as string;
    expect(postCreatedTenantId).toBeTruthy();

    // GET muss lagezuschlag aus dem Lease zurückliefern
    const getRes = await request(authApp).get(`/api/tenants/${postCreatedTenantId}`);
    expect(getRes.status).toBe(200);
    expect(Number(getRes.body.lagezuschlag)).toBeCloseTo(0.50, 2);

    // mrg-check: HMZ = (6,67 + 0,50) × 75 = 537,75 → 520 nicht mehr überschritten
    const checkRes = await request(authApp).get(`/api/tenants/${postCreatedTenantId}/mrg-check`);
    expect(checkRes.status).toBe(200);
    expect(checkRes.body.ueberschritten).toBe(false);
    expect(checkRes.body.zulassigerHmz).toBeCloseTo(537.75, 1);
  });

  // ── PATCH ohne aktiven Lease: neuer Lease wird mit Lagezuschlag angelegt ──

  test('[NL1] PATCH mit lagezuschlag=0.50 €/m² ohne Lease: legt Lease an, mrg-check berücksichtigt Zuschlag', async () => {
    // tenant3 hat keinen Lease — PATCH soll einen anlegen
    const patchRes = await request(authApp)
      .patch(`/api/tenants/${tenantId3}`)
      .send({ lagezuschlag: 0.50 });
    expect(patchRes.status).toBe(200);
    expect(Number(patchRes.body.lagezuschlag)).toBeCloseTo(0.50, 2);

    // GET liefert lagezuschlag aus dem neu angelegten Lease
    const getRes = await request(authApp).get(`/api/tenants/${tenantId3}`);
    expect(getRes.status).toBe(200);
    expect(Number(getRes.body.lagezuschlag)).toBeCloseTo(0.50, 2);

    // mrg-check: HMZ = (6,67 + 0,50) × 75 = 537,75 → 520 nicht mehr überschritten
    const checkRes = await request(authApp).get(`/api/tenants/${tenantId3}/mrg-check`);
    expect(checkRes.status).toBe(200);
    expect(checkRes.body.ueberschritten).toBe(false);
    expect(checkRes.body.zulassigerHmz).toBeCloseTo(537.75, 1);
  });
});
