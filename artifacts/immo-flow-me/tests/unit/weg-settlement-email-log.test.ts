/**
 * WEG-Jahresabrechnung — Versand-Log Integrationstests
 *
 * Prüft:
 *  1. Nach sendWegSettlementEmails sind Log-Einträge in weg_settlement_emails vorhanden
 *  2. Erfolgreiche E-Mails werden mit status='sent' protokolliert
 *  3. Fehlgeschlagene E-Mails werden mit status='failed' + error_message protokolliert
 *  4. Mehrfach-Versand ergänzt neue Einträge (kein Überschreiben)
 *  5. GET /api/weg/settlement/:id/email-log liefert das Log mit Org-Grenze
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { rootDb as db } from '../../server/db';
import { sql, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import wegRouter from '../../server/routes/wegRoutes';
import { addOrgContext } from '../helpers/withOrgContext';
import { sendWegSettlementEmails, type SendEmailFn } from '../../server/services/wegSettlementEmailService';
import * as schema from '../../shared/schema';

// ── Testdaten-IDs ─────────────────────────────────────────────────────────────
const orgId        = uuidv4();
const userId       = uuidv4();
const propId       = uuidv4();
const settlementId = uuidv4();
const ownerA       = uuidv4();  // hat E-Mail
const ownerB       = uuidv4();  // hat E-Mail
const unitA        = uuidv4();
const unitB        = uuidv4();
const detailA      = uuidv4();
const detailB      = uuidv4();

// ── Test-App ──────────────────────────────────────────────────────────────────
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
  const email = (prefix: string, id: string) => `${prefix}-${id.slice(0, 8)}@log-test.at`;

  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'EmailLog-Org') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${userId}::uuid, ${email('log-u', userId)}, ${orgId}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${userId}::uuid, 'admin') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'EmailLog-Obj', 'Str 1', 'Wien', '1010', 'weg') ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`INSERT INTO units (id, property_id, top_nummer, type, status) VALUES (${unitA}::uuid, ${propId}::uuid, 'Top 1', 'wohnung', 'aktiv'), (${unitB}::uuid, ${propId}::uuid, 'Top 2', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name, email) VALUES
      (${ownerA}::uuid, ${orgId}::uuid, 'Anna', 'LogA', ${email('oa', ownerA)}),
      (${ownerB}::uuid, ${orgId}::uuid, 'Bob',  'LogB', ${email('ob', ownerB)})
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO weg_settlements (id, organization_id, property_id, year, total_expenses, total_prepayments, total_difference, owner_count, total_mea, reserve_fund_balance, status)
    VALUES (${settlementId}::uuid, ${orgId}::uuid, ${propId}::uuid, 2035, '6000.00', '5000.00', '1000.00', 2, '1000.0000', '1500.00', 'beschlossen')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO weg_settlement_details (id, settlement_id, owner_id, unit_id, mea_share, mea_ratio, total_soll, total_ist, saldo, ruecklage_anteil, sonderumlagen, category_details)
    VALUES
      (${detailA}::uuid, ${settlementId}::uuid, ${ownerA}::uuid, ${unitA}::uuid, 500, 0.5, '3000.00', '2500.00', '500.00', '300.00', '0.00', '[]'),
      (${detailB}::uuid, ${settlementId}::uuid, ${ownerB}::uuid, ${unitB}::uuid, 500, 0.5, '3000.00', '2500.00', '500.00', '300.00', '0.00', '[]')
    ON CONFLICT DO NOTHING
  `);
}

async function cleanupLogs() {
  await db.execute(sql`DELETE FROM weg_settlement_emails WHERE settlement_id = ${settlementId}::uuid`);
}

async function cleanup() {
  try {
    await cleanupLogs();
    // weg_settlement_details ist Append-Only-Ledger — Trigger für Cleanup deaktivieren
    await db.execute(sql`ALTER TABLE weg_settlement_details DISABLE TRIGGER ALL`);
    try {
      await db.execute(sql`DELETE FROM weg_settlement_details WHERE settlement_id = ${settlementId}::uuid`);
    } finally {
      await db.execute(sql`ALTER TABLE weg_settlement_details ENABLE TRIGGER ALL`);
    }
    await db.execute(sql`DELETE FROM weg_settlements WHERE id = ${settlementId}::uuid`);
    await db.execute(sql`DELETE FROM owners WHERE id IN (${ownerA}::uuid, ${ownerB}::uuid)`);
    await db.execute(sql`DELETE FROM units  WHERE id IN (${unitA}::uuid, ${unitB}::uuid)`);
    await db.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM profiles WHERE id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
  } catch (err) {
    console.warn('Cleanup-Fehler (non-fatal):', (err as Error).message);
  }
}

// ── Tests: Service-Level (DB-Log-Einträge) ────────────────────────────────────
describe('sendWegSettlementEmails — Versand-Log in DB', () => {
  beforeAll(async () => { await seed(); });
  afterAll(async  () => { await cleanup(); });

  test('nach erfolgreichem Versand: Log-Einträge mit status=sent vorhanden', async () => {
    await cleanupLogs();
    const stub: SendEmailFn = async () => { /* Erfolg */ };
    await sendWegSettlementEmails(settlementId, orgId, stub);

    const logs = await db.select()
      .from(schema.wegSettlementEmails)
      .where(eq(schema.wegSettlementEmails.settlementId, settlementId));

    expect(logs.length).toBe(2);
    expect(logs.every(l => l.status === 'sent')).toBe(true);
    expect(logs.every(l => l.errorMessage === null)).toBe(true);
  });

  test('failed E-Mail: Log-Eintrag mit status=failed und error_message', async () => {
    await cleanupLogs();
    let callCount = 0;
    const stub: SendEmailFn = async (opts) => {
      callCount++;
      if (callCount === 1) throw new Error('SMTP timeout'); // erster Eigentümer schlägt fehl
    };
    await sendWegSettlementEmails(settlementId, orgId, stub).catch(() => {});

    const logs = await db.select()
      .from(schema.wegSettlementEmails)
      .where(eq(schema.wegSettlementEmails.settlementId, settlementId));

    const failedLogs = logs.filter(l => l.status === 'failed');
    expect(failedLogs.length).toBeGreaterThanOrEqual(1);
    expect(failedLogs[0].errorMessage).toContain('SMTP timeout');
  });

  test('Mehrfach-Versand: neue Einträge werden ergänzt (nicht überschrieben)', async () => {
    await cleanupLogs();
    const stub: SendEmailFn = async () => {};

    await sendWegSettlementEmails(settlementId, orgId, stub);
    await sendWegSettlementEmails(settlementId, orgId, stub);

    const logs = await db.select()
      .from(schema.wegSettlementEmails)
      .where(eq(schema.wegSettlementEmails.settlementId, settlementId));

    // 2 Eigentümer × 2 Versandläufe = 4 Einträge
    expect(logs.length).toBe(4);
  });

  test('owner_id und email sind im Log-Eintrag gesetzt', async () => {
    await cleanupLogs();
    const stub: SendEmailFn = async () => {};
    await sendWegSettlementEmails(settlementId, orgId, stub);

    const logs = await db.select()
      .from(schema.wegSettlementEmails)
      .where(eq(schema.wegSettlementEmails.settlementId, settlementId));

    for (const log of logs) {
      expect(log.ownerId).toBeTruthy();
      expect(log.email).toMatch(/@log-test\.at$/);
      expect(log.sentAt).toBeTruthy();
    }
  });
});

// ── Tests: GET /api/weg/settlement/:id/email-log ──────────────────────────────
describe('GET /api/weg/settlement/:id/email-log', () => {
  beforeAll(async () => {
    await seed();
    await cleanupLogs();
    // Seed: 2 Log-Einträge direkt einfügen
    const emailA = `oa-${ownerA.slice(0,8)}@log-test.at`;
    const emailB = `ob-${ownerB.slice(0,8)}@log-test.at`;
    await db.execute(sql`
      INSERT INTO weg_settlement_emails (settlement_id, owner_id, email, status)
      VALUES
        (${settlementId}::uuid, ${ownerA}::uuid, ${emailA}, 'sent'),
        (${settlementId}::uuid, ${ownerB}::uuid, ${emailB}, 'failed')
    `);
  });
  afterAll(async () => { await cleanup(); });

  test('liefert 2 Log-Einträge für diese Abrechnung', async () => {
    const res = await request(app)
      .get(`/api/weg/settlement/${settlementId}/email-log`)
      .expect(200);

    expect(res.body).toHaveLength(2);
  });

  test('Einträge haben status, email, sent_at und owner_name', async () => {
    const res = await request(app)
      .get(`/api/weg/settlement/${settlementId}/email-log`)
      .expect(200);

    for (const entry of res.body) {
      expect(entry).toHaveProperty('status');
      expect(entry).toHaveProperty('email');
      expect(entry).toHaveProperty('sent_at');
      expect(entry).toHaveProperty('owner_name');
    }
  });

  test('sent/failed korrekt: eine sent, eine failed', async () => {
    const res = await request(app)
      .get(`/api/weg/settlement/${settlementId}/email-log`)
      .expect(200);

    const sentEntries   = res.body.filter((e: any) => e.status === 'sent');
    const failedEntries = res.body.filter((e: any) => e.status === 'failed');
    expect(sentEntries.length).toBe(1);
    expect(failedEntries.length).toBe(1);
  });

  test('Org-Grenze: andere Org bekommt 404 für dieselbe Abrechnung', async () => {
    const otherOrg  = uuidv4();
    const otherUser = uuidv4();
    await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${otherOrg}::uuid, 'EmailLog-OtherOrg') ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${otherUser}::uuid, ${'log-other-' + otherUser.slice(0,8) + '@log-test.at'}, ${otherOrg}::uuid) ON CONFLICT DO NOTHING`);
    try {
      const otherApp = buildApp(otherOrg, otherUser);
      await request(otherApp)
        .get(`/api/weg/settlement/${settlementId}/email-log`)
        .expect(404);
    } finally {
      await db.execute(sql`DELETE FROM profiles      WHERE id = ${otherUser}::uuid`);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${otherOrg}::uuid`);
    }
  });

  test('unbekannte settlement_id → 404', async () => {
    await request(app)
      .get(`/api/weg/settlement/${uuidv4()}/email-log`)
      .expect(404);
  });
});
