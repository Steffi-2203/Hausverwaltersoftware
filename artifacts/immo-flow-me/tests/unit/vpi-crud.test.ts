/**
 * VPI-Werte CRUD — Integrationstests (Task #45)
 *
 * Testet PATCH /api/vpi/values/:id, DELETE /api/vpi/values/:id und das
 * ON-CONFLICT-Upsert-Verhalten von POST /api/vpi/values direkt gegen den
 * produktiven Router (server/routes/vpiRoutes.ts) — inklusive der echten
 * isAuthenticated- und requireRole-Middleware die gegen die DB prüft.
 *
 * Rollenszenarios:
 *   GET    — nur isAuthenticated (kein requireRole)
 *   POST   — admin oder finance
 *   PATCH  — admin oder finance
 *   DELETE — nur admin
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { rootDb as db } from '../../server/db';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import vpiCrudRouter from '../../server/routes/vpiRoutes';
import { addOrgContext } from '../helpers/withOrgContext';
import { acquireVpiTestLock, releaseVpiTestLock } from '../helpers/vpiTestLock';

// ── Testnutzer-IDs ─────────────────────────────────────────────────────────────
const adminId   = uuidv4();
const financeId = uuidv4();
const viewerId  = uuidv4(); // hat keine admin/finance-Rolle
const orgId     = uuidv4(); // gemeinsame Org für alle Test-Nutzer

// Wir nutzen Jahre die unwahrscheinlich mit Produktionsdaten kollidieren
const BASE_YEAR = 2085;

// ── App-Bauhelfer ─────────────────────────────────────────────────────────────
// Baut eine Express-App mit dem echten vpiCrudRouter.
// uid = null → kein gültiger userId in der Session → isAuthenticated → 401
function buildApp(uid: string | null) {
  const app = express();
  app.use(express.json());
  // Session-Injektion: isAuthenticated prüft req.session?.userId
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = uid ? { userId: uid, organizationId: orgId } : {};
    next();
  });
  addOrgContext(app, uid ? orgId : null);
  app.use(vpiCrudRouter);
  return app;
}

// ── Seed & Cleanup ─────────────────────────────────────────────────────────────
async function seed() {
  // Org (alle drei Nutzer teilen sich eine Org — für VPI nicht relevant,
  // aber profiles braucht organization_id; orgId ist module-level definiert)
  await db.execute(sql`
    INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'VPI-CRUD-Test-Org')
    ON CONFLICT DO NOTHING
  `);
  for (const [uid, email] of [
    [adminId,   `vpi-crud-admin-${adminId.slice(0,8)}@test.at`],
    [financeId, `vpi-crud-finance-${financeId.slice(0,8)}@test.at`],
    [viewerId,  `vpi-crud-viewer-${viewerId.slice(0,8)}@test.at`],
  ]) {
    await db.execute(sql`
      INSERT INTO profiles (id, email, organization_id)
      VALUES (${uid}::uuid, ${email}, ${orgId}::uuid)
      ON CONFLICT DO NOTHING
    `);
  }
  // Rollen vergeben
  await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${adminId}::uuid,   'admin')   ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${financeId}::uuid, 'finance') ON CONFLICT DO NOTHING`);
  // viewer bekommt keine admin/finance-Rolle → nur Lesezugriff auf GET
}

async function cleanup() {
  await db.execute(sql`DELETE FROM vpi_values WHERE year BETWEEN ${BASE_YEAR} AND ${BASE_YEAR + 9}`);
  await db.execute(sql`DELETE FROM user_roles WHERE user_id IN (${adminId}::uuid, ${financeId}::uuid, ${viewerId}::uuid)`);
  await db.execute(sql`DELETE FROM profiles   WHERE id       IN (${adminId}::uuid, ${financeId}::uuid, ${viewerId}::uuid)`);
}

// ── Hilfsfunktion: Wert direkt in DB anlegen ───────────────────────────────────
async function insertVpi(year: number, month: number, value: number, source = 'test') {
  const r = await db.execute(sql`
    INSERT INTO vpi_values (year, month, value, source)
    VALUES (${year}, ${month}, ${value}, ${source})
    ON CONFLICT (year, month) DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source
    RETURNING id, year, month, value::float, source
  `);
  return r.rows[0] as { id: string; year: number; month: number; value: number; source: string };
}

// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => { await acquireVpiTestLock(); await cleanup(); await seed(); });
afterAll(async  () => { await cleanup(); await releaseVpiTestLock(); });

// ─────────────────────────────────────────────────────────────────────────────
describe('Zugangskontrolle (isAuthenticated + requireRole)', () => {
  test('GET  — kein userId in Session → 401', async () => {
    await request(buildApp(null)).get('/api/vpi/values').expect(401);
  });

  test('GET  — viewer (keine admin/finance-Rolle) → 200 (GET braucht nur Auth)', async () => {
    await request(buildApp(viewerId)).get('/api/vpi/values').expect(200);
  });

  test('POST — viewer → 403', async () => {
    await request(buildApp(viewerId))
      .post('/api/vpi/values')
      .send({ year: BASE_YEAR, month: 1, value: 100 })
      .expect(403);
  });

  test('POST — finance-User → erlaubt (kein 403)', async () => {
    const res = await request(buildApp(financeId))
      .post('/api/vpi/values')
      .send({ year: BASE_YEAR, month: 2, value: 101, source: 'test' })
      .expect(200);
    expect(res.body).toHaveProperty('id');
  });

  test('PATCH — viewer → 403', async () => {
    const row = await insertVpi(BASE_YEAR, 3, 102);
    await request(buildApp(viewerId))
      .patch(`/api/vpi/values/${row.id}`)
      .send({ value: 103 })
      .expect(403);
  });

  test('DELETE — finance-User → 403 (nur admin darf löschen)', async () => {
    const row = await insertVpi(BASE_YEAR, 4, 104);
    await request(buildApp(financeId))
      .delete(`/api/vpi/values/${row.id}`)
      .expect(403);
    // Wert noch vorhanden
    const check = await db.execute(sql`SELECT id FROM vpi_values WHERE id = ${row.id}::uuid`);
    expect(check.rows).toHaveLength(1);
  });

  test('DELETE — kein userId in Session → 401', async () => {
    const row = await insertVpi(BASE_YEAR, 5, 105);
    await request(buildApp(null))
      .delete(`/api/vpi/values/${row.id}`)
      .expect(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PATCH /api/vpi/values/:id', () => {
  test('aktualisiert value → 200 mit aktualisierten Daten', async () => {
    const row = await insertVpi(BASE_YEAR + 1, 1, 120);
    const res = await request(buildApp(adminId))
      .patch(`/api/vpi/values/${row.id}`)
      .send({ value: 125.5 })
      .expect(200);

    expect(parseFloat(res.body.value)).toBeCloseTo(125.5, 2);
    expect(res.body.id).toBe(row.id);

    // DB-Verifizierung
    const dbr = await db.execute(sql`SELECT value::float FROM vpi_values WHERE id = ${row.id}::uuid`);
    expect(parseFloat((dbr.rows[0] as any).value)).toBeCloseTo(125.5, 2);
  });

  test('aktualisiert value + source gleichzeitig', async () => {
    const row = await insertVpi(BASE_YEAR + 1, 2, 130);
    const res = await request(buildApp(adminId))
      .patch(`/api/vpi/values/${row.id}`)
      .send({ value: 132, source: 'statistik.at' })
      .expect(200);

    expect(parseFloat(res.body.value)).toBeCloseTo(132, 2);
    expect(res.body.source).toBe('statistik.at');
  });

  test('behält bestehende source wenn keine neue angegeben (COALESCE)', async () => {
    const row = await insertVpi(BASE_YEAR + 1, 3, 140, 'statistik.at');
    const res = await request(buildApp(adminId))
      .patch(`/api/vpi/values/${row.id}`)
      .send({ value: 142 }) // kein source
      .expect(200);

    expect(res.body.source).toBe('statistik.at');
  });

  test('value fehlt im Body → 400', async () => {
    const row = await insertVpi(BASE_YEAR + 1, 4, 150);
    await request(buildApp(adminId))
      .patch(`/api/vpi/values/${row.id}`)
      .send({ source: 'test' })
      .expect(400);
  });

  test('nicht existierende ID → 404', async () => {
    await request(buildApp(adminId))
      .patch(`/api/vpi/values/${uuidv4()}`)
      .send({ value: 100 })
      .expect(404);
  });

  test('finance-User darf PATCH', async () => {
    const row = await insertVpi(BASE_YEAR + 1, 5, 160);
    const res = await request(buildApp(financeId))
      .patch(`/api/vpi/values/${row.id}`)
      .send({ value: 161 })
      .expect(200);
    expect(parseFloat(res.body.value)).toBeCloseTo(161, 2);
  });

  test('updated_at wird nach PATCH aktualisiert', async () => {
    const row = await insertVpi(BASE_YEAR + 1, 6, 170);
    const before = new Date().toISOString();
    const res = await request(buildApp(adminId))
      .patch(`/api/vpi/values/${row.id}`)
      .send({ value: 171 })
      .expect(200);
    expect(new Date(res.body.updated_at).toISOString() >= before).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /api/vpi/values/:id', () => {
  test('admin löscht den Wert → { success: true }', async () => {
    const row = await insertVpi(BASE_YEAR + 2, 1, 200);
    const res = await request(buildApp(adminId))
      .delete(`/api/vpi/values/${row.id}`)
      .expect(200);
    expect(res.body.success).toBe(true);

    // DB-Verifizierung
    const dbr = await db.execute(sql`SELECT id FROM vpi_values WHERE id = ${row.id}::uuid`);
    expect(dbr.rows).toHaveLength(0);
  });

  test('nicht existierende ID → 404', async () => {
    await request(buildApp(adminId))
      .delete(`/api/vpi/values/${uuidv4()}`)
      .expect(404);
  });

  test('gelöschter Wert erscheint nicht mehr in GET /api/vpi/values', async () => {
    const row = await insertVpi(BASE_YEAR + 2, 2, 201);

    const before = await request(buildApp(adminId)).get('/api/vpi/values').expect(200);
    expect((before.body as any[]).some((v: any) => v.id === row.id)).toBe(true);

    await request(buildApp(adminId)).delete(`/api/vpi/values/${row.id}`).expect(200);

    const after = await request(buildApp(adminId)).get('/api/vpi/values').expect(200);
    expect((after.body as any[]).some((v: any) => v.id === row.id)).toBe(false);
  });

  // ── Referenz-Check: 409 wenn Mietvertrag vpi_base referenziert ────────────
  test('DELETE → 409 wenn ein aktiver Mieter diesen Wert als vpi_base trägt', async () => {
    // Eindeutiger Testwert der nicht anderweitig vorkommt
    const UNIQUE_VPI = 98765.43;
    const vpiRow = await insertVpi(BASE_YEAR + 6, 1, UNIQUE_VPI);

    // Minimales Fixture: Org → Property → Unit → Tenant mit vpi_base = UNIQUE_VPI
    const refOrgId  = uuidv4();
    const refPropId = uuidv4();
    const refUnitId = uuidv4();
    const refTenId  = uuidv4();
    try {
      await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${refOrgId}::uuid, 'VpiRefOrg') ON CONFLICT DO NOTHING`);
      await db.execute(sql`
        INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
        VALUES (${refPropId}::uuid, ${refOrgId}::uuid, 'RefProp', 'Str 1', 'Wien', '1010', 'mietverwaltung')
        ON CONFLICT DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO units (id, property_id, top_nummer, type, status)
        VALUES (${refUnitId}::uuid, ${refPropId}::uuid, 'T1', 'wohnung', 'aktiv')
        ON CONFLICT DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO tenants (id, unit_id, first_name, last_name, vpi_base)
        VALUES (${refTenId}::uuid, ${refUnitId}::uuid, 'VPI', 'Ref', ${String(UNIQUE_VPI)})
        ON CONFLICT DO NOTHING
      `);

      const res = await request(buildApp(adminId))
        .delete(`/api/vpi/values/${vpiRow.id}`)
        .expect(409);

      expect(res.body.error_code).toBe('VPI_IN_USE_TENANTS');
      // Wert muss noch in der DB sein
      const stillThere = await db.execute(sql`SELECT id FROM vpi_values WHERE id = ${vpiRow.id}::uuid`);
      expect(stillThere.rows).toHaveLength(1);
    } finally {
      await db.execute(sql`DELETE FROM tenants    WHERE id = ${refTenId}::uuid`);
      await db.execute(sql`DELETE FROM units       WHERE id = ${refUnitId}::uuid`);
      await db.execute(sql`DELETE FROM properties  WHERE id = ${refPropId}::uuid`);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${refOrgId}::uuid`);
      await db.execute(sql`DELETE FROM vpi_values  WHERE id = ${vpiRow.id}::uuid`);
    }
  });

  // ── Referenz-Check: 409 wenn vpi_adjustments.vpi_new diesen Wert trägt ───
  test('DELETE → 409 wenn eine Indexanpassung diesen Wert als vpi_new trägt', async () => {
    const UNIQUE_VPI2 = 87654.32;
    const vpiRow = await insertVpi(BASE_YEAR + 6, 2, UNIQUE_VPI2);

    // Minimal-Tenant für die FK-Anforderung in vpi_adjustments
    const adjOrgId  = uuidv4();
    const adjPropId = uuidv4();
    const adjUnitId = uuidv4();
    const adjTenId  = uuidv4();
    const adjId     = uuidv4();
    try {
      await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${adjOrgId}::uuid, 'VpiAdjOrg') ON CONFLICT DO NOTHING`);
      await db.execute(sql`
        INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
        VALUES (${adjPropId}::uuid, ${adjOrgId}::uuid, 'AdjProp', 'Str 2', 'Wien', '1010', 'mietverwaltung')
        ON CONFLICT DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO units (id, property_id, top_nummer, type, status)
        VALUES (${adjUnitId}::uuid, ${adjPropId}::uuid, 'T1', 'wohnung', 'aktiv')
        ON CONFLICT DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO tenants (id, unit_id, first_name, last_name)
        VALUES (${adjTenId}::uuid, ${adjUnitId}::uuid, 'Adj', 'Tenant')
        ON CONFLICT DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO vpi_adjustments
          (id, tenant_id, adjustment_date, previous_rent, new_rent, vpi_old, vpi_new, percentage_change, effective_date)
        VALUES
          (${adjId}::uuid, ${adjTenId}::uuid, CURRENT_DATE, '1000.00', '1050.00',
           '100.00', ${String(UNIQUE_VPI2)}, '5.00', CURRENT_DATE)
        ON CONFLICT DO NOTHING
      `);

      const res = await request(buildApp(adminId))
        .delete(`/api/vpi/values/${vpiRow.id}`)
        .expect(409);

      expect(res.body.error_code).toBe('VPI_IN_USE_ADJUSTMENTS');
      const stillThere = await db.execute(sql`SELECT id FROM vpi_values WHERE id = ${vpiRow.id}::uuid`);
      expect(stillThere.rows).toHaveLength(1);
    } finally {
      await db.execute(sql`DELETE FROM vpi_adjustments WHERE id = ${adjId}::uuid`);
      await db.execute(sql`DELETE FROM tenants     WHERE id = ${adjTenId}::uuid`);
      await db.execute(sql`DELETE FROM units        WHERE id = ${adjUnitId}::uuid`);
      await db.execute(sql`DELETE FROM properties   WHERE id = ${adjPropId}::uuid`);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${adjOrgId}::uuid`);
      await db.execute(sql`DELETE FROM vpi_values   WHERE id = ${vpiRow.id}::uuid`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/vpi/values — ON CONFLICT Upsert', () => {
  test('neuer Wert wird gespeichert', async () => {
    const res = await request(buildApp(adminId))
      .post('/api/vpi/values')
      .send({ year: BASE_YEAR + 3, month: 1, value: 300, source: 'test' })
      .expect(200);
    expect(res.body).toHaveProperty('id');
    expect(parseFloat(res.body.value)).toBeCloseTo(300, 2);
  });

  test('gleiche (year, month) → aktualisiert, kein Duplikat', async () => {
    const [y, m] = [BASE_YEAR + 3, 2];
    await request(buildApp(adminId)).post('/api/vpi/values').send({ year: y, month: m, value: 310, source: 'test' }).expect(200);
    const res = await request(buildApp(adminId)).post('/api/vpi/values').send({ year: y, month: m, value: 315, source: 'test' }).expect(200);

    expect(parseFloat(res.body.value)).toBeCloseTo(315, 2);
    const dbr = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM vpi_values WHERE year = ${y} AND month = ${m}`);
    expect((dbr.rows[0] as any).cnt).toBe(1);
  });

  test('value ist nach Upsert auf dem neuen Wert', async () => {
    const [y, m] = [BASE_YEAR + 3, 3];
    await request(buildApp(adminId)).post('/api/vpi/values').send({ year: y, month: m, value: 320, source: 'test' }).expect(200);
    await request(buildApp(adminId)).post('/api/vpi/values').send({ year: y, month: m, value: 325, source: 'test' }).expect(200);
    const dbr = await db.execute(sql`SELECT value::float FROM vpi_values WHERE year = ${y} AND month = ${m}`);
    expect(parseFloat((dbr.rows[0] as any).value)).toBeCloseTo(325, 2);
  });

  test('ohne year → 400', async () => {
    await request(buildApp(adminId)).post('/api/vpi/values').send({ month: 1, value: 100 }).expect(400);
  });

  test('ohne month → 400', async () => {
    await request(buildApp(adminId)).post('/api/vpi/values').send({ year: BASE_YEAR + 3, value: 100 }).expect(400);
  });

  test('ohne value → 400', async () => {
    await request(buildApp(adminId)).post('/api/vpi/values').send({ year: BASE_YEAR + 3, month: 5 }).expect(400);
  });

  test('source default = manual', async () => {
    const res = await request(buildApp(adminId))
      .post('/api/vpi/values')
      .send({ year: BASE_YEAR + 3, month: 6, value: 330 })
      .expect(200);
    expect(res.body.source).toBe('manual');
  });

  test('finance-User darf POST', async () => {
    const res = await request(buildApp(financeId))
      .post('/api/vpi/values')
      .send({ year: BASE_YEAR + 3, month: 7, value: 335, source: 'test' })
      .expect(200);
    expect(res.body).toHaveProperty('id');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Eingabevalidierung — ungültige Monat/Wert-Kombinationen', () => {
  const adminApp = buildApp(adminId);

  // ── POST: Monatsbereich ────────────────────────────────────────────────────
  test('POST Monat 0 → 400', async () => {
    const res = await request(adminApp)
      .post('/api/vpi/values')
      .send({ year: BASE_YEAR + 4, month: 0, value: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[Mm]onat/);
  });

  test('POST Monat 13 → 400', async () => {
    const res = await request(adminApp)
      .post('/api/vpi/values')
      .send({ year: BASE_YEAR + 4, month: 13, value: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[Mm]onat/);
  });

  test('POST Monat -1 → 400', async () => {
    const res = await request(adminApp)
      .post('/api/vpi/values')
      .send({ year: BASE_YEAR + 4, month: -1, value: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[Mm]onat/);
  });

  test('POST Monat 1 und Monat 12 sind gültig (Grenzen)', async () => {
    const r1 = await request(adminApp).post('/api/vpi/values').send({ year: BASE_YEAR + 4, month: 1, value: 100, source: 'test' });
    expect(r1.status).toBeLessThan(300);
    const r12 = await request(adminApp).post('/api/vpi/values').send({ year: BASE_YEAR + 4, month: 12, value: 100, source: 'test' });
    expect(r12.status).toBeLessThan(300);
  });

  // ── POST: negativer / Null-Wert ───────────────────────────────────────────
  test('POST negativer Wert → 400', async () => {
    const res = await request(adminApp)
      .post('/api/vpi/values')
      .send({ year: BASE_YEAR + 4, month: 2, value: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positiv/i);
  });

  test('POST Wert 0 → 400', async () => {
    const res = await request(adminApp)
      .post('/api/vpi/values')
      .send({ year: BASE_YEAR + 4, month: 3, value: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positiv/i);
  });

  test('POST gültiger Wert 0.01 wird akzeptiert', async () => {
    const res = await request(adminApp)
      .post('/api/vpi/values')
      .send({ year: BASE_YEAR + 4, month: 4, value: 0.01, source: 'test' });
    expect(res.status).toBeLessThan(300);
  });

  // ── POST: NaN / Infinity / nicht-numerisch ────────────────────────────────
  test('POST value="NaN" → 400, DB unveraendert', async () => {
    const before = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM vpi_values WHERE year = ${BASE_YEAR + 4} AND month = 5`);
    const res = await request(adminApp)
      .post('/api/vpi/values')
      .send({ year: BASE_YEAR + 4, month: 5, value: 'NaN' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positiv/i);
    const after = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM vpi_values WHERE year = ${BASE_YEAR + 4} AND month = 5`);
    expect((after.rows[0] as any).cnt).toBe((before.rows[0] as any).cnt);
  });

  test('POST value="Infinity" → 400', async () => {
    const res = await request(adminApp)
      .post('/api/vpi/values')
      .send({ year: BASE_YEAR + 4, month: 6, value: 'Infinity' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positiv/i);
  });

  test('POST value="abc" (nicht-numerisch) → 400', async () => {
    const res = await request(adminApp)
      .post('/api/vpi/values')
      .send({ year: BASE_YEAR + 4, month: 7, value: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positiv/i);
  });

  // ── PATCH: negativer / Null-Wert / Sonderwerte ────────────────────────────
  test('PATCH negativer Wert → 400', async () => {
    const row = await insertVpi(BASE_YEAR + 4, 8, 100);
    const res = await request(adminApp)
      .patch(`/api/vpi/values/${row.id}`)
      .send({ value: -5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positiv/i);
    // DB-Wert darf sich nicht verändert haben
    const dbr = await db.execute(sql`SELECT value::float FROM vpi_values WHERE id = ${row.id}::uuid`);
    expect(parseFloat((dbr.rows[0] as any).value)).toBeCloseTo(100, 2);
  });

  test('PATCH Wert 0 → 400', async () => {
    const row = await insertVpi(BASE_YEAR + 4, 9, 110);
    const res = await request(adminApp)
      .patch(`/api/vpi/values/${row.id}`)
      .send({ value: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positiv/i);
  });

  test('PATCH value="NaN" → 400, DB unveraendert', async () => {
    const row = await insertVpi(BASE_YEAR + 4, 10, 115);
    const res = await request(adminApp)
      .patch(`/api/vpi/values/${row.id}`)
      .send({ value: 'NaN' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positiv/i);
    const dbr = await db.execute(sql`SELECT value::float FROM vpi_values WHERE id = ${row.id}::uuid`);
    expect(parseFloat((dbr.rows[0] as any).value)).toBeCloseTo(115, 2);
  });

  test('PATCH value="Infinity" → 400', async () => {
    const row = await insertVpi(BASE_YEAR + 4, 11, 120);
    const res = await request(adminApp)
      .patch(`/api/vpi/values/${row.id}`)
      .send({ value: 'Infinity' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positiv/i);
  });

  test('PATCH value="abc" → 400', async () => {
    const row = await insertVpi(BASE_YEAR + 4, 12, 125);
    const res = await request(adminApp)
      .patch(`/api/vpi/values/${row.id}`)
      .send({ value: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positiv/i);
  });

  test('PATCH gültiger Wert wird weiterhin akzeptiert', async () => {
    const row = await insertVpi(BASE_YEAR + 5, 1, 120);
    const res = await request(adminApp)
      .patch(`/api/vpi/values/${row.id}`)
      .send({ value: 125 });
    expect(res.status).toBe(200);
    expect(parseFloat(res.body.value)).toBeCloseTo(125, 2);
  });
});
