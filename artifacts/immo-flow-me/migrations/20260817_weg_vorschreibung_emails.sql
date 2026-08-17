-- Migration: Versand-Log für WEG-Vorschreibungen
-- Analogon zur weg_settlement_emails-Tabelle für Jahresabrechnungen.
-- Ermöglicht das Anzeigen des letzten Versanddatums in der Vorschreibungsliste.

CREATE TABLE IF NOT EXISTS weg_vorschreibung_emails (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vorschreibung_id UUID NOT NULL REFERENCES monthly_invoices(id) ON DELETE CASCADE,
  owner_id         UUID REFERENCES owners(id) ON DELETE SET NULL,
  email            TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'sent',
  error_message    TEXT,
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weg_vorschreibung_emails_vorschreibung_id
  ON weg_vorschreibung_emails(vorschreibung_id);

CREATE INDEX IF NOT EXISTS idx_weg_vorschreibung_emails_owner_id
  ON weg_vorschreibung_emails(owner_id);
