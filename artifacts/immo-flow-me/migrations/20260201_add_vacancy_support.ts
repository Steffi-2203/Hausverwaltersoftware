import { db } from "../server/db";
import { sql } from "drizzle-orm";

export async function runMigration() {
  console.log("Running migration: add_vacancy_support");

  // 1. Add leerstand BK/HK fields to units table
  await db.execute(sql`
    ALTER TABLE units
    ADD COLUMN IF NOT EXISTS leerstand_bk numeric(10,2) DEFAULT '0',
    ADD COLUMN IF NOT EXISTS leerstand_hk numeric(10,2) DEFAULT '0'
  `);
  console.log("Added leerstand_bk and leerstand_hk columns to units");

  // 2. Add isVacancy flag to monthly_invoices
  await db.execute(sql`
    ALTER TABLE monthly_invoices
    ADD COLUMN IF NOT EXISTS is_vacancy boolean DEFAULT false
  `);
  console.log("Added is_vacancy column to monthly_invoices");

  // 3. Make tenantId nullable for vacancy invoices
  await db.execute(sql`
    ALTER TABLE monthly_invoices
    ALTER COLUMN tenant_id DROP NOT NULL
  `);
  console.log("Made tenant_id nullable in monthly_invoices for vacancy invoices");

  // 4. Add unique index for vacancy invoices (prevents duplicates under re-runs/concurrency)
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_invoices_vacancy_unique
    ON monthly_invoices (unit_id, year, month)
    WHERE is_vacancy = true
  `);
  console.log("Added unique index for vacancy invoices (unit_id, year, month where is_vacancy=true)");

  console.log("Migration complete: add_vacancy_support");
}

// Run migration if executed directly
runMigration()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
