import { rootDb as db } from '../../server/db';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

const testOrgId = uuidv4();
const testPropertyId = uuidv4();
const testUnitId = uuidv4();
const testTenantId = uuidv4();
const testUserId = uuidv4();

export async function setupTestDb() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS invoice_runs (
      id SERIAL PRIMARY KEY,
      run_id UUID UNIQUE NOT NULL,
      period VARCHAR(7) NOT NULL,
      initiated_by UUID,
      status VARCHAR(20) NOT NULL DEFAULT 'started',
      error TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP
    )
  `);
}

export async function teardownTestDb() {
  // invoice_lines ist durch trg_invoice_lines_immutable geschützt — Trigger deaktivieren für Test-Cleanup
  await db.execute(sql`ALTER TABLE invoice_lines DISABLE TRIGGER ALL`);
  try {
    await db.execute(sql`DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM monthly_invoices WHERE tenant_id = ${testTenantId}::uuid)`);
  } finally {
    await db.execute(sql`ALTER TABLE invoice_lines ENABLE TRIGGER ALL`);
  }
  await db.execute(sql`DELETE FROM monthly_invoices WHERE tenant_id = ${testTenantId}::uuid`);
  await db.execute(sql`DELETE FROM invoice_runs WHERE initiated_by = ${testUserId}::uuid`);
  await db.execute(sql`DELETE FROM audit_logs WHERE user_id = ${testUserId}::uuid`);
  await db.execute(sql`DELETE FROM tenants WHERE id = ${testTenantId}::uuid`);
  await db.execute(sql`DELETE FROM units WHERE id = ${testUnitId}::uuid`);
  await db.execute(sql`DELETE FROM properties WHERE id = ${testPropertyId}::uuid`);
  await db.execute(sql`DELETE FROM profiles WHERE id = ${testUserId}::uuid`);
  await db.execute(sql`DELETE FROM organizations WHERE id = ${testOrgId}::uuid`);
}

export async function seedTestData() {
  await db.execute(sql`
    INSERT INTO organizations (id, name, created_at)
    VALUES (${testOrgId}::uuid, 'Test Org', NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  const testEmail = `test-${testUserId.slice(0, 8)}@test.at`;
  await db.execute(sql`
    INSERT INTO profiles (id, email, full_name, organization_id, created_at)
    VALUES (${testUserId}::uuid, ${testEmail}, 'Test User', ${testOrgId}::uuid, NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, created_at)
    VALUES (${testPropertyId}::uuid, ${testOrgId}::uuid, 'Test Property', 'Teststraße 1', 'Wien', '1010', NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status, stockwerk, zimmer, flaeche, created_at)
    VALUES (${testUnitId}::uuid, ${testPropertyId}::uuid, 'Top 1', 'wohnung', 'aktiv', 1, 2, 65.5, NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, grundmiete, betriebskosten_vorschuss, heizungskosten_vorschuss, mietbeginn, created_at)
    VALUES (${testTenantId}::uuid, ${testUnitId}::uuid, 'Max', 'Mustermann', 'max@test.at', 'aktiv', 500.00, 150.00, 80.00, '2025-01-01', NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  return { testOrgId, testPropertyId, testUnitId, testTenantId, testUserId };
}

export { testOrgId, testPropertyId, testUnitId, testTenantId, testUserId };
