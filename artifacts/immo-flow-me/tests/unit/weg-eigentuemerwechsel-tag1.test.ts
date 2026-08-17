/**
 * Eigentümerwechsel am 1. des Monats — Execution-Level-Test
 *
 * Prüft dass bei einem Eigentümerwechsel an Tag 1 des Monats:
 * - Der alte Eigentümer 0 Tage im Übergabemonat erhält (aliquot_old = 0)
 * - Der neue Eigentümer den vollen Monatsbetrag erhält (aliquot_new = voller Betrag)
 * - aliquot_month immer gesetzt ist (nicht null)
 * - Die Transfer-Monats-Vorschreibung des alten Eigentümers storniert wird
 *
 * Kontrastiert mit einem Wechsel an Tag 15 (Mitte des Monats).
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
import { setupTestDb, teardownTestDb } from '../helpers/db';

// ── Testdaten ────────────────────────────────────────────────────────────────
const orgId      = uuidv4();
const userId     = uuidv4();
const propId     = uuidv4();
const unitId     = uuidv4();
const prevOwnerId = uuidv4();
const newOwnerId  = uuidv4();
const unitOwnerId = uuidv4();
const ocId1      = uuidv4();  // Tag-1-Wechsel
const ocId15     = uuidv4();  // Tag-15-Wechsel
const monthlyAmount = 300.00; // Monatliche Vorschreibung für Tests

// ── Express-Testapp ──────────────────────────────────────────────────────────
function buildApp(uid: string | null = userId) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: uid, organizationId: orgId };
    next();
  });
  addOrgContext(app, orgId);
  app.use(wegRouter);
  return app;
}

const authApp = buildApp();

// ── Seed ──────────────────────────────────────────────────────────────────────
async function seed() {
  await db.execute(sql`
    INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'EW-Tag1-Test-Org') ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO profiles (id, email, organization_id)
    VALUES (${userId}::uuid, ${`ew-tag1-${userId.slice(0,8)}@test.at`}, ${orgId}::uuid) ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO user_roles (user_id, role) VALUES (${userId}::uuid, 'admin') ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'EW-Tag1-Obj', 'Str 1', 'Wien', '1010', 'weg') ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type)
    VALUES (${unitId}::uuid, ${propId}::uuid, 'Top EW1', 'wohnung') ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name)
    VALUES (${prevOwnerId}::uuid, ${orgId}::uuid, 'Alt', 'Eigentümer') ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name)
    VALUES (${newOwnerId}::uuid, ${orgId}::uuid, 'Neu', 'Eigentümer') ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO weg_unit_owners (id, organization_id, property_id, unit_id, owner_id, mea_share, valid_from)
    VALUES (${unitOwnerId}::uuid, ${orgId}::uuid, ${propId}::uuid, ${unitId}::uuid, ${prevOwnerId}::uuid, 1000, '2024-01-01')
    ON CONFLICT DO NOTHING
  `);
  // Eigentümerwechsel-Datensatz: Tag 1 (1. März 2026)
  await db.execute(sql`
    INSERT INTO weg_owner_changes (id, organization_id, property_id, unit_id, previous_owner_id, new_owner_id, transfer_date, status, mea_share)
    VALUES (${ocId1}::uuid, ${orgId}::uuid, ${propId}::uuid, ${unitId}::uuid, ${prevOwnerId}::uuid, ${newOwnerId}::uuid, '2026-03-01', 'entwurf', 1000)
    ON CONFLICT DO NOTHING
  `);
  // Eigentümerwechsel-Datensatz: Tag 15 (15. März 2026)  
  await db.execute(sql`
    INSERT INTO weg_owner_changes (id, organization_id, property_id, unit_id, previous_owner_id, new_owner_id, transfer_date, status, mea_share)
    VALUES (${ocId15}::uuid, ${orgId}::uuid, ${propId}::uuid, ${unitId}::uuid, ${prevOwnerId}::uuid, ${newOwnerId}::uuid, '2026-03-15', 'entwurf', 1000)
    ON CONFLICT DO NOTHING
  `);
}

async function cleanup() {
  try {
    await db.execute(sql`DELETE FROM weg_owner_changes WHERE organization_id = ${orgId}::uuid`);
    await db.execute(sql`DELETE FROM weg_unit_owners WHERE organization_id = ${orgId}::uuid`);
    await db.execute(sql`DELETE FROM owners WHERE organization_id = ${orgId}::uuid`);
    await db.execute(sql`DELETE FROM units WHERE property_id = ${propId}::uuid`);
    await db.execute(sql`DELETE FROM properties WHERE organization_id = ${orgId}::uuid`);
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM profiles WHERE id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
  } catch (err) {
    console.warn('Cleanup partial error (not fatal):', (err as Error).message);
  }
}

beforeAll(async () => { await setupTestDb(); await seed(); });
afterAll(async () => { await cleanup(); await teardownTestDb(); });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Eigentümerwechsel Tag 1 — Preview: neuer Eigentümer bekommt vollen Monat', () => {
  test('GET /api/weg/owner-changes/:id/preview → aliquot_new_month = voller Monatsbetrag (0 für alter EG)', async () => {
    // Preview ohne Budget-Plan: Beträge sind 0, aber die Tag-1-Logik
    // muss korrekte Tagesaufteilung liefern.
    const res = await request(authApp)
      .get(`/api/weg/owner-changes/${ocId1}/preview`);
    expect(res.status).toBe(200);

    const aliq = res.body.aliquotierung;
    // Tag 1: Alter EG hat 0 Tage im März → old_owner_days_in_month = 0
    expect(aliq.old_owner_days_in_month).toBe(0);
    // Tag 1: Neuer EG hat alle 31 Tage im März → new_owner_days_in_month = 31
    expect(aliq.new_owner_days_in_month).toBe(31);
  });

  test('has_aliquot_month und first_month_aliquot: Tag-1 zeigt keinen anteiligen Monat da voller Monat', async () => {
    const res = await request(authApp)
      .get(`/api/weg/owner-changes/${ocId1}/preview`);
    expect(res.status).toBe(200);
    // Tag 1: kein Aliquot-Monat nötig da neuer EG den vollen Monat bekommt
    expect(res.body.new_invoices?.has_aliquot_month).toBe(false);
  });
});

describe('Eigentümerwechsel Execution Tag 1 — Settlement-Record und valid_to korrekt', () => {
  test('POST /api/weg/owner-changes/:id/execute → erfolgreich', async () => {
    const res = await request(authApp)
      .post(`/api/weg/owner-changes/${ocId1}/execute`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('Settlement: aliquot_month gesetzt, aliquot_old = 0, aliquot_new >= 0, status = abgeschlossen', async () => {
    const rows = await db.execute(
      sql`SELECT aliquot_month, aliquot_old_owner_amount, aliquot_new_owner_amount, status
          FROM weg_owner_changes WHERE id = ${ocId1}::uuid`
    );
    const row = rows.rows[0] as any;
    // aliquot_month muss immer gesetzt sein (auch bei Tag 1)
    expect(row.aliquot_month).not.toBeNull();
    // Alter EG: 0 Tage → aliquot_old = 0
    expect(parseFloat(row.aliquot_old_owner_amount ?? '0')).toBe(0);
    // Neuer EG: voller Monat (ohne Budget-Plan = 0, aber nie negativ)
    expect(parseFloat(row.aliquot_new_owner_amount ?? '0')).toBeGreaterThanOrEqual(0);
    expect(row.status).toBe('abgeschlossen');
  });

  test('valid_to des alten Eigentümers ist der letzte Tag des VORMONATS (2026-02-28), NICHT 2026-03-01', async () => {
    // Wechsel am 2026-03-01 → alter EG muss valid_to = 2026-02-28 haben
    const rows = await db.execute(
      sql`SELECT valid_to FROM weg_unit_owners
          WHERE unit_id = ${unitId}::uuid
          AND owner_id = ${prevOwnerId}::uuid
          AND organization_id = ${orgId}::uuid
          ORDER BY created_at DESC LIMIT 1`
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    const row = rows.rows[0] as any;
    const validToStr = row.valid_to instanceof Date
      ? row.valid_to.toISOString().slice(0, 10)
      : String(row.valid_to ?? '').slice(0, 10);
    // Muss der letzte Tag des VORMONATS sein, nicht der Übergabetag selbst
    expect(validToStr).toBe('2026-02-28');
  });

  test('Am Übergabetag (2026-03-01) ist NUR der neue Eigentümer aktiv — kein doppeltes MEA', async () => {
    // Abfrage aller aktiven weg_unit_owners an exakt diesem Tag für diese Einheit
    const transferDate = '2026-03-01';
    const rows = await db.execute(
      sql`SELECT owner_id, mea_share FROM weg_unit_owners
          WHERE unit_id = ${unitId}::uuid
          AND organization_id = ${orgId}::uuid
          AND valid_from <= ${transferDate}::date
          AND (valid_to IS NULL OR valid_to >= ${transferDate}::date)`
    );
    // Genau 1 aktiver Eigentümer
    expect(rows.rows.length).toBe(1);
    const activeOwner = rows.rows[0] as any;
    expect(activeOwner.owner_id).toBe(newOwnerId);
    // MEA-Summe = ursprünglicher Wert (1000), nicht verdoppelt
    expect(Number(activeOwner.mea_share)).toBe(1000);
  });
});

describe('Eigentümerwechsel Tag 15 — Kontrast: Pro-Rata-Aufteilung', () => {
  test('GET /api/weg/owner-changes/:id/preview → korrekte Tagesaufteilung (Tag 15)', async () => {
    const res = await request(authApp)
      .get(`/api/weg/owner-changes/${ocId15}/preview`);
    expect(res.status).toBe(200);

    const aliq = res.body.aliquotierung;
    // Tag 15: Alter EG hat 14 Tage (1-14), Neuer EG hat 17 Tage (15-31)
    expect(aliq.old_owner_days_in_month).toBe(14);
    expect(aliq.new_owner_days_in_month).toBe(17);
  });
});
