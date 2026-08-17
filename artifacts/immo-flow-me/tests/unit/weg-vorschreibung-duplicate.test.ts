/**
 * WEG-Vorschreibungen — Race-Condition-Schutz (analog weg-settlement-duplicate.test.ts)
 *
 * Prüft:
 *  1. POST /api/weg/vorschreibungen/generate → 200 beim ersten Mal
 *  2. Zweiter Aufruf gleicher Monat → 409 (SELECT-Prüfung)
 *  3. Race: Unique-Index uq_weg_vorschreibungen_owner_month blockt einen
 *     direkten Doppel-INSERT (23505) → Handler mappt auf 409 DUPLICATE_VORSCHREIBUNG
 *  4. Zwei GLEICHZEITIGE generate-Requests → genau einer erfolgreich, der andere 409
 *  5. Anderer Monat → kein Konflikt
 *  6. Doppel-Aktivierung eines Wirtschaftsplans: Unique-Index
 *     uq_monthly_invoices_weg_plan_month verhindert doppelte Rechnungen (23505)
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { rootDb as db } from '../../server/db';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import wegRouter from '../../server/routes/wegRoutes';
import { addOrgContext } from '../helpers/withOrgContext';

// ── Testdaten-IDs ─────────────────────────────────────────────────────────────
const orgId   = uuidv4();
const userId  = uuidv4();
const propId  = uuidv4();
const ownerId = uuidv4();
const unitId  = uuidv4();
const planId  = uuidv4();

const YEAR = 2089; // unwahrscheinliches Jahr → kein Konflikt mit anderen Tests

// ── Express-Testapp ───────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organizationId: orgId };
    next();
  });
  addOrgContext(app, orgId);
  app.use(wegRouter);
  return app;
}
const app = buildApp();

// ── Seed ──────────────────────────────────────────────────────────────────────
async function seed() {
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'VorschrRace-Org') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${userId}::uuid, ${'vorschr-race-' + userId.slice(0, 8) + '@test.at'}, ${orgId}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${userId}::uuid, 'admin') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'RaceLiegenschaft', 'Racestr. 1', 'Wien', '1010', 'weg')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`INSERT INTO owners (id, organization_id, first_name, last_name) VALUES (${ownerId}::uuid, ${orgId}::uuid, 'Race', 'Owner') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO units (id, property_id, top_nummer, type, status) VALUES (${unitId}::uuid, ${propId}::uuid, 'Top 1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO weg_unit_owners (id, organization_id, property_id, unit_id, owner_id, mea_share)
    VALUES (gen_random_uuid(), ${orgId}::uuid, ${propId}::uuid, ${unitId}::uuid, ${ownerId}::uuid, '1000.0000')
    ON CONFLICT DO NOTHING
  `);
  // Wirtschaftsplan (status beschlossen → aktivierbar; für generate reicht Existenz)
  await db.execute(sql`
    INSERT INTO weg_budget_plans (id, organization_id, property_id, year, status, total_amount, reserve_contribution, management_fee, due_day)
    VALUES (${planId}::uuid, ${orgId}::uuid, ${propId}::uuid, ${YEAR}, 'beschlossen', '12000.00', '1200.00', '600.00', 5)
    ON CONFLICT DO NOTHING
  `);
}

async function cleanup() {
  try {
    await db.execute(sql`DELETE FROM monthly_invoices WHERE weg_budget_plan_id = ${planId}::uuid`);
    await db.execute(sql`DELETE FROM weg_vorschreibungen WHERE property_id = ${propId}::uuid`);
    await db.execute(sql`DELETE FROM weg_budget_lines WHERE budget_plan_id = ${planId}::uuid`);
    await db.execute(sql`DELETE FROM weg_budget_plans WHERE id = ${planId}::uuid`);
    await db.execute(sql`DELETE FROM weg_unit_owners WHERE unit_id = ${unitId}::uuid`);
    await db.execute(sql`DELETE FROM units WHERE id = ${unitId}::uuid`);
    await db.execute(sql`DELETE FROM owners WHERE id = ${ownerId}::uuid`);
    await db.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM profiles WHERE id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
  } catch (err) {
    console.warn('Cleanup-Fehler (non-fatal):', (err as Error).message);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
// Seed/Cleanup auf Datei-Ebene: beide describe-Blöcke nutzen dieselben Fixtures.
beforeAll(async () => { await seed(); });
afterAll(async () => { await cleanup(); });

describe('POST /api/weg/vorschreibungen/generate — Race-Condition-Schutz', () => {
  test('erster Aufruf: Vorschreibungen werden erstellt', async () => {
    const res = await request(app)
      .post('/api/weg/vorschreibungen/generate')
      .send({ property_id: propId, year: YEAR, month: 1 });
    expect(res.status).toBeLessThan(300);
    expect(res.body.count).toBe(1);
  });

  test('zweiter Aufruf gleicher Monat → 409 (SELECT-Prüfung)', async () => {
    const res = await request(app)
      .post('/api/weg/vorschreibungen/generate')
      .send({ property_id: propId, year: YEAR, month: 1 })
      .expect(409);
    expect(res.body.error).toContain('existieren bereits');
  });

  test('DB-Ebene: direkter Doppel-INSERT (Plan-Vorschreibung) wird geblockt (23505)', async () => {
    let code: string | undefined;
    try {
      await db.execute(sql`
        INSERT INTO weg_vorschreibungen
          (id, property_id, owner_id, unit_id, budget_plan_id, year, month, mea_share, gesamtbetrag, status, organization_id)
        VALUES
          (gen_random_uuid(), ${propId}::uuid, ${ownerId}::uuid, ${unitId}::uuid, ${planId}::uuid,
           ${YEAR}, 1, '1000.0000', '999.00', 'offen', ${orgId}::uuid)
      `);
    } catch (err: any) {
      code = err?.code ?? err?.cause?.code;
    }
    expect(code).toBe('23505');
  });

  test('Sonderumlage-Zeile (budget_plan_id NULL) im selben Monat bleibt erlaubt', async () => {
    // Sonderumlage-Fakturierung erzeugt zusätzliche Vorschreibungen ohne Plan-Bezug —
    // der partielle Unique-Index darf diese NICHT blocken.
    const extraId = uuidv4();
    await db.execute(sql`
      INSERT INTO weg_vorschreibungen
        (id, property_id, owner_id, unit_id, year, month, mea_share, gesamtbetrag, status, organization_id)
      VALUES
        (${extraId}::uuid, ${propId}::uuid, ${ownerId}::uuid, ${unitId}::uuid,
         ${YEAR}, 1, '1000.0000', '50.00', 'offen', ${orgId}::uuid)
    `);
    await db.execute(sql`DELETE FROM weg_vorschreibungen WHERE id = ${extraId}::uuid`);
  });

  test('Race: zwei gleichzeitige generate-Requests → genau ein Erfolg, ein 409', async () => {
    const MONTH = 2;
    const [r1, r2] = await Promise.all([
      request(app).post('/api/weg/vorschreibungen/generate').send({ property_id: propId, year: YEAR, month: MONTH }),
      request(app).post('/api/weg/vorschreibungen/generate').send({ property_id: propId, year: YEAR, month: MONTH }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses[0]).toBeLessThan(300);
    expect(statuses[1]).toBe(409);

    // Es darf genau EIN Satz Vorschreibungen existieren
    const rows = (await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM weg_vorschreibungen
      WHERE property_id = ${propId}::uuid AND year = ${YEAR} AND month = ${MONTH}
    `)).rows as Array<{ n: number }>;
    expect(rows[0].n).toBe(1);
  });

  test('anderer Monat → kein Konflikt', async () => {
    const res = await request(app)
      .post('/api/weg/vorschreibungen/generate')
      .send({ property_id: propId, year: YEAR, month: 3 });
    expect(res.status).toBeLessThan(300);
  });
});

describe('POST /api/weg/budget-plans/:id/activate — Doppel-Aktivierung', () => {
  test('DB-Ebene: doppelte WEG-Rechnung pro Plan+Einheit+Eigentümer+Monat wird geblockt (23505)', async () => {
    const insertInvoice = () => db.execute(sql`
      INSERT INTO monthly_invoices (unit_id, year, month, gesamtbetrag, status, weg_budget_plan_id, owner_id)
      VALUES (${unitId}::uuid, ${YEAR}, 12, '100.00', 'offen', ${planId}::uuid, ${ownerId}::uuid)
    `);
    await insertInvoice(); // erster INSERT ok
    let code: string | undefined;
    try {
      await insertInvoice();
    } catch (err: any) {
      code = err?.code ?? err?.cause?.code;
    }
    expect(code).toBe('23505');
  });

  test('zweite Aktivierung nach bestehenden Rechnungen → 409', async () => {
    const res = await request(app)
      .post(`/api/weg/budget-plans/${planId}/activate`)
      .send({})
      .expect(409);
    expect(res.body.error).toContain('bereits Vorschreibungen');
  });

  test('Race: zwei GLEICHZEITIGE Aktivierungen → genau ein Erfolg, ein 409, keine Teil-Inserts', async () => {
    // Frischer Plan mit ZWEI Eigentümern (Interleaving-Fall aus dem Review):
    // Verlierer darf keine Teilmenge von Rechnungen hinterlassen.
    const racePlanId  = uuidv4();
    const owner2Id    = uuidv4();
    const unit2Id     = uuidv4();
    try {
      await db.execute(sql`INSERT INTO owners (id, organization_id, first_name, last_name) VALUES (${owner2Id}::uuid, ${orgId}::uuid, 'Race2', 'Owner') ON CONFLICT DO NOTHING`);
      await db.execute(sql`INSERT INTO units (id, property_id, top_nummer, type, status) VALUES (${unit2Id}::uuid, ${propId}::uuid, 'Top 2', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING`);
      await db.execute(sql`
        INSERT INTO weg_unit_owners (id, organization_id, property_id, unit_id, owner_id, mea_share)
        VALUES (gen_random_uuid(), ${orgId}::uuid, ${propId}::uuid, ${unit2Id}::uuid, ${owner2Id}::uuid, '500.0000')
        ON CONFLICT DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO weg_budget_plans (id, organization_id, property_id, year, status, total_amount, reserve_contribution, management_fee, due_day)
        VALUES (${racePlanId}::uuid, ${orgId}::uuid, ${propId}::uuid, ${YEAR + 1}, 'beschlossen', '12000.00', '1200.00', '600.00', 5)
      `);

      const [r1, r2] = await Promise.all([
        request(app).post(`/api/weg/budget-plans/${racePlanId}/activate`).send({}),
        request(app).post(`/api/weg/budget-plans/${racePlanId}/activate`).send({}),
      ]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses[0]).toBeLessThan(300);
      expect(statuses[1]).toBe(409);

      // Genau 3 Eigentümer-Einheiten (2 aus diesem Test + 1 aus seed) × 12 Monate,
      // keine Duplikate/Teil-Inserts
      const owners = (await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM weg_unit_owners WHERE property_id = ${propId}::uuid
      `)).rows as Array<{ n: number }>;
      const rows = (await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM monthly_invoices WHERE weg_budget_plan_id = ${racePlanId}::uuid
      `)).rows as Array<{ n: number }>;
      expect(rows[0].n).toBe(owners[0].n * 12);

      const plan = (await db.execute(sql`
        SELECT status FROM weg_budget_plans WHERE id = ${racePlanId}::uuid
      `)).rows as Array<{ status: string }>;
      expect(plan[0].status).toBe('aktiv');
    } finally {
      await db.execute(sql`DELETE FROM monthly_invoices WHERE weg_budget_plan_id = ${racePlanId}::uuid`);
      await db.execute(sql`DELETE FROM weg_budget_plans WHERE id = ${racePlanId}::uuid`);
      await db.execute(sql`DELETE FROM weg_unit_owners WHERE unit_id = ${unit2Id}::uuid`);
      await db.execute(sql`DELETE FROM units WHERE id = ${unit2Id}::uuid`);
      await db.execute(sql`DELETE FROM owners WHERE id = ${owner2Id}::uuid`);
    }
  });
});
