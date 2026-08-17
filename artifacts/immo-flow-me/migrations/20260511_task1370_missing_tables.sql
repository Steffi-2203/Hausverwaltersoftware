-- Task #1370: Fehlende Spalten ergänzen + neue Tabellen + MRG-Saldo-View
-- Alle Statements idempotent (IF NOT EXISTS / OR REPLACE / ADD COLUMN IF NOT EXISTS)
--
-- Replit-Hinweis: Auf einer frischen Datenbank existieren audit_events,
-- webhook_deliveries und dunning_history nicht (sie sind nicht im Drizzle-Schema).
-- Die CREATE TABLE IF NOT EXISTS Blöcke unten erzeugen sie mit allen benötigten
-- Spalten, damit die ALTER TABLE ADD COLUMN IF NOT EXISTS Statements zu No-Ops werden.

-- ============================================================
-- 1. AUDIT_EVENTS – erzeugen falls nicht vorhanden, dann Spalten ergänzen
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor         TEXT,
  event_type    TEXT,
  chain_hmac    TEXT,
  target        TEXT,
  action        TEXT,
  metadata      JSONB DEFAULT '{}'::jsonb,
  hmac_chain    TEXT,
  previous_hmac TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS target        TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS action        TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS metadata      JSONB DEFAULT '{}'::jsonb;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS hmac_chain    TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS previous_hmac TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_events_action     ON audit_events (action);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor      ON audit_events (actor);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events (created_at DESC);

-- ============================================================
-- 2. WEBHOOK_DELIVERIES – erzeugen falls nicht vorhanden, dann Spalten ergänzen
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status          TEXT,
  attempt_count   INTEGER DEFAULT 0,
  last_error      TEXT,
  attempts        INTEGER DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  error_message   TEXT,
  signature       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS attempts        INTEGER DEFAULT 0;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS error_message   TEXT;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS signature       TEXT;

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status     ON webhook_deliveries (status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created_at ON webhook_deliveries (created_at DESC);

-- ============================================================
-- 3. DUNNING_HISTORY – erzeugen falls nicht vorhanden, dann Spalte ergänzen
-- ============================================================
CREATE TABLE IF NOT EXISTS dunning_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID,
  invoice_id      UUID,
  sent_at         TIMESTAMPTZ,
  level           INTEGER DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE dunning_history ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

-- ============================================================
-- 4. SUPPORT_ACCESS – neue Tabellen
-- ============================================================
CREATE TABLE IF NOT EXISTS support_access (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor       TEXT NOT NULL,
  target      TEXT NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'read',
  reason      TEXT,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  revoked_by  TEXT,
  metadata    JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_access_actor      ON support_access (actor);
CREATE INDEX IF NOT EXISTS idx_support_access_target     ON support_access (target);
CREATE INDEX IF NOT EXISTS idx_support_access_granted_at ON support_access (granted_at DESC);

CREATE TABLE IF NOT EXISTS support_access_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  TEXT NOT NULL DEFAULT 'unknown',
  actor       TEXT NOT NULL DEFAULT 'system',
  target      TEXT,
  metadata    JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE support_access_logs ADD COLUMN IF NOT EXISTS access_id   UUID;
ALTER TABLE support_access_logs ADD COLUMN IF NOT EXISTS event_type  TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE support_access_logs ADD COLUMN IF NOT EXISTS actor       TEXT NOT NULL DEFAULT 'system';
ALTER TABLE support_access_logs ADD COLUMN IF NOT EXISTS target      TEXT;

CREATE INDEX IF NOT EXISTS idx_support_access_logs_access_id  ON support_access_logs (access_id);
CREATE INDEX IF NOT EXISTS idx_support_access_logs_created_at ON support_access_logs (created_at DESC);

-- ============================================================
-- 5. MRG-SALDO-VIEW (Mieter-Saldo: Soll vs. Ist)
--    v_tenant_saldo existiert bereits — mrg_tenant_saldo neu erstellen
-- ============================================================
CREATE OR REPLACE VIEW mrg_tenant_saldo AS
SELECT
  t.id                                              AS tenant_id,
  t.unit_id,
  t.first_name || ' ' || t.last_name               AS tenant_name,
  COALESCE(SUM(mi.gesamtbetrag), 0)::NUMERIC(12,2) AS total_soll,
  COALESCE(SUM(pa.paid_per_invoice), 0)::NUMERIC(12,2) AS total_ist,
  (
    COALESCE(SUM(pa.paid_per_invoice), 0)
    - COALESCE(SUM(mi.gesamtbetrag), 0)
  )::NUMERIC(12,2)                                  AS saldo
FROM tenants t
LEFT JOIN monthly_invoices mi
       ON mi.tenant_id = t.id
LEFT JOIN (
  SELECT
    invoice_id,
    SUM(applied_amount) AS paid_per_invoice
  FROM payment_allocations
  GROUP BY invoice_id
) pa ON pa.invoice_id = mi.id
GROUP BY t.id, t.unit_id, t.first_name, t.last_name;
