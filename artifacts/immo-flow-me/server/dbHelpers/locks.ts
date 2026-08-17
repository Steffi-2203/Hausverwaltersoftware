import { sql } from "drizzle-orm";

/**
 * Lock open invoices for a tenant ordered by year/month.
 * Use inside db.transaction(tx => { ... }) as: const invoices = await lockTenantOpenInvoices(tx, tenantId);
 */
export async function lockTenantOpenInvoices(tx: any, tenantId: string) {
  const res = await tx.execute(sql`
    SELECT id, gesamtbetrag, COALESCE(paid_amount, 0) AS paid_amount, status, year, month
    FROM monthly_invoices
    WHERE tenant_id = ${tenantId} AND status IN ('offen','teilbezahlt')
    ORDER BY year, month
    FOR UPDATE
  `);
  return res.rows;
}
