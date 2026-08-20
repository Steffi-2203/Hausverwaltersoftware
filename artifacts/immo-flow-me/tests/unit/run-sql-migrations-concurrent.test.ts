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
import fs from "node:fs";
import path from "node:path";

import {
  hasExplicitTransactionControl,
  runSqlMigrations,
  splitStatements,
} from "../../server/lib/runSqlMigrations";
import { pool } from "../../server/db";

describe("runSqlMigrations — paralleler Boot", () => {
  test("drei gleichzeitige Läufe kollidieren nicht", async () => {
    await Promise.all([runSqlMigrations(), runSqlMigrations(), runSqlMigrations()]);
    // Danach ist alles angewendet und ein weiterer Lauf ist ein No-op
    await runSqlMigrations();
    const res = await pool.query("SELECT count(*)::int AS n FROM _sql_migrations");
    assert.ok(res.rows[0].n > 0, "Migrationstabelle muss Einträge haben");
  });

  test("respektiert eine bestehende BEGIN/COMMIT-Migration ohne Verschachtelung", async () => {
    const filename = "20260213_create_extensions_schema.sql";
    const migrationPath = path.join(process.cwd(), "migrations", filename);
    const statements = splitStatements(fs.readFileSync(migrationPath, "utf8"));
    assert.equal(hasExplicitTransactionControl(statements), true);

    // Die Migration ist idempotent. Durch erneutes Ausführen via Runner wird
    // der reale Altpfad (eigenes BEGIN/COMMIT) gegen Nested-Transaction-
    // Regressionen geprüft und danach wieder als applied registriert.
    await pool.query("DELETE FROM _sql_migrations WHERE filename = $1", [filename]);
    await runSqlMigrations();

    const result = await pool.query(
      "SELECT 1 FROM _sql_migrations WHERE filename = $1",
      [filename]
    );
    assert.equal(result.rowCount, 1);
  });
});
