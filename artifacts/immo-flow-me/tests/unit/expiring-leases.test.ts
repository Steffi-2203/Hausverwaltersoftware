/**
 * GET /api/tenants/expiring-leases — Integrationstests
 *
 * Prüft:
 * 1. Nur Verträge der eigenen Org werden zurückgegeben
 * 2. Cross-Org-Isolierung auch wenn tenant.unitId ≠ lease.unitId
 * 3. Befristungsende genau am Schwellwert (Grenzfall)
 * 4. Nicht-befristete Verträge werden nicht zurückgegeben
 * 5. Abgelaufene Verträge (befristungEnde < heute) nicht im Ergebnis
 * 6. daysUntilExpiry ist kalendarisch korrekt (kein Uhrzeitdrift)
 * 7. Unauthentifizierter Zugriff → 401/403
 */
import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { rootDb as db } from '../../server/db';
import { sql, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import tenantRoutes from '../../server/routes/tenantRoutes';
import { addOrgContext } from '../helpers/withOrgContext';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const orgA = uuidv4();
const orgB = uuidv4();
const userA = uuidv4();  // Profil-User für Org A (für getProfileFromSession)
const userB = uuidv4();  // Profil-User für Org B
const propA = uuidv4();
const propB = uuidv4();
const unitA = uuidv4();
const unitB = uuidv4();
const unitA2 = uuidv4();  // zweite Einheit in Org A — für Mismatch-Test
const tenantA = uuidv4();
const tenantB = uuidv4();
const tenantMismatch = uuidv4(); // Mieter in Org A, Mietvertrag auf unitB (Org B)

// Datum-Helfer (kalendarisch, UTC)
function addDays(base: string, n: number): string {
  const [y, m, d] = base.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().split('T')[0];
}
const TODAY = new Date().toISOString().split('T')[0];
const IN_30  = addDays(TODAY, 30);
const IN_60  = addDays(TODAY, 60);
const IN_91  = addDays(TODAY, 91);  // außerhalb Standard-90-Tage-Fenster
const YESTERDAY = addDays(TODAY, -1);

// ── Seed & Cleanup ────────────────────────────────────────────────────────────

async function seed() {
  // Orgs
  await db.execute(sql`
    INSERT INTO organizations (id, name)
    VALUES (${orgA}::uuid, 'ExpiringLease-Org-A'),
           (${orgB}::uuid, 'ExpiringLease-Org-B')
    ON CONFLICT DO NOTHING
  `);
  // Profiles (für getProfileFromSession — braucht echten DB-Eintrag)
  await db.execute(sql`
    INSERT INTO profiles (id, email, organization_id)
    VALUES (${userA}::uuid, ${'el-usera-' + userA.slice(0,8) + '@test.at'}, ${orgA}::uuid),
           (${userB}::uuid, ${'el-userb-' + userB.slice(0,8) + '@test.at'}, ${orgB}::uuid)
    ON CONFLICT DO NOTHING
  `);
  // Properties
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code)
    VALUES (${propA}::uuid, ${orgA}::uuid, 'PropA', 'Str 1', 'Wien', '1010'),
           (${propB}::uuid, ${orgB}::uuid, 'PropB', 'Str 2', 'Graz', '8010')
    ON CONFLICT DO NOTHING
  `);
  // Units
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type)
    VALUES (${unitA}::uuid,  ${propA}::uuid, 'A1', 'wohnung'),
           (${unitA2}::uuid, ${propA}::uuid, 'A2', 'wohnung'),
           (${unitB}::uuid,  ${propB}::uuid, 'B1', 'wohnung')
    ON CONFLICT DO NOTHING
  `);
  // Tenants
  await db.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, grundmiete, betriebskosten_vorschuss, heizungskosten_vorschuss, mietbeginn)
    VALUES (${tenantA}::uuid,         ${unitA}::uuid,  'TenantA', 'OrgA',     'a@a.test', 'aktiv', 500, 100, 50, '2025-01-01'),
           (${tenantB}::uuid,         ${unitB}::uuid,  'TenantB', 'OrgB',     'b@b.test', 'aktiv', 600, 120, 60, '2025-01-01'),
           (${tenantMismatch}::uuid,  ${unitA2}::uuid, 'Mismatch','OrgA',     'x@a.test', 'aktiv', 700, 140, 70, '2025-01-01')
    ON CONFLICT DO NOTHING
  `);
  // Leases — grundmiete ist NOT NULL in der leases-Tabelle
  // Lease A: befristet, endet in 30 Tagen → soll für Org A erscheinen
  await db.execute(sql`
    INSERT INTO leases (id, tenant_id, unit_id, start_date, end_date, grundmiete, befristet, befristung_ende, status)
    VALUES (${uuidv4()}::uuid, ${tenantA}::uuid, ${unitA}::uuid, '2025-01-01', ${IN_30}, 500.00, true, ${IN_30}, 'aktiv')
    ON CONFLICT DO NOTHING
  `);
  // Lease B: befristet, endet in 60 Tagen → soll für Org B erscheinen, NICHT für Org A
  await db.execute(sql`
    INSERT INTO leases (id, tenant_id, unit_id, start_date, end_date, grundmiete, befristet, befristung_ende, status)
    VALUES (${uuidv4()}::uuid, ${tenantB}::uuid, ${unitB}::uuid, '2025-01-01', ${IN_60}, 600.00, true, ${IN_60}, 'aktiv')
    ON CONFLICT DO NOTHING
  `);
  // Lease Mismatch: Mieter gehört zu Org A (unitA2), aber Mietvertrag auf unitB (Org B)
  // → darf für Org A NICHT erscheinen, da lease.unitId in Org B liegt
  await db.execute(sql`
    INSERT INTO leases (id, tenant_id, unit_id, start_date, end_date, grundmiete, befristet, befristung_ende, status)
    VALUES (${uuidv4()}::uuid, ${tenantMismatch}::uuid, ${unitB}::uuid, '2025-01-01', ${IN_60}, 700.00, true, ${IN_60}, 'aktiv')
    ON CONFLICT DO NOTHING
  `);
}

async function cleanup() {
  try {
    await db.execute(sql`DELETE FROM leases WHERE tenant_id IN (${tenantA}::uuid, ${tenantB}::uuid, ${tenantMismatch}::uuid)`);
    await db.execute(sql`DELETE FROM tenants WHERE id IN (${tenantA}::uuid, ${tenantB}::uuid, ${tenantMismatch}::uuid)`);
    await db.execute(sql`DELETE FROM units WHERE id IN (${unitA}::uuid, ${unitA2}::uuid, ${unitB}::uuid)`);
    await db.execute(sql`DELETE FROM properties WHERE id IN (${propA}::uuid, ${propB}::uuid)`);
    await db.execute(sql`DELETE FROM profiles WHERE id IN (${userA}::uuid, ${userB}::uuid)`);
    await db.execute(sql`DELETE FROM organizations WHERE id IN (${orgA}::uuid, ${orgB}::uuid)`);
  } catch (err) {
    console.warn('Cleanup-Fehler (non-fatal):', (err as Error).message);
  }
}

// ── App Builder ───────────────────────────────────────────────────────────────

function buildApp(organizationId: string | null, userId: string = uuidv4()) {
  const app = express();
  app.use(express.json());
  // Mock-Session: isAuthenticated wird im Router geprüft
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organizationId };
    (req as any).isAuthenticated = () => organizationId !== null;
    next();
  });
  addOrgContext(app, organizationId);
  app.use(tenantRoutes);
  return app;
}

beforeAll(async () => { await seed(); });
afterAll(async () => { await cleanup(); });

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/tenants/expiring-leases — Org-Isolierung', () => {
  test('Org A sieht nur ihren eigenen Vertrag (tenantA, in 30 Tagen)', async () => {
    const app = buildApp(orgA, userA);
    const res = await request(app).get('/api/tenants/expiring-leases?days=90');
    expect(res.status).toBe(200);
    const ids = res.body.map((r: any) => r.tenantId);
    expect(ids).toContain(tenantA);
    expect(ids).not.toContain(tenantB);
  });

  test('Org B sieht nur ihren eigenen Vertrag (tenantB, in 60 Tagen)', async () => {
    const app = buildApp(orgB, userB);
    const res = await request(app).get('/api/tenants/expiring-leases?days=90');
    expect(res.status).toBe(200);
    const ids = res.body.map((r: any) => r.tenantId);
    expect(ids).toContain(tenantB);
    expect(ids).not.toContain(tenantA);
  });

  test('Cross-Org-Mismatch: Mieter Org A mit lease.unitId Org B → erscheint für KEINE Org', async () => {
    // tenantMismatch gehört zu unitA2 (Org A), sein Mietvertrag verweist aber auf unitB (Org B).
    // Korrekte Sicherheits-Semantik:
    //   Org A: Route filtert via lease.unitId → unit.property_id → organization_id, daher kein Match.
    //   Org B: RLS-Policy auf tenants filtert nach tenant.organization_id (= Org A), daher nicht sichtbar.
    // Inkonsistente Cross-Org-Daten sind für beide Orgs unsichtbar → korrekt isoliert.
    const appA = buildApp(orgA, userA);
    const resA = await request(appA).get('/api/tenants/expiring-leases?days=90');
    expect(resA.status).toBe(200);
    const idsForA = resA.body.map((r: any) => r.tenantId);
    expect(idsForA).not.toContain(tenantMismatch);

    const appB = buildApp(orgB, userB);
    const resB = await request(appB).get('/api/tenants/expiring-leases?days=90');
    expect(resB.status).toBe(200);
    const idsForB = resB.body.map((r: any) => r.tenantId);
    expect(idsForB).not.toContain(tenantMismatch);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/tenants/expiring-leases — Schwellwert und Grenzfälle', () => {
  test('days=29: Vertrag in 30 Tagen erscheint NICHT (außerhalb Fenster)', async () => {
    const app = buildApp(orgA, userA);
    const res = await request(app).get('/api/tenants/expiring-leases?days=29');
    expect(res.status).toBe(200);
    const ids = res.body.map((r: any) => r.tenantId);
    expect(ids).not.toContain(tenantA);
  });

  test('days=30: Vertrag genau am 30. Tag erscheint (Grenzwert inklusiv)', async () => {
    const app = buildApp(orgA, userA);
    const res = await request(app).get('/api/tenants/expiring-leases?days=30');
    expect(res.status).toBe(200);
    const ids = res.body.map((r: any) => r.tenantId);
    expect(ids).toContain(tenantA);
  });

  test('daysUntilExpiry ist kalendarisch korrekt (keine Uhrzeitverschiebung)', async () => {
    const app = buildApp(orgA, userA);
    const res = await request(app).get('/api/tenants/expiring-leases?days=90');
    expect(res.status).toBe(200);
    const entry = res.body.find((r: any) => r.tenantId === tenantA);
    expect(entry).toBeDefined();
    // Exakt 30 Kalendertage — unabhängig von der Uhrzeit des Tests
    expect(entry.daysUntilExpiry).toBe(30);
  });

  test('Nicht-befristete aktive Verträge erscheinen nicht im Ergebnis', async () => {
    const leaseId = uuidv4();
    await db.execute(sql`
      INSERT INTO leases (id, tenant_id, unit_id, start_date, grundmiete, befristet, status)
      VALUES (${leaseId}::uuid, ${tenantA}::uuid, ${unitA}::uuid, '2024-06-01', 500.00, false, 'aktiv')
      ON CONFLICT DO NOTHING
    `);
    try {
      const app = buildApp(orgA, userA);
      const res = await request(app).get('/api/tenants/expiring-leases?days=90');
      expect(res.status).toBe(200);
      // Alle zurückgegebenen Einträge müssen ein befristungEnde haben
      for (const entry of res.body) {
        expect(entry.befristungEnde).toBeTruthy();
      }
    } finally {
      await db.execute(sql`DELETE FROM leases WHERE id = ${leaseId}::uuid`);
    }
  });

  test('Abgelaufener Vertrag (befristungEnde = gestern) erscheint nicht', async () => {
    const leaseId = uuidv4();
    await db.execute(sql`
      INSERT INTO leases (id, tenant_id, unit_id, start_date, end_date, grundmiete, befristet, befristung_ende, status)
      VALUES (${leaseId}::uuid, ${tenantA}::uuid, ${unitA}::uuid, '2024-01-01', ${YESTERDAY}, 500.00, true, ${YESTERDAY}, 'aktiv')
      ON CONFLICT DO NOTHING
    `);
    try {
      const app = buildApp(orgA, userA);
      const res = await request(app).get('/api/tenants/expiring-leases?days=90');
      expect(res.status).toBe(200);
      const dates = res.body.map((r: any) => r.befristungEnde);
      expect(dates).not.toContain(YESTERDAY);
    } finally {
      await db.execute(sql`DELETE FROM leases WHERE id = ${leaseId}::uuid`);
    }
  });

  test('UTC-Konsistenz: beide Datumsgrenzen aus UTC-Basis (kein DST-Drift)', async () => {
    // Prüft dass todayStr und futureDateStr beide aus UTC-Arithmetik stammen.
    // In Europe/Vienna (UTC+1/+2) kann ein lokales setDate() den Grenzwert um einen
    // Tag verschieben. Der Endpoint-Code muss Date.UTC() verwenden.
    //
    // Wir injizieren einen Vertrag mit befristungEnde = exakt +90 Kalendertage (UTC)
    // und prüfen dass er bei days=90 erscheint aber bei days=89 nicht.
    const leaseId = uuidv4();
    const nowUtc = new Date();
    const y = nowUtc.getUTCFullYear();
    const m = nowUtc.getUTCMonth();
    const d = nowUtc.getUTCDate();
    const pad = (n: number) => String(n).padStart(2, '0');
    const in90utc = new Date(Date.UTC(y, m, d + 90));
    const in90str = `${in90utc.getUTCFullYear()}-${pad(in90utc.getUTCMonth() + 1)}-${pad(in90utc.getUTCDate())}`;

    await db.execute(sql`
      INSERT INTO leases (id, tenant_id, unit_id, start_date, end_date, grundmiete, befristet, befristung_ende, status)
      VALUES (${leaseId}::uuid, ${tenantA}::uuid, ${unitA}::uuid, '2023-03-01', ${in90str}, 500.00, true, ${in90str}, 'aktiv')
      ON CONFLICT DO NOTHING
    `);
    try {
      const app = buildApp(orgA, userA);

      // days=90 → Vertrag muss erscheinen
      const res90 = await request(app).get('/api/tenants/expiring-leases?days=90');
      expect(res90.status).toBe(200);
      const dates90 = res90.body.map((r: any) => r.befristungEnde);
      expect(dates90).toContain(in90str);

      // days=89 → Vertrag darf NICHT erscheinen
      const res89 = await request(app).get('/api/tenants/expiring-leases?days=89');
      expect(res89.status).toBe(200);
      const dates89 = res89.body.map((r: any) => r.befristungEnde);
      expect(dates89).not.toContain(in90str);
    } finally {
      await db.execute(sql`DELETE FROM leases WHERE id = ${leaseId}::uuid`);
    }
  });

  test('Vertrag in 91 Tagen erscheint nicht bei days=90 (außerhalb Fenster)', async () => {
    const leaseId = uuidv4();
    await db.execute(sql`
      INSERT INTO leases (id, tenant_id, unit_id, start_date, end_date, grundmiete, befristet, befristung_ende, status)
      VALUES (${leaseId}::uuid, ${tenantA}::uuid, ${unitA}::uuid, '2023-07-01', ${IN_91}, 500.00, true, ${IN_91}, 'aktiv')
      ON CONFLICT DO NOTHING
    `);
    try {
      const app = buildApp(orgA, userA);
      const res = await request(app).get('/api/tenants/expiring-leases?days=90');
      expect(res.status).toBe(200);
      const dates = res.body.map((r: any) => r.befristungEnde);
      expect(dates).not.toContain(IN_91);
    } finally {
      await db.execute(sql`DELETE FROM leases WHERE id = ${leaseId}::uuid`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/tenants/expiring-leases — Authentifizierung', () => {
  test('Kein Org-Kontext → 403', async () => {
    const app = buildApp(null);
    const res = await request(app).get('/api/tenants/expiring-leases');
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/tenants/expiring-leases — PII-Schutz Tester-Rolle', () => {
  const testerUserId = uuidv4();

  beforeAll(async () => {
    // Tester-Profil in Org A anlegen
    await db.execute(sql`
      INSERT INTO profiles (id, email, organization_id)
      VALUES (${testerUserId}::uuid, ${'el-tester-' + testerUserId.slice(0,8) + '@test.at'}, ${orgA}::uuid)
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO user_roles (user_id, role)
      VALUES (${testerUserId}::uuid, 'tester')
      ON CONFLICT DO NOTHING
    `);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${testerUserId}::uuid`);
    await db.execute(sql`DELETE FROM profiles WHERE id = ${testerUserId}::uuid`);
  });

  test('Tester erhält keine Klartext-PII (firstName, lastName, email maskiert)', async () => {
    const app = buildApp(orgA, testerUserId);
    const res = await request(app).get('/api/tenants/expiring-leases?days=90');
    expect(res.status).toBe(200);

    // Muss mindestens einen Eintrag für Org A enthalten (tenantA)
    expect(res.body.length).toBeGreaterThan(0);

    for (const entry of res.body) {
      // Nach maskPersonalData darf kein Klartext-Name/E-Mail-Feld den echten Wert enthalten.
      // maskPersonalData ersetzt Werte durch '***' oder ähnliches.
      const firstName: string = entry.firstName ?? '';
      const lastName: string  = entry.lastName  ?? '';
      const email: string     = entry.email      ?? '';

      // Echte Namen/E-Mails aus dem Seed dürfen nicht im Klartext erscheinen
      expect(firstName).not.toBe('TenantA');
      expect(lastName).not.toBe('OrgA');
      expect(email).not.toMatch(/@a\.test$/);
    }
  });
});
