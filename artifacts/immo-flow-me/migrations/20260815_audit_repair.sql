-- ============================================================================
-- Audit-Reparatur 2026-08-15
-- Behebt: K3 (auth_tokens fehlt im Schema), K5 (Belegnummern-Race),
--         M4 (period_locks wurde zur Laufzeit erzeugt)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- K3: auth_tokens wurde von server/auth.ts und twoFactorRoutes.ts benutzt,
--     existierte aber in keiner Migration. Auf einer frischen Datenbank brach
--     damit der Login-Pfad, der Tokens ausstellt.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_tokens_token_key ON auth_tokens (token);
CREATE INDEX IF NOT EXISTS auth_tokens_user_id_idx ON auth_tokens (user_id);
CREATE INDEX IF NOT EXISTS auth_tokens_expires_at_idx ON auth_tokens (expires_at);

-- Abgelaufene Tokens aufräumen (idempotent, läuft bei jedem Deploy mit)
DELETE FROM auth_tokens WHERE expires_at < NOW() - INTERVAL '7 days';

-- ---------------------------------------------------------------------------
-- M4: period_locks regulär statt CREATE TABLE IF NOT EXISTS zur Laufzeit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS period_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_by UUID NOT NULL,
  UNIQUE (organization_id, year, month)
);

CREATE INDEX IF NOT EXISTS period_locks_org_idx ON period_locks (organization_id, year, month);

-- ---------------------------------------------------------------------------
-- K5: Belegnummern lückenlos (BAO §131).
--     Ohne Unique-Constraint konnten parallele Buchungen zwei Sequenzzeilen
--     für dasselbe Jahr anlegen und damit Nummern doppelt vergeben.
-- ---------------------------------------------------------------------------
DELETE FROM booking_number_sequences a
USING booking_number_sequences b
WHERE a.ctid < b.ctid
  AND a.organization_id = b.organization_id
  AND a.current_year = b.current_year;

CREATE UNIQUE INDEX IF NOT EXISTS booking_number_sequences_org_year_key
  ON booking_number_sequences (organization_id, current_year);

-- Belegnummer je Organisation eindeutig — nur anlegen, wenn der Bestand
-- sauber ist. Bestehende Dubletten werden nicht stillschweigend gelöscht,
-- sondern als Warnung ausgegeben und im Betrieb manuell bereinigt.
DO $$
DECLARE dupes INTEGER;
BEGIN
  SELECT COUNT(*) INTO dupes FROM (
    SELECT organization_id, booking_number
    FROM journal_entries
    WHERE booking_number IS NOT NULL
    GROUP BY organization_id, booking_number
    HAVING COUNT(*) > 1
  ) d;

  IF dupes = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_org_booking_number_key
      ON journal_entries (organization_id, booking_number)
      WHERE booking_number IS NOT NULL;
  ELSE
    RAISE WARNING 'journal_entries: % doppelte Belegnummern gefunden — Unique-Index nicht angelegt. Bitte bereinigen (siehe MIGRATION_GUIDE.md).', dupes;
  END IF;
END $$;
