/**
 * VPI-Import — Unit- und Integrationstests
 *
 * Prüft:
 *  1. parseVpiCsv: Format A (Matrix Jahr;Jän;Feb;…)
 *  2. parseVpiCsv: Format B (Liste Jahr;Monat;VPI)
 *  3. parseVpiCsv: Komma-Dezimalzeichen
 *  4. parseVpiCsv: Ungültiges Format → Fehler
 *  5. upsertVpiRows: Werte korrekt in DB geschrieben
 *  6. upsertVpiRows: Ungültige Werte werden übersprungen
 *  7. POST /api/vpi/import-csv → 200 mit importierten Werten
 *  8. POST /api/vpi/import-csv ohne Inhalt → 400
 *  9. POST /api/vpi/import-csv ohne Auth → 401
 * 10. POST /api/vpi/import ohne Auth → 401
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { rootDb as db, withOrgContext } from '../../server/db';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { setupTestDb, teardownTestDb } from '../helpers/db';
import { parseVpiCsv, upsertVpiRows, type VpiImportRow } from '../../server/services/vpiImportService';
import vpiRouter from '../../server/routes/vpiRoutes';
import { addOrgContext } from '../helpers/withOrgContext';
import { acquireVpiTestLock, releaseVpiTestLock } from '../helpers/vpiTestLock';

// ── Testdaten ────────────────────────────────────────────────────────────────
const orgId    = uuidv4();
const adminId  = uuidv4();
const viewerId = uuidv4(); // hat keine admin/finance-Rolle → sollte 403 erhalten

// ── App-Bauhelfer ─────────────────────────────────────────────────────────────
// uid = null → kein userId in der Session → isAuthenticated → 401
function buildApp(uid: string | null) {
  const app = express();
  app.use(express.json());
  // Session-Injektion: isAuthenticated prüft req.session?.userId
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = uid ? { userId: uid, organizationId: orgId } : {};
    next();
  });
  addOrgContext(app, uid ? orgId : null);
  app.use(vpiRouter);
  return app;
}

// ── Seed & Cleanup ───────────────────────────────────────────────────────────
async function seed() {
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'VPI-Test-Org') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${adminId}::uuid,  ${'vpi-test-admin-' + adminId.slice(0,8) + '@test.at'},  ${orgId}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${viewerId}::uuid, ${'vpi-test-viewer-' + viewerId.slice(0,8) + '@test.at'}, ${orgId}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${adminId}::uuid, 'admin') ON CONFLICT DO NOTHING`);
  // viewerId bekommt keine Rolle → requireRole("admin","finance") → 403
}

async function cleanup() {
  await db.execute(sql`DELETE FROM vpi_values WHERE source IN ('csv-upload','statistik.at','test-import')`);
  await db.execute(sql`DELETE FROM user_roles WHERE user_id IN (${adminId}::uuid, ${viewerId}::uuid)`);
  await db.execute(sql`DELETE FROM profiles WHERE id IN (${adminId}::uuid, ${viewerId}::uuid)`);
  await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
}

// ── Tests: parseVpiCsv ────────────────────────────────────────────────────────
describe('parseVpiCsv', () => {
  test('Format A: Matrix Jahr;Jän;Feb;…', () => {
    const csv = [
      'Jahr;Jän;Feb;Mär;Apr;Mai;Jun;Jul;Aug;Sep;Okt;Nov;Dez',
      '2020;100,0;100,4;100,2;99,7;99,4;99,6;100,0;99,8;100,3;100,5;100,7;101,3',
      '2021;100,8;101,0;101,9;102,0;102,4;102,8;103,4;103,8;104,5;105,5;106,3;107,0',
    ].join('\n');

    const rows = parseVpiCsv(csv);
    expect(rows).toHaveLength(24); // 2 Jahre × 12 Monate
    const jan2020 = rows.find(r => r.year === 2020 && r.month === 1);
    expect(jan2020?.value).toBeCloseTo(100.0, 2);
    const dez2021 = rows.find(r => r.year === 2021 && r.month === 12);
    expect(dez2021?.value).toBeCloseTo(107.0, 2);
  });

  test('Format B: Liste Jahr;Monat;VPI', () => {
    const csv = [
      'Jahr;Monat;VPI',
      '2022;1;108,5',
      '2022;2;109,2',
      '2022;3;110,1',
    ].join('\n');

    const rows = parseVpiCsv(csv);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ year: 2022, month: 1 });
    expect(rows[0].value).toBeCloseTo(108.5, 2);
    expect(rows[2].value).toBeCloseTo(110.1, 2);
  });

  test('Punkt als Dezimaltrennzeichen wird akzeptiert', () => {
    const csv = ['Jahr;Monat;VPI', '2023;6;115.3'].join('\n');
    const rows = parseVpiCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBeCloseTo(115.3, 2);
  });

  test('Leere CSV → Fehler', () => {
    expect(() => parseVpiCsv('')).toThrow();
  });

  test('Komma-getrennte CSV wird explizit abgelehnt (Ambiguität)', () => {
    const csv = 'Jahr,Monat,VPI\n2023,6,115.3';
    expect(() => parseVpiCsv(csv)).toThrow(/Semikolon/i);
  });

  test('Unbekannte Spalten → Fehler mit Hinweis', () => {
    const csv = ['Datum;Wert', '2023-01;115,3'].join('\n');
    expect(() => parseVpiCsv(csv)).toThrow(/Format nicht erkannt/i);
  });

  test('Ungültige Jahre werden übersprungen', () => {
    const csv = [
      'Jahr;Monat;VPI',
      '1990;1;80,0', // zu alt → ignoriert
      '2023;1;115,5',
    ].join('\n');
    const rows = parseVpiCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].year).toBe(2023);
  });

  test('Null-/Leer-Werte in Matrix werden übersprungen', () => {
    const csv = [
      'Jahr;Jän;Feb;Mär',
      '2020;100,0;;100,2', // Feb leer
    ].join('\n');
    const rows = parseVpiCsv(csv);
    // Feb ist leer → 0 oder NaN → wird übersprungen
    expect(rows.every(r => r.value > 0)).toBe(true);
    expect(rows.find(r => r.month === 2)).toBeUndefined();
  });
});

// ── Tests: upsertVpiRows + HTTP ───────────────────────────────────────────────
describe('VPI-Import Integrationstests', () => {
  beforeAll(async () => {
    await acquireVpiTestLock();
    await setupTestDb();
    await seed();
  });

  afterAll(async () => {
    await cleanup();
    await teardownTestDb();
    await releaseVpiTestLock();
  });

  test('upsertVpiRows schreibt gültige Zeilen in die DB', async () => {
    const rows: VpiImportRow[] = [
      { year: 2099, month: 1, value: 199.1 },
      { year: 2099, month: 2, value: 199.5 },
    ];
    // upsertVpiRows nutzt intern `db` (org-scoped Proxy) → withOrgContext erforderlich
    const result = await withOrgContext(orgId, () => upsertVpiRows(rows, 'test-import'));
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);

    // Verify in DB (rootDb, da kein Request-Kontext außerhalb withOrgContext)
    const dbRows = await db.execute(sql`
      SELECT year, month, value FROM vpi_values WHERE year = 2099 AND source = 'test-import'
      ORDER BY month
    `);
    expect(dbRows.rows).toHaveLength(2);
    expect(parseFloat((dbRows.rows[0] as any).value)).toBeCloseTo(199.1, 2);

    // Cleanup
    await db.execute(sql`DELETE FROM vpi_values WHERE year = 2099`);
  });

  test('upsertVpiRows: ungültige Monate werden übersprungen', async () => {
    const rows: VpiImportRow[] = [
      { year: 2098, month: 13, value: 100.0 }, // Monat 13 → ungültig
      { year: 2098, month: 6,  value: 105.5 }, // gültig
    ];
    const result = await withOrgContext(orgId, () => upsertVpiRows(rows, 'test-import'));
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);

    await db.execute(sql`DELETE FROM vpi_values WHERE year = 2098`);
  });

  test('upsertVpiRows: Upsert — doppelter Eintrag überschreibt vorherigen', async () => {
    await withOrgContext(orgId, () => upsertVpiRows([{ year: 2097, month: 3, value: 110.0 }], 'test-import'));
    await withOrgContext(orgId, () => upsertVpiRows([{ year: 2097, month: 3, value: 115.0 }], 'test-import'));
    const dbRows = await db.execute(sql`
      SELECT value FROM vpi_values WHERE year = 2097 AND month = 3
    `);
    expect(dbRows.rows).toHaveLength(1);
    expect(parseFloat((dbRows.rows[0] as any).value)).toBeCloseTo(115.0, 2);

    await db.execute(sql`DELETE FROM vpi_values WHERE year = 2097`);
  });

  test('Löschschutz-Parität: referenzierter Wert (tenants.vpi_base) wird NICHT überschrieben', async () => {
    const propId  = uuidv4();
    const unitId  = uuidv4();
    const tenId   = uuidv4();
    const REFVAL  = 196.7; // eindeutiger Wert, kollidiert nicht mit anderen Tests
    try {
      await withOrgContext(orgId, () => upsertVpiRows([{ year: 2096, month: 5, value: REFVAL }], 'test-import'));
      // Mieter der den Wert als vpi_base referenziert
      await db.execute(sql`
        INSERT INTO properties (id, organization_id, name, address, city, postal_code)
        VALUES (${propId}::uuid, ${orgId}::uuid, 'VPI-Ref-Obj', 'Str 1', 'Wien', '1010') ON CONFLICT DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO units (id, property_id, top_nummer, type, status)
        VALUES (${unitId}::uuid, ${propId}::uuid, 'Top 1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO tenants (id, unit_id, first_name, last_name, vpi_base)
        VALUES (${tenId}::uuid, ${unitId}::uuid, 'Vpi', 'Ref', ${REFVAL})
      `);

      // Import mit ANDEREM Wert für denselben Monat → muss übersprungen werden
      const result = await withOrgContext(orgId, () =>
        upsertVpiRows([{ year: 2096, month: 5, value: 200.0 }], 'test-import'));
      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/Mietverträgen/);

      // Wert unverändert in der DB
      const dbRows = await db.execute(sql`SELECT value FROM vpi_values WHERE year = 2096 AND month = 5`);
      expect(parseFloat((dbRows.rows[0] as any).value)).toBeCloseTo(REFVAL, 2);

      // Gleicher Wert (idempotenter Re-Import) bleibt erlaubt
      const same = await withOrgContext(orgId, () =>
        upsertVpiRows([{ year: 2096, month: 5, value: REFVAL }], 'test-import'));
      expect(same.imported).toBe(1);
      expect(same.warnings).toHaveLength(0);
    } finally {
      await db.execute(sql`DELETE FROM tenants WHERE id = ${tenId}::uuid`);
      await db.execute(sql`DELETE FROM units WHERE id = ${unitId}::uuid`);
      await db.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
      await db.execute(sql`DELETE FROM vpi_values WHERE year = 2096`);
    }
  });

  test('Löschschutz-Parität: von Indexanpassung (vpi_new) referenzierter Wert wird NICHT überschrieben', async () => {
    const propId  = uuidv4();
    const unitId  = uuidv4();
    const tenId   = uuidv4();
    const adjId   = uuidv4();
    const REFVAL  = 197.3;
    try {
      await withOrgContext(orgId, () => upsertVpiRows([{ year: 2095, month: 7, value: REFVAL }], 'test-import'));
      await db.execute(sql`
        INSERT INTO properties (id, organization_id, name, address, city, postal_code)
        VALUES (${propId}::uuid, ${orgId}::uuid, 'VPI-Adj-Obj', 'Str 2', 'Wien', '1020') ON CONFLICT DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO units (id, property_id, top_nummer, type, status)
        VALUES (${unitId}::uuid, ${propId}::uuid, 'Top 1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO tenants (id, unit_id, first_name, last_name)
        VALUES (${tenId}::uuid, ${unitId}::uuid, 'Vpi', 'Adj')
      `);
      await db.execute(sql`
        INSERT INTO vpi_adjustments (id, tenant_id, adjustment_date, previous_rent, new_rent, vpi_old, vpi_new, effective_date)
        VALUES (${adjId}::uuid, ${tenId}::uuid, '2095-08-01', '800.00', '820.00', '190.0', ${REFVAL}, '2095-08-01')
      `);

      const result = await withOrgContext(orgId, () =>
        upsertVpiRows([{ year: 2095, month: 7, value: 210.0 }], 'test-import'));
      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.warnings[0]).toMatch(/Indexanpassungen/);

      const dbRows = await db.execute(sql`SELECT value FROM vpi_values WHERE year = 2095 AND month = 7`);
      expect(parseFloat((dbRows.rows[0] as any).value)).toBeCloseTo(REFVAL, 2);
    } finally {
      await db.execute(sql`DELETE FROM vpi_adjustments WHERE id = ${adjId}::uuid`);
      await db.execute(sql`DELETE FROM tenants WHERE id = ${tenId}::uuid`);
      await db.execute(sql`DELETE FROM units WHERE id = ${unitId}::uuid`);
      await db.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
      await db.execute(sql`DELETE FROM vpi_values WHERE year = 2095`);
    }
  });

  // ── HTTP-Route-Tests via echten vpiRouter ──────────────────────────────────

  test('POST /api/vpi/import-csv → 200 + Importergebnis', async () => {
    const csv = ['Jahr;Monat;VPI', '2096;4;112,3', '2096;5;113,0'].join('\n');
    const res = await request(buildApp(adminId))
      .post('/api/vpi/import-csv')
      .send({ csv });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);
    expect(res.body.skipped).toBe(0);

    await db.execute(sql`DELETE FROM vpi_values WHERE year = 2096`);
  });

  test('POST /api/vpi/import-csv ohne Inhalt → 400', async () => {
    const res = await request(buildApp(adminId))
      .post('/api/vpi/import-csv')
      .send({ csv: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/kein csv/i);
  });

  test('POST /api/vpi/import-csv ohne Auth → 401', async () => {
    const csv = ['Jahr;Monat;VPI', '2094;1;110,0'].join('\n');
    const res = await request(buildApp(null))
      .post('/api/vpi/import-csv')
      .send({ csv });

    expect(res.status).toBe(401);
  });

  test('POST /api/vpi/import-csv ohne admin/finance-Rolle → 403', async () => {
    const csv = ['Jahr;Monat;VPI', '2094;2;111,0'].join('\n');
    const res = await request(buildApp(viewerId))
      .post('/api/vpi/import-csv')
      .send({ csv });

    expect(res.status).toBe(403);
  });

  test('POST /api/vpi/import ohne Auth → 401', async () => {
    const res = await request(buildApp(null))
      .post('/api/vpi/import')
      .send({});

    expect(res.status).toBe(401);
  });

  test('parseVpiCsv + upsertVpiRows: Vollständiger CSV-Import-Pfad', async () => {
    const csv = [
      'Jahr;Jän;Feb;Mär',
      '2095;100,0;100,4;100,8',
    ].join('\n');

    const rows = parseVpiCsv(csv);
    expect(rows).toHaveLength(3);

    const result = await withOrgContext(orgId, () => upsertVpiRows(rows, 'test-import'));
    expect(result.imported).toBe(3);

    await db.execute(sql`DELETE FROM vpi_values WHERE year = 2095`);
  });
});
