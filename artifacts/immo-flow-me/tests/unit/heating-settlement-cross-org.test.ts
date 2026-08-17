/**
 * Heizkostenabrechnung Cross-Org-Schutztests (Task #139)
 *
 * Prüft dass POST /api/heating-settlements/:id/calculate (löscht + erzeugt
 * Detailzeilen) und DELETE /api/heating-settlements/:id keine Abrechnungen
 * einer fremden Organisation verändern — auch wenn der Angreifer die
 * (serielle, leicht erratbare) Settlement-ID kennt.
 *
 * Strategie analog zu write-cross-org.test.ts:
 *   - Zwei Orgs (A = Angreifer, B = Opfer), Org B hat eine Abrechnung mit
 *     einer bestehenden Detailzeile.
 *   - Express-App mit Session-Injection + RLS-Org-Kontext, echter Router.
 *   - Verifikation über rootDb (RLS-Bypass): Daten von Org B unverändert.
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';
import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { rootDb, pool, appPool, orgContext } from '../../server/db';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@shared/schema';
import heatingSettlementRouter from '../../server/routes/heatingSettlementRoutes';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const orgAId = uuidv4();
const orgBId = uuidv4();
const userAId = uuidv4();
const propertyBId = uuidv4();
const unitBId = uuidv4();

// Pro Lauf eindeutige E-Mail: verhindert ON-CONFLICT-Skips + user_roles-FK-Reste
// nach abgebrochenen Läufen (siehe Test-Seed-Muster im Projekt).
const USER_A_EMAIL = `heat-cross-org-a-${uuidv4().slice(0, 8)}@test.internal`;

let settlementBId: number; // serial — vom Insert zurückgegeben

// ── App-Builder (analog write-cross-org.test.ts) ─────────────────────────────

function buildAppAsUser(userId: string, email: string, orgId: string) {
  const app = express();
  app.use(express.json());

  app.use((req: any, _res, next) => {
    req.session = { userId, email, organizationId: orgId };
    next();
  });

  app.use((req: any, res: any, next: any) => {
    appPool.connect().then(client => {
      client.query('BEGIN')
        .then(() => client.query('SELECT set_config(\'app.current_org\', $1, true)', [orgId]))
        .then(() => {
          const orgDb = drizzle(client as any, { schema });
          req.dbClient = client;
          const cleanup = () => {
            if ((req as any)._orgClientReleased) return;
            (req as any)._orgClientReleased = true;
            const statusOk = res.statusCode < 500;
            client.query(statusOk ? 'COMMIT' : 'ROLLBACK').catch(() => {}).finally(() => client.release());
          };
          res.on('finish', cleanup);
          res.on('close', cleanup);
          orgContext.run({ organizationId: orgId, db: orgDb, client }, () => next());
        })
        .catch(err => { client.query('ROLLBACK').catch(() => {}).finally(() => client.release()); next(err); });
    }).catch(next);
  });

  app.use(heatingSettlementRouter);
  return app;
}

/**
 * App OHNE RLS: Org-Kontext mit rootDb-Client (kein SET ROLE, kein app.current_org).
 * Damit ist der explizite Org-Filter in den Handlern die EINZIGE Schranke —
 * beweist die Defense-in-Depth-Abfrage unabhängig von RLS.
 */
function buildAppAsUserNoRls(userId: string, email: string, orgId: string) {
  const app = express();
  app.use(express.json());

  app.use((req: any, _res, next) => {
    req.session = { userId, email, organizationId: orgId };
    next();
  });

  app.use((req: any, res: any, next: any) => {
    pool.connect().then((client: any) => {
      const rootClientDb = drizzle(client as any, { schema });
      req.dbClient = client;
      const cleanup = () => {
        if ((req as any)._rootClientReleased) return;
        (req as any)._rootClientReleased = true;
        client.release();
      };
      res.on('finish', cleanup);
      res.on('close', cleanup);
      orgContext.run({ organizationId: orgId, db: rootClientDb, client }, () => next());
    }).catch(next);
  });

  app.use(heatingSettlementRouter);
  return app;
}

// ── Seed / Cleanup ────────────────────────────────────────────────────────────

async function seedData() {
  await rootDb.execute(sql`
    INSERT INTO organizations (id, name, created_at)
    VALUES (${orgAId}::uuid, 'HeatScope Org A', NOW()),
           (${orgBId}::uuid, 'HeatScope Org B', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO profiles (id, email, full_name, organization_id, created_at)
    VALUES (${userAId}::uuid, ${USER_A_EMAIL}, 'Heat User A', ${orgAId}::uuid, NOW())
    ON CONFLICT DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO user_roles (user_id, role, created_at)
    VALUES (${userAId}::uuid, 'admin', NOW())
    ON CONFLICT DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, created_at)
    VALUES (${propertyBId}::uuid, ${orgBId}::uuid, 'HeatScope Prop B', 'Straße B 2', 'Graz', '8010', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status, stockwerk, zimmer, flaeche, created_at)
    VALUES (${unitBId}::uuid, ${propertyBId}::uuid, 'HEAT-B1', 'wohnung', 'aktiv', 1, 3, 70.0, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  const settlementResult: any = await rootDb.execute(sql`
    INSERT INTO heating_settlements
      (organization_id, property_id, period_start, period_end, total_cost,
       fixed_cost_share, variable_cost_share, status, created_at)
    VALUES (${orgBId}::uuid, ${propertyBId}::uuid, '2025-01-01', '2025-12-31',
            10000.00, 45, 55, 'entwurf', NOW())
    RETURNING id
  `);
  settlementBId = Number(settlementResult.rows[0].id);
  await rootDb.execute(sql`
    INSERT INTO heating_settlement_details
      (settlement_id, unit_id, tenant_name, area, consumption,
       fixed_amount, variable_amount, total_amount, prepayment, balance)
    VALUES (${settlementBId}, ${unitBId}::uuid, 'Bernd OrgB', 70.0, 1200.0,
            4500.00, 5500.00, 10000.00, 9000.00, 1000.00)
  `);
}

async function cleanupData() {
  await rootDb.execute(sql`
    DELETE FROM heating_settlement_details WHERE settlement_id IN (
      SELECT id FROM heating_settlements WHERE organization_id IN (${orgAId}::uuid, ${orgBId}::uuid)
    )
  `).catch(() => {});
  await rootDb.execute(sql`DELETE FROM heating_settlements WHERE organization_id IN (${orgAId}::uuid, ${orgBId}::uuid)`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM user_roles WHERE user_id = ${userAId}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM profiles WHERE email = ${USER_A_EMAIL}`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM units WHERE id = ${unitBId}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM properties WHERE id = ${propertyBId}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM organizations WHERE id IN (${orgAId}::uuid, ${orgBId}::uuid)`).catch(() => {});
}

async function rootRows(query: any): Promise<any[]> {
  const result: any = await rootDb.execute(query);
  return result.rows ?? [];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Heizkostenabrechnung: Cross-Org-Schutz auf calculate/delete', () => {
  beforeAll(async () => {
    await cleanupData();
    await seedData();
  });

  afterAll(async () => {
    await cleanupData();
  });

  test('Org A: POST /calculate mit Settlement-ID von Org B → 404, keine Details verändert', async () => {
    const app = buildAppAsUser(userAId, USER_A_EMAIL, orgAId);

    const res = await request(app)
      .post(`/api/heating-settlements/${settlementBId}/calculate`)
      .send({ consumptionData: [{ unitId: unitBId, consumption: 999, prepayment: 0 }] });

    expect(res.status).toBe(404);

    // Detailzeile von Org B unverändert (weder gelöscht noch neu berechnet)
    const details = await rootRows(sql`
      SELECT consumption, total_amount FROM heating_settlement_details
      WHERE settlement_id = ${settlementBId}
    `);
    expect(details.length).toBe(1);
    expect(Number(details[0].consumption)).toBe(1200);
    expect(Number(details[0].total_amount)).toBe(10000);

    // Status bleibt 'entwurf' (nicht auf 'berechnet' gesetzt)
    const settlement = await rootRows(sql`
      SELECT status FROM heating_settlements WHERE id = ${settlementBId}
    `);
    expect(settlement[0].status).toBe('entwurf');
  });

  test('Org A: GET /api/heating-settlements/:id von Org B → 404', async () => {
    const app = buildAppAsUser(userAId, USER_A_EMAIL, orgAId);
    const res = await request(app).get(`/api/heating-settlements/${settlementBId}`);
    expect(res.status).toBe(404);
  });

  test('Org A: POST create mit propertyId von Org B → 404, nichts angelegt', async () => {
    const app = buildAppAsUser(userAId, USER_A_EMAIL, orgAId);

    const res = await request(app)
      .post('/api/heating-settlements')
      .send({
        propertyId: propertyBId,
        periodStart: '2025-01-01',
        periodEnd: '2025-12-31',
        totalCost: 5000,
      });

    expect(res.status).toBe(404);
    const rows = await rootRows(sql`
      SELECT id FROM heating_settlements WHERE organization_id = ${orgAId}::uuid
    `);
    expect(rows.length).toBe(0);
  });

  test('Defense-in-Depth ohne RLS: Handler-Org-Filter allein blockt calculate → 404', async () => {
    const app = buildAppAsUserNoRls(userAId, USER_A_EMAIL, orgAId);

    const res = await request(app)
      .post(`/api/heating-settlements/${settlementBId}/calculate`)
      .send({ consumptionData: [{ unitId: unitBId, consumption: 999, prepayment: 0 }] });

    expect(res.status).toBe(404);
    const details = await rootRows(sql`
      SELECT consumption FROM heating_settlement_details WHERE settlement_id = ${settlementBId}
    `);
    expect(details.length).toBe(1);
    expect(Number(details[0].consumption)).toBe(1200);
  });

  test('Defense-in-Depth ohne RLS: Handler-Filter blockt auch POST create mit fremder Property → 404', async () => {
    const app = buildAppAsUserNoRls(userAId, USER_A_EMAIL, orgAId);

    const res = await request(app)
      .post('/api/heating-settlements')
      .send({
        propertyId: propertyBId,
        periodStart: '2025-01-01',
        periodEnd: '2025-12-31',
        totalCost: 5000,
      });

    expect(res.status).toBe(404);
    const rows = await rootRows(sql`
      SELECT id FROM heating_settlements WHERE organization_id = ${orgAId}::uuid
    `);
    expect(rows.length).toBe(0);
  });

  test('Org A: DELETE mit Settlement-ID von Org B → 404, nichts gelöscht', async () => {
    const app = buildAppAsUser(userAId, USER_A_EMAIL, orgAId);

    const res = await request(app).delete(`/api/heating-settlements/${settlementBId}`);
    expect(res.status).toBe(404);

    const settlement = await rootRows(sql`
      SELECT id FROM heating_settlements WHERE id = ${settlementBId}
    `);
    expect(settlement.length).toBe(1);
    const details = await rootRows(sql`
      SELECT id FROM heating_settlement_details WHERE settlement_id = ${settlementBId}
    `);
    expect(details.length).toBe(1);
  });
});
