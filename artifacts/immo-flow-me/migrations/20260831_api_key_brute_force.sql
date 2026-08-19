-- Dauerhafte Brute-Force-Sperren fuer den API-Key-Readonly-Zugriff.
-- Die Tabelle enthaelt keine Organisationsdaten und wird nicht durch RLS
-- eingeschraenkt; der Middleware-Pfad laeuft bewusst vor dem Org-Kontext.
CREATE TABLE IF NOT EXISTS api_key_brute_force (
  key_hash TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_key_brute_force_blocked_until
  ON api_key_brute_force (blocked_until)
  WHERE blocked_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_api_key_brute_force_updated_at
  ON api_key_brute_force (updated_at);