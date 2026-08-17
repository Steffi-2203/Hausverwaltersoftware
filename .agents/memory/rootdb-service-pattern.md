---
name: rootDb vs db service pattern
description: Which service functions must use rootDb and why; VPI cross-org reference check pattern
---

# rootDb vs db in Service Functions

## Rule
Service functions called **directly from tests** (not via HTTP) must use `rootDb`, not `db`. The `db` proxy throws `"Kein Org-Kontext gesetzt"` unless called inside `orgContext.run(...)`.

Applies to: settlement/voting/PDF/email services, background timers (lease expiry), audit-chain helpers, profile/role lookups — anything reachable outside `rlsMiddleware`.

## VPI reference checks — must be cross-org
VPI values are **global** (not org-scoped). Tenant `vpi_base` references can exist in ANY org.
In `vpiRoutes.ts` DELETE handler, use `rootDb.execute(...)` for the tenant/adjustment reference checks, even though the rest of the handler uses `db.transaction()`.

**Why:** With org-scoped `db`, the reference check only sees tenants in the current org context. A tenant in a different org that references the VPI value would be invisible → DELETE proceeds → 409 never fires → data integrity violation.

## How to apply
- New service function called from tests: use `rootDb`
- Route-level reference check that must span all orgs: use `rootDb` for that specific query
- Background jobs (timers, crons): always `rootDb`
- Route handlers (HTTP requests): `db` (org-scoped via `rlsMiddleware`) is correct
