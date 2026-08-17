/**
 * End-to-End-Verschlüsselungstests über die ECHTEN Routen:
 *
 *  1. POST /api/transactions (echter Write-Pfad) →
 *     rootDb zeigt Chiffretext (enc:v1:) →
 *     GET /api/transactions (Liste) und GET /api/transactions/:id liefern Klartext
 *  2. Readonly-API GET /tenants + /tenants/:id liefern Klartext-IBAN/BIC
 *     obwohl die DB Chiffretext enthält
 *  3. IBAN-basiertes Payment-Matching: POST /api/transactions/auto-match
 *     matcht eine Transaktion (verschlüsselte partner_iban) gegen einen
 *     Mieter (verschlüsselte iban) — beweist dass der Vergleich auf
 *     Klartext-Ebene stattfindet (Ciphertext-Vergleich würde nie matchen,
 *     da GCM zufällige IVs nutzt).
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';
import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { rootDb } from '../../server/db';
import { sql } from 'drizzle-orm';

// ── Schlüssel-Setup: deterministischer Test-Key (32 Byte) ────────────────────
const TEST_KEY = Buffer.alloc(32, 7).toString('base64');
const _origKey = process.env.FIELD_ENCRYPTION_KEY;
beforeAll(() => { process.env.FIELD_ENCRYPTION_KEY = TEST_KEY; });
// Serialisierung gegen andere Encryption-DB-Tests: erzeugt verschlüsselte
// Fixtures mit einem Test-Key, den parallel laufende Rotations-/Migrations-
// Tests nicht lesen können (siehe tests/helpers/encryptionTestLock.ts).
import { acquireEncryptionTestLock, releaseEncryptionTestLock } from '../helpers/encryptionTestLock';
beforeAll(async () => { await acquireEncryptionTestLock(); });
afterAll(() => {
  if (_origKey === undefined) delete process.env.FIELD_ENCRYPTION_KEY;
  else process.env.FIELD_ENCRYPTION_KEY = _origKey;
});

import paymentRouter from '../../server/routes/paymentRoutes';
import readonlyRouter from '../../server/routes/readonly';
import { addOrgContext } from '../helpers/withOrgContext';
import { setupTestDb, teardownTestDb } from '../helpers/db';
import { encryptField, isEncrypted } from '../../server/lib/fieldEncryption';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const orgId    = uuidv4();
const userId   = uuidv4();
const propId   = uuidv4();
const unitId   = uuidv4();
const tenantId = uuidv4();
const baId     = uuidv4();

const READONLY_KEY  = `enc-e2e-key-${uuidv4()}`;
const TENANT_IBAN   = 'AT611904300234573201';
const TENANT_BIC    = 'RLNWATW1';
const PARTNER_IBAN  = 'AT611904300234573201'; // identisch → IBAN-Match
const BANK_IBAN     = 'AT021420020010147558';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.session = { userId, organizationId: orgId };
    next();
  });
  addOrgContext(app, orgId);
  app.use(paymentRouter);
  return app;
}

function buildReadonlyApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/readonly', readonlyRouter);
  return app;
}

async function seed() {
  await rootDb.execute(sql`
    INSERT INTO organizations (id, name, readonly_api_key)
    VALUES (${orgId}::uuid, 'Enc-E2E-Org', ${READONLY_KEY}) ON CONFLICT DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO profiles (id, email, full_name, organization_id, created_at)
    VALUES (${userId}::uuid, ${'enc-e2e-' + userId + '@test.at'}, 'Enc E2E', ${orgId}::uuid, NOW())
    ON CONFLICT DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO user_roles (user_id, role, created_at)
    VALUES (${userId}::uuid, 'admin', NOW()) ON CONFLICT DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'Enc-E2E-Haus', 'Teststr. 9', 'Wien', '1010', 'mietverwaltung')
    ON CONFLICT DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status)
    VALUES (${unitId}::uuid, ${propId}::uuid, 'Top 1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING
  `);
  // Mieter mit VERSCHLÜSSELTER IBAN/BIC (wie der echte Write-Pfad speichert)
  await rootDb.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, iban, bic)
    VALUES (${tenantId}::uuid, ${unitId}::uuid, 'Enc', 'Mieter',
            ${encryptField(TENANT_IBAN)}, ${encryptField(TENANT_BIC)})
    ON CONFLICT DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO bank_accounts (id, organization_id, property_id, account_name, iban)
    VALUES (${baId}::uuid, ${orgId}::uuid, ${propId}::uuid, 'Enc-E2E-Konto', ${encryptField(BANK_IBAN)})
    ON CONFLICT DO NOTHING
  `);
}

async function cleanup() {
  await rootDb.execute(sql`DELETE FROM transactions WHERE bank_account_id = ${baId}::uuid`);
  await rootDb.execute(sql`DELETE FROM bank_accounts WHERE id = ${baId}::uuid`);
  await rootDb.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`);
  await rootDb.execute(sql`DELETE FROM units WHERE id = ${unitId}::uuid`);
  await rootDb.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
  await rootDb.execute(sql`DELETE FROM user_roles WHERE user_id = ${userId}::uuid`);
  await rootDb.execute(sql`DELETE FROM profiles WHERE id = ${userId}::uuid`);
  await rootDb.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
}

beforeAll(async () => { await setupTestDb(); await cleanup(); await seed(); });
// Lock erst NACH dem Fixture-Cleanup freigeben (Hooks laufen in Registrierungsreihenfolge).
afterAll(async () => { await cleanup(); await teardownTestDb(); await releaseEncryptionTestLock(); });

// ── 1) Transaction Write → Ciphertext in DB → Klartext über Read-Routen ─────

describe('Transactions: Write-Route verschlüsselt, Read-Routen entschlüsseln', () => {
  let txId: string;

  test('POST /api/transactions speichert partner_iban verschlüsselt', async () => {
    const res = await request(buildApp())
      .post('/api/transactions')
      .send({
        organization_id: orgId,
        bank_account_id: baId,
        transaction_date: '2026-01-15',
        amount: '850.00',
        partner_name: 'Enc Mieter',
        partner_iban: PARTNER_IBAN,
        reference: 'Miete Jaenner',
      })
      .expect(200);

    txId = res.body.id;
    // Response des Write-Pfads: Klartext
    expect(res.body.partnerIban).toBe(PARTNER_IBAN);

    // rootDb: Chiffretext
    const raw = await rootDb.execute(sql`
      SELECT partner_iban FROM transactions WHERE id = ${txId}::uuid
    `);
    const stored = (raw.rows[0] as any).partner_iban as string;
    expect(isEncrypted(stored)).toBe(true);
    expect(stored).not.toContain(PARTNER_IBAN);
  });

  test('GET /api/transactions (Liste) liefert Klartext-partnerIban', async () => {
    const res = await request(buildApp()).get('/api/transactions').expect(200);
    const tx = res.body.data.find((t: any) => t.id === txId);
    expect(tx).toBeDefined();
    expect(tx.partnerIban).toBe(PARTNER_IBAN);
    expect(String(tx.partnerIban)).not.toContain('enc:v1:');
  });

  test('GET /api/transactions/:id liefert Klartext-partnerIban', async () => {
    const res = await request(buildApp()).get(`/api/transactions/${txId}`).expect(200);
    expect(res.body.partnerIban).toBe(PARTNER_IBAN);
  });

  // ── 3) IBAN-Matching nach CAMT-Import ────────────────────────────────────

  test('POST /api/transactions/auto-match matcht Mieter über IBAN (Klartext-Vergleich)', async () => {
    const res = await request(buildApp())
      .post('/api/transactions/auto-match')
      .send({ transactionIds: [txId] })
      .expect(200);

    const body = JSON.stringify(res.body);
    // Der Mieter muss über IBAN-Übereinstimmung gefunden werden (Konfidenz 95)
    expect(body).toContain(tenantId);
    expect(body).toContain('IBAN');
  });
});

// ── 2) Readonly-API: Mieter mit Klartext-IBAN/BIC ───────────────────────────

describe('Readonly-API: Tenants liefern Klartext trotz Chiffretext in DB', () => {
  test('DB enthält Chiffretext (Vorbedingung)', async () => {
    const raw = await rootDb.execute(sql`SELECT iban, bic FROM tenants WHERE id = ${tenantId}::uuid`);
    expect(isEncrypted((raw.rows[0] as any).iban)).toBe(true);
    expect(isEncrypted((raw.rows[0] as any).bic)).toBe(true);
  });

  test('GET /tenants liefert Klartext-IBAN/BIC', async () => {
    const res = await request(buildReadonlyApp())
      .get(`/api/readonly/tenants?organization_id=${orgId}`)
      .set('X-Api-Key', READONLY_KEY)
      .expect(200);

    const t = res.body.data.find((x: any) => x.id === tenantId);
    expect(t).toBeDefined();
    expect(t.iban).toBe(TENANT_IBAN);
    expect(t.bic).toBe(TENANT_BIC);
  });

  test('GET /tenants/:id liefert Klartext-IBAN/BIC', async () => {
    const res = await request(buildReadonlyApp())
      .get(`/api/readonly/tenants/${tenantId}?organization_id=${orgId}`)
      .set('X-Api-Key', READONLY_KEY)
      .expect(200);

    expect(res.body.data.iban).toBe(TENANT_IBAN);
    expect(res.body.data.bic).toBe(TENANT_BIC);
  });
});
