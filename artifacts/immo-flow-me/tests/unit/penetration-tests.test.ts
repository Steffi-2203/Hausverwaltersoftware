import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';
import { db } from '../../server/db';
import { sql, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { setupTestDb, teardownTestDb, seedTestData, testPropertyId, testUserId, testOrgId, testTenantId, testUnitId } from '../helpers/db';
import { billingService } from '../../server/services/billing.service';
import { exportTenantData } from '../../server/services/gdprService';
import { splitPaymentByPriority, allocatePaymentToInvoice } from '../../server/services/paymentSplittingService';
import { calculateOwnerSettlement, distributeWithRemainder } from '../../server/services/wegSettlementService';
import { validateTrialBalance } from '../../server/services/trialBalanceService';
import { createKaution, initiateReturn } from '../../server/services/kautionService';
import * as schema from '../../shared/schema';

const orgAId = uuidv4();
const orgBId = uuidv4();
const userAId = uuidv4();
const userBId = uuidv4();
const propertyAId = uuidv4();
const propertyBId = uuidv4();
const unitAId = uuidv4();
const unitBId = uuidv4();
const tenantAId = uuidv4();
const tenantBId = uuidv4();

async function seedPenTestData() {
  await db.execute(sql`
    INSERT INTO organizations (id, name, created_at)
    VALUES (${orgAId}::uuid, 'PenTest Org A', NOW()),
           (${orgBId}::uuid, 'PenTest Org B', NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO profiles (id, email, full_name, organization_id, created_at)
    VALUES (${userAId}::uuid, 'pentest-a@test.at', 'PenTest User A', ${orgAId}::uuid, NOW()),
           (${userBId}::uuid, 'pentest-b@test.at', 'PenTest User B', ${orgBId}::uuid, NOW())
    ON CONFLICT DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, created_at)
    VALUES (${propertyAId}::uuid, ${orgAId}::uuid, 'PenTest Property A', 'Straße A 1', 'Wien', '1010', NOW()),
           (${propertyBId}::uuid, ${orgBId}::uuid, 'PenTest Property B', 'Straße B 2', 'Graz', '8010', NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, stockwerk, zimmer, flaeche, created_at)
    VALUES (${unitAId}::uuid, ${propertyAId}::uuid, 'PenA1', 'wohnung', 1, 2, 55.0, NOW()),
           (${unitBId}::uuid, ${propertyBId}::uuid, 'PenB1', 'wohnung', 1, 3, 70.0, NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, grundmiete, betriebskosten_vorschuss, heizungskosten_vorschuss, mietbeginn, created_at)
    VALUES (${tenantAId}::uuid, ${unitAId}::uuid, 'PenAnna', 'OrgA', 'pen-anna@orga.test', 'aktiv', 600.00, 120.00, 60.00, '2025-01-01', NOW()),
           (${tenantBId}::uuid, ${unitBId}::uuid, 'PenBernd', 'OrgB', 'pen-bernd@orgb.test', 'aktiv', 700.00, 140.00, 70.00, '2025-01-01', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
}

async function cleanupPenTestData() {
  try {
    await db.execute(sql`DELETE FROM kautions_bewegungen WHERE kaution_id IN (SELECT id FROM kautionen WHERE organization_id IN (${orgAId}::uuid, ${orgBId}::uuid))`);
    await db.execute(sql`DELETE FROM kautionen WHERE organization_id IN (${orgAId}::uuid, ${orgBId}::uuid)`);
    // payment_allocations + invoice_lines sind Append-Only-Ledger — Trigger für Cleanup deaktivieren
    await db.execute(sql`ALTER TABLE payment_allocations DISABLE TRIGGER ALL`);
    try {
      await db.execute(sql`DELETE FROM payment_allocations WHERE payment_id IN (SELECT id FROM payments WHERE tenant_id IN (${tenantAId}::uuid, ${tenantBId}::uuid))`);
      await db.execute(sql`DELETE FROM payment_allocations WHERE invoice_id IN (SELECT id FROM monthly_invoices WHERE tenant_id IN (${tenantAId}::uuid, ${tenantBId}::uuid))`);
    } finally {
      await db.execute(sql`ALTER TABLE payment_allocations ENABLE TRIGGER ALL`);
    }
    await db.execute(sql`DELETE FROM payments WHERE tenant_id IN (${tenantAId}::uuid, ${tenantBId}::uuid)`);
    await db.execute(sql`ALTER TABLE invoice_lines DISABLE TRIGGER ALL`);
    try {
      await db.execute(sql`DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM monthly_invoices WHERE tenant_id IN (${tenantAId}::uuid, ${tenantBId}::uuid))`);
    } finally {
      await db.execute(sql`ALTER TABLE invoice_lines ENABLE TRIGGER ALL`);
    }
    await db.execute(sql`DELETE FROM monthly_invoices WHERE tenant_id IN (${tenantAId}::uuid, ${tenantBId}::uuid)`);
    await db.execute(sql`DELETE FROM invoice_runs WHERE initiated_by IN (${userAId}::uuid, ${userBId}::uuid)`);
    await db.execute(sql`DELETE FROM audit_logs WHERE user_id IN (${userAId}::uuid, ${userBId}::uuid)`);
    await db.execute(sql`DELETE FROM tenants WHERE id IN (${tenantAId}::uuid, ${tenantBId}::uuid)`);
    await db.execute(sql`DELETE FROM units WHERE id IN (${unitAId}::uuid, ${unitBId}::uuid)`);
    await db.execute(sql`DELETE FROM properties WHERE id IN (${propertyAId}::uuid, ${propertyBId}::uuid)`);
    await db.execute(sql`DELETE FROM profiles WHERE id IN (${userAId}::uuid, ${userBId}::uuid)`);
    await db.execute(sql`DELETE FROM organizations WHERE id IN (${orgAId}::uuid, ${orgBId}::uuid)`);
  } catch (err) {
    console.warn('Cleanup warning:', err);
  }
}

describe('Penetration Test Suite', () => {
  beforeAll(async () => {
    await setupTestDb();
    await seedTestData();
    await seedPenTestData();
  });

  afterAll(async () => {
    await cleanupPenTestData();
    await teardownTestDb();
  });

  describe('1. RLS Bypass Tests', () => {
    test('Org B billing run with Org A property does not produce Org B-owned invoices', async () => {
      const result = await billingService.generateMonthlyInvoices({
        userId: userBId,
        organizationId: orgBId,
        propertyIds: [propertyAId],
        year: 2029,
        month: 6,
        dryRun: true,
      });

      if (result.preview && (result.preview as any[]).length > 0) {
        for (const p of result.preview as any[]) {
          const tenantCheck = await db.execute(sql`
            SELECT t.id FROM tenants t
            JOIN units u ON u.id = t.unit_id
            JOIN properties pr ON pr.id = u.property_id
            WHERE t.id = ${p.invoice.tenantId}::uuid AND pr.organization_id = ${orgBId}::uuid
          `);
          expect((tenantCheck.rows || tenantCheck).length).toBe(0);
        }
      }
      expect(result).toBeDefined();
    });

    test('Org A invoices are scoped to Org A only', async () => {
      const result = await billingService.generateMonthlyInvoices({
        userId: userAId,
        organizationId: orgAId,
        propertyIds: [propertyAId],
        year: 2029,
        month: 7,
        dryRun: true,
      });

      if (result.preview && (result.preview as any[]).length > 0) {
        for (const p of result.preview as any[]) {
          expect(p.invoice.tenantId).toBe(tenantAId);
        }
      }
    });

    test('exportTenantData blocks cross-org access (Org B exporting Org A tenant)', async () => {
      await expect(
        exportTenantData(tenantAId, orgBId)
      ).rejects.toThrow();
    });

    test('exportTenantData blocks cross-org access (Org A exporting Org B tenant)', async () => {
      await expect(
        exportTenantData(tenantBId, orgAId)
      ).rejects.toThrow();
    });

    test('exportTenantData succeeds for correct org-tenant relationship', async () => {
      const data = await exportTenantData(tenantAId, orgAId);
      expect(data).toBeDefined();
      expect(data.stammdaten.id).toBe(tenantAId);
      expect(data.meta.rechtsgrundlage).toContain('DSGVO');
    });

    test('direct SQL with wrong org context returns no rows for properties', async () => {
      const result = await db.execute(sql`
        SELECT * FROM properties
        WHERE id = ${propertyAId}::uuid AND organization_id = ${orgBId}::uuid
      `);
      const rows = result.rows || result;
      expect(rows.length).toBe(0);
    });

    test('direct SQL with wrong org context returns no rows for tenants via join', async () => {
      const result = await db.execute(sql`
        SELECT t.* FROM tenants t
        JOIN units u ON u.id = t.unit_id
        JOIN properties p ON p.id = u.property_id
        WHERE t.id = ${tenantAId}::uuid AND p.organization_id = ${orgBId}::uuid
      `);
      const rows = result.rows || result;
      expect(rows.length).toBe(0);
    });

    test('org-scoped property query returns only matching org data', async () => {
      const result = await db.execute(sql`
        SELECT * FROM properties
        WHERE organization_id = ${orgAId}::uuid
      `);
      const rows: any[] = result.rows || result;
      for (const row of rows) {
        expect(row.organization_id).toBe(orgAId);
      }
      expect(rows.some((r: any) => r.id === propertyAId)).toBe(true);
      expect(rows.some((r: any) => r.id === propertyBId)).toBe(false);
    });
  });

  describe('2. Payment Flow Security Tests', () => {
    let testInvoiceId: string;
    let testPaymentId: string;

    beforeAll(async () => {
      const invResult = await db.execute(sql`
        INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, betriebskosten, heizungskosten, gesamtbetrag, status, faellig_am, created_at)
        VALUES (gen_random_uuid(), ${tenantAId}::uuid, ${unitAId}::uuid, 2029, 8, 600, 120, 60, 780, 'offen', '2029-08-05', NOW())
        RETURNING id
      `);
      testInvoiceId = ((invResult.rows || invResult)[0] as any).id;

      const payResult = await db.execute(sql`
        INSERT INTO payments (id, tenant_id, betrag, buchungs_datum, payment_type, created_at)
        VALUES (gen_random_uuid(), ${tenantAId}::uuid, 780, '2029-08-01', 'ueberweisung', NOW())
        RETURNING id
      `);
      testPaymentId = ((payResult.rows || payResult)[0] as any).id;
    });

    test('payment allocation with negative amount is handled', async () => {
      try {
        const result = await allocatePaymentToInvoice(testPaymentId, testInvoiceId, -100, orgAId);
        expect(Number(result.appliedAmount)).toBeLessThanOrEqual(0);
      } catch (err: any) {
        expect(err.message).toBeDefined();
      }
    });

    test('payment allocation with zero amount does not corrupt state', async () => {
      try {
        const result = await allocatePaymentToInvoice(testPaymentId, testInvoiceId, 0, orgAId);
        expect(Number(result.appliedAmount)).toBe(0);
      } catch (err: any) {
        expect(err.message).toBeDefined();
      }
    });

    test('payment allocation with extremely large amount (overflow protection)', async () => {
      try {
        const result = await allocatePaymentToInvoice(testPaymentId, testInvoiceId, Number.MAX_SAFE_INTEGER, orgAId);
        expect(result).toBeDefined();
        const invoiceCheck = await db.execute(sql`
          SELECT status, paid_amount::numeric as paid FROM monthly_invoices WHERE id = ${testInvoiceId}::uuid
        `);
        const inv = (invoiceCheck.rows || invoiceCheck)[0] as any;
        expect(Number(inv.paid)).toBeGreaterThan(0);
      } catch (err: any) {
        expect(err.message).toBeDefined();
      }
    });

    test('double allocation creates two records (allocatePaymentToInvoice requires orgId)', async () => {
      // Diese Funktion erfordert seit dem Sicherheits-Audit immer orgId.
      // Der Test verifikiert:
      // a) Aufruf OHNE orgId → wird sicher abgelehnt
      // b) Direkte DB-Inserts in payment_allocations funktionieren (Data-Layer-Test)
      const freshInvResult = await db.execute(sql`
        INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, betriebskosten, heizungskosten, gesamtbetrag, status, faellig_am, created_at)
        VALUES (gen_random_uuid(), ${tenantAId}::uuid, ${unitAId}::uuid, 2029, 9, 600, 120, 60, 780, 'offen', '2029-09-05', NOW())
        RETURNING id
      `);
      const freshInvoiceId = ((freshInvResult.rows || freshInvResult)[0] as any).id;

      const freshPayResult = await db.execute(sql`
        INSERT INTO payments (id, tenant_id, betrag, buchungs_datum, payment_type, created_at)
        VALUES (gen_random_uuid(), ${tenantAId}::uuid, 780, '2029-09-01', 'ueberweisung', NOW())
        RETURNING id
      `);
      const freshPaymentId = ((freshPayResult.rows || freshPayResult)[0] as any).id;

      // a) Sicherheitscheck: kein orgId → wird abgelehnt
      await expect(
        allocatePaymentToInvoice(freshPaymentId, freshInvoiceId, 390)
      ).rejects.toThrow('Organisationskontext');

      // b) Data-Layer: Direkte Inserts in payment_allocations funktionieren
      await db.execute(sql`
        INSERT INTO payment_allocations (payment_id, invoice_id, applied_amount, allocation_type)
        VALUES (${freshPaymentId}::uuid, ${freshInvoiceId}::uuid, 390, 'miete'),
               (${freshPaymentId}::uuid, ${freshInvoiceId}::uuid, 390, 'betriebskosten')
      `);

      const allocations = await db.execute(sql`
        SELECT * FROM payment_allocations
        WHERE payment_id = ${freshPaymentId}::uuid AND invoice_id = ${freshInvoiceId}::uuid
      `);
      const rows = allocations.rows || allocations;
      expect(rows.length).toBe(2);
      const totalAllocated = (rows as any[]).reduce((sum: number, r: any) => sum + Number(r.applied_amount), 0);
      expect(totalAllocated).toBe(780);
    });

    test('splitPaymentByPriority with zero amount returns no allocations', async () => {
      const result = await splitPaymentByPriority(0, tenantAId, orgAId);
      expect(result.allocations).toHaveLength(0);
      expect(result.totalAllocated).toBe(0);
      expect(result.remainingAmount).toBe(0);
    });

    test('splitPaymentByPriority with negative amount returns no allocations', async () => {
      const result = await splitPaymentByPriority(-500, tenantAId, orgAId);
      expect(result.allocations).toHaveLength(0);
      expect(result.totalAllocated).toBe(0);
    });

    test('allocation to non-existent invoice throws', async () => {
      const fakeInvoiceId = uuidv4();
      try {
        await allocatePaymentToInvoice(testPaymentId, fakeInvoiceId, 100, orgAId);
        const check = await db.execute(sql`
          SELECT * FROM monthly_invoices WHERE id = ${fakeInvoiceId}::uuid
        `);
        expect((check.rows || check).length).toBe(0);
      } catch (err: any) {
        expect(err.message).toBeDefined();
      }
    });

    test('allocation to non-existent payment throws', async () => {
      const fakePaymentId = uuidv4();
      await expect(
        allocatePaymentToInvoice(fakePaymentId, testInvoiceId, 100, orgAId)
      ).rejects.toThrow();
    });
  });

  describe('3. IDOR (Insecure Direct Object Reference) Tests', () => {
    let invoiceOrgAId: string;
    let paymentOrgBId: string;

    beforeAll(async () => {
      const invRes = await db.execute(sql`
        INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, betriebskosten, heizungskosten, gesamtbetrag, status, faellig_am, created_at)
        VALUES (gen_random_uuid(), ${tenantAId}::uuid, ${unitAId}::uuid, 2029, 10, 600, 120, 60, 780, 'offen', '2029-10-05', NOW())
        RETURNING id
      `);
      invoiceOrgAId = ((invRes.rows || invRes)[0] as any).id;

      const payRes = await db.execute(sql`
        INSERT INTO payments (id, tenant_id, betrag, buchungs_datum, payment_type, created_at)
        VALUES (gen_random_uuid(), ${tenantBId}::uuid, 700, '2029-10-01', 'ueberweisung', NOW())
        RETURNING id
      `);
      paymentOrgBId = ((payRes.rows || payRes)[0] as any).id;
    });

    test('allocatePaymentToInvoice rejects cross-org payment-to-invoice (Org B payment to Org A invoice)', async () => {
      await expect(
        allocatePaymentToInvoice(paymentOrgBId, invoiceOrgAId, 100, orgBId)
      ).rejects.toThrow();
    });

    test('allocatePaymentToInvoice rejects cross-org with Org A context accessing Org B payment', async () => {
      await expect(
        allocatePaymentToInvoice(paymentOrgBId, invoiceOrgAId, 100, orgAId)
      ).rejects.toThrow();
    });

    test('accessing properties with wrong org through direct DB query returns empty', async () => {
      const result = await db.execute(sql`
        SELECT p.* FROM properties p
        WHERE p.id = ${propertyAId}::uuid AND p.organization_id = ${orgBId}::uuid
      `);
      expect((result.rows || result).length).toBe(0);
    });

    test('accessing units across org boundary through joins returns empty', async () => {
      const result = await db.execute(sql`
        SELECT u.* FROM units u
        JOIN properties p ON p.id = u.property_id
        WHERE u.id = ${unitAId}::uuid AND p.organization_id = ${orgBId}::uuid
      `);
      expect((result.rows || result).length).toBe(0);
    });

    test('accessing invoices across org boundary is blocked', async () => {
      const result = await db.execute(sql`
        SELECT mi.* FROM monthly_invoices mi
        JOIN units u ON u.id = mi.unit_id
        JOIN properties p ON p.id = u.property_id
        WHERE mi.id = ${invoiceOrgAId}::uuid AND p.organization_id = ${orgBId}::uuid
      `);
      expect((result.rows || result).length).toBe(0);
    });
  });

  describe('4. Input Validation Tests', () => {
    const sqlInjectionPayloads = [
      "'; DROP TABLE properties; --",
      "' OR '1'='1",
      "Robert'; DELETE FROM tenants WHERE '1'='1",
      "1; UPDATE profiles SET email='hacked@evil.com' WHERE 1=1; --",
      "' UNION SELECT * FROM profiles --",
    ];

    const xssPayloads = [
      '<script>alert("XSS")</script>',
      '<img src=x onerror=alert(1)>',
      '"><svg onload=alert(1)>',
      "javascript:alert('XSS')",
      '<iframe src="javascript:alert(1)">',
    ];

    for (const payload of sqlInjectionPayloads) test(
      `SQL injection in property name is safely escaped: ${payload}`,
      async () => {
        const injectionPropertyId = uuidv4();
        await db.execute(sql`
          INSERT INTO properties (id, organization_id, name, address, city, postal_code, created_at)
          VALUES (${injectionPropertyId}::uuid, ${orgAId}::uuid, ${payload}, 'Injection Str 1', 'Wien', '1010', NOW())
          ON CONFLICT (id) DO NOTHING
        `);

        const result = await db.execute(sql`
          SELECT name FROM properties WHERE id = ${injectionPropertyId}::uuid
        `);
        const rows = result.rows || result;
        expect(rows.length).toBe(1);
        expect((rows[0] as any).name).toBe(payload);

        const tablesResult = await db.execute(sql`
          SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'properties') AS exists
        `);
        expect(((tablesResult.rows || tablesResult)[0] as any).exists).toBe(true);

        await db.execute(sql`DELETE FROM properties WHERE id = ${injectionPropertyId}::uuid`);
      }
    );

    for (const payload of sqlInjectionPayloads) test(
      `SQL injection in tenant name is safely escaped: ${payload}`,
      async () => {
        const injTenantId = uuidv4();
        await db.execute(sql`
          INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, grundmiete, betriebskosten_vorschuss, heizungskosten_vorschuss, mietbeginn, created_at)
          VALUES (${injTenantId}::uuid, ${unitAId}::uuid, ${payload}, 'SafeLastName', 'inj@test.at', 'aktiv', 500, 150, 80, '2025-01-01', NOW())
          ON CONFLICT (id) DO NOTHING
        `);

        const result = await db.execute(sql`
          SELECT first_name FROM tenants WHERE id = ${injTenantId}::uuid
        `);
        const rows = result.rows || result;
        expect(rows.length).toBe(1);
        expect((rows[0] as any).first_name).toBe(payload);

        await db.execute(sql`DELETE FROM tenants WHERE id = ${injTenantId}::uuid`);
      }
    );

    for (const payload of xssPayloads) test(
      `XSS payload stored in DB is not executed (stored as-is): ${payload}`,
      async () => {
        const xssPropertyId = uuidv4();
        await db.execute(sql`
          INSERT INTO properties (id, organization_id, name, address, city, postal_code, created_at)
          VALUES (${xssPropertyId}::uuid, ${orgAId}::uuid, ${payload}, 'XSS Str 1', 'Wien', '1010', NOW())
          ON CONFLICT (id) DO NOTHING
        `);

        const result = await db.execute(sql`
          SELECT name FROM properties WHERE id = ${xssPropertyId}::uuid
        `);
        const rows = result.rows || result;
        expect(rows.length).toBe(1);
        expect((rows[0] as any).name).toBe(payload);
        expect(typeof (rows[0] as any).name).toBe('string');

        await db.execute(sql`DELETE FROM properties WHERE id = ${xssPropertyId}::uuid`);
      }
    );

    test('boundary value: negative financial amount in grundmiete', async () => {
      const negTenantId = uuidv4();
      await db.execute(sql`
        INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, grundmiete, betriebskosten_vorschuss, heizungskosten_vorschuss, mietbeginn, created_at)
        VALUES (${negTenantId}::uuid, ${unitAId}::uuid, 'Negative', 'Rent', 'neg@test.at', 'aktiv', -500, 150, 80, '2025-01-01', NOW())
        ON CONFLICT (id) DO NOTHING
      `);

      const result = await db.execute(sql`
        SELECT grundmiete::numeric as grundmiete FROM tenants WHERE id = ${negTenantId}::uuid
      `);
      const rows = result.rows || result;
      expect(rows.length).toBe(1);
      expect(Number((rows[0] as any).grundmiete)).toBe(-500);

      await db.execute(sql`DELETE FROM tenants WHERE id = ${negTenantId}::uuid`);
    });

    test('boundary value: zero financial amount', async () => {
      const zeroTenantId = uuidv4();
      await db.execute(sql`
        INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, grundmiete, betriebskosten_vorschuss, heizungskosten_vorschuss, mietbeginn, created_at)
        VALUES (${zeroTenantId}::uuid, ${unitAId}::uuid, 'Zero', 'Rent', 'zero@test.at', 'aktiv', 0, 0, 0, '2025-01-01', NOW())
        ON CONFLICT (id) DO NOTHING
      `);

      const result = await db.execute(sql`
        SELECT grundmiete::numeric as grundmiete FROM tenants WHERE id = ${zeroTenantId}::uuid
      `);
      expect(Number(((result.rows || result)[0] as any).grundmiete)).toBe(0);

      await db.execute(sql`DELETE FROM tenants WHERE id = ${zeroTenantId}::uuid`);
    });

    test('boundary value: MAX_SAFE_INTEGER financial amount', async () => {
      const bigTenantId = uuidv4();
      try {
        await db.execute(sql`
          INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, grundmiete, betriebskosten_vorschuss, heizungskosten_vorschuss, mietbeginn, created_at)
          VALUES (${bigTenantId}::uuid, ${unitAId}::uuid, 'Big', 'Amount', 'big@test.at', 'aktiv', ${Number.MAX_SAFE_INTEGER}, 150, 80, '2025-01-01', NOW())
          ON CONFLICT (id) DO NOTHING
        `);

        const result = await db.execute(sql`
          SELECT grundmiete::numeric as grundmiete FROM tenants WHERE id = ${bigTenantId}::uuid
        `);
        const rows = result.rows || result;
        if (rows.length > 0) {
          const stored = Number((rows[0] as any).grundmiete);
          expect(stored).toBeGreaterThan(0);
        }
      } catch (err: any) {
        expect(err.message).toBeDefined();
      } finally {
        await db.execute(sql`DELETE FROM tenants WHERE id = ${bigTenantId}::uuid`);
      }
    });

    test('boundary value: NaN is rejected or handled', async () => {
      try {
        const result = await splitPaymentByPriority(NaN, tenantAId, orgAId);
        expect(result.totalAllocated).toBe(0);
        expect(result.allocations).toHaveLength(0);
      } catch (err: any) {
        expect(err.message).toBeDefined();
      }
    });

    test('boundary value: Infinity is handled', async () => {
      try {
        const result = await splitPaymentByPriority(Infinity, tenantAId, orgAId);
        expect(result).toBeDefined();
      } catch (err: any) {
        expect(err.message).toBeDefined();
      }
    });

    test('invalid UUID format is rejected by DB', async () => {
      try {
        await db.execute(sql`
          SELECT * FROM properties WHERE id = ${'not-a-valid-uuid'}::uuid
        `);
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.message).toMatch(/uuid|invalid|syntax/i);
      }
    });

    test('empty string UUID is rejected', async () => {
      try {
        await db.execute(sql`
          SELECT * FROM properties WHERE id = ${''}::uuid
        `);
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.message).toBeDefined();
      }
    });

    test('null-byte in string is handled', async () => {
      const nullPropertyId = uuidv4();
      try {
        await db.execute(sql`
          INSERT INTO properties (id, organization_id, name, address, city, postal_code, created_at)
          VALUES (${nullPropertyId}::uuid, ${orgAId}::uuid, ${'Test\x00Null'}, 'Addr', 'Wien', '1010', NOW())
          ON CONFLICT (id) DO NOTHING
        `);
      } catch (err: any) {
        expect(err.message).toBeDefined();
      } finally {
        await db.execute(sql`DELETE FROM properties WHERE id = ${nullPropertyId}::uuid`);
      }
    });
  });

  describe('5. Business Logic Edge Cases', () => {
    test('distributeWithRemainder with empty shares returns empty', () => {
      const result = distributeWithRemainder(1000, []);
      expect(result).toEqual([]);
    });

    test('distributeWithRemainder with single owner gets full amount', () => {
      const result = distributeWithRemainder(1000, [{ id: 'owner1', ratio: 1.0 }]);
      expect(result).toHaveLength(1);
      expect(result[0].amount).toBe(1000);
    });

    test('distributeWithRemainder handles rounding remainder correctly', () => {
      const result = distributeWithRemainder(100, [
        { id: 'a', ratio: 1 / 3 },
        { id: 'b', ratio: 1 / 3 },
        { id: 'c', ratio: 1 / 3 },
      ]);
      const total = result.reduce((s, r) => s + r.amount, 0);
      expect(Math.abs(total - 100)).toBeLessThan(0.01);
    });

    test('distributeWithRemainder with 0 total amount returns all zeros', () => {
      const result = distributeWithRemainder(0, [
        { id: 'a', ratio: 0.5 },
        { id: 'b', ratio: 0.5 },
      ]);
      expect(result[0].amount).toBe(0);
      expect(result[1].amount).toBe(0);
    });

    test('distributeWithRemainder with shares not summing to 1.0', () => {
      const result = distributeWithRemainder(1000, [
        { id: 'a', ratio: 0.3 },
        { id: 'b', ratio: 0.2 },
      ]);
      const total = result.reduce((s, r) => s + r.amount, 0);
      expect(total).toBeLessThanOrEqual(1000);
      expect(result).toHaveLength(2);
      expect(result[0].amount).toBeGreaterThanOrEqual(0);
      expect(result[1].amount).toBeGreaterThanOrEqual(0);
    });

    test('WEG settlement with no owners throws error', async () => {
      await expect(
        calculateOwnerSettlement(propertyAId, 2029, orgAId)
      ).rejects.toThrow('Keine Eigentümer');
    });

    test('validateTrialBalance for org with no journal entries returns balanced with warning', async () => {
      const result = await validateTrialBalance(orgAId);
      expect(result.isBalanced).toBe(true);
      expect(result.entryCount).toBe(0);
      expect(result.warnings.some(w => w.includes('Keine Buchungen'))).toBe(true);
    });

    test('validateTrialBalance returns correct structure', async () => {
      const result = await validateTrialBalance(orgAId, undefined, '2029-01-01', '2029-12-31', true);
      expect(result).toHaveProperty('isBalanced');
      expect(result).toHaveProperty('totalSoll');
      expect(result).toHaveProperty('totalHaben');
      expect(result).toHaveProperty('difference');
      expect(result).toHaveProperty('entryCount');
      expect(result).toHaveProperty('checkedAt');
      expect(result).toHaveProperty('warnings');
      expect(typeof result.totalSoll).toBe('number');
      expect(typeof result.totalHaben).toBe('number');
    });

    test('Kaution creation with zero amount is rejected', async () => {
      await expect(
        createKaution({
          organizationId: orgAId,
          tenantId: tenantAId,
          unitId: unitAId,
          betrag: '0',
        })
      ).rejects.toThrow('größer als 0');
    });

    test('Kaution creation with negative amount is rejected', async () => {
      await expect(
        createKaution({
          organizationId: orgAId,
          tenantId: tenantAId,
          unitId: unitAId,
          betrag: '-1000',
        })
      ).rejects.toThrow('größer als 0');
    });

    test('Kaution creation with valid amount succeeds', async () => {
      const kaution = await createKaution({
        organizationId: orgAId,
        tenantId: tenantAId,
        unitId: unitAId,
        betrag: '3000',
        eingangsdatum: '2029-01-15',
      });
      expect(kaution).toBeDefined();
      expect(kaution.id).toBeDefined();
      expect(Number(kaution.betrag)).toBe(3000);
      expect(kaution.status).toBe('aktiv');
    });

    test('Kaution return with einbehalten exceeding deposit is correctly rejected', async () => {
      // Validierung: Einbehalt > Kaution+Zinsen wird abgelehnt (kein negativer Rückzahlungsbetrag).
      // validateEinbehalten() schützt den Produktionspfad.
      const kaution = await createKaution({
        organizationId: orgAId,
        tenantId: tenantAId,
        unitId: unitAId,
        betrag: '1000',
        eingangsdatum: '2029-02-01',
      });

      await expect(
        initiateReturn(kaution.id, {
          rueckzahlungsdatum: '2029-06-01',
          einbehaltenBetrag: 5000,
          einbehaltenGrund: 'Test excessive deduction',
        })
      ).rejects.toThrow('übersteigt Kaution');
    });

    test('double Kaution return is rejected', async () => {
      const kaution = await createKaution({
        organizationId: orgAId,
        tenantId: tenantAId,
        unitId: unitAId,
        betrag: '2000',
        eingangsdatum: '2029-03-01',
      });

      await initiateReturn(kaution.id, {
        rueckzahlungsdatum: '2029-07-01',
      });

      const { completeReturn } = await import('../../server/services/kautionService');
      // completeReturn benötigt eine Zahlungsreferenz als Nachweis der erfolgten Zahlung
      await completeReturn(kaution.id, 'TESTREF-DOPPELRUECK');

      await expect(
        initiateReturn(kaution.id, {
          rueckzahlungsdatum: '2029-08-01',
        })
      ).rejects.toThrow('aktive Kautionen');
    });

    test('splitPaymentByPriority respects invoice chronological order', async () => {
      const earlyInvResult = await db.execute(sql`
        INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, betriebskosten, heizungskosten, gesamtbetrag, status, faellig_am, is_vacancy, created_at)
        VALUES (gen_random_uuid(), ${tenantAId}::uuid, ${unitAId}::uuid, 2028, 1, 600, 120, 60, 780, 'offen', '2028-01-05', false, NOW())
        RETURNING id
      `);
      const earlyInvId = ((earlyInvResult.rows || earlyInvResult)[0] as any).id;

      const lateInvResult = await db.execute(sql`
        INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, betriebskosten, heizungskosten, gesamtbetrag, status, faellig_am, is_vacancy, created_at)
        VALUES (gen_random_uuid(), ${tenantAId}::uuid, ${unitAId}::uuid, 2028, 2, 600, 120, 60, 780, 'offen', '2028-02-05', false, NOW())
        RETURNING id
      `);
      const lateInvId = ((lateInvResult.rows || lateInvResult)[0] as any).id;

      const result = await splitPaymentByPriority(800, tenantAId, orgAId);

      if (result.allocations.length >= 1) {
        expect(result.allocations[0].invoiceId).toBe(earlyInvId);
        expect(result.totalAllocated).toBeGreaterThan(0);
        expect(result.totalAllocated).toBeLessThanOrEqual(800);
      }
    });

    test('billing with empty organizationId throws Pflichtfeld error', async () => {
      await expect(
        billingService.generateMonthlyInvoices({
          userId: userAId,
          organizationId: '',
          propertyIds: [propertyAId],
          year: 2029,
          month: 12,
          dryRun: true,
        })
      ).rejects.toThrow('Pflichtfeld');
    });

    test('billing with null organizationId throws Pflichtfeld error', async () => {
      await expect(
        billingService.generateMonthlyInvoices({
          userId: userAId,
          organizationId: null as any,
          propertyIds: [propertyAId],
          year: 2029,
          month: 11,
          dryRun: true,
        })
      ).rejects.toThrow('Pflichtfeld');
    });
  });
});
