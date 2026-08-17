/**
 * rls-fail-closed.test.ts
 *
 * Belegt, dass die RLS-Konfiguration fail-closed ist — getestet mit demselben
 * Pool-Setup, das die Anwendung zur Laufzeit verwendet (appPool mit SET ROLE immo_app).
 *
 * Getestete Eigenschaften:
 *   1. Keine bypass_rls_*-Policies (fail-open) mehr in der DB.
 *   2. Alle org_isolation-Policies enthalten NULLIF (kein Cast-Fehler bei leerem Kontext).
 *   3. Ohne gesetzten app.current_org → 0 Zeilen für org-gebundene Tabellen.
 *   4. Mit falschem Org-Kontext → fremde Daten nicht sichtbar.
 *   5. Mit korrektem Org-Kontext → eigene Daten sichtbar.
 *   6. organizations (RLS-excluded) bleibt ohne Org-Kontext lesbar.
 *
 * Der Test verbindet ausdrücklich über appPool (mit SET ROLE immo_app), also
 * exakt so wie Produktions-Anfragen das tun — kein SET ROLE im Test selbst.
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pg from "pg";

const { Pool } = pg;

// ---------------------------------------------------------------------------
// App-identischer Pool — connect() überschrieben wie in server/db.ts:
// SET ROLE immo_app wird AWAITED bevor der Client zurückgegeben wird.
// Schlägt die Rolle fehl → Verbindung wird mit dem Fehler freigegeben (fail-closed).
// ---------------------------------------------------------------------------

const _testPoolBase = new Pool({ connectionString: process.env.DATABASE_URL });
const _testBaseConnect = _testPoolBase.connect.bind(_testPoolBase);
const appTestPool: typeof _testPoolBase = Object.create(_testPoolBase);
appTestPool.connect = async function () {
  const client = await _testBaseConnect();
  try {
    await client.query("SET ROLE immo_app");
    return client;
  } catch (err) {
    client.release(err as Error);
    throw new Error(
      `[appTestPool] SET ROLE immo_app fehlgeschlagen — Verbindung abgelehnt: ${(err as Error).message}`
    );
  }
} as typeof _testPoolBase.connect;

// Superuser-Pool für Fixture-Setup (Daten einrichten außerhalb von RLS).
const superPool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withAppClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await appTestPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function withSuperClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await superPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Abfrage als immo_app mit explizit gesetztem Org-Kontext. */
async function withOrg<T>(orgId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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
async function withNoOrg<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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

const ORG_A_ID = randomUUID();
const ORG_B_ID = randomUUID();
const PROP_A_ID = randomUUID();
const PROP_B_ID = randomUUID();
const UNIT_B_ID = randomUUID();
let SETTLEMENT_B_ID: number; // serial — vom Insert zurückgegeben

before(async () => {
  // Superuser fügt Fixtures ein — außerhalb von RLS, damit der Test sauber aufgesetzt ist.
  await withSuperClient(async (client) => {
    await client.query(`
      INSERT INTO organizations (id, name, email)
      VALUES ($1, 'RLS-Test Org A', 'a@rls.test'),
             ($2, 'RLS-Test Org B', 'b@rls.test')
      ON CONFLICT (id) DO NOTHING
    `, [ORG_A_ID, ORG_B_ID]);

    await client.query(`
      INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
      VALUES ($1, $2, 'Prop A', 'Addr A', 'Wien', '1010', 'mietverwaltung'),
             ($3, $4, 'Prop B', 'Addr B', 'Wien', '1010', 'mietverwaltung')
      ON CONFLICT (id) DO NOTHING
    `, [PROP_A_ID, ORG_A_ID, PROP_B_ID, ORG_B_ID]);

    // Unit für Prop B damit heating_settlement_details.unit_id NOT NULL erfüllt ist.
    await client.query(`
      INSERT INTO units (id, property_id, top_nummer, type, status, stockwerk, zimmer, flaeche, created_at)
      VALUES ($1, $2, 'RLS-B1', 'wohnung', 'aktiv', 1, 2, 60.0, NOW())
      ON CONFLICT (id) DO NOTHING
    `, [UNIT_B_ID, PROP_B_ID]);

    // heating_settlement_details: Org B hat eine Abrechnung mit einer Detailzeile.
    const settlRes = await client.query(`
      INSERT INTO heating_settlements
        (organization_id, property_id, period_start, period_end, total_cost,
         fixed_cost_share, variable_cost_share, status, created_at)
      VALUES ($1, $2, '2025-01-01', '2025-12-31', 8000.00, 40, 60, 'entwurf', NOW())
      RETURNING id
    `, [ORG_B_ID, PROP_B_ID]);
    SETTLEMENT_B_ID = Number(settlRes.rows[0].id);

    await client.query(`
      INSERT INTO heating_settlement_details
        (settlement_id, unit_id, tenant_name, area, consumption,
         fixed_amount, variable_amount, total_amount, prepayment, balance)
      VALUES ($1, $2, 'RLS-Mieter B', 60.0, 900.0, 3200.00, 4800.00, 8000.00, 7000.00, 1000.00)
    `, [SETTLEMENT_B_ID, UNIT_B_ID]);
  });
});

after(async () => {
  await withSuperClient(async (client) => {
    await client.query(
      `DELETE FROM heating_settlement_details WHERE settlement_id = $1`,
      [SETTLEMENT_B_ID]
    ).catch(() => {});
    await client.query(
      `DELETE FROM heating_settlements WHERE id = $1`,
      [SETTLEMENT_B_ID]
    ).catch(() => {});
    await client.query(`DELETE FROM units WHERE id = $1`, [UNIT_B_ID]).catch(() => {});
    await client.query(`DELETE FROM properties WHERE id IN ($1, $2)`, [PROP_A_ID, PROP_B_ID]);
    await client.query(`DELETE FROM organizations WHERE id IN ($1, $2)`, [ORG_A_ID, ORG_B_ID]);
  });
  await appTestPool.end();
  await superPool.end();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("appPool: effektive Datenbankrolle ist immo_app", () => {
  test("current_user und current_role sind immo_app (nicht postgres)", async () => {
    const result = await withAppClient((client) =>
      client.query("SELECT current_user, current_role")
    );
    const { current_user, current_role } = result.rows[0];
    assert.equal(current_user, "immo_app",
      `current_user muss immo_app sein, war aber: ${current_user}`);
    assert.equal(current_role, "immo_app",
      `current_role muss immo_app sein, war aber: ${current_role}`);
  });
});

describe("db-Proxy: kein Superuser-Fallback ohne orgContext", () => {
  // Wir importieren das Server-Modul einmalig für diese Suite und schließen
  // alle Pools in after() explizit, damit der Test-Prozess sauber endet.
  let dbModule: typeof import("../../server/db.js");

  before(async () => {
    dbModule = await import("../../server/db.js");
  });

  // Beweist: activeDb() wirft ohne orgContext — kein stiller Fallback auf
  // rootDb (Superuser) oder irgendeinen anderen Pool.
  test("activeDb() wirft ohne orgContext — kein Superuser-Fallback möglich", () => {
    const { activeDb } = dbModule;
    assert.throws(
      () => activeDb(),
      (err: Error) => err.message.includes("Kein Org-Kontext"),
      "activeDb() muss ohne orgContext einen Fehler werfen, nicht stillschweigend auf rootDb fallen",
    );
  });

  // Beweist: jeder Zugriff auf `db` ohne orgContext wirft (Proxy-get-Trap).
  test("db-Proxy wirft ohne orgContext bei jedem Property-Zugriff", () => {
    const { db } = dbModule;
    assert.throws(
      () => (db as any).select,
      (err: Error) => err.message.includes("Kein Org-Kontext"),
      "db ohne orgContext muss einen Fehler werfen — kein stiller Superuser-Zugriff",
    );
  });

  // Beweist den Rollenwechsel auf DB-Ebene: appPool.connect() liefert eine
  // Verbindung als immo_app — die Basis aller orgContext-Abfragen.
  test("appPool.connect() liefert immo_app-Verbindung (Basis der orgContext-Abfragen)", async () => {
    const { appPool } = dbModule;
    const client = await appPool.connect();
    try {
      const res = await client.query("SELECT current_user");
      assert.equal(res.rows[0].current_user, "immo_app",
        `appPool.connect() muss immo_app liefern, war aber: ${res.rows[0].current_user}`);
    } finally {
      client.release();
    }
  });

  after(async () => {
    // Server-Pools schließen, damit der Prozess sauber endet.
    await Promise.all([
      dbModule.appPool.end().catch(() => {}),
      dbModule.pool.end().catch(() => {}),
    ]);
  });
});

describe("RLS fail-closed: keine Bypass-Policies", () => {
  test("bypass_rls_*-Policies existieren nicht mehr in der Datenbank", async () => {
    const result = await withSuperClient((client) =>
      client.query(
        `SELECT COUNT(*) AS cnt FROM pg_policies
         WHERE schemaname = 'public' AND policyname LIKE 'bypass_rls_%'`
      )
    );
    assert.equal(parseInt(result.rows[0].cnt, 10), 0,
      "Es darf keine bypass_rls_*-Policy geben — sie oeffnen alle Zeilen bei fehlendem Org-Kontext");
  });

  test("Isolations-Policies enthalten NULLIF (fail-closed-Bedingung)", async () => {
    const result = await withSuperClient((client) =>
      client.query(
        `SELECT COUNT(*) AS cnt FROM pg_policies
         WHERE schemaname = 'public'
           AND policyname LIKE 'org_isolation_%'
           AND qual LIKE '%NULLIF%'`
      )
    );
    assert.ok(parseInt(result.rows[0].cnt, 10) > 0,
      "Mindestens eine org_isolation-Policy muss NULLIF enthalten");
  });
});

describe("RLS fail-closed: immo_app ohne Org-Kontext sieht keine Zeilen", () => {
  test("properties: leeres app.current_org → 0 Zeilen (kein Cast-Fehler)", async () => {
    let error: Error | null = null;
    let cnt = -1;
    try {
      const result = await withNoOrg((client) =>
        client.query(`SELECT COUNT(*) AS cnt FROM properties`)
      );
      cnt = parseInt(result.rows[0].cnt, 10);
    } catch (e: any) {
      error = e;
    }
    assert.equal(error, null, `Kein Fehler erwartet, aber: ${error?.message}`);
    assert.equal(cnt, 0, "Ohne Org-Kontext muss die immo_app-Rolle 0 Zeilen sehen");
  });

  test("properties: eigene Testzeile ohne Org-Kontext unsichtbar", async () => {
    const result = await withNoOrg((client) =>
      client.query(`SELECT COUNT(*) AS cnt FROM properties WHERE id = $1`, [PROP_A_ID])
    );
    assert.equal(parseInt(result.rows[0].cnt, 10), 0,
      "Eigene Zeile darf ohne Org-Kontext nicht sichtbar sein");
  });
});

describe("RLS: immo_app mit Org-Kontext sieht nur eigene Daten", () => {
  test("Org-A-Kontext → sieht Prop A, nicht Prop B", async () => {
    const result = await withOrg(ORG_A_ID, (client) =>
      client.query(`SELECT id FROM properties WHERE id = ANY($1)`, [[PROP_A_ID, PROP_B_ID]])
    );
    const ids = result.rows.map((r: any) => r.id);
    assert.ok(ids.includes(PROP_A_ID), "Org-A-Kontext muss Prop A sehen");
    assert.ok(!ids.includes(PROP_B_ID), "Org-A-Kontext darf Prop B nicht sehen");
  });

  test("Org-B-Kontext → sieht Prop B, nicht Prop A", async () => {
    const result = await withOrg(ORG_B_ID, (client) =>
      client.query(`SELECT id FROM properties WHERE id = ANY($1)`, [[PROP_A_ID, PROP_B_ID]])
    );
    const ids = result.rows.map((r: any) => r.id);
    assert.ok(ids.includes(PROP_B_ID), "Org-B-Kontext muss Prop B sehen");
    assert.ok(!ids.includes(PROP_A_ID), "Org-B-Kontext darf Prop A nicht sehen");
  });
});

describe("RLS: organizations bleibt org-übergreifend lesbar (excluded from RLS)", () => {
  test("immo_app ohne Org-Kontext kann organizations lesen", async () => {
    const result = await withNoOrg((client) =>
      client.query(`SELECT COUNT(*) AS cnt FROM organizations WHERE id = ANY($1)`, [[ORG_A_ID, ORG_B_ID]])
    );
    assert.equal(parseInt(result.rows[0].cnt, 10), 2,
      "organizations ist von RLS ausgeschlossen und muss immer lesbar sein");
  });
});

describe("RLS heating_settlement_details: fail-closed via JOIN auf heating_settlements", () => {
  test("ohne Org-Kontext → 0 Detailzeilen sichtbar (fail-closed)", async () => {
    let error: Error | null = null;
    let cnt = -1;
    try {
      const result = await withNoOrg((client) =>
        client.query(
          `SELECT COUNT(*) AS cnt FROM heating_settlement_details WHERE settlement_id = $1`,
          [SETTLEMENT_B_ID]
        )
      );
      cnt = parseInt(result.rows[0].cnt, 10);
    } catch (e: any) {
      error = e;
    }
    assert.equal(error, null, `Kein Fehler erwartet, aber: ${error?.message}`);
    assert.equal(cnt, 0, "Ohne Org-Kontext darf immo_app keine Detailzeilen sehen");
  });

  test("Org-A-Kontext → Detailzeilen von Org B nicht sichtbar (Isolation)", async () => {
    const result = await withOrg(ORG_A_ID, (client) =>
      client.query(
        `SELECT COUNT(*) AS cnt FROM heating_settlement_details WHERE settlement_id = $1`,
        [SETTLEMENT_B_ID]
      )
    );
    assert.equal(parseInt(result.rows[0].cnt, 10), 0,
      "Org-A-Kontext darf Detailzeilen von Org B nicht sehen");
  });

  test("Org-B-Kontext → eigene Detailzeilen sichtbar", async () => {
    const result = await withOrg(ORG_B_ID, (client) =>
      client.query(
        `SELECT COUNT(*) AS cnt FROM heating_settlement_details WHERE settlement_id = $1`,
        [SETTLEMENT_B_ID]
      )
    );
    assert.equal(parseInt(result.rows[0].cnt, 10), 1,
      "Org-B-Kontext muss die eigene Detailzeile sehen");
  });

  test("Org-A-Kontext: DELETE auf Detailzeilen von Org B → 0 gelöschte Zeilen", async () => {
    await withOrg(ORG_A_ID, (client) =>
      client.query(
        `DELETE FROM heating_settlement_details WHERE settlement_id = $1`,
        [SETTLEMENT_B_ID]
      )
    );
    // Superuser prüft: Zeile noch vorhanden
    const result = await withSuperClient((client) =>
      client.query(
        `SELECT COUNT(*) AS cnt FROM heating_settlement_details WHERE settlement_id = $1`,
        [SETTLEMENT_B_ID]
      )
    );
    assert.equal(parseInt(result.rows[0].cnt, 10), 1,
      "RLS muss DELETE auf fremde Detailzeilen verhindern — Zeile muss noch existieren");
  });

  test("Org-A-Kontext: UPDATE auf Detailzeilen von Org B → keine Änderung", async () => {
    await withOrg(ORG_A_ID, (client) =>
      client.query(
        `UPDATE heating_settlement_details SET consumption = 9999 WHERE settlement_id = $1`,
        [SETTLEMENT_B_ID]
      )
    );
    const result = await withSuperClient((client) =>
      client.query(
        `SELECT consumption FROM heating_settlement_details WHERE settlement_id = $1`,
        [SETTLEMENT_B_ID]
      )
    );
    assert.equal(result.rows.length, 1, "Zeile muss noch existieren");
    assert.notEqual(
      Number(result.rows[0].consumption), 9999,
      "RLS muss UPDATE auf fremde Detailzeilen verhindern — consumption darf nicht 9999 sein"
    );
  });
});
