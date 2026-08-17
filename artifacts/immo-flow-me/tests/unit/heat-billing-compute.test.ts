/**
 * HeizKG-Abrechnung — HeatBillingService.compute()
 *
 * Testet die Produktionsfunktion HeatBillingService.compute() aus heatBillingService.ts
 * mit durchgerechneten Zahlenbeispielen.
 *
 * Kernprüfungen:
 * 1. Summe der verteilten Heizkosten == Gesamtbetrag (cent-exakt)
 * 2. §8 HeizKG: Aufteilung 60/40 (Verbrauch/Fläche) korrekt berechnet
 * 3. Einheit ohne Messgerät → Ersatzverteilung nach Fläche + §12-Warnung
 * 4. §8-Verletzung (70/30 statt 55-65/35-45) → Compliance-Check meldet Fehler
 * 5. Restcent-Korrektur: trialBalance nach Korrektur = 0
 */
import { describe, it } from 'node:test';
import { expect } from '../helpers/expect';
import { HeatBillingService, type HeatBillingInput } from '../../server/services/heatBillingService';

const service = new HeatBillingService();

function makeInput(overrides: Partial<HeatBillingInput> = {}): HeatBillingInput {
  return {
    runId: 1,
    propertyId: 'test-prop',
    periodFrom: '2025-01-01',
    periodTo: '2025-12-31',
    totalCosts: {
      heatingSupply: 1000,
      hotWaterSupply: 0,
      maintenance: 0,
      meterReadingCost: 0,
    },
    config: {
      heatingConsumptionSharePct: 60,
      heatingAreaSharePct: 40,
      hotWaterConsumptionSharePct: 60,
      hotWaterAreaSharePct: 40,
      roundingMethod: 'kaufmaennisch',
      restCentRule: 'assign_to_largest_share',
    },
    units: [
      {
        unitId: 'E1',
        areaM2: 60,
        heatingMeter: { type: 'hkv', value: 600 },
        prepayment: 0,
      },
      {
        unitId: 'E2',
        areaM2: 40,
        heatingMeter: { type: 'hkv', value: 400 },
        prepayment: 0,
      },
    ],
    ...overrides,
  };
}

describe('HeatBillingService.compute() — §8 HeizKG Grundverteilung', () => {
  it('Summe der verteilten Heizkosten == Gesamtkosten (cent-exakt, trialBalance = 0)', () => {
    const result = service.compute(makeInput());
    // Hauptprüfung: keine Cent-Differenz
    expect(result.summary.trialBalanceOk).toBe(true);
    expect(Math.abs(result.summary.trialBalanceDiff)).toBeLessThanOrEqual(0.01);
    // Gesamtkosten korrekt
    expect(result.summary.totalCosts).toBe(1000);
    // Verteilte Summe == Gesamtkosten
    expect(result.summary.totalDistributed).toBeCloseTo(1000, 1);
  });

  it('§8 HeizKG 60/40 Aufteilung: 2 Einheiten, E1=60% Verbrauch, E2=40% Verbrauch', () => {
    // Heizkosten 1.000 €, 60% Verbrauchspool = 600 €, 40% Flächenpool = 400 €
    // E1: areaM2=60, E2: areaM2=40 → Gesamt 100m²
    // E1 Verbrauch (60 HKV von 1000): 600 × 60/100 = 360 €
    // E1 Fläche: 400 × 60/100 = 240 €
    // E1 Gesamt: 360 + 240 = 600 €
    // E2 Verbrauch (40 HKV): 600 × 40/100 = 240 €
    // E2 Fläche: 400 × 40/100 = 160 €
    // E2 Gesamt: 240 + 160 = 400 €
    // Summe: 600 + 400 = 1.000 € ✓
    const result = service.compute(makeInput());
    const e1 = result.lines.find(l => l.unitId === 'E1')!;
    const e2 = result.lines.find(l => l.unitId === 'E2')!;

    expect(e1).toBeDefined();
    expect(e2).toBeDefined();
    expect(e1.totalCost).toBeCloseTo(600, 1);
    expect(e2.totalCost).toBeCloseTo(400, 1);
    expect(e1.totalCost + e2.totalCost).toBeCloseTo(1000, 1);
  });

  it('§8 HeizKG Compliance-Check: 60/40 ist konform', () => {
    const result = service.compute(makeInput());
    const check8 = result.complianceCheck.checks.find(c => c.paragraph === '§8 HeizKG');
    expect(check8).toBeDefined();
    expect(check8!.status).toBe('ok');
  });
});

describe('HeatBillingService.compute() — §12 HeizKG Ersatzverteilung', () => {
  it('Einheit ohne Messgerät → Ersatzverteilung nach Fläche + Warnung + isEstimated=true', () => {
    const input = makeInput({
      units: [
        { unitId: 'E1', areaM2: 60, heatingMeter: { type: 'hkv', value: 600 }, prepayment: 0 },
        { unitId: 'E2', areaM2: 40, heatingMeter: null, prepayment: 0 }, // Kein Messgerät
      ],
    });
    const result = service.compute(input);
    const e2 = result.lines.find(l => l.unitId === 'E2')!;

    expect(e2.isEstimated).toBe(true);
    expect(e2.heatingMeterMissing).toBe(true);
    expect(result.warnings.some(w => w.includes('E2') && w.includes('§12'))).toBe(true);
    // §12-Compliance: warnung (aber ok, da dokumentiert)
    const check12 = result.complianceCheck.checks.find(c => c.paragraph === '§12 HeizKG');
    expect(check12).toBeDefined();
    expect(check12!.status).not.toBe('fehler');
    // Summe trotzdem cent-exakt
    expect(result.summary.trialBalanceOk).toBe(true);
  });
});

describe('HeatBillingService.compute() — §8 HeizKG Compliance-Fehler', () => {
  it('Aufteilung 70/30 (außerhalb 55–65/35–45) → §8 Compliance-Check = fehler', () => {
    const input = makeInput({
      config: {
        heatingConsumptionSharePct: 70,  // Zu hoch (max 65%)
        heatingAreaSharePct: 30,          // Zu niedrig (min 35%)
        hotWaterConsumptionSharePct: 60,
        hotWaterAreaSharePct: 40,
        roundingMethod: 'kaufmaennisch',
        restCentRule: 'assign_to_largest_share',
      },
    });
    const result = service.compute(input);
    const check8 = result.complianceCheck.checks.find(c => c.paragraph === '§8 HeizKG');
    expect(check8).toBeDefined();
    expect(check8!.status).toBe('fehler');
    expect(result.complianceCheck.passed).toBe(false);
  });
});

describe('HeatBillingService.compute() — Restcent-Korrektur komponentenweise', () => {
  it('Heiz- und Warmwasserkosten: Restcent wird getrennt dem richtigen Pool zugeordnet', () => {
    // 3 Einheiten, unterschiedliche Messgeräte → Rundungsdifferenzen in beiden Pools
    // Nach Korrektur muss trialBalance = 0 sein
    const input = makeInput({
      totalCosts: { heatingSupply: 100.01, hotWaterSupply: 50.01, maintenance: 0, meterReadingCost: 0 },
      units: [
        { unitId: 'E1', areaM2: 50, heatingMeter: { type: 'hkv', value: 333 }, hotWaterMeter: { value: 200 }, prepayment: 0 },
        { unitId: 'E2', areaM2: 30, heatingMeter: { type: 'hkv', value: 333 }, hotWaterMeter: { value: 200 }, prepayment: 0 },
        { unitId: 'E3', areaM2: 20, heatingMeter: { type: 'hkv', value: 334 }, hotWaterMeter: { value: 100 }, prepayment: 0 },
      ],
    });
    const result = service.compute(input);
    expect(result.summary.trialBalanceOk).toBe(true);
    // Gesamtverteilung == Gesamtkosten
    expect(result.summary.totalDistributed).toBeCloseTo(150.02, 1);
  });

  it('Warmwasser-Restcent landet in hotWaterConsumptionShare, NICHT in heatingConsumptionShare', () => {
    // 3 gleiche Einheiten (Verbrauch 1/3 jede), Flächen 33/33/34 m²
    // heatingSupply=10.01, hotWaterSupply=10.01:
    //   heatingConsumptionPool ≈ 6.006 → je Einheit ≈ 2.00 → Summe 6.00 → 1 Cent Rest
    //   heatingAreaPool        ≈ 4.004 → E1/E2: 1.32, E3: 1.36 → Summe 4.00 → 1 Cent Rest
    //   Analog für Warmwasser.
    //
    // restCentRule='assign_to_largest_share' → Zieleinheit = E3 (größtes totalCost).
    // Erwartet NACH Korrektur:
    //   E3.heatingConsumptionShare = 2.01  (Heizungs-Restcent)
    //   E3.heatingTotal            = 3.37  (2.01 + 1.36)
    //   E3.hotWaterConsumptionShare = 2.01 (Warmwasser-Restcent)
    //   E3.hotWaterTotal            = 3.37 (2.01 + 1.36)
    //   summary.totalHeatingDistributed  = 10.01 (exakt)
    //   summary.totalHotWaterDistributed = 10.01 (exakt)
    const input = makeInput({
      totalCosts: { heatingSupply: 10.01, hotWaterSupply: 10.01, maintenance: 0, meterReadingCost: 0 },
      config: {
        heatingConsumptionSharePct: 60,
        heatingAreaSharePct: 40,
        hotWaterConsumptionSharePct: 60,
        hotWaterAreaSharePct: 40,
        roundingMethod: 'kaufmaennisch',
        restCentRule: 'assign_to_largest_share',
      },
      units: [
        { unitId: 'E1', areaM2: 33, heatingMeter: { type: 'hkv', value: 100 }, hotWaterMeter: { value: 100 }, prepayment: 0 },
        { unitId: 'E2', areaM2: 33, heatingMeter: { type: 'hkv', value: 100 }, hotWaterMeter: { value: 100 }, prepayment: 0 },
        { unitId: 'E3', areaM2: 34, heatingMeter: { type: 'hkv', value: 100 }, hotWaterMeter: { value: 100 }, prepayment: 0 },
      ],
    });
    const result = service.compute(input);
    const e3 = result.lines.find(l => l.unitId === 'E3')!;

    // Kernprüfung: Komponenten-Trennung — Warmwasser-Restcent darf nicht in heatingConsumptionShare landen
    expect(e3.heatingConsumptionShare).toBe(2.01);   // +0.01 Heizungs-Restcent
    expect(e3.heatingTotal).toBe(3.37);              // 2.01 + 1.36
    expect(e3.hotWaterConsumptionShare).toBe(2.01);  // +0.01 Warmwasser-Restcent
    expect(e3.hotWaterTotal).toBe(3.37);             // 2.01 + 1.36

    // Pool-Summen exakt (nach Restcent-Korrektur)
    expect(result.summary.totalHeatingDistributed).toBe(10.01);
    expect(result.summary.totalHotWaterDistributed).toBe(10.01);
    expect(result.summary.totalDistributed).toBe(20.02);
    expect(result.summary.trialBalanceOk).toBe(true);
    expect(result.summary.trialBalanceDiff).toBe(0);
  });
});
