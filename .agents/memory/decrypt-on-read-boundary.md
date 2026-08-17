---
name: Decrypt-on-read boundary for encrypted fields
description: Every read path of encrypted columns (iban, bic, partner_iban) must decrypt before returning to clients or comparing in business logic
---

# Decrypt-on-Read Boundary

## Rule
Storage-layer methods are the decrypt boundary (`decryptField` / `decryptIbanFields` / `decryptIbanRows`). Any route that bypasses storage with a raw `db.select()` on tables holding encrypted columns MUST decrypt explicitly before responding or comparing.

**Why:** GCM uses random IVs — ciphertext comparison never matches, and clients receiving `enc:v1:...` silently break (e.g. IBAN-based payment matching after CAMT import).

## How to apply
- Prefer storage methods (they already decrypt) over raw selects for tenants, transactions, bank accounts, contractors, organizations.
- If a raw select is unavoidable (readonly API, portal context loaders, re-fetch after update), wrap the result with the decrypt helpers before use.
- Business comparisons of encrypted columns (IBAN matching) must happen on decrypted values from storage, never on raw rows.
- Endpoint test pattern: write via real route → assert `enc:v1:` via rootDb → assert plaintext via every read route (see tests/unit/encryption-endpoints.test.ts).
