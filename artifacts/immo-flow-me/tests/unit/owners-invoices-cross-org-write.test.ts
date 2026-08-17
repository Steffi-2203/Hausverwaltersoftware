/**
 * Cross-Org-Schreibschutz: owners & monthly_invoices (Task #118)
 *
 * Verifiziert die wirksame Isolationsschranke auf DB-Ebene für die beiden
 * Ressourcen aus der Due-Diligence-Liste, die noch keinen eigenen
 * Cross-Org-Schreibtest hatten:
 *   - owners (organization_id direkt)
 *   - monthly_invoices (org nur über tenant→unit→property-Kette)
 *
 * Strategie: UPDATE/DELETE als Org A (org-gebundener appPool-Client mit
 * app.current_org + SET ROLE immo_app, wie rlsMiddleware) gegen Zeilen von
 * Org B → 0 Zeilen betroffen; Verifikation über rootDb (RLS-Bypass).
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';
import { v4 as uuidv4 } from 'uuid';
import { rootDb, pool, appPool, orgContext } from '../../server/db';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../shared/schema';
import { paymentService } from '../../server/services/paymentService';
import { createKeyHandover, KeyHandoverError } from '../../server/services/keyHandoverService';

const orgAId = uuidv4();
const orgBId = uuidv4();
const ownerBId = uuidv4();
const propertyBId = uuidv4();
const unitBId = uuidv4();
const tenantBId = uuidv4();
const invoiceBId = uuidv4();

async function seedData() {
  await rootDb.execute(sql`
    INSERT INTO organizations (id, name, created_at)
    VALUES (${orgAId}::uuid, 'OwnerScope Org A', NOW()),
           (${orgBId}::uuid, 'OwnerScope Org B', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name, created_at)
    VALUES (${ownerBId}::uuid, ${orgBId}::uuid, 'Otto', 'OrgB', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, created_at)
    VALUES (${propertyBId}::uuid, ${orgBId}::uuid, 'OwnerScope Prop B', 'Straße B 2', 'Graz', '8010', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status, stockwerk, zimmer, flaeche, created_at)
    VALUES (${unitBId}::uuid, ${propertyBId}::uuid, 'OWN-B1', 'wohnung', 'aktiv', 1, 3, 70.0, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, grundmiete,
                         betriebskosten_vorschuss, heizungskosten_vorschuss, mietbeginn, created_at)
    VALUES (${tenantBId}::uuid, ${unitBId}::uuid, 'Berta', 'OrgB',
            ${'owner-scope-b-' + uuidv4().slice(0, 8) + '@orgb.test'}, 'aktiv',
            700.00, 140.00, 70.00, '2025-01-01', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete,
                                  betriebskosten, heizungskosten, gesamtbetrag, status, created_at)
    VALUES (${invoiceBId}::uuid, ${tenantBId}::uuid, ${unitBId}::uuid, 2025, 6,
            700.00, 140.00, 70.00, 910.00, 'offen', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
}

async function cleanupData() {
  await rootDb.execute(sql`DELETE FROM monthly_invoices WHERE id = ${invoiceBId}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM tenants WHERE id = ${tenantBId}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM units WHERE id = ${unitBId}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM properties WHERE id = ${propertyBId}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM owners WHERE id = ${ownerBId}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM organizations WHERE id IN (${orgAId}::uuid, ${orgBId}::uuid)`).catch(() => {});
}

/** Führt eine Query als Org A aus (RLS-Kontext wie rlsMiddleware). */
async function asOrgA(query: string, params: any[] = []): Promise<number> {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_org', $1, true)`, [orgAId]);
    const result = await client.query(query, params);
    await client.query('COMMIT');
    return result.rowCount ?? 0;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function rootRow(query: any): Promise<any> {
  const result: any = await rootDb.execute(query);
  return result.rows?.[0];
}

describe('Cross-Org-Schreibschutz: owners & monthly_invoices (DB-Schranke)', () => {
  beforeAll(async () => {
    await cleanupData();
    await seedData();
  });

  afterAll(async () => {
    await cleanupData();
  });

  test('Org A: UPDATE auf owner von Org B trifft 0 Zeilen', async () => {
    const count = await asOrgA(
      `UPDATE owners SET last_name = 'HACKED' WHERE id = $1`, [ownerBId]
    );
    expect(count).toBe(0);
    const row = await rootRow(sql`SELECT last_name FROM owners WHERE id = ${ownerBId}::uuid`);
    expect(row.last_name).toBe('OrgB');
  });

  test('Org A: DELETE auf owner von Org B trifft 0 Zeilen', async () => {
    const count = await asOrgA(`DELETE FROM owners WHERE id = $1`, [ownerBId]);
    expect(count).toBe(0);
    const row = await rootRow(sql`SELECT id FROM owners WHERE id = ${ownerBId}::uuid`);
    expect(row).toBeDefined();
  });

  test('Org A: UPDATE (Status) auf monthly_invoice von Org B trifft 0 Zeilen', async () => {
    const count = await asOrgA(
      `UPDATE monthly_invoices SET status = 'ueberfaellig' WHERE id = $1`, [invoiceBId]
    );
    expect(count).toBe(0);
    const row = await rootRow(sql`SELECT status FROM monthly_invoices WHERE id = ${invoiceBId}::uuid`);
    expect(row.status).toBe('offen');
  });

  test('Org A: DELETE auf monthly_invoice von Org B trifft 0 Zeilen', async () => {
    const count = await asOrgA(`DELETE FROM monthly_invoices WHERE id = $1`, [invoiceBId]);
    expect(count).toBe(0);
    const row = await rootRow(sql`SELECT id FROM monthly_invoices WHERE id = ${invoiceBId}::uuid`);
    expect(row).toBeDefined();
  });

  /**
   * Defense-in-Depth OHNE RLS (rootDb): Das in den Services/Routen verwendete
   * kanonische Unit-Chain-Prädikat (invoice.unit_id → unit → property → org)
   * muss auch ohne RLS fremde und inkonsistente Rechnungen fail-closed lassen.
   */
  describe('Unit-Chain-Prädikat ohne RLS (Defense-in-Depth)', () => {
    const scopedUpdate = (orgId: string, invId: string) => rootDb.execute(sql`
      UPDATE monthly_invoices SET status = 'ueberfaellig'
      WHERE id = ${invId}::uuid
        AND unit_id IN (
          SELECT u.id FROM units u
          JOIN properties p ON u.property_id = p.id
          WHERE p.organization_id = ${orgId}::uuid
        )
    `);

    test('fremde Rechnung (Org B) wird von Org-A-Scope nicht verändert', async () => {
      const result: any = await scopedUpdate(orgAId, invoiceBId);
      expect(result.rowCount ?? 0).toBe(0);
      const row = await rootRow(sql`SELECT status FROM monthly_invoices WHERE id = ${invoiceBId}::uuid`);
      expect(row.status).toBe('offen');
    });

    test('inkonsistente Rechnung (Tenant Org A, Unit Org B) bleibt für Org A fail-closed', async () => {
      // Fixture: Tenant hängt an einer Unit von Org A, die Rechnung zeigt aber
      // auf die Unit von Org B → Tenant-Kette würde fälschlich Org A erlauben.
      const propAId = uuidv4(); const unitAId = uuidv4();
      const tenantAId = uuidv4(); const invMixedId = uuidv4();
      await rootDb.execute(sql`
        INSERT INTO properties (id, organization_id, name, address, city, postal_code, created_at)
        VALUES (${propAId}::uuid, ${orgAId}::uuid, 'OwnerScope Prop A', 'Straße A 1', 'Wien', '1010', NOW())
      `);
      await rootDb.execute(sql`
        INSERT INTO units (id, property_id, top_nummer, type, status, stockwerk, zimmer, flaeche, created_at)
        VALUES (${unitAId}::uuid, ${propAId}::uuid, 'OWN-A1', 'wohnung', 'aktiv', 1, 2, 55.0, NOW())
      `);
      await rootDb.execute(sql`
        INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, grundmiete,
                             betriebskosten_vorschuss, heizungskosten_vorschuss, mietbeginn, created_at)
        VALUES (${tenantAId}::uuid, ${unitAId}::uuid, 'Alois', 'OrgA',
                ${'owner-scope-mixed-' + uuidv4().slice(0, 8) + '@orga.test'}, 'aktiv',
                600.00, 120.00, 60.00, '2025-01-01', NOW())
      `);
      await rootDb.execute(sql`
        INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete,
                                      betriebskosten, heizungskosten, gesamtbetrag, status, created_at)
        VALUES (${invMixedId}::uuid, ${tenantAId}::uuid, ${unitBId}::uuid, 2025, 7,
                600.00, 120.00, 60.00, 780.00, 'offen', NOW())
      `);
      try {
        // Unit-Chain (kanonisch): Org A trifft 0 Zeilen, weil invoice.unit_id → Org B
        const blocked: any = await scopedUpdate(orgAId, invMixedId);
        expect(blocked.rowCount ?? 0).toBe(0);
        // Org B (Eigentümer der Unit) darf die Rechnung erreichen
        const allowed: any = await scopedUpdate(orgBId, invMixedId);
        expect(allowed.rowCount ?? 0).toBe(1);
      } finally {
        await rootDb.execute(sql`DELETE FROM monthly_invoices WHERE id = ${invMixedId}::uuid`).catch(() => {});
        await rootDb.execute(sql`DELETE FROM tenants WHERE id = ${tenantAId}::uuid`).catch(() => {});
        await rootDb.execute(sql`DELETE FROM units WHERE id = ${unitAId}::uuid`).catch(() => {});
        await rootDb.execute(sql`DELETE FROM properties WHERE id = ${propAId}::uuid`).catch(() => {});
      }
    });

    test('PaymentService.allocatePayment ohne RLS: inkonsistente Rechnung (Tenant Org A, Unit Org B) wird nicht bebucht', async () => {
      // Tenant gehört Org A (Ownership-Check besteht), aber die einzige offene
      // Rechnung zeigt per unit_id auf Org B → darf nicht alloziert werden.
      const propAId = uuidv4(); const unitAId = uuidv4();
      const tenantAId = uuidv4(); const invMixedId = uuidv4();
      const paymentId = uuidv4();
      await rootDb.execute(sql`
        INSERT INTO properties (id, organization_id, name, address, city, postal_code, created_at)
        VALUES (${propAId}::uuid, ${orgAId}::uuid, 'PayScope Prop A', 'Straße A 3', 'Wien', '1030', NOW())
      `);
      await rootDb.execute(sql`
        INSERT INTO units (id, property_id, top_nummer, type, status, stockwerk, zimmer, flaeche, created_at)
        VALUES (${unitAId}::uuid, ${propAId}::uuid, 'PAY-A1', 'wohnung', 'aktiv', 2, 2, 60.0, NOW())
      `);
      await rootDb.execute(sql`
        INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, grundmiete,
                             betriebskosten_vorschuss, heizungskosten_vorschuss, mietbeginn, created_at)
        VALUES (${tenantAId}::uuid, ${unitAId}::uuid, 'Paula', 'PayOrgA',
                ${'pay-scope-' + uuidv4().slice(0, 8) + '@orga.test'}, 'aktiv',
                500.00, 100.00, 50.00, '2025-01-01', NOW())
      `);
      await rootDb.execute(sql`
        INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete,
                                      betriebskosten, heizungskosten, gesamtbetrag, status, created_at)
        VALUES (${invMixedId}::uuid, ${tenantAId}::uuid, ${unitBId}::uuid, 2025, 8,
                500.00, 100.00, 50.00, 650.00, 'offen', NOW())
      `);
      const client = await pool.connect();
      try {
        const rootClientDb = drizzle(client as any, { schema });
        // Kein SET ROLE, kein app.current_org → der explizite Org-Filter im
        // Service ist die EINZIGE Schranke.
        await orgContext.run({ organizationId: orgAId, db: rootClientDb, client } as any, async () => {
          await paymentService.allocatePayment({
            paymentId, tenantId: tenantAId, amount: 650,
            organizationId: orgAId,
          });
        });
        const row = await rootRow(sql`SELECT status, COALESCE(paid_amount, 0) AS paid_amount FROM monthly_invoices WHERE id = ${invMixedId}::uuid`);
        expect(row.status).toBe('offen');
        expect(Number(row.paid_amount)).toBe(0);
        const alloc = await rootRow(sql`SELECT COUNT(*)::int AS n FROM payment_allocations WHERE invoice_id = ${invMixedId}::uuid`);
        expect(alloc.n).toBe(0);
      } finally {
        client.release();
        await rootDb.execute(sql`DELETE FROM payment_allocations WHERE payment_id = ${paymentId}::uuid`).catch(() => {});
        await rootDb.execute(sql`DELETE FROM payments WHERE id = ${paymentId}::uuid`).catch(() => {});
        await rootDb.execute(sql`DELETE FROM monthly_invoices WHERE id = ${invMixedId}::uuid`).catch(() => {});
        await rootDb.execute(sql`DELETE FROM tenants WHERE id = ${tenantAId}::uuid`).catch(() => {});
        await rootDb.execute(sql`DELETE FROM units WHERE id = ${unitAId}::uuid`).catch(() => {});
        await rootDb.execute(sql`DELETE FROM properties WHERE id = ${propAId}::uuid`).catch(() => {});
      }
    });

    test('PaymentService.allocatePayment: konsistente Same-Org-Rechnung wird korrekt bebucht (Update + Allokation)', async () => {
      // Positivfall: Tenant und Rechnungs-Unit gehören derselben Org (B) —
      // Update, Statuswechsel und payment_allocations müssen erfolgen.
      const paymentId = uuidv4();
      const client = await pool.connect();
      try {
        const rootClientDb = drizzle(client as any, { schema });
        await orgContext.run({ organizationId: orgBId, db: rootClientDb, client } as any, async () => {
          await paymentService.allocatePayment({
            paymentId, tenantId: tenantBId, amount: 910,
            organizationId: orgBId,
          });
        });
        const row = await rootRow(sql`SELECT status, COALESCE(paid_amount, 0) AS paid_amount FROM monthly_invoices WHERE id = ${invoiceBId}::uuid`);
        expect(row.status).toBe('bezahlt');
        expect(Number(row.paid_amount)).toBe(910);
        const alloc = await rootRow(sql`SELECT COUNT(*)::int AS n, COALESCE(SUM(applied_amount), 0) AS total FROM payment_allocations WHERE payment_id = ${paymentId}::uuid AND invoice_id = ${invoiceBId}::uuid`);
        expect(alloc.n).toBe(1);
        expect(Number(alloc.total)).toBe(910);
      } finally {
        client.release();
        await rootDb.execute(sql`DELETE FROM payment_allocations WHERE payment_id = ${paymentId}::uuid`).catch(() => {});
        await rootDb.execute(sql`DELETE FROM payments WHERE id = ${paymentId}::uuid`).catch(() => {});
        // Rechnung für nachfolgende Tests zurücksetzen
        await rootDb.execute(sql`UPDATE monthly_invoices SET status = 'offen', paid_amount = 0 WHERE id = ${invoiceBId}::uuid`).catch(() => {});
      }
    });

    test('Schlüsselübergabe ohne RLS: fremder Schlüsselbestand → 404, kein Handover-Insert, Bestand unverändert', async () => {
      const keyInvBId = uuidv4();
      await rootDb.execute(sql`
        INSERT INTO key_inventory (id, property_id, key_type, total_count, available_count, created_at)
        VALUES (${keyInvBId}::uuid, ${propertyBId}::uuid, 'hauptschluessel', 5, 5, NOW())
      `);
      const client = await pool.connect();
      try {
        const rootClientDb = drizzle(client as any, { schema });
        // Kein SET ROLE, kein app.current_org → der explizite Org-Filter im
        // Service ist die EINZIGE Schranke.
        await orgContext.run({ organizationId: orgAId, db: rootClientDb, client } as any, async () => {
          await expect(createKeyHandover({
            organizationId: orgAId,
            keyInventoryId: keyInvBId,
            body: { recipientName: 'Eve', handoverDate: '2026-08-17', quantity: 2 },
          })).rejects.toThrow(KeyHandoverError);
        });
        const handovers = await rootRow(sql`SELECT COUNT(*)::int AS n FROM key_handovers WHERE key_inventory_id = ${keyInvBId}::uuid`);
        expect(handovers.n).toBe(0);
        const inv = await rootRow(sql`SELECT available_count FROM key_inventory WHERE id = ${keyInvBId}::uuid`);
        expect(Number(inv.available_count)).toBe(5);

        // Cross-Org-Tenant: Bestand gehört Org B, Übergabe durch Org B mit
        // Tenant einer fremden Org → ebenfalls 404, kein Insert.
        await orgContext.run({ organizationId: orgBId, db: rootClientDb, client } as any, async () => {
          await expect(createKeyHandover({
            organizationId: orgBId,
            keyInventoryId: keyInvBId,
            // tenantBId gehört Org B — nutze stattdessen einen garantiert fremden (nicht existenten) Tenant
            body: { tenantId: uuidv4(), handoverDate: '2026-08-17', quantity: 1 },
          })).rejects.toThrow(KeyHandoverError);
        });
        const handovers2 = await rootRow(sql`SELECT COUNT(*)::int AS n FROM key_handovers WHERE key_inventory_id = ${keyInvBId}::uuid`);
        expect(handovers2.n).toBe(0);

        // Realer Cross-Org-Tenant: Bestand gehört Org B, aber der angegebene
        // Tenant hängt (über seine Unit) an einer anderen Org → 404, kein
        // Insert — deckt den Fall "Tenant zwischenzeitlich umgehängt" ab,
        // da die Prüfung jetzt gesperrt in derselben Transaktion läuft.
        const propXId = uuidv4(); const unitXId = uuidv4(); const tenantXId = uuidv4();
        const orgXId = uuidv4();
        await rootDb.execute(sql`INSERT INTO organizations (id, name, created_at) VALUES (${orgXId}::uuid, 'OwnerScope Org X', NOW())`);
        await rootDb.execute(sql`
          INSERT INTO properties (id, organization_id, name, address, city, postal_code, created_at)
          VALUES (${propXId}::uuid, ${orgXId}::uuid, 'OwnerScope Prop X', 'Straße X 1', 'Linz', '4020', NOW())
        `);
        await rootDb.execute(sql`
          INSERT INTO units (id, property_id, top_nummer, type, status, stockwerk, zimmer, flaeche, created_at)
          VALUES (${unitXId}::uuid, ${propXId}::uuid, 'OWN-X1', 'wohnung', 'aktiv', 1, 2, 50.0, NOW())
        `);
        await rootDb.execute(sql`
          INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, grundmiete,
                               betriebskosten_vorschuss, heizungskosten_vorschuss, mietbeginn, created_at)
          VALUES (${tenantXId}::uuid, ${unitXId}::uuid, 'Xaver', 'OrgX',
                  ${'owner-scope-x-' + uuidv4().slice(0, 8) + '@orgx.test'}, 'aktiv',
                  400.00, 80.00, 40.00, '2025-01-01', NOW())
        `);
        try {
          await orgContext.run({ organizationId: orgBId, db: rootClientDb, client } as any, async () => {
            await expect(createKeyHandover({
              organizationId: orgBId,
              keyInventoryId: keyInvBId,
              body: { tenantId: tenantXId, handoverDate: '2026-08-17', quantity: 1 },
            })).rejects.toThrow(KeyHandoverError);
          });
          const handovers3 = await rootRow(sql`SELECT COUNT(*)::int AS n FROM key_handovers WHERE key_inventory_id = ${keyInvBId}::uuid`);
          expect(handovers3.n).toBe(0);
        } finally {
          await rootDb.execute(sql`DELETE FROM tenants WHERE id = ${tenantXId}::uuid`).catch(() => {});
          await rootDb.execute(sql`DELETE FROM units WHERE id = ${unitXId}::uuid`).catch(() => {});
          await rootDb.execute(sql`DELETE FROM properties WHERE id = ${propXId}::uuid`).catch(() => {});
          await rootDb.execute(sql`DELETE FROM organizations WHERE id = ${orgXId}::uuid`).catch(() => {});
        }
      } finally {
        client.release();
        await rootDb.execute(sql`DELETE FROM key_handovers WHERE key_inventory_id = ${keyInvBId}::uuid`).catch(() => {});
        await rootDb.execute(sql`DELETE FROM key_inventory WHERE id = ${keyInvBId}::uuid`).catch(() => {});
      }
    });
  });
});
