-- Finanzfolgen brauchen eine stabile Herkunft, damit Retry- und Parallelpfade
-- dieselbe Buchung wiederfinden statt eine zweite Geldbewegung anzulegen.

ALTER TABLE monthly_invoices
  ADD COLUMN IF NOT EXISTS settlement_source_type TEXT,
  ADD COLUMN IF NOT EXISTS settlement_detail_id UUID;

ALTER TABLE weg_vorschreibungen
  ADD COLUMN IF NOT EXISTS settlement_source_type TEXT,
  ADD COLUMN IF NOT EXISTS settlement_detail_id UUID;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS import_hash TEXT,
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NOT NULL DEFAULT 'unmatched',
  ADD COLUMN IF NOT EXISTS reconciliation_reason TEXT;

CREATE TABLE IF NOT EXISTS settlement_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  property_id UUID NOT NULL REFERENCES properties(id),
  unit_id UUID NOT NULL REFERENCES units(id),
  tenant_id UUID REFERENCES tenants(id),
  owner_id UUID REFERENCES owners(id),
  settlement_id UUID NOT NULL,
  settlement_source_type TEXT NOT NULL,
  settlement_detail_id UUID NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'offen',
  faellig_am DATE,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((tenant_id IS NOT NULL) <> (owner_id IS NOT NULL))
);

-- Preserve financial totals while consolidating historical duplicate
-- allocations. The earliest allocation remains as the immutable proof.
-- This controlled migration is the only place that consolidates legacy
-- duplicates. It runs atomically and immediately reinstates append-only
-- protection; any error rolls back the trigger state with the data changes.
ALTER TABLE payment_allocations DISABLE TRIGGER trg_payment_allocations_immutable;
WITH ranked AS (
  SELECT id, payment_id, invoice_id,
         row_number() OVER (PARTITION BY payment_id, invoice_id ORDER BY created_at, id) AS rn,
         sum(applied_amount::numeric) OVER (PARTITION BY payment_id, invoice_id) AS combined_amount
  FROM payment_allocations
), merged AS (
  UPDATE payment_allocations a
  SET applied_amount = r.combined_amount
  FROM ranked r WHERE a.id = r.id AND r.rn = 1
  RETURNING a.id
)
DELETE FROM payment_allocations a
USING ranked r WHERE a.id = r.id AND r.rn > 1;
ALTER TABLE payment_allocations ENABLE TRIGGER trg_payment_allocations_immutable;

-- A legacy payment may have been linked to the same bank line twice. Keep the
-- oldest source link; retain the later payment itself (and its allocations)
-- as an unlinked, visible historical payment rather than deleting money data.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY transaction_id ORDER BY created_at, id) AS rn
  FROM payments WHERE transaction_id IS NOT NULL
)
UPDATE payments p SET transaction_id = NULL
FROM ranked r WHERE p.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_org_import_hash
  ON transactions (organization_id, import_hash)
  WHERE import_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_transaction_id
  ON payments (transaction_id)
  WHERE transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_allocations_payment_invoice
  ON payment_allocations (payment_id, invoice_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_invoices_settlement_detail
  ON monthly_invoices (settlement_source_type, settlement_detail_id)
  WHERE settlement_source_type IS NOT NULL AND settlement_detail_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_weg_vorschreibungen_settlement_detail
  ON weg_vorschreibungen (settlement_source_type, settlement_detail_id)
  WHERE settlement_source_type IS NOT NULL AND settlement_detail_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_credits_source_detail
  ON settlement_credits (settlement_source_type, settlement_detail_id);
CREATE INDEX IF NOT EXISTS idx_settlement_credits_org_status
  ON settlement_credits (organization_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entries_settlement_source
  ON journal_entries (organization_id, source_type, source_id)
  WHERE source_type IN ('bk_settlement_detail', 'weg_settlement_detail');

COMMENT ON COLUMN transactions.import_hash IS
  'Deterministischer CAMT-Importschlüssel; derselbe Bankumsatz kann nur einmal importiert werden.';
COMMENT ON COLUMN transactions.reconciliation_status IS
  'Sichtbarer Klärungszustand für Bankeingänge. Mehrdeutige Treffer werden nie automatisch gebucht.';