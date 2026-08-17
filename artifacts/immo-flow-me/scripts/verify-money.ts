/**
 * Verifikations-Harness (ohne externe Dependencies lauffähig):
 *   node --experimental-strip-types scripts/verify-money.ts
 * Prüft money.ts und den auf Cent-Arithmetik umgestellten HeatBillingService.
 */
import { toCents, fromCents, roundEuro, sumCents, distributeCents, shareOfCents } from "../server/lib/money";
import { HeatBillingService } from "../server/services/heatBillingService";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(`FAIL ${name}: erwartet ${JSON.stringify(expected)}, erhalten ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// ===== money.ts =====
check("toCents(1.005) — klassischer Float-Bug", toCents(1.005), 101);
check("Math.round-Vergleich (alter Bug)", Math.round(1.005 * 100) / 100, 1.0); // beweist den alten Fehler
check("toCents('19,90') mit Komma", toCents("19,90"), 1990);
check("toCents(-0.005) kaufmännisch", toCents(-0.005), -1);
check("roundEuro(2.675)", roundEuro(2.675), 2.68);
check("fromCents(101)", fromCents(101), 1.01);
check("sumCents exakt", sumCents([10, 20, 3]), 33);
check("0.1+0.2 über Cents", fromCents(sumCents([toCents(0.1), toCents(0.2)])), 0.3);
check("shareOfCents halbe Cents", shareOfCents(1001, 0.5), 501); // 500.5 → 501
check("distributeCents Summe exakt", sumCents(distributeCents(10000, [1, 1, 1])), 10000);
check("distributeCents 100/3", distributeCents(100, [1, 1, 1]), [34, 33, 33]);

// ===== HeatBillingService =====
const svc = new HeatBillingService();

// Szenario mit Restcent-Zwang: 1000 EUR auf 3 Einheiten, 60/40-Split
const input = {
  runId: 1,
  propertyId: "p1",
  periodFrom: "2025-01-01",
  periodTo: "2025-12-31",
  totalCosts: { heatingSupply: 1000, hotWaterSupply: 300, maintenance: 100.01, meterReadingCost: 50 },
  config: {
    heatingConsumptionSharePct: 60,
    heatingAreaSharePct: 40,
    hotWaterConsumptionSharePct: 60,
    hotWaterAreaSharePct: 40,
    roundingMethod: "kaufmaennisch" as const,
    restCentRule: "assign_to_largest_share" as const,
  },
  units: [
    { unitId: "A", areaM2: 55.5, heatingMeter: { type: "hkv" as const, value: 120 }, hotWaterMeter: { value: 30 }, prepayment: 400 },
    { unitId: "B", areaM2: 71.3, heatingMeter: { type: "hkv" as const, value: 95 }, hotWaterMeter: { value: 45 }, prepayment: 500 },
    { unitId: "C", areaM2: 33.3, heatingMeter: null, hotWaterMeter: null, prepayment: 300 }, // §12 Ersatzverteilung
  ],
};

const result = svc.compute(input as any);

check("Saldenprüfung: verteilt == Gesamtkosten", result.summary.totalDistributed, result.summary.totalCosts);
check("trialBalanceOk", result.summary.trialBalanceOk, true);
check("trialBalanceDiff == 0", result.summary.trialBalanceDiff, 0);
check("Gesamtkosten exakt", result.summary.totalCosts, 1450.01);

// Zeilensumme muss exakt der Gesamtsumme entsprechen (in Cents, kein Float-Drift)
const lineSumCents = sumCents(result.lines.map((l: any) => toCents(l.totalCost)));
check("Zeilensumme (Cents) == Gesamtkosten (Cents)", lineSumCents, toCents(1450.01));

// Balance-Konsistenz je Zeile: balance == totalCost - prepayment (centgenau)
for (const l of result.lines) {
  check(`Balance ${l.unitId}`, toCents(l.balance), toCents(l.totalCost) - toCents(l.prepayment));
}

// Ersatzverteilung markiert
check("Einheit C ist geschätzt (§12)", result.lines[2].isEstimated, true);

// Stresstest: 250 Einheiten mit krummen Flächen — Summe muss trotzdem exakt aufgehen
const bigUnits = Array.from({ length: 250 }, (_, i) => ({
  unitId: `U${i}`,
  areaM2: 30 + (i % 17) * 3.33,
  heatingMeter: i % 5 === 0 ? null : { type: "hkv" as const, value: 50 + (i % 23) * 7.77 },
  hotWaterMeter: i % 7 === 0 ? null : { value: 10 + (i % 11) * 2.21 },
  prepayment: 100 + i,
}));
const big = svc.compute({ ...input, units: bigUnits } as any);
check("Stresstest 250 Einheiten: Saldo exakt", big.summary.trialBalanceDiff, 0);
check(
  "Stresstest: Zeilensumme exakt",
  sumCents(big.lines.map((l: any) => toCents(l.totalCost))),
  toCents(big.summary.totalCosts),
);

if (failures > 0) {
  console.error(`\n${failures} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log("\nAlle Prüfungen bestanden ✔");
