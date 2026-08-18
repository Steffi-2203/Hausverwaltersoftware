/**
 * Serialisiert audit_log-schreibende Testdateien untereinander.
 *
 * Hintergrund: audit_logs ist eine GLOBALE Tabelle (nicht org-scoped).
 * ocr-review-audit.test.ts setzt den audit_chain_anchor zurück und
 * verifiziert die Kette dann komplett — jeder Fremd-Eintrag (chain_seq)
 * aus einem parallel laufenden Prozess unterbricht die Kette und macht
 * den Test flaky.  Gleiches Muster wie tests/helpers/vpiTestLock.ts.
 *
 * Betroffene Dateien:
 *   - ocr-review-audit.test.ts   (chain-reset + chain-verify)
 *   - api-key-management.test.ts (schreibt Audit-Logs via adminRoutes)
 *   - tenant-isolation.test.ts   (schreibt Audit-Logs via billingService)
 *   - penetration-tests.test.ts  (schreibt Audit-Logs via billingService u.a.)
 *   - immutable-violation-audit.test.ts (schreibt via createAuditLogStrict)
 *   - proof.test.ts              (schreibt direkt via createAuditLog)
 *
 * Key bewusst verschieden von VPI_TEST_LOCK_KEY (727_001),
 * ENCRYPTION_TEST_LOCK_KEY (727_002) und den Produktions-Locks.
 */
import pg from "pg";

const AUDIT_LOG_TEST_LOCK_KEY = 727_003;

let client: pg.Client | null = null;

/** Blockiert bis die audit_log-Test-Sperre frei ist, dann hält sie diese Session. */
export async function acquireAuditLogTestLock(): Promise<void> {
  if (client) return; // bereits gehalten (idempotent pro Prozess)
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("SELECT pg_advisory_lock($1)", [AUDIT_LOG_TEST_LOCK_KEY]);
}

/** Gibt die Sperre frei und schließt die Verbindung. */
export async function releaseAuditLogTestLock(): Promise<void> {
  if (!client) return;
  try {
    await client.query("SELECT pg_advisory_unlock($1)", [AUDIT_LOG_TEST_LOCK_KEY]);
  } finally {
    await client.end().catch(() => {});
    client = null;
  }
}
