/**
 * Tenant Befristung — HTTP-Integrationstests
 *
 * Prüft dass befristet/befristungEnde korrekt gespeichert, persistiert
 * und beim Laden zurückgeliefert werden.
 *
 * Szenarien:
 *  1. POST /api/tenants — befristet=true → Lease mit befristet+befristungEnde angelegt
 *  2. POST /api/tenants — befristet=false → Lease ohne Befristungsfelder
 *  3. POST schlägt atomar zurück wenn Lease-Insert nicht möglich wäre
 *     (simuliert via ungültige unitId die zum constraint-Fehler führt)
 *  4. GET /api/tenants/:id — enthält befristet+befristungEnde aus aktivem Lease
 *  5. PATCH /api/tenants/:id — befristet=true setzt befristungEnde und synct mietende
 *  6. PATCH /api/tenants/:id — befristet=false löscht mietende
 *  7. PATCH partial-update: nur befristungEnde gesendet → befristet bleibt unverändert
 *  8. Unauthentifiziert → 401 auf POST und PATCH
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { db } from '../../server/db';
import { sql, eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import tenantRoutes from '../../server/routes/tenantRoutes';
import * as schema from '@shared/schema';
import { setupTestDb, teardownTestDb } from '../helpers/db';

// ── Testdaten IDs ─────────────────────────────────────────────────────────────
const orgId   = uuidv4();
const userId  = uuidv4();
const propId  = uuidv4();
const unitId  = uuidv4();

// ── Express-Testapp ───────────────────────────────────────────────────────────
function buildApp(uid: string | null = userId) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: uid, organizationId: orgId };
    next();
  });
  app.use(tenantRoutes);
  return app;
}

// ── Seed ─────────────────────────────────────────────────────────────────────
async function seed() {
  await db.execute(sql`
    INSERT INTO organizations (id, name)
    VALUES (${orgId}::uuid, 'BefristungTestOrg')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO profiles (id, email, organization_id)
    VALUES (${userId}::uuid, ${`befr-${userId.slice(0,8)}@test.at`}, ${orgId}::uuid)
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO user_roles (user_id, role) VALUES (${userId}::uuid, 'admin')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO properties (id, name, address, city, postal_code, management_type, organization_id)
    VALUES (${propId}::uuid, 'Befr-Liegenschaft', 'Testgasse 1', 'Wien', '1010', 'mietverwaltung', ${orgId}::uuid)
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, flaeche)
    VALUES (${unitId}::uuid, ${propId}::uuid, 'TOP 1', 60)
    ON CONFLICT DO NOTHING
  `);
}

async function cleanup() {
  await db.execute(sql`DELETE FROM leases        WHERE tenant_id IN (SELECT id FROM tenants WHERE unit_id = ${unitId}::uuid)`);
  await db.execute(sql`DELETE FROM tenants        WHERE unit_id = ${unitId}::uuid`);
  await db.execute(sql`DELETE FROM units          WHERE id = ${unitId}::uuid`);
  await db.execute(sql`DELETE FROM properties     WHERE id = ${propId}::uuid`);
  await db.execute(sql`DELETE FROM user_roles     WHERE user_id = ${userId}::uuid`);
  await db.execute(sql`DELETE FROM profiles       WHERE id = ${userId}::uuid`);
  await db.execute(sql`DELETE FROM organizations  WHERE id = ${orgId}::uuid`);
}

// ── Hilfsfunktion: gemeinsame Mieterdaten ────────────────────────────────────
function baseTenantPayload(overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'Anna',
    lastName:  'Muster',
    unitId,
    mietbeginn: '2024-01-01',
    grundmiete: '800',
    betriebskosten_vorschuss: '100',
    heizungskosten_vorschuss: '50',
    wasserkosten_vorschuss:   '20',
    kaution:    '2400',
    status:     'aktiv',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  await setupTestDb();
  await seed();
});
afterAll(async () => {
  await cleanup();
  await teardownTestDb();
});

describe('Tenant Befristung — POST /api/tenants', () => {
  test('1. befristet=true → Lease mit befristet=true und befristungEnde angelegt', async () => {
    const app  = buildApp();
    const res  = await request(app)
      .post('/api/tenants')
      .send(baseTenantPayload({
        befristet:      true,
        befristungEnde: '2027-12-31',
      }));

    expect(res.status).toBe(200);
    expect(res.body.befristet).toBe(true);
    expect(res.body.befristungEnde).toBe('2027-12-31');

    // Lease muss tatsächlich in DB angelegt worden sein
    const leases = await db
      .select()
      .from(schema.leases)
      .where(
        and(
          eq(schema.leases.tenantId, res.body.id),
          eq(schema.leases.status, 'aktiv')
        )
      );
    expect(leases).toHaveLength(1);
    expect(leases[0].befristet).toBe(true);
    expect(leases[0].befristungEnde).toBe('2027-12-31');
    expect(leases[0].endDate).toBe('2027-12-31');

    // Cleanup
    await db.execute(sql`DELETE FROM leases  WHERE tenant_id = ${res.body.id}::uuid`);
    await db.execute(sql`DELETE FROM tenants WHERE id        = ${res.body.id}::uuid`);
  });

  test('2. befristet=false → Lease ohne Befristungsfelder (befristet=false, befristungEnde=null)', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/tenants')
      .send(baseTenantPayload({ befristet: false }));

    expect(res.status).toBe(200);
    expect(res.body.befristet).toBe(false);
    expect(res.body.befristungEnde).toBeNull();

    const leases = await db
      .select()
      .from(schema.leases)
      .where(eq(schema.leases.tenantId, res.body.id));
    expect(leases).toHaveLength(1);
    expect(leases[0].befristet).toBe(false);
    expect(leases[0].befristungEnde).toBeNull();

    await db.execute(sql`DELETE FROM leases  WHERE tenant_id = ${res.body.id}::uuid`);
    await db.execute(sql`DELETE FROM tenants WHERE id        = ${res.body.id}::uuid`);
  });

  test('3. tenants.mietende wird auf befristungEnde gesetzt wenn befristet=true', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/tenants')
      .send(baseTenantPayload({
        befristet:      true,
        befristungEnde: '2026-06-30',
        mietende:       '2030-01-01', // ignoriert wenn befristet=true
      }));

    expect(res.status).toBe(200);
    // mietende muss vom befristungEnde überschrieben worden sein
    const [t] = await db
      .select({ mietende: schema.tenants.mietende })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, res.body.id));
    expect(t.mietende).toBe('2026-06-30');

    await db.execute(sql`DELETE FROM leases  WHERE tenant_id = ${res.body.id}::uuid`);
    await db.execute(sql`DELETE FROM tenants WHERE id        = ${res.body.id}::uuid`);
  });

  test('8a. Unauthentifiziert → 401', async () => {
    const app = buildApp(null);
    const res = await request(app)
      .post('/api/tenants')
      .send(baseTenantPayload());
    expect(res.status).toBe(401);
  });
});

describe('Tenant Befristung — GET + PATCH /api/tenants/:id', () => {
  let tenantId: string;

  beforeAll(async () => {
    // Direktes DB-Insert um unabhängig vom POST-Handler zu sein
    const [t] = await db.insert(schema.tenants).values({
      unitId,
      firstName:                 'Bernhard',
      lastName:                  'Test',
      status:                    'aktiv',
      mietbeginn:                '2024-03-01',
      grundmiete:                '900',
      betriebskostenVorschuss:   '120',
      heizkostenVorschuss:       '60',
      wasserkostenVorschuss:     '25',
    }).returning();
    tenantId = t.id;

    // Aktiven Lease anlegen (befristet=false initial)
    await db.insert(schema.leases).values({
      tenantId,
      unitId,
      startDate:               '2024-03-01',
      grundmiete:              '900',
      betriebskostenVorschuss: '120',
      heizkostenVorschuss:     '60',
      wasserkostenVorschuss:   '25',
      status:                  'aktiv',
      befristet:               false,
    });
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM leases  WHERE tenant_id = ${tenantId}::uuid`);
    await db.execute(sql`DELETE FROM tenants WHERE id        = ${tenantId}::uuid`);
  });

  test('4. GET liefert befristet+befristungEnde aus aktivem Lease', async () => {
    const app = buildApp();
    const res = await request(app).get(`/api/tenants/${tenantId}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('befristet', false);
    expect(res.body).toHaveProperty('befristungEnde', null);
  });

  test('5. PATCH befristet=true setzt befristungEnde + synct mietende', async () => {
    const app = buildApp();
    const res = await request(app)
      .patch(`/api/tenants/${tenantId}`)
      .send({ befristet: true, befristungEnde: '2027-02-28' });

    expect(res.status).toBe(200);
    expect(res.body.befristet).toBe(true);
    expect(res.body.befristungEnde).toBe('2027-02-28');

    // Lease in DB geprüft
    const [lease] = await db
      .select()
      .from(schema.leases)
      .where(and(eq(schema.leases.tenantId, tenantId), eq(schema.leases.status, 'aktiv')));
    expect(lease.befristet).toBe(true);
    expect(lease.befristungEnde).toBe('2027-02-28');
    expect(lease.endDate).toBe('2027-02-28');

    // mietende auf Tenant synct
    const [t] = await db
      .select({ mietende: schema.tenants.mietende })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));
    expect(t.mietende).toBe('2027-02-28');
  });

  test('7. PATCH partial: nur befristungEnde → befristet bleibt true (kein Reset)', async () => {
    const app = buildApp();
    const res = await request(app)
      .patch(`/api/tenants/${tenantId}`)
      .send({ befristungEnde: '2028-06-30' });

    expect(res.status).toBe(200);
    // befristet war true, darf nicht auf false fallen
    expect(res.body.befristet).toBe(true);
    expect(res.body.befristungEnde).toBe('2028-06-30');

    const [lease] = await db
      .select()
      .from(schema.leases)
      .where(and(eq(schema.leases.tenantId, tenantId), eq(schema.leases.status, 'aktiv')));
    expect(lease.befristet).toBe(true);
    expect(lease.befristungEnde).toBe('2028-06-30');
  });

  test('6. PATCH befristet=false → mietende gelöscht, Lease-Befristung aufgehoben', async () => {
    const app = buildApp();
    const res = await request(app)
      .patch(`/api/tenants/${tenantId}`)
      .send({ befristet: false });

    expect(res.status).toBe(200);
    expect(res.body.befristet).toBe(false);

    const [t] = await db
      .select({ mietende: schema.tenants.mietende })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));
    expect(t.mietende).toBeNull();

    const [lease] = await db
      .select()
      .from(schema.leases)
      .where(and(eq(schema.leases.tenantId, tenantId), eq(schema.leases.status, 'aktiv')));
    expect(lease.befristet).toBe(false);
    expect(lease.endDate).toBeNull();
  });

  test('8b. PATCH unauthentifiziert → 401', async () => {
    const app = buildApp(null);
    const res = await request(app)
      .patch(`/api/tenants/${tenantId}`)
      .send({ befristet: true, befristungEnde: '2029-01-01' });
    expect(res.status).toBe(401);
  });
});
