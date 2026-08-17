/**
 * Task #124 — API-Level-Beweis: Mieter- und Eigentümerportal-Sessions können
 * KEINE Daten fremder Organisationen (oder fremder Mieter/Eigentümer) sehen.
 *
 * Aufbau: echter Express-Stack mit den ECHTEN Routen + Middlewares
 * (tenantPortalOrgMiddleware / ownerPortalOrgMiddleware), Session per
 * Test-Middleware injiziert. Zwei Orgs mit vollem Fixture-Set (Property,
 * Unit, Tenant, Invoice, Payment, Owner, Settlement, Portal-Zugänge).
 *
 * Angriffe:
 *   - Org-A-Session ruft alle Portal-Endpunkte auf → Antwortkörper enthält
 *     NIEMALS eine Org-B-Ressourcen-ID (Property/Unit/Tenant/Invoice/…).
 *   - Query-Parameter mit Org-B-Bezug (invoices?year=…) liefern keine B-Daten.
 *   - Inaktiver oder erfundener Portal-Zugang → 401.
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { rootDb as db } from '../../server/db';
import { registerTenantPortalRoutes } from '../../server/routes/tenantPortalRoutes';
import { registerOwnerPortalRoutes } from '../../server/routes/ownerPortalRoutes';
import { rlsMiddleware } from '../../server/middleware/rlsMiddleware';

// ── Fixtures: zwei komplette Orgs ────────────────────────────────────────────
function makeFixture() {
  return {
    org: randomUUID(), prop: randomUUID(), unit: randomUUID(), tenant: randomUUID(),
    invoice: randomUUID(), payment: randomUUID(), owner: randomUUID(),
    propOwner: randomUUID(), settlement: randomUUID(), tpa: randomUUID(), opa: randomUUID(),
    lease: randomUUID(), tenantDoc: randomUUID(), propDoc: randomUUID(),
    assembly: randomUUID(), budgetPlan: randomUUID(), wegUnitOwner: randomUUID(),
  };
}
const A = makeFixture();
const B = makeFixture();
const TPA_INACTIVE = randomUUID();

/** Alle Org-B-Ressourcen-IDs, die in keiner Org-A-Antwort auftauchen dürfen. */
const B_IDS = [
  B.org, B.prop, B.unit, B.tenant, B.invoice, B.payment, B.owner, B.settlement,
  B.lease, B.tenantDoc, B.propDoc, B.assembly, B.budgetPlan, B.wegUnitOwner,
];

function buildApp(withRls = false) {
  const app = express();
  app.use(express.json());
  // Test-Session: per Header injiziert (ersetzt express-session).
  app.use((req, _res, next) => {
    const raw = req.headers['x-test-session'];
    (req as any).session = typeof raw === 'string' ? JSON.parse(raw) : {};
    next();
  });
  if (withRls) app.use(rlsMiddleware); // Produktionsreihenfolge: rlsMiddleware VOR Portal-Routen
  registerTenantPortalRoutes(app as any);
  registerOwnerPortalRoutes(app as any);
  return app;
}

async function seedOrg(f: typeof A, tag: string) {
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${f.org}::uuid, ${'PortalX-' + tag})`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${f.prop}::uuid, ${f.org}::uuid, ${'PortalX-Haus-' + tag}, ${'Str. ' + tag}, 'Wien', '1010', 'mietverwaltung')
  `);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status)
    VALUES (${f.unit}::uuid, ${f.prop}::uuid, ${'Top ' + tag}, 'wohnung', 'aktiv')
  `);
  await db.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email)
    VALUES (${f.tenant}::uuid, ${f.unit}::uuid, ${'Mieter' + tag}, ${'PortalX' + tag}, ${'mieter' + tag + '@portalx.test'})
  `);
  await db.execute(sql`
    INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, gesamtbetrag, status)
    VALUES (${f.invoice}::uuid, ${f.tenant}::uuid, ${f.unit}::uuid, 2026, 7, 900, 'offen')
  `);
  await db.execute(sql`
    INSERT INTO payments (id, tenant_id, betrag, buchungs_datum)
    VALUES (${f.payment}::uuid, ${f.tenant}::uuid, 450, '2026-07-03')
  `);
  await db.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name, email)
    VALUES (${f.owner}::uuid, ${f.org}::uuid, ${'Owner' + tag}, ${'PortalX' + tag}, ${'owner' + tag + '@portalx.test'})
  `);
  await db.execute(sql`
    INSERT INTO property_owners (id, property_id, owner_id)
    VALUES (${f.propOwner}::uuid, ${f.prop}::uuid, ${f.owner}::uuid)
  `);
  await db.execute(sql`
    INSERT INTO settlements (id, property_id, year, status)
    VALUES (${f.settlement}::uuid, ${f.prop}::uuid, 2025, 'abgeschlossen')
  `);
  await db.execute(sql`
    INSERT INTO tenant_portal_access (id, tenant_id, email, organization_id, is_active)
    VALUES (${f.tpa}::uuid, ${f.tenant}::uuid, ${'mieter' + tag + '@portalx.test'}, ${f.org}::uuid, true)
  `);
  await db.execute(sql`
    INSERT INTO owner_portal_access (id, owner_id, email, organization_id, is_active)
    VALUES (${f.opa}::uuid, ${f.owner}::uuid, ${'owner' + tag + '@portalx.test'}, ${f.org}::uuid, true)
  `);
  // Endpoint-spezifische Daten, damit jede Route echte (gegnerische) Inhalte hat:
  await db.execute(sql`
    INSERT INTO leases (id, tenant_id, unit_id, start_date, grundmiete)
    VALUES (${f.lease}::uuid, ${f.tenant}::uuid, ${f.unit}::uuid, '2025-01-01', 800)
  `);
  await db.execute(sql`
    INSERT INTO tenant_documents (id, tenant_id, name, organization_id)
    VALUES (${f.tenantDoc}::uuid, ${f.tenant}::uuid, ${'Mietvertrag-' + tag + '.pdf'}, ${f.org}::uuid)
  `);
  await db.execute(sql`
    INSERT INTO property_documents (id, property_id, name, organization_id)
    VALUES (${f.propDoc}::uuid, ${f.prop}::uuid, ${'Hausordnung-' + tag + '.pdf'}, ${f.org}::uuid)
  `);
  await db.execute(sql`
    INSERT INTO weg_assemblies (id, property_id, title, assembly_date, organization_id)
    VALUES (${f.assembly}::uuid, ${f.prop}::uuid, ${'Versammlung ' + tag}, '2026-03-01T10:00:00Z', ${f.org}::uuid)
  `);
  await db.execute(sql`
    INSERT INTO weg_budget_plans (id, property_id, year, organization_id)
    VALUES (${f.budgetPlan}::uuid, ${f.prop}::uuid, 2026, ${f.org}::uuid)
  `);
  await db.execute(sql`
    INSERT INTO weg_unit_owners (id, property_id, unit_id, owner_id, mea_share)
    VALUES (${f.wegUnitOwner}::uuid, ${f.prop}::uuid, ${f.unit}::uuid, ${f.owner}::uuid, 100)
  `);
}

async function cleanupOrg(f: typeof A) {
  await db.execute(sql`DELETE FROM weg_unit_owners WHERE id = ${f.wegUnitOwner}::uuid`);
  await db.execute(sql`DELETE FROM weg_budget_plans WHERE id = ${f.budgetPlan}::uuid`);
  await db.execute(sql`DELETE FROM weg_assemblies WHERE id = ${f.assembly}::uuid`);
  await db.execute(sql`DELETE FROM property_documents WHERE id = ${f.propDoc}::uuid`);
  await db.execute(sql`DELETE FROM tenant_documents WHERE id = ${f.tenantDoc}::uuid`);
  await db.execute(sql`DELETE FROM leases WHERE id = ${f.lease}::uuid`);
  await db.execute(sql`DELETE FROM tenant_portal_access WHERE id IN (${f.tpa}::uuid, ${TPA_INACTIVE}::uuid)`);
  await db.execute(sql`DELETE FROM owner_portal_access WHERE id = ${f.opa}::uuid`);
  await db.execute(sql`DELETE FROM settlements WHERE id = ${f.settlement}::uuid`);
  await db.execute(sql`DELETE FROM property_owners WHERE id = ${f.propOwner}::uuid`);
  await db.execute(sql`DELETE FROM owners WHERE id = ${f.owner}::uuid`);
  await db.execute(sql`DELETE FROM payments WHERE id = ${f.payment}::uuid`);
  await db.execute(sql`DELETE FROM monthly_invoices WHERE id = ${f.invoice}::uuid`);
  await db.execute(sql`DELETE FROM tenants WHERE id = ${f.tenant}::uuid`);
  await db.execute(sql`DELETE FROM units WHERE id = ${f.unit}::uuid`);
  await db.execute(sql`DELETE FROM properties WHERE id = ${f.prop}::uuid`);
  await db.execute(sql`DELETE FROM organizations WHERE id = ${f.org}::uuid`);
}

const app = buildApp();
const tenantSession = (tpaId: string) => JSON.stringify({ tenantPortalId: tpaId });
const ownerSession = (opaId: string) => JSON.stringify({ ownerPortalId: opaId });

function assertNoBIds(body: unknown, endpoint: string) {
  const text = JSON.stringify(body);
  for (const id of B_IDS) {
    assert.ok(!text.includes(id), `${endpoint}: Org-B-ID ${id} darf nicht in der Antwort erscheinen`);
  }
}

describe('Portal-Sessions: Cross-Org-Isolation auf API-Ebene', () => {
  before(async () => {
    const { setupRLS } = await import('../../server/lib/rlsPolicies.js');
    await setupRLS();
    await seedOrg(A, 'A');
    await seedOrg(B, 'B');
    // Inaktiver Zugang für Org B's Mieter — darf nie authentifizieren.
    await db.execute(sql`
      INSERT INTO tenant_portal_access (id, tenant_id, email, organization_id, is_active)
      VALUES (${TPA_INACTIVE}::uuid, ${B.tenant}::uuid, 'inactive@portalx.test', ${B.org}::uuid, false)
    `);
  });

  after(async () => {
    await cleanupOrg(A);
    await cleanupOrg(B);
  });

  // ── Mieterportal ───────────────────────────────────────────────────────────
  // [endpoint, ID die in der A-Antwort ERWARTET wird (positiver Beweis, dass
  //  der Endpunkt echte Daten liefert — nicht nur leer ist)]
  const tenantEndpoints: Array<[string, string | null]> = [
    ['/api/tenant-portal/dashboard', A.tenant],
    ['/api/tenant-portal/invoices', A.invoice],
    ['/api/tenant-portal/payments', A.payment],
    ['/api/tenant-portal/documents', A.tenantDoc],
    ['/api/tenant-portal/lease', A.lease],
    ['/api/tenant-portal/check-access', A.tenant],
  ];

  for (const [ep, expectedId] of tenantEndpoints) {
    test(`Mieter A: ${ep} → 200, eigene Daten JA, Org-B-Daten NEIN`, async () => {
      const res = await request(app).get(ep).set('x-test-session', tenantSession(A.tpa));
      assert.equal(res.status, 200, `${ep}: ${JSON.stringify(res.body).slice(0, 200)}`);
      if (expectedId) {
        assert.ok(JSON.stringify(res.body).includes(expectedId), `${ep}: eigene ID ${expectedId} muss enthalten sein`);
      }
      assertNoBIds(res.body, ep);
    });
  }

  test('Mieter A: B-Ressourcen-IDs in Query-Parametern ändern die Session-Scope nicht', async () => {
    const attacks = [
      `/api/tenant-portal/invoices?year=2026&tenant_id=${B.tenant}&tenantId=${B.tenant}`,
      `/api/tenant-portal/invoices?id=${B.invoice}&invoice_id=${B.invoice}`,
      `/api/tenant-portal/payments?tenant_id=${B.tenant}`,
      `/api/tenant-portal/documents?tenant_id=${B.tenant}&id=${B.tenantDoc}`,
      `/api/tenant-portal/lease?unit_id=${B.unit}`,
      `/api/tenant-portal/dashboard?organization_id=${B.org}`,
    ];
    for (const url of attacks) {
      const res = await request(app).get(url).set('x-test-session', tenantSession(A.tpa));
      assert.equal(res.status, 200, url);
      assertNoBIds(res.body, url);
    }
  });

  test('Mieter A: Dashboard zeigt ausschließlich die eigenen Stammdaten', async () => {
    const res = await request(app).get('/api/tenant-portal/dashboard').set('x-test-session', tenantSession(A.tpa));
    assert.equal(res.status, 200);
    assert.equal(res.body.tenant.id, A.tenant);
    const invoiceIds = (res.body.recentInvoices ?? res.body.invoices ?? []).map((i: any) => i.id);
    assert.ok(!invoiceIds.includes(B.invoice));
  });

  test('Mieter B: sieht seinerseits keine Org-A-Daten (Symmetrie)', async () => {
    const res = await request(app).get('/api/tenant-portal/invoices').set('x-test-session', tenantSession(B.tpa));
    assert.equal(res.status, 200);
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes(A.invoice) && !text.includes(A.tenant));
  });

  test('Inaktiver Portal-Zugang → 401', async () => {
    const res = await request(app).get('/api/tenant-portal/dashboard').set('x-test-session', tenantSession(TPA_INACTIVE));
    assert.equal(res.status, 401);
  });

  test('Erfundene tenantPortalId → 401', async () => {
    const res = await request(app).get('/api/tenant-portal/dashboard').set('x-test-session', tenantSession(randomUUID()));
    assert.equal(res.status, 401);
  });

  // ── Eigentümerportal ──────────────────────────────────────────────────────
  const ownerEndpoints: Array<[string, string | null]> = [
    ['/api/owner-portal/dashboard', A.owner],
    ['/api/owner-portal/properties', A.prop],
    ['/api/owner-portal/settlements', A.settlement],
    ['/api/owner-portal/documents', A.propDoc],
    ['/api/owner-portal/assemblies', A.assembly],
    ['/api/owner-portal/budgets', A.budgetPlan],
  ];

  for (const [ep, expectedId] of ownerEndpoints) {
    test(`Eigentümer A: ${ep} → 200, eigene Daten JA, Org-B-Daten NEIN`, async () => {
      const res = await request(app).get(ep).set('x-test-session', ownerSession(A.opa));
      assert.equal(res.status, 200, `${ep}: ${JSON.stringify(res.body).slice(0, 200)}`);
      if (expectedId) {
        assert.ok(JSON.stringify(res.body).includes(expectedId), `${ep}: eigene ID ${expectedId} muss enthalten sein`);
      }
      assertNoBIds(res.body, ep);
    });
  }

  test('Eigentümer A: B-Ressourcen-IDs in Query-Parametern ändern die Session-Scope nicht', async () => {
    const attacks = [
      `/api/owner-portal/properties?property_id=${B.prop}&id=${B.prop}`,
      `/api/owner-portal/settlements?property_id=${B.prop}&id=${B.settlement}`,
      `/api/owner-portal/documents?property_id=${B.prop}`,
      `/api/owner-portal/assemblies?property_id=${B.prop}`,
      `/api/owner-portal/budgets?property_id=${B.prop}&owner_id=${B.owner}`,
      `/api/owner-portal/dashboard?organization_id=${B.org}`,
    ];
    for (const url of attacks) {
      const res = await request(app).get(url).set('x-test-session', ownerSession(A.opa));
      assert.equal(res.status, 200, url);
      assertNoBIds(res.body, url);
    }
  });

  test('Eigentümer A: properties enthält die eigene, nicht die fremde Liegenschaft', async () => {
    const res = await request(app).get('/api/owner-portal/properties').set('x-test-session', ownerSession(A.opa));
    assert.equal(res.status, 200);
    const ids = (Array.isArray(res.body) ? res.body : res.body.properties ?? []).map((p: any) => p.id ?? p.propertyId);
    assert.ok(ids.includes(A.prop), 'eigene Liegenschaft muss sichtbar sein');
    assert.ok(!ids.includes(B.prop), 'fremde Liegenschaft darf nicht sichtbar sein');
  });

  test('Eigentümer A: settlements enthält nur die eigene Abrechnung', async () => {
    const res = await request(app).get('/api/owner-portal/settlements').set('x-test-session', ownerSession(A.opa));
    assert.equal(res.status, 200);
    const ids = (res.body as any[]).map(s => s.id);
    assert.ok(ids.includes(A.settlement));
    assert.ok(!ids.includes(B.settlement));
  });

  test('Erfundene ownerPortalId → 401', async () => {
    const res = await request(app).get('/api/owner-portal/dashboard').set('x-test-session', ownerSession(randomUUID()));
    assert.equal(res.status, 401);
  });

  test('Leere Session → 401 auf beiden Portalen', async () => {
    const r1 = await request(app).get('/api/tenant-portal/dashboard').set('x-test-session', '{}');
    const r2 = await request(app).get('/api/owner-portal/dashboard').set('x-test-session', '{}');
    assert.equal(r1.status, 401);
    assert.equal(r2.status, 401);
  });

  // ── Mixed Sessions (Admin + Portal, Produktionsreihenfolge rlsMiddleware → Portal) ──
  const mixedApp = buildApp(true);
  const mixedSession = (extra: Record<string, string>, orgId: string) =>
    JSON.stringify({ organizationId: orgId, ...extra });

  test('Mixed Session: Admin-Org A + Portal-Zugang B → 401 (Org-Mismatch, beide Portale)', async () => {
    const r1 = await request(mixedApp)
      .get('/api/tenant-portal/dashboard')
      .set('x-test-session', mixedSession({ tenantPortalId: B.tpa }, A.org));
    assert.equal(r1.status, 401);
    const r2 = await request(mixedApp)
      .get('/api/owner-portal/dashboard')
      .set('x-test-session', mixedSession({ ownerPortalId: B.opa }, A.org));
    assert.equal(r2.status, 401);
  });

  test('Mixed Session: Admin-Org A + eigener Portal-Zugang A → nur eigene Daten', async () => {
    const r1 = await request(mixedApp)
      .get('/api/tenant-portal/dashboard')
      .set('x-test-session', mixedSession({ tenantPortalId: A.tpa }, A.org));
    assert.equal(r1.status, 200);
    assert.equal(r1.body.tenant.id, A.tenant);
    assertNoBIds(r1.body, 'mixed tenant dashboard');
    const r2 = await request(mixedApp)
      .get('/api/owner-portal/properties')
      .set('x-test-session', mixedSession({ ownerPortalId: A.opa }, A.org));
    assert.equal(r2.status, 200);
    assert.ok(JSON.stringify(r2.body).includes(A.prop));
    assertNoBIds(r2.body, 'mixed owner properties');
  });
});
