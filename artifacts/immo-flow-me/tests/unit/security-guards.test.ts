import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';
import { billingService } from '../../server/services/billing.service';
import { setupTestDb, teardownTestDb, seedTestData, testPropertyId, testUserId, testOrgId, testTenantId } from '../helpers/db';

describe('Security Guards', () => {
  beforeAll(async () => {
    await setupTestDb();
    await seedTestData();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  describe('BillingService organizationId Guard', () => {
    test('throws error when organizationId is empty string', async () => {
      await expect(billingService.generateMonthlyInvoices({
        userId: testUserId,
        organizationId: '',
        propertyIds: [testPropertyId],
        year: 2030,
        month: 1,
        dryRun: true
      })).rejects.toThrow('Pflichtfeld');
    });

    test('succeeds with valid organizationId', async () => {
      const result = await billingService.generateMonthlyInvoices({
        userId: testUserId,
        organizationId: testOrgId,
        propertyIds: [testPropertyId],
        year: 2030,
        month: 2,
        dryRun: true
      });
      expect(result.dryRun).toBe(true);
    });

    test('throws error when organizationId is null or undefined', async () => {
      await expect(billingService.generateMonthlyInvoices({
        userId: testUserId,
        organizationId: null as any,
        propertyIds: [testPropertyId],
        year: 2030,
        month: 3,
        dryRun: true
      })).rejects.toThrow('Pflichtfeld');
    });
  });

  describe('PaymentService Organization Guard', () => {
    test('rejects payment allocation for tenant not in organization', async () => {
      const { PaymentService } = await import('../../server/services/paymentService');
      const paymentService = new PaymentService();
      const fakeTenantId = '00000000-0000-0000-0000-000000000099';
      
      await expect(paymentService.allocatePayment({
        paymentId: '00000000-0000-0000-0000-000000000001',
        tenantId: fakeTenantId,
        amount: 100,
        organizationId: testOrgId,
      })).rejects.toThrow('nicht zu dieser Organisation');
    });

    test('allows payment when no organizationId provided (backward compat)', async () => {
      // This should not throw org error (may throw other errors about tenant/invoice)
      // The key is it doesn't throw "nicht zu dieser Organisation"
      const { PaymentService } = await import('../../server/services/paymentService');
      const paymentService = new PaymentService();
      try {
        await paymentService.allocatePayment({
          paymentId: '00000000-0000-0000-0000-000000000002',
          tenantId: '00000000-0000-0000-0000-000000000099',
          amount: 100,
        });
      } catch (e: any) {
        // Should NOT be an org error
        expect(e.message).not.toContain('nicht zu dieser Organisation');
      }
    });
  });

  describe('Ownership Verification Functions', () => {
    test('verifyPropertyOwnership returns true for own property', async () => {
      const { verifyPropertyOwnership } = await import('../../server/lib/ownershipCheck');
      const result = await verifyPropertyOwnership(testPropertyId, testOrgId);
      expect(result).toBe(true);
    });

    test('verifyPropertyOwnership returns false for wrong org', async () => {
      const { verifyPropertyOwnership } = await import('../../server/lib/ownershipCheck');
      const fakeOrgId = '00000000-0000-0000-0000-000000000099';
      const result = await verifyPropertyOwnership(testPropertyId, fakeOrgId);
      expect(result).toBe(false);
    });

    test('verifyTenantOwnership returns true for own tenant', async () => {
      const { verifyTenantOwnership } = await import('../../server/lib/ownershipCheck');
      const result = await verifyTenantOwnership(testTenantId, testOrgId);
      expect(result).toBe(true);
    });

    test('verifyTenantOwnership returns false for wrong org', async () => {
      const { verifyTenantOwnership } = await import('../../server/lib/ownershipCheck');
      const fakeOrgId = '00000000-0000-0000-0000-000000000099';
      const result = await verifyTenantOwnership(testTenantId, fakeOrgId);
      expect(result).toBe(false);
    });
  });

  describe('Period Lock (BAO §132)', () => {
    test('can lock and check a period', async () => {
      const { lockPeriod, isPeriodLocked, unlockPeriod } = await import('../../server/services/periodLockService');
      await lockPeriod(testOrgId, 2025, 12, testUserId);
      const locked = await isPeriodLocked(testOrgId, 2025, 12);
      expect(locked).toBe(true);
      await unlockPeriod(testOrgId, 2025, 12);
    });

    test('different org does not see other org locks', async () => {
      const { lockPeriod, isPeriodLocked, unlockPeriod } = await import('../../server/services/periodLockService');
      await lockPeriod(testOrgId, 2025, 11, testUserId);
      const fakeOrgId = '00000000-0000-0000-0000-000000000099';
      const locked = await isPeriodLocked(fakeOrgId, 2025, 11);
      expect(locked).toBe(false);
      await unlockPeriod(testOrgId, 2025, 11);
    });
  });
});
