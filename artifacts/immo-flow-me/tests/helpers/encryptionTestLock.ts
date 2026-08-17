/**
 * Serialisiert Feldverschlüsselungs-Testdateien untereinander.
 *
 * field-encryption-rotation.test.ts seedet Zeilen mit fremd-verschlüsselten
 * IBANs (Fehlerfall-Test), field-encryption-rotation-fallback.test.ts lässt
 * migrateFieldEncryption über ALLE Tabellen laufen. Laufen beide parallel
 * (node --test = ein Prozess pro Datei), sieht die Migration die fremden
 * Zeilen und schlägt flaky fehl. Gleiches Muster wie tests/helpers/vpiTestLock.ts.
 */
import pg from "pg";

const ENCRYPTION_TEST_LOCK_KEY = 727_002;

let client: pg.Client | null = null;

export async function acquireEncryptionTestLock(): Promise<void> {
  if (client) return;
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("SELECT pg_advisory_lock($1)", [ENCRYPTION_TEST_LOCK_KEY]);
}

export async function releaseEncryptionTestLock(): Promise<void> {
  if (!client) return;
  try {
    await client.query("SELECT pg_advisory_unlock($1)", [ENCRYPTION_TEST_LOCK_KEY]);
  } finally {
    await client.end().catch(() => {});
    client = null;
  }
}
