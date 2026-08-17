-- SECURITY PUNKT 6b: Anker-Tabelle für die HMAC-Kette in audit_logs
-- Persistiert genesis_seq (erster je geschriebener Eintrag) und hwm_seq
-- (letzter bestätigter Eintrag) damit verifyAuditChain() ohne fromSeq
-- sowohl Leading- als auch Tail-Deletions erkennt.
--
-- Diese Tabelle wird INNERHALB der advisory-locked Transaktion in
-- appendAuditEntryLocked atomar mitgeschrieben (ON CONFLICT ... DO UPDATE).
-- genesis_seq wird beim ersten INSERT gesetzt und danach nie überschrieben.

CREATE TABLE IF NOT EXISTS audit_chain_anchor (
  id          TEXT PRIMARY KEY DEFAULT 'singleton',
  genesis_seq BIGINT      NOT NULL,
  hwm_seq     BIGINT      NOT NULL,
  hwm_hmac    TEXT        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
