/**
 * Serialisiert VPI-Testdateien untereinander.
 *
 * Hintergrund: vpi_values ist eine GLOBALE Tabelle (nicht org-scoped) und
 * vpi-check-adjustments.test.ts leert sie kurzzeitig komplett (VPI_EMPTY-Test).
 * node --test fuehrt Testdateien in parallelen Prozessen aus — ohne Sperre
 * lesen vpi-apply & Co. genau in diesem Fenster einen leeren Index und
 * schlagen flaky fehl.
 *
 * Loesung: Postgres-Session-Advisory-Lock (wirkt prozessuebergreifend).
 * Jede VPI-Testdatei haelt die Sperre von beforeAll bis afterAll.
 *
 * Key bewusst verschieden von VPI_ADVISORY_LOCK_ID der Produktionsroute
 * (vpiRoutes.ts), damit Tests nicht mit den Routen-Locks kollidieren.
 */
import pg from "pg";

const VPI_TEST_LOCK_KEY = 727_001;

let client: pg.Client | null = null;

/** Blockiert bis die VPI-Test-Sperre frei ist, dann haelt sie diese Session. */
export async function acquireVpiTestLock(): Promise<void> {
  if (client) return; // bereits gehalten (idempotent pro Prozess)
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("SELECT pg_advisory_lock($1)", [VPI_TEST_LOCK_KEY]);
}

/** Gibt die Sperre frei und schliesst die Verbindung. */
export async function releaseVpiTestLock(): Promise<void> {
  if (!client) return;
  try {
    await client.query("SELECT pg_advisory_unlock($1)", [VPI_TEST_LOCK_KEY]);
  } finally {
    await client.end().catch(() => {});
    client = null;
  }
}
