-- Sicherheits-Fix: org-spezifischer API-Key für /api/readonly/*
-- Verhindert Cross-Org-Zugriff: ein Key darf nur auf die eigene Organisation zugreifen.
-- Wenn readonly_api_key NULL → Fallback auf globalen READONLY_API_KEY env var (Abwärtskompatibilität).

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS readonly_api_key TEXT;

-- Index beschleunigt die Lookup-Query in apiKeyAuth
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_readonly_api_key
  ON organizations (readonly_api_key)
  WHERE readonly_api_key IS NOT NULL;
