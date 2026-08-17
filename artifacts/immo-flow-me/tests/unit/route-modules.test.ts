import { describe, test } from 'node:test';
import { expect } from '../helpers/expect';
import { Router } from 'express';

describe('Route Module Exports', () => {
  test('wegRoutes exports a valid Express router', async () => {
    const mod = await import('../../server/routes/wegRoutes');
    const router = mod.default;
    expect(router).toBeDefined();
    expect(router.stack).toBeDefined();
    expect(Array.isArray(router.stack)).toBe(true);
    expect(router.stack.length).toBeGreaterThan(0);
  });

  test('financeRoutes exports a valid Express router', async () => {
    const mod = await import('../../server/routes/financeRoutes');
    const router = mod.default;
    expect(router).toBeDefined();
    expect(router.stack).toBeDefined();
    expect(Array.isArray(router.stack)).toBe(true);
    expect(router.stack.length).toBeGreaterThan(0);
  });

  test('adminRoutes exports a valid Express router', async () => {
    const mod = await import('../../server/routes/adminRoutes');
    const router = mod.default;
    expect(router).toBeDefined();
    expect(router.stack).toBeDefined();
    expect(Array.isArray(router.stack)).toBe(true);
    expect(router.stack.length).toBeGreaterThan(0);
  });

  test('featureRoutes aggregator exports a valid Express router', async () => {
    const mod = await import('../../server/routes/featureRoutes');
    const router = mod.default;
    expect(router).toBeDefined();
    expect(router.stack).toBeDefined();
    expect(Array.isArray(router.stack)).toBe(true);
  });

  test('helpers exports required functions', async () => {
    const helpers = await import('../../server/routes/helpers');
    expect(typeof helpers.getAuthContext).toBe('function');
    expect(typeof helpers.checkMutationPermission).toBe('function');
    expect(typeof helpers.objectToSnakeCase).toBe('function');
    expect(typeof helpers.objectToCamelCase).toBe('function');
  });

  test('objectToSnakeCase converts correctly', async () => {
    const { objectToSnakeCase } = await import('../../server/routes/helpers');
    expect(objectToSnakeCase({ firstName: 'Max', lastName: 'Muster' }))
      .toEqual({ first_name: 'Max', last_name: 'Muster' });
    expect(objectToSnakeCase([{ organizationId: '1' }]))
      .toEqual([{ organization_id: '1' }]);
    expect(objectToSnakeCase(null)).toBeNull();
  });

  test('objectToCamelCase converts correctly', async () => {
    const { objectToCamelCase } = await import('../../server/routes/helpers');
    expect(objectToCamelCase({ first_name: 'Max', last_name: 'Muster' }))
      .toEqual({ firstName: 'Max', lastName: 'Muster' });
    expect(objectToCamelCase([{ organization_id: '1' }]))
      .toEqual([{ organizationId: '1' }]);
    expect(objectToCamelCase(null)).toBeNull();
  });

  test('wegRoutes contains expected route paths', async () => {
    const mod = await import('../../server/routes/wegRoutes');
    const router = mod.default;
    const paths = router.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => layer.route.path);
    expect(paths).toContain('/api/weg/assemblies');
    expect(paths).toContain('/api/weg/votes');
    expect(paths).toContain('/api/weg/reserve-fund');
    expect(paths).toContain('/api/weg/unit-owners');
    expect(paths).toContain('/api/weg/budget-plans');
    expect(paths).toContain('/api/weg/maintenance');
    expect(paths).toContain('/api/weg/owner-changes');
    expect(paths).toContain('/api/weg/vorschreibungen');
  });

  test('financeRoutes contains expected route paths', async () => {
    const mod = await import('../../server/routes/financeRoutes');
    const router = mod.default;
    const paths = router.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => layer.route.path);
    expect(paths).toContain('/api/sepa-collections');
    expect(paths).toContain('/api/owner-payouts');
    expect(paths).toContain('/api/vpi-adjustments');
    expect(paths).toContain('/api/heating-cost-readings');
    expect(paths).toContain('/api/property-owners');
  });

  test('adminRoutes contains expected route paths', async () => {
    const mod = await import('../../server/routes/adminRoutes');
    const router = mod.default;
    const paths = router.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => layer.route.path);
    expect(paths).toContain('/api/insurance/policies');
    expect(paths).toContain('/api/insurance/claims');
    expect(paths).toContain('/api/deadlines');
    expect(paths).toContain('/api/letter-templates');
    expect(paths).toContain('/api/serial-letters');
    expect(paths).toContain('/api/management-contracts');
    expect(paths).toContain('/api/audit-logs');
    expect(paths).toContain('/api/tenant-portal-access');
    expect(paths).toContain('/api/owner-portal-access');
    expect(paths).toContain('/api/learned-matches');
    expect(paths).toContain('/api/period-locks');
    expect(paths).toContain('/api/settlement-deadlines');
    expect(paths).toContain('/api/compliance-check');
    expect(paths).toContain('/api/audit-chain/verify');
  });
});
