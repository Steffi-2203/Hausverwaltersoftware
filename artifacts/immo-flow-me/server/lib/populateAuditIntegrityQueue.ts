import { pool } from "../db";
import { logger } from "./logger";

/**
 * Idempotent backfill for the audit integrity review queue.
 *
 * Inserts rows from audit_logs and audit_events where chain_hmac IS NULL
 * into audit_integrity_review_queue so compliance officers can review them.
 *
 * This function MUST be called only AFTER server.listen() — never at startup —
 * because in production both tables can be very large and the scan would block
 * the HTTP health-check timeout window.
 *
 * Uses ON CONFLICT DO NOTHING: re-running is always safe.
 */
export async function populateAuditIntegrityQueue(): Promise<void> {
  const client = await pool.connect();
  try {
    const tables = ["audit_logs", "audit_events"] as const;
    for (const tbl of tables) {
      let queued = 0;
      try {
        const res = await client.query(
          `INSERT INTO audit_integrity_review_queue
                 (source_table, source_row_id, row_created_at, detected_at)
           SELECT $1, id, created_at, NOW()
           FROM   ${tbl}
           WHERE  chain_hmac IS NULL
           ON CONFLICT DO NOTHING`,
          [tbl]
        );
        queued = res.rowCount ?? 0;
      } catch (err: any) {
        // Table might not have chain_hmac column yet — non-fatal
        logger.warn(`[auditIntegrity] Skipping ${tbl}: ${err.message.split("\n")[0]}`);
        continue;
      }
      if (queued > 0) {
        logger.info(`[auditIntegrity] Queued ${queued} ${tbl} row(s) with missing chain_hmac for review`);
      } else {
        logger.info(`[auditIntegrity] ${tbl}: no unreviewed rows with missing chain_hmac`);
      }
    }
  } finally {
    client.release();
  }
}
