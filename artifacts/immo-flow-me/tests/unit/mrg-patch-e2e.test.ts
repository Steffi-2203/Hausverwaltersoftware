/**
 * MRG-Warnung nach Mietänderung via PATCH — End-to-End-Routentest
 *
 * Prüft den vollständigen Pfad:
 *   PATCH /api/tenants/:id  →  Server antwortet mit Tenant inkl. id
 *   GET  /api/tenants/:id/mrg-check  →  aktualisierte MRG-Werte werden zurückgegeben
 *
 * Damit wird sichergestellt dass:
 *  a) Der PATCH-Handler die `id` des aktualisierten Mieters in der Antwort enthält
 *     (Voraussetzung für invalidateAfterTenantUpdate, das data.id als Cache-Key nutzt)
 *  b) Das mrg-check-Endpoint nach einem PATCH die neue Grundmiete widerspiegelt —
 *     kein Lese-Stale aus einem alten Datenbankzustand
 *
 * Szenarien:
 *  1. Grundmiete unter Richtwert-Grenze → ueberschritten=false
 *  2. PATCH auf Wert über Richtwert-Grenze → PATCH-Response enthält id, mrg-check zeigt ueberschritten=true
 *  3. PATCH zurück unter Grenze → mrg-check zeigt ueberschritten=false
 *
 * Implementierungsdetail Wien: Richtwert 6,67 €/m² × 75 m² = 500,25 €
 *  Grundmiete 300 € → unter Grenze
 *  Grundmiete 900 € → deutlich über Grenze
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { sql } from 'drizzle-orm';

import { rootDb } from '../../server/db';
import { rlsMiddleware } from '../../server/middleware/rlsMiddleware';
import tenantRouter from '../../server/routes/tenantRoutes';
import richtwertRouter from '../../server/routes/richtwertRoutes';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const orgId     = uuidv4();
const userId    = uuidv4();
const propId    = uuidv4();
const unitId    = uuidv4();
const tenantId  = uuidv4();

// Eindeutige E-Mail pro Lauf, um Konflikte bei parallelen Läufen zu vermeiden
const USER_EMAIL = `mrg-patch-e2e-${userId.slice(0, 8)}@test.internal`;

// ── App-Builder ───────────────────────────────────────────────────────────────

/**
 * Baut eine Express-Testapp die:
 *  - Session (userId, organizationId) per Middleware injiziert
 *  - Den RLS-Org-Kontext via die echte rlsMiddleware setzt
 *  - tenantRouter und richtwertRouter einbindet
 *
 * Die 'admin'-Rolle im DB-Seed bewirkt dass requireRole("property_manager")
 * im PATCH-Handler durchgelassen wird.
 */
function buildApp(sessionUserId: string, sessionOrgId: string) {
  const app = express();
  app.use(express.json());

  // Session-Injection: simuliert eine authentifizierte Session
  app.use((req: any, _res: Response, next: NextFunction) => {
    req.session = { userId: sessionUserId, organizationId: sessionOrgId };
    next();
  });

  // Echter RLS-Kontext — identisch zur Produktions-rlsMiddleware
  app.use(rlsMiddleware);

  app.use(tenantRouter);
  app.use(richtwertRouter);
  return app;
}

const authApp = buildApp(userId, orgId);

// ── Seed & Cleanup ────────────────────────────────────────────────────────────

async function seedData() {
  await rootDb.execute(sql`
    INSERT INTO organizations (id, name, created_at)
    VALUES (${orgId}::uuid, 'MRG-Patch-E2E-Org', NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  await rootDb.execute(sql`
    INSERT INTO profiles (id, email, full_name, organization_id, created_at)
    VALUES (${userId}::uuid, ${USER_EMAIL}, 'MRG Patch Tester', ${orgId}::uuid, NOW())
    ON CONFLICT DO NOTHING
  `);

  // admin-Rolle → requireRole("property_manager") wird durch admin-Bypass durchgelassen
  await rootDb.execute(sql`
    INSERT INTO user_roles (user_id, role, created_at)
    VALUES (${userId}::uuid, 'admin', NOW())
    ON CONFLICT DO NOTHING
  `);

  // Liegenschaft: Wien, Richtwertmiete — 6,67 €/m² × 75 m² = 500,25 € Grenze
  await rootDb.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, bundesland, mietrecht_typ, created_at)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'MRG-Patch-Prop', 'Testgasse 1', 'Wien', '1010', 'Wien', 'richtwert', NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  // Einheit: 75 m² → Richtwertgrenze 500,25 €
  await rootDb.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status, flaeche, created_at)
    VALUES (${unitId}::uuid, ${propId}::uuid, 'Top E2E', 'wohnung', 'aktiv', 75, NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  // Mieter: Anfangsmiete 300 € — unter der Richtwertgrenze
  await rootDb.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, grundmiete, mietbeginn, created_at)
    VALUES (${tenantId}::uuid, ${unitId}::uuid, 'E2E', 'Tester', 'e2e-mrg@test.at', 'aktiv', 300, '2024-01-01', NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  // Aktiver unbefristeter Lease (befristet=false, end_date=NULL)
  await rootDb.execute(sql`
    INSERT INTO leases (id, tenant_id, unit_id, start_date, end_date, grundmiete, status, befristet, created_at)
    VALUES (gen_random_uuid(), ${tenantId}::uuid, ${unitId}::uuid, '2024-01-01', NULL, 300, 'aktiv', false, NOW())
    ON CONFLICT DO NOTHING
  `);
}

async function cleanupData() {
  await rootDb.execute(sql`DELETE FROM leases WHERE tenant_id = ${tenantId}::uuid`);
  await rootDb.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`);
  await rootDb.execute(sql`DELETE FROM units WHERE id = ${unitId}::uuid`);
  await rootDb.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
  await rootDb.execute(sql`DELETE FROM user_roles WHERE user_id = ${userId}::uuid`);
  await rootDb.execute(sql`DELETE FROM profiles WHERE id = ${userId}::uuid`);
  await rootDb.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MRG-Warnung nach Mietänderung via PATCH (E2E-Routentest)', () => {
  beforeAll(async () => {
    await seedData();
  });

  afterAll(async () => {
    await cleanupData();
  });

  test('Ausgangsmiete 300 € → mrg-check meldet keine Überschreitung', async () => {
    const res = await request(authApp).get(`/api/tenants/${tenantId}/mrg-check`);
    expect(res.status).toBe(200);
    // Wien: 6,67 × 75 = 500,25 € Grenze — 300 € liegt darunter
    expect(res.body.ueberschritten).toBe(false);
  });

  test('PATCH grundmiete auf 900 € → Response enthält tenant id', async () => {
    const res = await request(authApp)
      .patch(`/api/tenants/${tenantId}`)
      .send({ grundmiete: '900' });

    expect(res.status).toBe(200);
    // Die PATCH-Response MUSS die id enthalten — invalidateAfterTenantUpdate
    // verwendet data.id als Cache-Key für die mrg-check-Invalidierung
    expect(res.body.id).toBe(tenantId);
    // Und die neue Grundmiete ist in der Antwort sichtbar
    expect(Number(res.body.grundmiete)).toBe(900);
  });

  test('GET mrg-check nach PATCH → ueberschritten=true mit aktualisierter Grundmiete', async () => {
    const res = await request(authApp).get(`/api/tenants/${tenantId}/mrg-check`);
    expect(res.status).toBe(200);
    // 900 € > 500,25 € → Überschreitung
    expect(res.body.ueberschritten).toBe(true);
    // Zulässiger HMZ muss berechnet worden sein
    expect(typeof res.body.zulassigerHmz).toBe('number');
    // Unbefristeter Vertrag: kein Befristungsabschlag → Grenzwert > 375 (= 500,25 × 0,75)
    expect(res.body.zulassigerHmz).toBeGreaterThan(375);
    // differenz muss positiv sein
    expect(res.body.differenz).toBeGreaterThan(0);
  });

  test('PATCH grundmiete zurück auf 400 € → mrg-check zeigt ueberschritten=false', async () => {
    // PATCH auf einen Wert unter der Richtwertgrenze
    const patchRes = await request(authApp)
      .patch(`/api/tenants/${tenantId}`)
      .send({ grundmiete: '400' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.id).toBe(tenantId);

    // Nachfolgendes mrg-check muss die neue Miete widerspiegeln
    const checkRes = await request(authApp).get(`/api/tenants/${tenantId}/mrg-check`);
    expect(checkRes.status).toBe(200);
    // 400 € < 500,25 € → keine Überschreitung
    expect(checkRes.body.ueberschritten).toBe(false);
  });
});
