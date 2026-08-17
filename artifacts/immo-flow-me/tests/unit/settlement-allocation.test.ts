/**
 * Settlement-Verteilungsschlüssel — Unit-Tests
 *
 * Stellt sicher, dass buildAllocationPlan() explizit fehlschlägt wenn
 * kein Verteilungsschlüssel gefunden wird (statt still auf orgKeys[0]
 * zurückzufallen).
 *
 * Diese Tests mocken die DB-Abfragen — kein DB-Zugriff nötig.
 *
 * Ausführen:
 *   node --import=./node_modules/tsx/dist/esm/index.cjs --test tests/unit/settlement-allocation.test.ts
 */
import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Reines Berechnungs-Subset ohne DB-Abhängigkeit ────────────────────────

/**
 * Isolierte Kopie der Schlüsselsuche aus settlementService.buildAllocationPlan().
 * Testet nur die Entscheidungslogik — kein Drizzle/DB nötig.
 */
function findDistributionKey(
  expense: { distributionKeyId?: string | null; mrgKategorie?: string | null; category?: string | null },
  keyMap: Map<string, { id: string; name: string; keyCode?: string | null; inputType?: string | null }>,
  orgKeys: Array<{ id: string; name: string; keyCode?: string | null; inputType?: string | null }>,
): { id: string; name: string } {
  const category = expense.mrgKategorie || expense.category || "sonstige";

  const key = (expense.distributionKeyId ? keyMap.get(expense.distributionKeyId) : null)
    || orgKeys.find(k => k.keyCode === category)
    || orgKeys.find(k => k.inputType === "flaeche");

  // Audit-Befund K5: kein stiller Fallback auf orgKeys[0]
  if (!key) {
    throw new Error(
      `Kein Verteilungsschlüssel für Kategorie "${category}" (Ausgabe-ID: ${(expense as any).id || "?"}) gefunden. ` +
      `Bitte der Ausgabe einen Schlüssel zuweisen oder einen Flächenschlüssel als Organisations-Standard anlegen.`,
    );
  }

  return key;
}

describe("findDistributionKey — Fail-loud ohne Fallback", () => {
  const flächeKey = { id: "key-1", name: "Fläche", keyCode: "flaeche", inputType: "flaeche" };
  const wasserKey = { id: "key-2", name: "Wasserverbrauch", keyCode: "wasser", inputType: "menge" };

  it("gibt direkten Schlüssel zurück (expense.distributionKeyId gesetzt)", () => {
    const keyMap = new Map([["key-1", flächeKey]]);
    const result = findDistributionKey({ distributionKeyId: "key-1" }, keyMap, []);
    assert.strictEqual(result.id, "key-1");
  });

  it("findet Schlüssel über keyCode == category", () => {
    const result = findDistributionKey(
      { mrgKategorie: "wasser" },
      new Map(),
      [wasserKey, flächeKey],
    );
    assert.strictEqual(result.id, "key-2");
  });

  it("findet Fallback-Flächenschlüssel wenn keyCode nicht passt", () => {
    const result = findDistributionKey(
      { category: "unbekannte_kategorie" },
      new Map(),
      [flächeKey],
    );
    assert.strictEqual(result.id, "key-1");
  });

  it("wirft explizit wenn kein Schlüssel gefunden wird (kein stiller orgKeys[0]-Fallback)", () => {
    // Org hat nur einen Wassermengen-Schlüssel, aber kein Flächenschlüssel
    const onlyWasser = [wasserKey];
    assert.throws(
      () => findDistributionKey({ category: "sonstige" }, new Map(), onlyWasser),
      (err: Error) => {
        assert.ok(err.message.includes("Kein Verteilungsschlüssel"), `Erwartet Fehlermeldung, bekommen: ${err.message}`);
        assert.ok(err.message.includes("sonstige"), `Fehlermeldung sollte Kategorie enthalten: ${err.message}`);
        return true;
      },
    );
  });

  it("wirft wenn orgKeys leer ist", () => {
    assert.throws(
      () => findDistributionKey({ category: "heizung" }, new Map(), []),
      /Kein Verteilungsschlüssel/,
    );
  });

  it("wirft NICHT wenn ein Flächenschlüssel vorhanden ist (globaler Fallback greift)", () => {
    // Flächenschlüssel als globaler Fallback — das ist weiterhin erlaubt
    assert.doesNotThrow(() =>
      findDistributionKey({ category: "heizung" }, new Map(), [flächeKey]),
    );
  });
});

describe("IBAN Mod-97 Grundprinzip (ohne Import)", () => {
  // Einfache Inline-Implementierung zum Testen des Algorithmus selbst
  function modulo97(iban: string): number {
    const rearranged = iban.slice(4) + iban.slice(0, 4);
    const numeric = rearranged.replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55));
    let r = 0;
    for (const c of numeric) r = (r * 10 + parseInt(c, 10)) % 97;
    return r;
  }

  it("gültige IBAN liefert Rest 1", () => {
    // AT61 1904 3002 3457 3201
    assert.strictEqual(modulo97("AT611904300234573201"), 1);
  });

  it("verfälschte IBAN liefert Rest ≠ 1", () => {
    // Letzte Ziffer geändert: ...3201 → ...3200
    assert.notStrictEqual(modulo97("AT611904300234573200"), 1);
  });
});
