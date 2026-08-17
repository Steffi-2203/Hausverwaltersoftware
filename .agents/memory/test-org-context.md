---
name: Test org-context helper (addOrgContext)
description: Pattern for injecting PostgreSQL org context into Express test apps without the BEGIN/COMMIT race condition
---

# Test Org-Context Helper

## Rule
`tests/helpers/withOrgContext.ts` — call `addOrgContext(app, orgId)` before mounting the router in every HTTP test `buildApp()` function.

## How it works
- Grabs a dedicated client from `appPool.connect()`
- Runs `SELECT set_config('app.current_org', orgId, false)` — **no transaction** (is_local=false)
- Creates an `orgDb = drizzle(client, { schema })` and stores in `orgContext` AsyncLocalStorage
- Releases the client on `res.on('finish')` after resetting the setting

## Why no BEGIN/COMMIT
Earlier version wrapped in `BEGIN...COMMIT`. This caused a race condition:
- Supertest resolves when response is sent, before `res.on('finish')` async COMMIT runs
- Test immediately queries `rootDb` and sees uncommitted route updates → stale assertion failures
- Fix: use `is_local=false` without a transaction; routes manage their own transactions, auto-commits are immediately visible to `rootDb`

**Why:** `pg_advisory_xact_lock` (transaction-scoped) still works because routes open their own transactions.

## How to apply
Any test file with a `buildApp()` / `buildTestApp()` that mounts an Express router needs `addOrgContext(app, orgId)` between the session-injection middleware and `app.use(router)`.
