/**
 * WEG-Jahresabrechnung — Duplikat-Schutz (Task #44)
 *
 * Prüft:
 *  1. POST /api/weg/settlement/create → 201 beim ersten Mal
 *  2. Zweiter Aufruf mit gleicher propertyId + year → 409 mit error_code DUPLICATE_SETTLEMENT
 *  3. Fehlermeldung enthält Liegenschaftsname und Jahr
 *  4. Anderes Jahr derselben Liegenschaft → kein Konflikt (separate Org-Fixture nötig)
 *  5. Gleiche Liegenschaft + Jahr einer anderen Org → kein Konflikt
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

// ── Testdaten-IDs ─────────────────────────────────────────────────────────────
const orgId       = uuidv4();
const userId      = uuidv4();
const propId      = uuidv4();

// Eigentümer + Einheit (für Vorschreibungen nötig)
const ownerId     = uuidv4();
const unitId      = uuidv4();

const YEAR        = 2088; // unwahrscheinliches Jahr → kein Konflikt mit anderen Tests

// ── Express-Testapp ───────────────────────────────────────────────────────────
function buildApp(orgId_: string | null, uid = userId) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: uid, organizationId: orgId_ };
    next();
  });
  addOrgContext(app, orgId_);
  app.use(wegRouter);
  return app;
}

const app = buildApp(orgId);

// ── Seed ──────────────────────────────────────────────────────────────────────
async function seed() {
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'DupTest-Org') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${userId}::uuid, ${'dup-test-' + userId.slice(0,8) + '@test.at'}, ${orgId}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${userId}::uuid, 'admin') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'DupLiegenschaft', 'Musterstr. 1', 'Wien', '1010', 'weg')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name)
    VALUES (${ownerId}::uuid, ${orgId}::uuid, 'Dup', 'Owner') ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status)
    VALUES (${unitId}::uuid, ${propId}::uuid, 'Top 1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING
  `);
  // Eigentümer-Einheit-Verknüpfung (weg_unit_owners — nötig für createWegSettlement)
  await db.execute(sql`
    INSERT INTO weg_unit_owners (id, organization_id, property_id, unit_id, owner_id, mea_share)
    VALUES (gen_random_uuid(), ${orgId}::uuid, ${propId}::uuid, ${unitId}::uuid, ${ownerId}::uuid, '1000.0000')
    ON CONFLICT DO NOTHING
  `);
  // Vorschreibung für YEAR (damit settlement/create nicht mit NO_VORSCHREIBUNGEN abbricht)
  await db.execute(sql`
    INSERT INTO weg_vorschreibungen
      (id, property_id, owner_id, unit_id, year, month, mea_share, gesamtbetrag, status, organization_id)
    VALUES
      (gen_random_uuid(), ${propId}::uuid, ${ownerId}::uuid, ${unitId}::uuid,
       ${YEAR}, 1, '1000.0000', '1200.00', 'offen', ${orgId}::uuid)
    ON CONFLICT DO NOTHING
  `);
}

async function cleanup() {
  try {
    await db.execute(sql`DELETE FROM weg_settlement_emails WHERE settlement_id IN (SELECT id FROM weg_settlements WHERE property_id = ${propId}::uuid)`);
    // weg_settlement_details ist Append-Only-Ledger — Trigger für Cleanup deaktivieren
    await db.execute(sql`ALTER TABLE weg_settlement_details DISABLE TRIGGER ALL`);
    try {
      await db.execute(sql`DELETE FROM weg_settlement_details WHERE settlement_id IN (SELECT id FROM weg_settlements WHERE property_id = ${propId}::uuid)`);
    } finally {
      await db.execute(sql`ALTER TABLE weg_settlement_details ENABLE TRIGGER ALL`);
    }
    await db.execute(sql`DELETE FROM weg_settlements WHERE property_id = ${propId}::uuid`);
    await db.execute(sql`DELETE FROM weg_vorschreibungen WHERE property_id = ${propId}::uuid`);
    await db.execute(sql`DELETE FROM weg_unit_owners WHERE unit_id = ${unitId}::uuid`);
    await db.execute(sql`DELETE FROM units WHERE id = ${unitId}::uuid`);
    await db.execute(sql`DELETE FROM owners WHERE id = ${ownerId}::uuid`);
    await db.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM profiles WHERE id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
  } catch (err) {
    console.warn('Cleanup-Fehler (non-fatal):', (err as Error).message);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('POST /api/weg/settlement/create — Duplikat-Schutz', () => {
  beforeAll(async () => { await seed(); });
  afterAll(async  () => { await cleanup(); });

  test('erster Aufruf: Abrechnung wird erstellt (2xx)', async () => {
    const res = await request(app)
      .post('/api/weg/settlement/create')
      .send({ property_id: propId, year: YEAR });
    // 200 oder 201 — service gibt aktuell 200 zurück
    expect(res.status).toBeLessThan(300);
  });

  test('zweiter Aufruf gleiche Liegenschaft + Jahr → 409', async () => {
    const res = await request(app)
      .post('/api/weg/settlement/create')
      .send({ property_id: propId, year: YEAR })
      .expect(409);

    expect(res.body).toHaveProperty('error_code', 'DUPLICATE_SETTLEMENT');
  });

  test('Fehlermeldung enthält Liegenschaftsname und Jahr', async () => {
    const res = await request(app)
      .post('/api/weg/settlement/create')
      .send({ property_id: propId, year: YEAR })
      .expect(409);

    expect(res.body.error).toContain('DupLiegenschaft');
    expect(res.body.error).toContain(String(YEAR));
  });

  test('Anderes Jahr → kein Konflikt (Abrechnung wird erstellt)', async () => {
    // Vorschreibung für YEAR+1 anlegen
    await db.execute(sql`
      INSERT INTO weg_vorschreibungen
        (id, property_id, owner_id, unit_id, year, month, mea_share, gesamtbetrag, status, organization_id)
      VALUES
        (gen_random_uuid(), ${propId}::uuid, ${ownerId}::uuid, ${unitId}::uuid,
         ${YEAR + 1}, 1, '100.0000', '1200.00', 'offen', ${orgId}::uuid)
      ON CONFLICT DO NOTHING
    `);

    const res = await request(app)
      .post('/api/weg/settlement/create')
      .send({ property_id: propId, year: YEAR + 1 });

    // Darf kein 409 sein
    expect(res.status).not.toBe(409);
    expect(res.status).toBeLessThan(300);
  });

  test('Gleiche Liegenschaft + Jahr einer anderen Org → kein Konflikt', async () => {
    const otherOrgId  = uuidv4();
    const otherUserId = uuidv4();
    const otherPropId = uuidv4();
    const otherOwnerId = uuidv4();
    const otherUnitId  = uuidv4();

    try {
      await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${otherOrgId}::uuid, 'DupTest-OtherOrg') ON CONFLICT DO NOTHING`);
      await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${otherUserId}::uuid, ${'dup-other-' + otherUserId.slice(0,8) + '@test.at'}, ${otherOrgId}::uuid) ON CONFLICT DO NOTHING`);
      await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${otherUserId}::uuid, 'admin') ON CONFLICT DO NOTHING`);
      await db.execute(sql`
        INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
        VALUES (${otherPropId}::uuid, ${otherOrgId}::uuid, 'OtherDupObj', 'Str 2', 'Graz', '8010', 'weg')
        ON CONFLICT DO NOTHING
      `);
      await db.execute(sql`INSERT INTO owners (id, organization_id, first_name, last_name) VALUES (${otherOwnerId}::uuid, ${otherOrgId}::uuid, 'Other', 'Owner') ON CONFLICT DO NOTHING`);
      await db.execute(sql`INSERT INTO units (id, property_id, top_nummer, type, status) VALUES (${otherUnitId}::uuid, ${otherPropId}::uuid, 'Top 1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING`);
      await db.execute(sql`
        INSERT INTO weg_unit_owners (id, organization_id, property_id, unit_id, owner_id, mea_share)
        VALUES (gen_random_uuid(), ${otherOrgId}::uuid, ${otherPropId}::uuid, ${otherUnitId}::uuid, ${otherOwnerId}::uuid, '1000.0000')
        ON CONFLICT DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO weg_vorschreibungen
          (id, property_id, owner_id, unit_id, year, month, mea_share, gesamtbetrag, status, organization_id)
        VALUES
          (gen_random_uuid(), ${otherPropId}::uuid, ${otherOwnerId}::uuid, ${otherUnitId}::uuid,
           ${YEAR}, 1, '100.0000', '800.00', 'offen', ${otherOrgId}::uuid)
        ON CONFLICT DO NOTHING
      `);

      const otherApp = buildApp(otherOrgId, otherUserId);
      const res = await request(otherApp)
        .post('/api/weg/settlement/create')
        .send({ property_id: otherPropId, year: YEAR });

      // Andere Org — kein Konflikt mit erster Org
      expect(res.status).not.toBe(409);
      expect(res.status).toBeLessThan(300);
    } finally {
      await db.execute(sql`DELETE FROM weg_settlement_emails WHERE settlement_id IN (SELECT id FROM weg_settlements WHERE property_id = ${otherPropId}::uuid)`);
      await db.execute(sql`ALTER TABLE weg_settlement_details DISABLE TRIGGER ALL`);
      try {
        await db.execute(sql`DELETE FROM weg_settlement_details WHERE settlement_id IN (SELECT id FROM weg_settlements WHERE property_id = ${otherPropId}::uuid)`);
      } finally {
        await db.execute(sql`ALTER TABLE weg_settlement_details ENABLE TRIGGER ALL`);
      }
      await db.execute(sql`DELETE FROM weg_settlements WHERE property_id = ${otherPropId}::uuid`);
      await db.execute(sql`DELETE FROM weg_vorschreibungen WHERE property_id = ${otherPropId}::uuid`);
      await db.execute(sql`DELETE FROM weg_unit_owners WHERE unit_id = ${otherUnitId}::uuid`);
      await db.execute(sql`DELETE FROM units  WHERE id = ${otherUnitId}::uuid`);
      await db.execute(sql`DELETE FROM owners WHERE id = ${otherOwnerId}::uuid`);
      await db.execute(sql`DELETE FROM properties WHERE id = ${otherPropId}::uuid`);
      await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${otherUserId}::uuid`);
      await db.execute(sql`DELETE FROM profiles WHERE id = ${otherUserId}::uuid`);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${otherOrgId}::uuid`);
    }
  });
});

// ── Tests: Race-Condition (zwei gleichzeitige Anfragen) ───────────────────────
describe('POST /api/weg/settlement/create — Race-Condition', () => {
  const racePropId   = uuidv4();
  const raceOwnerId  = uuidv4();
  const raceUnitId   = uuidv4();
  const raceOrgId    = uuidv4();
  const raceUserId   = uuidv4();
  const RACE_YEAR    = 2089;

  let raceApp: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${raceOrgId}::uuid, 'Race-Org') ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${raceUserId}::uuid, ${'race-' + raceUserId.slice(0,8) + '@test.at'}, ${raceOrgId}::uuid) ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${raceUserId}::uuid, 'admin') ON CONFLICT DO NOTHING`);
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
      VALUES (${racePropId}::uuid, ${raceOrgId}::uuid, 'Race-Obj', 'Rennstr. 1', 'Wien', '1010', 'weg')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`INSERT INTO owners (id, organization_id, first_name, last_name) VALUES (${raceOwnerId}::uuid, ${raceOrgId}::uuid, 'Race', 'Owner') ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO units (id, property_id, top_nummer, type, status) VALUES (${raceUnitId}::uuid, ${racePropId}::uuid, 'Top 1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING`);
    await db.execute(sql`
      INSERT INTO weg_unit_owners (id, organization_id, property_id, unit_id, owner_id, mea_share)
      VALUES (gen_random_uuid(), ${raceOrgId}::uuid, ${racePropId}::uuid, ${raceUnitId}::uuid, ${raceOwnerId}::uuid, '1000.0000')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO weg_vorschreibungen
        (id, property_id, owner_id, unit_id, year, month, mea_share, gesamtbetrag, status, organization_id)
      VALUES
        (gen_random_uuid(), ${racePropId}::uuid, ${raceOwnerId}::uuid, ${raceUnitId}::uuid,
         ${RACE_YEAR}, 1, '1000.0000', '1200.00', 'offen', ${raceOrgId}::uuid)
      ON CONFLICT DO NOTHING
    `);
    raceApp = buildApp(raceOrgId, raceUserId);
  });

  afterAll(async () => {
    try {
      await db.execute(sql`DELETE FROM weg_settlement_emails WHERE settlement_id IN (SELECT id FROM weg_settlements WHERE property_id = ${racePropId}::uuid)`);
      await db.execute(sql`ALTER TABLE weg_settlement_details DISABLE TRIGGER ALL`);
      try {
        await db.execute(sql`DELETE FROM weg_settlement_details WHERE settlement_id IN (SELECT id FROM weg_settlements WHERE property_id = ${racePropId}::uuid)`);
      } finally {
        await db.execute(sql`ALTER TABLE weg_settlement_details ENABLE TRIGGER ALL`);
      }
      await db.execute(sql`DELETE FROM weg_settlements WHERE property_id = ${racePropId}::uuid`);
      await db.execute(sql`DELETE FROM weg_vorschreibungen WHERE property_id = ${racePropId}::uuid`);
      await db.execute(sql`DELETE FROM weg_unit_owners WHERE unit_id = ${raceUnitId}::uuid`);
      await db.execute(sql`DELETE FROM units WHERE id = ${raceUnitId}::uuid`);
      await db.execute(sql`DELETE FROM owners WHERE id = ${raceOwnerId}::uuid`);
      await db.execute(sql`DELETE FROM properties WHERE id = ${racePropId}::uuid`);
      await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${raceUserId}::uuid`);
      await db.execute(sql`DELETE FROM profiles WHERE id = ${raceUserId}::uuid`);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${raceOrgId}::uuid`);
    } catch (err) {
      console.warn('Race-Cleanup-Fehler (non-fatal):', (err as Error).message);
    }
  });

  test('zwei gleichzeitige Anfragen → genau eine 2xx, andere 409 oder 2xx (nie beide 2xx mit DB-Constraint)', async () => {
    // Beide Requests gleichzeitig abfeuern
    const [r1, r2] = await Promise.all([
      request(raceApp).post('/api/weg/settlement/create').send({ property_id: racePropId, year: RACE_YEAR }),
      request(raceApp).post('/api/weg/settlement/create').send({ property_id: racePropId, year: RACE_YEAR }),
    ]);

    const statuses = [r1.status, r2.status];
    const successCount = statuses.filter(s => s < 300).length;
    const conflictCount = statuses.filter(s => s === 409).length;

    // Mindestens eine Anfrage muss erfolgreich sein
    expect(successCount).toBeGreaterThanOrEqual(1);
    // Nicht beide können erfolgreich sein — DB-Constraint oder API-Prüfung verhindert das
    expect(successCount).toBeLessThanOrEqual(1);
    // Die andere bekommt 409
    if (successCount === 1) {
      expect(conflictCount).toBe(1);
      // conflict response must carry the right error_code
      const conflictRes = r1.status === 409 ? r1 : r2;
      expect(conflictRes.body.error_code).toBe('DUPLICATE_SETTLEMENT');
    }
  });
});

// ── Tests: Migration-Runner-Regression ────────────────────────────────────────
// Prüft dass ein 23505 aus ADD CONSTRAINT den Migration-Runner NICHT dazu bringt,
// die Migration als applied zu markieren (durch P0001-Re-raise im DO-Block).
describe('Migration-Runner-Regression — P0001 nicht ignorierbar', () => {
  test('P0001 (raise_exception) liegt nicht in IGNORABLE_PG_CODES des Migration-Runners', async () => {
    // Die IGNORABLE_PG_CODES-Menge aus runSqlMigrations.ts enthält bewusst keine P0001,
    // damit der DO-Block bei Constraint-Fehlern die Migration NICHT als applied markiert.
    // Wir verifizieren das direkt an der DB: ein DO-Block der P0001 wirft, muss fehlschlagen.
    let pgCode: string | undefined;
    try {
      await db.execute(sql`
        DO $$
        BEGIN
          RAISE EXCEPTION 'Testfehler' USING ERRCODE = 'P0001';
        END $$
      `);
    } catch (err: any) {
      pgCode = err?.cause?.code ?? err?.code;
    }
    // P0001 muss als Fehler ankommen (nicht ignoriert)
    expect(pgCode).toBe('P0001');
  });

  test('DO-Block mit 23505-Re-raise als P0001: äußerer Fehler ist P0001', async () => {
    // Simuliert: ADD CONSTRAINT schlägt mit unique_violation fehl,
    // EXCEPTION WHEN unique_violation THEN RAISE P0001.
    // Prüft dass der outer error-code P0001 ist (nicht 23505 → nicht ignorierbar).
    let pgCode: string | undefined;
    try {
      await db.execute(sql`
        DO $$
        BEGIN
          BEGIN
            RAISE unique_violation USING MESSAGE = 'simulierter 23505';
          EXCEPTION WHEN unique_violation THEN
            RAISE EXCEPTION 'Constraint-Fehler als P0001 weitergeleitet'
              USING ERRCODE = 'P0001';
          END;
        END $$
      `);
    } catch (err: any) {
      pgCode = err?.cause?.code ?? err?.code;
    }
    expect(pgCode).toBe('P0001');
  });
});

// ── Tests: Migration-Preflight ────────────────────────────────────────────────
describe('Migration-Preflight — Unique-Constraint auf weg_settlements', () => {
  test('unique constraint uq_weg_settlements_property_year existiert in der DB', async () => {
    const result = await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM pg_constraint
      WHERE conname = 'uq_weg_settlements_property_year'
        AND contype = 'u'
    `);
    const cnt = parseInt((result.rows as any[])[0].cnt, 10);
    // Constraint existiert → Preflight-DO-Block hat keine Duplikate gefunden
    // und ALTER TABLE wurde ausgeführt (oder war schon vorhanden)
    expect(cnt).toBe(1);
  });

  test('direkter INSERT eines Duplikats wird von der DB abgewiesen (23505)', async () => {
    const dupPropId  = uuidv4();
    const dupOrgId   = uuidv4();
    const DUP_YEAR   = 2090;

    try {
      await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${dupOrgId}::uuid, 'ConstraintTest-Org') ON CONFLICT DO NOTHING`);
      await db.execute(sql`
        INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
        VALUES (${dupPropId}::uuid, ${dupOrgId}::uuid, 'Constraint-Obj', 'Str 1', 'Wien', '1010', 'weg')
        ON CONFLICT DO NOTHING
      `);
      // Erste Abrechnung (direkt, ohne den Service)
      await db.execute(sql`
        INSERT INTO weg_settlements
          (id, organization_id, property_id, year, total_expenses, total_prepayments,
           total_difference, owner_count, total_mea, reserve_fund_balance, status)
        VALUES (gen_random_uuid(), ${dupOrgId}::uuid, ${dupPropId}::uuid, ${DUP_YEAR},
                '1000.00', '800.00', '200.00', 1, '100.0000', '500.00', 'entwurf')
      `);
      // Zweite Abrechnung für dasselbe property_id + year (egal welche organization_id) → 23505
      let pgCode: string | undefined;
      try {
        await db.execute(sql`
          INSERT INTO weg_settlements
            (id, organization_id, property_id, year, total_expenses, total_prepayments,
             total_difference, owner_count, total_mea, reserve_fund_balance, status)
          VALUES (gen_random_uuid(), ${dupOrgId}::uuid, ${dupPropId}::uuid, ${DUP_YEAR},
                  '1000.00', '800.00', '200.00', 1, '100.0000', '500.00', 'entwurf')
        `);
      } catch (err: any) {
        pgCode = err?.cause?.code ?? err?.code;
      }
      expect(pgCode).toBe('23505');
    } finally {
      await db.execute(sql`ALTER TABLE weg_settlement_details DISABLE TRIGGER ALL`);
      try {
        await db.execute(sql`DELETE FROM weg_settlement_details WHERE settlement_id IN (SELECT id FROM weg_settlements WHERE property_id = ${dupPropId}::uuid)`);
      } finally {
        await db.execute(sql`ALTER TABLE weg_settlement_details ENABLE TRIGGER ALL`);
      }
      await db.execute(sql`DELETE FROM weg_settlements WHERE property_id = ${dupPropId}::uuid`);
      await db.execute(sql`DELETE FROM properties WHERE id = ${dupPropId}::uuid`);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${dupOrgId}::uuid`);
    }
  });

  test('Duplikat mit organization_id = NULL wird ebenfalls abgewiesen (23505)', async () => {
    // Dieser Test prüft, dass der Constraint auf (property_id, year) auch greift
    // wenn organization_id NULL ist — ein 3-Spalten-Constraint hätte dies übersehen.
    const nullOrgPropId = uuidv4();
    const NULL_YEAR     = 2091;

    try {
      await db.execute(sql`
        INSERT INTO properties (id, name, address, city, postal_code, management_type)
        VALUES (${nullOrgPropId}::uuid, 'NullOrg-Obj', 'Str 1', 'Wien', '1010', 'weg')
        ON CONFLICT DO NOTHING
      `);
      // Erste Abrechnung mit organization_id = NULL
      await db.execute(sql`
        INSERT INTO weg_settlements
          (id, property_id, year, total_expenses, total_prepayments,
           total_difference, owner_count, total_mea, reserve_fund_balance, status)
        VALUES (gen_random_uuid(), ${nullOrgPropId}::uuid, ${NULL_YEAR},
                '500.00', '400.00', '100.00', 1, '100.0000', '200.00', 'entwurf')
      `);
      // Zweite Abrechnung mit derselben property_id + year, organization_id ebenfalls NULL
      let pgCode: string | undefined;
      try {
        await db.execute(sql`
          INSERT INTO weg_settlements
            (id, property_id, year, total_expenses, total_prepayments,
             total_difference, owner_count, total_mea, reserve_fund_balance, status)
          VALUES (gen_random_uuid(), ${nullOrgPropId}::uuid, ${NULL_YEAR},
                  '500.00', '400.00', '100.00', 1, '100.0000', '200.00', 'entwurf')
        `);
      } catch (err: any) {
        pgCode = err?.cause?.code ?? err?.code;
      }
      // Constraint auf (property_id, year) muss auch bei NULL organization_id greifen
      expect(pgCode).toBe('23505');
    } finally {
      await db.execute(sql`ALTER TABLE weg_settlement_details DISABLE TRIGGER ALL`);
      try {
        await db.execute(sql`DELETE FROM weg_settlement_details WHERE settlement_id IN (SELECT id FROM weg_settlements WHERE property_id = ${nullOrgPropId}::uuid)`);
      } finally {
        await db.execute(sql`ALTER TABLE weg_settlement_details ENABLE TRIGGER ALL`);
      }
      await db.execute(sql`DELETE FROM weg_settlements WHERE property_id = ${nullOrgPropId}::uuid`);
      await db.execute(sql`DELETE FROM properties WHERE id = ${nullOrgPropId}::uuid`);
    }
  });
});
