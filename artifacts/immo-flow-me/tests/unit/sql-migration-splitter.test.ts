/**
 * Regression: der Migrations-Splitter darf NICHT an einem ';' innerhalb eines
 * String-Literals splitten (Produktions-Deploy scheiterte an
 * 20260815_leases_befristet_properties_bundesland.sql:
 * COMMENT ... IS '… Mietvertrag; Befristungsabschlag …').
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { splitStatements } from "../../server/lib/runSqlMigrations";

describe("splitStatements — String-Literale", () => {
  test("';' innerhalb von '...' splittet nicht", () => {
    const stmts = splitStatements(`COMMENT ON COLUMN x.y IS 'a; b'; SELECT 1;`);
    assert.deepEqual(stmts, [`COMMENT ON COLUMN x.y IS 'a; b'`, `SELECT 1`]);
  });

  test("escaptes Quote '' innerhalb eines Literals", () => {
    const stmts = splitStatements(`SELECT 'it''s; fine'; SELECT 2;`);
    assert.deepEqual(stmts, [`SELECT 'it''s; fine'`, `SELECT 2`]);
  });

  test("DO $$ ... $$-Blöcke bleiben eine Einheit", () => {
    const stmts = splitStatements(`DO $$ BEGIN PERFORM 1; END $$; SELECT 3;`);
    assert.equal(stmts.length, 2);
    assert.ok(stmts[0].includes("PERFORM 1;"));
  });

  test("getaggte Dollar-Quotes ($func$) mit Quotes und ';' im Body", () => {
    const body = `$func$ BEGIN RAISE NOTICE 'a; b'; RETURN NEW; END $func$`;
    const stmts = splitStatements(`CREATE FUNCTION f() RETURNS trigger AS ${body} LANGUAGE plpgsql; SELECT 1;`);
    assert.equal(stmts.length, 2);
    assert.ok(stmts[0].includes(body));
  });

  test("E-Strings mit \\' Escape splitten nicht", () => {
    const stmts = splitStatements(`SELECT E'it\\'s; fine'; SELECT 2;`);
    assert.deepEqual(stmts, [`SELECT E'it\\'s; fine'`, `SELECT 2`]);
  });

  test("quoted Identifier mit ';' splittet nicht", () => {
    const stmts = splitStatements(`SELECT "a;b" FROM t; SELECT 3;`);
    assert.deepEqual(stmts, [`SELECT "a;b" FROM t`, `SELECT 3`]);
  });

  test("'--' innerhalb eines Literals wird NICHT als Kommentar entfernt", () => {
    const stmts = splitStatements(`SELECT 'a -- b; c'; SELECT 4;`);
    assert.deepEqual(stmts, [`SELECT 'a -- b; c'`, `SELECT 4`]);
  });

  test("-- Zeilenkommentare und /* */ Blockkommentare werden entfernt", () => {
    const stmts = splitStatements(`-- Kopf\nSELECT 1; /* block; mit ; */ SELECT 2; /* outer /* inner */ noch */ SELECT 3;`);
    assert.deepEqual(stmts, [`SELECT 1`, `SELECT 2`, `SELECT 3`]);
  });

  test("die real fehlgeschlagene Migration wird korrekt gesplittet", () => {
    const file = path.join(process.cwd(), "migrations", "20260815_leases_befristet_properties_bundesland.sql");
    const sqlContent = fs.readFileSync(file, "utf8");
    const stmts = splitStatements(sqlContent);
    // Kein Fragment darf mit einem unbalancierten Quote enden
    for (const s of stmts) {
      const quotes = (s.match(/'/g) || []).length - 2 * (s.match(/''/g) || []).length;
      assert.equal(quotes % 2, 0, `Unbalanciertes Quote in Statement: ${s.slice(0, 80)}`);
    }
    // Der problematische Kommentar muss als EIN Statement erhalten sein
    assert.ok(stmts.some(s => s.includes("Befristungsabschlag 25%") && s.startsWith("COMMENT ON COLUMN leases.befristet")));
  });
});
