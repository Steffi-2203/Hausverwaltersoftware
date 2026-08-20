import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { rootDb, withOrgContext } from '../../server/db';
import { automatedDunningService } from '../../server/services/automatedDunningService';
import { paymentService } from '../../server/services/paymentService';
import { getOutstandingInvoiceAmount } from '../../server/services/invoiceTotalsService';
import paymentRoutes from '../../server/routes/paymentRoutes';
import { addOrgContext } from '../helpers/withOrgContext';
import { invoiceLines, monthlyInvoices, paymentAllocations, payments } from '../../shared/schema';

const orgId = randomUUID();
const profileId = randomUUID();
const propertyId = randomUUID();
const unitId = randomUUID();
const tenantId = randomUUID();
const invoiceId = randomUUID();
const basePaymentId = randomUUID();
const surchargePaymentId = randomUUID();

before(async () => {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() - 46);
  const email = `dunning-${tenantId.slice(0, 8)}@test.at`;

  await rootDb.execute(sql`
    INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'Dunning Lines Test Org')
  `);
  await rootDb.execute(sql`
    INSERT INTO profiles (id, email, organization_id)
    VALUES (${profileId}::uuid, ${`dunning-profile-${profileId.slice(0, 8)}@test.at`}, ${orgId}::uuid)
  `);
  await rootDb.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code)
    VALUES (${propertyId}::uuid, ${orgId}::uuid, 'Dunning Test Haus', 'Testgasse 1', 'Wien', '1010')
  `);
  await rootDb.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status)
    VALUES (${unitId}::uuid, ${propertyId}::uuid, 'Top D1', 'wohnung', 'aktiv')
  `);
  await rootDb.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, mietbeginn)
    VALUES (${tenantId}::uuid, ${unitId}::uuid, 'Dunning', 'Tester', ${email}, 'aktiv', '2025-01-01')
  `);
  await rootDb.insert(monthlyInvoices).values({
    id: invoiceId,
    tenantId,
    unitId,
    year: 2026,
    month: 1,
    gesamtbetrag: '650.00',
    status: 'offen',
    faelligAm: dueDate.toISOString().slice(0, 10),
    mahnstufe: 1,
  });
});

after(async () => {
  // invoice_lines is append-only in production. Disable its trigger only for
  // this disposable fixture cleanup, then restore it immediately.
  await rootDb.execute(sql`ALTER TABLE invoice_lines DISABLE TRIGGER ALL`);
  await rootDb.execute(sql`ALTER TABLE payment_allocations DISABLE TRIGGER ALL`);
  try {
    await rootDb.delete(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
    await rootDb.delete(paymentAllocations).where(eq(paymentAllocations.invoiceId, invoiceId));
    await rootDb.delete(payments).where(inArray(payments.id, [basePaymentId, surchargePaymentId]));
  } finally {
    await rootDb.execute(sql`ALTER TABLE invoice_lines ENABLE TRIGGER ALL`);
    await rootDb.execute(sql`ALTER TABLE payment_allocations ENABLE TRIGGER ALL`);
  }
  await rootDb.delete(monthlyInvoices).where(eq(monthlyInvoices.id, invoiceId));
  await rootDb.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`);
  await rootDb.execute(sql`DELETE FROM units WHERE id = ${unitId}::uuid`);
  await rootDb.execute(sql`DELETE FROM properties WHERE id = ${propertyId}::uuid`);
  await rootDb.execute(sql`DELETE FROM profiles WHERE id = ${profileId}::uuid`);
  await rootDb.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
});

describe('AutomatedDunningService invoice lines', () => {
  it('appends fee and interest lines when an overdue invoice is escalated', async () => {
    const result = await withOrgContext(orgId, () =>
      automatedDunningService.processAutomatedDunning(orgId, false),
    );

    assert.equal(result.processed, 1);
    assert.equal(result.actions[0].newLevel, 3);

    const lines = await rootDb.select()
      .from(invoiceLines)
      .where(and(
        eq(invoiceLines.invoiceId, invoiceId),
        inArray(invoiceLines.lineType, ['mahnstufe_fee', 'verzugszinsen']),
      ));

    const feeLine = lines.find((line) => line.lineType === 'mahnstufe_fee');
    const interestLine = lines.find((line) => line.lineType === 'verzugszinsen');
    assert.ok(feeLine, 'Stufe 3 must create a mahnstufe_fee invoice line');
    assert.equal(Number(feeLine.amount), 10);
    assert.ok(interestLine, 'Stufe 3 must create a verzugszinsen invoice line');
    assert.ok(Number(interestLine.amount) > 0);

    const surcharge = lines.reduce((total, line) => total + Number(line.amount), 0);
    assert.equal(Number(result.actions[0].amount) + surcharge, 650 + surcharge);

    const [invoice] = await rootDb.select({ mahnstufe: monthlyInvoices.mahnstufe })
      .from(monthlyInvoices)
      .where(eq(monthlyInvoices.id, invoiceId));
    assert.equal(invoice.mahnstufe, 3);

    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.session = { userId: profileId, organizationId: orgId };
      req.isAuthenticated = () => true;
      next();
    });
    addOrgContext(app, orgId);
    app.use(paymentRoutes);

    const response = await request(app).get('/api/invoices?year=2026&month=1');
    assert.equal(response.status, 200);
    const visibleInvoice = response.body.data.find((item: { id: string }) => item.id === invoiceId);
    assert.equal(Number(visibleInvoice.dunningCharges), surcharge);
    assert.equal(Number(visibleInvoice.gesamtbetrag), 650 + surcharge);
    assert.equal(
      getOutstandingInvoiceAmount(650, 100, surcharge),
      550 + surcharge,
      'manual and automated dunning must include existing charges after a partial payment',
    );

    await rootDb.execute(sql`
      INSERT INTO payments (id, tenant_id, betrag, buchungs_datum)
      VALUES
        (${basePaymentId}::uuid, ${tenantId}::uuid, 650.00, CURRENT_DATE),
        (${surchargePaymentId}::uuid, ${tenantId}::uuid, ${surcharge}, CURRENT_DATE)
    `);

    await withOrgContext(orgId, () =>
      paymentService.allocatePayment({
        paymentId: basePaymentId,
        tenantId,
        amount: 650,
        organizationId: orgId,
      }),
    );
    let [settlement] = await rootDb.select({
      status: monthlyInvoices.status,
      paidAmount: monthlyInvoices.paidAmount,
    }).from(monthlyInvoices).where(eq(monthlyInvoices.id, invoiceId));
    assert.equal(settlement.status, 'teilbezahlt', 'header total alone must not settle dunning charges');
    assert.equal(Number(settlement.paidAmount), 650);

    await withOrgContext(orgId, () =>
      paymentService.allocatePayment({
        paymentId: surchargePaymentId,
        tenantId,
        amount: surcharge,
        organizationId: orgId,
      }),
    );
    [settlement] = await rootDb.select({
      status: monthlyInvoices.status,
      paidAmount: monthlyInvoices.paidAmount,
    }).from(monthlyInvoices).where(eq(monthlyInvoices.id, invoiceId));
    assert.equal(settlement.status, 'bezahlt');
    assert.equal(Number(settlement.paidAmount), 650 + surcharge);
  });
});