import { db } from "../server/db";
import { sql } from "drizzle-orm";

export async function runMigration() {
  console.log("Running migration: add_leases_and_allocations");

  // 1. Create lease_status enum
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE lease_status AS ENUM ('aktiv', 'beendet', 'gekuendigt');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);
  console.log("Created lease_status enum");

  // 2. Create leases table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS leases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      unit_id UUID NOT NULL REFERENCES units(id),
      start_date DATE NOT NULL,
      end_date DATE,
      grundmiete NUMERIC(10,2) NOT NULL,
      betriebskosten_vorschuss NUMERIC(10,2) DEFAULT '0',
      heizungskosten_vorschuss NUMERIC(10,2) DEFAULT '0',
      wasserkosten_vorschuss NUMERIC(10,2) DEFAULT '0',
      kaution NUMERIC(10,2),
      kaution_bezahlt BOOLEAN DEFAULT false,
      status lease_status DEFAULT 'aktiv',
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    )
  `);
  console.log("Created leases table");

  // 3. Add unique index for leases
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS leases_tenant_unit_start_unique 
    ON leases (tenant_id, unit_id, start_date)
  `);
  console.log("Created unique index for leases");

  // 4. Create payment_allocations table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS payment_allocations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      payment_id UUID NOT NULL REFERENCES payments(id),
      invoice_id UUID NOT NULL REFERENCES monthly_invoices(id),
      applied_amount NUMERIC(10,2) NOT NULL,
      allocation_type TEXT DEFAULT 'miete',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    )
  `);
  console.log("Created payment_allocations table");

  // 5. Add indexes for faster lookups
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment_id ON payment_allocations(payment_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_payment_allocations_invoice_id ON payment_allocations(invoice_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_leases_tenant_id ON leases(tenant_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_leases_unit_id ON leases(unit_id)
  `);
  console.log("Created indexes for leases and payment_allocations");

  console.log("Migration complete: add_leases_and_allocations");
}

// Run migration if executed directly
runMigration()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
