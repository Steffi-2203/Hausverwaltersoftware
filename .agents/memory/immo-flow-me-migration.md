---
name: IMMO FLOW ME Migration
description: Startup quirks, schema decisions, and security hardening lessons for the IMMO FLOW ME workspace.
---

# IMMO FLOW ME — Durable Migration Notes

## zod / drizzle-zod Version Lock
**Rule:** zod must stay at ≥3.25.x. Do NOT downgrade to 3.23.
**Why:** drizzle-zod@0.8.3 imports the `zod/v4` subpath, which only exists in zod@3.25+. Downgrading crashes the server at runtime.
**How to apply:** `@ts-nocheck` is required at the top of `shared/schema.ts` and `shared/models/chat.ts` to suppress ~90 TS2344 errors from the drizzle-zod × zod@3.25 generic incompatibility. Runtime is unaffected.

## vitest Blocked by Replit Firewall
**Rule:** Do not attempt to install vitest. Use `node:test` instead.
**Why:** The Replit package firewall blocks vitest. All proof/security tests use `node --import tsx/esm --test`.
**How to apply:** Run tests via `node --import tsx/esm --test tests/security/proof.test.ts`.

## Missing DB Tables at Startup
**Rule:** Always run `psql $DATABASE_URL -f migrations/<file>.sql` after adding new migration files. The server does NOT auto-migrate.
**Why:** Tables like `user_2fa`, `audit_logs.chain_seq`, `audit_chain_seq` sequence must be created manually in the dev DB.

## Audit HMAC Chain — Version History
**Rule:** Never change the v3 wire format. Keep `computeHmacV3` as-is. All new writes use v4.
**Why:** Backward compatibility — rows with `hmac_version='v3'` in the DB were signed without a version prefix.
- **v3 wire (legacy, NO version prefix):** `id|tableName|recordId|action|chainSeq|userId|ipAddress|userAgent|oldData|newData|previousHmac`
- **v4 wire (current, version prefix first):** `v4|id|tableName|recordId|action|chainSeq|userId|ipAddress|userAgent|oldData|newData|previousHmac`
- Fixed v3 test vector (key=`test-vector-key-for-v3-compat-check`): `c51391144de9944e06093ec0cebbd2d7931811684113e6c11269dce7a09802ed`

## Audit HMAC — Advisory Lock + Sequence
**Rule:** chain_seq is assigned from `nextval('audit_chain_seq')` UNDER `pg_advisory_xact_lock` inside a transaction. Sort by chain_seq (not created_at) for verification.
**Why:** `created_at` is transaction-start time — concurrent writers can have out-of-order timestamps. The sequence under the lock is monotone by lock-acquisition order.

## Audit HMAC — No Fallback Key
**Rule:** If `AUDIT_HMAC_KEY` and `SESSION_SECRET` are both absent, `appendAuditEntryLocked` logs an error and returns early (no writes). Never use a hardcoded fallback string.
**Why:** A repository-known fallback key lets anyone forge audit records.
**How to apply:** Set `SESSION_SECRET` (already required for auth) — this doubles as the audit key in development.

## 2FA Enrollment — Staged Session Pattern
**Rule:** Privileged users without 2FA do NOT get hard-blocked at login. Instead, set `pending2FASetupUserId` in session and return 403 + `2FA_SETUP_REQUIRED`.
**Why:** Hard-blocking locked out admin users who had never configured 2FA.
**How to apply:** Two enrollment endpoints `/api/2fa/enrollment-setup` and `/api/2fa/enrollment-verify` accept `pending2FASetupUserId` from session (no full auth required) and upgrade to full auth after TOTP verification.

## Proof Test Isolation
**Rule:** All proof tests write to unique table names per RUN_ID (`proof_<name>_${Date.now()}`). Clean up via `after()` hook deleting by table_name. Use `verifyAuditChain(limit, fromSeq)` to verify only the entries written in this run.
**Why:** Old test runs leave rows with deprecated HMAC formats. Filtering by unique table + fromSeq prevents cross-run contamination.

## vat_rate Column Mismatch
**Rule:** `vat_rate` in the schema is `numeric` (string at runtime via Drizzle). Wrap with `Number()` when doing arithmetic.
**Why:** Drizzle returns `numeric` columns as strings. TypeScript infers the wrong type without `as any` or `Number()`.

## SQL-Migrations-Splitter
Der eigene Splitter in `runSqlMigrations` splittet auf `;` — er muss String-Literale ('' Escapes, E-Strings, "..."-Identifier, $tag$-Dollar-Quotes) und Kommentare lexikalisch tracken, sonst crasht ein `;` in einem COMMENT-Text den Produktions-Boot (passiert Aug 2026). Regressionstests: tests/unit/sql-migration-splitter.test.ts. Deploy-Failure-Muster: Build grün, Promote scheitert mit Healthcheck 500 → fetchDeploymentLogs zeigt den Migrationsfehler.

## Legacy-Schlüssel auf Organisationen zurückführen
**Rule:** Bevor ein zuvor globaler Datensatz eine Organisation erhält, müssen bereits vorhandene org-spezifische Datensätze mit demselben Unique-Schlüssel geprüft werden. Bei Kollisionen FK-Referenzen auf den passenden Datensatz umhängen, statt den Legacy-Datensatz zu aktualisieren.
**Why:** Ein `NOT NULL`-Backfill kann am org-weiten Unique-Index scheitern oder bei Alt-Referenzen mehrerer Organisationen einen Schlüssel der falschen Organisation zuordnen.
**How to apply:** Ursprüngliche NULL-Zeilen während der Migration markieren, alle FK-Pfade gegen ihre tatsächliche Organisation prüfen und gleichartige Ersatzzeilen bevorzugen. Sind Referenzen nicht semantisch sicher auflösbar, die atomare Migration vor Änderungen abbrechen — nie bestehende Beziehungen nur wegen eines optionalen FK stillschweigend löschen.

## SQL-Migrationen: Transaktionsbesitz
**Rule:** Der Runner darf nur Dateien ohne eigene Top-Level-Transaktionsbefehle umschließen. Dateien mit eigenem `BEGIN`/`COMMIT` bleiben dafür verantwortlich und werden innerhalb ihrer Transaktion statementweise per Savepoint abgesichert.
**Why:** Verschachtelte `BEGIN`-Aufrufe lassen frische Deploys vor späteren Migrationen abbrechen; vollständig ungeschützte Dateien hinterlassen bei Fehlern Teilzustände.
**How to apply:** Neue Migrationen ohne explizite Transaktionsbefehle schreiben; der Runner macht sie pro Datei atomar. Bei alten Dateien mit Top-Level-Transaktionssteuerung die Erkennung und den realen Kompatibilitätstest beibehalten.
