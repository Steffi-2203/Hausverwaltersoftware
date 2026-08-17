/**
 * ISO 13616 IBAN Mod-97 Prüfsummen-Tests
 *
 * Stellt sicher, dass validateIbanChecksum() echte IBANs akzeptiert
 * und verfälschte (falsch getippte Ziffern/Buchstaben) ablehnt.
 *
 * Ausführen:
 *   node --import=./node_modules/tsx/dist/esm/index.cjs --test tests/unit/iban-checksum.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateIbanChecksum, normalizeIban } from "../../server/services/sepaExportService";

describe("validateIbanChecksum (ISO 13616 Mod-97)", () => {
  // ── Gültige IBANs ─────────────────────────────────────────────────────────
  const VALID: [string, string][] = [
    ["AT61 1904 3002 3457 3201", "Österreich (Standard-Test-IBAN)"],
    ["DE89 3704 0044 0532 0130 00", "Deutschland"],
    ["CH93 0076 2011 6238 5295 7", "Schweiz"],
    ["GB29 NWBK 6016 1331 9268 19", "Vereinigtes Königreich"],
  ];

  for (const [raw, label] of VALID) {
    it(`akzeptiert gültige IBAN: ${label}`, () => {
      const iban = raw.replace(/\s/g, "").toUpperCase();
      assert.strictEqual(validateIbanChecksum(iban), true, `IBAN ${iban} sollte gültig sein`);
    });
  }

  // ── Ungültige IBANs (verfälschte Prüfziffer oder Kontonummer) ────────────
  const INVALID: [string, string][] = [
    // Österreich IBAN mit falscher Prüfziffer
    ["AT62 1904 3002 3457 3201", "Falsche Prüfziffer (AT61→AT62)"],
    // Letzte Ziffer geändert
    ["AT61 1904 3002 3457 3200", "Letzte Ziffer geändert"],
    ["DE89 3704 0044 0532 0130 01", "DE — letzte Ziffer +1"],
    ["GB29 NWBK 6016 1331 9268 18", "GB — letzte Ziffer -1"],
  ];

  for (const [raw, label] of INVALID) {
    it(`lehnt ungültige IBAN ab: ${label}`, () => {
      const iban = raw.replace(/\s/g, "").toUpperCase();
      assert.strictEqual(validateIbanChecksum(iban), false, `IBAN ${iban} sollte ungültig sein`);
    });
  }
});

describe("normalizeIban — integriert Mod-97-Check", () => {
  it("wirft bei falsch getippter IBAN (Prüfziffer falsch)", () => {
    // AT61 → AT62 (falsche Prüfziffer)
    assert.throws(
      () => normalizeIban("AT62 1904 3002 3457 3201", "Testmieter"),
      /Prüfziffer/,
    );
  });

  it("gibt normalisierte IBAN zurück bei gültiger IBAN", () => {
    const result = normalizeIban("at61 1904 3002 3457 3201", "Testmieter");
    assert.strictEqual(result, "AT611904300234573201");
  });

  it("wirft bei leerem Wert", () => {
    assert.throws(() => normalizeIban("", "Testmieter"), /ungültige IBAN/);
  });
});
