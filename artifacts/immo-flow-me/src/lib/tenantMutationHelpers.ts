/**
 * Cache-invalidation helpers for tenant mutations.
 *
 * Extracted from the React hooks so that:
 * 1. The same invalidation logic is shared between the hook and tests.
 * 2. Tests can import and verify the logic without a browser environment
 *    or React context.
 *
 * Rule: keep this file free of browser-API imports (no localStorage, window,
 * fetch, sonner, etc.) so it can be imported safely in Node.js test runners.
 */

import type { QueryClient } from '@tanstack/react-query';

/** Data shape expected from the PATCH /api/tenants/:id response. */
export interface TenantUpdateResult {
  id: string;
  [key: string]: unknown;
}

/**
 * Invalidates every React-Query cache entry that must be refreshed after a
 * tenant record is updated (e.g. when the Grundmiete changes via the
 * PropertyDetail form).
 *
 * Used directly by useUpdateTenant's onSuccess callback.
 */
export function invalidateAfterTenantUpdate(
  queryClient: QueryClient,
  data: TenantUpdateResult,
): void {
  queryClient.invalidateQueries({ queryKey: ['tenants'] });
  queryClient.invalidateQueries({ queryKey: ['tenant', data.id] });
  queryClient.invalidateQueries({ queryKey: ['units'] });
  queryClient.invalidateQueries({ queryKey: ['mrg-check', data.id] });
}

/**
 * Invalidates every React-Query cache entry that must be refreshed after a
 * tenant record is created.
 *
 * Used directly by useCreateTenant's onSuccess callback.
 */
export function invalidateAfterTenantCreate(
  queryClient: QueryClient,
  data: TenantUpdateResult,
): void {
  queryClient.invalidateQueries({ queryKey: ['tenants'] });
  queryClient.invalidateQueries({ queryKey: ['units'] });
  if (data?.id) {
    queryClient.invalidateQueries({ queryKey: ['mrg-check', data.id] });
  }
}

/**
 * Invalidates every React-Query cache entry that must be refreshed after a
 * tenant record is deleted.
 */
export function invalidateAfterTenantDelete(
  queryClient: QueryClient,
  tenantId: string,
): void {
  queryClient.invalidateQueries({ queryKey: ['tenants'] });
  queryClient.invalidateQueries({ queryKey: ['units'] });
  queryClient.invalidateQueries({ queryKey: ['mrg-check', tenantId] });
}
