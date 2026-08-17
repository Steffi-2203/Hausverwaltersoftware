/**
 * WEG-Settlement E-Mail-Versand — Unit- und Integrationstests
 *
 * Prüft sendWegSettlementEmails() aus server/services/wegSettlementEmailService.ts
 * sowie den HTTP-Layer (POST /api/weg/settlement/:id/send) über supertest.
 *
 * Kein Modul-Mocking nötig: sendEmailFn wird als Parameter injiziert.
 *
 * Szenarien:
 *  A (Service-Unit-Tests):
 *   1. sendEmail wirft für alle → emails_sent=0, Status bleibt unverändert
 *   2. Partial failure: Owner 1 ok, Owner 2 wirft → emails_sent=1, emails_failed=1, Status=versendet
 *   3. All succeed → emails_sent=2, Status=versendet, approved_at gesetzt
 *   4. Kein Eigentümer hat E-Mail → wirft mit status=400
 *   5. Unbekannte Abrechnung → wirft mit status=404
 *
 *  B (HTTP-Layer):
 *   6. Nicht authentifiziert → 401
 *   7. Kein E-Mail → 400
 *   8. Unbekannte Abrechnung → 404
 */

import { describe, test, before as beforeAll, after as afterAll, beforeEach } from 'node:test';
import { expect } from '../helpers/expect';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { rootDb as db } from '../../server/db';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { setupTestDb, teardownTestDb } from '../helpers/db';
import { sendWegSettlementEmails } from '../../server/services/wegSettlementEmailService';

// ── Testdaten ────────────────────────────────────────────────────────────────
const orgId        = uuidv4();
const userId       = uuidv4();
const propId       = uuidv4();
const unitAId      = uuidv4();
const unitBId      = uuidv4();
const owner1Id     = uuidv4();   // anna@test.at
const owner2Id     = uuidv4();   // bernd@test.at
const ownerNoEmail = uuidv4();   // kein E-Mail
const settlId      = uuidv4();   // Abrechnung: owner1 + owner2
const settlNoEmail = uuidv4();   // Abrechnung: ownerNoEmail

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────
async function resetStatus(id: string, status = 'berechnet') {
  await db.execute(sql`UPDATE weg_settlements SET status=${status}, approved_at=NULL WHERE id=${id}::uuid`);
}

async function getRow(id: string) {
  const r = await db.execute(sql`SELECT status, approved_at FROM weg_settlements WHERE id=${id}::uuid`);
  return (r.rows as any[])[0];
}

// Stub: kontrollierte sendEmailFn ohne echte Resend-Verbindung.
// Resend SDK wirft bei result.error (Fix in lib/resend.ts); hier simuliert
// durch direktes Werfen des Stubs.
function makeStub(behavior: 'always_ok' | 'always_fail' | 'first_ok_second_fail') {
  let callCount = 0;
  return async (opts: { to: string }) => {
    callCount++;
    if (behavior === 'always_fail') {
      throw new Error('Resend API error (name=validation_error, status=422)');
    }
    if (behavior === 'first_ok_second_fail' && callCount > 1) {
      throw new Error('Rate limit exceeded');
    }
    return { data: { id: `msg-${callCount}` }, error: null };
  };
}

// ── Seed & Cleanup ───────────────────────────────────────────────────────────
async function seed() {
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgId}::uuid,'SendTest-Org') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${userId}::uuid,${`st-${userId.slice(0, 8)}@test.at`},${orgId}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${userId}::uuid,'admin') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type) VALUES (${propId}::uuid,${orgId}::uuid,'SendTest-Obj','Str 1','Wien','1010','weg') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status) VALUES
      (${unitAId}::uuid,${propId}::uuid,'Top A','wohnung','aktiv'),
      (${unitBId}::uuid,${propId}::uuid,'Top B','wohnung','aktiv')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name, email) VALUES
      (${owner1Id}::uuid,    ${orgId}::uuid,'Anna', 'Mail',   'anna@test.at'),
      (${owner2Id}::uuid,    ${orgId}::uuid,'Bernd','Mail',   'bernd@test.at'),
      (${ownerNoEmail}::uuid,${orgId}::uuid,'Claus','NoEmail',NULL)
    ON CONFLICT DO NOTHING
  `);

  // Abrechnung: 2 Eigentümer MIT E-Mail
  await db.execute(sql`
    INSERT INTO weg_settlements (id,organization_id,property_id,year,total_expenses,total_prepayments,total_difference,owner_count,total_mea,reserve_fund_balance,status)
    VALUES (${settlId}::uuid,${orgId}::uuid,${propId}::uuid,2025,'1000.00','900.00','100.00',2,'2000.0000','500.00','berechnet')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO weg_settlement_details (id,settlement_id,owner_id,unit_id,mea_share,mea_ratio,total_soll,total_ist,saldo,ruecklage_anteil,sonderumlagen) VALUES
      (gen_random_uuid(),${settlId}::uuid,${owner1Id}::uuid,${unitAId}::uuid,'1000.0000','0.500000','500.00','450.00','50.00','100.00','0.00'),
      (gen_random_uuid(),${settlId}::uuid,${owner2Id}::uuid,${unitBId}::uuid,'1000.0000','0.500000','500.00','450.00','50.00','100.00','0.00')
    ON CONFLICT DO NOTHING
  `);

  // Abrechnung: 1 Eigentümer OHNE E-Mail
  await db.execute(sql`
    INSERT INTO weg_settlements (id,organization_id,property_id,year,total_expenses,total_prepayments,total_difference,owner_count,total_mea,reserve_fund_balance,status)
    VALUES (${settlNoEmail}::uuid,${orgId}::uuid,${propId}::uuid,2024,'800.00','800.00','0.00',1,'1000.0000','200.00','berechnet')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO weg_settlement_details (id,settlement_id,owner_id,unit_id,mea_share,mea_ratio,total_soll,total_ist,saldo,ruecklage_anteil,sonderumlagen)
    VALUES (gen_random_uuid(),${settlNoEmail}::uuid,${ownerNoEmail}::uuid,${unitAId}::uuid,'1000.0000','1.000000','800.00','800.00','0.00','200.00','0.00')
    ON CONFLICT DO NOTHING
  `);
}

async function cleanup() {
  // weg_settlement_details ist Append-Only-Ledger — Trigger für Cleanup deaktivieren
  await db.execute(sql`ALTER TABLE weg_settlement_details DISABLE TRIGGER ALL`);
  try {
    await db.execute(sql`DELETE FROM weg_settlement_details WHERE settlement_id IN (${settlId}::uuid,${settlNoEmail}::uuid)`);
  } finally {
    await db.execute(sql`ALTER TABLE weg_settlement_details ENABLE TRIGGER ALL`);
  }
  await db.execute(sql`DELETE FROM weg_settlements WHERE id IN (${settlId}::uuid,${settlNoEmail}::uuid)`);
  await db.execute(sql`DELETE FROM owners WHERE id IN (${owner1Id}::uuid,${owner2Id}::uuid,${ownerNoEmail}::uuid)`);
  await db.execute(sql`DELETE FROM units WHERE id IN (${unitAId}::uuid,${unitBId}::uuid)`);
  await db.execute(sql`DELETE FROM properties WHERE id=${propId}::uuid`);
  await db.execute(sql`DELETE FROM user_roles WHERE user_id=${userId}::uuid`);
  await db.execute(sql`DELETE FROM profiles WHERE id=${userId}::uuid`);
  await db.execute(sql`DELETE FROM organizations WHERE id=${orgId}::uuid`);
}

// ── Gemeinsamer Lifecycle (beide Describe-Blöcke) ────────────────────────────
let authApp: express.Express;
let anonApp: express.Express;

describe('WEG-Settlement E-Mail-Versand', () => {
  beforeAll(async () => {
    await setupTestDb();
    await seed();
    const { default: wegRoutes } = await import('../../server/routes/wegRoutes');

    authApp = express();
    authApp.use(express.json());
    authApp.use((req: Request, _res: Response, next: NextFunction) => {
      (req as any).session = { userId, organizationId: orgId };
      next();
    });
    authApp.use(wegRoutes);

    anonApp = express();
    anonApp.use(express.json());
    anonApp.use((req: Request, _res: Response, next: NextFunction) => {
      (req as any).session = { userId: null, organizationId: null };
      next();
    });
    anonApp.use(wegRoutes);
  });

  afterAll(async () => {
    await cleanup();
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetStatus(settlId);
    await resetStatus(settlNoEmail);
  });

  // ══ A: Service-Unit-Tests (injizierte sendEmailFn) ════════════════════════

  // A1. Resend-API-Fehler → alle in failed_recipients, Status bleibt
  test('A1: sendEmail wirft für alle → emails_sent=0, Status bleibt berechnet', async () => {
    const result = await sendWegSettlementEmails(settlId, orgId, makeStub('always_fail'));

    expect(result.emailsSent).toBe(0);
    expect(result.emailsFailed).toBe(2);
    expect(result.failedRecipients).toContain('anna@test.at');
    expect(result.failedRecipients).toContain('bernd@test.at');

    const row = await getRow(settlId);
    expect(row.status).toBe('berechnet');
    expect(row.approved_at).toBeNull();
  });

  // A2. Partial failure: Owner 1 ok, Owner 2 wirft → Status=versendet
  test('A2: partial failure → emails_sent=1, emails_failed=1, Status=versendet', async () => {
    const result = await sendWegSettlementEmails(settlId, orgId, makeStub('first_ok_second_fail'));

    expect(result.emailsSent).toBe(1);
    expect(result.emailsFailed).toBe(1);

    const row = await getRow(settlId);
    expect(row.status).toBe('versendet');
    expect(row.approved_at).not.toBeNull();
  });

  // A3. All succeed → Status 'versendet', approved_at gesetzt
  test('A3: alle erfolgreich → emails_sent=2, Status=versendet, approved_at gesetzt', async () => {
    const result = await sendWegSettlementEmails(settlId, orgId, makeStub('always_ok'));

    expect(result.emailsSent).toBe(2);
    expect(result.emailsFailed).toBe(0);
    expect(result.noEmailCount).toBe(0);

    const row = await getRow(settlId);
    expect(row.status).toBe('versendet');
    expect(row.approved_at).not.toBeNull();
  });

  // A4. Kein Eigentümer hat E-Mail → wirft status=400
  test('A4: keine E-Mail-Adresse → wirft mit status=400', async () => {
    let caught: any;
    try {
      await sendWegSettlementEmails(settlNoEmail, orgId, makeStub('always_ok'));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught.status).toBe(400);
    expect(caught.message).toMatch(/E-Mail/i);

    const row = await getRow(settlNoEmail);
    expect(row.status).toBe('berechnet');
    expect(row.approved_at).toBeNull();
  });

  // A5. Unbekannte Abrechnung → wirft status=404
  test('A5: unbekannte Abrechnung → wirft mit status=404', async () => {
    let caught: any;
    try {
      await sendWegSettlementEmails(uuidv4(), orgId, makeStub('always_ok'));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught.status).toBe(404);
  });

  // ══ B: HTTP-Layer ═════════════════════════════════════════════════════════

  // B1. Nicht authentifiziert → 401
  test('B1: nicht authentifiziert → 401', async () => {
    const res = await request(anonApp)
      .post(`/api/weg/settlement/${settlId}/send`)
      .send({});
    expect(res.status).toBe(401);
  });

  // B2. Alle Eigentümer ohne E-Mail → 400 (real send via route, kein stub möglich)
  test('B2: alle Eigentümer ohne E-Mail → HTTP 400', async () => {
    const res = await request(authApp)
      .post(`/api/weg/settlement/${settlNoEmail}/send`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/E-Mail/i);

    const row = await getRow(settlNoEmail);
    expect(row.status).toBe('berechnet');
  });

  // B3. Unbekannte Abrechnung → 404
  test('B3: unbekannte Abrechnung → HTTP 404', async () => {
    const res = await request(authApp)
      .post(`/api/weg/settlement/${uuidv4()}/send`)
      .send({});
    expect(res.status).toBe(404);
  });
});
