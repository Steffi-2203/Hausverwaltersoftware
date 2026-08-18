/**
 * Task #169: Doppelte Budget-Kategorien im Wirtschaftsplan verhindern
 *
 * Prüfmatrix:
 *   POST /api/weg/budget-lines
 *     ✓ Erste Zeile mit Kategorie → 200 (angelegt)
 *     ✓ Zweite Zeile gleiche Kategorie (exakt) → 409 mit Hinweis
 *     ✓ Zweite Zeile gleiche Kategorie (Großschreibung) → 409 (case-insensitiv)
 *     ✓ Zweite Zeile andere Kategorie → 200 (erlaubt)
 *     ✓ Plan im Status 'beschlossen' → 409
 *
 *   PATCH /api/weg/budget-lines/:id
 *     ✓ Kategorie auf bestehende andere Kategorie ändern → 409
 *     ✓ Kategorie auf eigene (unveränderte) Kategorie setzen → 200 (kein Selbst-Konflikt)
 *     ✓ Kategorie auf freie Kategorie ändern → 200
 *
 *   DB-Ebene
 *     ✓ Direktes INSERT mit Duplikat verletzt Unique-Index
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

// ── Fixtures ─────────────────────────────────────────────────────────────────

const orgId   = uuidv4();
const propId  = uuidv4();
const unitId  = uuidv4();
const ownerId = uuidv4();
const planId  = uuidv4();   // status = entwurf
const planBeschlossen = uuidv4(); // status = beschlossen
const userId  = uuidv4();

let lineIdA: string;  // 'betriebskosten'
let lineIdB: string;  // 'reparatur'

async function seedAll() {
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'DupCat-Org') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'DupCat-Haus', 'Musterstr. 1', 'Wien', '1010', 'weg')
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status)
    VALUES (${unitId}::uuid, ${propId}::uuid, 'Top 1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name)
    VALUES (${ownerId}::uuid, ${orgId}::uuid, 'Max', 'Dup') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO weg_unit_owners (property_id, organization_id, unit_id, owner_id, mea_share)
    VALUES (${propId}::uuid, ${orgId}::uuid, ${unitId}::uuid, ${ownerId}::uuid, '1000') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO weg_budget_plans (id, organization_id, property_id, year, status, total_amount)
    VALUES (${planId}::uuid, ${orgId}::uuid, ${propId}::uuid, 2086, 'entwurf', '0') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO weg_budget_plans (id, organization_id, property_id, year, status, total_amount)
    VALUES (${planBeschlossen}::uuid, ${orgId}::uuid, ${propId}::uuid, 2087, 'beschlossen', '0') ON CONFLICT DO NOTHING`);

  // Zwei Startzeilen im entwurf-Plan
  const r1 = await db.execute(sql`
    INSERT INTO weg_budget_lines (budget_plan_id, category, amount, allocation_key)
    VALUES (${planId}::uuid, 'betriebskosten', '500.00', 'mea') RETURNING id`);
  lineIdA = (r1.rows[0] as any).id;

  const r2 = await db.execute(sql`
    INSERT INTO weg_budget_lines (budget_plan_id, category, amount, allocation_key)
    VALUES (${planId}::uuid, 'reparatur', '300.00', 'mea') RETURNING id`);
  lineIdB = (r2.rows[0] as any).id;

  await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${userId}::uuid, 'dupcat@test.at', ${orgId}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${userId}::uuid, 'admin') ON CONFLICT DO NOTHING`);
}

async function cleanupAll() {
  await db.execute(sql`DELETE FROM weg_budget_lines WHERE budget_plan_id IN (${planId}::uuid, ${planBeschlossen}::uuid)`);
  await db.execute(sql`DELETE FROM weg_budget_plans WHERE id IN (${planId}::uuid, ${planBeschlossen}::uuid)`);
  await db.execute(sql`DELETE FROM weg_unit_owners WHERE property_id = ${propId}::uuid`);
  await db.execute(sql`DELETE FROM units WHERE id = ${unitId}::uuid`);
  await db.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
  await db.execute(sql`DELETE FROM owners WHERE id = ${ownerId}::uuid`);
  await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${userId}::uuid`);
  await db.execute(sql`DELETE FROM profiles WHERE id = ${userId}::uuid`);
  await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
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

// ── POST /api/weg/budget-lines ────────────────────────────────────────────────

describe('POST /api/weg/budget-lines — Duplikat-Schutz', () => {
  let app: ReturnType<typeof buildApp>;
  beforeAll(() => { app = buildApp(userId); });

  test('Erste Zeile mit neuer Kategorie wird angelegt', async () => {
    const res = await request(app)
      .post('/api/weg/budget-lines')
      .send({ budget_plan_id: planId, category: 'verwaltung', amount: '100.00', allocation_key: 'mea' });
    expect(res.status).toBe(200);
    // Aufräumen
    if (res.body.id) await db.execute(sql`DELETE FROM weg_budget_lines WHERE id = ${res.body.id}::uuid`);
  });

  test('Zweite Zeile mit exakt gleicher Kategorie → 409', async () => {
    const res = await request(app)
      .post('/api/weg/budget-lines')
      .send({ budget_plan_id: planId, category: 'betriebskosten', amount: '200.00', allocation_key: 'mea' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('betriebskosten');
  });

  test('Zweite Zeile mit gleicher Kategorie in Großschreibung → 409 (case-insensitiv)', async () => {
    const res = await request(app)
      .post('/api/weg/budget-lines')
      .send({ budget_plan_id: planId, category: 'Betriebskosten', amount: '200.00', allocation_key: 'mea' });
    expect(res.status).toBe(409);
  });

  test('Zeile mit anderer Kategorie wird angelegt', async () => {
    const res = await request(app)
      .post('/api/weg/budget-lines')
      .send({ budget_plan_id: planId, category: 'versicherung', amount: '150.00', allocation_key: 'mea' });
    expect(res.status).toBe(200);
    if (res.body.id) await db.execute(sql`DELETE FROM weg_budget_lines WHERE id = ${res.body.id}::uuid`);
  });

  test('Plan im Status beschlossen → 409 (darf nicht angelegt werden)', async () => {
    const res = await request(app)
      .post('/api/weg/budget-lines')
      .send({ budget_plan_id: planBeschlossen, category: 'betriebskosten', amount: '100.00', allocation_key: 'mea' });
    expect(res.status).toBe(409);
  });
});

// ── PATCH /api/weg/budget-lines/:id ──────────────────────────────────────────

describe('PATCH /api/weg/budget-lines/:id — Kategorie-Duplikat bei Umbenennung', () => {
  let app: ReturnType<typeof buildApp>;
  beforeAll(() => { app = buildApp(userId); });

  test('Kategorie auf bereits bestehende andere Kategorie → 409', async () => {
    // lineIdA = 'betriebskosten', lineIdB = 'reparatur'
    // Versuche lineIdB auf 'betriebskosten' umzubenennen → Konflikt
    const res = await request(app)
      .patch(`/api/weg/budget-lines/${lineIdB}`)
      .send({ category: 'betriebskosten' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('betriebskosten');
  });

  test('Kategorie auf eigene (unveränderte) Kategorie setzen → 200 (kein Selbst-Konflikt)', async () => {
    // lineIdA = 'betriebskosten' → umbenennen auf 'betriebskosten' (keine Änderung) → kein Konflikt
    const res = await request(app)
      .patch(`/api/weg/budget-lines/${lineIdA}`)
      .send({ category: 'betriebskosten' });
    expect(res.status).toBe(200);
  });

  test('Kategorie auf freie (neue) Kategorie → 200', async () => {
    // lineIdB = 'reparatur' → umbenennen auf 'wartung'
    const res = await request(app)
      .patch(`/api/weg/budget-lines/${lineIdB}`)
      .send({ category: 'wartung' });
    expect(res.status).toBe(200);
    // Zurücksetzen für saubere Isolierung
    await request(app).patch(`/api/weg/budget-lines/${lineIdB}`).send({ category: 'reparatur' });
  });
});

// ── DB-Ebene: Unique-Index ────────────────────────────────────────────────────

describe('DB-Ebene: Unique-Index weg_budget_lines_plan_category_unique', () => {
  test('Direktes INSERT mit Duplikat-Kategorie verletzt Unique-Index', async () => {
    let threw = false;
    try {
      await db.execute(sql`
        INSERT INTO weg_budget_lines (budget_plan_id, category, amount, allocation_key)
        VALUES (${planId}::uuid, 'betriebskosten', '1.00', 'mea')`);
    } catch (err: any) {
      threw = true;
      // Drizzle wraps the PG error; the cause or message contains the unique-violation hint
      const errText = [err?.message, err?.cause?.message, err?.cause?.code, String(err)].join(' ');
      expect(errText.toLowerCase()).toMatch(/unique|23505|duplicate/);
    }
    expect(threw).toBe(true);
    // Sicherstellen dass keine Zeile angelegt wurde
    const r = await db.execute(sql`SELECT count(*)::int AS n FROM weg_budget_lines WHERE budget_plan_id = ${planId}::uuid AND lower(category) = 'betriebskosten'`);
    expect((r.rows[0] as any).n).toBe(1);
  });

  test('Unique-Index existiert in der DB', async () => {
    const r = await db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'weg_budget_lines'
        AND indexname = 'weg_budget_lines_plan_category_unique'`);
    expect((r.rows as any[]).length).toBe(1);
  });
});
