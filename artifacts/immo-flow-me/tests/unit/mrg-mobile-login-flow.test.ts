/**
 * Task #170 — Mobiler MRG-Login-Flow komplett durchgetestet
 *
 * Simuliert den vollständigen Ablauf der mobilen Immo-OCR-App:
 *   1. POST /api/auth/login  →  Bearer-Token
 *   2. GET  /api/properties  →  Liste (Mietverwaltung + WEG)
 *   3. GET  /api/properties/:id/units?includeTenants=true  →  Einheiten mit Mietern
 *   4. GET  /api/tenants/:id/mrg-check  →  Ampel-Status (ok / grenzwertig / überschritten)
 *   5. WEG-Liegenschaft  →  Suppression (kein MRG-Treffer)
 *
 * Wien Richtwert 2025: 6,67 €/m² → bei 75 m² unbefristet = 500,25 €/Monat
 *   ok          : grundmiete = 350  → differenz ≈ −150 (ueberschritten=false)
 *   grenzwertig : grundmiete = 510  → differenz ≈ +10  (ueberschritten=true, knapper Überschuss)
 *   überschritten: grundmiete = 800 → differenz ≈ +300 (ueberschritten=true, klarer Überschuss)
 *   WEG          : mietrecht_typ=null → Suppression     (zulassigerHmz=null)
 *
 * Testbenutzer hat die Rolle 'finance' (kein privilegiertes Rolle → kein 2FA-Enforcement).
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { Request, Response, NextFunction } from "express";
import session from "express-session";
import request from "supertest";
import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import { sql } from "drizzle-orm";

import { rootDb as db, pool } from "../../server/db";
import { bearerSessionHydration } from "../../server/middleware/bearerSessionHydration";
import { rlsMiddleware } from "../../server/middleware/rlsMiddleware";
import { setupAuth } from "../../server/auth";
import richtwertRoutes from "../../server/routes/richtwertRoutes";
import propertyRoutes from "../../server/routes/propertyRoutes";

// ── Testdaten-IDs ─────────────────────────────────────────────────────────────

const orgId   = randomUUID();
const userId  = randomUUID();
const EMAIL   = `mrg-mobile-${Date.now()}@test.example`;
const PASSWORD = "Sicher!Test123";

// Szenario A: ok (Grundmiete klar unter Richtwert)
const propOk     = randomUUID();
const unitOk     = randomUUID();
const tenantOk   = randomUUID();

// Szenario B: grenzwertig (Grundmiete knapp über Richtwert)
const propGrenz  = randomUUID();
const unitGrenz  = randomUUID();
const tenantGrenz = randomUUID();

// Szenario C: überschritten (Grundmiete deutlich über Richtwert)
const propUebers = randomUUID();
const unitUebers = randomUUID();
const tenantUebers = randomUUID();

// Szenario D: WEG-Liegenschaft (kein MRG-Check)
const propWeg    = randomUUID();
const unitWeg    = randomUUID();
const tenantWeg  = randomUUID();

// ── Express-Testapp ───────────────────────────────────────────────────────────

/**
 * Baut eine vollständige Express-App, die dieselben Middlewares wie die
 * Produktion verwendet, damit der Bearer-Token-Pfad real getestet wird.
 */
function buildFullApp() {
  const app = express();
  app.use(express.json());

  // Session-Middleware (MemoryStore genügt für Tests) — wird für POST /api/auth/login
  // und req.session.save() benötigt.
  app.use(
    session({
      secret: "test-session-secret",
      resave: false,
      saveUninitialized: false,
    }),
  );

  // Bearer-Token-Hydration: liest auth_tokens aus der DB → setzt session.userId
  app.use(bearerSessionHydration(pool as any));

  // RLS-Middleware muss nach der Session-Hydration kommen
  app.use(rlsMiddleware);

  // Auth-Routen (POST /api/auth/login, …)
  setupAuth(app);

  // Fachrouten
  app.use(richtwertRoutes);
  app.use(propertyRoutes);

  return app;
}

// ── Seed & Cleanup ────────────────────────────────────────────────────────────

async function seed() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  await db.execute(sql`
    INSERT INTO organizations (id, name, created_at)
    VALUES (${orgId}::uuid, 'MRG-Mobile-T170', NOW())
    ON CONFLICT (id) DO NOTHING`);

  await db.execute(sql`
    INSERT INTO profiles (id, email, organization_id, password_hash, full_name, created_at)
    VALUES (${userId}::uuid, ${EMAIL}, ${orgId}::uuid, ${passwordHash}, 'Test Verwalter', NOW())
    ON CONFLICT (id) DO NOTHING`);

  // Rolle 'finance' → kein 2FA-Enforcement
  await db.execute(sql`
    INSERT INTO user_roles (user_id, role)
    VALUES (${userId}::uuid, 'finance')
    ON CONFLICT DO NOTHING`);

  // ── Szenario A: ok ──
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, bundesland, mietrecht_typ, management_type, created_at)
    VALUES (${propOk}::uuid, ${orgId}::uuid, 'T170-OK', 'Testgasse 1', 'Wien', '1010', 'Wien', 'richtwert', 'mietverwaltung', NOW())
    ON CONFLICT (id) DO NOTHING`);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status, flaeche, created_at)
    VALUES (${unitOk}::uuid, ${propOk}::uuid, 'T1', 'wohnung', 'aktiv', 75, NOW())
    ON CONFLICT (id) DO NOTHING`);
  await db.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, mietbeginn, grundmiete, created_at)
    VALUES (${tenantOk}::uuid, ${unitOk}::uuid, 'Anna', 'Ok', 'anna.ok@t.at', 'aktiv', '2024-01-01', 350, NOW())
    ON CONFLICT (id) DO NOTHING`);
  await db.execute(sql`
    INSERT INTO leases (id, tenant_id, unit_id, start_date, grundmiete, status, befristet, created_at)
    VALUES (gen_random_uuid(), ${tenantOk}::uuid, ${unitOk}::uuid, '2024-01-01', 350, 'aktiv', false, NOW())`);

  // ── Szenario B: grenzwertig ──
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, bundesland, mietrecht_typ, management_type, created_at)
    VALUES (${propGrenz}::uuid, ${orgId}::uuid, 'T170-GRENZ', 'Testgasse 2', 'Wien', '1010', 'Wien', 'richtwert', 'mietverwaltung', NOW())
    ON CONFLICT (id) DO NOTHING`);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status, flaeche, created_at)
    VALUES (${unitGrenz}::uuid, ${propGrenz}::uuid, 'T1', 'wohnung', 'aktiv', 75, NOW())
    ON CONFLICT (id) DO NOTHING`);
  await db.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, mietbeginn, grundmiete, created_at)
    VALUES (${tenantGrenz}::uuid, ${unitGrenz}::uuid, 'Bernd', 'Grenz', 'bernd.grenz@t.at', 'aktiv', '2024-01-01', 510, NOW())
    ON CONFLICT (id) DO NOTHING`);
  await db.execute(sql`
    INSERT INTO leases (id, tenant_id, unit_id, start_date, grundmiete, status, befristet, created_at)
    VALUES (gen_random_uuid(), ${tenantGrenz}::uuid, ${unitGrenz}::uuid, '2024-01-01', 510, 'aktiv', false, NOW())`);

  // ── Szenario C: überschritten ──
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, bundesland, mietrecht_typ, management_type, created_at)
    VALUES (${propUebers}::uuid, ${orgId}::uuid, 'T170-UEBERS', 'Testgasse 3', 'Wien', '1010', 'Wien', 'richtwert', 'mietverwaltung', NOW())
    ON CONFLICT (id) DO NOTHING`);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status, flaeche, created_at)
    VALUES (${unitUebers}::uuid, ${propUebers}::uuid, 'T1', 'wohnung', 'aktiv', 75, NOW())
    ON CONFLICT (id) DO NOTHING`);
  await db.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, mietbeginn, grundmiete, created_at)
    VALUES (${tenantUebers}::uuid, ${unitUebers}::uuid, 'Clara', 'Uebers', 'clara.uebers@t.at', 'aktiv', '2024-01-01', 800, NOW())
    ON CONFLICT (id) DO NOTHING`);
  await db.execute(sql`
    INSERT INTO leases (id, tenant_id, unit_id, start_date, grundmiete, status, befristet, created_at)
    VALUES (gen_random_uuid(), ${tenantUebers}::uuid, ${unitUebers}::uuid, '2024-01-01', 800, 'aktiv', false, NOW())`);

  // ── Szenario D: WEG (kein MRG) ──
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, bundesland, mietrecht_typ, management_type, created_at)
    VALUES (${propWeg}::uuid, ${orgId}::uuid, 'T170-WEG', 'WEG-Gasse 1', 'Wien', '1010', 'Wien', NULL, 'weg', NOW())
    ON CONFLICT (id) DO NOTHING`);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status, flaeche, created_at)
    VALUES (${unitWeg}::uuid, ${propWeg}::uuid, 'T1', 'wohnung', 'aktiv', 75, NOW())
    ON CONFLICT (id) DO NOTHING`);
  await db.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, mietbeginn, grundmiete, created_at)
    VALUES (${tenantWeg}::uuid, ${unitWeg}::uuid, 'Dieter', 'Weg', 'dieter.weg@t.at', 'aktiv', '2024-01-01', 600, NOW())
    ON CONFLICT (id) DO NOTHING`);
  await db.execute(sql`
    INSERT INTO leases (id, tenant_id, unit_id, start_date, grundmiete, status, befristet, created_at)
    VALUES (gen_random_uuid(), ${tenantWeg}::uuid, ${unitWeg}::uuid, '2024-01-01', 600, 'aktiv', false, NOW())`);
}

async function cleanup() {
  await db.execute(sql`DELETE FROM leases            WHERE tenant_id IN (${tenantOk}::uuid, ${tenantGrenz}::uuid, ${tenantUebers}::uuid, ${tenantWeg}::uuid)`);
  await db.execute(sql`DELETE FROM tenants           WHERE id IN (${tenantOk}::uuid, ${tenantGrenz}::uuid, ${tenantUebers}::uuid, ${tenantWeg}::uuid)`);
  await db.execute(sql`DELETE FROM units             WHERE id IN (${unitOk}::uuid, ${unitGrenz}::uuid, ${unitUebers}::uuid, ${unitWeg}::uuid)`);
  await db.execute(sql`DELETE FROM properties        WHERE id IN (${propOk}::uuid, ${propGrenz}::uuid, ${propUebers}::uuid, ${propWeg}::uuid)`);
  // Alle FK-abhängigen Tabellen vor dem Löschen des Profils bereinigen
  await db.execute(sql`DELETE FROM auth_tokens       WHERE user_id = ${userId}::uuid`);
  await db.execute(sql`DELETE FROM security_sessions WHERE user_id = ${userId}::uuid`);
  await db.execute(sql`DELETE FROM audit_logs        WHERE user_id = ${userId}::uuid`);
  await db.execute(sql`DELETE FROM user_roles        WHERE user_id = ${userId}::uuid`);
  await db.execute(sql`DELETE FROM profiles          WHERE id = ${userId}::uuid`);
  await db.execute(sql`DELETE FROM organizations     WHERE id = ${orgId}::uuid`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Mobile MRG-Login-Flow (Task #170)", () => {
  let app: ReturnType<typeof buildFullApp>;
  let bearerToken: string;

  before(async () => {
    await cleanup();
    await seed();
    app = buildFullApp();
  });

  after(async () => {
    await cleanup();
  });

  // ── 1. Login ──────────────────────────────────────────────────────────────

  describe("1. Login — POST /api/auth/login", () => {
    test("falsche Anmeldedaten → 401", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: EMAIL, password: "falsch" });
      assert.equal(res.status, 401);
    });

    test("fehlende Felder → 400", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: EMAIL });
      assert.equal(res.status, 400);
    });

    test("gültige Anmeldedaten → 200 + Bearer-Token", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: EMAIL, password: PASSWORD });
      assert.equal(res.status, 200);
      assert.ok(res.body.token, "token fehlt im Login-Response");
      assert.equal(res.body.email, EMAIL);
      assert.ok(res.body.id, "user id fehlt im Login-Response");
      bearerToken = res.body.token;
    });
  });

  // ── 2. Liegenschaftsliste ─────────────────────────────────────────────────

  describe("2. Liegenschaftsliste — GET /api/properties", () => {
    test("anonym → 401", async () => {
      const res = await request(app).get("/api/properties");
      assert.equal(res.status, 401);
    });

    test("Bearer-Auth → 200 + alle 4 Liegenschaften sichtbar", async () => {
      const res = await request(app)
        .get("/api/properties")
        .set("Authorization", `Bearer ${bearerToken}`);
      assert.equal(res.status, 200);
      const ids = res.body.data.map((p: any) => p.id);
      assert.ok(ids.includes(propOk),     "MRG-Liegenschaft 'ok' fehlt");
      assert.ok(ids.includes(propGrenz),  "MRG-Liegenschaft 'grenzwertig' fehlt");
      assert.ok(ids.includes(propUebers), "MRG-Liegenschaft 'überschritten' fehlt");
      assert.ok(ids.includes(propWeg),    "WEG-Liegenschaft fehlt");
    });

    test("WEG-Liegenschaft hat management_type 'weg'", async () => {
      const res = await request(app)
        .get("/api/properties")
        .set("Authorization", `Bearer ${bearerToken}`);
      const wegProp = res.body.data.find((p: any) => p.id === propWeg);
      assert.ok(wegProp, "WEG-Liegenschaft nicht in der Liste");
      const mt = wegProp.management_type ?? wegProp.managementType;
      assert.equal(mt, "weg");
    });

    test("Mietverwaltungs-Liegenschaften haben management_type 'mietverwaltung'", async () => {
      const res = await request(app)
        .get("/api/properties")
        .set("Authorization", `Bearer ${bearerToken}`);
      for (const pid of [propOk, propGrenz, propUebers]) {
        const p = res.body.data.find((x: any) => x.id === pid);
        assert.ok(p, `Liegenschaft ${pid} fehlt`);
        const mt = p.management_type ?? p.managementType;
        assert.equal(mt, "mietverwaltung", `management_type falsch für ${p.name}`);
      }
    });
  });

  // ── 3. Einheitenliste mit Mietern ─────────────────────────────────────────

  describe("3. Einheitenliste — GET /api/properties/:id/units?includeTenants=true", () => {
    test("MRG-Liegenschaft 'ok': Einheit enthält aktiven Mieter", async () => {
      const res = await request(app)
        .get(`/api/properties/${propOk}/units?includeTenants=true`)
        .set("Authorization", `Bearer ${bearerToken}`);
      assert.equal(res.status, 200);
      const units = Array.isArray(res.body) ? res.body : res.body.data;
      const unit = units.find((u: any) => u.id === unitOk);
      assert.ok(unit, "Einheit nicht gefunden");
      const activeTenant = unit.tenants?.find((t: any) => t.status === "aktiv");
      assert.ok(activeTenant, "Kein aktiver Mieter in der Einheit");
      assert.equal(activeTenant.id, tenantOk);
    });

    test("WEG-Liegenschaft: Einheit ebenfalls abrufbar", async () => {
      const res = await request(app)
        .get(`/api/properties/${propWeg}/units?includeTenants=true`)
        .set("Authorization", `Bearer ${bearerToken}`);
      assert.equal(res.status, 200);
      const units = Array.isArray(res.body) ? res.body : res.body.data;
      const unit = units.find((u: any) => u.id === unitWeg);
      assert.ok(unit, "WEG-Einheit nicht gefunden");
    });
  });

  // ── 4. MRG-Ampel-Check ────────────────────────────────────────────────────

  describe("4. MRG-Check — GET /api/tenants/:id/mrg-check", () => {
    test("anonym → 401", async () => {
      const res = await request(app).get(`/api/tenants/${tenantOk}/mrg-check`);
      assert.equal(res.status, 401);
    });

    test("Ampel GRÜN (ok): differenz negativ, ueberschritten=false", async () => {
      // grundmiete=350, Richtwert Wien 75m²≈500,25 → differenz≈-150
      const res = await request(app)
        .get(`/api/tenants/${tenantOk}/mrg-check`)
        .set("Authorization", `Bearer ${bearerToken}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.ueberschritten, false, "Mieter 'ok' fälschlich als überschritten markiert");
      assert.ok(res.body.differenz < 0, `differenz sollte negativ sein, ist: ${res.body.differenz}`);
      assert.ok(res.body.zulassigerHmz !== null, "zulassigerHmz fehlt");
      assert.ok(res.body.zulassigerHmz > 0, "zulassigerHmz muss positiv sein");
    });

    test("Ampel GELB (grenzwertig): knapp über Richtwert, ueberschritten=true", async () => {
      // grundmiete=510, Richtwert Wien 75m²≈500,25 → differenz≈+9,75
      const res = await request(app)
        .get(`/api/tenants/${tenantGrenz}/mrg-check`)
        .set("Authorization", `Bearer ${bearerToken}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.ueberschritten, true,  "Grenzwert-Mieter nicht als überschritten erkannt");
      assert.ok(res.body.differenz > 0,  `differenz sollte positiv sein, ist: ${res.body.differenz}`);
      assert.ok(res.body.differenz < 50, `differenz sollte klein sein (grenzwertig), ist: ${res.body.differenz}`);
    });

    test("Ampel ROT (überschritten): deutlich über Richtwert, ueberschritten=true", async () => {
      // grundmiete=800, Richtwert Wien 75m²≈500,25 → differenz≈+299,75
      const res = await request(app)
        .get(`/api/tenants/${tenantUebers}/mrg-check`)
        .set("Authorization", `Bearer ${bearerToken}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.ueberschritten, true, "Überschreitungs-Mieter nicht erkannt");
      assert.ok(res.body.differenz > 100, `differenz sollte deutlich positiv sein, ist: ${res.body.differenz}`);
    });

    test("WEG-Liegenschaft: MRG-Check unterdrückt (Suppression)", async () => {
      // mietrecht_typ=NULL → Warnung unterdrückt → zulassigerHmz=null
      const res = await request(app)
        .get(`/api/tenants/${tenantWeg}/mrg-check`)
        .set("Authorization", `Bearer ${bearerToken}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.ueberschritten, false,    "WEG-Mieter fälschlich als überschritten markiert");
      assert.equal(res.body.zulassigerHmz, null,      "WEG-Liegenschaft soll keinen zulassigerHmz liefern");
      assert.equal(res.body.differenz, 0,             "WEG-Liegenschaft soll differenz=0 liefern");
    });

    test("Fremd-Tenant (anderes Org) → 404", async () => {
      // randomUUID() gehört zu keiner Org des Test-Nutzers
      const res = await request(app)
        .get(`/api/tenants/${randomUUID()}/mrg-check`)
        .set("Authorization", `Bearer ${bearerToken}`);
      assert.equal(res.status, 404);
    });
  });

  // ── 5. Liegenschaftsdetail ────────────────────────────────────────────────

  describe("5. Liegenschaftsdetail — GET /api/properties/:id", () => {
    test("Mietverwaltungs-Detail abrufbar mit Bearer-Token", async () => {
      const res = await request(app)
        .get(`/api/properties/${propOk}`)
        .set("Authorization", `Bearer ${bearerToken}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.id, propOk);
      assert.equal(res.body.bundesland, "Wien");
    });

    test("WEG-Liegenschaftsdetail abrufbar, kein mietrecht_typ", async () => {
      const res = await request(app)
        .get(`/api/properties/${propWeg}`)
        .set("Authorization", `Bearer ${bearerToken}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.id, propWeg);
      const mt = res.body.mietrechtTyp ?? res.body.mietrecht_typ;
      assert.ok(mt === null || mt === undefined, "WEG-Liegenschaft soll keinen mietrecht_typ haben");
    });

    test("Fremd-Liegenschaft → 403 oder 404", async () => {
      const res = await request(app)
        .get(`/api/properties/${randomUUID()}`)
        .set("Authorization", `Bearer ${bearerToken}`);
      assert.ok([403, 404].includes(res.status), `Erwartete 403/404, bekam ${res.status}`);
    });
  });
});
