/**
 * Task #155: Migrationen laufen beim Deploy automatisch und sicher.
 *
 * Bei Autoscale booten mehrere Instanzen gleichzeitig — runSqlMigrations()
 * muss dank pg_advisory_lock auch bei parallelen Aufrufen fehlerfrei
 * durchlaufen (eine Instanz migriert, die anderen warten und sehen alles
 * als angewendet).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { runSqlMigrations } from "../../server/lib/runSqlMigrations";
import { pool } from "../../server/db";

describe("runSqlMigrations — paralleler Boot", () => {
  test("drei gleichzeitige Läufe kollidieren nicht", async () => {
    await Promise.all([runSqlMigrations(), runSqlMigrations(), runSqlMigrations()]);
    // Danach ist alles angewendet und ein weiterer Lauf ist ein No-op
    await runSqlMigrations();
    const res = await pool.query("SELECT count(*)::int AS n FROM _sql_migrations");
    assert.ok(res.rows[0].n > 0, "Migrationstabelle muss Einträge haben");
  });
});
