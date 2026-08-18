/**
 * Task #166: Concurrent-Org-Isolation für Payments, Mieter-Vorschreibungsliste
 * und WEG-Vorschreibungsliste.
 *
 * Testet den Angriffsvektor "Connection-Pool + app.current_org": Bei 12+
 * parallelen Anfragen (6 pro Org) darf keine Antwort IDs der jeweils anderen
 * Organisation enthalten.
 *
 * Vorlage: open-items-concurrent.test.ts (Task #106)
 * Helper:  tests/helpers/concurrentOrgIsolation.ts
 *
 * Endpunkte:
 *   1. GET /api/payments          — via paymentRoutes (explicit tenant-subquery)
 *   2. GET /api/invoices           — via paymentRoutes (explicit unit-subquery)
 *   3. GET /api/weg/vorschreibungen — via wegRoutes  (explicit organizationId WHERE)
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';

import { rootDb as db } from '../../server/db';
import { addOrgContext } from '../helpers/withOrgContext';
import { assertConcurrentOrgIsolation } from '../helpers/concurrentOrgIsolation';

import paymentRoutes  from '../../server/routes/paymentRoutes';
import wegRouter      from '../../server/routes/wegRoutes';

// ── Testdaten-IDs ─────────────────────────────────────────────────────────────

const orgA   = randomUUID();
const orgB   = randomUUID();
const userA  = randomUUID();
const userB  = randomUUID();

// Org A
const propA  = randomUUID();
const unitA  = randomUUID();
const ownA   = randomUUID();
const tenA   = randomUUID();
const payA   = randomUUID();   // payment Org A
const miA    = randomUUID();   // monthly_invoice Org A
const wvA    = randomUUID();   // weg_vorschreibung Org A

// Org B
const propB  = randomUUID();
const unitB  = randomUUID();
const ownB   = randomUUID();
const tenB   = randomUUID();
const payB   = randomUUID();   // payment Org B
const miB    = randomUUID();   // monthly_invoice Org B
const wvB    = randomUUID();   // weg_vorschreibung Org B

// ── App-Factories ─────────────────────────────────────────────────────────────

function buildPaymentApp(orgId: string, userId: string) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organizationId: orgId };
    next();
  });
  addOrgContext(app, orgId);
  app.use(paymentRoutes);
  return app;
}

function buildWegApp(orgId: string, userId: string) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organizationId: orgId };
    next();
  });
  addOrgContext(app, orgId);
  app.use(wegRouter);
  return app;
}

const payAppA = buildPaymentApp(orgA, userA);
const payAppB = buildPaymentApp(orgB, userB);
const wegAppA = buildWegApp(orgA, userA);
const wegAppB = buildWegApp(orgB, userB);

// ── Seed / Cleanup ────────────────────────────────────────────────────────────

const e = (prefix: string, id: string) => `${prefix}-${id.slice(0, 8)}@pvc.at`;

async function seed() {
  // Org A
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgA}::uuid, 'PVC-OrgA') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${userA}::uuid, ${e('ua', userA)}, ${orgA}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${userA}::uuid, 'admin') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propA}::uuid, ${orgA}::uuid, 'PVC-ObjA', 'Str 1', 'Wien', '1010', 'weg')
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO units (id, property_id, top_nummer, type, status) VALUES (${unitA}::uuid, ${propA}::uuid, 'A1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO owners (id, organization_id, first_name, last_name, email) VALUES (${ownA}::uuid, ${orgA}::uuid, 'OwnA', 'PVC', ${e('ownA', ownA)}) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO tenants (id, unit_id, first_name, last_name, email, status) VALUES (${tenA}::uuid, ${unitA}::uuid, 'TenA', 'PVC', ${e('tenA', tenA)}, 'aktiv') ON CONFLICT DO NOTHING`);
  // Payment Org A — verknüpft über tenant → unit → property → org
  await db.execute(sql`
    INSERT INTO payments (id, tenant_id, betrag, buchungs_datum)
    VALUES (${payA}::uuid, ${tenA}::uuid, 500.00, '2045-01-15')
    ON CONFLICT DO NOTHING`);
  // Monthly invoice Org A — verknüpft über unit → property → org
  await db.execute(sql`
    INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, status, faellig_am)
    VALUES (${miA}::uuid, ${tenA}::uuid, ${unitA}::uuid, 2045, 1, 600.00, 600.00, 'offen', '2045-01-31')
    ON CONFLICT DO NOTHING`);
  // WEG-Vorschreibung Org A — hat direktes organization_id-Feld
  await db.execute(sql`
    INSERT INTO weg_vorschreibungen
      (id, organization_id, property_id, unit_id, owner_id,
       year, month, mea_share, betriebskosten, ruecklage, instandhaltung,
       verwaltungshonorar, heizung, ust, gesamtbetrag, status, faellig_am)
    VALUES (${wvA}::uuid, ${orgA}::uuid, ${propA}::uuid, ${unitA}::uuid, ${ownA}::uuid,
            2045, 1, 333, 280, 60, 25, 25, 10, 0, 400.00, 'offen', '2045-01-31')
    ON CONFLICT DO NOTHING`);

  // Org B
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgB}::uuid, 'PVC-OrgB') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${userB}::uuid, ${e('ub', userB)}, ${orgB}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${userB}::uuid, 'admin') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propB}::uuid, ${orgB}::uuid, 'PVC-ObjB', 'Str 2', 'Wien', '1010', 'weg')
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO units (id, property_id, top_nummer, type, status) VALUES (${unitB}::uuid, ${propB}::uuid, 'B1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO owners (id, organization_id, first_name, last_name, email) VALUES (${ownB}::uuid, ${orgB}::uuid, 'OwnB', 'PVC', ${e('ownB', ownB)}) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO tenants (id, unit_id, first_name, last_name, email, status) VALUES (${tenB}::uuid, ${unitB}::uuid, 'TenB', 'PVC', ${e('tenB', tenB)}, 'aktiv') ON CONFLICT DO NOTHING`);
  // Payment Org B
  await db.execute(sql`
    INSERT INTO payments (id, tenant_id, betrag, buchungs_datum)
    VALUES (${payB}::uuid, ${tenB}::uuid, 350.00, '2045-01-15')
    ON CONFLICT DO NOTHING`);
  // Monthly invoice Org B
  await db.execute(sql`
    INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, status, faellig_am)
    VALUES (${miB}::uuid, ${tenB}::uuid, ${unitB}::uuid, 2045, 1, 450.00, 450.00, 'offen', '2045-01-31')
    ON CONFLICT DO NOTHING`);
  // WEG-Vorschreibung Org B
  await db.execute(sql`
    INSERT INTO weg_vorschreibungen
      (id, organization_id, property_id, unit_id, owner_id,
       year, month, mea_share, betriebskosten, ruecklage, instandhaltung,
       verwaltungshonorar, heizung, ust, gesamtbetrag, status, faellig_am)
    VALUES (${wvB}::uuid, ${orgB}::uuid, ${propB}::uuid, ${unitB}::uuid, ${ownB}::uuid,
            2045, 1, 333, 170, 40, 15, 15, 10, 0, 250.00, 'offen', '2045-01-31')
    ON CONFLICT DO NOTHING`);
}

async function cleanup() {
  try {
    await db.execute(sql`DELETE FROM weg_vorschreibungen WHERE id IN (${wvA}::uuid, ${wvB}::uuid)`);
    await db.execute(sql`DELETE FROM monthly_invoices    WHERE id IN (${miA}::uuid, ${miB}::uuid)`);
    await db.execute(sql`DELETE FROM payments            WHERE id IN (${payA}::uuid, ${payB}::uuid)`);
    await db.execute(sql`DELETE FROM tenants  WHERE id IN (${tenA}::uuid, ${tenB}::uuid)`);
    await db.execute(sql`DELETE FROM owners   WHERE id IN (${ownA}::uuid, ${ownB}::uuid)`);
    await db.execute(sql`DELETE FROM units    WHERE id IN (${unitA}::uuid, ${unitB}::uuid)`);
    await db.execute(sql`DELETE FROM properties WHERE id IN (${propA}::uuid, ${propB}::uuid)`);
    await db.execute(sql`DELETE FROM user_roles WHERE user_id IN (${userA}::uuid, ${userB}::uuid)`);
    await db.execute(sql`DELETE FROM profiles   WHERE id IN (${userA}::uuid, ${userB}::uuid)`);
    await db.execute(sql`DELETE FROM organizations WHERE id IN (${orgA}::uuid, ${orgB}::uuid)`);
  } catch (err) {
    console.warn('PVC-Cleanup (non-fatal):', (err as Error).message);
  }
}

// ── Test-Suite ─────────────────────────────────────────────────────────────────

before(async () => { await cleanup(); await seed(); });
after(async  () => { await cleanup(); });

// ── 1. GET /api/payments ───────────────────────────────────────────────────────

describe('GET /api/payments — Concurrent Org-Grenz-Isolation (12 parallele Anfragen)', () => {
  test('12 parallele Anfragen (6 Org-A + 6 Org-B): keine Antwort enthält Fremd-Org-Zahlungen', async () => {
    await assertConcurrentOrgIsolation({
      appA: payAppA,
      appB: payAppB,
      endpoint: '/api/payments',
      ownIdsA:    [payA],
      ownIdsB:    [payB],
      foreignIdsA: [payB],
      foreignIdsB: [payA],
      extractIds: (body) => (body.data ?? []).map((i: any) => i.id),
    });
  });

  test('Wiederholung unter Last: 3 Runden à 12 Anfragen bleiben isoliert', async () => {
    await assertConcurrentOrgIsolation({
      appA: payAppA,
      appB: payAppB,
      endpoint: '/api/payments',
      ownIdsA:    [payA],
      ownIdsB:    [payB],
      foreignIdsA: [payB],
      foreignIdsB: [payA],
      extractIds: (body) => (body.data ?? []).map((i: any) => i.id),
      rounds: 3,
    });
  });

  test('Org-A-Antwort enthält nur Zahlungen des eigenen Mieters (tenantId-Check)', async () => {
    const res = await request(payAppA).get('/api/payments').expect(200);
    const items: any[] = res.body.data ?? [];
    // Alle Zahlungen müssen dem Mieter von Org A gehören
    const tenantIds = items.map((i: any) => i.tenantId ?? i.tenant_id);
    for (const tid of tenantIds) {
      assert.notEqual(tid, tenB, 'Org-A-Antwort enthält Org-B-Mieter-ID');
    }
  });
});

// ── 2. GET /api/invoices ───────────────────────────────────────────────────────

describe('GET /api/invoices — Concurrent Org-Grenz-Isolation (12 parallele Anfragen)', () => {
  test('12 parallele Anfragen (6 Org-A + 6 Org-B): keine Antwort enthält Fremd-Org-Vorschreibungen', async () => {
    await assertConcurrentOrgIsolation({
      appA: payAppA,
      appB: payAppB,
      endpoint: '/api/invoices',
      ownIdsA:    [miA],
      ownIdsB:    [miB],
      foreignIdsA: [miB],
      foreignIdsB: [miA],
      extractIds: (body) => (body.data ?? []).map((i: any) => i.id),
    });
  });

  test('Wiederholung unter Last: 3 Runden à 12 Anfragen bleiben isoliert', async () => {
    await assertConcurrentOrgIsolation({
      appA: payAppA,
      appB: payAppB,
      endpoint: '/api/invoices',
      ownIdsA:    [miA],
      ownIdsB:    [miB],
      foreignIdsA: [miB],
      foreignIdsB: [miA],
      extractIds: (body) => (body.data ?? []).map((i: any) => i.id),
      rounds: 3,
    });
  });

  test('Org-B-Antwort enthält nur Einheiten der eigenen Liegenschaft (unitId-Check)', async () => {
    const res = await request(payAppB).get('/api/invoices').expect(200);
    const items: any[] = res.body.data ?? [];
    const unitIds = items.map((i: any) => i.unitId ?? i.unit_id);
    for (const uid of unitIds) {
      assert.notEqual(uid, unitA, 'Org-B-Antwort enthält Org-A-Einheiten-ID');
    }
  });
});

// ── 3. GET /api/weg/vorschreibungen ───────────────────────────────────────────

describe('GET /api/weg/vorschreibungen — Concurrent Org-Grenz-Isolation (12 parallele Anfragen)', () => {
  test('12 parallele Anfragen (6 Org-A + 6 Org-B): keine Antwort enthält Fremd-Org-WEG-Vorschreibungen', async () => {
    await assertConcurrentOrgIsolation({
      appA: wegAppA,
      appB: wegAppB,
      endpoint: '/api/weg/vorschreibungen',
      ownIdsA:    [wvA],
      ownIdsB:    [wvB],
      foreignIdsA: [wvB],
      foreignIdsB: [wvA],
      extractIds: (body) => (Array.isArray(body) ? body : []).map((i: any) => i.id),
    });
  });

  test('Wiederholung unter Last: 3 Runden à 12 Anfragen bleiben isoliert', async () => {
    await assertConcurrentOrgIsolation({
      appA: wegAppA,
      appB: wegAppB,
      endpoint: '/api/weg/vorschreibungen',
      ownIdsA:    [wvA],
      ownIdsB:    [wvB],
      foreignIdsA: [wvB],
      foreignIdsB: [wvA],
      extractIds: (body) => (Array.isArray(body) ? body : []).map((i: any) => i.id),
      rounds: 3,
    });
  });

  test('Org-A-Antwort enthält nur Vorschreibungen der eigenen Liegenschaft (property_id-Check)', async () => {
    const res = await request(wegAppA).get('/api/weg/vorschreibungen').expect(200);
    const items: any[] = Array.isArray(res.body) ? res.body : [];
    for (const item of items) {
      const pid = item.property_id ?? item.propertyId;
      assert.notEqual(pid, propB, 'Org-A-Antwort enthält Org-B-Liegenschaft');
    }
  });
});
