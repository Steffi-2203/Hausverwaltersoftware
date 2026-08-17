/**
 * VPI-Deckelung (MietWuG Hälfteregelung) — Unit-Tests
 *
 * §16 Abs.6 MRG: Bei Kategoriemieten darf nur 50 % des VPI-Anstiegs
 * an die Mieter weitergegeben werden (Hälfteregelung).
 *
 * Ausführen:
 *   node --import=./node_modules/tsx/dist/esm/index.cjs --test tests/unit/vpi-cap.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeVpiPercentage,
  meetsSchwellenwert,
  applyMietWuGCap,
} from "../../server/services/vpiAutomationService";

describe("computeVpiPercentage", () => {
  it("berechnet prozentualen Anstieg korrekt", () => {
    // (120 - 100) / 100 = 0.20 (20 %)
    assert.strictEqual(computeVpiPercentage(120, 100), 0.2);
  });

  it("gibt 0 zurück wenn baseVpi ≤ 0", () => {
    assert.strictEqual(computeVpiPercentage(120, 0), 0);
    assert.strictEqual(computeVpiPercentage(120, -5), 0);
  });

  it("berechnet auch negativen Anstieg (VPI gefallen)", () => {
    // (95 - 100) / 100 = -0.05
    assert.strictEqual(computeVpiPercentage(95, 100), -0.05);
  });
});

describe("meetsSchwellenwert", () => {
  it("gibt true zurück wenn Schwellenwert erreicht", () => {
    assert.strictEqual(meetsSchwellenwert(0.05, 0.05), true);
    assert.strictEqual(meetsSchwellenwert(0.06, 0.05), true);
  });

  it("gibt false zurück wenn Schwellenwert nicht erreicht", () => {
    assert.strictEqual(meetsSchwellenwert(0.04, 0.05), false);
    assert.strictEqual(meetsSchwellenwert(0, 0.05), false);
  });

  it("verwendet globalen Schwellenwert (5 %) wenn keiner angegeben", () => {
    assert.strictEqual(meetsSchwellenwert(0.049), false);
    assert.strictEqual(meetsSchwellenwert(0.05), true);
  });
});

describe("applyMietWuGCap — Hälfteregelung §16 Abs.6 MRG", () => {
  it("wendet 50 % Cap für Kategoriemieten an", () => {
    // 20 % Anstieg → nur 10 % dürfen weitergegeben werden
    const result = applyMietWuGCap(0.20, "kategorie");
    assert.strictEqual(result, 0.10);
  });

  it("wendet 50 % Cap auch für kleinere Anstiege korrekt an", () => {
    const result = applyMietWuGCap(0.06, "kategorie");
    // 6 % / 2 = 3 %
    assert.ok(Math.abs(result - 0.03) < 1e-10, `Erwartet ~0.03, bekommen ${result}`);
  });

  it("kein Cap für Richtwertmieten (voller Anstieg)", () => {
    const result = applyMietWuGCap(0.20, "richtwert");
    assert.strictEqual(result, 0.20);
  });

  it("kein Cap für freie Mieten", () => {
    const result = applyMietWuGCap(0.15, "frei");
    assert.strictEqual(result, 0.15);
  });

  it("kein Cap wenn Mietrechtstyp null/unbekannt", () => {
    assert.strictEqual(applyMietWuGCap(0.10, null), 0.10);
    assert.strictEqual(applyMietWuGCap(0.10, undefined), 0.10);
  });

  it("behandelt negativen VPI-Anstieg korrekt (Cap halbiert auch Senkungen)", () => {
    // Rückgang: -10 % → Kategorie gibt nur -5 % weiter
    const result = applyMietWuGCap(-0.10, "kategorie");
    assert.strictEqual(result, -0.05);
  });
});

describe("Kombination: computeVpiPercentage → applyMietWuGCap → meetsSchwellenwert", () => {
  it("Kategoriemiete: 8 % Anstieg, 5 % Schwellenwert → nach Cap nur 4 % → unter Schwellenwert", () => {
    const raw = computeVpiPercentage(108, 100);        // 8 %
    const effective = applyMietWuGCap(raw, "kategorie"); // 4 %
    assert.strictEqual(meetsSchwellenwert(effective, 0.05), false); // 4 % < 5 % → kein Trigger
  });

  it("Kategoriemiete: 12 % Anstieg, 5 % Schwellenwert → nach Cap 6 % → über Schwellenwert", () => {
    const raw = computeVpiPercentage(112, 100);         // 12 %
    const effective = applyMietWuGCap(raw, "kategorie"); // 6 %
    assert.strictEqual(meetsSchwellenwert(effective, 0.05), true);  // 6 % > 5 % → Trigger
  });

  it("Richtwertmiete: 4 % Anstieg → kein Cap → unter 5 % Schwellenwert", () => {
    const raw = computeVpiPercentage(104, 100);         // 4 %
    const effective = applyMietWuGCap(raw, "richtwert"); // 4 % (kein Cap)
    assert.strictEqual(meetsSchwellenwert(effective, 0.05), false);
  });
});
