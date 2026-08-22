---
name: Ledger-safe legacy deduplication
description: Applying new uniqueness guarantees to historical payment allocations protected by append-only triggers.
---

When a migration must consolidate historical duplicate payment allocations before adding a unique constraint, the append-only trigger must be disabled only within that migration transaction and re-enabled immediately afterward.

**Why:** A normal update/delete is correctly rejected by the ledger trigger, while leaving old duplicates prevents the idempotency constraint from being installed. The migration transaction guarantees that an error restores both the data and the trigger state.

**How to apply:** Keep the scope limited to a documented historical reconciliation, preserve the aggregate booked amount, and do not create an application-level bypass for ordinary requests.