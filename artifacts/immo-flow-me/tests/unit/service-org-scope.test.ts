/**
 * Service-Layer Org-Scope-Tests (Task: UPDATE/DELETE ohne org_id-Scope absichern)
 *
 * Prüft dass Service-/Storage-Funktionen mit UPDATE/DELETE bei Aufruf mit einer
 * fremden Datensatz-ID 0 Zeilen treffen — auch wenn der Aufrufer eine gültige
 * (aber org-fremde) ID kennt. Defense-in-Depth zusätzlich zu Route-Checks & RLS.
 *
 * Strategie:
 *   - Zwei Orgs (A = "Angreifer", B = Opfer) mit je Property/Unit/Tenant/Lease,
 *     Bankkonto, Verteilerschlüssel, EBICS-Verbindung.
 *   - Service-Aufrufe laufen in withOrgContext(orgA) mit organizationId=orgA,
 *     zielen aber auf IDs von Org B.
 *   - Verifikation über rootDb (RLS-Bypass): Datensatz von Org B unverändert.
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';
import { v4 as uuidv4 } from 'uuid';
import { rootDb, withOrgContext } from '../../server/db';
import { sql } from 'drizzle-orm';
import * as leaseService from '../../server/services/leaseService';
import { createKaution } from '../../server/services/kautionService';
import { ebicsService } from '../../server/services/ebicsService';
import { storage } from '../../server/storage';

const orgAId = uuidv4();
const orgBId = uuidv4();
const propertyAId = uuidv4();
const propertyBId = uuidv4();
const unitAId = uuidv4();
const unitBId = uuidv4();
const tenantBId = uuidv4();
const leaseBId = uuidv4();
const bankAccountBId = uuidv4();
const distKeyBId = uuidv4();
const distKeyConflictId = uuidv4();
const distKeyLegacyBId = uuidv4();
const ebicsConnBId = uuidv4();

async function seedData() {
  await rootDb.execute(sql`
    INSERT INTO organizations (id, name, created_at)
    VALUES (${orgAId}::uuid, 'SvcScope Org A', NOW()),
           (${orgBId}::uuid, 'SvcScope Org B', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, created_at)
    VALUES (${propertyAId}::uuid, ${orgAId}::uuid, 'SvcScope Prop A', 'Straße A 1', 'Wien', '1010', NOW()),
           (${propertyBId}::uuid, ${orgBId}::uuid, 'SvcScope Prop B', 'Straße B 2', 'Graz', '8010', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status, stockwerk, zimmer, flaeche, created_at)
    VALUES (${unitAId}::uuid, ${propertyAId}::uuid, 'SVC-A1', 'wohnung', 'aktiv', 1, 2, 55.0, NOW()),
           (${unitBId}::uuid, ${propertyBId}::uuid, 'SVC-B1', 'wohnung', 'aktiv', 1, 3, 70.0, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, grundmiete,
                         betriebskosten_vorschuss, heizungskosten_vorschuss, mietbeginn, kaution_bezahlt, created_at)
    VALUES (${tenantBId}::uuid, ${unitBId}::uuid, 'Bernd', 'SvcScopeB', 'svc-scope-b@orgb.test', 'aktiv',
            700.00, 140.00, 70.00, '2025-01-01', false, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO leases (id, tenant_id, unit_id, start_date, grundmiete, status, created_at)
    VALUES (${leaseBId}::uuid, ${tenantBId}::uuid, ${unitBId}::uuid, '2025-01-01', 700.00, 'aktiv', NOW())
    ON CONFLICT DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO bank_accounts (id, organization_id, account_name, bank_name, created_at)
    VALUES (${bankAccountBId}::uuid, ${orgBId}::uuid, 'Konto Org B', 'Bank B', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO distribution_keys (id, organization_id, key_code, name, is_active, created_at)
    VALUES (${distKeyBId}::uuid, ${orgBId}::uuid, 'SVC-B', 'SvcScope Key B', true, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  // Inkonsistente Zeile: organization_id → Org B, property_id → Org A (fail-closed: für beide unantastbar via property-Pfad)
  await rootDb.execute(sql`
    INSERT INTO distribution_keys (id, organization_id, property_id, key_code, name, is_active, created_at)
    VALUES (${distKeyConflictId}::uuid, ${orgBId}::uuid, ${propertyAId}::uuid, 'SVC-X', 'SvcScope Key Konflikt', true, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  // Seit Migration 20260825 ist organization_id NOT NULL — der frühere
  // Legacy-Fall (org NULL, property → Org B) existiert nicht mehr.
  // Fixture: property-gebundener Key von Org B; Org A darf ihn nicht mutieren.
  await rootDb.execute(sql`
    INSERT INTO distribution_keys (id, organization_id, property_id, key_code, name, is_active, created_at)
    VALUES (${distKeyLegacyBId}::uuid, ${orgBId}::uuid, ${propertyBId}::uuid, 'SVC-L', 'SvcScope Key Legacy B', true, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO ebics_connections (id, organization_id, bank_name, host_id, host_url, partner_id, user_id, iban, status, created_at, updated_at)
    VALUES (${ebicsConnBId}::uuid, ${orgBId}::uuid, 'Bank B', 'HOSTB', 'https://ebics.b.test', 'PARTB', 'USERB', 'AT000000000000000000', 'pending', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `);
}

async function cleanupData() {
  // kautions_bewegungen sind trigger-geschützt (unveränderlich) → Trigger nur fürs Aufräumen deaktivieren
  await rootDb.execute(sql`ALTER TABLE kautions_bewegungen DISABLE TRIGGER ALL`);
  await rootDb.execute(sql`DELETE FROM kautions_bewegungen WHERE kaution_id IN (SELECT id FROM kautionen WHERE organization_id IN (${orgAId}::uuid, ${orgBId}::uuid))`);
  await rootDb.execute(sql`ALTER TABLE kautions_bewegungen ENABLE TRIGGER ALL`);
  await rootDb.execute(sql`DELETE FROM kautionen WHERE organization_id IN (${orgAId}::uuid, ${orgBId}::uuid)`);
  await rootDb.execute(sql`DELETE FROM ebics_connections WHERE organization_id IN (${orgAId}::uuid, ${orgBId}::uuid)`);
  await rootDb.execute(sql`DELETE FROM distribution_keys WHERE id IN (${distKeyBId}::uuid, ${distKeyConflictId}::uuid, ${distKeyLegacyBId}::uuid)`);
  await rootDb.execute(sql`DELETE FROM bank_accounts WHERE id = ${bankAccountBId}::uuid`);
  await rootDb.execute(sql`DELETE FROM leases WHERE id = ${leaseBId}::uuid`);
  await rootDb.execute(sql`DELETE FROM tenants WHERE id = ${tenantBId}::uuid`);
  await rootDb.execute(sql`DELETE FROM units WHERE id IN (${unitAId}::uuid, ${unitBId}::uuid)`);
  await rootDb.execute(sql`DELETE FROM properties WHERE id IN (${propertyAId}::uuid, ${propertyBId}::uuid)`);
  await rootDb.execute(sql`DELETE FROM organizations WHERE id IN (${orgAId}::uuid, ${orgBId}::uuid)`);
}

async function rootRow(query: any): Promise<any> {
  const result: any = await rootDb.execute(query);
  return result.rows?.[0];
}

describe('Service-Layer Org-Scope: Cross-Org-Writes treffen 0 Zeilen', () => {
  beforeAll(async () => {
    await cleanupData();
    await seedData();
  });

  afterAll(async () => {
    await cleanupData();
  });

  test('leaseService.updateLease mit fremder Lease-ID ändert nichts', async () => {
    const updated = await withOrgContext(orgAId, () =>
      leaseService.updateLease(leaseBId, { grundmiete: '1.00' } as any, orgAId)
    );
    expect(updated).toBeUndefined();
    const row = await rootRow(sql`SELECT grundmiete FROM leases WHERE id = ${leaseBId}::uuid`);
    expect(Number(row.grundmiete)).toBe(700);
  });

  test('leaseService.terminateLease mit fremder Lease-ID ändert nichts', async () => {
    const terminated = await withOrgContext(orgAId, () =>
      leaseService.terminateLease(leaseBId, '2025-06-30', orgAId)
    );
    expect(terminated).toBeUndefined();
    const row = await rootRow(sql`SELECT status, end_date FROM leases WHERE id = ${leaseBId}::uuid`);
    expect(row.status).toBe('aktiv');
    expect(row.end_date).toBeNull();
  });

  test('kautionService.createKaution mit fremder tenantId setzt kaution_bezahlt NICHT', async () => {
    await withOrgContext(orgAId, () =>
      createKaution({
        organizationId: orgAId,
        tenantId: tenantBId,
        unitId: unitBId,
        betrag: '1000',
        eingangsdatum: '2025-02-01',
      }).catch(() => undefined) // FK/RLS-Fehler beim Insert wäre ebenfalls fail-closed
    );
    const row = await rootRow(sql`SELECT kaution_bezahlt FROM tenants WHERE id = ${tenantBId}::uuid`);
    expect(row.kaution_bezahlt).toBe(false);
  });

  test('ebicsService.updateConnectionStatus mit fremder ID ändert nichts', async () => {
    const conn = await withOrgContext(orgAId, () =>
      ebicsService.updateConnectionStatus(ebicsConnBId, 'active', orgAId)
    );
    expect(conn).toBeUndefined();
    const row = await rootRow(sql`SELECT status FROM ebics_connections WHERE id = ${ebicsConnBId}::uuid`);
    expect(row.status).toBe('pending');
  });

  test('ebicsService.deleteConnection mit fremder ID löscht nichts', async () => {
    await withOrgContext(orgAId, () => ebicsService.deleteConnection(ebicsConnBId, orgAId));
    const row = await rootRow(sql`SELECT id FROM ebics_connections WHERE id = ${ebicsConnBId}::uuid`);
    expect(row).toBeDefined();
  });

  test('storage.updateBankAccount mit fremder ID + orgId ändert nichts', async () => {
    const updated = await withOrgContext(orgAId, () =>
      storage.updateBankAccount(bankAccountBId, { accountName: 'HACKED' }, orgAId)
    );
    expect(updated).toBeUndefined();
    const row = await rootRow(sql`SELECT account_name FROM bank_accounts WHERE id = ${bankAccountBId}::uuid`);
    expect(row.account_name).toBe('Konto Org B');
  });

  test('storage.deleteBankAccount mit fremder ID + orgId löscht nichts', async () => {
    await withOrgContext(orgAId, () => storage.deleteBankAccount(bankAccountBId, orgAId));
    const row = await rootRow(sql`SELECT id FROM bank_accounts WHERE id = ${bankAccountBId}::uuid`);
    expect(row).toBeDefined();
  });

  test('storage.updateDistributionKey mit fremder ID + orgId ändert nichts', async () => {
    const updated = await withOrgContext(orgAId, () =>
      storage.updateDistributionKey(distKeyBId, { name: 'HACKED' }, orgAId)
    );
    expect(updated).toBeUndefined();
    const row = await rootRow(sql`SELECT name FROM distribution_keys WHERE id = ${distKeyBId}::uuid`);
    expect(row.name).toBe('SvcScope Key B');
  });

  test('storage.deleteDistributionKey mit fremder ID + orgId deaktiviert nichts', async () => {
    await withOrgContext(orgAId, () => storage.deleteDistributionKey(distKeyBId, orgAId));
    const row = await rootRow(sql`SELECT is_active FROM distribution_keys WHERE id = ${distKeyBId}::uuid`);
    expect(row.is_active).toBe(true);
  });

  test('inkonsistenter Key (org=B, property=A): Org A kann NICHT via property-Pfad mutieren', async () => {
    const updated = await withOrgContext(orgAId, () =>
      storage.updateDistributionKey(distKeyConflictId, { name: 'HACKED' }, orgAId)
    );
    expect(updated).toBeUndefined();
    await withOrgContext(orgAId, () => storage.deleteDistributionKey(distKeyConflictId, orgAId));
    const row = await rootRow(sql`SELECT name, is_active FROM distribution_keys WHERE id = ${distKeyConflictId}::uuid`);
    expect(row.name).toBe('SvcScope Key Konflikt');
    expect(row.is_active).toBe(true);
  });

  test('Property-gebundener Key von Org B: Org A kann NICHT mutieren', async () => {
    // Seit organization_id NOT NULL ist, greift der strikte Org-Scope direkt.
    const updatedByA = await withOrgContext(orgAId, () =>
      storage.updateDistributionKey(distKeyLegacyBId, { name: 'HACKED' }, orgAId)
    );
    expect(updatedByA).toBeUndefined();
    const row = await rootRow(sql`SELECT name FROM distribution_keys WHERE id = ${distKeyLegacyBId}::uuid`);
    expect(row.name).toBe('SvcScope Key Legacy B');
  });
});
