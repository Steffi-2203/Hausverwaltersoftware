import { db } from "../db";
import { sql } from "drizzle-orm";

async function seedLeasesAndPayments() {
  console.log("=== Seeding Leases & Payments for existing tenants ===");

  const activeTenants = await db.execute(sql`
    SELECT id, unit_id, grundmiete, betriebskosten_vorschuss, heizungskosten_vorschuss,
           wasserkosten_vorschuss, kaution, kaution_bezahlt, mietbeginn
    FROM tenants
    WHERE deleted_at IS NULL AND status = 'aktiv' AND unit_id IS NOT NULL AND mietbeginn IS NOT NULL
  `);

  console.log(`Found ${activeTenants.rows.length} active tenants with mietbeginn`);

  let leasesCreated = 0;
  for (const t of activeTenants.rows as any[]) {
    const existing = await db.execute(sql`
      SELECT id FROM leases WHERE tenant_id = ${t.id} AND unit_id = ${t.unit_id} LIMIT 1
    `);
    if (existing.rows.length > 0) continue;

    try {
      await db.execute(sql`
        INSERT INTO leases (tenant_id, unit_id, start_date, grundmiete, betriebskosten_vorschuss,
          heizungskosten_vorschuss, wasserkosten_vorschuss, kaution, kaution_bezahlt, status)
        VALUES (
          ${t.id}, ${t.unit_id}, ${t.mietbeginn},
          ${t.grundmiete || '0'}, ${t.betriebskosten_vorschuss || '0'},
          ${t.heizungskosten_vorschuss || '0'}, ${t.wasserkosten_vorschuss || '0'},
          ${t.kaution || null}, ${t.kaution_bezahlt || false}, 'aktiv'
        )
      `);
      leasesCreated++;
    } catch (e: any) {
      if (!e.message?.includes('duplicate')) {
        console.error(`Lease error for tenant ${t.id}: ${e.message}`);
      }
    }
  }
  console.log(`Created ${leasesCreated} leases`);

  const openInvoices = await db.execute(sql`
    SELECT mi.id, mi.tenant_id, mi.gesamtbetrag, mi.faellig_am, mi.year, mi.month,
           t.first_name, t.last_name, t.iban
    FROM monthly_invoices mi
    JOIN tenants t ON t.id = mi.tenant_id
    WHERE mi.status = 'offen' AND mi.gesamtbetrag > 0
    ORDER BY mi.year, mi.month
  `);

  console.log(`Found ${openInvoices.rows.length} open invoices`);

  let paymentsMade = 0;
  let invoicesUpdated = 0;
  const cutoffDate = new Date('2026-01-01');

  for (const inv of openInvoices.rows as any[]) {
    const invDate = new Date(inv.year, inv.month - 1, 5);
    if (invDate >= cutoffDate) continue;

    const shouldPay = Math.random() < 0.85;
    if (!shouldPay) continue;

    const payDate = new Date(inv.year, inv.month - 1, Math.floor(Math.random() * 5) + 1);
    const payDateStr = payDate.toISOString().split('T')[0];

    try {
      await db.execute(sql`
        INSERT INTO payments (tenant_id, invoice_id, betrag, buchungs_datum, payment_type, verwendungszweck)
        VALUES (
          ${inv.tenant_id}, ${inv.id}, ${inv.gesamtbetrag}, ${payDateStr},
          ${inv.iban ? 'ueberweisung' : 'bar'},
          ${'Miete ' + inv.month + '/' + inv.year + ' ' + inv.first_name + ' ' + inv.last_name}
        )
      `);
      paymentsMade++;

      await db.execute(sql`
        UPDATE monthly_invoices SET status = 'bezahlt', paid_amount = ${inv.gesamtbetrag}
        WHERE id = ${inv.id}
      `);
      invoicesUpdated++;
    } catch (e: any) {
      if (!e.message?.includes('duplicate')) {
        console.error(`Payment error for invoice ${inv.id}: ${e.message}`);
      }
    }
  }

  console.log(`Created ${paymentsMade} payments, updated ${invoicesUpdated} invoices to bezahlt`);

  const finalStats = await db.execute(sql`
    SELECT status, COUNT(*) as cnt FROM monthly_invoices GROUP BY status
  `);
  console.log("Final invoice status distribution:");
  for (const row of finalStats.rows as any[]) {
    console.log(`  ${row.status}: ${row.cnt}`);
  }

  const leaseCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM leases`);
  const paymentCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM payments`);
  console.log(`Total leases: ${(leaseCount.rows[0] as any).cnt}`);
  console.log(`Total payments: ${(paymentCount.rows[0] as any).cnt}`);
}

seedLeasesAndPayments()
  .then(() => {
    console.log("=== Seed complete ===");
    process.exit(0);
  })
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  });
