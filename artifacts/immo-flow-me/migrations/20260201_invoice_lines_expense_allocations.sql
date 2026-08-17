-- ============================================================================
-- Migration: invoice_lines und expense_allocations
-- Datum: 2026-02-01
-- Beschreibung: Fügt Tabellen für Rechnungspositionen und Kostenverteilung hinzu
-- ============================================================================

-- ============================================================================
-- UP MIGRATION
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Tabelle: invoice_lines
-- Beschreibung: Speichert einzelne Rechnungspositionen pro monthly_invoice
-- Beziehung: N:1 zu monthly_invoices
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES monthly_invoices(id) ON DELETE CASCADE,
    expense_type VARCHAR(50) NOT NULL,
    description TEXT,
    net_amount NUMERIC(12, 2) NOT NULL,
    vat_rate INTEGER NOT NULL,
    gross_amount NUMERIC(12, 2) NOT NULL,
    allocation_reference VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index für schnelle Abfragen nach Rechnung
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice_id ON invoice_lines(invoice_id);

-- Check Constraint für gültige USt-Sätze (österreichisches Recht)
-- Nur anwenden wenn vat_rate-Spalte existiert (neueres Schema verwendet tax_rate).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'invoice_lines' AND column_name = 'vat_rate'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoice_lines_vat_rate'
    ) THEN
        ALTER TABLE invoice_lines ADD CONSTRAINT chk_invoice_lines_vat_rate 
        CHECK (vat_rate IN (0, 10, 13, 20));
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Tabelle: expense_allocations
-- Beschreibung: Speichert Kostenverteilung pro Einheit basierend auf Verteilerschlüssel
-- Beziehung: N:1 zu expenses, N:1 zu units
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    allocated_net NUMERIC(12, 2) NOT NULL,
    allocation_basis VARCHAR(50) NOT NULL,
    allocation_detail TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indices für Performance
CREATE INDEX IF NOT EXISTS idx_expense_allocations_expense_id ON expense_allocations(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_allocations_unit_id ON expense_allocations(unit_id);

-- Unique Constraint: Eine Ausgabe kann nur einmal pro Einheit zugeordnet werden
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_expense_allocation_expense_unit'
    ) THEN
        ALTER TABLE expense_allocations ADD CONSTRAINT uq_expense_allocation_expense_unit 
        UNIQUE (expense_id, unit_id);
    END IF;
END $$;

COMMIT;

-- ============================================================================
-- DOWN MIGRATION (ROLLBACK)
-- ============================================================================
-- ACHTUNG: Bei Rollback gehen alle Daten in diesen Tabellen verloren!
-- Vor Ausführung: Daten exportieren mit:
--   COPY invoice_lines TO '/tmp/invoice_lines_backup.csv' WITH CSV HEADER;
--   COPY expense_allocations TO '/tmp/expense_allocations_backup.csv' WITH CSV HEADER;
-- ============================================================================

-- BEGIN;
-- DROP TABLE IF EXISTS expense_allocations CASCADE;
-- DROP TABLE IF EXISTS invoice_lines CASCADE;
-- COMMIT;
