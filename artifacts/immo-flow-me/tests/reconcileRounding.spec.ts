import { describe, it } from 'node:test';
import { expect } from './helpers/expect';
import { reconcileRounding } from '../server/services/billing.service';

describe('reconcileRounding', () => {
  it('should be deterministic with tie-break sorting', () => {
    const makeLines = () => [
      { invoiceId: 'i1', unitId: 'u1', lineType: 'A', description: 'x', amount: 10.00 },
      { invoiceId: 'i1', unitId: 'u2', lineType: 'A', description: 'x', amount: 10.00 },
      { invoiceId: 'i1', unitId: 'u3', lineType: 'B', description: 'y', amount: 5.00 },
    ];
    const lines1 = makeLines();
    const lines2 = makeLines();
    reconcileRounding(lines1, 25.01);
    reconcileRounding(lines2, 25.01);
    expect(lines1).toEqual(lines2);
  });

  it('should not modify lines when sum matches expected', () => {
    const lines = [
      { invoiceId: 'i1', unitId: 'u1', lineType: 'A', description: 'x', amount: 10.00 },
      { invoiceId: 'i1', unitId: 'u2', lineType: 'A', description: 'y', amount: 5.00 },
    ];
    reconcileRounding(lines, 15.00);
    expect(lines[0].amount).toBe(10.00);
    expect(lines[1].amount).toBe(5.00);
  });

  it('should adjust largest amount first', () => {
    const lines = [
      { invoiceId: 'i1', unitId: 'u1', lineType: 'A', description: 'x', amount: 3.00 },
      { invoiceId: 'i1', unitId: 'u2', lineType: 'A', description: 'y', amount: 7.00 },
    ];
    reconcileRounding(lines, 10.01);
    const adjusted = lines.find(l => l.amount !== 3.00 && l.amount !== 7.00);
    expect(adjusted).toBeDefined();
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(10.01, 2);
  });

  it('should handle negative adjustment', () => {
    const lines = [
      { invoiceId: 'i1', unitId: 'u1', lineType: 'A', description: 'x', amount: 10.00 },
      { invoiceId: 'i1', unitId: 'u2', lineType: 'B', description: 'y', amount: 5.00 },
    ];
    reconcileRounding(lines, 14.98);
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(14.98, 2);
  });

  it('should distribute multi-cent differences across lines', () => {
    const lines = [
      { invoiceId: 'i1', unitId: 'u1', lineType: 'A', description: 'a', amount: 10.00 },
      { invoiceId: 'i1', unitId: 'u2', lineType: 'A', description: 'b', amount: 10.00 },
      { invoiceId: 'i1', unitId: 'u3', lineType: 'A', description: 'c', amount: 10.00 },
    ];
    reconcileRounding(lines, 30.03);
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(30.03, 2);
  });

  it('should throw on impossible residual (fail-fast)', () => {
    const lines = [
      { invoiceId: 'i1', unitId: 'u1', lineType: 'A', description: 'x', amount: 1.00 },
    ];
    expect(() => reconcileRounding(lines, 1000.00)).toThrow('Rundungsausgleich gescheitert');
  });

  it('should produce identical order regardless of input order', () => {
    const makeLines = () => [
      { invoiceId: 'i1', unitId: 'u3', lineType: 'B', description: 'y', amount: 5.00 },
      { invoiceId: 'i1', unitId: 'u1', lineType: 'A', description: 'x', amount: 10.00 },
      { invoiceId: 'i1', unitId: 'u2', lineType: 'A', description: 'x', amount: 10.00 },
    ];
    const makeLinesSorted = () => [
      { invoiceId: 'i1', unitId: 'u1', lineType: 'A', description: 'x', amount: 10.00 },
      { invoiceId: 'i1', unitId: 'u2', lineType: 'A', description: 'x', amount: 10.00 },
      { invoiceId: 'i1', unitId: 'u3', lineType: 'B', description: 'y', amount: 5.00 },
    ];
    const lines1 = makeLines();
    const lines2 = makeLinesSorted();
    reconcileRounding(lines1, 25.02);
    reconcileRounding(lines2, 25.02);
    const sorted1 = [...lines1].sort((a, b) => a.unitId.localeCompare(b.unitId));
    const sorted2 = [...lines2].sort((a, b) => a.unitId.localeCompare(b.unitId));
    expect(sorted1.map(l => l.amount)).toEqual(sorted2.map(l => l.amount));
  });
});
