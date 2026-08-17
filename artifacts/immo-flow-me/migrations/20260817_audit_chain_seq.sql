-- SECURITY PUNKT 6: monotone Append-Reihenfolge fuer HMAC-Kette
-- chain_seq: wird unter Advisory Lock vergeben, sortierbar unabhaengig von created_at
-- hmac_version: 'v3' fuer neue Eintraege; NULL oder andere Werte = Legacy-Zeile (wird bei Verifikation uebersprungen)

CREATE SEQUENCE IF NOT EXISTS audit_chain_seq START 1;

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS chain_seq  bigint,
  ADD COLUMN IF NOT EXISTS hmac_version text;

-- Index für schnelle Verifikations-Abfrage nach seq
CREATE INDEX IF NOT EXISTS idx_audit_logs_chain_seq ON audit_logs (chain_seq) WHERE chain_seq IS NOT NULL;
