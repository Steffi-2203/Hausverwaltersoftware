---
name: Field Encryption (AES-256-GCM)
description: Rules for IBAN/PII at-rest encryption across the codebase — where it applies, invariants, and pitfalls.
---

# Field Encryption (AES-256-GCM)

## The rule
Every IBAN, BIC, or SEPA field must be encrypted at rest. `encryptField` is fail-closed — it throws without `FIELD_ENCRYPTION_KEY` (no plaintext fallback).

## Covered tables & fields
- `bank_accounts.iban/bic` — encrypt write, decrypt read (storage + sepaExportService)
- `tenants.iban/bic` — encrypt write (storage + tenantRoutes), decrypt read (storage)
- `owners.iban/bic` — encrypt write (routes.ts), decrypt read (routes.ts)
- `ebics_connections.iban/bic` — encrypt write/read (ebicsService)
- `organizations.iban/bic` — encrypt write (storage.createOrganization), decrypt ALL reads (getOrganizations, getOrganization, getOrganizationByName)
- `contractors.iban/bic` — decrypt read only (no write route found)
- `transactions.partnerIban` — encrypt write (storage.createTransaction + paymentRoutes CAMT import), decrypt read (storage.getTransaction/s/ByBankAccount/ByOrganization)
- `kautionen.treuhandkontoIban` — encrypt write (kautionService.createKaution + kautionRoutes PATCH), decrypt read (kautionRoutes GET list/detail/PATCH/POST responses)
- `demoService.ts` — ALL demo seed inserts of iban/bic use encryptField

## Boot migration
`server/lib/migrateFieldEncryption.ts` — runs before `listen()`. Covers all 8 tables above. Per-row errors are aggregated into AggregateError; startup aborts if any row fails.

## Key invariant
`decryptField(plaintext) === plaintext` — passthrough for non-encrypted values; safe to call on unknown values.

**Why:** Rolling migration — old plaintext rows are readable during/after migration without special handling.

## Common pitfall
Any new service/route that directly inserts iban/bic (bypassing storage) must call `encryptField` explicitly. `demoService.ts` was missed initially.

## Schlüsselauflösung (seit Aug 2026)
`FIELD_ENCRYPTION_KEY` akzeptiert: kanonisches Base64 (32 Bytes, auch mehrzeilig umbrochen — wird normalisiert), Präfix `passphrase:<≥16 Zeichen>`, ODER einen Wert mit innenliegendem Whitespace ≥16 Zeichen (eindeutig kein Base64) — Passphrasen werden per scrypt mit fixem App-Salt `immo-flow-me/field-encryption/v1` abgeleitet. Alles andere (auch vertipptes/falsch langes Base64 ohne Leerzeichen) wirft fail-fast — ein Base64-Tippfehler darf nie still zu einem anderen Schlüssel werden.
**Why:** Nutzer konnte den generierten Base64-Key mehrfach nicht korrekt einfügen und schaffte auch das `passphrase:`-Präfix nicht; Reviewer verlangte gleichzeitig fail-fast für malformtes Base64. Whitespace ist das eindeutige Unterscheidungsmerkmal.
**How to apply:** Salt nie ändern; Passphrase-Änderung = Key-Rotation (bestehende Ciphertexte werden sonst unlesbar). Auflösung zentral in `resolveKeyValue` — gilt identisch für KEY, KEY_OLD und `parseEncryptionKey`. Niemals Schlüsselwerte in `.replit`/[userenv] ablegen (Klartext im Repo = kompromittiert; genau das passierte einmal und erzwang Rotation).

## Tests
- `tests/unit/field-encryption.test.ts` — 24 unit tests (crypto helpers)
- `tests/unit/encryption-integration.test.ts` — 18 integration tests (real DB roundtrips)

## Key-Rotation
- Zwei Wege (Boot via FIELD_ENCRYPTION_KEY_OLD, CLI-Skript); beide MÜSSEN durch die CAS-Routine mit Abschlussverifikation UNTER Tabellensperre (LOCK TABLE EXCLUSIVE) laufen — lockfreie Verifikation ist gegen Old-Key-Writes nach dem Scan blind; _OLD erst entfernen wenn alle Instanzen den neuen Key nutzen und ein Lauf sauber verifiziert.
- **Pitfall:** Encryption-DB-Tests mit eigenen Test-Keys interferieren zwischen parallelen Testprozessen → Advisory-Lock-Helper nutzen und die Sperre erst NACH dem Fixture-Cleanup freigeben (after-Hooks laufen in Registrierungsreihenfolge).
