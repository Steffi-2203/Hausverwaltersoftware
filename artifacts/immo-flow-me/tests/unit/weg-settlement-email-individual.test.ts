/**
 * WEG-Jahresabrechnung — Individueller E-Mail-Versand (DSGVO Art. 5)
 *
 * Prüft:
 *  1. renderWegSettlementHtml mit ownerId rendert nur die Sektion dieses Eigentümers
 *  2. renderWegSettlementHtml ohne ownerId rendert alle Sektionen (PDF-Modus, unverändert)
 *  3. sendWegSettlementEmails sendet pro Eigentümer eine separate E-Mail
 *     mit ausschließlich seiner eigenen Sektion (kein Datenleck zu anderen Eigentümern)
 *  4. Eigentümer ohne E-Mail-Adresse werden übersprungen (noEmailCount korrekt)
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';

import { rootDb as db } from '../../server/db';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { renderWegSettlementHtml } from '../../server/services/wegSettlementPdfService';
import { sendWegSettlementEmails, type SendEmailFn } from '../../server/services/wegSettlementEmailService';

// ── Testdaten-IDs ─────────────────────────────────────────────────────────────
const orgId       = uuidv4();
const userId      = uuidv4();
const propId      = uuidv4();
const settlementId = uuidv4();

const ownerA      = uuidv4(); // hat E-Mail
const ownerB      = uuidv4(); // hat E-Mail
const ownerC      = uuidv4(); // KEIN E-Mail → noEmailCount

const unitA       = uuidv4();
const unitB       = uuidv4();
const unitC       = uuidv4();

const detailA     = uuidv4();
const detailB     = uuidv4();
const detailC     = uuidv4();

// ── Seed ──────────────────────────────────────────────────────────────────────
async function seed() {
  await db.execute(sql`
    INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'EmailIndiv-Org') ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO profiles (id, email, organization_id)
    VALUES (${userId}::uuid, ${'email-indiv-' + userId.slice(0,8) + '@test.at'}, ${orgId}::uuid)
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'EmailIndiv-Obj', 'Str 1', 'Wien', '1010', 'weg')
    ON CONFLICT DO NOTHING
  `);

  // 3 Eigentümer (C ohne E-Mail)
  await db.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name, email)
    VALUES
      (${ownerA}::uuid, ${orgId}::uuid, 'Anna', 'EigA', ${'ei-a-' + ownerA.slice(0,8) + '@test.at'}),
      (${ownerB}::uuid, ${orgId}::uuid, 'Bob',  'EigB', ${'ei-b-' + ownerB.slice(0,8) + '@test.at'}),
      (${ownerC}::uuid, ${orgId}::uuid, 'Carol','EigC', null)
    ON CONFLICT DO NOTHING
  `);

  // 3 Einheiten
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status) VALUES
      (${unitA}::uuid, ${propId}::uuid, 'Top 1', 'wohnung', 'aktiv'),
      (${unitB}::uuid, ${propId}::uuid, 'Top 2', 'wohnung', 'aktiv'),
      (${unitC}::uuid, ${propId}::uuid, 'Top 3', 'wohnung', 'aktiv')
    ON CONFLICT DO NOTHING
  `);

  // Abrechnung
  await db.execute(sql`
    INSERT INTO weg_settlements
      (id, organization_id, property_id, year, total_expenses, total_prepayments,
       total_difference, owner_count, total_mea, reserve_fund_balance, status)
    VALUES (${settlementId}::uuid, ${orgId}::uuid, ${propId}::uuid, 2034,
            '9000.00', '8000.00', '1000.00', 3, '1000.0000', '2000.00', 'beschlossen')
    ON CONFLICT DO NOTHING
  `);

  // 3 Abrechnungs-Details
  await db.execute(sql`
    INSERT INTO weg_settlement_details
      (id, settlement_id, owner_id, unit_id, mea_share, mea_ratio,
       total_soll, total_ist, saldo, ruecklage_anteil, sonderumlagen, category_details)
    VALUES
      (${detailA}::uuid, ${settlementId}::uuid, ${ownerA}::uuid, ${unitA}::uuid,
       333.3333, 0.3333, '3000.00', '2700.00', '300.00', '300.00', '0.00', '[]'),
      (${detailB}::uuid, ${settlementId}::uuid, ${ownerB}::uuid, ${unitB}::uuid,
       333.3333, 0.3333, '3000.00', '2700.00', '300.00', '300.00', '0.00', '[]'),
      (${detailC}::uuid, ${settlementId}::uuid, ${ownerC}::uuid, ${unitC}::uuid,
       333.3334, 0.3334, '3000.00', '2600.00', '400.00', '300.00', '0.00', '[]')
    ON CONFLICT DO NOTHING
  `);
}

async function cleanup() {
  try {
    // weg_settlement_details ist Append-Only-Ledger — Trigger für Cleanup deaktivieren
    await db.execute(sql`ALTER TABLE weg_settlement_details DISABLE TRIGGER ALL`);
    try {
      await db.execute(sql`DELETE FROM weg_settlement_details WHERE settlement_id = ${settlementId}::uuid`);
    } finally {
      await db.execute(sql`ALTER TABLE weg_settlement_details ENABLE TRIGGER ALL`);
    }
    await db.execute(sql`DELETE FROM weg_settlements WHERE id = ${settlementId}::uuid`);
    await db.execute(sql`DELETE FROM units WHERE id IN (${unitA}::uuid, ${unitB}::uuid, ${unitC}::uuid)`);
    await db.execute(sql`DELETE FROM owners WHERE id IN (${ownerA}::uuid, ${ownerB}::uuid, ${ownerC}::uuid)`);
    await db.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
    await db.execute(sql`DELETE FROM profiles WHERE id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
  } catch (err) {
    console.warn('Cleanup-Fehler (non-fatal):', (err as Error).message);
  }
}

// ── Tests: renderWegSettlementHtml ────────────────────────────────────────────
describe('renderWegSettlementHtml — ownerId-Parameter', () => {
  beforeAll(async () => { await seed(); });
  afterAll(async  () => { await cleanup(); });

  test('ohne ownerId: alle 3 Owner-Sektionen gerendert (PDF-Modus)', async () => {
    const html = await renderWegSettlementHtml(settlementId, orgId);
    // Alle drei Top-Nummern müssen vorkommen
    expect(html).toContain('Top 1');
    expect(html).toContain('Top 2');
    expect(html).toContain('Top 3');
    // Heading "Eigentümer-Einzelabrechnungen" (nicht "Ihre persönliche Abrechnung")
    expect(html).toContain('Eigentümer-Einzelabrechnungen');
    expect(html).not.toContain('Ihre persönliche Abrechnung');
  });

  test('mit ownerId=ownerA: nur Top 1 (EigA) gerendert', async () => {
    const html = await renderWegSettlementHtml(settlementId, orgId, ownerA);
    expect(html).toContain('Top 1');
    expect(html).toContain('Anna');
    // Top 2 und Top 3 dürfen NICHT im HTML erscheinen
    expect(html).not.toContain('Top 2');
    expect(html).not.toContain('Top 3');
  });

  test('mit ownerId=ownerB: nur Top 2 (EigB), kein Top 1 oder Top 3', async () => {
    const html = await renderWegSettlementHtml(settlementId, orgId, ownerB);
    expect(html).toContain('Top 2');
    expect(html).toContain('Bob');
    expect(html).not.toContain('Top 1');
    expect(html).not.toContain('Top 3');
  });

  test('mit ownerId: DSGVO-Hinweis erscheint im HTML', async () => {
    const html = await renderWegSettlementHtml(settlementId, orgId, ownerA);
    expect(html).toContain('Ihre persönliche Abrechnung');
    expect(html).toContain('DSGVO');
  });

  test('mit ownerId: Gesamtübersicht (summary) bleibt erhalten', async () => {
    const html = await renderWegSettlementHtml(settlementId, orgId, ownerA);
    // Kopfzeile / Gesamtübersicht ist für Kontext wichtig und bleibt drin
    expect(html).toContain('Gesamtübersicht');
    expect(html).toContain('2034'); // Jahr
    expect(html).toContain('EmailIndiv-Obj'); // Liegenschaft
  });

  test('mit ungültiger ownerId: leerer Sektionsbereich (kein Fehler)', async () => {
    const html = await renderWegSettlementHtml(settlementId, orgId, uuidv4());
    // Kein Absturz, aber kein "Top N" gerendert
    expect(html).not.toContain('<div class="owner-section">');
  });
});

// ── Tests: sendWegSettlementEmails ────────────────────────────────────────────
describe('sendWegSettlementEmails — pro Eigentümer individuelles HTML', () => {
  beforeAll(async () => { await seed(); });
  afterAll(async  () => { await cleanup(); });

  test('sendet genau 2 E-Mails (ownerA + ownerB), ownerC ohne E-Mail übersprungen', async () => {
    const calls: { to: string; html: string }[] = [];
    const stubSend: SendEmailFn = async (opts) => { calls.push({ to: opts.to, html: opts.html }); };

    const result = await sendWegSettlementEmails(settlementId, orgId, stubSend);

    expect(result.emailsSent).toBe(2);
    expect(result.emailsFailed).toBe(0);
    expect(result.noEmailCount).toBe(1);
    expect(calls).toHaveLength(2);
  });

  test('jede E-Mail enthält nur die Sektion des Empfängers (kein Datenleck)', async () => {
    const calls: { to: string; html: string }[] = [];
    const stubSend: SendEmailFn = async (opts) => { calls.push({ to: opts.to, html: opts.html }); };

    await sendWegSettlementEmails(settlementId, orgId, stubSend);

    // E-Mail an ownerA darf Top 2 und Top 3 nicht enthalten
    const mailA = calls.find(c => c.to.includes('ei-a-'));
    expect(mailA).toBeDefined();
    expect(mailA!.html).toContain('Top 1');
    expect(mailA!.html).not.toContain('Top 2');
    expect(mailA!.html).not.toContain('Top 3');

    // E-Mail an ownerB darf Top 1 und Top 3 nicht enthalten
    const mailB = calls.find(c => c.to.includes('ei-b-'));
    expect(mailB).toBeDefined();
    expect(mailB!.html).toContain('Top 2');
    expect(mailB!.html).not.toContain('Top 1');
    expect(mailB!.html).not.toContain('Top 3');
  });

  test('jede E-Mail enthält den DSGVO-Hinweis', async () => {
    const calls: { to: string; html: string }[] = [];
    const stubSend: SendEmailFn = async (opts) => { calls.push({ to: opts.to, html: opts.html }); };

    await sendWegSettlementEmails(settlementId, orgId, stubSend);

    for (const call of calls) {
      expect(call.html).toContain('DSGVO');
      expect(call.html).toContain('Ihre persönliche Abrechnung');
    }
  });

  test('E-Mail-Betreff enthält Jahr und Liegenschaftsname', async () => {
    const subjects: string[] = [];
    const stubSend: SendEmailFn = async (opts) => { subjects.push((opts as any).subject || ''); };

    // Wir prüfen den subject-Parameter via direkten Aufruf des stubs
    const calls: { to: string; subject: string; html: string }[] = [];
    const stubWithSubject: SendEmailFn = async (opts) => {
      calls.push({ to: opts.to, subject: (opts as any).subject || '', html: opts.html });
    };

    await sendWegSettlementEmails(settlementId, orgId, stubWithSubject);

    for (const call of calls) {
      expect(call.subject).toContain('2034');
      expect(call.subject).toContain('EmailIndiv-Obj');
    }
  });
});
