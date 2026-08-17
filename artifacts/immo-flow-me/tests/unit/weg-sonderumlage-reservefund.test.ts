/**
 * Sonderumlage → Rücklage-Eintrag — Integrationstest
 *
 * Prüft dass nach Erstellen von Vorschreibungen für eine Sonderumlage
 * mit credits_reserve_fund=true ein Eintrag in weg_reserve_fund erscheint
 * und über GET /api/weg/reserve-fund abrufbar ist.
 *
 * Prüft außerdem dass bei credits_reserve_fund=false KEIN Rücklage-Eintrag entsteht.
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
const orgId    = uuidv4();
const userId   = uuidv4();
const propId   = uuidv4();
const unitId   = uuidv4();
const ownerId  = uuidv4();
const unitOwnerId = uuidv4();

// ── Express-Testapp ──────────────────────────────────────────────────────────
function buildApp(uid: string | null = userId) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: uid, organizationId: orgId };
    next();
  });
  addOrgContext(app, uid ? orgId : null);
  app.use(wegRouter);
  return app;
}

const authApp = buildApp();
const anonApp = buildApp(null);

// ── Seed & Cleanup ────────────────────────────────────────────────────────────
async function seed() {
  await db.execute(sql`
    INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'SU-Reserve-Test-Org') ON CONFLICT DO NOTHING
  `);
  // E-Mail mit userId-Suffix für eindeutigen Eintrag pro Testlauf
  await db.execute(sql`
    INSERT INTO profiles (id, email, organization_id)
    VALUES (${userId}::uuid, ${`su-${userId.slice(0, 8)}@test.at`}, ${orgId}::uuid) ON CONFLICT DO NOTHING
  `);
  // user_roles hat kein organization_id — nur (user_id, role)
  await db.execute(sql`
    INSERT INTO user_roles (user_id, role) VALUES (${userId}::uuid, 'admin') ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'SU-Test-Obj', 'Str 1', 'Wien', '1010', 'weg') ON CONFLICT DO NOTHING
  `);
  // units hat kein organization_id — nur property_id
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type)
    VALUES (${unitId}::uuid, ${propId}::uuid, 'Top 1', 'wohnung') ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name, email)
    VALUES (${ownerId}::uuid, ${orgId}::uuid, 'Test', 'Eigentümer', 'testeig@test.at') ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO weg_unit_owners (id, organization_id, property_id, unit_id, owner_id, mea_share, valid_from)
    VALUES (${unitOwnerId}::uuid, ${orgId}::uuid, ${propId}::uuid, ${unitId}::uuid, ${ownerId}::uuid, 1000, CURRENT_DATE)
    ON CONFLICT DO NOTHING
  `);
}

async function cleanup() {
  try {
    await db.execute(sql`DELETE FROM weg_reserve_fund WHERE organization_id = ${orgId}::uuid`);
    await db.execute(sql`DELETE FROM weg_vorschreibungen WHERE organization_id = ${orgId}::uuid`);
    await db.execute(sql`DELETE FROM weg_special_assessments WHERE organization_id = ${orgId}::uuid`);
    await db.execute(sql`DELETE FROM weg_unit_owners WHERE organization_id = ${orgId}::uuid`);
    await db.execute(sql`DELETE FROM owners WHERE organization_id = ${orgId}::uuid`);
    // units ist über property_id zu löschen (kein organization_id)
    await db.execute(sql`DELETE FROM units WHERE property_id = ${propId}::uuid`);
    await db.execute(sql`DELETE FROM properties WHERE organization_id = ${orgId}::uuid`);
    // Cleanup nach userId (sicherer als nach organization_id wegen FK-Reihenfolge)
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM profiles WHERE id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
  } catch (err) {
    // Cleanup-Fehler nicht fatal — Test-Isolation über uuid-basierten orgId
    console.warn('Cleanup partial error (not fatal):', (err as Error).message);
  }
}

beforeAll(async () => { await setupTestDb(); await seed(); });
afterAll(async () => { await cleanup(); await teardownTestDb(); });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Sonderumlage mit credits_reserve_fund=true → Rücklage-Eintrag sichtbar', () => {
  let assessmentId: string;

  test('POST /api/weg/special-assessments → Sonderumlage mit credits_reserve_fund=true anlegen', async () => {
    const res = await request(authApp)
      .post('/api/weg/special-assessments')
      .send({
        propertyId: propId,
        title: 'Dachsanierung 2026',
        totalAmount: '12000.00',
        allocationKey: 'mea',
        status: 'beschlossen',
        creditsReserveFund: true,
      });
    expect(res.status).toBe(201);
    const body = res.body;
    assessmentId = body.id ?? body?.data?.id;
    expect(assessmentId).toBeTruthy();
    // credits_reserve_fund muss als true zurückkommen (snake_case oder camelCase)
    const crf = body.credits_reserve_fund ?? body.creditsReserveFund;
    expect(crf).toBe(true);
  });

  test('POST /api/weg/special-assessments/:id/invoice → Vorschreibungen erstellen', async () => {
    expect(assessmentId).toBeTruthy();
    const res = await request(authApp)
      .post(`/api/weg/special-assessments/${assessmentId}/invoice`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);
    // reserve_entry_created muss true sein (credits_reserve_fund=true)
    expect(res.body.reserve_entry_created).toBe(true);
    expect(res.body.reserve_entry).not.toBeNull();
  });

  test('GET /api/weg/reserve-fund?propertyId=… → Rücklage-Eintrag ist sichtbar', async () => {
    const res = await request(authApp)
      .get(`/api/weg/reserve-fund?propertyId=${propId}`);
    expect(res.status).toBe(200);
    const entries: any[] = Array.isArray(res.body) ? res.body : res.body.entries ?? [];
    const sonderumlageEntry = entries.find((e: any) =>
      (e.entry_type ?? e.entryType) === 'einzahlung' &&
      (e.description ?? '').includes('Sonderumlage')
    );
    expect(sonderumlageEntry).toBeDefined();
    expect(parseFloat(sonderumlageEntry?.amount ?? '0')).toBe(12000);
  });

  test('GET /api/weg/reserve-fund ohne Auth → 401', async () => {
    const res = await request(anonApp).get(`/api/weg/reserve-fund?propertyId=${propId}`);
    expect(res.status).toBe(401);
  });
});

describe('Idempotenz — doppelte Fakturierung wird verhindert', () => {
  let idempotentAssessmentId: string;

  test('Neue Sonderumlage anlegen für Idempotenz-Test', async () => {
    const res = await request(authApp)
      .post('/api/weg/special-assessments')
      .send({
        propertyId: propId,
        title: 'Lifteinbau 2026',
        totalAmount: '20000.00',
        allocationKey: 'mea',
        status: 'beschlossen',
        creditsReserveFund: false,
      });
    expect(res.status).toBe(201);
    idempotentAssessmentId = res.body.id;
    expect(idempotentAssessmentId).toBeTruthy();
  });

  test('Erste Fakturierung → erfolgreich', async () => {
    const res = await request(authApp)
      .post(`/api/weg/special-assessments/${idempotentAssessmentId}/invoice`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);
  });

  test('Zweite Fakturierung desselben Eintrags → 400 (keine Duplikate)', async () => {
    const res = await request(authApp)
      .post(`/api/weg/special-assessments/${idempotentAssessmentId}/invoice`)
      .send({});
    // Muss mit Fehler ablehnen — Doppelfakturierung ist unzulässig
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bereits abgerechnet/i);
  });

  test('Status nach Fakturierung ist abgerechnet', async () => {
    const res = await request(authApp)
      .get(`/api/weg/special-assessments?propertyId=${propId}`);
    expect(res.status).toBe(200);
    const entries: any[] = Array.isArray(res.body) ? res.body : [];
    const entry = entries.find((e: any) => (e.id ?? e.id) === idempotentAssessmentId);
    expect(entry?.status).toBe('abgerechnet');
  });
});

describe('Parallele Fakturierung — nur genau eine Transaktion darf durchkommen', () => {
  let parallelAssessmentId: string;

  test('Neue Sonderumlage für Paralleltest anlegen', async () => {
    const res = await request(authApp)
      .post('/api/weg/special-assessments')
      .send({
        propertyId: propId,
        title: 'Paralleltest Sonderumlage',
        totalAmount: '5000.00',
        allocationKey: 'mea',
        status: 'beschlossen',
        creditsReserveFund: false,
      });
    expect(res.status).toBe(201);
    parallelAssessmentId = res.body.id;
    expect(parallelAssessmentId).toBeTruthy();
  });

  test('Gleichzeitige Requests: genau einer erfolgreich, genau ein Satz Vorschreibungen', async () => {
    // Fünf gleichzeitige Requests auf denselben Endpunkt
    const results = await Promise.allSettled([
      request(authApp).post(`/api/weg/special-assessments/${parallelAssessmentId}/invoice`).send({}),
      request(authApp).post(`/api/weg/special-assessments/${parallelAssessmentId}/invoice`).send({}),
      request(authApp).post(`/api/weg/special-assessments/${parallelAssessmentId}/invoice`).send({}),
      request(authApp).post(`/api/weg/special-assessments/${parallelAssessmentId}/invoice`).send({}),
      request(authApp).post(`/api/weg/special-assessments/${parallelAssessmentId}/invoice`).send({}),
    ]);

    const responses = results.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);
    const successes = responses.filter((r: any) => r.status === 200);
    const failures  = responses.filter((r: any) => r.status === 400);

    // Genau einer darf erfolgreich sein
    expect(successes.length).toBe(1);
    // Alle anderen müssen mit 400 ablehnen
    expect(failures.length).toBe(responses.length - 1);

    // Genau ein Satz Vorschreibungen — keine Duplikate
    const invoiceCheck = await request(authApp)
      .get(`/api/weg/vorschreibungen?propertyId=${propId}`);
    const allVorschreibungen: any[] = Array.isArray(invoiceCheck.body)
      ? invoiceCheck.body
      : invoiceCheck.body?.data ?? [];
    // Vorschreibungen die zum parallelAssessmentId runId gehören sollten genau
    // so viele sein wie Eigentümer existieren (=1 in unserem Test-Setup).
    const successBody = successes[0].body;
    const runId = successBody?.vorschreibungen?.[0]?.run_id;
    if (runId) {
      const forThisRun = allVorschreibungen.filter((v: any) => (v.run_id ?? v.runId) === runId);
      expect(forThisRun.length).toBe(successBody.count);
    } else {
      // Mindestprüfung: count === 1 (ein Eigentümer im Test-Setup)
      expect(successBody.count).toBe(1);
    }
  });
});

describe('Sonderumlage mit credits_reserve_fund=false → KEIN Rücklage-Eintrag', () => {
  let assessmentId2: string;
  let reserveCountBefore: number;

  test('Rücklage-Einträge vor der Fakturierung zählen', async () => {
    const res = await request(authApp).get(`/api/weg/reserve-fund?propertyId=${propId}`);
    expect(res.status).toBe(200);
    const entries: any[] = Array.isArray(res.body) ? res.body : res.body.entries ?? [];
    reserveCountBefore = entries.length;
  });

  test('POST /api/weg/special-assessments → Sonderumlage ohne Rücklage anlegen', async () => {
    const res = await request(authApp)
      .post('/api/weg/special-assessments')
      .send({
        propertyId: propId,
        title: 'Fassadenreinigung 2026',
        totalAmount: '3000.00',
        allocationKey: 'mea',
        status: 'beschlossen',
        creditsReserveFund: false,
      });
    expect(res.status).toBe(201);
    assessmentId2 = res.body.id;
    expect(assessmentId2).toBeTruthy();
  });

  test('POST /api/weg/special-assessments/:id/invoice → kein Rücklage-Eintrag erzeugt', async () => {
    expect(assessmentId2).toBeTruthy();
    const res = await request(authApp)
      .post(`/api/weg/special-assessments/${assessmentId2}/invoice`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);
    // reserve_entry_created muss false sein
    expect(res.body.reserve_entry_created).toBe(false);
    expect(res.body.reserve_entry).toBeNull();
  });

  test('GET /api/weg/reserve-fund → Anzahl Einträge hat sich nicht erhöht', async () => {
    const res = await request(authApp).get(`/api/weg/reserve-fund?propertyId=${propId}`);
    expect(res.status).toBe(200);
    const entries: any[] = Array.isArray(res.body) ? res.body : res.body.entries ?? [];
    // Keine neuen Einträge durch credits_reserve_fund=false Sonderumlage
    expect(entries.length).toBe(reserveCountBefore);
  });
});

describe('PATCH /api/weg/special-assessments/:id — Status-Regression verboten', () => {
  let patchTestId: string;

  test('Neue Sonderumlage anlegen und fakturieren', async () => {
    const cr = await request(authApp)
      .post('/api/weg/special-assessments')
      .send({
        propertyId: propId,
        title: 'PATCH-Schutz-Test',
        totalAmount: '1000.00',
        allocationKey: 'mea',
        status: 'beschlossen',
        creditsReserveFund: false,
      });
    expect(cr.status).toBe(201);
    patchTestId = cr.body.id;

    const ir = await request(authApp)
      .post(`/api/weg/special-assessments/${patchTestId}/invoice`)
      .send({});
    expect(ir.status).toBe(200);
    expect(ir.body.count).toBeGreaterThan(0);
  });

  test('PATCH auf abgerechnete Sonderumlage → 409 (keine Statusregression möglich)', async () => {
    expect(patchTestId).toBeTruthy();
    const res = await request(authApp)
      .patch(`/api/weg/special-assessments/${patchTestId}`)
      .send({ status: 'beschlossen' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/abgerechnet/i);
  });

  test('PATCH mit ungültigem Status (in_bearbeitung per PATCH) → 422', async () => {
    // Erst eine neue beschlossene Sonderumlage anlegen
    const cr2 = await request(authApp)
      .post('/api/weg/special-assessments')
      .send({
        propertyId: propId,
        title: 'PATCH-Invalid-Status-Test',
        totalAmount: '500.00',
        allocationKey: 'mea',
        status: 'beschlossen',
        creditsReserveFund: false,
      });
    expect(cr2.status).toBe(201);
    const id2 = cr2.body.id;

    const res = await request(authApp)
      .patch(`/api/weg/special-assessments/${id2}`)
      .send({ status: 'in_bearbeitung' });
    expect(res.status).toBe(422);
  });
});
