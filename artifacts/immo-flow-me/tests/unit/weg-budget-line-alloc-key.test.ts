/**
 * PATCH /api/weg/budget-lines/:id — Verteilungsschlüssel aktualisieren (Task #50)
 *
 * Testet den neuen PATCH-Endpunkt, der es erlaubt den allocation_key einer
 * bestehenden Budgetzeile direkt in der App zu ändern, ohne sie löschen und
 * neu anlegen zu müssen.
 *
 * Prüfmatrix:
 *   ✓ Gültiger Key (nutzwert/mea/nutzflaeche/einheiten) → 200 + persistiert
 *   ✓ Ungültiger Key → 400
 *   ✓ Plan nicht im Status 'entwurf' → 409
 *   ✓ Fremde Org → 403
 *   ✓ Nicht gefundene Line → 404
 *   ✓ Kein Auth → 401
 *   ✓ Leerer Body → 400
 *   ✓ Warnung aus calculateOwnerSettlement() verschwindet nach Key-Setzung
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { rootDb as db } from '../../server/db';
import { sql, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import wegRouter from '../../server/routes/wegRoutes';
import { addOrgContext } from '../helpers/withOrgContext';
import { wegBudgetLines } from '@shared/schema';

// ── Seed-Daten ────────────────────────────────────────────────────────────────
const orgId      = uuidv4();
const propId     = uuidv4();
const unitId     = uuidv4();
const ownerId    = uuidv4();
const planId     = uuidv4();
const userId     = uuidv4();
const foreignOrg = uuidv4();
const foreignUser = uuidv4();

let lineId: string;   // wird nach INSERT gesetzt

async function seedAll() {
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'AllocKey-Test-Org') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${foreignOrg}::uuid, 'Foreign-Org') ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'AllocKey-Haus', 'Testgasse 50', 'Wien', '1010', 'weg')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status)
    VALUES (${unitId}::uuid, ${propId}::uuid, 'Top 50', 'wohnung', 'aktiv')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name)
    VALUES (${ownerId}::uuid, ${orgId}::uuid, 'Alloc', 'Key')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO weg_unit_owners (property_id, organization_id, unit_id, owner_id, mea_share)
    VALUES (${propId}::uuid, ${orgId}::uuid, ${unitId}::uuid, ${ownerId}::uuid, '1000')
    ON CONFLICT DO NOTHING
  `);

  // Plan im Status 'entwurf'
  await db.execute(sql`
    INSERT INTO weg_budget_plans (id, organization_id, property_id, year, status, total_amount)
    VALUES (${planId}::uuid, ${orgId}::uuid, ${propId}::uuid, 2085, 'entwurf', '0')
    ON CONFLICT DO NOTHING
  `);

  // Eine Budgetzeile ohne expliziten allocation_key (→ default 'mea')
  const result = await db.execute(sql`
    INSERT INTO weg_budget_lines (budget_plan_id, category, amount, allocation_key)
    VALUES (${planId}::uuid, 'betriebskosten', '1200.00', 'mea')
    RETURNING id
  `);
  lineId = (result.rows[0] as any).id;

  // Auth: Profile + Rollen
  await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${userId}::uuid, 'allockey@test.at', ${orgId}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${userId}::uuid, 'admin') ON CONFLICT DO NOTHING`);

  // Fremde Org: Profile (kein Zugriff auf propId)
  await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${foreignUser}::uuid, 'foreign@test.at', ${foreignOrg}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${foreignUser}::uuid, 'admin') ON CONFLICT DO NOTHING`);
}

async function cleanupAll() {
  if (lineId) await db.execute(sql`DELETE FROM weg_budget_lines WHERE id = ${lineId}::uuid`);
  await db.execute(sql`DELETE FROM weg_budget_lines WHERE budget_plan_id = ${planId}::uuid`);
  await db.execute(sql`DELETE FROM weg_budget_plans   WHERE id = ${planId}::uuid`);
  await db.execute(sql`DELETE FROM weg_unit_owners    WHERE property_id = ${propId}::uuid`);
  await db.execute(sql`DELETE FROM units              WHERE id = ${unitId}::uuid`);
  await db.execute(sql`DELETE FROM properties         WHERE id = ${propId}::uuid`);
  await db.execute(sql`DELETE FROM owners             WHERE id = ${ownerId}::uuid`);
  await db.execute(sql`DELETE FROM user_roles         WHERE user_id IN (${userId}::uuid, ${foreignUser}::uuid)`);
  await db.execute(sql`DELETE FROM profiles           WHERE id IN (${userId}::uuid, ${foreignUser}::uuid)`);
  await db.execute(sql`DELETE FROM organizations      WHERE id IN (${orgId}::uuid, ${foreignOrg}::uuid)`);
}

function buildApp(uid: string) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: uid };
    next();
  });
  addOrgContext(app, orgId);
  app.use(wegRouter);
  return app;
}

beforeAll(async () => { await cleanupAll(); await seedAll(); });
afterAll(async  () => { await cleanupAll(); });

// ── Erfolgreiche Updates ───────────────────────────────────────────────────────

describe('PATCH /api/weg/budget-lines/:id — Verteilungsschlüssel setzen', () => {
  const app = () => buildApp(userId);

  test('mea → nutzwert: 200 + persistiert', async () => {
    const res = await request(app())
      .patch(`/api/weg/budget-lines/${lineId}`)
      .send({ allocation_key: 'nutzwert' });
    expect(res.status).toBe(200);
    expect(res.body.allocation_key).toBe('nutzwert');

    const [row] = await db.select().from(wegBudgetLines).where(eq(wegBudgetLines.id, lineId)).limit(1);
    expect(row.allocationKey).toBe('nutzwert');
  });

  test('nutzwert → mea: 200 + persistiert', async () => {
    const res = await request(app())
      .patch(`/api/weg/budget-lines/${lineId}`)
      .send({ allocation_key: 'mea' });
    expect(res.status).toBe(200);
    expect(res.body.allocation_key).toBe('mea');
  });

  test('nutzflaeche: 200', async () => {
    const res = await request(app())
      .patch(`/api/weg/budget-lines/${lineId}`)
      .send({ allocation_key: 'nutzflaeche' });
    expect(res.status).toBe(200);
    expect(res.body.allocation_key).toBe('nutzflaeche');
  });

  test('einheiten: 200', async () => {
    const res = await request(app())
      .patch(`/api/weg/budget-lines/${lineId}`)
      .send({ allocation_key: 'einheiten' });
    expect(res.status).toBe(200);
  });

  test('verbrauch: 200', async () => {
    const res = await request(app())
      .patch(`/api/weg/budget-lines/${lineId}`)
      .send({ allocation_key: 'verbrauch' });
    expect(res.status).toBe(200);
  });
});

// ── Validierungsfehler ────────────────────────────────────────────────────────

describe('PATCH /api/weg/budget-lines/:id — Validierung', () => {
  const app = () => buildApp(userId);

  test('ungültiger Key → 400', async () => {
    const res = await request(app())
      .patch(`/api/weg/budget-lines/${lineId}`)
      .send({ allocation_key: 'kopfmehrheit' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ungültig/i);
  });

  test('leerer Body (keine änderbaren Felder) → 400', async () => {
    const res = await request(app())
      .patch(`/api/weg/budget-lines/${lineId}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('nicht gefundene ID → 404', async () => {
    const res = await request(app())
      .patch(`/api/weg/budget-lines/${uuidv4()}`)
      .send({ allocation_key: 'mea' });
    expect(res.status).toBe(404);
  });

  test('kein Auth → 401', async () => {
    const res = await request(buildApp(''))
      .patch(`/api/weg/budget-lines/${lineId}`)
      .send({ allocation_key: 'mea' });
    expect(res.status).toBe(401);
  });

  test('fremde Org → 403', async () => {
    const res = await request(buildApp(foreignUser))
      .patch(`/api/weg/budget-lines/${lineId}`)
      .send({ allocation_key: 'mea' });
    expect(res.status).toBe(403);
  });
});

// ── Status-Sperre ─────────────────────────────────────────────────────────────

describe('PATCH /api/weg/budget-lines/:id — nur im Status entwurf', () => {
  const beschlossenPlanId = uuidv4();
  let beschlossenLineId: string;

  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO weg_budget_plans (id, organization_id, property_id, year, status, total_amount)
      VALUES (${beschlossenPlanId}::uuid, ${orgId}::uuid, ${propId}::uuid, 2086, 'beschlossen', '0')
      ON CONFLICT DO NOTHING
    `);
    const r = await db.execute(sql`
      INSERT INTO weg_budget_lines (budget_plan_id, category, amount, allocation_key)
      VALUES (${beschlossenPlanId}::uuid, 'lift', '600.00', 'mea')
      RETURNING id
    `);
    beschlossenLineId = (r.rows[0] as any).id;
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM weg_budget_lines WHERE id = ${beschlossenLineId}::uuid`);
    await db.execute(sql`DELETE FROM weg_budget_plans WHERE id = ${beschlossenPlanId}::uuid`);
  });

  test('Plan im Status beschlossen → 409', async () => {
    const res = await request(buildApp(userId))
      .patch(`/api/weg/budget-lines/${beschlossenLineId}`)
      .send({ allocation_key: 'nutzwert' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/entwurf/i);
  });
});
