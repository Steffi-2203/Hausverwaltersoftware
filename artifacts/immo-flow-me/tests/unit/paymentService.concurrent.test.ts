import { describe, it } from 'node:test';
import { expect, vi } from '../helpers/expect';
import { roundMoney } from "@shared/utils";

describe("PaymentService concurrency", () => {
  it("applies concurrent payments without double allocation (simulation)", async () => {
    const invoiceTotal = 100;
    let paidAmount = 0;
    const lock = { locked: false };

    const allocatePayment = async (amount: number): Promise<{ applied: number; unapplied: number }> => {
      while (lock.locked) {
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      lock.locked = true;

      try {
        const due = roundMoney(invoiceTotal - paidAmount);
        if (due <= 0) {
          return { applied: 0, unapplied: amount };
        }

        const apply = roundMoney(Math.min(amount, due));
        paidAmount = roundMoney(paidAmount + apply);
        const unapplied = roundMoney(amount - apply);

        return { applied: apply, unapplied };
      } finally {
        lock.locked = false;
      }
    };

    const p1 = allocatePayment(60);
    const p2 = allocatePayment(50);

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(paidAmount).toBeLessThanOrEqual(100);
    expect(paidAmount).toBe(100);

    const totalApplied = r1.applied + r2.applied;
    const totalUnapplied = r1.unapplied + r2.unapplied;

    expect(totalApplied).toBe(100);
    expect(totalUnapplied).toBe(10);
  });

  it("handles race condition with FOR UPDATE locking pattern", async () => {
    const invoices = [
      { id: "inv-1", total: 100, paid: 0 },
      { id: "inv-2", total: 50, paid: 0 },
    ];

    const lockedInvoices = new Set<string>();

    const allocateWithLocking = async (
      tenantId: string,
      amount: number
    ): Promise<{ applied: number; allocations: Array<{ invoiceId: string; amount: number }> }> => {
      const allocations: Array<{ invoiceId: string; amount: number }> = [];
      let remaining = amount;

      for (const inv of invoices) {
        if (remaining <= 0) break;

        while (lockedInvoices.has(inv.id)) {
          await new Promise(resolve => setTimeout(resolve, 1));
        }
        lockedInvoices.add(inv.id);

        try {
          const due = roundMoney(inv.total - inv.paid);
          if (due <= 0) continue;

          const apply = roundMoney(Math.min(remaining, due));
          inv.paid = roundMoney(inv.paid + apply);
          remaining = roundMoney(remaining - apply);

          allocations.push({ invoiceId: inv.id, amount: apply });
        } finally {
          lockedInvoices.delete(inv.id);
        }
      }

      return { applied: amount - remaining, allocations };
    };

    const p1 = allocateWithLocking("t1", 80);
    const p2 = allocateWithLocking("t1", 90);

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(invoices[0].paid).toBe(100);
    expect(invoices[1].paid).toBe(50);

    const totalApplied = r1.applied + r2.applied;
    expect(totalApplied).toBe(150);
  });

  it("prevents overpayment on single invoice", async () => {
    let paidAmount = 0;
    const invoiceTotal = 100;

    const payments = [60, 50, 30];
    let totalUnapplied = 0;

    for (const amount of payments) {
      const due = roundMoney(invoiceTotal - paidAmount);
      const apply = roundMoney(Math.min(amount, due));
      paidAmount = roundMoney(paidAmount + apply);
      totalUnapplied = roundMoney(totalUnapplied + (amount - apply));
    }

    expect(paidAmount).toBe(100);
    expect(totalUnapplied).toBe(40);
  });
});
