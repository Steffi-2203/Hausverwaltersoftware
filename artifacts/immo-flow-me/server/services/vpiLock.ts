/**
 * Gemeinsamer Advisory-Lock für alle VPI-Wert-Mutationen.
 *
 * - EXKLUSIV (pg_advisory_xact_lock): DELETE /api/vpi/values/:id und
 *   Import-Upserts (upsertVpiRows) — sie prüfen Referenzen und ändern Werte.
 * - SHARED (pg_advisory_xact_lock_shared): POST /api/vpi/apply und andere
 *   Stellen die VPI-Werte als Referenz committen.
 *
 * Dadurch kann kein Import einen Wert überschreiben während eine
 * apply-Transaktion ihn gerade als Referenz festschreibt (und umgekehrt).
 */
export const VPI_ADVISORY_LOCK_ID = 7460000001n;
