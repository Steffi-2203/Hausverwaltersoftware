-- Make organization_id NOT NULL on both portal-access tables.
-- Orphaned rows (no matching tenant/owner chain) are deleted first so the
-- ALTER does not fail. New inserts always set the column server-side.

-- Remove un-backfillable tenant_portal_access rows.
DELETE FROM tenant_portal_access WHERE organization_id IS NULL;

-- Remove un-backfillable owner_portal_access rows.
DELETE FROM owner_portal_access WHERE organization_id IS NULL;

ALTER TABLE tenant_portal_access
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE owner_portal_access
  ALTER COLUMN organization_id SET NOT NULL;
