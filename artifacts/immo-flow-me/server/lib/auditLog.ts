import crypto from "crypto";
import { rootDb as db } from "../db"; // Audit-Log ist system-global; kein RLS-Org-Proxy nötig
import { auditLogs } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import * as schema from "@shared/schema";

export type AuditAction = 'create' | 'update' | 'delete' | 'soft_delete' | 'restore' | 'bulk_create' | 'ocr_correction';

type TransactionType = PgTransaction<PostgresJsQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

interface AuditLogParams {
  userId?: string;
  tableName: string;
  recordId: string;
  /** Standard CRUD actions or 'ocr_correction' for OCR audit entries. */
  action: AuditAction | string;
  oldData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
  /** Extra metadata stored alongside the HMAC-protected oldData/newData.
   *  Not included in the HMAC payload — use oldData/newData for tamper-evident content. */
  details?: Record<string, unknown> | null;
  ipAddress?: string;
  userAgent?: string;
}

// ─── HMAC key ────────────────────────────────────────────────────────────────
// Fail loudly if neither AUDIT_HMAC_KEY nor SESSION_SECRET is set.
// A known fallback would allow any attacker with repository read access to forge audit
// records, undermining the entire tamper-evidence chain.
const _auditHmacKey: string | undefined =
  process.env.AUDIT_HMAC_KEY || process.env.SESSION_SECRET;

if (!_auditHmacKey) {
  const msg =
    "FATAL: No audit HMAC secret configured. " +
    "Set AUDIT_HMAC_KEY (preferred) or SESSION_SECRET. " +
    "Audit writes will be disabled until a secret is provided.";
  console.error(msg);
}

const AUDIT_HMAC_KEY: string = _auditHmacKey ?? "";

// Current HMAC schema version for all new writes.
// v3 = legacy format (chain_seq + all payload fields, hmac_version NOT signed).
//      Rows written before version-prefixed signing was introduced.
// v4 = hmac_version signed FIRST; downgrade attacks detectable.
// v5 = v4 + details column included in signed payload;
//      audit metadata (changes dict, file_name, confidence_score) is now tamper-evident.
// Incrementing the version on format change ensures old rows remain verifiable
// with their original algorithm and new rows use the improved one.
const HMAC_VERSION = "v5";

// Advisory lock key (fixed 64-bit int) — serialises all chain writers.
const LOCK_KEY = 6_917_529_027_641_081_856n;

// ─── Canonical HMAC ──────────────────────────────────────────────────────────

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj).sort().map((k) => [k, sortKeysDeep(obj[k])]),
    );
  }
  return value;
}

/** Fields common to all HMAC versions. */
interface CommonHmacEntry {
  id: string;
  tableName: string;
  recordId: string;
  action: string;
  chainSeq: number;
  userId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  oldData: unknown;
  newData: unknown;
  previousHmac: string | null;
}

/**
 * v3 HMAC — the legacy wire format used before version-prefixed signing was introduced.
 *
 * Wire format (pipe-separated, NO version prefix):
 *   id | tableName | recordId | action | chainSeq | userId | ipAddress |
 *   userAgent | oldData(JSON sorted) | newData(JSON sorted) | previousHmac
 *
 * This is the format written by code that stored hmac_version='v3' rows.
 * Kept read-only for backward-compatible verification; all new writes use v4.
 */
function computeHmacV3(entry: CommonHmacEntry): string {
  const stable = (v: unknown) => v == null ? "" : JSON.stringify(sortKeysDeep(v));
  const message = [
    entry.id,
    entry.tableName,
    entry.recordId,
    entry.action,
    String(entry.chainSeq),
    entry.userId ?? "",
    entry.ipAddress ?? "",
    entry.userAgent ?? "",
    stable(entry.oldData),
    stable(entry.newData),
    entry.previousHmac ?? "",
  ].join("|");
  return crypto.createHmac("sha256", AUDIT_HMAC_KEY).update(message).digest("hex");
}

/**
 * v4 HMAC (hmac_version signed FIRST — downgrade attacks are detectable).
 * Kept read-only for backward-compatible verification; all new writes use v5.
 *
 * Signed fields (pipe-separated):
 *   hmacVersion | id | tableName | recordId | action | chainSeq | userId |
 *   ipAddress | userAgent | oldData(JSON sorted) | newData(JSON sorted) | previousHmac
 */
function computeHmacV4(entry: CommonHmacEntry & { hmacVersion: string }): string {
  const stable = (v: unknown) => v == null ? "" : JSON.stringify(sortKeysDeep(v));
  const message = [
    entry.hmacVersion,          // signed first — version downgrade is detectable
    entry.id, entry.tableName, entry.recordId, entry.action,
    String(entry.chainSeq),
    entry.userId ?? "", entry.ipAddress ?? "", entry.userAgent ?? "",
    stable(entry.oldData), stable(entry.newData),
    entry.previousHmac ?? "",
  ].join("|");
  return crypto.createHmac("sha256", AUDIT_HMAC_KEY).update(message).digest("hex");
}

/**
 * v5 HMAC — adds `details` to the signed payload so audit metadata is tamper-evident.
 * All new audit entries are signed with this function.
 *
 * Signed fields (pipe-separated):
 *   hmacVersion | id | tableName | recordId | action | chainSeq | userId |
 *   ipAddress | userAgent | oldData(JSON sorted) | newData(JSON sorted) | previousHmac |
 *   details(JSON sorted)   ← NEW in v5
 */
function computeHmacV5(entry: CommonHmacEntry & { hmacVersion: string; details: unknown }): string {
  const stable = (v: unknown) => v == null ? "" : JSON.stringify(sortKeysDeep(v));
  const message = [
    entry.hmacVersion,
    entry.id, entry.tableName, entry.recordId, entry.action,
    String(entry.chainSeq),
    entry.userId ?? "", entry.ipAddress ?? "", entry.userAgent ?? "",
    stable(entry.oldData), stable(entry.newData),
    entry.previousHmac ?? "",
    stable(entry.details),  // details signed at the end — appending preserves v4 prefix structure
  ].join("|");
  return crypto.createHmac("sha256", AUDIT_HMAC_KEY).update(message).digest("hex");
}

/**
 * Dispatch to the correct HMAC algorithm based on the stored hmac_version.
 * Exported so proof tests can mirror the exact computation.
 */
export function computeEntryHmac(
  entry: CommonHmacEntry & { hmacVersion: string; details?: unknown },
): string {
  if (entry.hmacVersion === "v3") return computeHmacV3(entry);
  if (entry.hmacVersion === "v4") return computeHmacV4({ ...entry, hmacVersion: "v4" });
  // v5+: details is included in the signed payload
  return computeHmacV5({ ...entry, hmacVersion: entry.hmacVersion, details: entry.details ?? null });
}

// ─── Chain anchor (genesis + high-watermark) ──────────────────────────────────
//
// The anchor is a single-row table that persists across restarts.
// It lets verifyAuditChain() detect:
//   • Leading deletions — first DB row's seq ≠ anchor.genesis_seq.
//   • Tail deletions   — last processed row's seq < anchor.hwm_seq.
// Both are invisible to a pure previous_hmac pointer walk.
//
// The anchor IS NOT a security boundary in isolation; its value is in giving
// the verifier a durable reference point. It is updated inside the same
// advisory-locked transaction as the audit row, so it is always consistent
// with the committed chain.

let anchorTableReady = false;

async function ensureAnchorTable(): Promise<void> {
  if (anchorTableReady) return;
  // In production the migration 20260815_audit_chain_anchor.sql creates the table
  // before the server starts.  We verify existence first and only fall back to DDL
  // in development / test environments where a least-privilege role may be absent.
  const check = (await db.execute(sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name   = 'audit_chain_anchor'
    ) AS exists
  `)).rows[0] as { exists: boolean };
  if (check.exists) {
    anchorTableReady = true;
    return;
  }
  // Fallback DDL — only reached in dev/test where the migration has not run.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS audit_chain_anchor (
      id          TEXT PRIMARY KEY,
      genesis_seq BIGINT NOT NULL,
      hwm_seq     BIGINT NOT NULL,
      hwm_hmac    TEXT   NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  anchorTableReady = true;
}

// ─── Serialised chain append ──────────────────────────────────────────────────

async function appendAuditEntryLocked(params: AuditLogParams): Promise<void> {
  if (!AUDIT_HMAC_KEY) {
    throw new Error(
      "Audit HMAC secret not configured (AUDIT_HMAC_KEY / SESSION_SECRET) — " +
      "cannot write tamper-evident audit entry"
    );
  }
  // Ensure anchor table exists before opening the transaction.
  await ensureAnchorTable();
  await db.transaction(async (tx) => {
    // 1. Advisory lock — only one writer proceeds at a time.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);

    // 2. Monotone sequence number assigned UNDER the lock.
    const seqResult = await tx.execute(sql`SELECT nextval('audit_chain_seq') AS seq`);
    const chainSeq = Number((seqResult.rows[0] as { seq: string }).seq);

    // 3. Latest link (ordered by chain_seq — lock order, not created_at).
    const latestRows = await tx.execute(sql`
      SELECT chain_hmac FROM audit_logs
      WHERE chain_seq IS NOT NULL AND chain_seq < ${chainSeq}
      ORDER BY chain_seq DESC
      LIMIT 1
    `);
    const previousHmac =
      ((latestRows.rows[0] as { chain_hmac: string | null } | undefined)?.chain_hmac) ?? null;

    // 4. INSERT.
    const inserted = await tx
      .insert(auditLogs)
      .values({
        userId: params.userId || null,
        tableName: params.tableName,
        recordId: params.recordId,
        action: params.action,
        oldData: params.oldData || null,
        newData: params.newData || null,
        details: params.details || null,
        ipAddress: params.ipAddress || null,
        userAgent: params.userAgent || null,
        previousHmac,
        chainSeq,
        hmacVersion: HMAC_VERSION,
      })
      .returning({ id: auditLogs.id });

    const row = inserted[0];
    if (!row) return;

    // 5. Compute v5 HMAC — details is now part of the signed payload.
    const chainHmac = computeHmacV5({
      hmacVersion: HMAC_VERSION,
      id: row.id,
      tableName: params.tableName,
      recordId: params.recordId,
      action: params.action,
      chainSeq,
      userId: params.userId || null,
      ipAddress: params.ipAddress || null,
      userAgent: params.userAgent || null,
      oldData: params.oldData || null,
      newData: params.newData || null,
      previousHmac,
      details: params.details || null,
    });

    // 6. Write HMAC back.
    await tx
      .update(auditLogs)
      .set({ chainHmac })
      .where(eq(auditLogs.id, row.id));

    // 7. Upsert chain anchor (genesis is set only once; hwm advances with every write).
    //    Runs inside the same advisory-locked transaction → always consistent with the chain.
    await tx.execute(sql`
      INSERT INTO audit_chain_anchor (id, genesis_seq, hwm_seq, hwm_hmac, updated_at)
      VALUES ('singleton', ${chainSeq}, ${chainSeq}, ${chainHmac}, NOW())
      ON CONFLICT (id) DO UPDATE SET
        hwm_seq    = EXCLUDED.hwm_seq,
        hwm_hmac   = EXCLUDED.hwm_hmac,
        updated_at = NOW()
    `);
  });
}

/**
 * FOR TESTING ONLY — clears the chain anchor so tests can establish a clean baseline.
 * Never call from production code.
 */
export async function resetAuditChainAnchorForTesting(): Promise<void> {
  await ensureAnchorTable();
  await db.execute(sql`DELETE FROM audit_chain_anchor`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Best-effort audit log write: errors are caught and logged but NOT propagated.
 * Use for non-critical audit trails where the main operation must not fail.
 */
export async function createAuditLog(params: AuditLogParams, _tx?: TransactionType): Promise<void> {
  try {
    await appendAuditEntryLocked(params);
  } catch (error) {
    console.error("Audit log error:", error);
  }
}

/**
 * Strict audit log write: errors are propagated to the caller.
 * Use for security-sensitive routes where the operation must NOT succeed
 * unless the audit entry has been durably committed.
 * Returns a rejected promise (→ 5xx) if the HMAC key is missing or the DB write fails.
 */
export async function createAuditLogStrict(params: AuditLogParams): Promise<void> {
  await appendAuditEntryLocked(params);
}

export async function writeAudit(
  _tx: TransactionType,
  userId: string | undefined,
  tableName: string,
  recordId: string,
  action: AuditAction,
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
): Promise<void> {
  return createAuditLog({
    userId,
    tableName,
    recordId,
    action,
    oldData: oldData ? sanitizeForAudit(oldData) : null,
    newData: newData ? sanitizeForAudit(newData) : null,
  });
}

/**
 * SECURITY PUNKT 6: Walk the full audit-log HMAC chain and verify integrity.
 *
 * Selection: all rows with chain_seq IS NOT NULL (lock-era rows), ordered by chain_seq ASC.
 * When called without arguments the chain anchor defines the verified window
 * (genesis → hwm), so leading and tail deletions are always detected.
 *
 * Rejection criteria for each lock-era row:
 *   • Leading deletion (no-fromSeq mode) — first row's seq ≠ anchor genesis_seq.
 *   • chain_hmac IS NULL                 → silently-cleared HMAC = tamper attempt.
 *   • hmac_version IS NULL               → version field wiped = tamper attempt.
 *   • hmac_version not in {v3,v4,v5}     → unexpected version = tamper attempt.
 *   • HMAC mismatch                      → content was altered.
 *   • previous_hmac pointer broken       → intermediate row(s) removed or chain forked.
 *     NOTE: PostgreSQL nextval() gaps from rolled-back transactions are legitimate
 *     and are NOT false-positives here — the pointer links to the actual previous
 *     committed entry regardless of sequence gaps.
 *   • Tail deletion (no-fromSeq mode)    — last row's seq < anchor hwm_seq.
 *
 * Legacy policy (the ONLY allowed bypass):
 *   Rows where chain_seq IS NULL were written before the sequence system existed.
 *   They have no HMAC and are skipped entirely.
 *
 * Version compatibility:
 *   v3 rows → verified with computeHmacV3 (no version prefix, no details).
 *   v4 rows → verified with computeHmacV4 (hmacVersion signed first, no details).
 *   v5 rows → verified with computeHmacV5 (hmacVersion + details both signed).
 *
 * @param limit   Maximum rows to verify in a single call (default 10 000).
 * @param fromSeq If supplied, verify only from this seq onwards (scoped mode).
 *                In scoped mode anchor-based leading/tail checks are SKIPPED;
 *                the pointer-chain check still detects intermediate deletions.
 */
export async function verifyAuditChain(
  limit = 10_000,
  fromSeq?: number,
): Promise<{ ok: true } | { ok: false; firstBadId: string; details: string }> {
  await ensureAnchorTable();

  // ── Read anchor ────────────────────────────────────────────────────────────
  const anchorRows = (await db.execute(
    sql`SELECT genesis_seq, hwm_seq FROM audit_chain_anchor WHERE id = 'singleton'`
  )).rows as Array<{ genesis_seq: string; hwm_seq: string }>;
  const anchor = anchorRows[0] ?? null;
  const anchorGenesisSeq = anchor ? Number(anchor.genesis_seq) : null;
  const anchorHwmSeq    = anchor ? Number(anchor.hwm_seq)     : null;

  // In full-chain mode (no fromSeq) start the query from the anchor's genesis so
  // the verifier owns a precise window — preventing pre-anchor legacy rows from
  // masking a deletion at the true genesis.
  const fullChain  = fromSeq === undefined;
  const effectiveStart = fromSeq ?? anchorGenesisSeq;

  // ── Fetch rows ─────────────────────────────────────────────────────────────
  const rows = (await db.execute(
    effectiveStart != null
      ? sql`SELECT id, table_name, record_id, action, chain_seq,
                   user_id, ip_address, user_agent,
                   old_data, new_data, details, chain_hmac, previous_hmac, hmac_version
            FROM audit_logs
            WHERE chain_seq IS NOT NULL AND chain_seq >= ${effectiveStart}
            ORDER BY chain_seq ASC
            LIMIT ${limit}`
      : sql`SELECT id, table_name, record_id, action, chain_seq,
                   user_id, ip_address, user_agent,
                   old_data, new_data, details, chain_hmac, previous_hmac, hmac_version
            FROM audit_logs
            WHERE chain_seq IS NOT NULL
            ORDER BY chain_seq ASC
            LIMIT ${limit}`
  )).rows as Array<{
    id: string; table_name: string; record_id: string; action: string;
    chain_seq: string; user_id: string | null; ip_address: string | null;
    user_agent: string | null; old_data: unknown; new_data: unknown; details: unknown;
    chain_hmac: string | null; previous_hmac: string | null;
    hmac_version: string | null;
  }>;

  // Empty chain with anchor present ⟹ everything was deleted.
  if (rows.length === 0 && anchor) {
    return {
      ok: false,
      firstBadId: '_empty',
      details: `chain is empty but anchor records genesis_seq=${anchorGenesisSeq} — all rows deleted`,
    };
  }

  let prevChainHmac: string | null = null;
  let prevSeq: number | null       = null;

  for (const row of rows) {
    const chainSeq = Number(row.chain_seq);

    // ── Leading deletion check (full-chain mode only) ─────────────────────
    // The anchor defines the genesis; if the first returned row is later, genesis was deleted.
    if (fullChain && prevSeq === null && anchorGenesisSeq !== null && chainSeq !== anchorGenesisSeq) {
      return {
        ok: false,
        firstBadId: row.id,
        details: `leading deletion: anchor genesis_seq=${anchorGenesisSeq}, first found row is seq=${chainSeq} — genesis entry deleted`,
      };
    }

    // ── Leading deletion check (scoped mode) ──────────────────────────────
    // When fromSeq is explicitly given, the first returned row must carry exactly that seq.
    if (!fullChain && prevSeq === null && fromSeq != null && chainSeq !== fromSeq) {
      return {
        ok: false,
        firstBadId: row.id,
        details: `leading deletion (scoped): expected first seq=${fromSeq}, got seq=${chainSeq}`,
      };
    }

    // ── chain_hmac null check ─────────────────────────────────────────────
    if (!row.chain_hmac) {
      return {
        ok: false,
        firstBadId: row.id,
        details: `chain_hmac is NULL on seq-tracked entry ${row.id} (seq=${chainSeq}) — tamper attempt`,
      };
    }

    // ── hmac_version validity ─────────────────────────────────────────────
    if (!row.hmac_version || !["v3", "v4", "v5"].includes(row.hmac_version)) {
      return {
        ok: false,
        firstBadId: row.id,
        details: `hmac_version '${row.hmac_version ?? "NULL"}' is invalid on seq=${chainSeq} — tamper attempt`,
      };
    }

    // ── HMAC verification ─────────────────────────────────────────────────
    const common: CommonHmacEntry = {
      id: row.id,
      tableName: row.table_name,
      recordId: row.record_id,
      action: row.action,
      chainSeq,
      userId: row.user_id,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      oldData: row.old_data,
      newData: row.new_data,
      previousHmac: row.previous_hmac,
    };
    let expected: string;
    if (row.hmac_version === "v3") {
      expected = computeHmacV3(common);
    } else if (row.hmac_version === "v4") {
      expected = computeHmacV4({ ...common, hmacVersion: "v4" });
    } else {
      expected = computeHmacV5({ ...common, hmacVersion: row.hmac_version, details: row.details ?? null });
    }
    const buf1 = Buffer.from(row.chain_hmac, "hex");
    const buf2 = Buffer.from(expected, "hex");
    if (buf1.length !== buf2.length || !crypto.timingSafeEqual(buf1, buf2)) {
      return {
        ok: false,
        firstBadId: row.id,
        details: `chainHmac mismatch on entry ${row.id} (seq=${chainSeq}, version=${row.hmac_version}, ${row.table_name}/${row.action})`,
      };
    }

    // ── Predecessor pointer check ─────────────────────────────────────────
    // Detects intermediate deletions regardless of sequence-number gaps.
    // A rolled-back nextval() gap is NOT a false positive: the previous_hmac still
    // points to the actual last committed row, so the pointer matches.
    if (prevChainHmac !== null && prevSeq !== null && row.previous_hmac !== null) {
      if (row.previous_hmac !== prevChainHmac) {
        return {
          ok: false,
          firstBadId: row.id,
          details: `previousHmac pointer broken at seq=${chainSeq} (expected seq=${prevSeq}'s hmac) — intermediate row deleted`,
        };
      }
    }

    prevChainHmac = row.chain_hmac;
    prevSeq = chainSeq;
  }

  // ── Tail deletion check (full-chain mode only) ───────────────────────────
  // Direct HWM existence check — this is O(1) and runs regardless of how many
  // rows the main loop processed.  Even if `limit` was reached (e.g. >10 000 rows),
  // a deletion of the current HWM entry is always caught here.
  if (fullChain && anchor && anchorHwmSeq !== null) {
    const hwmPresent = (await db.execute(
      sql`SELECT 1 FROM audit_logs WHERE chain_seq = ${anchorHwmSeq} LIMIT 1`
    )).rows.length > 0;
    if (!hwmPresent) {
      return {
        ok: false,
        firstBadId: `_tail_seq_${anchorHwmSeq}`,
        details: `tail deletion: anchor hwm_seq=${anchorHwmSeq} no longer present in audit_logs — trailing entry deleted`,
      };
    }
  }

  return { ok: true };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getClientInfo(req: any): { ipAddress: string; userAgent: string } {
  const ipAddress =
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.connection?.remoteAddress ||
    req.ip ||
    'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  return { ipAddress, userAgent };
}

export function sanitizeForAudit(data: Record<string, unknown>): Record<string, unknown> {
  const sensitiveFields = ['passwordHash', 'password', 'token', 'secret', 'apiKey'];
  const sanitized = { ...data };
  for (const field of sensitiveFields) {
    if (field in sanitized) {
      sanitized[field] = '[REDACTED]';
    }
  }
  return sanitized;
}
