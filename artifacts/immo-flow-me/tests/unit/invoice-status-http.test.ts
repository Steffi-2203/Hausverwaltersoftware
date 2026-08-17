/**
 * HTTP-Integrationstest: PATCH /api/invoices/:id — Status-Rücksetze-Regel
 *
 * Führe aus mit:
 *   node --import=./node_modules/tsx/dist/esm/index.cjs --test tests/unit/invoice-status-http.test.ts
 *
 * Strategie (wie open-items-mi-cross-org.test.ts):
 *   - Echter DB-Zustand: Org, Profil, Rolle, Liegenschaft, Einheit, Mieter, Vorschreibung
 *   - Echter Router: paymentRoutes (Standard-Export) gemountet
 *   - Session-Injection via Middleware (req.session.userId = profileId)
 *   - addOrgContext für den Org-Kontext (wie in rlsMiddleware)
 *
 * Abgedeckte Pipeline:
 *   1. Express-Routing
 *   2. isAuthenticated / requireRole (gegen echte user_roles-Tabelle)
 *   3. Org-Eigentümerprüfung (property.organizationId vs. profile.organizationId)
 *   4. snakeToCamel-Normalisierung  (paid_amount → paidAmount)
 *   5. Zod-Validierung (insertMonthlyInvoiceSchema.partial())
 *   6. applyInvoiceStatusRules (→ paidAmount null bei 'offen'/'ueberfaellig')
 *   7. storage.updateInvoice → tatsächliche DB-Zeile geprüft
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";

import { rootDb as db } from "../../server/db";
import paymentRoutes from "../../server/routes/paymentRoutes";
import { addOrgContext } from "../helpers/withOrgContext";

// ── Testdaten-IDs ─────────────────────────────────────────────────────────────
const orgId      = randomUUID();
const profileId  = randomUUID();  // Nutzer-ID (entspricht profiles.id)
const propId     = randomUUID();
const unitId     = randomUUID();
const tenantId   = randomUUID();
const invoiceId  = randomUUID();

const email = `inv-status-http-${profileId.slice(0, 8)}@test.local`;

// ── Hilfs-App ─────────────────────────────────────────────────────────────────
// Mountet den echten paymentRoutes-Router mit Session-Stub (profileId) und
// addOrgContext (wie rlsMiddleware in Produktion).
function buildApp() {
  const app = express();
  app.use(express.json());

  // Setzt req.session.userId so dass isAuthenticated() durchlässt.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: profileId };
    next();
  });

  // Org-Kontext: setzt app.current_org in der DB-Session und den AsyncLocalStorage.
  addOrgContext(app, orgId);

  // Echter Produktions-Router.
  app.use(paymentRoutes);
  return app;
}

const app = buildApp();

// ── Hilfsfunktion: aktuellen DB-Zustand der Vorschreibung lesen ───────────────
async function fetchInvoice() {
  const rows = await db.execute(
    sql`SELECT status, paid_amount FROM monthly_invoices WHERE id = ${invoiceId}::uuid`,
  );
  return rows.rows[0] as { status: string; paid_amount: string | null };
}

// ── Hilfsfunktion: paid_amount + status in der DB zurücksetzen ────────────────
async function resetInvoice(status: string, paidAmount: string | null) {
  await db.execute(sql`
    UPDATE monthly_invoices
    SET status = ${status}, paid_amount = ${paidAmount}
    WHERE id = ${invoiceId}::uuid
  `);
}

// ── Fixtures anlegen / abräumen ───────────────────────────────────────────────
describe("PATCH /api/invoices/:id — Status-Rücksetze-Regel (HTTP-Pipeline mit echtem Router)", () => {
  before(async () => {
    await db.execute(sql`
      INSERT INTO organizations (id, name)
      VALUES (${orgId}::uuid, 'InvStatusHttp-Org')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO profiles (id, email, organization_id)
      VALUES (${profileId}::uuid, ${email}, ${orgId}::uuid)
      ON CONFLICT DO NOTHING
    `);
    // 'admin'-Rolle → bypasst requireRole-Check (wie write-cross-org.test.ts)
    await db.execute(sql`
      INSERT INTO user_roles (user_id, role)
      VALUES (${profileId}::uuid, 'admin')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, address, city, postal_code)
      VALUES (${propId}::uuid, ${orgId}::uuid, 'ISH-Obj', 'Testgasse 1', 'Wien', '1010')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO units (id, property_id, top_nummer, type, status)
      VALUES (${unitId}::uuid, ${propId}::uuid, 'ISH-Top1', 'wohnung', 'aktiv')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO tenants (id, unit_id, first_name, last_name, email, status)
      VALUES (${tenantId}::uuid, ${unitId}::uuid, 'Test', 'ISH-Mieter',
              ${"ish-tenant-" + tenantId.slice(0, 8) + "@test.local"}, 'aktiv')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO monthly_invoices
        (id, tenant_id, unit_id, year, month, grundmiete, gesamtbetrag, paid_amount, status)
      VALUES (${invoiceId}::uuid, ${tenantId}::uuid, ${unitId}::uuid,
              2043, 7, 800.00, 1000.00, 1000.00, 'bezahlt')
      ON CONFLICT DO NOTHING
    `);
  });

  after(async () => {
    try {
      await db.execute(sql`DELETE FROM monthly_invoices WHERE id = ${invoiceId}::uuid`);
      await db.execute(sql`DELETE FROM tenants     WHERE id = ${tenantId}::uuid`);
      await db.execute(sql`DELETE FROM units       WHERE id = ${unitId}::uuid`);
      await db.execute(sql`DELETE FROM properties  WHERE id = ${propId}::uuid`);
      await db.execute(sql`DELETE FROM user_roles  WHERE user_id = ${profileId}::uuid`);
      await db.execute(sql`DELETE FROM profiles    WHERE id = ${profileId}::uuid`);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
    } catch (err) {
      console.warn("ISH-Cleanup (non-fatal):", (err as Error).message);
    }
  });

  // ── Test 1: Status 'offen' löscht paid_amount ─────────────────────────────
  test("PATCH status='offen' + paid_amount='1000.00' → DB-Zeile hat paid_amount = null", async () => {
    // Sicherstellen, dass die Vorschreibung mit paid_amount startet
    await resetInvoice("bezahlt", "1000.00");

    const res = await request(app)
      .patch(`/api/invoices/${invoiceId}`)
      .set("Content-Type", "application/json")
      .send({ status: "offen", paid_amount: "1000.00" });

    assert.equal(
      res.status,
      200,
      `HTTP ${res.status} — Body: ${JSON.stringify(res.body)}`,
    );

    const row = await fetchInvoice();
    assert.equal(
      row.paid_amount,
      null,
      `paid_amount hätte null sein sollen, ist aber: ${row.paid_amount}`,
    );
    assert.equal(row.status, "offen");
  });

  // ── Test 2: Status 'ueberfaellig' löscht paid_amount ──────────────────────
  test("PATCH status='ueberfaellig' + paid_amount='750.50' → DB-Zeile hat paid_amount = null", async () => {
    await resetInvoice("bezahlt", "750.50");

    const res = await request(app)
      .patch(`/api/invoices/${invoiceId}`)
      .set("Content-Type", "application/json")
      .send({ status: "ueberfaellig", paid_amount: "750.50" });

    assert.equal(res.status, 200, `HTTP ${res.status} — Body: ${JSON.stringify(res.body)}`);

    const row = await fetchInvoice();
    assert.equal(
      row.paid_amount,
      null,
      `paid_amount hätte null sein sollen bei 'ueberfaellig', ist: ${row.paid_amount}`,
    );
    assert.equal(row.status, "ueberfaellig");
  });

  // ── Test 3: Status 'bezahlt' behält paid_amount ────────────────────────────
  test("PATCH status='bezahlt' + paid_amount='1000.00' → paid_amount bleibt erhalten (kein Datenverlust)", async () => {
    await resetInvoice("offen", null);

    const res = await request(app)
      .patch(`/api/invoices/${invoiceId}`)
      .set("Content-Type", "application/json")
      .send({ status: "bezahlt", paid_amount: "1000.00" });

    assert.equal(res.status, 200, `HTTP ${res.status} — Body: ${JSON.stringify(res.body)}`);

    const row = await fetchInvoice();
    assert.ok(
      row.paid_amount !== null,
      `paid_amount hätte erhalten bleiben sollen bei 'bezahlt', ist null`,
    );
    // DB speichert numerisch; Wert muss 1000 entsprechen
    assert.equal(Number(row.paid_amount), 1000, `paid_amount = ${row.paid_amount}`);
    assert.equal(row.status, "bezahlt");
  });

  // ── Test 4: snake_case → camelCase-Normalisierung über die echte Pipeline ──
  test("snake_case-Feld 'paid_amount' wird korrekt normalisiert bevor applyInvoiceStatusRules greift", async () => {
    await resetInvoice("bezahlt", "999.99");

    const res = await request(app)
      .patch(`/api/invoices/${invoiceId}`)
      .set("Content-Type", "application/json")
      // Sendet snake_case — snakeToCamel muss das VOR Zod und dem Status-Reset normalisieren
      .send({ status: "offen", paid_amount: "999.99" });

    assert.equal(res.status, 200, `HTTP ${res.status} — Body: ${JSON.stringify(res.body)}`);

    const row = await fetchInvoice();
    assert.equal(
      row.paid_amount,
      null,
      `snakeToCamel + applyInvoiceStatusRules hätten paid_amount auf null setzen sollen`,
    );
  });

  // ── Test 5: Ungültige Daten → 400 (Zod-Grenze bleibt aktiv) ───────────────
  test("Ungültiger Status → 400 Validation Error", async () => {
    const res = await request(app)
      .patch(`/api/invoices/${invoiceId}`)
      .set("Content-Type", "application/json")
      .send({ status: "unbekannter-status-xyz" });

    assert.equal(res.status, 400, `Hätte 400 sein sollen, war: ${res.status}`);
    assert.ok(res.body.error, "Fehlermeldung fehlt im Response-Body");
  });
});
