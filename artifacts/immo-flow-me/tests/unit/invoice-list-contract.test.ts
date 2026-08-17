/**
 * invoice-list-contract.test.ts — Task #104
 *
 * Vertrag zwischen GET /api/invoices (Pagination-Envelope { data, pagination })
 * und dem Frontend (useInvoices/InvoiceList):
 *  1. unwrapList akzeptiert Envelope UND nacktes Array (Robustheit des Hooks).
 *  2. Der Endpunkt liefert das Envelope und jede Zeile enthält paidAmount,
 *     sodass die Restbetrag-Anzeige bei 'teilbezahlt' und das Bezahlt-Label
 *     rendern können.
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';

import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { sql } from 'drizzle-orm';
import { rootDb } from '../../server/db';
import { addOrgContext } from '../helpers/withOrgContext';
import paymentRoutes from '../../server/routes/paymentRoutes';
import { unwrapList } from '../../src/utils/unwrapList';

describe('unwrapList', () => {
  test('nacktes Array bleibt unverändert', () => {
    expect(unwrapList([1, 2])).toEqual([1, 2]);
  });
  test('Pagination-Envelope wird ausgepackt', () => {
    expect(unwrapList({ data: [{ id: 'a' }], pagination: { total: 1 } })).toEqual([{ id: 'a' }]);
  });
  test('unbrauchbare Formen ergeben leeres Array', () => {
    expect(unwrapList(null)).toEqual([]);
    expect(unwrapList({})).toEqual([]);
    expect(unwrapList('x')).toEqual([]);
  });
});

describe('GET /api/invoices — Envelope & paidAmount', () => {
  const orgId    = uuidv4();
  const profId   = uuidv4();
  const propId   = uuidv4();
  const unitId   = uuidv4();
  const tenantId = uuidv4();
  const invPart  = uuidv4();
  const invPaid  = uuidv4();

  function makeApp() {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.session = { userId: profId, organizationId: orgId };
      req.isAuthenticated = () => true;
      next();
    });
    addOrgContext(app, orgId);
    app.use(paymentRoutes);
    return app;
  }

  beforeAll(async () => {
    await rootDb.execute(sql`
      INSERT INTO organizations (id, name, created_at) VALUES (${orgId}::uuid, 'InvContract-Org', NOW())
    `);
    await rootDb.execute(sql`
      INSERT INTO profiles (id, email, organization_id, created_at)
      VALUES (${profId}::uuid, ${'invc-' + uuidv4().slice(0, 8) + '@t.test'}, ${orgId}::uuid, NOW())
    `);
    await rootDb.execute(sql`
      INSERT INTO properties (id, organization_id, name, address, city, postal_code, created_at)
      VALUES (${propId}::uuid, ${orgId}::uuid, 'InvHaus', 'Str 1', 'Wien', '1010', NOW())
    `);
    await rootDb.execute(sql`
      INSERT INTO units (id, property_id, top_nummer, type, status, flaeche, created_at)
      VALUES (${unitId}::uuid, ${propId}::uuid, 'T1', 'wohnung', 'aktiv', 60, NOW())
    `);
    await rootDb.execute(sql`
      INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, mietbeginn, grundmiete, created_at)
      VALUES (${tenantId}::uuid, ${unitId}::uuid, 'Ines', 'Vertrag',
              ${'invt-' + uuidv4().slice(0, 8) + '@t.test'}, 'aktiv', '2024-01-01', 500, NOW())
    `);
    await rootDb.execute(sql`
      INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, status, paid_amount, created_at)
      VALUES
        (${invPart}::uuid, ${tenantId}::uuid, ${unitId}::uuid, 2026, 7, 500, 600, 'teilbezahlt', 250, NOW()),
        (${invPaid}::uuid, ${tenantId}::uuid, ${unitId}::uuid, 2026, 8, 500, 600, 'bezahlt', 600, NOW())
    `);
  });

  afterAll(async () => {
    await rootDb.execute(sql`DELETE FROM monthly_invoices WHERE tenant_id = ${tenantId}::uuid`);
    await rootDb.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`);
    await rootDb.execute(sql`DELETE FROM units WHERE id = ${unitId}::uuid`);
    await rootDb.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
    await rootDb.execute(sql`DELETE FROM profiles WHERE id = ${profId}::uuid`);
    await rootDb.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
  });

  test('liefert Envelope { data, pagination }; unwrapList extrahiert die Zeilen', async () => {
    const res = await request(makeApp()).get('/api/invoices?year=2026');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    const rows = unwrapList(res.body);
    expect(rows.length).toBe(2);
  });

  test('teilbezahlte Zeile enthält paidAmount für die Restbetrag-Anzeige', async () => {
    const res = await request(makeApp()).get('/api/invoices?year=2026&month=7');
    const rows = unwrapList<any>(res.body);
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.status).toBe('teilbezahlt');
    expect(Number(row.paidAmount)).toBe(250);
    // Restbetrag wie in der UI berechnet
    expect(Number(row.gesamtbetrag) - Number(row.paidAmount)).toBe(350);
  });

  test('bezahlte Zeile trägt status=bezahlt (grünes Haken-Label in der UI)', async () => {
    const res = await request(makeApp()).get('/api/invoices?year=2026&month=8');
    const rows = unwrapList<any>(res.body);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('bezahlt');
  });
});
