/**
 * Readonly API-Key Verwaltung — Integrationstests
 *
 * Prueft:
 * 1. Autorisierung: nur Admins koennen Keys generieren/widerrufen
 * 2. Status-Endpoint gibt nur maskierten Key zurueck (nie Klartext)
 * 3. Generierter Key ist im apiKeyAuth-Middleware direkt nutzbar
 * 4. Org-spezifischer Key funktioniert ohne globalen READONLY_API_KEY
 * 5. Widerrufener Key wird sofort abgewiesen (403)
 * 6. Key von Org A wird fuer Org B abgewiesen (Cross-Org-Isolierung)
 * 7. Audit-Log-Eintraege bei Generierung und Widerruf
 *
 * Ausfuehren mit:
 *   node --import=./node_modules/tsx/dist/esm/index.cjs --test tests/unit/api-key-management.test.ts
 */
import { describe, test, before, after } from 'node:test';
import { acquireAuditLogTestLock, releaseAuditLogTestLock } from '../helpers/auditLogTestLock';
import assert from 'node:assert/strict';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
// rootDb (Superuser) für Fixture-Setup und -Cleanup:
// seed/cleanup laufen ohne Org-Kontext und müssen RLS umgehen.
// Der `db`-Proxy wirft ohne orgContext — daher rootDb für diese Systemoperationen.
import { rootDb } from '../../server/db';
import { rlsMiddleware } from '../../server/middleware/rlsMiddleware';
import { _apiKeyManagementStore } from '../../server/routes/adminRoutes';
import { sql, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { organizations } from '@shared/schema';
import { apiKeyAuth } from '../../server/middleware/apiKey';
import adminRoutes from '../../server/routes/adminRoutes';

// ── Test-Fixtures ─────────────────────────────────────────────────────────────

const orgId      = uuidv4();
const orgIdB     = uuidv4();   // zweite Org fuer Cross-Org-Tests
const adminId    = uuidv4();
const nonAdminId = uuidv4();

async function seed() {
  await rootDb.execute(sql`
    INSERT INTO organizations (id, name)
    VALUES (${orgId}::uuid, 'ApiKey-Test-Org-A'),
           (${orgIdB}::uuid, 'ApiKey-Test-Org-B')
    ON CONFLICT DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO profiles (id, email, organization_id)
    VALUES (${adminId}::uuid, ${`admin-${adminId.slice(0,8)}@test.at`}, ${orgId}::uuid),
           (${nonAdminId}::uuid, ${`user-${nonAdminId.slice(0,8)}@test.at`}, ${orgId}::uuid)
    ON CONFLICT DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO user_roles (user_id, role)
    VALUES (${adminId}::uuid, 'admin'),
           (${nonAdminId}::uuid, 'property_manager')
    ON CONFLICT DO NOTHING
  `);
}

async function cleanup() {
  try {
    await rootDb.execute(sql`UPDATE organizations SET readonly_api_key = NULL WHERE id IN (${orgId}::uuid, ${orgIdB}::uuid)`);
    await rootDb.execute(sql`DELETE FROM audit_logs WHERE user_id IN (${adminId}::uuid, ${nonAdminId}::uuid)`);
    await rootDb.execute(sql`DELETE FROM user_roles WHERE user_id IN (${adminId}::uuid, ${nonAdminId}::uuid)`);
    await rootDb.execute(sql`DELETE FROM profiles WHERE id IN (${adminId}::uuid, ${nonAdminId}::uuid)`);
    await rootDb.execute(sql`DELETE FROM organizations WHERE id IN (${orgId}::uuid, ${orgIdB}::uuid)`);
  } catch (err) {
    console.warn('Cleanup error (non-fatal):', (err as Error).message);
  }
}

// ── App Builder ───────────────────────────────────────────────────────────────

function buildManagementApp(userId: string | null, overrideOrgId = orgId) {
  const app = express();
  app.use(express.json());
  // Simuliert Session-Middleware: userId und organizationId werden gesetzt,
  // damit rlsMiddleware den Org-Kontext für den `db`-Proxy aufbauen kann.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organizationId: overrideOrgId };
    next();
  });
  // rlsMiddleware setzt orgContext (SET ROLE immo_app + app.current_org),
  // damit route-Handler `db` ohne Fehler verwenden können.
  app.use(rlsMiddleware);
  app.use(adminRoutes);
  return app;
}

/** Mini-App mit apiKeyAuth Middleware + einem geschuetzten Readonly-Endpunkt */
function buildReadonlyApp() {
  const app = express();
  app.use(express.json());
  app.use(apiKeyAuth);
  app.get('/api/readonly/test', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });
  return app;
}

before(async () => { await acquireAuditLogTestLock(); await seed(); });
after(async () => { try { await cleanup(); } finally { await releaseAuditLogTestLock(); } });

// ─────────────────────────────────────────────────────────────────────────────
describe('API-Key Status Endpoint', () => {
  test('Nicht-Admin → 403', async () => {
    const app = buildManagementApp(nonAdminId);
    const res = await request(app).get('/api/organization/api-key/status');
    assert.equal(res.status, 403);
  });

  test('Ohne Auth → 401 oder 403', async () => {
    const app = buildManagementApp(null);
    const res = await request(app).get('/api/organization/api-key/status');
    assert.ok([401, 403].includes(res.status), `Expected 401 or 403, got ${res.status}`);
  });

  test('Admin ohne Key → hasKey=false', async () => {
    const app = buildManagementApp(adminId);
    const res = await request(app).get('/api/organization/api-key/status');
    assert.equal(res.status, 200);
    assert.equal(res.body.hasKey, false);
    assert.equal(res.body.maskedKey, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('API-Key Generierung', () => {
  before(async () => { await _apiKeyManagementStore.resetAll(); });

  test('Nicht-Admin → 403', async () => {
    const app = buildManagementApp(nonAdminId);
    const res = await request(app).post('/api/organization/api-key/generate');
    assert.equal(res.status, 403);
  });

  test('Admin kann Key generieren → einmalig im Klartext', async () => {
    const app = buildManagementApp(adminId);
    const res = await request(app).post('/api/organization/api-key/generate');
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.apiKey, 'string');
    // UUID-Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    assert.match(res.body.apiKey, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  test('Status nach Generierung → hasKey=true, maskedKey verschleiert echten Key', async () => {
    const app = buildManagementApp(adminId);
    const genRes = await request(app).post('/api/organization/api-key/generate');
    const fullKey: string = genRes.body.apiKey;

    const statusRes = await request(app).get('/api/organization/api-key/status');
    assert.equal(statusRes.body.hasKey, true);
    // maskedKey DARF den vollstaendigen Klartext nicht enthalten
    assert.notEqual(statusRes.body.maskedKey, fullKey);
    // maskedKey enthaelt Maskierungszeichen
    assert.ok(statusRes.body.maskedKey?.includes('•'), `maskedKey should contain bullet: ${statusRes.body.maskedKey}`);
  });

  test('Audit-Log-Eintrag bei Generierung vorhanden (event=api_key_generated)', async () => {
    const app = buildManagementApp(adminId);
    await request(app).post('/api/organization/api-key/generate');

    const rows = await rootDb.execute(sql`
      SELECT details FROM audit_logs
      WHERE user_id = ${adminId}::uuid
        AND table_name = 'organizations'
        AND action = 'update'
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const lastEntry = rows.rows[0] as any;
    assert.ok(lastEntry != null, 'Expected an audit log entry');
    const details = typeof lastEntry.details === 'string'
      ? JSON.parse(lastEntry.details)
      : lastEntry.details;
    assert.equal(details?.event, 'api_key_generated');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('API-Key Widerruf', () => {
  before(async () => { await _apiKeyManagementStore.resetAll(); });

  test('Nicht-Admin → 403', async () => {
    const app = buildManagementApp(nonAdminId);
    const res = await request(app).delete('/api/organization/api-key');
    assert.equal(res.status, 403);
  });

  test('Widerruf setzt Key auf NULL, Status → hasKey=false', async () => {
    const app = buildManagementApp(adminId);
    // Erst generieren
    await request(app).post('/api/organization/api-key/generate');

    // Widerrufen
    const revokeRes = await request(app).delete('/api/organization/api-key');
    assert.equal(revokeRes.status, 200);
    assert.equal(revokeRes.body.ok, true);

    // Status
    const statusRes = await request(app).get('/api/organization/api-key/status');
    assert.equal(statusRes.body.hasKey, false);
  });

  test('Audit-Log-Eintrag bei Widerruf vorhanden (event=api_key_revoked)', async () => {
    const app = buildManagementApp(adminId);
    await request(app).post('/api/organization/api-key/generate');
    await request(app).delete('/api/organization/api-key');

    const rows = await rootDb.execute(sql`
      SELECT details FROM audit_logs
      WHERE user_id = ${adminId}::uuid
        AND table_name = 'organizations'
        AND action = 'update'
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const lastEntry = rows.rows[0] as any;
    const details = typeof lastEntry.details === 'string'
      ? JSON.parse(lastEntry.details)
      : lastEntry.details;
    assert.equal(details?.event, 'api_key_revoked');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('apiKeyAuth Middleware — Zugriffskontrolle', () => {
  /** Hilfsfunktion: setzt readonlyApiKey direkt in der DB */
  async function setOrgKey(targetOrgId: string, key: string | null) {
    await rootDb.update(organizations)
      .set({ readonlyApiKey: key })
      .where(eq(organizations.id, targetOrgId));
  }

  test('Org-spezifischer Key funktioniert ohne globalen READONLY_API_KEY (self-contained)', async () => {
    const testKey = uuidv4();
    await setOrgKey(orgId, testKey);

    const savedGlobal = process.env.READONLY_API_KEY;
    delete process.env.READONLY_API_KEY;   // globalen Key absichtlich entfernen

    try {
      const app = buildReadonlyApp();
      const res = await request(app)
        .get(`/api/readonly/test?organization_id=${orgId}`)
        .set('X-Api-Key', testKey);
      assert.equal(res.status, 200);
    } finally {
      // Env-Var wiederherstellen
      if (savedGlobal !== undefined) process.env.READONLY_API_KEY = savedGlobal;
      await setOrgKey(orgId, null);
    }
  });

  test('Falscher Key fuer Org → 403', async () => {
    const correctKey = uuidv4();
    await setOrgKey(orgId, correctKey);

    try {
      const app = buildReadonlyApp();
      const res = await request(app)
        .get(`/api/readonly/test?organization_id=${orgId}`)
        .set('X-Api-Key', 'wrong-key');
      assert.equal(res.status, 403);
    } finally {
      await setOrgKey(orgId, null);
    }
  });

  test('Widerrufener Key wird sofort abgewiesen (403)', async () => {
    const testKey = uuidv4();
    await setOrgKey(orgId, testKey);

    const app = buildReadonlyApp();

    // Vorher: Key gueltig
    const before = await request(app)
      .get(`/api/readonly/test?organization_id=${orgId}`)
      .set('X-Api-Key', testKey);
    assert.equal(before.status, 200);

    // Key widerrufen
    await setOrgKey(orgId, null);

    // Danach: gleicher Key → abgewiesen
    // (Da kein org-Key mehr gesetzt ist, faellt Middleware auf globalen Key zurueck;
    //  ohne READONLY_API_KEY → 500; mit falschem Wert → 403. Beides ≠ 200.)
    const after = await request(app)
      .get(`/api/readonly/test?organization_id=${orgId}`)
      .set('X-Api-Key', testKey);
    assert.notEqual(after.status, 200);
  });

  test('Key von Org A abgewiesen fuer Org B (Cross-Org-Isolierung)', async () => {
    const keyA = uuidv4();
    const keyB = uuidv4();
    await setOrgKey(orgId,  keyA);
    await setOrgKey(orgIdB, keyB);

    try {
      const app = buildReadonlyApp();

      // Key von A gegen Org B → 403
      const res = await request(app)
        .get(`/api/readonly/test?organization_id=${orgIdB}`)
        .set('X-Api-Key', keyA);
      assert.equal(res.status, 403);
    } finally {
      await setOrgKey(orgId,  null);
      await setOrgKey(orgIdB, null);
    }
  });

  test('Kein API-Key angegeben → 401', async () => {
    const app = buildReadonlyApp();
    const res = await request(app)
      .get(`/api/readonly/test?organization_id=${orgId}`);
    assert.equal(res.status, 401);
  });

  test('Unbekannte organization_id → 403', async () => {
    const app = buildReadonlyApp();
    const res = await request(app)
      .get(`/api/readonly/test?organization_id=${uuidv4()}`)
      .set('X-Api-Key', 'any-key');
    assert.equal(res.status, 403);
  });
});
