-- Eingangsrechnungen (Lieferantenrechnungen) mit doppelter Buchführung
-- Ermöglicht die revisionssichere Erfassung von Lieferantenrechnungen mit
-- automatischer doppelter Buchung ins Journal (Aufwand / Verbindlichkeit).

CREATE TABLE IF NOT EXISTS incoming_invoices (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES organizations(id),
  property_id       UUID        REFERENCES properties(id),
  vendor_name       TEXT        NOT NULL,
  vendor_iban       TEXT,
  invoice_number    TEXT,
  invoice_date      DATE        NOT NULL,
  due_date          DATE,
  amount_net        NUMERIC(12, 2) NOT NULL CHECK (amount_net >= 0),
  vat_rate          NUMERIC(5, 2) NOT NULL DEFAULT 20,
  vat_amount        NUMERIC(12, 2) GENERATED ALWAYS AS (ROUND(amount_net * vat_rate / 100, 2)) STORED,
  amount_gross      NUMERIC(12, 2) GENERATED ALWAYS AS (amount_net + ROUND(amount_net * vat_rate / 100, 2)) STORED,
  description       TEXT        NOT NULL,
  category          TEXT        NOT NULL DEFAULT 'sonstige',
  status            TEXT        NOT NULL DEFAULT 'offen' CHECK (status IN ('offen', 'bezahlt', 'storniert')),
  journal_entry_id  UUID        REFERENCES journal_entries(id),
  paid_at           DATE,
  paid_by           TEXT,
  created_by        TEXT,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_incoming_invoices_org
  ON incoming_invoices (organization_id, invoice_date DESC);

CREATE INDEX IF NOT EXISTS idx_incoming_invoices_property
  ON incoming_invoices (property_id, invoice_date DESC);

COMMENT ON TABLE incoming_invoices IS
  'Eingangsrechnungen von Lieferanten mit automatischer Journal-Buchung (Aufwand/Verbindlichkeit).';
