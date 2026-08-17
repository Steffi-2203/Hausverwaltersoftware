-- Migration: Add paid_amount and version columns to monthly_invoices
-- Created: 2026-02-01
-- Description: Adds payment tracking columns and unique constraint for invoice generation

-- ============================================
-- UP MIGRATION
-- ============================================

BEGIN;

-- 1. Add paid_amount column for tracking payments directly on invoice
ALTER TABLE monthly_invoices
ADD COLUMN IF NOT EXISTS paid_amount numeric(12,2) DEFAULT 0;

-- 2. Add version column for optimistic locking
ALTER TABLE monthly_invoices
ADD COLUMN IF NOT EXISTS version integer DEFAULT 1 NOT NULL;

-- 3. Add unique constraint for tenant-period to prevent duplicate invoices
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'monthly_invoices_unique_tenant_period'
  ) THEN
    ALTER TABLE monthly_invoices 
      ADD CONSTRAINT monthly_invoices_unique_tenant_period 
      UNIQUE (tenant_id, year, month);
  END IF;
END $$;

-- 4. Create index for tenant-period lookups
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_period 
  ON monthly_invoices (tenant_id, year, month);

-- 5. Create index for invoice_lines lookups
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice_id 
  ON invoice_lines (invoice_id);

COMMIT;

-- ============================================
-- DOWN MIGRATION (Rollback)
-- ============================================
-- To rollback, run the following commands manually:
--
-- ALTER TABLE monthly_invoices DROP CONSTRAINT IF EXISTS monthly_invoices_unique_tenant_period;
-- DROP INDEX IF EXISTS idx_invoice_lines_invoice_id;
-- DROP INDEX IF EXISTS idx_invoices_tenant_period;
-- ALTER TABLE monthly_invoices DROP COLUMN IF EXISTS paid_amount;
-- ALTER TABLE monthly_invoices DROP COLUMN IF EXISTS version;
