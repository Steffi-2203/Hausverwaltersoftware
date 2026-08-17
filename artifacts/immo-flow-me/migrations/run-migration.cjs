const { Pool } = require("pg");

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    // Execute migration SQL directly
    await client.query(`
      ALTER TABLE monthly_invoices
      ADD COLUMN IF NOT EXISTS paid_amount numeric(12,2) DEFAULT 0;
    `);

    await client.query(`
      ALTER TABLE monthly_invoices
      ADD COLUMN IF NOT EXISTS version integer DEFAULT 1 NOT NULL;
    `);

    await client.query(`
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

    await client.query(`
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

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_invoices_tenant_period ON monthly_invoices (tenant_id, year, month);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice_id ON invoice_lines (invoice_id);
    `);

    console.log("Migration applied successfully");
  } catch (err) {
    console.error("Migration failed", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
