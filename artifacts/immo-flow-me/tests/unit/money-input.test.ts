/**
 * Tests für parseMoneyInput — Validierung von Geld-Eingaben für numeric(12,2)-Spalten.
 * Kontext Task #129: cost_eur / cost_estimate / actual_cost wurden auf numeric(12,2)
 * migriert; die API muss Werte außerhalb des Bereichs mit 400 ablehnen statt mit 500.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseMoneyInput } from "../../server/lib/money";

describe("parseMoneyInput", () => {
  test("akzeptiert normale Beträge (number)", () => {
    assert.deepEqual(parseMoneyInput(123.45, "X"), { value: "123.45" });
  });

  test("akzeptiert Strings mit Komma", () => {
    assert.deepEqual(parseMoneyInput("19,90", "X"), { value: "19.90" });
  });

  test("rundet kaufmännisch auf 2 Nachkommastellen", () => {
    assert.deepEqual(parseMoneyInput("1.005", "X"), { value: "1.01" });
    assert.deepEqual(parseMoneyInput("-1.005", "X"), { value: "-1.01" });
  });

  test("akzeptiert Maximalwert mit 10 Vorkommastellen", () => {
    assert.deepEqual(parseMoneyInput("9999999999.99", "X"), { value: "9999999999.99" });
  });

  test("lehnt 11 Vorkommastellen ab", () => {
    const r = parseMoneyInput("10000000000", "X");
    assert.ok("error" in r && r.error.includes("Bereich"));
  });

  test("lehnt negative Überschreitung ab", () => {
    const r = parseMoneyInput(-10000000000, "X");
    assert.ok("error" in r);
  });

  test("lehnt nicht-numerische Eingaben ab", () => {
    for (const bad of ["abc", "12.3.4", "", NaN, Infinity, {}, [], true, null, undefined]) {
      const r = parseMoneyInput(bad, "Feld");
      assert.ok("error" in r, `sollte ablehnen: ${String(bad)}`);
    }
  });

  test("Fehlermeldung enthält Feldnamen", () => {
    const r = parseMoneyInput("abc", "Kosten (EUR)");
    assert.ok("error" in r && r.error.startsWith("Kosten (EUR)"));
  });
});
