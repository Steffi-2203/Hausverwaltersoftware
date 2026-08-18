import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { acquireAuditLogTestLock, releaseAuditLogTestLock } from '../helpers/auditLogTestLock';
import { expect } from '../helpers/expect';
import { billingService } from '../../server/services/billing.service';
import { exportTenantData, anonymizeTenantData } from '../../server/services/gdprService';
import { storage } from '../../server/storage';
import { db } from '../../server/db';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { setupTestDb } from '../helpers/db';

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

async function seedIsolationData() {
  await db.execute(sql`
    INSERT INTO organizations (id, name, created_at)
    VALUES (${orgAId}::uuid, 'Isolation Org A', NOW()),
           (${orgBId}::uuid, 'Isolation Org B', NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO profiles (id, email, full_name, organization_id, created_at)
    VALUES (${userAId}::uuid, 'user-a@isolation.test', 'User A', ${orgAId}::uuid, NOW()),
           (${userBId}::uuid, 'user-b@isolation.test', 'User B', ${orgBId}::uuid, NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, created_at)
    VALUES (${propertyAId}::uuid, ${orgAId}::uuid, 'Property A', 'Straße A 1', 'Wien', '1010', NOW()),
           (${propertyBId}::uuid, ${orgBId}::uuid, 'Property B', 'Straße B 2', 'Graz', '8010', NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, stockwerk, zimmer, flaeche, created_at)
    VALUES (${unitAId}::uuid, ${propertyAId}::uuid, 'Top A1', 'wohnung', 1, 2, 55.0, NOW()),
           (${unitBId}::uuid, ${propertyBId}::uuid, 'Top B1', 'wohnung', 1, 3, 70.0, NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, grundmiete, betriebskosten_vorschuss, heizungskosten_vorschuss, mietbeginn, created_at)
    VALUES (${tenantAId}::uuid, ${unitAId}::uuid, 'Anna', 'Org-A', 'anna@orga.test', 'aktiv', 600.00, 120.00, 60.00, '2025-01-01', NOW()),
           (${tenantBId}::uuid, ${unitBId}::uuid, 'Bernd', 'Org-B', 'bernd@orgb.test', 'aktiv', 700.00, 140.00, 70.00, '2025-01-01', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
}

async function cleanupIsolationData() {
  // invoice_lines ist durch trg_invoice_lines_immutable geschützt — Trigger deaktivieren für Test-Cleanup
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
}

// Serialisierung: audit_logs ist global (kein org-Scope) — Advisory Lock verhindert
// Interferenzen mit anderen Testdateien, die gleichzeitig Audit-Einträge schreiben.
beforeAll(async () => { await acquireAuditLogTestLock(); });
afterAll(async () => { await releaseAuditLogTestLock(); });

describe('Cross-Tenant Isolation & Authorization', () => {
  beforeAll(async () => {
    await setupTestDb();
    await seedIsolationData();
  });

  afterAll(async () => {
    await cleanupIsolationData();
  });

  describe('Billing Service Organization Isolation', () => {
    test('invoice_run is scoped to the specified organizationId', async () => {
      const result = await billingService.generateMonthlyInvoices({
        userId: userAId,
        organizationId: orgAId,
        propertyIds: [propertyAId],
        year: 2027,
        month: 1,
        dryRun: false,
      });

      expect(result.success).toBe(true);
      expect(result.runId).toBeDefined();

      const runs = await db.execute(sql`
        SELECT * FROM invoice_runs WHERE run_id = ${result.runId}::uuid
      `);
      expect(runs.rows.length).toBe(1);
      expect((runs.rows[0] as any).organization_id).toBe(orgAId);
    });

    test('completed run for org A does NOT block org B for the same period', async () => {
      const resultB = await billingService.generateMonthlyInvoices({
        userId: userBId,
        organizationId: orgBId,
        propertyIds: [propertyBId],
        year: 2027,
        month: 1,
        dryRun: false,
      });

      expect(resultB.success).toBe(true);
      expect(resultB.error).toBeUndefined();
      expect(resultB.runId).toBeDefined();
    });

    test('re-running the same period for the SAME org is rejected', async () => {
      const duplicate = await billingService.generateMonthlyInvoices({
        userId: userAId,
        organizationId: orgAId,
        propertyIds: [propertyAId],
        year: 2027,
        month: 1,
        dryRun: false,
      });

      expect(duplicate.error).toBeDefined();
      expect(duplicate.error).toContain('bereits abgeschlossen');
    });
  });

  describe('GDPR Service Organization Check', () => {
    test('exportTenantData throws for tenant not belonging to organization', async () => {
      await expect(
        exportTenantData(tenantAId, orgBId)
      ).rejects.toThrow('Mieter gehört nicht zu dieser Organisation');
    });

    test('anonymizeTenantData throws for tenant not belonging to organization', async () => {
      await expect(
        anonymizeTenantData(tenantAId, orgBId)
      ).rejects.toThrow('Mieter gehört nicht zu dieser Organisation');
    });
  });

  describe('Storage Layer Isolation', () => {
    test('getPropertiesByOrganization(orgA) returns only orgA properties', async () => {
      const propertiesA = await storage.getPropertiesByOrganization(orgAId);
      const propertyIds = propertiesA.map(p => p.id);

      expect(propertyIds).toContain(propertyAId);
      expect(propertyIds).not.toContain(propertyBId);
    });

    test('getPropertiesByOrganization(orgB) returns only orgB properties', async () => {
      const propertiesB = await storage.getPropertiesByOrganization(orgBId);
      const propertyIds = propertiesB.map(p => p.id);

      expect(propertyIds).toContain(propertyBId);
      expect(propertyIds).not.toContain(propertyAId);
    });

    test('getTenantsByOrganization(orgA) returns only orgA tenants', async () => {
      const tenantsA = await storage.getTenantsByOrganization(orgAId);
      const tenantIds = tenantsA.map(t => t.id);

      expect(tenantIds).toContain(tenantAId);
      expect(tenantIds).not.toContain(tenantBId);
    });

    test('getTenantsByOrganization(orgB) returns only orgB tenants', async () => {
      const tenantsB = await storage.getTenantsByOrganization(orgBId);
      const tenantIds = tenantsB.map(t => t.id);

      expect(tenantIds).toContain(tenantBId);
      expect(tenantIds).not.toContain(tenantAId);
    });
  });
});
