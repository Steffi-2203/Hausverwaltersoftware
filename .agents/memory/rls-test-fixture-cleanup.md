---
name: RLS test fixture cleanup
description: Prevents orphaned test organizations when setup fails after data seeding.
---

Tests that seed database fixtures must use `rootDb` or an explicit organization
context consistently in both setup and cleanup. Cleanup must remain reachable
when setup fails partway through, preferably via a rootDb/finally path.

**Why:** An org-context proxy can reject a test query after fixtures were
created but before the test's ordinary cleanup path is established, leaving
synthetic organizations and related records in the shared development database.

**How to apply:** For integration tests that create organizations, test the
failure path as well as the happy path, and keep cleanup independent of request
middleware or ambient RLS context.