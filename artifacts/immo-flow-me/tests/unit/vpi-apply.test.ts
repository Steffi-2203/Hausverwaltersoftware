/**
 * POST /api/vpi/apply — Route-Tests (Task #77)
 *
 * Testet die echte Produktionsroute aus server/routes/vpiRoutes.ts direkt —
 * kein Workaround, kein Mocking des Routers selbst.
 *
 * Abgedeckte Faelle:
 *   400 — tenantId fehlt im Body
 *   401 — kein userId in der Session (isAuthenticated)
 *   403 — Rolle fehlt (nur property_manager oder finance dürfen apply;
 *          viewer wird zurückgewiesen)
 *   404 — Mieter gehört zu einer anderen Org (Cross-Org-Check)
 *   422 — Schwellenwert nicht erreicht (VPI-Anstieg < Schwelle)
 *   200 — Erfolgreiche Anpassung: vpiAdjustments + rentHistory geschrieben,
 *          Tenant-Werte aktualisiert
 *
 * Hinweis zu requireRole: Admin-Nutzer sind immer ein Superrole und passieren
 * jede requireRole-Prüfung (helpers.ts). Der 403-Fall wird deshalb mit einem
 * 'viewer'-Nutzer ohne erhöhte Rollen getestet.
 *
 * Testdaten-Design:
 *   - Eigene Org: orgId / orgPropId / orgUnitId / orgTenantId
 *   - orgTenantId: grundmiete=1000, vpi_base=100
 *   - Aktueller VPI in DB: 110 → 10 % Anstieg (> 5 % Schwelle) → Erfolg
 *   - Für 422: lowTenantId mit vpi_base=109 → ca. 0.9 % Anstieg (< 5 %)
 *   - Fremde Org für 404-Prüfung: foreignOrgId / foreignTenantId
 */

import { describe, test, before as beforeAll, after as afterAll, beforeEach } from 'node:test';
import { expect } from '../helpers/expect';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { rootDb as db } from '../../server/db';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import vpiRouter from '../../server/routes/vpiRoutes';
import { addOrgContext } from '../helpers/withOrgContext';
import { acquireVpiTestLock, releaseVpiTestLock } from '../helpers/vpiTestLock';

// ── Feste UUIDs für diesen Test-Run ──────────────────────────────────────────
const orgId         = uuidv4();
const pmUserId      = uuidv4(); // property_manager
const financeUserId = uuidv4(); // finance
const viewerUserId  = uuidv4(); // viewer — hat KEINE property_manager/finance-Rolle

const orgPropId   = uuidv4();
const orgUnitId   = uuidv4();
const orgTenantId = uuidv4(); // Haupt-Tenant für Erfolgsfall (vpi_base=100)
const lowTenantId = uuidv4(); // Tenant mit vpi_base=109 → 422-Schwelle
const lowUnitId   = uuidv4();

const foreignOrgId    = uuidv4();
const foreignPropId   = uuidv4();
const foreignUnitId   = uuidv4();
const foreignTenantId = uuidv4();

// VPI in der DB: 110 → Anstieg gegenüber vpi_base=100 beträgt 10 %
const CURRENT_VPI = 110;
// Jahr weit in der Zukunft → kein Konflikt mit Produktionsdaten
const VPI_YEAR = 2089;

// ── App-Bauhelfer ─────────────────────────────────────────────────────────────
function buildApp(uid: string | null, oid: string = orgId) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = uid ? { userId: uid, organizationId: oid } : {};
    next();
  });
  addOrgContext(app, uid ? oid : null);
  app.use(vpiRouter);
  return app;
}

// ── Seed ──────────────────────────────────────────────────────────────────────
async function seed() {
  // Eigene Org + Nutzer
  await db.execute(sql`
    INSERT INTO organizations (id, name)
    VALUES (${orgId}::uuid, 'VpiApply-Org')
    ON CONFLICT DO NOTHING
  `);
  for (const [uid, email] of [
    [pmUserId,      `vpi-apply-pm-${pmUserId.slice(0,8)}@test.at`],
    [financeUserId, `vpi-apply-finance-${financeUserId.slice(0,8)}@test.at`],
    [viewerUserId,  `vpi-apply-viewer-${viewerUserId.slice(0,8)}@test.at`],
  ]) {
    await db.execute(sql`
      INSERT INTO profiles (id, email, organization_id)
      VALUES (${uid}::uuid, ${email}, ${orgId}::uuid)
      ON CONFLICT DO NOTHING
    `);
  }
  // property_manager und finance erhalten ihre Rollen; viewer bekommt keine
  await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${pmUserId}::uuid,      'property_manager') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${financeUserId}::uuid, 'finance')          ON CONFLICT DO NOTHING`);

  // Haupt-Fixture: Property → Unit → Tenant (vpi_base=100, grundmiete=1000)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${orgPropId}::uuid, ${orgId}::uuid, 'ApplyProp', 'Teststr. 1', 'Wien', '1010', 'mietverwaltung')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status)
    VALUES (${orgUnitId}::uuid, ${orgPropId}::uuid, 'T1', 'wohnung', 'aktiv')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, grundmiete, vpi_base)
    VALUES (${orgTenantId}::uuid, ${orgUnitId}::uuid, 'Max', 'Mustermann', '1000.00', '100.00')
    ON CONFLICT DO NOTHING
  `);

  // Tenant mit vpi_base=109 → Anstieg = (110-109)/109 ≈ 0.9 % < 5 % → 422
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status)
    VALUES (${lowUnitId}::uuid, ${orgPropId}::uuid, 'T2', 'wohnung', 'aktiv')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, grundmiete, vpi_base)
    VALUES (${lowTenantId}::uuid, ${lowUnitId}::uuid, 'Low', 'Schwelle', '1000.00', '109.00')
    ON CONFLICT DO NOTHING
  `);

  // Fremde Org + Tenant (für 404-Check)
  await db.execute(sql`
    INSERT INTO organizations (id, name)
    VALUES (${foreignOrgId}::uuid, 'VpiApply-ForeignOrg')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${foreignPropId}::uuid, ${foreignOrgId}::uuid, 'ForeignProp', 'Fremdstr. 1', 'Graz', '8010', 'mietverwaltung')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status)
    VALUES (${foreignUnitId}::uuid, ${foreignPropId}::uuid, 'T1', 'wohnung', 'aktiv')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, grundmiete, vpi_base)
    VALUES (${foreignTenantId}::uuid, ${foreignUnitId}::uuid, 'Fremd', 'Mieter', '1000.00', '100.00')
    ON CONFLICT DO NOTHING
  `);

  // VPI-Wert in der DB (getCurrentVpi liest den neuesten Wert)
  await db.execute(sql`
    INSERT INTO vpi_values (year, month, value, source)
    VALUES (${VPI_YEAR}, 1, ${CURRENT_VPI}, 'test-vpi-apply')
    ON CONFLICT (year, month) DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source
  `);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
async function cleanup() {
  await db.execute(sql`DELETE FROM vpi_adjustments WHERE tenant_id IN (${orgTenantId}::uuid, ${lowTenantId}::uuid, ${foreignTenantId}::uuid)`);
  await db.execute(sql`DELETE FROM rent_history    WHERE tenant_id IN (${orgTenantId}::uuid, ${lowTenantId}::uuid, ${foreignTenantId}::uuid)`);
  await db.execute(sql`DELETE FROM tenants    WHERE id IN (${orgTenantId}::uuid, ${lowTenantId}::uuid, ${foreignTenantId}::uuid)`);
  await db.execute(sql`DELETE FROM units      WHERE id IN (${orgUnitId}::uuid, ${lowUnitId}::uuid, ${foreignUnitId}::uuid)`);
  await db.execute(sql`DELETE FROM properties WHERE id IN (${orgPropId}::uuid, ${foreignPropId}::uuid)`);
  await db.execute(sql`DELETE FROM user_roles WHERE user_id IN (${pmUserId}::uuid, ${financeUserId}::uuid, ${viewerUserId}::uuid)`);
  await db.execute(sql`DELETE FROM profiles   WHERE id      IN (${pmUserId}::uuid, ${financeUserId}::uuid, ${viewerUserId}::uuid)`);
  await db.execute(sql`DELETE FROM organizations WHERE id IN (${orgId}::uuid, ${foreignOrgId}::uuid)`);
  await db.execute(sql`DELETE FROM vpi_values WHERE year = ${VPI_YEAR} AND source = 'test-vpi-apply'`);
}

// ── Hilfsfunktion: Tenant-Grundwerte zurücksetzen ─────────────────────────────
// Stellt sicher dass orgTenantId zwischen Tests mit vpi_base=100, grundmiete=1000
// beginnt — nötig weil ein erfolgreicher apply-Aufruf die Werte dauerhaft ändert.
async function resetOrgTenant() {
  await db.execute(sql`
    UPDATE tenants
    SET grundmiete = '1000.00', vpi_base = '100.00', last_vpi_adjustment = NULL
    WHERE id = ${orgTenantId}::uuid
  `);
  await db.execute(sql`DELETE FROM vpi_adjustments WHERE tenant_id = ${orgTenantId}::uuid`);
  await db.execute(sql`DELETE FROM rent_history    WHERE tenant_id = ${orgTenantId}::uuid`);
}

beforeAll(async () => { await acquireVpiTestLock(); await cleanup(); await seed(); });
afterAll(async  () => { await cleanup(); await releaseVpiTestLock(); });

// ── 401 / 403 Zugangskontrolle ────────────────────────────────────────────────
describe('POST /api/vpi/apply — Zugangskontrolle', () => {
  test('kein userId in Session → 401', async () => {
    await request(buildApp(null))
      .post('/api/vpi/apply')
      .send({ tenantId: orgTenantId })
      .expect(401);
  });

  test('viewer-Rolle → 403 (hat weder property_manager noch finance)', async () => {
    // requireRole("property_manager", "finance") — viewer hat keine dieser Rollen.
    // Admin wäre immer ein Superrole (helpers.ts), deshalb testen wir mit viewer.
    const res = await request(buildApp(viewerUserId))
      .post('/api/vpi/apply')
      .send({ tenantId: orgTenantId })
      .expect(403);
    expect(res.body).toBeTruthy();
  });

  test('finance-Rolle → darf apply aufrufen (kein 401/403)', async () => {
    // Prüft nur dass der Aufruf die Auth-Schicht passiert; 422 ist ok.
    const res = await request(buildApp(financeUserId))
      .post('/api/vpi/apply')
      .send({ tenantId: lowTenantId });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── 400 Eingabevalidierung ─────────────────────────────────────────────────────
describe('POST /api/vpi/apply — Pflichtfelder', () => {
  test('tenantId fehlt → 400', async () => {
    const res = await request(buildApp(pmUserId))
      .post('/api/vpi/apply')
      .send({ effectiveDate: '2030-01-01' })
      .expect(400);
    expect(res.body.error).toMatch(/tenantId/);
  });

  test('snake_case tenant_id wird via snakeToCamel akzeptiert → kein 400 wegen fehlendem tenantId', async () => {
    // snake_case-Body wird durch snakeToCamel normiert → tenantId wird erkannt
    const res = await request(buildApp(pmUserId))
      .post('/api/vpi/apply')
      .send({ tenant_id: lowTenantId }); // 422 erwartet, kein 400
    expect(res.status).not.toBe(400);
  });
});

// ── 404 Org-Isolation ─────────────────────────────────────────────────────────
describe('POST /api/vpi/apply — Org-Isolation', () => {
  test('Mieter gehört zu fremder Org → 404', async () => {
    const res = await request(buildApp(pmUserId))
      .post('/api/vpi/apply')
      .send({ tenantId: foreignTenantId })
      .expect(404);
    expect(res.body.error).toMatch(/[Mm]ieter/);
  });

  test('völlig unbekannte UUID → 404', async () => {
    await request(buildApp(pmUserId))
      .post('/api/vpi/apply')
      .send({ tenantId: uuidv4() })
      .expect(404);
  });
});

// ── 422 Schwellenwert ─────────────────────────────────────────────────────────
describe('POST /api/vpi/apply — Schwellenwert nicht erreicht', () => {
  test('vpi_base=109, currentVpi=110 → <5 % → 422', async () => {
    const res = await request(buildApp(pmUserId))
      .post('/api/vpi/apply')
      .send({ tenantId: lowTenantId })
      .expect(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/[Ss]chwellenwert/);
  });

  test('bei 422 wird kein vpiAdjustment geschrieben', async () => {
    const rows = await db.execute(sql`
      SELECT id FROM vpi_adjustments WHERE tenant_id = ${lowTenantId}::uuid
    `);
    expect(rows.rows).toHaveLength(0);
  });

  test('bei 422 wird kein rentHistory-Eintrag geschrieben', async () => {
    const rows = await db.execute(sql`
      SELECT id FROM rent_history WHERE tenant_id = ${lowTenantId}::uuid
    `);
    expect(rows.rows).toHaveLength(0);
  });
});

// ── 200 Erfolgsfall ───────────────────────────────────────────────────────────
// beforeEach setzt orgTenantId auf vpi_base=100, grundmiete=1000 zurück,
// damit jeder Test hier mit einem sauberen Ausgangszustand startet.
describe('POST /api/vpi/apply — Erfolgreiche Anpassung', () => {
  beforeEach(async () => { await resetOrgTenant(); });

  test('200 + success:true + adjustment-Objekt in Response', async () => {
    const effectiveDate = '2030-02-01';
    const res = await request(buildApp(pmUserId))
      .post('/api/vpi/apply')
      .send({ tenantId: orgTenantId, effectiveDate })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.adjustment).toBeTruthy();
    expect(res.body.adjustment.id).toBeTruthy();
    // Route gibt camelCase-Drizzle-Returning zurück
    const returnedTenantId = res.body.adjustment.tenantId ?? res.body.adjustment.tenant_id;
    expect(returnedTenantId).toBe(orgTenantId);
  });

  test('vpiAdjustments enthält den neuen Eintrag mit korrekten Werten', async () => {
    await request(buildApp(pmUserId))
      .post('/api/vpi/apply')
      .send({ tenantId: orgTenantId })
      .expect(200);

    const rows = await db.execute(sql`
      SELECT id, vpi_old, vpi_new, previous_rent, new_rent, percentage_change
      FROM vpi_adjustments
      WHERE tenant_id = ${orgTenantId}::uuid
      ORDER BY applied_at DESC
      LIMIT 1
    `);
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0] as any;

    // vpi_old ≈ 100 (Tenant vpi_base), vpi_new = 110
    expect(parseFloat(row.vpi_old)).toBeCloseTo(100, 1);
    expect(parseFloat(row.vpi_new)).toBeCloseTo(CURRENT_VPI, 1);

    // Neue Miete: 1000 * (1 + (110-100)/100) = 1100
    expect(parseFloat(row.new_rent)).toBeCloseTo(1100, 0);
    expect(parseFloat(row.previous_rent)).toBeCloseTo(1000, 0);

    // Prozentualer Anstieg ≈ 10 %
    expect(parseFloat(row.percentage_change)).toBeCloseTo(10, 0);
  });

  test('rentHistory enthält einen neuen Eintrag mit VPI-Verweis', async () => {
    await request(buildApp(pmUserId))
      .post('/api/vpi/apply')
      .send({ tenantId: orgTenantId })
      .expect(200);

    const rows = await db.execute(sql`
      SELECT id, grundmiete, change_reason
      FROM rent_history
      WHERE tenant_id = ${orgTenantId}::uuid
      ORDER BY created_at DESC
      LIMIT 1
    `);
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0] as any;
    expect(parseFloat(row.grundmiete)).toBeCloseTo(1100, 0);
    expect(row.change_reason).toMatch(/VPI/);
  });

  test('Tenant.grundmiete und vpiBase werden in der DB aktualisiert', async () => {
    await request(buildApp(pmUserId))
      .post('/api/vpi/apply')
      .send({ tenantId: orgTenantId })
      .expect(200);

    const rows = await db.execute(sql`
      SELECT grundmiete, vpi_base
      FROM tenants
      WHERE id = ${orgTenantId}::uuid
    `);
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0] as any;
    expect(parseFloat(row.grundmiete)).toBeCloseTo(1100, 0);
    expect(parseFloat(row.vpi_base)).toBeCloseTo(CURRENT_VPI, 1);
  });
});
