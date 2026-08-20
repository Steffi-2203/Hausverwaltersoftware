---
name: Atomic financial audit trail
description: Required transaction boundary for OCR-to-accounting postings and their tamper-evident audit proof.
---

For financial OCR transfers, write the strict HMAC audit entry through the same database transaction as the incoming invoice, journal, journal lines, and cost position.

**Why:** Writing audit evidence after the financial transaction can return an error or terminate between commits, leaving a durable but untraceable posting and making retries ambiguous.

**How to apply:** Any future financial write path that requires tamper-evident proof must pass its active transaction to the strict audit writer. Treat audit-write failure as a rollback condition, not as a recoverable post-commit task.