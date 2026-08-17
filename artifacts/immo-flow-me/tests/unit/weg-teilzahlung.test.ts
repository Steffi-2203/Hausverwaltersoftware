/**
 * WEG-Vorschreibungen Teilzahlung — Integrationstests
 *
 * Prüft dass:
 *  1. Status 'teilbezahlt' ohne paid_amount → 400 mit verständlicher Fehlermeldung
 *  2. Status 'teilbezahlt' mit paid_amount → gesetzt & korrekt gespeichert
 *  3. Status 'bezahlt' → paid_amount wird automatisch auf gesamtbetrag gesetzt
 *  4. Status 'offen' → paid_amount wird auf null zurückgesetzt
 *  5. paid_amount ≤ 0 → 400 Fehler
 *  6. getOwnerPrepayments: teilbezahlt mit paid_amount liefert korrekten Saldo
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { rootDb as db } from '../../server/db';
import { sql, eq, and } from 'drizzle-orm';
import { wegVorschreibungen, organizations, profiles, properties, units, owners, userRoles, insertWegVorschreibungSchema } from '@shared/schema';
import { v4 as uuidv4 } from 'uuid';
import wegRouter from '../../server/routes/wegRoutes';
import { addOrgContext } from '../helpers/withOrgContext';
import { setupTestDb, teardownTestDb } from '../helpers/db';
import { getOwnerPrepayments, calculateOwnerSettlement } from '../../server/services/wegSettlementService';

// ── Testdaten ────────────────────────────────────────────────────────────────
const orgId      = uuidv4();
const userId     = uuidv4();
const propId     = uuidv4();
const unitId     = uuidv4();
const ownerId    = uuidv4();
let vorschreibungId: string;

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
const anonApp = buildApp(null);

// ── Seed & Cleanup ───────────────────────────────────────────────────────────
async function seed() {
  await db.execute(sql`
    INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'WEG-Test-Org') ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO profiles (id, email, organization_id) VALUES (${userId}::uuid, 'weg-test@test.at', ${orgId}::uuid) ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'WEG-Test-Obj', 'Str 1', 'Wien', '1010', 'weg') ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status)
    VALUES (${unitId}::uuid, ${propId}::uuid, 'Top 1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name, email)
    VALUES (${ownerId}::uuid, ${orgId}::uuid, 'Max', 'Owner', 'owner@test.at') ON CONFLICT DO NOTHING
  `);
  // Rolle 'admin' für checkMutationPermission
  await db.execute(sql`
    INSERT INTO user_roles (user_id, role) VALUES (${userId}::uuid, 'admin') ON CONFLICT DO NOTHING
  `);

  // Eine Vorschreibung mit Gesamtbetrag 250 €
  const res = await db.execute(sql`
    INSERT INTO weg_vorschreibungen
      (id, organization_id, property_id, unit_id, owner_id, year, month, mea_share,
       betriebskosten, ruecklage, instandhaltung, verwaltungshonorar, heizung, ust,
       gesamtbetrag, status)
    VALUES
      (gen_random_uuid(), ${orgId}::uuid, ${propId}::uuid, ${unitId}::uuid, ${ownerId}::uuid,
       2030, 1, 10.00, 100, 50, 30, 30, 20, 20, 250.00, 'offen')
    RETURNING id
  `);
  vorschreibungId = (res.rows as any[])[0].id;
}

async function cleanup() {
  await db.execute(sql`DELETE FROM weg_vorschreibungen WHERE id = ${vorschreibungId}::uuid`);
  await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${userId}::uuid`);
  await db.execute(sql`DELETE FROM owners     WHERE id = ${ownerId}::uuid`);
  await db.execute(sql`DELETE FROM units      WHERE id = ${unitId}::uuid`);
  await db.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
  await db.execute(sql`DELETE FROM profiles   WHERE id = ${userId}::uuid`);
  await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
}

// ── Hilfsfunktion: Status zurücksetzen ───────────────────────────────────────
async function resetStatus(status = 'offen', paidAmount: string | null = null) {
  await db.execute(sql`
    UPDATE weg_vorschreibungen
    SET status = ${status}, paid_amount = ${paidAmount}::numeric, updated_at = NOW()
    WHERE id = ${vorschreibungId}::uuid
  `);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('WEG Teilzahlung — PATCH /api/weg/vorschreibungen/:id/status', () => {
  beforeAll(async () => {
    await setupTestDb();
    await seed();
  });

  afterAll(async () => {
    await cleanup();
    await teardownTestDb();
  });

  test('teilbezahlt ohne paid_amount → 400 mit Fehlermeldung', async () => {
    const res = await request(authApp)
      .patch(`/api/weg/vorschreibungen/${vorschreibungId}/status`)
      .send({ status: 'teilbezahlt' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/paid_amount/i);
    expect(res.body.field).toBe('paid_amount');
  });

  test('teilbezahlt mit paid_amount = 0 → 400', async () => {
    const res = await request(authApp)
      .patch(`/api/weg/vorschreibungen/${vorschreibungId}/status`)
      .send({ status: 'teilbezahlt', paid_amount: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positiv/i);
  });

  test('teilbezahlt mit paid_amount = -10 → 400', async () => {
    const res = await request(authApp)
      .patch(`/api/weg/vorschreibungen/${vorschreibungId}/status`)
      .send({ status: 'teilbezahlt', paid_amount: -10 });

    expect(res.status).toBe(400);
  });

  test('teilbezahlt mit gültigem paid_amount → paid_amount korrekt gespeichert', async () => {
    await resetStatus();
    const res = await request(authApp)
      .patch(`/api/weg/vorschreibungen/${vorschreibungId}/status`)
      .send({ status: 'teilbezahlt', paid_amount: 125.50 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('teilbezahlt');
    expect(parseFloat(res.body.paid_amount)).toBeCloseTo(125.50, 2);
  });

  test('bezahlt → paid_amount automatisch auf Gesamtbetrag (250 €) gesetzt', async () => {
    await resetStatus();
    const res = await request(authApp)
      .patch(`/api/weg/vorschreibungen/${vorschreibungId}/status`)
      .send({ status: 'bezahlt' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('bezahlt');
    expect(parseFloat(res.body.paid_amount)).toBeCloseTo(250.00, 2);
  });

  test('offen nach teilbezahlt → paid_amount auf null zurückgesetzt', async () => {
    await resetStatus('teilbezahlt', '125.50');
    const res = await request(authApp)
      .patch(`/api/weg/vorschreibungen/${vorschreibungId}/status`)
      .send({ status: 'offen' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('offen');
    expect(res.body.paid_amount).toBeNull();
  });

  test('ueberfaellig → paid_amount auf null zurückgesetzt', async () => {
    await resetStatus('teilbezahlt', '75.00');
    const res = await request(authApp)
      .patch(`/api/weg/vorschreibungen/${vorschreibungId}/status`)
      .send({ status: 'ueberfaellig' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ueberfaellig');
    expect(res.body.paid_amount).toBeNull();
  });

  test('ungültiger Status → 400', async () => {
    const res = await request(authApp)
      .patch(`/api/weg/vorschreibungen/${vorschreibungId}/status`)
      .send({ status: 'bezahlt_voll' });

    expect(res.status).toBe(400);
  });

  // ── Grenzfälle für paid_amount ──────────────────────────────────────────

  test('teilbezahlt mit paid_amount = gesamtbetrag (250) → 400 (Überzahlung)', async () => {
    const res = await request(authApp)
      .patch(`/api/weg/vorschreibungen/${vorschreibungId}/status`)
      .send({ status: 'teilbezahlt', paid_amount: 250 });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('paid_amount');
  });

  test('teilbezahlt mit paid_amount > gesamtbetrag → 400', async () => {
    const res = await request(authApp)
      .patch(`/api/weg/vorschreibungen/${vorschreibungId}/status`)
      .send({ status: 'teilbezahlt', paid_amount: 999 });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('paid_amount');
  });

  test('teilbezahlt mit paid_amount = "125abc" (ungültiger Suffix) → 400', async () => {
    const res = await request(authApp)
      .patch(`/api/weg/vorschreibungen/${vorschreibungId}/status`)
      .send({ status: 'teilbezahlt', paid_amount: '125abc' });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('paid_amount');
  });

  test('teilbezahlt mit paid_amount = Infinity → 400', async () => {
    const res = await request(authApp)
      .patch(`/api/weg/vorschreibungen/${vorschreibungId}/status`)
      .send({ status: 'teilbezahlt', paid_amount: 'Infinity' });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('paid_amount');
  });

  test('teilbezahlt mit paid_amount = 0.001 (Sub-Cent) → 400 (nicht 2 Nachkommastellen)', async () => {
    const res = await request(authApp)
      .patch(`/api/weg/vorschreibungen/${vorschreibungId}/status`)
      .send({ status: 'teilbezahlt', paid_amount: '0.001' });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('paid_amount');
  });

  test('teilbezahlt mit paid_amount = 249.99 (knapp unter Gesamtbetrag) → 200', async () => {
    await resetStatus();
    const res = await request(authApp)
      .patch(`/api/weg/vorschreibungen/${vorschreibungId}/status`)
      .send({ status: 'teilbezahlt', paid_amount: 249.99 });

    expect(res.status).toBe(200);
    expect(parseFloat(res.body.paid_amount)).toBeCloseTo(249.99, 2);
  });

  test('nicht authentifiziert → 401', async () => {
    const res = await request(anonApp)
      .patch(`/api/weg/vorschreibungen/${vorschreibungId}/status`)
      .send({ status: 'bezahlt' });

    expect(res.status).toBe(401);
  });

  test('getOwnerPrepayments: teilbezahlt mit paid_amount liefert korrekten Saldo', async () => {
    // Vorschreibung auf teilbezahlt=125.50 setzen
    await resetStatus('teilbezahlt', '125.50');

    // Signatur: getOwnerPrepayments(ownerId, unitId, year) → number
    const total = await getOwnerPrepayments(ownerId, unitId, 2030);

    // totalPaid sollte 125.50 € enthalten (nicht 0 oder 250)
    expect(total).toBeCloseTo(125.50, 2);
  });

  test('getOwnerPrepayments: bezahlt liefert vollen Betrag', async () => {
    await resetStatus('bezahlt', '250.00');

    const total = await getOwnerPrepayments(ownerId, unitId, 2030);
    expect(total).toBeCloseTo(250.00, 2);
  });

  test('getOwnerPrepayments: offen liefert 0', async () => {
    await resetStatus('offen', null);

    const total = await getOwnerPrepayments(ownerId, unitId, 2030);
    // 'offen' Einträge werden nicht angerechnet
    expect(total).toBe(0);
  });
});

// ── Settlement-Preview: Saldo bei Teilzahlung korrekt ─────────────────────────
// Prüft dass calculateOwnerSettlement() die paid_amount-Logik aus getOwnerPrepayments()
// korrekt überträgt: totalIst = paid_amount (nicht gesamtbetrag), saldo = totalSoll - paid_amount.

describe('WEG Settlement Preview — Saldo mit Teilzahlung', () => {
  const settlOrgId   = uuidv4();
  const settlPropId  = uuidv4();
  const settlUnitId  = uuidv4();
  const settlOwnerId = uuidv4();
  let   settlVorId: string;

  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO organizations (id, name)
      VALUES (${settlOrgId}::uuid, 'SettlTest-Org') ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
      VALUES (${settlPropId}::uuid, ${settlOrgId}::uuid, 'SettlTest-Obj', 'Str 2', 'Wien', '1020', 'weg')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO units (id, property_id, top_nummer, type, status)
      VALUES (${settlUnitId}::uuid, ${settlPropId}::uuid, 'Top S1', 'wohnung', 'aktiv')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO owners (id, organization_id, first_name, last_name, email)
      VALUES (${settlOwnerId}::uuid, ${settlOrgId}::uuid, 'Max', 'Settl', 'settl@test.at')
      ON CONFLICT DO NOTHING
    `);
    // MEA-Anteil = 1000 (einziger Eigentümer → 100 %)
    await db.execute(sql`
      INSERT INTO weg_unit_owners (id, organization_id, property_id, unit_id, owner_id, mea_share)
      VALUES (gen_random_uuid(), ${settlOrgId}::uuid, ${settlPropId}::uuid,
              ${settlUnitId}::uuid, ${settlOwnerId}::uuid, 1000.00)
      ON CONFLICT DO NOTHING
    `);
    // Vorschreibung 250 €, teilbezahlt mit 125,50 €
    const res = await db.execute(sql`
      INSERT INTO weg_vorschreibungen
        (id, organization_id, property_id, unit_id, owner_id, year, month, mea_share,
         betriebskosten, ruecklage, instandhaltung, verwaltungshonorar, heizung, ust,
         gesamtbetrag, status, paid_amount)
      VALUES
        (gen_random_uuid(), ${settlOrgId}::uuid, ${settlPropId}::uuid,
         ${settlUnitId}::uuid, ${settlOwnerId}::uuid,
         2040, 3, 1000.00, 100, 50, 30, 30, 20, 20, 250.00, 'teilbezahlt', 125.50)
      RETURNING id
    `);
    settlVorId = (res.rows as any[])[0].id;
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM weg_vorschreibungen WHERE id = ${settlVorId}::uuid`);
    await db.execute(sql`DELETE FROM weg_unit_owners WHERE unit_id = ${settlUnitId}::uuid AND organization_id = ${settlOrgId}::uuid`);
    await db.execute(sql`DELETE FROM owners     WHERE id = ${settlOwnerId}::uuid`);
    await db.execute(sql`DELETE FROM units      WHERE id = ${settlUnitId}::uuid`);
    await db.execute(sql`DELETE FROM properties WHERE id = ${settlPropId}::uuid`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${settlOrgId}::uuid`);
  });

  test('totalIst = paid_amount (125,50), nicht gesamtbetrag (250) oder 0', async () => {
    const { ownerResults } = await calculateOwnerSettlement(settlPropId, 2040, settlOrgId);
    expect(ownerResults).toHaveLength(1);
    const r = ownerResults[0];
    // totalIst muss den tatsächlich bezahlten Betrag widerspiegeln
    expect(r.totalIst).toBeCloseTo(125.50, 2);
  });

  test('saldo = totalSoll − paid_amount (keine Ausgaben → saldo = −125,50)', async () => {
    const { ownerResults } = await calculateOwnerSettlement(settlPropId, 2040, settlOrgId);
    const r = ownerResults[0];
    // Keine Ausgaben → totalSoll = 0 → saldo = 0 − 125.50 = −125.50 (Guthaben)
    expect(r.saldo).toBeCloseTo(-125.50, 2);
  });

  test('bezahlt: totalIst = gesamtbetrag (250), saldo = −250', async () => {
    // Status auf 'bezahlt' setzen — paid_amount wird automatisch = gesamtbetrag
    await db.execute(sql`
      UPDATE weg_vorschreibungen
      SET status = 'bezahlt', paid_amount = 250.00, updated_at = NOW()
      WHERE id = ${settlVorId}::uuid
    `);
    const { ownerResults } = await calculateOwnerSettlement(settlPropId, 2040, settlOrgId);
    const r = ownerResults[0];
    expect(r.totalIst).toBeCloseTo(250.00, 2);
    expect(r.saldo).toBeCloseTo(-250.00, 2);
  });
});

// ── Schema-Ebene: insertWegVorschreibungSchema Zod-Refinement ──────────────────
// Prüft dass die Zod-Refinement-Regel in insertWegVorschreibungSchema greift,
// bevor Daten überhaupt an die DB weitergegeben werden.

describe('insertWegVorschreibungSchema — Zod-Refinement für teilbezahlt', () => {
  const baseValid = {
    organizationId: uuidv4(),
    propertyId: uuidv4(),
    unitId: uuidv4(),
    ownerId: uuidv4(),
    year: 2030,
    month: 1,
    meaShare: '100.00',
    betriebskosten: '100.00',
    ruecklage: '50.00',
    instandhaltung: '0.00',
    verwaltungshonorar: '30.00',
    heizung: '20.00',
    ust: '20.00',
    gesamtbetrag: '220.00',
  };

  test('teilbezahlt ohne paidAmount → Zod-Fehler', () => {
    const result = insertWegVorschreibungSchema.safeParse({
      ...baseValid,
      status: 'teilbezahlt',
      // paidAmount absichtlich weggelassen
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('paidAmount');
    }
  });

  test('teilbezahlt mit paidAmount = 0 → Zod-Fehler', () => {
    const result = insertWegVorschreibungSchema.safeParse({
      ...baseValid,
      status: 'teilbezahlt',
      paidAmount: '0.00',
    });
    expect(result.success).toBe(false);
  });

  test('teilbezahlt mit paidAmount = null → Zod-Fehler', () => {
    const result = insertWegVorschreibungSchema.safeParse({
      ...baseValid,
      status: 'teilbezahlt',
      paidAmount: null,
    });
    expect(result.success).toBe(false);
  });

  test('teilbezahlt mit gültigem paidAmount > 0 → valid', () => {
    const result = insertWegVorschreibungSchema.safeParse({
      ...baseValid,
      status: 'teilbezahlt',
      paidAmount: '110.00',
    });
    expect(result.success).toBe(true);
  });

  test('offen ohne paidAmount → valid (kein Refinement-Fehler)', () => {
    const result = insertWegVorschreibungSchema.safeParse({
      ...baseValid,
      status: 'offen',
    });
    expect(result.success).toBe(true);
  });

  test('bezahlt ohne paidAmount → valid (paidAmount wird vom Endpunkt autofilled)', () => {
    const result = insertWegVorschreibungSchema.safeParse({
      ...baseValid,
      status: 'bezahlt',
    });
    expect(result.success).toBe(true);
  });
});
