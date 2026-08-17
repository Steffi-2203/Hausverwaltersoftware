import { describe, it } from 'node:test';
import { expect } from '../helpers/expect';
import { roundMoney } from '../../shared/utils';

interface LedgerInvoice {
  id: string;
  year: number;
  month: number;
  gesamtbetrag: number;
  paidAmount: number;
}

interface LedgerPayment {
  id: string;
  amount: number;
}

interface AuditEntry {
  id: string;
  data: string;
  hash: string;
  previousHash: string;
}

interface LedgerAllocation {
  invoiceId: string;
  appliedAmount: number;
}

function calculateTenantSaldo(invoices: LedgerInvoice[], payments: LedgerPayment[]): number {
  const totalSoll = roundMoney(invoices.reduce((sum, inv) => sum + inv.gesamtbetrag, 0));
  const totalIst = roundMoney(payments.reduce((sum, p) => sum + p.amount, 0));
  return roundMoney(totalSoll - totalIst);
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function buildAuditHash(previousHash: string, entry: { id: string; data: string }): string {
  return simpleHash(`${previousHash}:${entry.id}:${entry.data}`);
}

function verifyAuditChain(entries: AuditEntry[]): { valid: boolean; brokenAt?: number } {
  if (entries.length === 0) return { valid: true };

  for (let i = 0; i < entries.length; i++) {
    const prevHash = i === 0 ? '0' : entries[i - 1].hash;
    if (entries[i].previousHash !== prevHash) {
      return { valid: false, brokenAt: i };
    }
    const expectedHash = buildAuditHash(prevHash, { id: entries[i].id, data: entries[i].data });
    if (entries[i].hash !== expectedHash) {
      return { valid: false, brokenAt: i };
    }
  }

  return { valid: true };
}

function reconcileLedger(
  invoices: Array<{ id: string; paidAmount: number }>,
  allocations: LedgerAllocation[]
): Array<{ invoiceId: string; paidAmount: number; allocationsSum: number; match: boolean }> {
  return invoices.map(inv => {
    const allocationsSum = roundMoney(
      allocations.filter(a => a.invoiceId === inv.id).reduce((sum, a) => sum + a.appliedAmount, 0)
    );
    return {
      invoiceId: inv.id,
      paidAmount: inv.paidAmount,
      allocationsSum,
      match: inv.paidAmount === allocationsSum,
    };
  });
}

function buildChain(rawEntries: Array<{ id: string; data: string }>): AuditEntry[] {
  const chain: AuditEntry[] = [];
  for (const entry of rawEntries) {
    const previousHash = chain.length === 0 ? '0' : chain[chain.length - 1].hash;
    const hash = buildAuditHash(previousHash, entry);
    chain.push({ id: entry.id, data: entry.data, hash, previousHash });
  }
  return chain;
}

describe('Ledger Sync & Audit Trail', () => {
  describe('Tenant Saldo (Soll vs Ist)', () => {
    it('saldo with no payments = full invoice total', () => {
      const invoices: LedgerInvoice[] = [
        { id: 'inv-1', year: 2026, month: 1, gesamtbetrag: 925, paidAmount: 0 },
      ];
      expect(calculateTenantSaldo(invoices, [])).toBe(925);
    });

    it('saldo with partial payment', () => {
      const invoices: LedgerInvoice[] = [
        { id: 'inv-1', year: 2026, month: 1, gesamtbetrag: 925, paidAmount: 500 },
      ];
      const payments: LedgerPayment[] = [{ id: 'p1', amount: 500 }];
      expect(calculateTenantSaldo(invoices, payments)).toBe(425);
    });

    it('saldo with full payment = 0', () => {
      const invoices: LedgerInvoice[] = [
        { id: 'inv-1', year: 2026, month: 1, gesamtbetrag: 925, paidAmount: 925 },
      ];
      const payments: LedgerPayment[] = [{ id: 'p1', amount: 925 }];
      expect(calculateTenantSaldo(invoices, payments)).toBe(0);
    });

    it('saldo with overpayment = negative (credit)', () => {
      const invoices: LedgerInvoice[] = [
        { id: 'inv-1', year: 2026, month: 1, gesamtbetrag: 925, paidAmount: 925 },
      ];
      const payments: LedgerPayment[] = [{ id: 'p1', amount: 1000 }];
      expect(calculateTenantSaldo(invoices, payments)).toBe(-75);
    });

    it('saldo across multiple months', () => {
      const invoices: LedgerInvoice[] = [
        { id: 'inv-1', year: 2026, month: 1, gesamtbetrag: 925, paidAmount: 925 },
        { id: 'inv-2', year: 2026, month: 2, gesamtbetrag: 925, paidAmount: 0 },
        { id: 'inv-3', year: 2026, month: 3, gesamtbetrag: 925, paidAmount: 0 },
      ];
      const payments: LedgerPayment[] = [{ id: 'p1', amount: 925 }];
      expect(calculateTenantSaldo(invoices, payments)).toBe(1850);
    });
  });

  describe('Audit Hash Chain', () => {
    it('3 entries produce valid chain', () => {
      const chain = buildChain([
        { id: 'e1', data: 'payment:925' },
        { id: 'e2', data: 'payment:500' },
        { id: 'e3', data: 'storno:-925' },
      ]);
      const result = verifyAuditChain(chain);
      expect(result.valid).toBe(true);
    });

    it('tampered entry detected', () => {
      const chain = buildChain([
        { id: 'e1', data: 'payment:925' },
        { id: 'e2', data: 'payment:500' },
        { id: 'e3', data: 'storno:-925' },
      ]);
      chain[1].data = 'payment:9999';
      const result = verifyAuditChain(chain);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(1);
    });

    it('empty chain is valid', () => {
      const result = verifyAuditChain([]);
      expect(result.valid).toBe(true);
    });

    it('single entry valid', () => {
      const chain = buildChain([{ id: 'e1', data: 'payment:100' }]);
      const result = verifyAuditChain(chain);
      expect(result.valid).toBe(true);
    });
  });

  describe('Ledger Reconciliation', () => {
    it('paid_amount matches allocations', () => {
      const invoices = [{ id: 'inv-1', paidAmount: 500 }];
      const allocations: LedgerAllocation[] = [
        { invoiceId: 'inv-1', appliedAmount: 300 },
        { invoiceId: 'inv-1', appliedAmount: 200 },
      ];
      const result = reconcileLedger(invoices, allocations);
      expect(result[0].match).toBe(true);
      expect(result[0].allocationsSum).toBe(500);
    });

    it('mismatch detected', () => {
      const invoices = [{ id: 'inv-1', paidAmount: 500 }];
      const allocations: LedgerAllocation[] = [
        { invoiceId: 'inv-1', appliedAmount: 300 },
      ];
      const result = reconcileLedger(invoices, allocations);
      expect(result[0].match).toBe(false);
      expect(result[0].paidAmount).toBe(500);
      expect(result[0].allocationsSum).toBe(300);
    });

    it('invoice with no allocations shows 0', () => {
      const invoices = [{ id: 'inv-1', paidAmount: 0 }];
      const result = reconcileLedger(invoices, []);
      expect(result[0].allocationsSum).toBe(0);
      expect(result[0].match).toBe(true);
    });
  });

  describe('Idempotent Saldo', () => {
    it('same inputs = same result', () => {
      const invoices: LedgerInvoice[] = [
        { id: 'inv-1', year: 2026, month: 1, gesamtbetrag: 925, paidAmount: 0 },
      ];
      const payments: LedgerPayment[] = [{ id: 'p1', amount: 400 }];
      const s1 = calculateTenantSaldo(invoices, payments);
      const s2 = calculateTenantSaldo(invoices, payments);
      const s3 = calculateTenantSaldo(invoices, payments);
      expect(s1).toBe(s2);
      expect(s2).toBe(s3);
      expect(s1).toBe(525);
    });
  });
});
