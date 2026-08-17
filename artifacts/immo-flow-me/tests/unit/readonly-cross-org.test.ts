/**
 * Readonly API-Key Cross-Org-Zugriffsschutz — Unit-Tests OHNE echte DB
 *
 * Testet die apiKeyAuth-Middleware gegen alle definierten Angriffspfade:
 *   1. Gültiger org-spezifischer Key + fremde org_id → 403
 *   2. Globaler READONLY_API_KEY + Org ohne eigenen Key → 200 (Durchlass)
 *   3. Globaler READONLY_API_KEY + Org mit eigenem Key → 403 (Org-Key hat Vorrang)
 *   4. Fehlender API-Key → 401
 *   5. Unbekannte organization_id (Lookup gibt undefined zurück) → 403
 *   6. DB-Fehler beim Lookup → 500 (sicheres Ablehnen)
 *   7. Kein organization_id → globaler Key erforderlich
 *   8. requireOrgId-Doppelprüfung: authorizedOrgId ≠ angefragte org → 403
 *
 * KEINE echte DB-Verbindung: OrgLookupFn wird per Dependency Injection gemockt.
 *
 * Zusätzlich: DB-Ebene Org-Isolationstests MIT echter DB-Verbindung (am Ende der Datei).
 */
import { describe, test, before as beforeAll, after as afterAll, beforeEach, afterEach } from 'node:test';
import { expect } from '../helpers/expect';

import express, { Request, Response } from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createApiKeyAuth, type OrgKeyRecord } from '../../server/middleware/apiKey';
// rootDb (Superuser) für Fixture-Setup und -Cleanup:
// Diese Hooks laufen ohne Org-Kontext. Der `db`-Proxy wirft ohne orgContext.
import { rootDb } from '../../server/db';
import { sql } from 'drizzle-orm';
import readonlyRouter from '../../server/routes/readonly';

// ── Org-Fixtures (kein DB-Zugriff) ───────────────────────────────────────────

const ORG_A_ID  = 'aaaaaaaa-0000-0000-0000-000000000001';
const ORG_B_ID  = 'bbbbbbbb-0000-0000-0000-000000000002';
const ORG_C_ID  = 'cccccccc-0000-0000-0000-000000000003'; // Org ohne eigenen Key

const ORG_A_KEY = 'key-for-org-a-only-1234567890abcdef';
const ORG_B_KEY = 'key-for-org-b-only-fedcba0987654321';
const GLOBAL_KEY = 'global-readonly-key-xyz';

const ORGS: Record<string, OrgKeyRecord> = {
  [ORG_A_ID]: { id: ORG_A_ID, readonlyApiKey: ORG_A_KEY },
  [ORG_B_ID]: { id: ORG_B_ID, readonlyApiKey: ORG_B_KEY },
  [ORG_C_ID]: { id: ORG_C_ID, readonlyApiKey: null },  // globaler Fallback
};

/** Mock-Lookup: gibt den Org-Record zurück oder undefined. Wirft nie. */
async function mockLookup(orgId: string): Promise<OrgKeyRecord | undefined> {
  return ORGS[orgId];
}

/** Lookup der immer einen DB-Fehler wirft */
async function failingLookup(_orgId: string): Promise<OrgKeyRecord | undefined> {
  throw new Error('DB connection refused');
}

// ── App Builder ───────────────────────────────────────────────────────────────

function buildApp(
  lookup: typeof mockLookup = mockLookup,
  globalKey?: string,
) {
  const app = express();
  app.use(express.json());

  const middleware = createApiKeyAuth(lookup);
  app.use(middleware);

  // Geschützter Endpunkt: gibt authorizedOrgId zurück
  app.get('/api/readonly/test', (req: Request, res: Response) => {
    res.json({ ok: true, authorizedOrgId: (req as any).authorizedOrgId });
  });

  // READONLY_API_KEY wird per Test-Setup gesetzt — globalKey-Parameter als Hilfe
  if (globalKey !== undefined) {
    process.env.READONLY_API_KEY = globalKey;
  }

  return app;
}

// ── Env-Var Verwaltung ────────────────────────────────────────────────────────

let savedGlobalKey: string | undefined;

beforeEach(() => {
  savedGlobalKey = process.env.READONLY_API_KEY;
  // Default: kein globaler Key gesetzt (Org-Keys sind autark)
  delete process.env.READONLY_API_KEY;
});

afterEach(() => {
  if (savedGlobalKey !== undefined) {
    process.env.READONLY_API_KEY = savedGlobalKey;
  } else {
    delete process.env.READONLY_API_KEY;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
describe('apiKeyAuth — Fehlender Key', () => {
  test('Kein API-Key in Header oder Query → 401', async () => {
    const app = buildApp();
    const res = await request(app).get(`/api/readonly/test?organization_id=${ORG_A_ID}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/required/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('apiKeyAuth — Org-spezifischer Key', () => {
  test('Eigener Key + eigene org_id → 200, authorizedOrgId gesetzt', async () => {
    const app = buildApp();
    const res = await request(app)
      .get(`/api/readonly/test?organization_id=${ORG_A_ID}`)
      .set('X-Api-Key', ORG_A_KEY);
    expect(res.status).toBe(200);
    expect(res.body.authorizedOrgId).toBe(ORG_A_ID);
  });

  test('Key von Org A + org_id von Org B → 403 (Cross-Org-Angriff abgewehrt)', async () => {
    const app = buildApp();
    const res = await request(app)
      .get(`/api/readonly/test?organization_id=${ORG_B_ID}`)
      .set('X-Api-Key', ORG_A_KEY);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/ungültig|invalid/i);
  });

  test('Org-Key funktioniert OHNE globalen READONLY_API_KEY (self-contained)', async () => {
    // READONLY_API_KEY ist absichtlich nicht gesetzt (beforeEach löscht ihn)
    expect(process.env.READONLY_API_KEY).toBeUndefined();
    const app = buildApp();
    const res = await request(app)
      .get(`/api/readonly/test?organization_id=${ORG_A_ID}`)
      .set('X-Api-Key', ORG_A_KEY);
    expect(res.status).toBe(200);
  });

  test('Globaler Key gegen Org mit eigenem Key → 403 (Org-Key hat Vorrang)', async () => {
    process.env.READONLY_API_KEY = GLOBAL_KEY;
    const app = buildApp();
    const res = await request(app)
      .get(`/api/readonly/test?organization_id=${ORG_A_ID}`)
      .set('X-Api-Key', GLOBAL_KEY);    // globaler Key, aber Org hat eigenen
    expect(res.status).toBe(403);
  });

  test('Falscher Org-Key → 403', async () => {
    const app = buildApp();
    const res = await request(app)
      .get(`/api/readonly/test?organization_id=${ORG_A_ID}`)
      .set('X-Api-Key', 'totally-wrong-key');
    expect(res.status).toBe(403);
  });

  test('api_key als Query-Param statt Header → wird akzeptiert', async () => {
    const app = buildApp();
    const res = await request(app)
      .get(`/api/readonly/test?organization_id=${ORG_A_ID}&api_key=${ORG_A_KEY}`);
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('apiKeyAuth — Globaler Fallback (Org ohne eigenen Key)', () => {
  test('Globaler Key + Org ohne eigenen Key → 200', async () => {
    process.env.READONLY_API_KEY = GLOBAL_KEY;
    const app = buildApp();
    const res = await request(app)
      .get(`/api/readonly/test?organization_id=${ORG_C_ID}`)
      .set('X-Api-Key', GLOBAL_KEY);
    expect(res.status).toBe(200);
    expect(res.body.authorizedOrgId).toBe(ORG_C_ID);
  });

  test('Falscher Key + Org ohne eigenen Key → 403', async () => {
    process.env.READONLY_API_KEY = GLOBAL_KEY;
    const app = buildApp();
    const res = await request(app)
      .get(`/api/readonly/test?organization_id=${ORG_C_ID}`)
      .set('X-Api-Key', 'wrong-key');
    expect(res.status).toBe(403);
  });

  test('Org ohne eigenen Key + kein READONLY_API_KEY konfiguriert → 500', async () => {
    // READONLY_API_KEY nicht gesetzt, Org hat auch keinen eigenen Key
    expect(process.env.READONLY_API_KEY).toBeUndefined();
    const app = buildApp();
    const res = await request(app)
      .get(`/api/readonly/test?organization_id=${ORG_C_ID}`)
      .set('X-Api-Key', 'any-key');
    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('apiKeyAuth — Unbekannte Organization', () => {
  test('Unbekannte organization_id → 403 (kein Seitenkanalinformation)', async () => {
    const unknownOrgId = 'ffffffff-9999-9999-9999-999999999999';
    const app = buildApp();
    const res = await request(app)
      .get(`/api/readonly/test?organization_id=${unknownOrgId}`)
      .set('X-Api-Key', ORG_A_KEY);
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('apiKeyAuth — DB-Fehler', () => {
  test('Lookup wirft Fehler → 500 (sicheres Ablehnen, kein Klartext-Leak)', async () => {
    const app = buildApp(failingLookup);
    const res = await request(app)
      .get(`/api/readonly/test?organization_id=${ORG_A_ID}`)
      .set('X-Api-Key', ORG_A_KEY);
    expect(res.status).toBe(500);
    // Kein DB-Fehler-Details im Response-Body
    expect(JSON.stringify(res.body)).not.toContain('refused');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('apiKeyAuth — Kein organization_id', () => {
  // Die Middleware gibt 400 zurueck sobald organization_id fehlt —
  // BEVOR der API-Key geprueft wird. Das verhindert DoS-Angriffe via IP-Flooding
  // (kein Zaehler-Eintrag fuer Requests ohne Org). Alle drei Faelle enden daher mit 400.

  test('Globaler Key ohne org_id → 400 (Middleware blockiert vor Key-Check)', async () => {
    process.env.READONLY_API_KEY = GLOBAL_KEY;
    const app = buildApp();
    const res = await request(app)
      .get('/api/readonly/test')  // kein organization_id
      .set('X-Api-Key', GLOBAL_KEY);
    expect(res.status).toBe(400);
  });

  test('Falscher globaler Key ohne org_id → 400 (Middleware blockiert vor Key-Check)', async () => {
    process.env.READONLY_API_KEY = GLOBAL_KEY;
    const app = buildApp();
    const res = await request(app)
      .get('/api/readonly/test')
      .set('X-Api-Key', 'wrong-global-key');
    expect(res.status).toBe(400);
  });

  test('Kein READONLY_API_KEY + kein org_id → 400 (Middleware blockiert vor Key-Check)', async () => {
    expect(process.env.READONLY_API_KEY).toBeUndefined();
    const app = buildApp();
    const res = await request(app)
      .get('/api/readonly/test')
      .set('X-Api-Key', 'any-key');
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('requireOrgId — Doppelprüfung authorizedOrgId', () => {
  /**
   * Simuliert den Angriff: Middleware autorisiert Org A, aber der Endpunkt
   * liest organization_id aus Query und findet eine andere Org.
   * requireOrgId() in readonly.ts prüft ob authorizedOrgId === angefragte orgId.
   */
  test('authorizedOrgId !== angefragte org_id → 403 in requireOrgId', async () => {
    const app = express();
    app.use(express.json());

    // Middleware autorisiert Org A
    const middleware = createApiKeyAuth(mockLookup);
    app.use(middleware);

    // Endpunkt ahmt requireOrgId nach (wie in readonly.ts)
    app.get('/api/readonly/test', (req: Request, res: Response) => {
      const queriedOrgId = req.query.organization_id as string;
      const authorizedOrgId = (req as any).authorizedOrgId as string | undefined;

      if (authorizedOrgId && authorizedOrgId !== queriedOrgId) {
        res.status(403).json({ error: 'Zugriff verweigert: organization_id stimmt nicht überein' });
        return;
      }
      res.json({ ok: true });
    });

    // Angreifer: autorisiert mit Org-A-Key gegen Org A, aber Endpunkt fragt Org B-Daten an
    const res = await request(app)
      .get(`/api/readonly/test?organization_id=${ORG_B_ID}`)
      .set('X-Api-Key', ORG_A_KEY);

    // apiKeyAuth gibt 403 weil Key für Org A gegen Org B → 403 schon in Middleware
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// DB-Ebene: Readonly-Endpunkte Org-Isolationstests MIT echter DB-Verbindung
// =============================================================================
//
// Diese Tests prüfen den vollständigen Stack (Middleware + SQL-Queries):
//   - OrgB-Key + OrgB-org_id → nur OrgB-Daten (nicht OrgA)
//   - OrgA-Key + OrgA-org_id → nur OrgA-Daten (nicht OrgB)
//   - Cross-Org-Angriff (OrgA-Key + OrgB-org_id) → 403, kein Datenleck
//   - Manipulierte org_id nach Middleware-Durchlass → 400 (requireOrgId blockiert)
//
// Voraussetzung: DATABASE_URL muss auf eine erreichbare Postgres-DB zeigen.
// =============================================================================

// UUIDs für die zwei Testorgs
const DB_ORG_A_ID = uuidv4();
const DB_ORG_B_ID = uuidv4();

// Eindeutige API-Keys (lang genug um Kollisionen zu vermeiden)
const DB_ORG_A_KEY = `readonly-db-test-org-a-${uuidv4()}`;
const DB_ORG_B_KEY = `readonly-db-test-org-b-${uuidv4()}`;

// Property/Unit/Tenant IDs für OrgA und OrgB
const DB_PROP_A_ID = uuidv4();
const DB_PROP_B_ID = uuidv4();
const DB_UNIT_A_ID = uuidv4();
const DB_UNIT_B_ID = uuidv4();
const DB_TENANT_A_ID = uuidv4();
const DB_TENANT_B_ID = uuidv4();

// Invoice/Payment/Expense/BankAccount IDs für OrgA und OrgB
const DB_INVOICE_A_ID = uuidv4();
const DB_INVOICE_B_ID = uuidv4();
const DB_PAYMENT_A_ID = uuidv4();
const DB_PAYMENT_B_ID = uuidv4();
const DB_EXPENSE_A_ID = uuidv4();
const DB_EXPENSE_B_ID = uuidv4();
const DB_BANKACCOUNT_A_ID = uuidv4();
const DB_BANKACCOUNT_B_ID = uuidv4();

/** Express-App die den echten readonlyRouter einhängt */
function buildRealApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/readonly', readonlyRouter);
  return app;
}

describe('DB-Ebene: Readonly-Endpunkte Org-Isolation (echte DB)', () => {
  beforeAll(async () => {
    // Zwei Orgs anlegen — jede mit eigenem readonlyApiKey
    await rootDb.execute(sql`
      INSERT INTO organizations (id, name, readonly_api_key, created_at)
      VALUES
        (${DB_ORG_A_ID}::uuid, 'DB-Test Org A', ${DB_ORG_A_KEY}, NOW()),
        (${DB_ORG_B_ID}::uuid, 'DB-Test Org B', ${DB_ORG_B_KEY}, NOW())
      ON CONFLICT (id) DO NOTHING
    `);

    // Properties
    await rootDb.execute(sql`
      INSERT INTO properties (id, organization_id, name, address, city, postal_code, created_at)
      VALUES
        (${DB_PROP_A_ID}::uuid, ${DB_ORG_A_ID}::uuid, 'Liegenschaft OrgA', 'Orgastraße 1', 'Wien', '1010', NOW()),
        (${DB_PROP_B_ID}::uuid, ${DB_ORG_B_ID}::uuid, 'Liegenschaft OrgB', 'Orgbgasse 2', 'Graz', '8010', NOW())
      ON CONFLICT (id) DO NOTHING
    `);

    // Units
    await rootDb.execute(sql`
      INSERT INTO units (id, property_id, top_nummer, type, status, stockwerk, zimmer, flaeche, created_at)
      VALUES
        (${DB_UNIT_A_ID}::uuid, ${DB_PROP_A_ID}::uuid, 'Top A1', 'wohnung', 'aktiv', 1, 2, 55.0, NOW()),
        (${DB_UNIT_B_ID}::uuid, ${DB_PROP_B_ID}::uuid, 'Top B1', 'wohnung', 'aktiv', 1, 3, 70.0, NOW())
      ON CONFLICT (id) DO NOTHING
    `);

    // Tenants
    await rootDb.execute(sql`
      INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, grundmiete, betriebskosten_vorschuss, heizungskosten_vorschuss, mietbeginn, created_at)
      VALUES
        (${DB_TENANT_A_ID}::uuid, ${DB_UNIT_A_ID}::uuid, 'Anna', 'OrgA', 'anna@db-test-orga.test', 'aktiv', 600.00, 120.00, 60.00, '2025-01-01', NOW()),
        (${DB_TENANT_B_ID}::uuid, ${DB_UNIT_B_ID}::uuid, 'Bernd', 'OrgB', 'bernd@db-test-orgb.test', 'aktiv', 700.00, 140.00, 70.00, '2025-01-01', NOW())
      ON CONFLICT (id) DO NOTHING
    `);

    // Invoices (monthly_invoices)
    await rootDb.execute(sql`
      INSERT INTO monthly_invoices (id, unit_id, tenant_id, year, month, gesamtbetrag, created_at)
      VALUES
        (${DB_INVOICE_A_ID}::uuid, ${DB_UNIT_A_ID}::uuid, ${DB_TENANT_A_ID}::uuid, 2025, 1, 780.00, NOW()),
        (${DB_INVOICE_B_ID}::uuid, ${DB_UNIT_B_ID}::uuid, ${DB_TENANT_B_ID}::uuid, 2025, 1, 910.00, NOW())
      ON CONFLICT (id) DO NOTHING
    `);

    // Payments
    await rootDb.execute(sql`
      INSERT INTO payments (id, tenant_id, betrag, buchungs_datum, created_at)
      VALUES
        (${DB_PAYMENT_A_ID}::uuid, ${DB_TENANT_A_ID}::uuid, 780.00, '2025-01-15', NOW()),
        (${DB_PAYMENT_B_ID}::uuid, ${DB_TENANT_B_ID}::uuid, 910.00, '2025-01-15', NOW())
      ON CONFLICT (id) DO NOTHING
    `);

    // Expenses
    await rootDb.execute(sql`
      INSERT INTO expenses (id, property_id, category, bezeichnung, datum, year, month, created_at)
      VALUES
        (${DB_EXPENSE_A_ID}::uuid, ${DB_PROP_A_ID}::uuid, 'betriebskosten_umlagefaehig', 'Reinigung OrgA', '2025-01-31', 2025, 1, NOW()),
        (${DB_EXPENSE_B_ID}::uuid, ${DB_PROP_B_ID}::uuid, 'betriebskosten_umlagefaehig', 'Reinigung OrgB', '2025-01-31', 2025, 1, NOW())
      ON CONFLICT (id) DO NOTHING
    `);

    // Bank accounts (organization_id muss gesetzt sein, damit die RLS-Policy
    // "organization_id = NULLIF(app.current_org,…)::uuid" greift)
    await rootDb.execute(sql`
      INSERT INTO bank_accounts (id, organization_id, property_id, account_name, created_at)
      VALUES
        (${DB_BANKACCOUNT_A_ID}::uuid, ${DB_ORG_A_ID}::uuid, ${DB_PROP_A_ID}::uuid, 'Konto OrgA', NOW()),
        (${DB_BANKACCOUNT_B_ID}::uuid, ${DB_ORG_B_ID}::uuid, ${DB_PROP_B_ID}::uuid, 'Konto OrgB', NOW())
      ON CONFLICT (id) DO NOTHING
    `);
  });

  afterAll(async () => {
    await rootDb.execute(sql`DELETE FROM payments WHERE id IN (${DB_PAYMENT_A_ID}::uuid, ${DB_PAYMENT_B_ID}::uuid)`);
    await rootDb.execute(sql`DELETE FROM monthly_invoices WHERE id IN (${DB_INVOICE_A_ID}::uuid, ${DB_INVOICE_B_ID}::uuid)`);
    await rootDb.execute(sql`DELETE FROM expenses WHERE id IN (${DB_EXPENSE_A_ID}::uuid, ${DB_EXPENSE_B_ID}::uuid)`);
    await rootDb.execute(sql`DELETE FROM bank_accounts WHERE id IN (${DB_BANKACCOUNT_A_ID}::uuid, ${DB_BANKACCOUNT_B_ID}::uuid)`);
    await rootDb.execute(sql`DELETE FROM tenants WHERE id IN (${DB_TENANT_A_ID}::uuid, ${DB_TENANT_B_ID}::uuid)`);
    await rootDb.execute(sql`DELETE FROM units WHERE id IN (${DB_UNIT_A_ID}::uuid, ${DB_UNIT_B_ID}::uuid)`);
    await rootDb.execute(sql`DELETE FROM properties WHERE id IN (${DB_PROP_A_ID}::uuid, ${DB_PROP_B_ID}::uuid)`);
    await rootDb.execute(sql`DELETE FROM organizations WHERE id IN (${DB_ORG_A_ID}::uuid, ${DB_ORG_B_ID}::uuid)`);
  });

  // ── Properties ──────────────────────────────────────────────────────────────

  test('GET /properties: OrgB-Key + OrgB-org_id → gibt nur OrgB-Properties zurück', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/properties?organization_id=${DB_ORG_B_ID}`)
      .set('X-Api-Key', DB_ORG_B_KEY);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((p: any) => p.id);
    expect(ids).toContain(DB_PROP_B_ID);
    expect(ids).not.toContain(DB_PROP_A_ID);
  });

  test('GET /properties: OrgA-Key + OrgA-org_id → gibt nur OrgA-Properties zurück', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/properties?organization_id=${DB_ORG_A_ID}`)
      .set('X-Api-Key', DB_ORG_A_KEY);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((p: any) => p.id);
    expect(ids).toContain(DB_PROP_A_ID);
    expect(ids).not.toContain(DB_PROP_B_ID);
  });

  test('GET /properties: OrgA-Key + OrgB-org_id → 403 (Cross-Org-Angriff blockiert)', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/properties?organization_id=${DB_ORG_B_ID}`)
      .set('X-Api-Key', DB_ORG_A_KEY);

    expect(res.status).toBe(403);
    // Kein Datenleck: keine Property-Daten im Body
    expect(res.body.data).toBeUndefined();
  });

  test('GET /properties: fehlende organization_id → 400 (Middleware blockiert vor Key-Check)', async () => {
    // Middleware gibt 400 zurueck sobald organization_id fehlt — unabhaengig vom Key
    const app = buildRealApp();
    const res = await request(app)
      .get('/api/readonly/properties')
      .set('X-Api-Key', DB_ORG_A_KEY);

    expect(res.status).toBe(400);
    expect(res.body.data).toBeUndefined();
  });

  // ── Units ────────────────────────────────────────────────────────────────────

  test('GET /units: OrgB-Key + OrgB-org_id → gibt nur OrgB-Units zurück', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/units?organization_id=${DB_ORG_B_ID}`)
      .set('X-Api-Key', DB_ORG_B_KEY);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((u: any) => u.id);
    expect(ids).toContain(DB_UNIT_B_ID);
    expect(ids).not.toContain(DB_UNIT_A_ID);
  });

  test('GET /units: OrgA-Key + OrgB-org_id → 403', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/units?organization_id=${DB_ORG_B_ID}`)
      .set('X-Api-Key', DB_ORG_A_KEY);

    expect(res.status).toBe(403);
  });

  test('GET /units: OrgA-Key + OrgA-org_id + OrgB-property_id → leere Liste (kein Cross-Org-Datenleck via property_id-Filter)', async () => {
    // Angriffspfad: gültiger OrgA-Key mit OrgA-org_id, aber property_id einer fremden Org.
    // Die Route darf keine OrgB-Units zurückliefern.
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/units?organization_id=${DB_ORG_A_ID}&property_id=${DB_PROP_B_ID}`)
      .set('X-Api-Key', DB_ORG_A_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    // Sicherstellen dass keine OrgB-Unit durchsickert
    const ids = (res.body.data as any[]).map((u: any) => u.id);
    expect(ids).not.toContain(DB_UNIT_B_ID);
  });

  // ── Tenants ──────────────────────────────────────────────────────────────────

  test('GET /tenants: OrgB-Key + OrgB-org_id → gibt nur OrgB-Mieter zurück', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/tenants?organization_id=${DB_ORG_B_ID}`)
      .set('X-Api-Key', DB_ORG_B_KEY);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((t: any) => t.id);
    expect(ids).toContain(DB_TENANT_B_ID);
    expect(ids).not.toContain(DB_TENANT_A_ID);
  });

  test('GET /tenants: OrgA-Key + OrgA-org_id → gibt nur OrgA-Mieter zurück', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/tenants?organization_id=${DB_ORG_A_ID}`)
      .set('X-Api-Key', DB_ORG_A_KEY);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((t: any) => t.id);
    expect(ids).toContain(DB_TENANT_A_ID);
    expect(ids).not.toContain(DB_TENANT_B_ID);
  });

  test('GET /tenants: OrgA-Key + OrgB-org_id → 403', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/tenants?organization_id=${DB_ORG_B_ID}`)
      .set('X-Api-Key', DB_ORG_A_KEY);

    expect(res.status).toBe(403);
    expect(res.body.data).toBeUndefined();
  });

  // ── Einzelressource-Zugriff ──────────────────────────────────────────────────

  test('GET /properties/:id: OrgB-Key kann OrgA-Property-ID nicht lesen → 404', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/properties/${DB_PROP_A_ID}?organization_id=${DB_ORG_B_ID}`)
      .set('X-Api-Key', DB_ORG_B_KEY);

    // OrgB-Key ist für OrgB → 200 möglich, aber OrgA-Property gehört nicht zu OrgB → 404
    expect(res.status).toBe(404);
  });

  test('GET /properties/:id: OrgA-Key + eigene org_id + eigene property_id → 200', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/properties/${DB_PROP_A_ID}?organization_id=${DB_ORG_A_ID}`)
      .set('X-Api-Key', DB_ORG_A_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(DB_PROP_A_ID);
  });

  test('GET /units/:id: OrgB-Key kann OrgA-Unit-ID nicht lesen → 404', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/units/${DB_UNIT_A_ID}?organization_id=${DB_ORG_B_ID}`)
      .set('X-Api-Key', DB_ORG_B_KEY);

    expect(res.status).toBe(404);
  });

  // ── Invoices ─────────────────────────────────────────────────────────────────

  test('GET /invoices: OrgB-Key + OrgB-org_id → gibt nur OrgB-Rechnungen zurück', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/invoices?organization_id=${DB_ORG_B_ID}`)
      .set('X-Api-Key', DB_ORG_B_KEY);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((i: any) => i.id);
    expect(ids).toContain(DB_INVOICE_B_ID);
    expect(ids).not.toContain(DB_INVOICE_A_ID);
  });

  test('GET /invoices: OrgA-Key + OrgA-org_id → gibt nur OrgA-Rechnungen zurück', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/invoices?organization_id=${DB_ORG_A_ID}`)
      .set('X-Api-Key', DB_ORG_A_KEY);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((i: any) => i.id);
    expect(ids).toContain(DB_INVOICE_A_ID);
    expect(ids).not.toContain(DB_INVOICE_B_ID);
  });

  test('GET /invoices: OrgA-Key + OrgB-org_id → 403 (Cross-Org-Angriff blockiert)', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/invoices?organization_id=${DB_ORG_B_ID}`)
      .set('X-Api-Key', DB_ORG_A_KEY);

    expect(res.status).toBe(403);
    expect(res.body.data).toBeUndefined();
  });

  test('GET /invoices: OrgA-Key + fremde tenant_id (OrgB) → leere Liste (Whitelist-Guard)', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/invoices?organization_id=${DB_ORG_A_ID}&tenant_id=${DB_TENANT_B_ID}`)
      .set('X-Api-Key', DB_ORG_A_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });

  test('GET /invoices: OrgA-Key + eigene tenant_id → liefert die Rechnung', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/invoices?organization_id=${DB_ORG_A_ID}&tenant_id=${DB_TENANT_A_ID}`)
      .set('X-Api-Key', DB_ORG_A_KEY);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((i: any) => i.id);
    expect(ids).toContain(DB_INVOICE_A_ID);
    expect(ids).not.toContain(DB_INVOICE_B_ID);
  });

  test('GET /invoices/:id: OrgB-Key kann OrgA-Rechnung nicht lesen → 404', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/invoices/${DB_INVOICE_A_ID}?organization_id=${DB_ORG_B_ID}`)
      .set('X-Api-Key', DB_ORG_B_KEY);

    expect(res.status).toBe(404);
  });

  test('GET /invoices/:id: OrgA-Key + eigene Invoice-ID → 200', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/invoices/${DB_INVOICE_A_ID}?organization_id=${DB_ORG_A_ID}`)
      .set('X-Api-Key', DB_ORG_A_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(DB_INVOICE_A_ID);
  });

  // ── Payments ─────────────────────────────────────────────────────────────────

  test('GET /payments: OrgB-Key + OrgB-org_id → gibt nur OrgB-Zahlungen zurück', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/payments?organization_id=${DB_ORG_B_ID}`)
      .set('X-Api-Key', DB_ORG_B_KEY);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((p: any) => p.id);
    expect(ids).toContain(DB_PAYMENT_B_ID);
    expect(ids).not.toContain(DB_PAYMENT_A_ID);
  });

  test('GET /payments: OrgA-Key + OrgA-org_id → gibt nur OrgA-Zahlungen zurück', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/payments?organization_id=${DB_ORG_A_ID}`)
      .set('X-Api-Key', DB_ORG_A_KEY);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((p: any) => p.id);
    expect(ids).toContain(DB_PAYMENT_A_ID);
    expect(ids).not.toContain(DB_PAYMENT_B_ID);
  });

  test('GET /payments: OrgA-Key + OrgB-org_id → 403 (Cross-Org-Angriff blockiert)', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/payments?organization_id=${DB_ORG_B_ID}`)
      .set('X-Api-Key', DB_ORG_A_KEY);

    expect(res.status).toBe(403);
    expect(res.body.data).toBeUndefined();
  });

  test('GET /payments: OrgA-Key + OrgA-org_id + OrgB-tenant_id → leere Liste (kein Cross-Org-Datenleck via tenant_id-Filter)', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/payments?organization_id=${DB_ORG_A_ID}&tenant_id=${DB_TENANT_B_ID}`)
      .set('X-Api-Key', DB_ORG_A_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    const ids = (res.body.data as any[]).map((p: any) => p.id);
    expect(ids).not.toContain(DB_PAYMENT_B_ID);
  });

  // ── Expenses ─────────────────────────────────────────────────────────────────

  test('GET /expenses: OrgB-Key + OrgB-org_id → gibt nur OrgB-Ausgaben zurück', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/expenses?organization_id=${DB_ORG_B_ID}`)
      .set('X-Api-Key', DB_ORG_B_KEY);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((e: any) => e.id);
    expect(ids).toContain(DB_EXPENSE_B_ID);
    expect(ids).not.toContain(DB_EXPENSE_A_ID);
  });

  test('GET /expenses: OrgA-Key + OrgA-org_id → gibt nur OrgA-Ausgaben zurück', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/expenses?organization_id=${DB_ORG_A_ID}`)
      .set('X-Api-Key', DB_ORG_A_KEY);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((e: any) => e.id);
    expect(ids).toContain(DB_EXPENSE_A_ID);
    expect(ids).not.toContain(DB_EXPENSE_B_ID);
  });

  test('GET /expenses: OrgA-Key + OrgB-org_id → 403', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/expenses?organization_id=${DB_ORG_B_ID}`)
      .set('X-Api-Key', DB_ORG_A_KEY);

    expect(res.status).toBe(403);
    expect(res.body.data).toBeUndefined();
  });

  test('GET /expenses: OrgA-Key + OrgA-org_id + OrgB-property_id → leere Liste', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/expenses?organization_id=${DB_ORG_A_ID}&property_id=${DB_PROP_B_ID}`)
      .set('X-Api-Key', DB_ORG_A_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    const ids = (res.body.data as any[]).map((e: any) => e.id);
    expect(ids).not.toContain(DB_EXPENSE_B_ID);
  });

  // ── Bank Accounts ────────────────────────────────────────────────────────────

  test('GET /bank-accounts: OrgB-Key + OrgB-org_id → gibt nur OrgB-Bankkonten zurück', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/bank-accounts?organization_id=${DB_ORG_B_ID}`)
      .set('X-Api-Key', DB_ORG_B_KEY);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((b: any) => b.id);
    expect(ids).toContain(DB_BANKACCOUNT_B_ID);
    expect(ids).not.toContain(DB_BANKACCOUNT_A_ID);
  });

  test('GET /bank-accounts: OrgA-Key + OrgA-org_id → gibt nur OrgA-Bankkonten zurück', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/bank-accounts?organization_id=${DB_ORG_A_ID}`)
      .set('X-Api-Key', DB_ORG_A_KEY);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((b: any) => b.id);
    expect(ids).toContain(DB_BANKACCOUNT_A_ID);
    expect(ids).not.toContain(DB_BANKACCOUNT_B_ID);
  });

  test('GET /bank-accounts: OrgA-Key + OrgB-org_id → 403', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/bank-accounts?organization_id=${DB_ORG_B_ID}`)
      .set('X-Api-Key', DB_ORG_A_KEY);

    expect(res.status).toBe(403);
    expect(res.body.data).toBeUndefined();
  });

  test('GET /bank-accounts: OrgA-Key + OrgA-org_id + OrgB-property_id → leere Liste', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get(`/api/readonly/bank-accounts?organization_id=${DB_ORG_A_ID}&property_id=${DB_PROP_B_ID}`)
      .set('X-Api-Key', DB_ORG_A_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    const ids = (res.body.data as any[]).map((b: any) => b.id);
    expect(ids).not.toContain(DB_BANKACCOUNT_B_ID);
  });
});
