import { describe, it } from 'node:test';
import { expect } from '../helpers/expect';
import { roundMoney } from '../../shared/utils';

interface LedgerEntry {
  id: string;
  amount: number;
  type: 'payment' | 'storno';
  relatedPaymentId?: string;
}

interface StornoResult {
  success: boolean;
  error?: string;
  stornoEntry?: LedgerEntry;
  remainingPaymentAmount: number;
}

interface Allocation {
  invoiceId: string;
  amount: number;
}

interface ReverseResult {
  reversedAllocations: Array<{ invoiceId: string; reversedAmount: number }>;
  totalReversed: number;
  remainingStorno: number;
}

function processStorno(
  originalPayment: { id: string; amount: number; stornoedAmount: number },
  stornoAmount: number
): StornoResult {
  if (stornoAmount <= 0) {
    return { success: false, error: 'Storno-Betrag muss positiv sein', remainingPaymentAmount: originalPayment.amount - originalPayment.stornoedAmount };
  }
  const available = roundMoney(originalPayment.amount - originalPayment.stornoedAmount);
  if (roundMoney(stornoAmount) > available) {
    return { success: false, error: 'Storno-Betrag übersteigt verfügbaren Betrag', remainingPaymentAmount: available };
  }
  const stornoEntry: LedgerEntry = {
    id: `storno-${originalPayment.id}-${Date.now()}`,
    amount: roundMoney(-stornoAmount),
    type: 'storno',
    relatedPaymentId: originalPayment.id,
  };
  return {
    success: true,
    stornoEntry,
    remainingPaymentAmount: roundMoney(available - stornoAmount),
  };
}

function calculateLedgerBalance(entries: LedgerEntry[]): number {
  return roundMoney(entries.reduce((sum, e) => sum + e.amount, 0));
}

function reverseAllocation(allocations: Allocation[], stornoAmount: number): ReverseResult {
  const reversed: Array<{ invoiceId: string; reversedAmount: number }> = [];
  let remaining = roundMoney(stornoAmount);
  let totalReversed = 0;

  const lifoOrder = [...allocations].reverse();

  for (const alloc of lifoOrder) {
    if (remaining <= 0) break;
    const reverseAmt = roundMoney(Math.min(remaining, alloc.amount));
    reversed.push({ invoiceId: alloc.invoiceId, reversedAmount: reverseAmt });
    remaining = roundMoney(remaining - reverseAmt);
    totalReversed = roundMoney(totalReversed + reverseAmt);
  }

  return { reversedAllocations: reversed, totalReversed, remainingStorno: remaining };
}

describe('Payment Storno (Cancellation/Reversal)', () => {
  it('full storno reverses entire payment', () => {
    const payment = { id: 'p1', amount: 925, stornoedAmount: 0 };
    const result = processStorno(payment, 925);
    expect(result.success).toBe(true);
    expect(result.stornoEntry!.amount).toBe(-925);
    expect(result.remainingPaymentAmount).toBe(0);
  });

  it('partial storno reverses partial amount', () => {
    const payment = { id: 'p1', amount: 925, stornoedAmount: 0 };
    const result = processStorno(payment, 400);
    expect(result.success).toBe(true);
    expect(result.stornoEntry!.amount).toBe(-400);
    expect(result.remainingPaymentAmount).toBe(525);
  });

  it('storno amount cannot exceed original payment', () => {
    const payment = { id: 'p1', amount: 925, stornoedAmount: 0 };
    const result = processStorno(payment, 1000);
    expect(result.success).toBe(false);
    expect(result.error).toContain('übersteigt');
  });

  it('ledger balance after full storno is zero', () => {
    const entries: LedgerEntry[] = [
      { id: 'p1', amount: 925, type: 'payment' },
      { id: 's1', amount: -925, type: 'storno', relatedPaymentId: 'p1' },
    ];
    expect(calculateLedgerBalance(entries)).toBe(0);
  });

  it('ledger balance after partial storno is correct', () => {
    const entries: LedgerEntry[] = [
      { id: 'p1', amount: 925, type: 'payment' },
      { id: 's1', amount: -400, type: 'storno', relatedPaymentId: 'p1' },
    ];
    expect(calculateLedgerBalance(entries)).toBe(525);
  });

  it('multiple stornos on same payment accumulate', () => {
    const payment = { id: 'p1', amount: 925, stornoedAmount: 0 };
    const r1 = processStorno(payment, 300);
    expect(r1.success).toBe(true);
    payment.stornoedAmount = 300;

    const r2 = processStorno(payment, 300);
    expect(r2.success).toBe(true);
    payment.stornoedAmount = 600;

    const r3 = processStorno(payment, 400);
    expect(r3.success).toBe(false);

    const r4 = processStorno(payment, 325);
    expect(r4.success).toBe(true);
    expect(r4.remainingPaymentAmount).toBe(0);
  });

  it('storno creates negative ledger entry', () => {
    const payment = { id: 'p1', amount: 500, stornoedAmount: 0 };
    const result = processStorno(payment, 200);
    expect(result.success).toBe(true);
    expect(result.stornoEntry!.amount).toBeLessThan(0);
    expect(result.stornoEntry!.type).toBe('storno');
  });

  it('reverse allocation LIFO: last invoice allocation reversed first', () => {
    const allocations: Allocation[] = [
      { invoiceId: 'inv-1', amount: 300 },
      { invoiceId: 'inv-2', amount: 300 },
      { invoiceId: 'inv-3', amount: 300 },
    ];
    const result = reverseAllocation(allocations, 300);
    expect(result.reversedAllocations).toHaveLength(1);
    expect(result.reversedAllocations[0].invoiceId).toBe('inv-3');
    expect(result.reversedAllocations[0].reversedAmount).toBe(300);
  });

  it('reverse allocation with 3 invoices partially', () => {
    const allocations: Allocation[] = [
      { invoiceId: 'inv-1', amount: 300 },
      { invoiceId: 'inv-2', amount: 300 },
      { invoiceId: 'inv-3', amount: 300 },
    ];
    const result = reverseAllocation(allocations, 500);
    expect(result.reversedAllocations).toHaveLength(2);
    expect(result.reversedAllocations[0].invoiceId).toBe('inv-3');
    expect(result.reversedAllocations[0].reversedAmount).toBe(300);
    expect(result.reversedAllocations[1].invoiceId).toBe('inv-2');
    expect(result.reversedAllocations[1].reversedAmount).toBe(200);
    expect(result.totalReversed).toBe(500);
  });

  it('storno on already partially stornoed payment', () => {
    const payment = { id: 'p1', amount: 1000, stornoedAmount: 600 };
    const result = processStorno(payment, 400);
    expect(result.success).toBe(true);
    expect(result.remainingPaymentAmount).toBe(0);
  });

  it('zero storno amount returns error', () => {
    const payment = { id: 'p1', amount: 500, stornoedAmount: 0 };
    const result = processStorno(payment, 0);
    expect(result.success).toBe(false);
    expect(result.error).toContain('positiv');
  });

  it('negative storno amount is rejected', () => {
    const payment = { id: 'p1', amount: 500, stornoedAmount: 0 };
    const result = processStorno(payment, -100);
    expect(result.success).toBe(false);
  });

  it('ledger balance with mixed positive/negative entries', () => {
    const entries: LedgerEntry[] = [
      { id: 'p1', amount: 1000, type: 'payment' },
      { id: 'p2', amount: 500, type: 'payment' },
      { id: 's1', amount: -300, type: 'storno', relatedPaymentId: 'p1' },
      { id: 's2', amount: -200, type: 'storno', relatedPaymentId: 'p2' },
    ];
    expect(calculateLedgerBalance(entries)).toBe(1000);
  });

  it('full reversal restores invoice status to offen', () => {
    const allocations: Allocation[] = [
      { invoiceId: 'inv-1', amount: 925 },
    ];
    const result = reverseAllocation(allocations, 925);
    expect(result.totalReversed).toBe(925);
    expect(result.remainingStorno).toBe(0);
    const newPaidAmount = roundMoney(925 - result.reversedAllocations[0].reversedAmount);
    const newStatus = newPaidAmount <= 0 ? 'offen' : newPaidAmount >= 925 ? 'bezahlt' : 'teilbezahlt';
    expect(newStatus).toBe('offen');
  });
});
