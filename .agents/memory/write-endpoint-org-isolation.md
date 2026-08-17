---
name: Write-endpoint org-isolation patterns
description: Security patterns and pitfalls for enforcing org boundaries on POST/PATCH/DELETE routes in immo-flow-me
---

## Rule
Every write endpoint must verify that ALL referenced resource IDs (URL params AND body fields) belong to the session org before executing the mutation.

**Why:** Auth middleware confirms identity, but not org scope. A valid session from Org A can be used to mutate Org B resources if handlers only check authentication, not ownership.

## How to apply

### URL-param resources (PATCH/DELETE /:id)
Load the resource, compare its `organizationId` (or its parent's) to `profile.organizationId`. Return 403 if they differ.

### Body-field resources (POST with foreign IDs)
For every FK in the body (e.g. `unitId`, `tenantId`, `propertyId`), load the target and verify it belongs to the session org. Reject with 403 if any disagrees.

### Immutable association fields on PATCH
Strip relationship fields (`organizationId`, `unitId`, `tenantId`, `propertyId`) from PATCH bodies before calling storage. Prevents silent org-transfer via body field.

### Distribution keys — special cases
- Keys with only `propertyId` set: check property's org AND that `organizationId` (if present) agrees — fail closed if they point to different orgs.
- Keys with only `organizationId` set: check organizationId matches session.
- Keys with neither (system/global keys): always 403 for property managers.

### Property managers (POST /api/property-managers)
Uses `req.session.email` (not userId) to look up profile — mirror this in test session injection.

## Test patterns (write-cross-org.test.ts)
- Two orgs, two users, two properties/units/tenants/leases/keys — all seeded fresh per run.
- `buildAppAsUser(userId, email)` injects both into session (email needed for POST /api/properties and POST /api/property-managers handlers that call `getProfileByEmail`).
- Cleanup order: distribution_keys → leases → tenants → units → property_managers → properties → user_roles → profiles → organizations.
- `property_managers` must be deleted before properties (FK: property_managers.property_id → properties.id).
- Use `ON CONFLICT DO NOTHING` on seeds; use email-based cleanup (not UUID) to handle stale rows from failed prior runs.

## Org-scoping principles (from write-path audit)
- Scope a row via ITS OWN ownership FK chain (matching the RLS policy), never via a sibling entity's chain — sibling links can diverge from the row's real owner.
- Self-consistent predicates (comparing a row to org values just loaded from that same row) are NOT authorization; bind the initial (locked) SELECT to a caller-supplied orgId.
- Verify org membership BEFORE inserting dependent rows; make insert + scoped update one transaction and roll back when the scoped update hits 0 rows.
