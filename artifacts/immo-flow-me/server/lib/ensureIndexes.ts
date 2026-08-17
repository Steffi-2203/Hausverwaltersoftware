// Boot-time DDL-Helper: läuft ohne Request-Kontext (kein orgContext).
// Der `db`-Proxy wirft ohne orgContext — rootDb (Superuser) verwenden.
import { rootDb as db } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

async function ensureFinancialAuditLogTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS financial_audit_log (
        id UUID PRIMARY KEY,
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(100) NOT NULL,
        entity_id VARCHAR(255) NOT NULL,
        organization_id UUID NOT NULL,
        user_id UUID NOT NULL,
        data JSONB DEFAULT '{}'::jsonb,
        previous_hash VARCHAR(64) NOT NULL,
        hash VARCHAR(64) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_financial_audit_log_org ON financial_audit_log (organization_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_financial_audit_log_created ON financial_audit_log (created_at)`);
    logger.info("financial_audit_log table ensured");
  } catch (error) {
    logger.warn("Failed to ensure financial_audit_log table", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function ensureIndexes(): Promise<void> {
  await ensureFinancialAuditLogTable();

  const indexes = [
    // properties table: organization_id
    {
      name: "idx_properties_organization_id",
      query: sql`CREATE INDEX IF NOT EXISTS idx_properties_organization_id ON properties (organization_id)`,
    },
    // units table: property_id
    {
      name: "idx_units_property_id",
      query: sql`CREATE INDEX IF NOT EXISTS idx_units_property_id ON units (property_id)`,
    },
    // tenants table: unit_id
    {
      name: "idx_tenants_unit_id",
      query: sql`CREATE INDEX IF NOT EXISTS idx_tenants_unit_id ON tenants (unit_id)`,
    },
    // monthly_invoices (invoices) table: tenant_id
    {
      name: "idx_monthly_invoices_tenant_id",
      query: sql`CREATE INDEX IF NOT EXISTS idx_monthly_invoices_tenant_id ON monthly_invoices (tenant_id)`,
    },
    // monthly_invoices table: unit_id (for property_id lookups)
    {
      name: "idx_monthly_invoices_unit_id",
      query: sql`CREATE INDEX IF NOT EXISTS idx_monthly_invoices_unit_id ON monthly_invoices (unit_id)`,
    },
    // monthly_invoices table: status
    {
      name: "idx_monthly_invoices_status",
      query: sql`CREATE INDEX IF NOT EXISTS idx_monthly_invoices_status ON monthly_invoices (status)`,
    },
    // monthly_invoices table: composite index on (year, month)
    {
      name: "idx_monthly_invoices_year_month",
      query: sql`CREATE INDEX IF NOT EXISTS idx_monthly_invoices_year_month ON monthly_invoices (year, month)`,
    },
    // payments table: tenant_id
    {
      name: "idx_payments_tenant_id",
      query: sql`CREATE INDEX IF NOT EXISTS idx_payments_tenant_id ON payments (tenant_id)`,
    },
    // payments table: invoice_id
    {
      name: "idx_payments_invoice_id",
      query: sql`CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments (invoice_id)`,
    },
    // payment_allocations table: payment_id
    {
      name: "idx_payment_allocations_payment_id",
      query: sql`CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment_id ON payment_allocations (payment_id)`,
    },
    // payment_allocations table: invoice_id
    {
      name: "idx_payment_allocations_invoice_id",
      query: sql`CREATE INDEX IF NOT EXISTS idx_payment_allocations_invoice_id ON payment_allocations (invoice_id)`,
    },
    // leases table: tenant_id
    {
      name: "idx_leases_tenant_id",
      query: sql`CREATE INDEX IF NOT EXISTS idx_leases_tenant_id ON leases (tenant_id)`,
    },
    // leases table: unit_id
    {
      name: "idx_leases_unit_id",
      query: sql`CREATE INDEX IF NOT EXISTS idx_leases_unit_id ON leases (unit_id)`,
    },
    // audit_logs table: user_id
    {
      name: "idx_audit_logs_user_id",
      query: sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs (user_id)`,
    },
    // audit_logs table: created_at
    {
      name: "idx_audit_logs_created_at",
      query: sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at)`,
    },
    // settlements table: property_id
    {
      name: "idx_settlements_property_id",
      query: sql`CREATE INDEX IF NOT EXISTS idx_settlements_property_id ON settlements (property_id)`,
    },
    // settlements table: year
    {
      name: "idx_settlements_year",
      query: sql`CREATE INDEX IF NOT EXISTS idx_settlements_year ON settlements (year)`,
    },
    // meter_readings table: meter_id (already has composite index in schema with reading_date)
    {
      name: "idx_meter_readings_meter_id",
      query: sql`CREATE INDEX IF NOT EXISTS idx_meter_readings_meter_id ON meter_readings (meter_id)`,
    },
  ];

  for (const index of indexes) {
    try {
      await db.execute(index.query);
      logger.info(`Index created: ${index.name}`);
    } catch (error) {
      logger.warn(`Failed to create index ${index.name}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
