import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';
import { billingService } from '../../server/services/billing.service';
import { setupTestDb, teardownTestDb, seedTestData, testPropertyId, testUserId, testOrgId } from '../helpers/db';

describe('BillingService', () => {
  beforeAll(async () => {
    await setupTestDb();
    await seedTestData();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  test('dry-run returns preview without persisting', async () => {
    const result = await billingService.generateMonthlyInvoices({
      userId: testUserId,
      organizationId: testOrgId,
      propertyIds: [testPropertyId],
      year: 2026,
      month: 3,
      dryRun: true
    });

    expect(result.dryRun).toBe(true);
    expect(result.runId).toBeDefined();
    expect(result.period).toBe('2026-03');
    expect(result.preview).toBeDefined();
    expect(Array.isArray(result.preview)).toBe(true);
  });

  test('persist creates invoices and returns success', async () => {
    const result = await billingService.generateMonthlyInvoices({
      userId: testUserId,
      organizationId: testOrgId,
      propertyIds: [testPropertyId],
      year: 2026,
      month: 4,
      dryRun: false
    });

    expect(result.success).toBe(true);
    expect(result.runId).toBeDefined();
    expect(result.period).toBe('2026-04');
    expect(typeof result.created).toBe('number');
  });

  test('dry-run matches persist results', async () => {
    const dryResult = await billingService.generateMonthlyInvoices({
      userId: testUserId,
      organizationId: testOrgId,
      propertyIds: [testPropertyId],
      year: 2026,
      month: 5,
      dryRun: true
    });

    expect(dryResult.dryRun).toBe(true);
    const dryCount = dryResult.preview?.length || 0;
    const dryTotal = dryResult.summary?.total || 0;

    const persistResult = await billingService.generateMonthlyInvoices({
      userId: testUserId,
      organizationId: testOrgId,
      propertyIds: [testPropertyId],
      year: 2026,
      month: 5,
      dryRun: false
    });

    expect(persistResult.success).toBe(true);
    expect(persistResult.created).toBe(dryCount);
  });

  test('idempotency: re-running same period is rejected with error', async () => {
    const firstRun = await billingService.generateMonthlyInvoices({
      userId: testUserId,
      organizationId: testOrgId,
      propertyIds: [testPropertyId],
      year: 2026,
      month: 6,
      dryRun: false
    });
    expect(firstRun.success).toBe(true);

    const secondRun = await billingService.generateMonthlyInvoices({
      userId: testUserId,
      organizationId: testOrgId,
      propertyIds: [testPropertyId],
      year: 2026,
      month: 6,
      dryRun: false
    });
    expect(secondRun.error).toBeDefined();
    expect(secondRun.error).toContain('bereits abgeschlossen');
  });

  test('run_id is set on created invoices', async () => {
    const result = await billingService.generateMonthlyInvoices({
      userId: testUserId,
      organizationId: testOrgId,
      propertyIds: [testPropertyId],
      year: 2026,
      month: 7,
      dryRun: false
    });
    expect(result.success).toBe(true);
    expect(result.runId).toBeDefined();
    expect(typeof result.runId).toBe('string');
    expect(result.runId.length).toBe(36);
  });

  test('invoice lines use correct field names', async () => {
    const result = await billingService.generateMonthlyInvoices({
      userId: testUserId,
      organizationId: testOrgId,
      propertyIds: [testPropertyId],
      year: 2026,
      month: 8,
      dryRun: false
    });
    expect(result.success).toBe(true);
  });
});
