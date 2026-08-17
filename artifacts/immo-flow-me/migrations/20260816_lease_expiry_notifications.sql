-- Migration: Automatische E-Mail-Erinnerungen bei auslaufenden Mietvertraegen
-- Fuegt zwei Einstellungsspalten zur organizations-Tabelle hinzu und
-- erstellt eine Dedup-Tabelle damit keine Erinnerung zweimal gesendet wird.

-- 1. Einstellungen pro Organisation
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS lease_expiry_notifications_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS lease_expiry_thresholds integer[] NOT NULL DEFAULT '{90,60,30}';

-- 2. Dedup-Tabelle: eine Zeile pro (Mietvertrag, Schwellenwert)
--    UNIQUE verhindert Doppelversand auch bei parallelen Laeufen.
CREATE TABLE IF NOT EXISTS lease_expiry_notifications (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lease_id          uuid        NOT NULL REFERENCES leases(id)        ON DELETE CASCADE,
  days_threshold    integer     NOT NULL,
  sent_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lease_id, days_threshold)
);

CREATE INDEX IF NOT EXISTS idx_lease_expiry_notif_org
  ON lease_expiry_notifications (organization_id);

CREATE INDEX IF NOT EXISTS idx_lease_expiry_notif_lease
  ON lease_expiry_notifications (lease_id);
