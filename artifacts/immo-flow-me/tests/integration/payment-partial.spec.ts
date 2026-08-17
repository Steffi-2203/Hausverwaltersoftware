import { describe, it, beforeEach } from 'node:test';
import { expect } from '../helpers/expect';
import { paymentService } from "../../server/services/paymentService";
import { db } from "../../server/db";
import { monthlyInvoices } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

describe.skip("Payment partial allocation (integration) - requires DB fixtures", () => {
  const testTenantId = "00000000-0000-0000-0000-000000000201";
  const testUnitId = "00000000-0000-0000-0000-000000000301";
  const testInvoiceId = "00000000-0000-0000-0000-000000000401";

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM payments WHERE tenant_id = ${testTenantId}`);
    await db.execute(sql`DELETE FROM monthly_invoices WHERE id = ${testInvoiceId}`);
  });

  it("applies partial payment and updates status to teilbezahlt", async () => {
    await db.execute(sql`
      INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, gesamtbetrag, paid_amount, status, created_at)
      VALUES (${testInvoiceId}, ${testTenantId}, ${testUnitId}, 2026, 2, 200, 0, 'offen', now())
    `);

    const res = await paymentService.allocatePayment({
      paymentId: "00000000-0000-0000-0000-000000000501",
      tenantId: testTenantId,
      amount: 50,
      userId: "00000000-0000-0000-0000-000000000601"
    });

    const inv = await db.select().from(monthlyInvoices).where(eq(monthlyInvoices.id, testInvoiceId)).then(r => r[0]);
    
    expect(Number(inv.paidAmount)).toBe(50);
    expect(inv.status).toBe("teilbezahlt");
  });
});
