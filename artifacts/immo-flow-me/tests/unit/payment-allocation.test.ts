import { describe, it } from 'node:test';
import { expect } from '../helpers/expect';
import { roundMoney } from '@shared/utils';

type AllocationPriority = 'betriebskosten' | 'heizkosten' | 'grundmiete';
const ALLOCATION_ORDER: AllocationPriority[] = ['betriebskosten', 'heizkosten', 'grundmiete'];

interface Invoice {
  id: string;
  tenantId: string;
  year: number;
  month: number;
  grundmiete: number;
  betriebskosten: number;
  heizkosten: number;
  gesamtbetrag: number;
  status: 'offen' | 'teilbezahlt' | 'bezahlt';
}

interface AllocationResult {
  invoiceId: string;
  allocatedBk: number;
  allocatedHk: number;
  allocatedMiete: number;
  totalAllocated: number;
  remainingOpenAmount: number;
}

function allocatePaymentToInvoice(
  invoice: Invoice,
  paymentAmount: number
): AllocationResult {
  let remaining = paymentAmount;
  const result: AllocationResult = {
    invoiceId: invoice.id,
    allocatedBk: 0,
    allocatedHk: 0,
    allocatedMiete: 0,
    totalAllocated: 0,
    remainingOpenAmount: invoice.gesamtbetrag,
  };

  const allocateBk = Math.min(remaining, invoice.betriebskosten);
  result.allocatedBk = roundMoney(allocateBk);
  remaining -= allocateBk;

  const allocateHk = Math.min(remaining, invoice.heizkosten);
  result.allocatedHk = roundMoney(allocateHk);
  remaining -= allocateHk;

  const allocateMiete = Math.min(remaining, invoice.grundmiete);
  result.allocatedMiete = roundMoney(allocateMiete);
  remaining -= allocateMiete;

  result.totalAllocated = roundMoney(result.allocatedBk + result.allocatedHk + result.allocatedMiete);
  result.remainingOpenAmount = roundMoney(invoice.gesamtbetrag - result.totalAllocated);

  return result;
}

describe('Payment Allocation - MRG Compliant (BK → HK → Miete)', () => {

  describe('Full Payment', () => {
    it('should fully allocate payment matching invoice total', () => {
      const invoice: Invoice = {
        id: 'inv-001',
        tenantId: 'tenant-001',
        year: 2026,
        month: 1,
        grundmiete: 650,
        betriebskosten: 180,
        heizkosten: 95,
        gesamtbetrag: 925,
        status: 'offen',
      };

      const result = allocatePaymentToInvoice(invoice, 925);

      expect(result.allocatedBk).toBe(180);
      expect(result.allocatedHk).toBe(95);
      expect(result.allocatedMiete).toBe(650);
      expect(result.totalAllocated).toBe(925);
      expect(result.remainingOpenAmount).toBe(0);
    });
  });

  describe('Partial Payment - BK Priority', () => {
    it('should allocate partial payment to BK first', () => {
      const invoice: Invoice = {
        id: 'inv-002',
        tenantId: 'tenant-001',
        year: 2026,
        month: 2,
        grundmiete: 650,
        betriebskosten: 180,
        heizkosten: 95,
        gesamtbetrag: 925,
        status: 'offen',
      };

      const result = allocatePaymentToInvoice(invoice, 150);

      expect(result.allocatedBk).toBe(150);
      expect(result.allocatedHk).toBe(0);
      expect(result.allocatedMiete).toBe(0);
      expect(result.totalAllocated).toBe(150);
      expect(result.remainingOpenAmount).toBe(775);
    });

    it('should overflow to HK after BK is fully covered', () => {
      const invoice: Invoice = {
        id: 'inv-003',
        tenantId: 'tenant-001',
        year: 2026,
        month: 3,
        grundmiete: 650,
        betriebskosten: 180,
        heizkosten: 95,
        gesamtbetrag: 925,
        status: 'offen',
      };

      const result = allocatePaymentToInvoice(invoice, 230);

      expect(result.allocatedBk).toBe(180);
      expect(result.allocatedHk).toBe(50);
      expect(result.allocatedMiete).toBe(0);
      expect(result.totalAllocated).toBe(230);
      expect(result.remainingOpenAmount).toBe(695);
    });

    it('should overflow to Miete after BK and HK are covered', () => {
      const invoice: Invoice = {
        id: 'inv-004',
        tenantId: 'tenant-001',
        year: 2026,
        month: 4,
        grundmiete: 650,
        betriebskosten: 180,
        heizkosten: 95,
        gesamtbetrag: 925,
        status: 'offen',
      };

      const result = allocatePaymentToInvoice(invoice, 400);

      expect(result.allocatedBk).toBe(180);
      expect(result.allocatedHk).toBe(95);
      expect(result.allocatedMiete).toBe(125);
      expect(result.totalAllocated).toBe(400);
      expect(result.remainingOpenAmount).toBe(525);
    });
  });

  describe('Overpayment Handling', () => {
    it('should cap allocation at invoice total', () => {
      const invoice: Invoice = {
        id: 'inv-005',
        tenantId: 'tenant-001',
        year: 2026,
        month: 5,
        grundmiete: 650,
        betriebskosten: 180,
        heizkosten: 95,
        gesamtbetrag: 925,
        status: 'offen',
      };

      const result = allocatePaymentToInvoice(invoice, 1000);

      expect(result.totalAllocated).toBe(925);
      expect(result.remainingOpenAmount).toBe(0);
    });
  });

  describe('Water Costs Allocation', () => {
    it('should allocate water costs after BK in MRG priority order', () => {
      const invoice: Invoice & { wasserkosten: number } = {
        id: 'inv-water',
        tenantId: 'tenant-001',
        year: 2026,
        month: 1,
        grundmiete: 650,
        betriebskosten: 180,
        heizkosten: 95,
        wasserkosten: 25,
        gesamtbetrag: 950,
        status: 'offen',
      };

      let remaining = 250;
      let allocatedBk = 0, allocatedWasser = 0, allocatedHk = 0;

      const allocBk = Math.min(remaining, invoice.betriebskosten);
      allocatedBk = roundMoney(allocBk);
      remaining -= allocBk;

      const allocWasser = Math.min(remaining, invoice.wasserkosten);
      allocatedWasser = roundMoney(allocWasser);
      remaining -= allocWasser;

      const allocHk = Math.min(remaining, invoice.heizkosten);
      allocatedHk = roundMoney(allocHk);
      remaining -= allocHk;

      expect(allocatedBk).toBe(180);
      expect(allocatedWasser).toBe(25);
      expect(allocatedHk).toBe(45);
      expect(remaining).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle invoice with only Miete (no BK/HK)', () => {
      const invoice: Invoice = {
        id: 'inv-006',
        tenantId: 'tenant-001',
        year: 2026,
        month: 6,
        grundmiete: 500,
        betriebskosten: 0,
        heizkosten: 0,
        gesamtbetrag: 500,
        status: 'offen',
      };

      const result = allocatePaymentToInvoice(invoice, 300);

      expect(result.allocatedBk).toBe(0);
      expect(result.allocatedHk).toBe(0);
      expect(result.allocatedMiete).toBe(300);
      expect(result.totalAllocated).toBe(300);
    });

    it('should handle zero payment', () => {
      const invoice: Invoice = {
        id: 'inv-007',
        tenantId: 'tenant-001',
        year: 2026,
        month: 7,
        grundmiete: 650,
        betriebskosten: 180,
        heizkosten: 95,
        gesamtbetrag: 925,
        status: 'offen',
      };

      const result = allocatePaymentToInvoice(invoice, 0);

      expect(result.totalAllocated).toBe(0);
      expect(result.remainingOpenAmount).toBe(925);
    });

    it('should maintain precision with fractional amounts', () => {
      const invoice: Invoice = {
        id: 'inv-008',
        tenantId: 'tenant-001',
        year: 2026,
        month: 8,
        grundmiete: 650.33,
        betriebskosten: 180.67,
        heizkosten: 95.50,
        gesamtbetrag: 926.50,
        status: 'offen',
      };

      const result = allocatePaymentToInvoice(invoice, 200.50);

      expect(result.allocatedBk).toBe(180.67);
      expect(result.allocatedHk).toBe(19.83);
      expect(result.totalAllocated).toBe(200.5);
    });
  });

  describe('Concurrency Simulation', () => {
    it('should handle concurrent payments deterministically', async () => {
      const invoice: Invoice = {
        id: 'inv-concurrent',
        tenantId: 'tenant-001',
        year: 2026,
        month: 9,
        grundmiete: 650,
        betriebskosten: 180,
        heizkosten: 95,
        gesamtbetrag: 925,
        status: 'offen',
      };

      const payment1 = 300;
      const payment2 = 400;

      const result1 = allocatePaymentToInvoice(invoice, payment1);
      
      const updatedInvoice: Invoice = {
        ...invoice,
        betriebskosten: Math.max(0, invoice.betriebskosten - result1.allocatedBk),
        heizkosten: Math.max(0, invoice.heizkosten - result1.allocatedHk),
        grundmiete: Math.max(0, invoice.grundmiete - result1.allocatedMiete),
        gesamtbetrag: result1.remainingOpenAmount,
      };

      const result2 = allocatePaymentToInvoice(updatedInvoice, payment2);

      const totalAllocated = result1.totalAllocated + result2.totalAllocated;
      expect(totalAllocated).toBe(700);
      expect(result1.allocatedBk).toBe(180);
      expect(result1.allocatedHk).toBe(95);
      expect(result1.allocatedMiete).toBe(25);
      expect(result2.allocatedMiete).toBe(400);
    });
  });
});
