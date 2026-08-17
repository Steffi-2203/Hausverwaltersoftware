---
name: Global-table test races (node --test)
description: Tests that mutate global (non-org-scoped) tables race across parallel test processes; serialize via pg advisory lock helper
---

# Global-table test races

node --test runs each test file in its own process, concurrently. Any test that mutates a GLOBAL table (e.g. `vpi_values` — not org-scoped) can break other files reading it in the same window; failures only appear when files run together, never solo.

**Why:** vpi-check-adjustments empties `vpi_values` for its VPI_EMPTY case and restores afterwards; vpi-apply reads the index mid-window → flaky 422/500.

**How to apply:** Tests touching a shared global table must hold the session advisory lock from `tests/helpers/vpiTestLock.ts` (acquire in beforeAll, release in afterAll). Advisory locks work across processes. Use a lock key distinct from production route locks. Reproduce suspected races by running the file group together, not solo.
