import { describe, it } from 'node:test';
import { expect } from '../helpers/expect';
import { roundMoney } from '../../shared/utils';

interface FifoInvoice {
  id: string;
  tenantId: string;
  year: number;
  month: number;
  gesamtbetrag: number;
  paidAmount: number;
  status: 'offen' | 'teilbezahlt' | 'bezahlt';
}

interface FifoAllocation {
  invoiceId: string;
  applied: number;
  newPaidAmount: number;
  newStatus: 'offen' | 'teilbezahlt' | 'bezahlt';
}

interface FifoResult {
  allocations: FifoAllocation[];
  totalApplied: number;
  unapplied: number;
}

function allocateFifo(invoices: FifoInvoice[], paymentAmount: number): FifoResult {
  const sorted = [...invoices].sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });

  let remaining = roundMoney(paymentAmount);
  const allocations: FifoAllocation[] = [];
  let totalApplied = 0;

  for (const inv of sorted) {
    if (remaining <= 0) break;

    const due = roundMoney(inv.gesamtbetrag - inv.paidAmount);
    if (due <= 0) continue;

    const apply = roundMoney(Math.min(remaining, due));
    const newPaidAmount = roundMoney(inv.paidAmount + apply);
    remaining = roundMoney(remaining - apply);
    totalApplied = roundMoney(totalApplied + apply);

    const newStatus: 'offen' | 'teilbezahlt' | 'bezahlt' =
      newPaidAmount >= inv.gesamtbetrag ? 'bezahlt' : newPaidAmount > 0 ? 'teilbezahlt' : 'offen';

    allocations.push({
      invoiceId: inv.id,
      applied: apply,
      newPaidAmount,
      newStatus,
    });
  }

  return {
    allocations,
    totalApplied,
    unapplied: roundMoney(remaining),
  };
}

describe('FIFO Multi-Invoice Payment Allocation', () => {
  it('single invoice fully paid', () => {
    const invoices: FifoInvoice[] = [
      { id: 'inv-1', tenantId: 't1', year: 2026, month: 1, gesamtbetrag: 925, paidAmount: 0, status: 'offen' },
    ];
    const result = allocateFifo(invoices, 925);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].applied).toBe(925);
    expect(result.allocations[0].newStatus).toBe('bezahlt');
    expect(result.unapplied).toBe(0);
  });

  it('single invoice partially paid', () => {
    const invoices: FifoInvoice[] = [
      { id: 'inv-1', tenantId: 't1', year: 2026, month: 1, gesamtbetrag: 925, paidAmount: 0, status: 'offen' },
    ];
    const result = allocateFifo(invoices, 500);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].applied).toBe(500);
    expect(result.allocations[0].newStatus).toBe('teilbezahlt');
    expect(result.allocations[0].newPaidAmount).toBe(500);
    expect(result.unapplied).toBe(0);
  });

  it('payment spans 2 invoices exactly', () => {
    const invoices: FifoInvoice[] = [
      { id: 'inv-1', tenantId: 't1', year: 2026, month: 1, gesamtbetrag: 500, paidAmount: 0, status: 'offen' },
      { id: 'inv-2', tenantId: 't1', year: 2026, month: 2, gesamtbetrag: 500, paidAmount: 0, status: 'offen' },
    ];
    const result = allocateFifo(invoices, 1000);
    expect(result.allocations).toHaveLength(2);
    expect(result.allocations[0].applied).toBe(500);
    expect(result.allocations[0].newStatus).toBe('bezahlt');
    expect(result.allocations[1].applied).toBe(500);
    expect(result.allocations[1].newStatus).toBe('bezahlt');
    expect(result.unapplied).toBe(0);
  });

  it('payment spans 3 invoices with remainder on 3rd', () => {
    const invoices: FifoInvoice[] = [
      { id: 'inv-1', tenantId: 't1', year: 2026, month: 1, gesamtbetrag: 300, paidAmount: 0, status: 'offen' },
      { id: 'inv-2', tenantId: 't1', year: 2026, month: 2, gesamtbetrag: 300, paidAmount: 0, status: 'offen' },
      { id: 'inv-3', tenantId: 't1', year: 2026, month: 3, gesamtbetrag: 300, paidAmount: 0, status: 'offen' },
    ];
    const result = allocateFifo(invoices, 750);
    expect(result.allocations).toHaveLength(3);
    expect(result.allocations[0].newStatus).toBe('bezahlt');
    expect(result.allocations[1].newStatus).toBe('bezahlt');
    expect(result.allocations[2].applied).toBe(150);
    expect(result.allocations[2].newStatus).toBe('teilbezahlt');
    expect(result.totalApplied).toBe(750);
    expect(result.unapplied).toBe(0);
  });

  it('overpayment beyond all invoices returns unapplied amount', () => {
    const invoices: FifoInvoice[] = [
      { id: 'inv-1', tenantId: 't1', year: 2026, month: 1, gesamtbetrag: 500, paidAmount: 0, status: 'offen' },
      { id: 'inv-2', tenantId: 't1', year: 2026, month: 2, gesamtbetrag: 300, paidAmount: 0, status: 'offen' },
    ];
    const result = allocateFifo(invoices, 1000);
    expect(result.totalApplied).toBe(800);
    expect(result.unapplied).toBe(200);
  });

  it('zero payment amount returns no allocations', () => {
    const invoices: FifoInvoice[] = [
      { id: 'inv-1', tenantId: 't1', year: 2026, month: 1, gesamtbetrag: 925, paidAmount: 0, status: 'offen' },
    ];
    const result = allocateFifo(invoices, 0);
    expect(result.allocations).toHaveLength(0);
    expect(result.totalApplied).toBe(0);
    expect(result.unapplied).toBe(0);
  });

  it('cross-year allocation (Dec 2025 -> Jan 2026 -> Feb 2026)', () => {
    const invoices: FifoInvoice[] = [
      { id: 'inv-feb', tenantId: 't1', year: 2026, month: 2, gesamtbetrag: 400, paidAmount: 0, status: 'offen' },
      { id: 'inv-dec', tenantId: 't1', year: 2025, month: 12, gesamtbetrag: 400, paidAmount: 0, status: 'offen' },
      { id: 'inv-jan', tenantId: 't1', year: 2026, month: 1, gesamtbetrag: 400, paidAmount: 0, status: 'offen' },
    ];
    const result = allocateFifo(invoices, 900);
    expect(result.allocations[0].invoiceId).toBe('inv-dec');
    expect(result.allocations[1].invoiceId).toBe('inv-jan');
    expect(result.allocations[2].invoiceId).toBe('inv-feb');
    expect(result.allocations[0].newStatus).toBe('bezahlt');
    expect(result.allocations[1].newStatus).toBe('bezahlt');
    expect(result.allocations[2].applied).toBe(100);
    expect(result.allocations[2].newStatus).toBe('teilbezahlt');
  });

  it('already partially paid invoice gets remaining', () => {
    const invoices: FifoInvoice[] = [
      { id: 'inv-1', tenantId: 't1', year: 2026, month: 1, gesamtbetrag: 925, paidAmount: 500, status: 'teilbezahlt' },
    ];
    const result = allocateFifo(invoices, 425);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].applied).toBe(425);
    expect(result.allocations[0].newPaidAmount).toBe(925);
    expect(result.allocations[0].newStatus).toBe('bezahlt');
    expect(result.unapplied).toBe(0);
  });

  it('multiple partial payments accumulate correctly', () => {
    const invoices: FifoInvoice[] = [
      { id: 'inv-1', tenantId: 't1', year: 2026, month: 1, gesamtbetrag: 900, paidAmount: 0, status: 'offen' },
    ];

    const r1 = allocateFifo(invoices, 300);
    expect(r1.allocations[0].newPaidAmount).toBe(300);

    invoices[0].paidAmount = 300;
    invoices[0].status = 'teilbezahlt';

    const r2 = allocateFifo(invoices, 300);
    expect(r2.allocations[0].newPaidAmount).toBe(600);

    invoices[0].paidAmount = 600;

    const r3 = allocateFifo(invoices, 300);
    expect(r3.allocations[0].newPaidAmount).toBe(900);
    expect(r3.allocations[0].newStatus).toBe('bezahlt');
  });

  it('invoices with zero balance are skipped', () => {
    const invoices: FifoInvoice[] = [
      { id: 'inv-1', tenantId: 't1', year: 2026, month: 1, gesamtbetrag: 500, paidAmount: 500, status: 'bezahlt' },
      { id: 'inv-2', tenantId: 't1', year: 2026, month: 2, gesamtbetrag: 500, paidAmount: 0, status: 'offen' },
    ];
    const result = allocateFifo(invoices, 300);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].invoiceId).toBe('inv-2');
    expect(result.allocations[0].applied).toBe(300);
  });
});
