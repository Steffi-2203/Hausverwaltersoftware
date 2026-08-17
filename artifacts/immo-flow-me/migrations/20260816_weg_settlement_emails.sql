-- Versand-Log für WEG-Jahresabrechnungen
-- Jeder E-Mail-Versand wird hier protokolliert (DSGVO-Nachweis, § 34 WEG 2002)

CREATE TABLE IF NOT EXISTS weg_settlement_emails (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id UUID        NOT NULL REFERENCES weg_settlements(id) ON DELETE CASCADE,
  owner_id      UUID        REFERENCES owners(id) ON DELETE SET NULL,
  email         TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'sent',   -- 'sent' | 'failed'
  error_message TEXT,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weg_settlement_emails_settlement_id
  ON weg_settlement_emails(settlement_id);

CREATE INDEX IF NOT EXISTS idx_weg_settlement_emails_owner_id
  ON weg_settlement_emails(owner_id);
