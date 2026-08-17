/**
 * WEG-Vorschreibungen — Versand-Log Integrationstests
 *
 * Prüft:
 *  1. GET /api/weg/budget-plans/:id/vorschreibungen liefert last_sent_at=null wenn kein Eintrag
 *  2. Nach Einfügen eines sent-Eintrags in weg_vorschreibung_emails erscheint last_sent_at
 *  3. Nur der MAX(sent_at) der status='sent'-Einträge wird zurückgegeben
 *  4. sendWegVorschreibungEmails schreibt Einträge in weg_vorschreibung_emails
 *  5. Org-Grenze: andere Org bekommt 404 für diesen Plan
 */

import { describe, test, beforeAll, afterAll } from 'vitest';
import { expect } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { rootDb as db } from '../../server/db';
import { sql, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import wegRouter from '../../server/routes/wegRoutes';
import { addOrgContext } from '../helpers/withOrgContext';
import { sendWegVorschreibungEmails, type SendEmailFn } from '../../server/services/wegVorschreibungEmailService';
import * as schema from '../../shared/schema';

// ── Testdaten-IDs ─────────────────────────────────────────────────────────────
const orgId   = uuidv4();
const userId  = uuidv4();
const propId  = uuidv4();
const planId  = uuidv4();
const unitId  = uuidv4();
const ownerId = uuidv4();
const invoiceId = uuidv4();
const unitOwnerId = uuidv4();

// ── Test-App ──────────────────────────────────────────────────────────────────
function buildApp(org: string | null, uid = userId) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: uid, organizationId: org };
    next();
  });
  addOrgContext(app, org);
  app.use(wegRouter);
  return app;
}

const app = buildApp(orgId);

// ── Seed ──────────────────────────────────────────────────────────────────────
async function seed() {
  const e = (p: string, id: string) => `${p}-${id.slice(0, 8)}@vpe-test.at`;

  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'VPE-Org') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${userId}::uuid, ${e('u', userId)}, ${orgId}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${userId}::uuid, 'admin') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'VPE-Obj', 'Str 1', 'Wien', '1010', 'weg') ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`INSERT INTO units (id, property_id, top_nummer, type, status) VALUES (${unitId}::uuid, ${propId}::uuid, 'Top 1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name, email)
    VALUES (${ownerId}::uuid, ${orgId}::uuid, 'Anna', 'Test', ${e('oa', ownerId)}) ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO weg_unit_owners (id, organization_id, property_id, unit_id, owner_id, mea_share, valid_from)
    VALUES (${unitOwnerId}::uuid, ${orgId}::uuid, ${propId}::uuid, ${unitId}::uuid, ${ownerId}::uuid, 1000, CURRENT_DATE)
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO weg_budget_plans (id, organization_id, property_id, year, total_amount, status, due_day)
    VALUES (${planId}::uuid, ${orgId}::uuid, ${propId}::uuid, 2099, '12000.00', 'aktiv', 5)
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO monthly_invoices
      (id, unit_id, owner_id, weg_budget_plan_id, year, month, betriebskosten, heizungskosten,
       wasserkosten, grundmiete, ust, gesamtbetrag, status, faellig_am)
    VALUES
      (${invoiceId}::uuid, ${unitId}::uuid, ${ownerId}::uuid, ${planId}::uuid,
       2099, 1, '100.00', '50.00', '0', '0', '15.00', '165.00', 'offen', '2099-01-05')
    ON CONFLICT DO NOTHING
  `);
}

async function cleanupLogs() {
  await db.execute(sql`DELETE FROM weg_vorschreibung_emails WHERE vorschreibung_id = ${invoiceId}::uuid`);
}

async function cleanup() {
  try {
    await cleanupLogs();
    await db.execute(sql`DELETE FROM monthly_invoices WHERE weg_budget_plan_id = ${planId}::uuid`);
    await db.execute(sql`DELETE FROM weg_budget_plans WHERE id = ${planId}::uuid`);
    await db.execute(sql`DELETE FROM weg_unit_owners WHERE id = ${unitOwnerId}::uuid`);
    await db.execute(sql`DELETE FROM owners WHERE id = ${ownerId}::uuid`);
    await db.execute(sql`DELETE FROM units WHERE id = ${unitId}::uuid`);
    await db.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM profiles WHERE id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
  } catch (err) {
    console.warn('Cleanup-Fehler (non-fatal):', (err as Error).message);
  }
}

beforeAll(async () => { await seed(); });
afterAll(async () => { await cleanup(); });

// ── Tests: last_sent_at im GET-Endpunkt ───────────────────────────────────────
describe('GET /api/weg/budget-plans/:id/vorschreibungen — last_sent_at', () => {
  test('last_sent_at ist null wenn kein Versand-Log-Eintrag existiert', async () => {
    await cleanupLogs();
    const res = await request(app)
      .get(`/api/weg/budget-plans/${planId}/vorschreibungen`)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].last_sent_at).toBeNull();
  });

  test('last_sent_at ist gesetzt wenn ein sent-Eintrag existiert', async () => {
    await cleanupLogs();
    await db.execute(sql`
      INSERT INTO weg_vorschreibung_emails (vorschreibung_id, owner_id, email, status)
      VALUES (${invoiceId}::uuid, ${ownerId}::uuid, 'anna@vpe-test.at', 'sent')
    `);

    const res = await request(app)
      .get(`/api/weg/budget-plans/${planId}/vorschreibungen`)
      .expect(200);

    expect(res.body[0].last_sent_at).not.toBeNull();
    const d = new Date(res.body[0].last_sent_at);
    expect(isNaN(d.getTime())).toBe(false);
  });

  test('failed-Einträge allein liefern last_sent_at=null', async () => {
    await cleanupLogs();
    await db.execute(sql`
      INSERT INTO weg_vorschreibung_emails (vorschreibung_id, owner_id, email, status, error_message)
      VALUES (${invoiceId}::uuid, ${ownerId}::uuid, 'anna@vpe-test.at', 'failed', 'SMTP timeout')
    `);

    const res = await request(app)
      .get(`/api/weg/budget-plans/${planId}/vorschreibungen`)
      .expect(200);

    expect(res.body[0].last_sent_at).toBeNull();
  });

  test('MAX(sent_at) der sent-Einträge wird zurückgegeben wenn mehrere Einträge existieren', async () => {
    await cleanupLogs();
    // Früherer und späterer sent-Eintrag
    await db.execute(sql`
      INSERT INTO weg_vorschreibung_emails (vorschreibung_id, owner_id, email, status, sent_at)
      VALUES
        (${invoiceId}::uuid, ${ownerId}::uuid, 'a@vpe-test.at', 'sent', '2099-01-01T10:00:00Z'),
        (${invoiceId}::uuid, ${ownerId}::uuid, 'a@vpe-test.at', 'sent', '2099-01-02T12:00:00Z'),
        (${invoiceId}::uuid, ${ownerId}::uuid, 'a@vpe-test.at', 'failed', '2099-01-03T08:00:00Z')
    `);

    const res = await request(app)
      .get(`/api/weg/budget-plans/${planId}/vorschreibungen`)
      .expect(200);

    // Muss der neueste sent-Zeitpunkt sein (nicht der failed-Zeitpunkt)
    const ts = new Date(res.body[0].last_sent_at).getTime();
    expect(ts).toBe(new Date('2099-01-02T12:00:00Z').getTime());
  });

  test('Org-Grenze: andere Org bekommt 404', async () => {
    const otherOrg  = uuidv4();
    const otherUser = uuidv4();
    await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${otherOrg}::uuid, 'VPE-OtherOrg') ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${otherUser}::uuid, ${'vpe-other-' + otherUser.slice(0,8) + '@vpe-test.at'}, ${otherOrg}::uuid) ON CONFLICT DO NOTHING`);
    try {
      const otherApp = buildApp(otherOrg, otherUser);
      await request(otherApp)
        .get(`/api/weg/budget-plans/${planId}/vorschreibungen`)
        .expect(404);
    } finally {
      await db.execute(sql`DELETE FROM profiles WHERE id = ${otherUser}::uuid`);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${otherOrg}::uuid`);
    }
  });
});

// ── Tests: sendWegVorschreibungEmails Service ─────────────────────────────────
describe('sendWegVorschreibungEmails — Versand-Log in DB', () => {
  test('nach erfolgreichem Versand: Log-Eintrag mit status=sent vorhanden', async () => {
    await cleanupLogs();
    const stub: SendEmailFn = async () => { /* Erfolg */ };
    await sendWegVorschreibungEmails(planId, orgId, stub);

    const logs = await db.select()
      .from(schema.wegVorschreibungEmails)
      .where(eq(schema.wegVorschreibungEmails.vorschreibungId, invoiceId));

    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs.every(l => l.status === 'sent')).toBe(true);
  });

  test('failed E-Mail: Log-Eintrag mit status=failed und error_message', async () => {
    await cleanupLogs();
    const stub: SendEmailFn = async () => { throw new Error('SMTP timeout'); };
    await sendWegVorschreibungEmails(planId, orgId, stub).catch(() => {});

    const logs = await db.select()
      .from(schema.wegVorschreibungEmails)
      .where(eq(schema.wegVorschreibungEmails.vorschreibungId, invoiceId));

    const failed = logs.filter(l => l.status === 'failed');
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(failed[0].errorMessage).toContain('SMTP timeout');
  });

  test('Mehrfach-Versand: neue Einträge werden ergänzt (kein Überschreiben)', async () => {
    await cleanupLogs();
    const stub: SendEmailFn = async () => {};
    await sendWegVorschreibungEmails(planId, orgId, stub);
    await sendWegVorschreibungEmails(planId, orgId, stub);

    const logs = await db.select()
      .from(schema.wegVorschreibungEmails)
      .where(eq(schema.wegVorschreibungEmails.vorschreibungId, invoiceId));

    // 1 Vorschreibung × 2 Versandläufe = 2 Einträge
    expect(logs.length).toBe(2);
  });

  test('after service send: GET endpoint returns non-null last_sent_at', async () => {
    await cleanupLogs();
    const stub: SendEmailFn = async () => {};
    await sendWegVorschreibungEmails(planId, orgId, stub);

    const res = await request(app)
      .get(`/api/weg/budget-plans/${planId}/vorschreibungen`)
      .expect(200);

    expect(res.body[0].last_sent_at).not.toBeNull();
  });
});
