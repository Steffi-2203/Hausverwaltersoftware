/**
 * MRG-Richtwert-Check — HTTP-Integrationstests (state-transition Szenarien)
 *
 * Prüft ob der Endpoint GET /api/tenants/:id/mrg-check korrekte Ergebnisse
 * liefert nachdem Bundesland oder Befristung IN DER DB geändert wurden.
 *
 * Kernprinzip: Ein einziger Tenant wird verwendet; DB-Mutation zwischen zwei
 * Endpoint-Aufrufen zeigt ob das System den aktuellen Zustand liest.
 *
 * Test-Cases gemäß Task #87:
 *  A. Bundesland-Wechsel (Wien → Salzburg):
 *     - Wien 75 m²: HMZ=500,25 → Grundmiete 600 > 500,25 → überschritten
 *     - UPDATE property bundesland='Salzburg'
 *     - Salzburg 75 m²: HMZ=691,50 → Grundmiete 600 < 691,50 → nicht mehr überschritten
 *
 *  B. Befristung gesetzt (befristet=false → endDate gesetzt):
 *     - Wien 75 m², unbefristet: HMZ=500,25 → Grundmiete 380 < 500,25 → ok
 *     - UPDATE lease SET end_date='2027-12-31'
 *     - Wien 75 m², befristet: HMZ=375,19 → Grundmiete 380 > 375,19 → überschritten
 *
 *  C. Befristung-Flag gesetzt (befristet=false → befristet=true):
 *     - Wien 75 m², unbefristet: HMZ=500,25 → Grundmiete 380 < 500,25 → ok
 *     - UPDATE lease SET befristet=true
 *     - Wien 75 m², befristet: HMZ=375,19 → Grundmiete 380 > 375,19 → überschritten
 *
 *  D. Suppression bei mietrecht_typ=null und bundesland=null
 *  E. Suppression bei mietrecht_typ='frei'
 *  F. Nicht authentifiziert → 401
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../../tests/helpers/expect';

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { sql } from 'drizzle-orm';
import { rootDb } from '../db';
import richtwertRoutes from './richtwertRoutes';
import { rlsMiddleware } from '../middleware/rlsMiddleware';

// ── Test-IDs ──────────────────────────────────────────────────────────────────

const orgId  = uuidv4();
const userId = uuidv4();

// Scenario A — Bundesland-Wechsel (gleicher Tenant, gleiche Grundmiete 600)
const propBundesland  = uuidv4();
const unitBundesland  = uuidv4();
const tenantBundesland = uuidv4();
let   leaseBundesland: string;   // ID des eingefügten Lease

// Scenario B — Befristung via endDate
const propEndDate  = uuidv4();
const unitEndDate  = uuidv4();
const tenantEndDate = uuidv4();
let   leaseEndDate: string;

// Scenario C — Befristung via Flag
const propFlag  = uuidv4();
const unitFlag  = uuidv4();
const tenantFlag = uuidv4();
let   leaseFlag: string;

// Scenario D/E — Suppression
const propNull  = uuidv4();
const unitNull  = uuidv4();
const tenantNull = uuidv4();

const propFrei  = uuidv4();
const unitFrei  = uuidv4();
const tenantFrei = uuidv4();

// Scenario G — Lagezuschlag/Abschläge am Mietvertrag (Task #100)
const propZuschlag  = uuidv4();
const unitZuschlag  = uuidv4();
const tenantZuschlag = uuidv4();
let   leaseZuschlag: string;

// ── Express-Testapp ───────────────────────────────────────────────────────────

function buildTestApp(sessionUserId: string | null) {
  const app = express();
  app.use(express.json());
  // orgId in der Session damit rlsMiddleware den Org-Kontext setzen kann.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: sessionUserId, organizationId: orgId };
    next();
  });
  app.use(rlsMiddleware);
  app.use(richtwertRoutes);
  return app;
}

const authApp = buildTestApp(userId);
const anonApp = buildTestApp(null);

// ── Seed & Cleanup ────────────────────────────────────────────────────────────

async function seed() {
  await rootDb.execute(sql`
    INSERT INTO organizations (id, name, created_at)
    VALUES (${orgId}::uuid, 'MRG-RT87-Org', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO profiles (id, email, organization_id, created_at)
    VALUES (${userId}::uuid, 'mrg-rt87@example.com', ${orgId}::uuid, NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  // --- Scenario A: Bundesland-Wechsel --- property initially Wien ----
  await rootDb.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, bundesland, mietrecht_typ, created_at)
    VALUES (${propBundesland}::uuid, ${orgId}::uuid, 'RT87-BL', 'X1', 'Wien', '1010', 'Wien', 'richtwert', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status, flaeche, created_at)
    VALUES (${unitBundesland}::uuid, ${propBundesland}::uuid, 'T1', 'wohnung', 'aktiv', 75, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, mietbeginn, grundmiete, created_at)
    VALUES (${tenantBundesland}::uuid, ${unitBundesland}::uuid, 'A', 'BL', 'a.bl@t.at', 'aktiv', '2024-01-01', 600, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  const lbRes = await rootDb.execute(sql`
    INSERT INTO leases (id, tenant_id, unit_id, start_date, end_date, grundmiete, status, befristet, created_at)
    VALUES (gen_random_uuid(), ${tenantBundesland}::uuid, ${unitBundesland}::uuid,
            '2024-01-01', NULL, 600, 'aktiv', false, NOW())
    RETURNING id
  `);
  leaseBundesland = (lbRes.rows[0] as any).id as string;

  // --- Scenario B: Befristung via endDate --- lease initially unbefristet ----
  await rootDb.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, bundesland, mietrecht_typ, created_at)
    VALUES (${propEndDate}::uuid, ${orgId}::uuid, 'RT87-ED', 'X2', 'Wien', '1010', 'Wien', 'richtwert', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status, flaeche, created_at)
    VALUES (${unitEndDate}::uuid, ${propEndDate}::uuid, 'T1', 'wohnung', 'aktiv', 75, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, mietbeginn, grundmiete, created_at)
    VALUES (${tenantEndDate}::uuid, ${unitEndDate}::uuid, 'C', 'ED', 'c.ed@t.at', 'aktiv', '2024-01-01', 380, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  const leRes = await rootDb.execute(sql`
    INSERT INTO leases (id, tenant_id, unit_id, start_date, end_date, grundmiete, status, befristet, created_at)
    VALUES (gen_random_uuid(), ${tenantEndDate}::uuid, ${unitEndDate}::uuid,
            '2024-01-01', NULL, 380, 'aktiv', false, NOW())
    RETURNING id
  `);
  leaseEndDate = (leRes.rows[0] as any).id as string;

  // --- Scenario C: Befristung via Flag --- lease initially befristet=false ----
  await rootDb.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, bundesland, mietrecht_typ, created_at)
    VALUES (${propFlag}::uuid, ${orgId}::uuid, 'RT87-FL', 'X3', 'Wien', '1010', 'Wien', 'richtwert', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status, flaeche, created_at)
    VALUES (${unitFlag}::uuid, ${propFlag}::uuid, 'T1', 'wohnung', 'aktiv', 75, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, mietbeginn, grundmiete, created_at)
    VALUES (${tenantFlag}::uuid, ${unitFlag}::uuid, 'E', 'FL', 'e.fl@t.at', 'aktiv', '2024-01-01', 380, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  const lfRes = await rootDb.execute(sql`
    INSERT INTO leases (id, tenant_id, unit_id, start_date, end_date, grundmiete, status, befristet, created_at)
    VALUES (gen_random_uuid(), ${tenantFlag}::uuid, ${unitFlag}::uuid,
            '2024-01-01', NULL, 380, 'aktiv', false, NOW())
    RETURNING id
  `);
  leaseFlag = (lfRes.rows[0] as any).id as string;

  // --- Scenario D: mietrecht_typ=null, bundesland=null ---
  await rootDb.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, bundesland, mietrecht_typ, created_at)
    VALUES (${propNull}::uuid, ${orgId}::uuid, 'RT87-Null', 'X4', 'Wien', '1010', NULL, NULL, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status, flaeche, created_at)
    VALUES (${unitNull}::uuid, ${propNull}::uuid, 'T1', 'wohnung', 'aktiv', 75, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, mietbeginn, grundmiete, created_at)
    VALUES (${tenantNull}::uuid, ${unitNull}::uuid, 'G', 'NL', 'g.nl@t.at', 'aktiv', '2024-01-01', 900, NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  // --- Scenario E: mietrecht_typ='frei' ---
  await rootDb.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, bundesland, mietrecht_typ, created_at)
    VALUES (${propFrei}::uuid, ${orgId}::uuid, 'RT87-Frei', 'X5', 'Wien', '1010', 'Wien', 'frei', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status, flaeche, created_at)
    VALUES (${unitFrei}::uuid, ${propFrei}::uuid, 'T1', 'wohnung', 'aktiv', 75, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, mietbeginn, grundmiete, created_at)
    VALUES (${tenantFrei}::uuid, ${unitFrei}::uuid, 'I', 'FR', 'i.fr@t.at', 'aktiv', '2024-01-01', 900, NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  // --- Scenario G: Lagezuschlag/Abschläge --- Wien 75 m², Grundmiete 520 ----
  await rootDb.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, bundesland, mietrecht_typ, created_at)
    VALUES (${propZuschlag}::uuid, ${orgId}::uuid, 'RT100-ZU', 'X6', 'Wien', '1010', 'Wien', 'richtwert', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status, flaeche, created_at)
    VALUES (${unitZuschlag}::uuid, ${propZuschlag}::uuid, 'T1', 'wohnung', 'aktiv', 75, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, mietbeginn, grundmiete, created_at)
    VALUES (${tenantZuschlag}::uuid, ${unitZuschlag}::uuid, 'K', 'ZU', 'k.zu@t.at', 'aktiv', '2024-01-01', 520, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  const lzRes = await rootDb.execute(sql`
    INSERT INTO leases (id, tenant_id, unit_id, start_date, end_date, grundmiete, status, befristet, created_at)
    VALUES (gen_random_uuid(), ${tenantZuschlag}::uuid, ${unitZuschlag}::uuid,
            '2024-01-01', NULL, 520, 'aktiv', false, NOW())
    RETURNING id
  `);
  leaseZuschlag = (lzRes.rows[0] as any).id as string;
}

async function cleanup() {
  const allTenants = [tenantBundesland, tenantEndDate, tenantFlag, tenantNull, tenantFrei, tenantZuschlag];
  for (const tid of allTenants) {
    await rootDb.execute(sql`DELETE FROM leases WHERE tenant_id = ${tid}::uuid`);
  }
  await rootDb.execute(sql`
    DELETE FROM tenants WHERE id IN (
      ${tenantBundesland}::uuid, ${tenantEndDate}::uuid, ${tenantFlag}::uuid,
      ${tenantNull}::uuid, ${tenantFrei}::uuid, ${tenantZuschlag}::uuid
    )
  `);
  await rootDb.execute(sql`
    DELETE FROM units WHERE id IN (
      ${unitBundesland}::uuid, ${unitEndDate}::uuid, ${unitFlag}::uuid,
      ${unitNull}::uuid, ${unitFrei}::uuid, ${unitZuschlag}::uuid
    )
  `);
  await rootDb.execute(sql`
    DELETE FROM properties WHERE id IN (
      ${propBundesland}::uuid, ${propEndDate}::uuid, ${propFlag}::uuid,
      ${propNull}::uuid, ${propFrei}::uuid, ${propZuschlag}::uuid
    )
  `);
  await rootDb.execute(sql`DELETE FROM profiles WHERE id = ${userId}::uuid`);
  await rootDb.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/tenants/:id/mrg-check — Bundesland & Befristung (state-transition)', () => {
  beforeAll(async () => { await seed(); });
  afterAll(async () => { await cleanup(); });

  // ── Auth guard ──────────────────────────────────────────────────────────────

  test('nicht authentifiziert → 401', async () => {
    const res = await request(anonApp).get(`/api/tenants/${tenantBundesland}/mrg-check`);
    expect(res.status).toBe(401);
  });

  // ── Scenario A: Bundesland-Wechsel Wien → Salzburg ─────────────────────────

  test('[A1] Wien: Grundmiete 600 > HMZ 500,25 → überschritten', async () => {
    // Property has bundesland='Wien', Richtwert 6,67 €/m², 75 m² → HMZ=500,25
    const res = await request(authApp).get(`/api/tenants/${tenantBundesland}/mrg-check`);
    expect(res.status).toBe(200);
    expect(res.body.ueberschritten).toBe(true);
    expect(res.body.zulassigerHmz).toBeCloseTo(500.25, 1);
    expect(res.body.berechnungsgrundlage).toContain('Wien');
    expect(res.body.berechnungsgrundlage).toContain('6.67');
  });

  test('[A2] Bundesland Wien→Salzburg: gleicher Tenant, Grundmiete 600 < HMZ 691,50 → nicht mehr überschritten', async () => {
    // Mutate the property to Salzburg
    await rootDb.execute(sql`
      UPDATE properties SET bundesland = 'Salzburg' WHERE id = ${propBundesland}::uuid
    `);

    const res = await request(authApp).get(`/api/tenants/${tenantBundesland}/mrg-check`);
    expect(res.status).toBe(200);
    expect(res.body.ueberschritten).toBe(false);           // Ergebnis hat sich geändert!
    expect(res.body.zulassigerHmz).toBeCloseTo(691.50, 1); // Salzburg 9,22 × 75
    expect(res.body.berechnungsgrundlage).toContain('Salzburg');
    expect(res.body.berechnungsgrundlage).toContain('9.22');
  });

  // ── Scenario B: Befristung via endDate setzen ───────────────────────────────

  test('[B1] Unbefristet (endDate=null): Grundmiete 380 < HMZ 500,25 → nicht überschritten', async () => {
    // Lease has end_date=NULL, befristet=false → kein 25%-Abschlag
    const res = await request(authApp).get(`/api/tenants/${tenantEndDate}/mrg-check`);
    expect(res.status).toBe(200);
    expect(res.body.ueberschritten).toBe(false);
    expect(res.body.zulassigerHmz).toBeCloseTo(500.25, 1);
  });

  test('[B2] endDate gesetzt (befristet=false→abgeleitet): gleicher Tenant, Grundmiete 380 > HMZ 375,19 → überschritten', async () => {
    // Mutate the lease: set end_date (befristet bleibt false — Route leitet Befristung aus endDate ab)
    await rootDb.execute(sql`
      UPDATE leases SET end_date = '2027-12-31' WHERE id = ${leaseEndDate}::uuid
    `);

    const res = await request(authApp).get(`/api/tenants/${tenantEndDate}/mrg-check`);
    expect(res.status).toBe(200);
    expect(res.body.ueberschritten).toBe(true);            // Ergebnis hat sich geändert!
    expect(res.body.zulassigerHmz).toBeCloseTo(375.19, 1); // 500,25 × 0,75
  });

  // ── Scenario C: Befristung via explizitem Flag setzen ──────────────────────

  test('[C1] Unbefristet (befristet=false): Grundmiete 380 < HMZ 500,25 → nicht überschritten', async () => {
    const res = await request(authApp).get(`/api/tenants/${tenantFlag}/mrg-check`);
    expect(res.status).toBe(200);
    expect(res.body.ueberschritten).toBe(false);
    expect(res.body.zulassigerHmz).toBeCloseTo(500.25, 1);
  });

  test('[C2] befristet=true gesetzt: gleicher Tenant, Grundmiete 380 > HMZ 375,19 → überschritten', async () => {
    // Mutate the lease: set befristet=true (endDate bleibt NULL — explizites Flag)
    await rootDb.execute(sql`
      UPDATE leases SET befristet = true WHERE id = ${leaseFlag}::uuid
    `);

    const res = await request(authApp).get(`/api/tenants/${tenantFlag}/mrg-check`);
    expect(res.status).toBe(200);
    expect(res.body.ueberschritten).toBe(true);            // Ergebnis hat sich geändert!
    expect(res.body.zulassigerHmz).toBeCloseTo(375.19, 1);
  });

  // ── Scenario G: Lagezuschlag/Abschläge aus dem Mietvertrag (Task #100) ─────

  test('[G1] Ohne Lagezuschlag/Abschläge: Grundmiete 520 > HMZ 500,25 → überschritten', async () => {
    const res = await request(authApp).get(`/api/tenants/${tenantZuschlag}/mrg-check`);
    expect(res.status).toBe(200);
    expect(res.body.ueberschritten).toBe(true);
    expect(res.body.zulassigerHmz).toBeCloseTo(500.25, 1);
  });

  test('[G2] Lagezuschlag 0,50 €/m² gespeichert: HMZ steigt auf 537,75 → nicht mehr überschritten', async () => {
    // Neue Formel (§ 16 Abs. 2 MRG): HMZ = (Richtwert + Lagezuschlag_€/m² + Abschläge_€/m²) × m²
    // (6,67 + 0,50) × 75 = 537,75 > Grundmiete 520 → nicht überschritten
    await rootDb.execute(sql`
      UPDATE leases SET lagezuschlag = 0.50 WHERE id = ${leaseZuschlag}::uuid
    `);
    const res = await request(authApp).get(`/api/tenants/${tenantZuschlag}/mrg-check`);
    expect(res.status).toBe(200);
    expect(res.body.ueberschritten).toBe(false);
    expect(res.body.zulassigerHmz).toBeCloseTo(537.75, 1);
  });

  test('[G3] Abschläge -0,50 €/m² zusätzlich gespeichert: HMZ sinkt auf 500,25 → wieder überschritten', async () => {
    // (6,67 + 0,50 − 0,50) × 75 = 6,67 × 75 = 500,25 < Grundmiete 520 → überschritten
    await rootDb.execute(sql`
      UPDATE leases SET abschlaege = -0.50 WHERE id = ${leaseZuschlag}::uuid
    `);
    const res = await request(authApp).get(`/api/tenants/${tenantZuschlag}/mrg-check`);
    expect(res.status).toBe(200);
    expect(res.body.ueberschritten).toBe(true);
    expect(res.body.zulassigerHmz).toBeCloseTo(500.25, 1);
  });

  test('[G4] DB-Constraints: negativer Lagezuschlag und positive Abschläge werden abgelehnt', async () => {
    // Drizzle verpackt den PG-Fehler; Constraint-Name steckt in error.cause.
    await expect(rootDb.execute(sql`
      UPDATE leases SET lagezuschlag = -0.10 WHERE id = ${leaseZuschlag}::uuid
    `)).rejects.toThrow();
    await expect(rootDb.execute(sql`
      UPDATE leases SET abschlaege = 0.10 WHERE id = ${leaseZuschlag}::uuid
    `)).rejects.toThrow();
    // Werte unverändert (0,50 / -0,50 aus G2/G3)
    const rowRes = await rootDb.execute(sql`
      SELECT lagezuschlag, abschlaege FROM leases WHERE id = ${leaseZuschlag}::uuid
    `);
    const r = rowRes.rows[0] as any;
    expect(Number(r.lagezuschlag)).toBeCloseTo(0.50, 2);
    expect(Number(r.abschlaege)).toBeCloseTo(-0.50, 2);
  });

  // ── Scenario D & E: Suppression ────────────────────────────────────────────

  test('[D] mietrecht_typ=null, bundesland=null → Warnung unterdrückt', async () => {
    const res = await request(authApp).get(`/api/tenants/${tenantNull}/mrg-check`);
    expect(res.status).toBe(200);
    expect(res.body.ueberschritten).toBe(false);
    expect(res.body.zulassigerHmz).toBeNull();
    expect(res.body.berechnungsgrundlage).toContain('unterdrückt');
  });

  test('[E] mietrecht_typ=frei (ABGB) → Warnung unterdrückt', async () => {
    const res = await request(authApp).get(`/api/tenants/${tenantFrei}/mrg-check`);
    expect(res.status).toBe(200);
    expect(res.body.ueberschritten).toBe(false);
    expect(res.body.zulassigerHmz).toBeNull();
  });

  // ── Scenario F: Bundesland-Wechsel zurück (Salzburg → Wien), Ergebnis kehrt um ──

  test('[F] Salzburg→Wien zurücksetzen: Grundmiete 600 > HMZ 500,25 → wieder überschritten', async () => {
    // Rücksetzen auf Wien — prüft dass das System keine gecachten Werte liefert
    await rootDb.execute(sql`
      UPDATE properties SET bundesland = 'Wien' WHERE id = ${propBundesland}::uuid
    `);

    const res = await request(authApp).get(`/api/tenants/${tenantBundesland}/mrg-check`);
    expect(res.status).toBe(200);
    expect(res.body.ueberschritten).toBe(true);            // Zurück zum ursprünglichen Ergebnis
    expect(res.body.zulassigerHmz).toBeCloseTo(500.25, 1);
    expect(res.body.berechnungsgrundlage).toContain('Wien');
  });
});
