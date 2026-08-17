-- Migration: Invoice Lines, Expense Allocations, Constraints & Indexes
-- Created: 2026-02-01
-- Description: Adds invoice_lines, expense_allocations tables and database constraints

-- ============================================
-- UP MIGRATION
-- ============================================

BEGIN;

-- 1. Create invoice_lines table (idempotent)
CREATE TABLE IF NOT EXISTS invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES monthly_invoices(id) ON DELETE CASCADE,
  expense_type VARCHAR(50) NOT NULL,
  description TEXT,
  net_amount NUMERIC(12,2) NOT NULL,
  vat_rate INTEGER NOT NULL CHECK (vat_rate IN (0, 10, 13, 20)),
  gross_amount NUMERIC(12,2) NOT NULL,
  allocation_reference VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create expense_allocations table (idempotent)
CREATE TABLE IF NOT EXISTS expense_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  allocated_net NUMERIC(12,2) NOT NULL,
  allocation_basis VARCHAR(50) NOT NULL,
  allocation_detail TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Add UNIQUE constraint on units(property_id, top_nummer)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'units_property_top_unique'
  ) THEN
    ALTER TABLE units ADD CONSTRAINT units_property_top_unique 
      UNIQUE (property_id, top_nummer);
  END IF;
END $$;

-- 4. Add VAT rate check constraints on monthly_invoices
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'monthly_invoices_ust_satz_miete_check'
  ) THEN
    ALTER TABLE monthly_invoices ADD CONSTRAINT monthly_invoices_ust_satz_miete_check 
      CHECK (ust_satz_miete IN (0, 10, 13, 20));
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'monthly_invoices_ust_satz_bk_check'
  ) THEN
    ALTER TABLE monthly_invoices ADD CONSTRAINT monthly_invoices_ust_satz_bk_check 
      CHECK (ust_satz_bk IN (0, 10, 13, 20));
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'monthly_invoices_ust_satz_heizung_check'
  ) THEN
    ALTER TABLE monthly_invoices ADD CONSTRAINT monthly_invoices_ust_satz_heizung_check 
      CHECK (ust_satz_heizung IN (0, 10, 13, 20));
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'monthly_invoices_ust_satz_wasser_check'
  ) THEN
    ALTER TABLE monthly_invoices ADD CONSTRAINT monthly_invoices_ust_satz_wasser_check 
      CHECK (ust_satz_wasser IN (0, 10, 13, 20));
  END IF;
END $$;

-- 5. Create indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice_id ON invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_expense_allocations_expense_id ON expense_allocations(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_allocations_unit_id ON expense_allocations(unit_id);
CREATE INDEX IF NOT EXISTS idx_invoices_unit_status_year_month ON monthly_invoices(unit_id, status, year, month);
CREATE INDEX IF NOT EXISTS idx_meter_readings_date ON meter_readings(meter_id, reading_date);
CREATE INDEX IF NOT EXISTS idx_tenants_unit_id ON tenants(unit_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_id ON payments(tenant_id);

COMMIT;

-- ============================================
-- DOWN MIGRATION (Rollback)
-- ============================================
-- To rollback, run the following commands manually:
--
-- DROP INDEX IF EXISTS idx_payments_tenant_id;
-- DROP INDEX IF EXISTS idx_tenants_unit_id;
-- DROP INDEX IF EXISTS idx_meter_readings_date;
-- DROP INDEX IF EXISTS idx_invoices_unit_status_year_month;
-- DROP INDEX IF EXISTS idx_expense_allocations_unit_id;
-- DROP INDEX IF EXISTS idx_expense_allocations_expense_id;
-- DROP INDEX IF EXISTS idx_invoice_lines_invoice_id;
-- 
-- ALTER TABLE monthly_invoices DROP CONSTRAINT IF EXISTS monthly_invoices_ust_satz_wasser_check;
-- ALTER TABLE monthly_invoices DROP CONSTRAINT IF EXISTS monthly_invoices_ust_satz_heizung_check;
-- ALTER TABLE monthly_invoices DROP CONSTRAINT IF EXISTS monthly_invoices_ust_satz_bk_check;
-- ALTER TABLE monthly_invoices DROP CONSTRAINT IF EXISTS monthly_invoices_ust_satz_miete_check;
-- ALTER TABLE units DROP CONSTRAINT IF EXISTS units_property_top_unique;
-- 
-- DROP TABLE IF EXISTS expense_allocations;
-- DROP TABLE IF EXISTS invoice_lines;
