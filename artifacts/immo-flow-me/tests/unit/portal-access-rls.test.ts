/**
 * portal-access-rls.test.ts — Task: tenant_portal_access / owner_portal_access
 * in die RLS-Abdeckung aufnehmen.
 *
 * Belegt:
 *   1. RLS ist auf beiden Portal-Zugangstabellen aktiv (FORCE).
 *   2. immo_app ohne jeden Kontext → 0 Zeilen (fail-closed).
 *   3. Admin-Kontext (nur app.current_org): sieht alle Zeilen der eigenen Org,
 *      keine fremden.
 *   4. Portal-Session (app.current_org + app.current_tenant/app.current_owner):
 *      sieht NUR die eigene Zeile — nicht die eines anderen Mieters/Eigentümers
 *      derselben Org und nicht die einer fremden Org.
 *   5. Portal-Session kann fremde Zeilen auch nicht verändern (UPDATE → 0 rows).
 *
 * Auth-Bootstrap (Login/Invite) läuft über rootDb (postgres, BYPASSRLS) und
 * bleibt unberührt — hier mitgeprüft über einen Superuser-Read.
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import express from "express";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";

const { Pool } = pg;

const _base = new Pool({ connectionString: process.env.DATABASE_URL });
const _baseConnect = _base.connect.bind(_base);
const appTestPool: typeof _base = Object.create(_base);
appTestPool.connect = async function () {
  const client = await _baseConnect();
  await client.query("SET ROLE immo_app");
  return client;
} as typeof _base.connect;

const superPool = new Pool({ connectionString: process.env.DATABASE_URL });

async function withSuperClient<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await superPool.connect();
  try { return await fn(c); } finally { c.release(); }
}

/** immo_app-Client mit optionalem Org-/Selbst-Kontext (transaktionslokal). */
async function withCtx<T>(
  settings: { org?: string; tenant?: string; owner?: string },
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const c = await appTestPool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_org', $1, true)", [settings.org ?? ""]);
    await c.query("SELECT set_config('app.current_tenant', $1, true)", [settings.tenant ?? ""]);
    await c.query("SELECT set_config('app.current_owner', $1, true)", [settings.owner ?? ""]);
    try { return await fn(c); } finally { await c.query("ROLLBACK"); }
  } finally {
    c.release();
  }
}

// ---------------------------------------------------------------------------
// Fixtures: 2 Orgs, je Property/Unit; Org A hat 2 Mieter + 2 Eigentümer,
// Org B je 1 — mit jeweils einem Portal-Zugang.
// ---------------------------------------------------------------------------

const ORG_A = randomUUID();
const ORG_B = randomUUID();
const PROP_A = randomUUID();
const PROP_B = randomUUID();
const UNIT_A = randomUUID();
const UNIT_B = randomUUID();
const TEN_A1 = randomUUID();
const TEN_A2 = randomUUID();
const TEN_B1 = randomUUID();
const OWN_A1 = randomUUID();
const OWN_A2 = randomUUID();
const OWN_B1 = randomUUID();
const TPA_A1 = randomUUID();
const TPA_A2 = randomUUID();
const TPA_B1 = randomUUID();
const OPA_A1 = randomUUID();
const OPA_A2 = randomUUID();
const OPA_B1 = randomUUID();

before(async () => {
  // Policies der aktuellen Codeversion anwenden (idempotent).
  const { setupRLS } = await import("../../server/lib/rlsPolicies.js");
  await setupRLS();

  await withSuperClient(async (c) => {
    await c.query(
      `INSERT INTO organizations (id, name, email)
       VALUES ($1,'Portal RLS Org A','a@portal-rls.test'), ($2,'Portal RLS Org B','b@portal-rls.test')`,
      [ORG_A, ORG_B],
    );
    await c.query(
      `INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
       VALUES ($1,$2,'P A','Addr','Wien','1010','mietverwaltung'),
              ($3,$4,'P B','Addr','Wien','1010','mietverwaltung')`,
      [PROP_A, ORG_A, PROP_B, ORG_B],
    );
    await c.query(
      `INSERT INTO units (id, property_id, top_nummer) VALUES ($1,$2,'Top 1'), ($3,$4,'Top 1')`,
      [UNIT_A, PROP_A, UNIT_B, PROP_B],
    );
    await c.query(
      `INSERT INTO tenants (id, unit_id, first_name, last_name)
       VALUES ($1,$2,'Anna','A1'), ($3,$2,'Adam','A2'), ($4,$5,'Bert','B1')`,
      [TEN_A1, UNIT_A, TEN_A2, TEN_B1, UNIT_B],
    );
    await c.query(
      `INSERT INTO owners (id, organization_id, first_name, last_name)
       VALUES ($1,$2,'Olga','A1'), ($3,$2,'Otto','A2'), ($4,$5,'Oskar','B1')`,
      [OWN_A1, ORG_A, OWN_A2, OWN_B1, ORG_B],
    );
    await c.query(
      `INSERT INTO tenant_portal_access (id, tenant_id, organization_id, email)
       VALUES ($1,$2,$3,'a1@portal-rls.test'),
              ($4,$5,$3,'a2@portal-rls.test'),
              ($6,$7,$8,'b1@portal-rls.test')`,
      [TPA_A1, TEN_A1, ORG_A, TPA_A2, TEN_A2, TPA_B1, TEN_B1, ORG_B],
    );
    await c.query(
      `INSERT INTO owner_portal_access (id, owner_id, organization_id, email)
       VALUES ($1,$2,$3,'oa1@portal-rls.test'),
              ($4,$5,$3,'oa2@portal-rls.test'),
              ($6,$7,$8,'ob1@portal-rls.test')`,
      [OPA_A1, OWN_A1, ORG_A, OPA_A2, OWN_A2, OPA_B1, OWN_B1, ORG_B],
    );
  });
});

after(async () => {
  await withSuperClient(async (c) => {
    await c.query(`DELETE FROM tenant_portal_access WHERE id = ANY($1)`, [[TPA_A1, TPA_A2, TPA_B1]]);
    await c.query(`DELETE FROM owner_portal_access WHERE id = ANY($1)`, [[OPA_A1, OPA_A2, OPA_B1]]);
    await c.query(`DELETE FROM tenants WHERE id = ANY($1)`, [[TEN_A1, TEN_A2, TEN_B1]]);
    await c.query(`DELETE FROM owners WHERE id = ANY($1)`, [[OWN_A1, OWN_A2, OWN_B1]]);
    await c.query(`DELETE FROM units WHERE id = ANY($1)`, [[UNIT_A, UNIT_B]]);
    await c.query(`DELETE FROM properties WHERE id = ANY($1)`, [[PROP_A, PROP_B]]);
    await c.query(`DELETE FROM organizations WHERE id = ANY($1)`, [[ORG_A, ORG_B]]);
  });
  await appTestPool.end();
  await superPool.end();
  const dbModule = await import("../../server/db.js");
  await Promise.all([
    dbModule.appPool.end().catch(() => {}),
    dbModule.pool.end().catch(() => {}),
  ]);
});

const ALL_TPA = [TPA_A1, TPA_A2, TPA_B1];
const ALL_OPA = [OPA_A1, OPA_A2, OPA_B1];

describe("Portal-Zugangstabellen: RLS aktiv & fail-closed", () => {
  test("RLS ist auf beiden Tabellen aktiviert und erzwungen (FORCE)", async () => {
    const r = await withSuperClient((c) =>
      c.query(
        `SELECT relname, relrowsecurity, relforcerowsecurity
         FROM pg_class WHERE relname = ANY($1)`,
        [["tenant_portal_access", "owner_portal_access"]],
      ),
    );
    assert.equal(r.rows.length, 2);
    for (const row of r.rows) {
      assert.equal(row.relrowsecurity, true, `${row.relname}: RLS muss aktiv sein`);
      assert.equal(row.relforcerowsecurity, true, `${row.relname}: FORCE RLS muss aktiv sein`);
    }
  });

  test("immo_app ohne jeden Kontext → 0 Zeilen in beiden Tabellen", async () => {
    const r = await withCtx({}, async (c) => ({
      tpa: await c.query(`SELECT COUNT(*)::int AS n FROM tenant_portal_access WHERE id = ANY($1)`, [ALL_TPA]),
      opa: await c.query(`SELECT COUNT(*)::int AS n FROM owner_portal_access WHERE id = ANY($1)`, [ALL_OPA]),
    }));
    assert.equal(r.tpa.rows[0].n, 0, "tenant_portal_access ohne Kontext muss leer sein");
    assert.equal(r.opa.rows[0].n, 0, "owner_portal_access ohne Kontext muss leer sein");
  });

  test("Superuser (Auth-Bootstrap-Pfad, BYPASSRLS) sieht weiterhin alle Zeilen", async () => {
    const r = await withSuperClient((c) =>
      c.query(`SELECT COUNT(*)::int AS n FROM tenant_portal_access WHERE id = ANY($1)`, [ALL_TPA]),
    );
    assert.equal(r.rows[0].n, 3, "rootDb-Pfad (Login/Invite) darf nicht eingeschränkt werden");
  });
});

describe("Admin-Kontext (nur app.current_org): Org-Isolation", () => {
  test("Org A sieht beide Org-A-Zugänge, nicht Org B", async () => {
    const r = await withCtx({ org: ORG_A }, (c) =>
      c.query(`SELECT id FROM tenant_portal_access WHERE id = ANY($1)`, [ALL_TPA]),
    );
    const ids = r.rows.map((x: any) => x.id);
    assert.deepEqual(new Set(ids), new Set([TPA_A1, TPA_A2]));
  });

  test("Org B sieht nur den eigenen Owner-Zugang", async () => {
    const r = await withCtx({ org: ORG_B }, (c) =>
      c.query(`SELECT id FROM owner_portal_access WHERE id = ANY($1)`, [ALL_OPA]),
    );
    assert.deepEqual(r.rows.map((x: any) => x.id), [OPA_B1]);
  });
});

describe("Portal-Session: Selbst-Isolation via app.current_tenant / app.current_owner", () => {
  test("Mieter-Session A1 sieht nur die eigene tenant_portal_access-Zeile", async () => {
    const r = await withCtx({ org: ORG_A, tenant: TEN_A1 }, (c) =>
      c.query(`SELECT id FROM tenant_portal_access WHERE id = ANY($1)`, [ALL_TPA]),
    );
    assert.deepEqual(r.rows.map((x: any) => x.id), [TPA_A1],
      "Session von Mieter A1 darf weder A2 (gleiche Org) noch B1 (fremde Org) sehen");
  });

  test("Eigentümer-Session A1 sieht nur die eigene owner_portal_access-Zeile", async () => {
    const r = await withCtx({ org: ORG_A, owner: OWN_A1 }, (c) =>
      c.query(`SELECT id FROM owner_portal_access WHERE id = ANY($1)`, [ALL_OPA]),
    );
    assert.deepEqual(r.rows.map((x: any) => x.id), [OPA_A1]);
  });

  test("Mieter-Session A1 kann fremde Zeile nicht verändern (UPDATE → 0 rows)", async () => {
    const r = await withCtx({ org: ORG_A, tenant: TEN_A1 }, (c) =>
      c.query(`UPDATE tenant_portal_access SET is_active = false WHERE id = $1`, [TPA_A2]),
    );
    assert.equal(r.rowCount, 0, "Fremde Zeile derselben Org darf nicht mutierbar sein");
    const still = await withSuperClient((c) =>
      c.query(`SELECT is_active FROM tenant_portal_access WHERE id = $1`, [TPA_A2]),
    );
    assert.equal(still.rows[0].is_active, true);
  });

  test("Mixed Session (Admin-Org-Kontext + Portal-Session): Selbst-Isolation greift trotzdem", async () => {
    // Reproduziert den Review-Befund: rlsMiddleware baut den Org-Kontext auf,
    // die Portal-Middleware darf dann nicht einfach durchwinken, sondern muss
    // app.current_tenant auf der bestehenden Transaktions-Verbindung setzen.
    const { appPool, orgContext } = await import("../../server/db.js");
    const { tenantPortalOrgMiddleware } = await import("../../server/routes/tenantPortalRoutes.js");
    const schema = await import("@shared/schema");

    const app = express();
    // Session-Stub: Admin-Session (organizationId) UND Portal-Session (tenantPortalId).
    app.use((req: any, _res, next) => {
      req.session = { organizationId: ORG_A, tenantPortalId: TPA_A1 };
      next();
    });
    // rlsMiddleware-Äquivalent: BEGIN + transaktionslokales app.current_org.
    app.use((req: any, res, next) => {
      appPool.connect().then((client) => {
        client.query("BEGIN")
          .then(() => client.query("SELECT set_config('app.current_org', $1, true)", [ORG_A]))
          .then(() => {
            const orgDb = drizzle(client as any, { schema });
            const cleanup = () => { client.query("ROLLBACK").catch(() => {}).finally(() => client.release()); };
            res.on("finish", cleanup);
            orgContext.run({ organizationId: ORG_A, db: orgDb, client }, () => next());
          })
          .catch((err) => { client.release(); next(err); });
      }).catch(next);
    });
    app.use(tenantPortalOrgMiddleware as any);
    app.get("/probe", async (_req, res) => {
      const store = orgContext.getStore()!;
      const rows = await store.client.query(
        `SELECT id FROM tenant_portal_access WHERE id = ANY($1)`, [ALL_TPA],
      );
      const upd = await store.client.query(
        `UPDATE tenant_portal_access SET is_active = is_active WHERE id = $1`, [TPA_A2],
      );
      res.json({ ids: rows.rows.map((r: any) => r.id), updated: upd.rowCount });
    });

    const r = await request(app).get("/probe");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.ids, [TPA_A1],
      "Mixed Session muss auf die eigene Portal-Zeile beschränkt sein");
    assert.equal(r.body.updated, 0, "Fremde Zeile darf auch in Mixed Session nicht mutierbar sein");
  });

  test("Mixed Session mit Org-Mismatch (Portal-Zugang fremder Org) → 401", async () => {
    const { appPool, orgContext } = await import("../../server/db.js");
    const { tenantPortalOrgMiddleware } = await import("../../server/routes/tenantPortalRoutes.js");
    const schema = await import("@shared/schema");

    const app = express();
    app.use((req: any, _res, next) => {
      req.session = { organizationId: ORG_A, tenantPortalId: TPA_B1 }; // Portal-Zugang von Org B
      next();
    });
    app.use((req: any, res, next) => {
      appPool.connect().then((client) => {
        client.query("BEGIN")
          .then(() => client.query("SELECT set_config('app.current_org', $1, true)", [ORG_A]))
          .then(() => {
            const orgDb = drizzle(client as any, { schema });
            const cleanup = () => { client.query("ROLLBACK").catch(() => {}).finally(() => client.release()); };
            res.on("finish", cleanup);
            orgContext.run({ organizationId: ORG_A, db: orgDb, client }, () => next());
          })
          .catch((err) => { client.release(); next(err); });
      }).catch(next);
    });
    app.use(tenantPortalOrgMiddleware as any);
    app.get("/probe", (_req, res) => res.json({ reached: true }));

    const r = await request(app).get("/probe");
    assert.equal(r.status, 401, "Org-Mismatch zwischen Admin-Kontext und Portal-Zugang muss 401 liefern");
  });

  test("Tenant-Setting beeinflusst owner_portal_access nicht (und umgekehrt)", async () => {
    // Eine Mieter-Session hat kein app.current_owner → owner-Tabelle bleibt org-weit
    // sichtbar (wird von Portal-Routen aber nie abgefragt); wichtig ist nur, dass
    // das tenant-Setting die owner-Tabelle nicht versehentlich öffnet.
    const r = await withCtx({ org: ORG_B, tenant: TEN_B1 }, (c) =>
      c.query(`SELECT id FROM owner_portal_access WHERE id = ANY($1)`, [ALL_OPA]),
    );
    assert.deepEqual(r.rows.map((x: any) => x.id), [OPA_B1], "Nur Org-Isolation greift");
  });
});
