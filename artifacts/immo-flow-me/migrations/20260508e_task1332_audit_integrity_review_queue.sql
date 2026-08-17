-- Migration: audit_integrity_review_queue schema
--
-- Creates the queue table that collects audit_logs / audit_events rows
-- with chain_hmac IS NULL for manual compliance review.
--
-- IMPORTANT: This migration contains ONLY the DDL (fast, ~1ms).
-- The heavy INSERT ... SELECT backfill (all existing NULL-chain rows)
-- runs in a deferred background job AFTER server.listen() via
-- server/lib/populateAuditIntegrityQueue.ts — it must never block startup.

CREATE TABLE IF NOT EXISTS audit_integrity_review_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table    TEXT NOT NULL
                  CHECK (source_table IN ('audit_logs', 'audit_events')),
  source_row_id   UUID NOT NULL,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  resolution_note TEXT,
  row_created_at  TIMESTAMPTZ,
  CONSTRAINT audit_integrity_review_queue_source_table_source_row_id_key
    UNIQUE (source_table, source_row_id)
);

CREATE INDEX IF NOT EXISTS idx_audit_integrity_queue_unresolved
  ON audit_integrity_review_queue (detected_at DESC)
  WHERE resolved_at IS NULL;
