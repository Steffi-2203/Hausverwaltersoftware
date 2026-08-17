import { describe, it } from 'node:test';
import { expect } from '../../tests/helpers/expect';
import { HeatBillingService } from '../services/heatBillingService';
import type { HeatBillingInput } from '../services/heatBillingService';

const service = new HeatBillingService();

function makeInput(overrides?: Partial<HeatBillingInput>): HeatBillingInput {
  return {
    runId: 1,
    propertyId: 'prop-1',
    periodFrom: '2025-01-01',
    periodTo: '2025-12-31',
    totalCosts: {
      heatingSupply: 10000,
      hotWaterSupply: 5000,
      maintenance: 3000,
      meterReadingCost: 300,
    },
    config: {
      heatingConsumptionSharePct: 65,
      heatingAreaSharePct: 35,
      hotWaterConsumptionSharePct: 65,
      hotWaterAreaSharePct: 35,
      roundingMethod: 'kaufmaennisch',
      restCentRule: 'assign_to_largest_share',
    },
    units: [
      { unitId: 'u1', areaM2: 50, heatingMeter: { type: 'hkv', value: 100 }, hotWaterMeter: { value: 30 }, prepayment: 1500 },
      { unitId: 'u2', areaM2: 70, heatingMeter: { type: 'hkv', value: 150 }, hotWaterMeter: { value: 50 }, prepayment: 2000 },
      { unitId: 'u3', areaM2: 80, heatingMeter: { type: 'hkv', value: 200 }, hotWaterMeter: { value: 70 }, prepayment: 2500 },
    ],
    ...overrides,
  };
}

describe('HeatBillingService', () => {
  describe('Grundberechnung', () => {
    it('verteilt Heizkosten nach 65/35 Verbrauch/Fläche', () => {
      const input = makeInput();
      const result = service.compute(input);

      expect(result.lines).toHaveLength(3);

      const totalArea = 50 + 70 + 80;
      const totalConsumption = 100 + 150 + 200;
      const heatingConsumptionPool = 10000 * 0.65;
      const heatingAreaPool = 10000 * 0.35;

      const u1 = result.lines.find(l => l.unitId === 'u1')!;
      expect(u1.heatingConsumptionShare).toBeCloseTo(heatingConsumptionPool * (100 / totalConsumption), 1);
      expect(u1.heatingAreaShare).toBeCloseTo(heatingAreaPool * (50 / totalArea), 1);
    });

    it('verteilt Warmwasserkosten nach 65/35 Verbrauch/Fläche', () => {
      const input = makeInput();
      const result = service.compute(input);

      const totalArea = 50 + 70 + 80;
      const totalHotWater = 30 + 50 + 70;
      const hwConsumptionPool = 5000 * 0.65;
      const hwAreaPool = 5000 * 0.35;

      const u2 = result.lines.find(l => l.unitId === 'u2')!;
      expect(u2.hotWaterConsumptionShare).toBeCloseTo(hwConsumptionPool * (50 / totalHotWater), 1);
      expect(u2.hotWaterAreaShare).toBeCloseTo(hwAreaPool * (70 / totalArea), 1);
    });

    it('verteilt Instandhaltung nach Fläche', () => {
      const input = makeInput();
      const result = service.compute(input);

      const totalArea = 50 + 70 + 80;
      const u3 = result.lines.find(l => l.unitId === 'u3')!;
      expect(u3.maintenanceShare).toBeCloseTo(3000 * (80 / totalArea), 1);
    });

    it('verteilt Ablesungskosten gleichmäßig', () => {
      const input = makeInput();
      const result = service.compute(input);

      result.lines.forEach(line => {
        expect(line.meterReadingShare).toBeCloseTo(300 / 3, 2);
      });
    });
  });

  describe('Probebilanz', () => {
    it('Summe aller Zeilenkosten entspricht den Gesamtkosten', () => {
      const input = makeInput();
      const result = service.compute(input);

      const totalInputCosts = 10000 + 5000 + 3000 + 300;
      expect(result.summary.trialBalanceOk).toBe(true);
      expect(Math.abs(result.summary.totalDistributed - totalInputCosts)).toBeLessThanOrEqual(0.01);
    });
  });

  describe('Rundung & Restcent', () => {
    it('Kaufmännische Rundung – Restcent an größten Anteil', () => {
      const input = makeInput({
        totalCosts: {
          heatingSupply: 1000,
          hotWaterSupply: 0,
          maintenance: 0,
          meterReadingCost: 0,
        },
        units: [
          { unitId: 'u1', areaM2: 33, heatingMeter: { type: 'hkv', value: 100 }, prepayment: 0 },
          { unitId: 'u2', areaM2: 33, heatingMeter: { type: 'hkv', value: 100 }, prepayment: 0 },
          { unitId: 'u3', areaM2: 34, heatingMeter: { type: 'hkv', value: 100 }, prepayment: 0 },
        ],
      });

      const result = service.compute(input);
      expect(result.summary.trialBalanceOk).toBe(true);
      expect(Math.abs(result.summary.totalDistributed - 1000)).toBeLessThanOrEqual(0.01);
    });

    it('Restcent an kleinsten Anteil', () => {
      const input = makeInput({
        totalCosts: {
          heatingSupply: 1000,
          hotWaterSupply: 0,
          maintenance: 0,
          meterReadingCost: 0,
        },
        config: {
          heatingConsumptionSharePct: 65,
          heatingAreaSharePct: 35,
          hotWaterConsumptionSharePct: 65,
          hotWaterAreaSharePct: 35,
          roundingMethod: 'kaufmaennisch',
          restCentRule: 'assign_to_smallest_share',
        },
        units: [
          { unitId: 'u1', areaM2: 33, heatingMeter: { type: 'hkv', value: 100 }, prepayment: 0 },
          { unitId: 'u2', areaM2: 33, heatingMeter: { type: 'hkv', value: 100 }, prepayment: 0 },
          { unitId: 'u3', areaM2: 34, heatingMeter: { type: 'hkv', value: 100 }, prepayment: 0 },
        ],
      });

      const result = service.compute(input);
      expect(result.summary.trialBalanceOk).toBe(true);

      const hasRestcentWarning = result.warnings.some(w => w.includes('kleinster Anteil'));
      if (Math.abs(result.summary.totalDistributed - 1000) > 0.001) {
        expect(hasRestcentWarning).toBe(true);
      }
    });
  });

  describe('Ersatzverteilung (§12)', () => {
    it('eine Einheit ohne Heizungszähler bekommt Flächenverteilung', () => {
      const input = makeInput({
        units: [
          { unitId: 'u1', areaM2: 50, heatingMeter: { type: 'hkv', value: 100 }, hotWaterMeter: { value: 30 }, prepayment: 1500 },
          { unitId: 'u2', areaM2: 70, heatingMeter: null, hotWaterMeter: { value: 50 }, prepayment: 2000 },
          { unitId: 'u3', areaM2: 80, heatingMeter: { type: 'hkv', value: 200 }, hotWaterMeter: { value: 70 }, prepayment: 2500 },
        ],
      });

      const result = service.compute(input);
      const u2 = result.lines.find(l => l.unitId === 'u2')!;

      expect(u2.isEstimated).toBe(true);
      expect(u2.estimationReason).toContain('Ersatzverteilung');
      expect(u2.heatingMeterMissing).toBe(true);
    });

    it('alle Einheiten ohne Zähler erhalten Flächenverteilung', () => {
      const input = makeInput({
        units: [
          { unitId: 'u1', areaM2: 50, heatingMeter: null, hotWaterMeter: null, prepayment: 1500 },
          { unitId: 'u2', areaM2: 70, heatingMeter: null, hotWaterMeter: null, prepayment: 2000 },
          { unitId: 'u3', areaM2: 80, heatingMeter: null, hotWaterMeter: null, prepayment: 2500 },
        ],
      });

      const result = service.compute(input);

      result.lines.forEach(line => {
        expect(line.isEstimated).toBe(true);
        expect(line.heatingMeterMissing).toBe(true);
        expect(line.hotWaterMeterMissing).toBe(true);
      });

      expect(result.summary.trialBalanceOk).toBe(true);
    });
  });

  describe('Compliance-Checks', () => {
    it('§8 HeizKG – 55% Verbrauchsanteil ist konform', () => {
      const input = makeInput({
        config: {
          heatingConsumptionSharePct: 55,
          heatingAreaSharePct: 45,
          hotWaterConsumptionSharePct: 55,
          hotWaterAreaSharePct: 45,
          roundingMethod: 'kaufmaennisch',
          restCentRule: 'assign_to_largest_share',
        },
      });

      const result = service.compute(input);
      const para8 = result.complianceCheck.checks.find(c => c.paragraph === '§8 HeizKG');
      expect(para8?.status).toBe('ok');
    });

    it('§8 HeizKG – 65% Verbrauchsanteil ist konform', () => {
      const input = makeInput({
        config: {
          heatingConsumptionSharePct: 65,
          heatingAreaSharePct: 35,
          hotWaterConsumptionSharePct: 65,
          hotWaterAreaSharePct: 35,
          roundingMethod: 'kaufmaennisch',
          restCentRule: 'assign_to_largest_share',
        },
      });

      const result = service.compute(input);
      const para8 = result.complianceCheck.checks.find(c => c.paragraph === '§8 HeizKG');
      expect(para8?.status).toBe('ok');
    });

    it('§8 HeizKG – 50% Verbrauchsanteil ist nicht konform', () => {
      const input = makeInput({
        config: {
          heatingConsumptionSharePct: 50,
          heatingAreaSharePct: 50,
          hotWaterConsumptionSharePct: 50,
          hotWaterAreaSharePct: 50,
          roundingMethod: 'kaufmaennisch',
          restCentRule: 'assign_to_largest_share',
        },
      });

      const result = service.compute(input);
      const para8 = result.complianceCheck.checks.find(c => c.paragraph === '§8 HeizKG');
      expect(para8?.status).toBe('fehler');
    });

    it('§8 HeizKG – 70% Verbrauchsanteil ist nicht konform', () => {
      const input = makeInput({
        config: {
          heatingConsumptionSharePct: 70,
          heatingAreaSharePct: 30,
          hotWaterConsumptionSharePct: 70,
          hotWaterAreaSharePct: 30,
          roundingMethod: 'kaufmaennisch',
          restCentRule: 'assign_to_largest_share',
        },
      });

      const result = service.compute(input);
      const para8 = result.complianceCheck.checks.find(c => c.paragraph === '§8 HeizKG');
      expect(para8?.status).toBe('fehler');
    });

    it('alle Compliance-Checks bestehen bei gültiger Konfiguration', () => {
      const input = makeInput();
      const result = service.compute(input);

      expect(result.complianceCheck.passed).toBe(true);
      result.complianceCheck.checks.forEach(check => {
        expect(check.status).not.toBe('fehler');
      });
    });

    it('§9 HeizKG – Abrechnungszeitraum über 12 Monate ist nicht konform', () => {
      const input = makeInput({
        periodFrom: '2024-01-01',
        periodTo: '2025-02-01',
      });

      const result = service.compute(input);
      const para9 = result.complianceCheck.checks.find(c => c.paragraph === '§9 HeizKG');
      expect(para9?.status).toBe('fehler');
      expect(para9?.details).toContain('13');
    });
  });

  describe('Plausibilität', () => {
    it('extremer Verbrauch erzeugt Plausibilitäts-Flag', () => {
      const input = makeInput({
        units: [
          { unitId: 'u1', areaM2: 50, heatingMeter: { type: 'hkv', value: 100 }, hotWaterMeter: { value: 30 }, prepayment: 1500 },
          { unitId: 'u2', areaM2: 70, heatingMeter: { type: 'hkv', value: 100 }, hotWaterMeter: { value: 50 }, prepayment: 2000 },
          { unitId: 'u3', areaM2: 80, heatingMeter: { type: 'hkv', value: 5000 }, hotWaterMeter: { value: 70 }, prepayment: 2500 },
        ],
      });

      const result = service.compute(input);
      const u3 = result.lines.find(l => l.unitId === 'u3')!;
      expect(u3.plausibilityFlags.length).toBeGreaterThan(0);
      expect(u3.plausibilityFlags.some(f => f.type === 'heizung_hoch')).toBe(true);
    });
  });

  describe('Randfälle', () => {
    it('einzelne Einheit erhält 100% aller Kosten', () => {
      const input = makeInput({
        units: [
          { unitId: 'u1', areaM2: 100, heatingMeter: { type: 'hkv', value: 500 }, hotWaterMeter: { value: 200 }, prepayment: 5000 },
        ],
      });

      const result = service.compute(input);
      expect(result.lines).toHaveLength(1);

      const totalInputCosts = 10000 + 5000 + 3000 + 300;
      expect(result.lines[0].totalCost).toBeCloseTo(totalInputCosts, 1);
      expect(result.summary.trialBalanceOk).toBe(true);
    });

    it('nur Warmwasserkosten ohne Heizkosten', () => {
      const input = makeInput({
        totalCosts: {
          heatingSupply: 0,
          hotWaterSupply: 5000,
          maintenance: 0,
          meterReadingCost: 0,
        },
      });

      const result = service.compute(input);

      result.lines.forEach(line => {
        expect(line.heatingConsumptionShare).toBe(0);
        expect(line.heatingAreaShare).toBe(0);
        expect(line.heatingTotal).toBe(0);
        expect(line.hotWaterTotal).toBeGreaterThan(0);
      });

      expect(result.summary.totalDistributed).toBeCloseTo(5000, 1);
    });

    it('alle Zählerstände sind 0 – Ersatzverteilung greift', () => {
      const input = makeInput({
        units: [
          { unitId: 'u1', areaM2: 50, heatingMeter: { type: 'hkv', value: 0 }, hotWaterMeter: { value: 0 }, prepayment: 1500 },
          { unitId: 'u2', areaM2: 70, heatingMeter: { type: 'hkv', value: 0 }, hotWaterMeter: { value: 0 }, prepayment: 2000 },
          { unitId: 'u3', areaM2: 80, heatingMeter: { type: 'hkv', value: 0 }, hotWaterMeter: { value: 0 }, prepayment: 2500 },
        ],
      });

      const result = service.compute(input);

      result.lines.forEach(line => {
        expect(line.isEstimated).toBe(true);
        expect(line.heatingMeterMissing).toBe(true);
        expect(line.hotWaterMeterMissing).toBe(true);
      });

      expect(result.summary.trialBalanceOk).toBe(true);
    });

    it('Stresstest mit 10+ Einheiten – Probebilanz stimmt', () => {
      const units = Array.from({ length: 12 }, (_, i) => ({
        unitId: `u${i + 1}`,
        areaM2: 40 + i * 5,
        heatingMeter: { type: 'hkv' as const, value: 50 + i * 20 },
        hotWaterMeter: { value: 10 + i * 5 },
        prepayment: 1000 + i * 100,
      }));

      const input = makeInput({ units });
      const result = service.compute(input);

      expect(result.lines).toHaveLength(12);
      expect(result.summary.trialBalanceOk).toBe(true);

      const totalInputCosts = 10000 + 5000 + 3000 + 300;
      expect(Math.abs(result.summary.totalDistributed - totalInputCosts)).toBeLessThanOrEqual(0.01);
    });
  });
});
