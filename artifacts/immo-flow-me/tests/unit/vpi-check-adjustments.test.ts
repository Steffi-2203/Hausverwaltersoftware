/**
 * GET /api/vpi/check-adjustments — Fehlerbehandlung bei leerem VPI-Index
 *
 * Testet die echte Produktionsroute aus server/routes/vpiRoutes.ts —
 * kein Mini-App-Workaround mehr, da die Route jetzt als importierbarer
 * Router vorliegt (Task #46).
 *
 * Prüft:
 *  1. Leere vpi_values → 422 + code='VPI_EMPTY'
 *  2. Leere vpi_values → nicht 500
 *  3. Gefüllte Tabelle → kein VPI_EMPTY / kein 422
 *  4. Kein userId in Session → 401 (isAuthenticated-Middleware)
 *  5. Kein Profil zur Session → 400 (No organization)
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { rootDb as db } from '../../server/db';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import vpiRouter from '../../server/routes/vpiRoutes';
import { addOrgContext } from '../helpers/withOrgContext';
import { acquireVpiTestLock, releaseVpiTestLock } from '../helpers/vpiTestLock';

// ── Testdaten ─────────────────────────────────────────────────────────────────
const orgId  = uuidv4();
const userId = uuidv4();

// ── App-Bauhelfer ─────────────────────────────────────────────────────────────
// Baut eine Express-App mit dem echten vpiRouter.
// uid = null → kein userId → isAuthenticated schlägt fehl → 401
function buildApp(uid: string | null = userId) {
  const app = express();
  app.use(express.json());
  // Session-Injektion: isAuthenticated prüft req.session?.userId
  // getProfileFromSession liest req.session.userId und schlägt in der DB nach
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = uid ? { userId: uid } : {};
    next();
  });
  addOrgContext(app, uid ? orgId : null);
  app.use(vpiRouter);
  return app;
}

// ── Seed & Cleanup ────────────────────────────────────────────────────────────
async function seed() {
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgId}::uuid,'VpiCheck-Org') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${userId}::uuid,'vpicheck@test.at',${orgId}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${userId}::uuid,'admin') ON CONFLICT DO NOTHING`);
}

async function cleanup() {
  await db.execute(sql`DELETE FROM vpi_values WHERE source = 'test-check-adj'`);
  await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${userId}::uuid`);
  await db.execute(sql`DELETE FROM profiles   WHERE id = ${userId}::uuid`);
  await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
}

beforeAll(async () => { await acquireVpiTestLock(); await cleanup(); await seed(); });
afterAll(async  () => { await cleanup(); await releaseVpiTestLock(); });

// ── Tests: Zugangskontrolle ───────────────────────────────────────────────────
describe('GET /api/vpi/check-adjustments — Zugangskontrolle', () => {
  test('kein userId in Session → 401', async () => {
    await request(buildApp(null))
      .get('/api/vpi/check-adjustments')
      .expect(401);
  });

  test('unbekannter userId (kein Profil) → 400 No organization', async () => {
    // Ein UUID der in der DB nicht existiert → getProfileFromSession gibt null zurück
    const res = await request(buildApp(uuidv4()))
      .get('/api/vpi/check-adjustments')
      .expect(400);
    expect(res.body.error).toMatch(/organization/i);
  });
});

// ── Tests: VPI_EMPTY-Fehlerbehandlung ─────────────────────────────────────────
describe('GET /api/vpi/check-adjustments — leerer VPI-Index', () => {
  test('leere vpi_values → 422 + code VPI_EMPTY', async () => {
    // Alle VPI-Werte sichern und leeren
    const backup = await db.execute(sql`SELECT * FROM vpi_values`);
    await db.execute(sql`DELETE FROM vpi_values`);

    try {
      const res = await request(buildApp())
        .get('/api/vpi/check-adjustments')
        .set('Accept', 'application/json');

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VPI_EMPTY');
      expect(res.body.error).toMatch(/VPI-Daten/i);
      expect(res.body.error).toMatch(/import/i);
    } finally {
      for (const row of backup.rows as any[]) {
        await db.execute(sql`
          INSERT INTO vpi_values (id, year, month, value, source, created_at, updated_at)
          VALUES (${row.id}::uuid, ${row.year}, ${row.month}, ${row.value},
                  ${row.source ?? 'manual'},
                  ${row.created_at ?? new Date().toISOString()},
                  ${row.updated_at ?? new Date().toISOString()})
          ON CONFLICT DO NOTHING
        `);
      }
    }
  });

  test('leere vpi_values → nicht 500', async () => {
    const backup = await db.execute(sql`SELECT * FROM vpi_values`);
    await db.execute(sql`DELETE FROM vpi_values`);

    try {
      const res = await request(buildApp()).get('/api/vpi/check-adjustments');
      expect(res.status).not.toBe(500);
    } finally {
      for (const row of backup.rows as any[]) {
        await db.execute(sql`
          INSERT INTO vpi_values (id, year, month, value, source, created_at, updated_at)
          VALUES (${row.id}::uuid, ${row.year}, ${row.month}, ${row.value},
                  ${row.source ?? 'manual'},
                  ${row.created_at ?? new Date().toISOString()},
                  ${row.updated_at ?? new Date().toISOString()})
          ON CONFLICT DO NOTHING
        `);
      }
    }
  });

  test('gefüllte vpi_values → kein VPI_EMPTY, kein 422', async () => {
    await db.execute(sql`
      INSERT INTO vpi_values (year, month, value, source)
      VALUES (2024, 12, 119.2, 'test-check-adj')
      ON CONFLICT (year, month) DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source
    `);

    try {
      const res = await request(buildApp()).get('/api/vpi/check-adjustments');
      expect(res.status).not.toBe(422);
      expect(res.body.code).not.toBe('VPI_EMPTY');
    } finally {
      await db.execute(sql`DELETE FROM vpi_values WHERE source = 'test-check-adj'`);
    }
  });
});
