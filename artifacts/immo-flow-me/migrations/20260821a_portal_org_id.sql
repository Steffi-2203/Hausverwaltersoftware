-- Add organization_id to portal-access tables so portal routes can bootstrap
-- the RLS org-context without querying RLS-protected tables first.
-- These columns are nullable so existing rows are not broken.

ALTER TABLE tenant_portal_access
  ADD COLUMN IF NOT EXISTS organization_id uuid;

ALTER TABLE owner_portal_access
  ADD COLUMN IF NOT EXISTS organization_id uuid;

-- Backfill tenant_portal_access via tenant -> unit -> property
UPDATE tenant_portal_access tpa
SET organization_id = p.organization_id
FROM tenants t
JOIN units u ON t.unit_id = u.id
JOIN properties p ON u.property_id = p.id
WHERE t.id = tpa.tenant_id
  AND tpa.organization_id IS NULL;

-- Backfill owner_portal_access via owner
UPDATE owner_portal_access opa
SET organization_id = o.organization_id
FROM owners o
WHERE o.id = opa.owner_id
  AND opa.organization_id IS NULL;
