import { describe, it, beforeEach, afterEach } from 'node:test';
import { expect } from '../helpers/expect';
import { paymentService } from "../../server/services/paymentService";
import { db } from "../../server/db";
import { monthlyInvoices, payments } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

describe.skip("PaymentService concurrency (integration) - requires DB fixtures", () => {
  const testInvoiceId = "00000000-0000-0000-0000-000000000001";
  const testTenantId = "00000000-0000-0000-0000-000000000101";
  const testUnitId = "00000000-0000-0000-0000-000000000201";

  beforeEach(async () => {
    await db.execute(sql`
      DELETE FROM payments WHERE tenant_id = ${testTenantId}
    `);
    await db.execute(sql`
      DELETE FROM monthly_invoices WHERE tenant_id = ${testTenantId}
    `);
  });

  afterEach(async () => {
    await db.execute(sql`
      DELETE FROM payments WHERE tenant_id = ${testTenantId}
    `);
    await db.execute(sql`
      DELETE FROM monthly_invoices WHERE tenant_id = ${testTenantId}
    `);
  });

  it("applies concurrent payments without double allocation", async () => {
    await db.execute(sql`
      INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, gesamtbetrag, paid_amount, status)
      VALUES (${testInvoiceId}, ${testTenantId}, ${testUnitId}, 2026, 2, 100, 0, 'offen')
    `);

    const p1 = paymentService.allocatePayment({ 
      paymentId: "00000000-0000-0000-0000-000000000301", 
      tenantId: testTenantId, 
      amount: 60, 
      userId: "00000000-0000-0000-0000-000000000401" 
    });
    const p2 = paymentService.allocatePayment({ 
      paymentId: "00000000-0000-0000-0000-000000000302", 
      tenantId: testTenantId, 
      amount: 50, 
      userId: "00000000-0000-0000-0000-000000000401" 
    });

    const results = await Promise.all([p1, p2]);

    const inv = await db.execute(sql`
      SELECT paid_amount FROM monthly_invoices WHERE id = ${testInvoiceId}
    `).then(r => r.rows[0]);

    const paidAmount = Number(inv?.paid_amount || 0);
    
    expect(paidAmount).toBeLessThanOrEqual(100);
    expect(paidAmount).toBeGreaterThanOrEqual(100);

    const totalApplied = results.reduce((sum, r) => sum + (r.applied || 0), 0);
    const totalUnapplied = results.reduce((sum, r) => sum + (r.unapplied || 0), 0);

    expect(totalApplied).toBe(100);
    expect(totalUnapplied).toBe(10);
  });

  it("handles multiple invoices with concurrent payments", async () => {
    await db.execute(sql`
      INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, gesamtbetrag, paid_amount, status)
      VALUES 
        ('inv-jan', ${testTenantId}, ${testUnitId}, 2026, 1, 100, 0, 'offen'),
        ('inv-feb', ${testTenantId}, ${testUnitId}, 2026, 2, 50, 0, 'offen')
    `);

    const p1 = paymentService.allocatePayment({ 
      paymentId: "00000000-0000-0000-0000-000000000303", 
      tenantId: testTenantId, 
      amount: 80, 
      userId: "00000000-0000-0000-0000-000000000401" 
    });
    const p2 = paymentService.allocatePayment({ 
      paymentId: "00000000-0000-0000-0000-000000000304", 
      tenantId: testTenantId, 
      amount: 90, 
      userId: "00000000-0000-0000-0000-000000000401" 
    });

    const results = await Promise.all([p1, p2]);

    const invoices = await db.execute(sql`
      SELECT id, paid_amount FROM monthly_invoices 
      WHERE tenant_id = ${testTenantId}
      ORDER BY year, month
    `).then(r => r.rows);

    const totalPaid = invoices.reduce((sum, inv) => sum + Number(inv.paid_amount || 0), 0);
    expect(totalPaid).toBe(150);
  });
});
