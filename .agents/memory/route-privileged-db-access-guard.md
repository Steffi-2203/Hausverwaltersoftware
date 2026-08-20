---
name: Route privileged database access guard
description: Fail-closed static guard for RLS-bypassing database handles in route code.
---

# Route privileged database access guard

## Rule
Every privileged database-handle use reachable from a route must be explicitly documented in the route access allowlist. The guard follows static imports, re-exports, and literal dynamic imports from the startup-registered HTTP entrypoints; new imports or additional use sites must fail the test until reviewed.

**Why:** `rootDb` and the superuser pool bypass organisation RLS. The normal `db` proxy fails closed without an organisation context, but a new route importing a privileged handle could otherwise silently escape that boundary.

**How to apply:** Route discovery must include directory-based handlers and every HTTP entrypoint registered at server startup. When a legitimate exception is unavoidable, add a narrow entry with its reason and expected use count, and retain the RLS-bound path for all tenant-scoped work. Do not add a reachable service or helper with a privileged import without its own reviewed entry.