/**
 * DB-Level-Beweis für die längste Zahlungs-RLS-Kette:
 *
 *   payments.tenant_id
 *     → tenants.unit_id
 *     → units.property_id
 *     → properties.organization_id
 *
 * payment_allocations folgt derselben Kette über payment_id. Dieser Test
 * verwendet bewusst einen eigenen Pool mit SET ROLE immo_app, damit keine
 * App-seitigen Filter oder rootDb-Berechtigungen den Befund verfälschen.
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

const basePool = new Pool({ connectionString: process.env.DATABASE_URL });
const baseConnect = basePool.connect.bind(basePool);

/** App-identischer Pool: jede Verbindung läuft als immo_app. */
const appTestPool: typeof basePool = Object.create(basePool);
appTestPool.connect = async function () {
  const client = await baseConnect();
  try {
    await client.query("SET ROLE immo_app");
    return client;
  } catch (error) {
    client.release(error as Error);
    throw new Error(
      `[appTestPool] SET ROLE immo_app fehlgeschlagen: ${(error as Error).message}`,
    );
  }
} as typeof basePool.connect;

/** Superuser-Pool für Fixture-Setup und Cleanup außerhalb von RLS. */
const superPool = new Pool({ connectionString: process.env.DATABASE_URL });

async function withAppClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await appTestPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function withSuperClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await superPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Abfrage mit einem transaktionslokalen Org-Kontext als immo_app. */
async function withOrg<T>(orgId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return withAppClient(async (client) => {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
    try {
      return await fn(client);
    } finally {
      await client.query("ROLLBACK");
    }
  });
}

/** Abfrage als immo_app ohne Org-Kontext (NULLIF → NULL → 0 Treffer). */
async function withNoOrg<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return withAppClient(async (client) => {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_org', '', true)");
    try {
      return await fn(client);
    } finally {
      await client.query("ROLLBACK");
    }
  });
}

// ---------------------------------------------------------------------------
// Fixtures: Org → Property → Unit → Tenant → Payment → Allocation
// ---------------------------------------------------------------------------

const ORG_A = randomUUID();
const ORG_B = randomUUID();
const PROPERTY_A = randomUUID();
const PROPERTY_B = randomUUID();
const UNIT_A = randomUUID();
const UNIT_B = randomUUID();
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const INVOICE_A = randomUUID();
const INVOICE_B = randomUUID();
const PAYMENT_A = randomUUID();
const PAYMENT_B = randomUUID();
const ALLOCATION_A = randomUUID();
const ALLOCATION_B = randomUUID();

async function seedFixtures(): Promise<void> {
  await withSuperClient(async (client) => {
    await client.query(
      `INSERT INTO organizations (id, name)
       VALUES ($1, 'RLS-Payments Org A'), ($2, 'RLS-Payments Org B')`,
      [ORG_A, ORG_B],
    );
    await client.query(
      `INSERT INTO properties
         (id, organization_id, name, address, city, postal_code, management_type)
       VALUES
         ($1, $2, 'RLS-Payments Property A', 'Address A', 'Wien', '1010', 'mietverwaltung'),
         ($3, $4, 'RLS-Payments Property B', 'Address B', 'Wien', '1020', 'mietverwaltung')`,
      [PROPERTY_A, ORG_A, PROPERTY_B, ORG_B],
    );
    await client.query(
      `INSERT INTO units (id, property_id, top_nummer, type, status)
       VALUES
         ($1, $2, 'RLS-Payments A1', 'wohnung', 'aktiv'),
         ($3, $4, 'RLS-Payments B1', 'wohnung', 'aktiv')`,
      [UNIT_A, PROPERTY_A, UNIT_B, PROPERTY_B],
    );
    await client.query(
      `INSERT INTO tenants (id, unit_id, first_name, last_name, email, status)
       VALUES
         ($1, $2, 'Payment', 'Tenant A', $3, 'aktiv'),
         ($4, $5, 'Payment', 'Tenant B', $6, 'aktiv')`,
      [
        TENANT_A,
        UNIT_A,
        `rls-payments-${TENANT_A}@test.invalid`,
        TENANT_B,
        UNIT_B,
        `rls-payments-${TENANT_B}@test.invalid`,
      ],
    );
    await client.query(
      `INSERT INTO monthly_invoices
         (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, status, faellig_am)
       VALUES
         ($1, $2, $3, 2045, 1, 500.00, 500.00, 'offen', '2045-01-31'),
         ($4, $5, $6, 2045, 1, 600.00, 600.00, 'offen', '2045-01-31')`,
      [INVOICE_A, TENANT_A, UNIT_A, INVOICE_B, TENANT_B, UNIT_B],
    );
    await client.query(
      `INSERT INTO payments
         (id, tenant_id, betrag, buchungs_datum, verwendungszweck)
       VALUES
         ($1, $2, 500.00, '2045-01-15', 'RLS payment A'),
         ($3, $4, 600.00, '2045-01-15', 'RLS payment B')`,
      [PAYMENT_A, TENANT_A, PAYMENT_B, TENANT_B],
    );
    await client.query(
      `INSERT INTO payment_allocations
         (id, payment_id, invoice_id, applied_amount, allocation_type)
       VALUES
         ($1, $2, $3, 500.00, 'miete'),
         ($4, $5, $6, 600.00, 'miete')`,
      [ALLOCATION_A, PAYMENT_A, INVOICE_A, ALLOCATION_B, PAYMENT_B, INVOICE_B],
    );
  });
}

async function cleanupFixtures(): Promise<void> {
  await withSuperClient(async (client) => {
    await client.query("BEGIN");
    try {
      // payment_allocations ist append-only und hat einen Immutable-Trigger.
      await client.query("ALTER TABLE payment_allocations DISABLE TRIGGER ALL");
      await client.query(
        `DELETE FROM payment_allocations WHERE id IN ($1, $2)`,
        [ALLOCATION_A, ALLOCATION_B],
      );
      await client.query("ALTER TABLE payment_allocations ENABLE TRIGGER ALL");
      await client.query(`DELETE FROM payments WHERE id IN ($1, $2)`, [PAYMENT_A, PAYMENT_B]);
      await client.query(`DELETE FROM monthly_invoices WHERE id IN ($1, $2)`, [
        INVOICE_A,
        INVOICE_B,
      ]);
      await client.query(`DELETE FROM tenants WHERE id IN ($1, $2)`, [TENANT_A, TENANT_B]);
      await client.query(`DELETE FROM units WHERE id IN ($1, $2)`, [UNIT_A, UNIT_B]);
      await client.query(`DELETE FROM properties WHERE id IN ($1, $2)`, [
        PROPERTY_A,
        PROPERTY_B,
      ]);
      await client.query(`DELETE FROM organizations WHERE id IN ($1, $2)`, [ORG_A, ORG_B]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

before(async () => {
  await seedFixtures();
});

after(async () => {
  try {
    await cleanupFixtures();
  } finally {
    await appTestPool.end();
    await superPool.end();
  }
});

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

async function visibleIds(
  client: pg.PoolClient,
  table: "payments" | "payment_allocations",
): Promise<string[]> {
  const ids = table === "payments" ? [PAYMENT_A, PAYMENT_B] : [ALLOCATION_A, ALLOCATION_B];
  const result = await client.query(
    `SELECT id FROM ${table} WHERE id = ANY($1::uuid[]) ORDER BY id`,
    [ids],
  );
  return result.rows.map((row: { id: string }) => row.id);
}

function assertOnly(ids: string[], expected: string[], message: string): void {
  assert.deepEqual([...ids].sort(), [...expected].sort(), message);
}

describe("payments RLS: Policy und FORCE RLS aktiv", () => {
  test("beide Tabellen haben eine Isolations-Policy und erzwingen RLS", async () => {
    await withSuperClient(async (client) => {
      for (const table of ["payments", "payment_allocations"]) {
        const policy = await client.query(
          `SELECT qual FROM pg_policies
           WHERE schemaname = 'public' AND tablename = $1
             AND policyname = $2`,
          [table, `org_isolation_${table}`],
        );
        assert.equal(policy.rows.length, 1, `${table} muss eine org_isolation-Policy haben`);
        assert.match(policy.rows[0].qual, /NULLIF/, `${table}-Policy muss fail-closed sein`);

        const relation = await client.query(
          `SELECT relrowsecurity, relforcerowsecurity
           FROM pg_class
           WHERE relname = $1 AND relnamespace = 'public'::regnamespace`,
          [table],
        );
        assert.equal(relation.rows.length, 1, `${table} muss in pg_class existieren`);
        assert.equal(relation.rows[0].relrowsecurity, true, `${table} muss RLS aktiv haben`);
        assert.equal(
          relation.rows[0].relforcerowsecurity,
          true,
          `${table} muss FORCE ROW LEVEL SECURITY haben`,
        );
      }
    });
  });
});

describe("payments RLS: immo_app ohne Org-Kontext sieht 0 Zeilen", () => {
  test("payments und payment_allocations sind fail-closed", async () => {
    const visible = await withNoOrg(async (client) => ({
      payments: await visibleIds(client, "payments"),
      allocations: await visibleIds(client, "payment_allocations"),
    }));
    assertOnly(visible.payments, [], "Ohne Org-Kontext darf immo_app keine payments sehen");
    assertOnly(
      visible.allocations,
      [],
      "Ohne Org-Kontext darf immo_app keine payment_allocations sehen",
    );
  });
});

describe("payments RLS: Org-Kontext isoliert die vollständige Join-Kette", () => {
  test("Org A sieht A-Zahlung und A-Zuordnung, aber nichts aus Org B", async () => {
    const visible = await withOrg(ORG_A, async (client) => ({
      payments: await visibleIds(client, "payments"),
      allocations: await visibleIds(client, "payment_allocations"),
    }));
    assertOnly(visible.payments, [PAYMENT_A], "Org A darf nur ihre payment-Zeile sehen");
    assertOnly(
      visible.allocations,
      [ALLOCATION_A],
      "Org A darf nur ihre payment_allocations-Zeile sehen",
    );
  });

  test("Org B sieht B-Zahlung und B-Zuordnung, aber nichts aus Org A", async () => {
    const visible = await withOrg(ORG_B, async (client) => ({
      payments: await visibleIds(client, "payments"),
      allocations: await visibleIds(client, "payment_allocations"),
    }));
    assertOnly(visible.payments, [PAYMENT_B], "Org B darf nur ihre payment-Zeile sehen");
    assertOnly(
      visible.allocations,
      [ALLOCATION_B],
      "Org B darf nur ihre payment_allocations-Zeile sehen",
    );
  });

  test("unbekannter Fremd-Kontext sieht 0 Zahlungszeilen", async () => {
    const visible = await withOrg(randomUUID(), async (client) => ({
      payments: await visibleIds(client, "payments"),
      allocations: await visibleIds(client, "payment_allocations"),
    }));
    assertOnly(visible.payments, [], "Ein fremder Org-Kontext darf keine payments sehen");
    assertOnly(
      visible.allocations,
      [],
      "Ein fremder Org-Kontext darf keine payment_allocations sehen",
    );
  });
});