import { sql } from "drizzle-orm";

export async function up(db: any) {
  await db.execute(sql`
    ALTER TABLE monthly_invoices
    ADD COLUMN IF NOT EXISTS paid_amount numeric(12,2) DEFAULT 0;
  `);

  await db.execute(sql`
    ALTER TABLE monthly_invoices
    ADD COLUMN IF NOT EXISTS version integer DEFAULT 1 NOT NULL;
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'monthly_invoices_unique_tenant_period'
      ) THEN
        ALTER TABLE monthly_invoices
        ADD CONSTRAINT monthly_invoices_unique_tenant_period UNIQUE (tenant_id, year, month);
      END IF;
    END$$;
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'monthly_invoices_vat_check'
      ) THEN
        ALTER TABLE monthly_invoices
        ADD CONSTRAINT monthly_invoices_vat_check CHECK (
          ust_satz_miete IN (0,10,13,20)
          AND ust_satz_bk IN (0,10,13,20)
          AND ust_satz_heizung IN (0,10,13,20)
        );
      END IF;
    END$$;
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_invoices_tenant_period ON monthly_invoices (tenant_id, year, month);
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice_id ON invoice_lines (invoice_id);
  `);
}

export async function down(db: any) {
  await db.execute(sql`DROP INDEX IF EXISTS idx_invoice_lines_invoice_id;`);
  await db.execute(sql`DROP INDEX IF EXISTS idx_invoices_tenant_period;`);
  await db.execute(sql`ALTER TABLE monthly_invoices DROP CONSTRAINT IF EXISTS monthly_invoices_vat_check;`);
  await db.execute(sql`ALTER TABLE monthly_invoices DROP CONSTRAINT IF EXISTS monthly_invoices_unique_tenant_period;`);
  await db.execute(sql`ALTER TABLE monthly_invoices DROP COLUMN IF EXISTS paid_amount;`);
  await db.execute(sql`ALTER TABLE monthly_invoices DROP COLUMN IF EXISTS version;`);
}
