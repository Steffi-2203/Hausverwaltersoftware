/**
 * leases-rls.test.ts
 *
 * DB-Level-Beweis: Die RLS-Policy org_isolation_leases schützt die leases-Tabelle
 * gegen Fremdzugriff auf Datenbankebene — unabhängig von App-Code-Filtern.
 *
 * leases hat keine eigene organization_id-Spalte; die Isolation läuft über
 * unit_id → units.property_id → properties.organization_id (Join-basierte Policy).
 *
 * Getestete Eigenschaften:
 *   1. org_isolation_leases-Policy existiert in der Datenbank.
 *   2. immo_app ohne Org-Kontext → 0 Zeilen (fail-closed).
 *   3. immo_app mit fremdem Org-Kontext → sieht 0 Leases der eigenen Org-A.
 *   4. immo_app mit korrektem Org-A-Kontext → sieht eigene Leases, NICHT Org-B.
 *   5. immo_app mit Org-B-Kontext → sieht Org-B-Leases, NICHT Org-A.
 *
 * Der Test verbindet über einen appPool-identischen Pool (SET ROLE immo_app),
 * exakt so wie Produktionsanfragen es tun.
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

const _basePool = new Pool({ connectionString: process.env.DATABASE_URL });
const _baseConnect = _basePool.connect.bind(_basePool);

/** App-identischer Pool: SET ROLE immo_app vor jeder Abfrage. */
const appTestPool: typeof _basePool = Object.create(_basePool);
appTestPool.connect = async function () {
  const client = await _baseConnect();
  try {
    await client.query("SET ROLE immo_app");
    return client;
  } catch (err) {
    client.release(err as Error);
    throw new Error(
      `[appTestPool] SET ROLE immo_app fehlgeschlagen: ${(err as Error).message}`
    );
  }
} as typeof _basePool.connect;

/** Superuser-Pool für Fixture-Setup außerhalb von RLS. */
const superPool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withAppClient<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await appTestPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function withSuperClient<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await superPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Abfrage als immo_app mit gesetztem Org-Kontext (innerhalb einer Transaktion). */
async function withOrg<T>(orgId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  return withAppClient(async (client) => {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
    try {
      return await fn(client);
    } finally {
      await client.query("ROLLBACK");
    }
  });
}

/** Abfrage als immo_app ohne Org-Kontext (leere Zeichenkette → NULLIF → NULL). */
async function withNoOrg<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  return withAppClient(async (client) => {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_org', '', false)");
    try {
      return await fn(client);
    } finally {
      await client.query("ROLLBACK");
    }
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_A = randomUUID();
const ORG_B = randomUUID();
const PROP_A = randomUUID();
const PROP_B = randomUUID();
const UNIT_A = randomUUID();
const UNIT_B = randomUUID();
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const LEASE_A = randomUUID();
const LEASE_B = randomUUID();

before(async () => {
  await withSuperClient(async (c) => {
    // Organizations
    await c.query(
      `INSERT INTO organizations (id, name) VALUES ($1, 'RLS-Lease-Test Org A'), ($2, 'RLS-Lease-Test Org B')
       ON CONFLICT (id) DO NOTHING`,
      [ORG_A, ORG_B]
    );
    // Properties (direkt mit organization_id — Basis der Join-Policy)
    await c.query(
      `INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
       VALUES ($1, $2, 'Prop A', 'Adr A', 'Wien', '1010', 'mietverwaltung'),
              ($3, $4, 'Prop B', 'Adr B', 'Wien', '1010', 'mietverwaltung')
       ON CONFLICT (id) DO NOTHING`,
      [PROP_A, ORG_A, PROP_B, ORG_B]
    );
    // Units
    await c.query(
      `INSERT INTO units (id, property_id, top_nummer, type, status)
       VALUES ($1, $2, 'Top A1', 'wohnung', 'aktiv'),
              ($3, $4, 'Top B1', 'wohnung', 'aktiv')
       ON CONFLICT (id) DO NOTHING`,
      [UNIT_A, PROP_A, UNIT_B, PROP_B]
    );
    // Tenants (Voraussetzung für leases FK)
    await c.query(
      `INSERT INTO tenants (id, unit_id, first_name, last_name, email)
       VALUES ($1, $2, 'Anna', 'OrgA', 'anna@lease-rls-test.internal'),
              ($3, $4, 'Bernd', 'OrgB', 'bernd@lease-rls-test.internal')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_A, UNIT_A, TENANT_B, UNIT_B]
    );
    // Leases
    await c.query(
      `INSERT INTO leases (id, tenant_id, unit_id, start_date, grundmiete)
       VALUES ($1, $2, $3, '2025-01-01', 750.00),
              ($4, $5, $6, '2025-01-01', 850.00)
       ON CONFLICT (id) DO NOTHING`,
      [LEASE_A, TENANT_A, UNIT_A, LEASE_B, TENANT_B, UNIT_B]
    );
  });
});

after(async () => {
  await withSuperClient(async (c) => {
    await c.query(`DELETE FROM leases       WHERE id IN ($1, $2)`, [LEASE_A, LEASE_B]);
    await c.query(`DELETE FROM tenants      WHERE id IN ($1, $2)`, [TENANT_A, TENANT_B]);
    await c.query(`DELETE FROM units        WHERE id IN ($1, $2)`, [UNIT_A, UNIT_B]);
    await c.query(`DELETE FROM properties   WHERE id IN ($1, $2)`, [PROP_A, PROP_B]);
    await c.query(`DELETE FROM organizations WHERE id IN ($1, $2)`, [ORG_A, ORG_B]);
  });
  await appTestPool.end();
  await superPool.end();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("leases RLS: org_isolation_leases-Policy existiert", () => {
  test("pg_policies enthält org_isolation_leases mit NULLIF (fail-closed)", async () => {
    const result = await withSuperClient((c) =>
      c.query(
        `SELECT qual FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'leases' AND policyname = 'org_isolation_leases'`
      )
    );
    assert.equal(result.rows.length, 1, "org_isolation_leases-Policy muss in pg_policies existieren");
    assert.ok(
      result.rows[0].qual.includes("NULLIF"),
      `Policy muss NULLIF enthalten (fail-closed), war: ${result.rows[0].qual}`
    );
  });
});

describe("leases RLS: immo_app ohne Org-Kontext sieht 0 Zeilen", () => {
  test("leeres app.current_org → 0 leases (kein Cast-Fehler)", async () => {
    let error: Error | null = null;
    let cnt = -1;
    try {
      const result = await withNoOrg((c) =>
        c.query(`SELECT COUNT(*) AS cnt FROM leases WHERE id IN ($1, $2)`, [LEASE_A, LEASE_B])
      );
      cnt = parseInt(result.rows[0].cnt, 10);
    } catch (e: any) {
      error = e;
    }
    assert.equal(error, null, `Kein Fehler erwartet, aber: ${error?.message}`);
    assert.equal(cnt, 0, "Ohne Org-Kontext darf immo_app keine leases sehen");
  });
});

describe("leases RLS: immo_app mit korrektem Org-Kontext sieht nur eigene Daten", () => {
  test("Org-A-Kontext → sieht Lease A, NICHT Lease B", async () => {
    const result = await withOrg(ORG_A, (c) =>
      c.query(`SELECT id FROM leases WHERE id = ANY($1)`, [[LEASE_A, LEASE_B]])
    );
    const ids = result.rows.map((r: any) => r.id);
    assert.ok(ids.includes(LEASE_A), "Org-A-Kontext muss Lease A sehen");
    assert.ok(!ids.includes(LEASE_B), "Org-A-Kontext darf Lease B nicht sehen");
  });

  test("Org-B-Kontext → sieht Lease B, NICHT Lease A", async () => {
    const result = await withOrg(ORG_B, (c) =>
      c.query(`SELECT id FROM leases WHERE id = ANY($1)`, [[LEASE_A, LEASE_B]])
    );
    const ids = result.rows.map((r: any) => r.id);
    assert.ok(ids.includes(LEASE_B), "Org-B-Kontext muss Lease B sehen");
    assert.ok(!ids.includes(LEASE_A), "Org-B-Kontext darf Lease A nicht sehen");
  });

  test("Fremder Org-Kontext → 0 eigene Leases sichtbar (vollständige Isolation)", async () => {
    // Bekanntes Attack-Muster: gültiger Org-Kontext, aber falsche Org-ID.
    // Die DB selbst muss 0 Zeilen zurückgeben — App-Code-Filter sind nicht notwendig.
    const FOREIGN_ORG = randomUUID(); // existiert nicht in der DB
    const result = await withOrg(FOREIGN_ORG, (c) =>
      c.query(`SELECT COUNT(*) AS cnt FROM leases WHERE id IN ($1, $2)`, [LEASE_A, LEASE_B])
    );
    assert.equal(
      parseInt(result.rows[0].cnt, 10),
      0,
      "Fremder Org-Kontext darf keine Leases einer anderen Org sehen"
    );
  });
});

describe("leases RLS: RLS ist auf der leases-Tabelle aktiv", () => {
  test("pg_class.relrowsecurity ist true für leases", async () => {
    const result = await withSuperClient((c) =>
      c.query(
        `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class
         WHERE relname = 'leases' AND relnamespace = 'public'::regnamespace`
      )
    );
    assert.equal(result.rows.length, 1, "Tabelle leases muss in pg_class existieren");
    assert.equal(result.rows[0].relrowsecurity, true, "RLS muss auf leases aktiviert sein");
    assert.equal(result.rows[0].relforcerowsecurity, true, "FORCE ROW LEVEL SECURITY muss gesetzt sein");
  });
});
