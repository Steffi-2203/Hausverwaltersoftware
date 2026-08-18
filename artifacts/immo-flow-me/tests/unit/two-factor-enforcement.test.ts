/**
 * Tests für die durchgehende 2FA-Erzwingung (Task #130).
 *
 * Der Login-Endpunkt erzwingt 2FA für privilegierte Rollen bereits beim
 * Passwort-Login (staged enrollment). Die Middleware enforcePrivileged2FA
 * schließt die übrigen Wege (Bearer-Token, Magic-Login, Registrierung,
 * nachträglich vergebene Rollen): Jede API-Anfrage einer Session eines
 * Admin/Verwalters ohne aktive 2FA wird mit 403 + 2FA_SETUP_REQUIRED
 * beantwortet — außer /api/2fa/* und /api/auth/* (Setup & Logout).
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";

import { rootDb } from "../../server/db";
import { TokenLookupDbError } from "../../server/auth";
import * as schema from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import {
  enforcePrivileged2FA,
  createEnforcePrivileged2FA,
  isPrivileged2FACompliant,
} from "../../server/auth";

const uid = () => randomUUID();
const ADMIN_NO_2FA = uid();
const PM_NO_2FA = uid();
const ADMIN_WITH_2FA = uid();
const VIEWER_NO_2FA = uid();
const ALL = [ADMIN_NO_2FA, PM_NO_2FA, ADMIN_WITH_2FA, VIEWER_NO_2FA];

function makeApp(sessionUserId: string | null) {
  const app = express();
  app.use((req: any, _res, next) => {
    req.session = sessionUserId ? { userId: sessionUserId } : {};
    next();
  });
  app.use(enforcePrivileged2FA as any);
  app.get("/api/dashboard", (_req, res) => res.json({ ok: true }));
  app.get("/api/2fa/status", (_req, res) => res.json({ exempt: true }));
  app.get("/api/auth/user", (_req, res) => res.json({ exempt: true }));
  // Fail-closed: Fehler in der Middleware dürfen nicht durchlassen
  app.use((_err: any, _req: any, res: any, _next: any) => res.status(500).json({ error: "boom" }));
  return app;
}

describe("2FA-Erzwingung für privilegierte Rollen", () => {
  before(async () => {
    for (const [id, role] of [
      [ADMIN_NO_2FA, "admin"],
      [PM_NO_2FA, "property_manager"],
      [ADMIN_WITH_2FA, "admin"],
      [VIEWER_NO_2FA, "viewer"],
    ] as const) {
      await rootDb.insert(schema.profiles).values({
        id, email: `2fa-enforce-${id}@test.local`, passwordHash: "x", fullName: "T",
      });
      await rootDb.insert(schema.userRoles).values({ userId: id, role });
    }
    await rootDb.insert(schema.user2fa).values({
      userId: ADMIN_WITH_2FA, secret: "TESTSECRET", isEnabled: true,
    });
  });

  after(async () => {
    await rootDb.delete(schema.user2fa).where(inArray(schema.user2fa.userId, ALL));
    await rootDb.delete(schema.userRoles).where(inArray(schema.userRoles.userId, ALL));
    await rootDb.delete(schema.profiles).where(inArray(schema.profiles.id, ALL));
  });

  test("Admin ohne 2FA → 403 + 2FA_SETUP_REQUIRED auf geschützter Route", async () => {
    const r = await request(makeApp(ADMIN_NO_2FA)).get("/api/dashboard");
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "2FA_SETUP_REQUIRED");
    assert.equal(r.body.redirectTo, "/2fa-einrichten");
  });

  test("Verwalter (property_manager) ohne 2FA → 403", async () => {
    const r = await request(makeApp(PM_NO_2FA)).get("/api/dashboard");
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "2FA_SETUP_REQUIRED");
  });

  test("Admin mit aktiver 2FA → Zugriff erlaubt", async () => {
    const r = await request(makeApp(ADMIN_WITH_2FA)).get("/api/dashboard");
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
  });

  test("Nicht-privilegierte Rolle (viewer) ohne 2FA → Zugriff erlaubt", async () => {
    const r = await request(makeApp(VIEWER_NO_2FA)).get("/api/dashboard");
    assert.equal(r.status, 200);
  });

  test("Unauthentifizierte Anfrage → Middleware lässt durch (401 kommt vom Route-Guard)", async () => {
    const r = await request(makeApp(null)).get("/api/dashboard");
    assert.equal(r.status, 200, "Middleware selbst blockiert Unauthentifizierte nicht");
  });

  test("Ausnahme-Pfade /api/2fa/* und /api/auth/* bleiben ohne 2FA erreichbar", async () => {
    const app = makeApp(ADMIN_NO_2FA);
    const r1 = await request(app).get("/api/2fa/status");
    assert.equal(r1.status, 200);
    const r2 = await request(app).get("/api/auth/user");
    assert.equal(r2.status, 200);
  });

  test("Session-Cache: Konformität wird pro Session gemerkt (2. Anfrage weiter erlaubt)", async () => {
    // Gleiche Session-Instanz simulieren: eigenes App mit persistentem Objekt
    const session: any = { userId: ADMIN_WITH_2FA };
    const app = express();
    app.use((req: any, _res, next) => { req.session = session; next(); });
    app.use(enforcePrivileged2FA as any);
    app.get("/api/x", (_req, res) => res.json({ ok: true }));
    assert.equal((await request(app).get("/api/x")).status, 200);
    assert.equal(session.twoFactorEnforcedFor, ADMIN_WITH_2FA);
    assert.equal(typeof session.twoFactorEnforcedAt, "number");
    assert.equal((await request(app).get("/api/x")).status, 200);
  });

  test("Cache-TTL: abgelaufener Cache erzwingt Re-Check (2FA-Disable / Rollenvergabe greift)", async () => {
    // Nutzer war konform gecacht, verliert dann 2FA → nach TTL-Ablauf blockiert.
    const TEMP = uid();
    await rootDb.insert(schema.profiles).values({
      id: TEMP, email: `2fa-enforce-${TEMP}@test.local`, passwordHash: "x", fullName: "T",
    });
    await rootDb.insert(schema.userRoles).values({ userId: TEMP, role: "admin" });
    await rootDb.insert(schema.user2fa).values({ userId: TEMP, secret: "S", isEnabled: true });
    try {
      const session: any = { userId: TEMP };
      const app = express();
      app.use((req: any, _res, next) => { req.session = session; next(); });
      app.use(enforcePrivileged2FA as any);
      app.get("/api/x", (_req, res) => res.json({ ok: true }));

      assert.equal((await request(app).get("/api/x")).status, 200);
      // 2FA wird (z.B. in anderer Session) deaktiviert:
      await rootDb.update(schema.user2fa).set({ isEnabled: false })
        .where(eq(schema.user2fa.userId, TEMP));
      // Cache noch gültig → weiterhin 200
      assert.equal((await request(app).get("/api/x")).status, 200);
      // TTL abgelaufen simulieren → Re-Check → 403
      session.twoFactorEnforcedAt = Date.now() - 61_000;
      const r = await request(app).get("/api/x");
      assert.equal(r.status, 403);
      assert.equal(r.body.code, "2FA_SETUP_REQUIRED");
    } finally {
      await rootDb.delete(schema.user2fa).where(eq(schema.user2fa.userId, TEMP));
      await rootDb.delete(schema.userRoles).where(eq(schema.userRoles.userId, TEMP));
      await rootDb.delete(schema.profiles).where(eq(schema.profiles.id, TEMP));
    }
  });

  test("isPrivileged2FACompliant: direkte Prüfung", async () => {
    assert.equal(await isPrivileged2FACompliant(ADMIN_NO_2FA), false);
    assert.equal(await isPrivileged2FACompliant(ADMIN_WITH_2FA), true);
    assert.equal(await isPrivileged2FACompliant(VIEWER_NO_2FA), true);
  });

  test("DB-Fehler im Token-Lookup-Pfad → 503 retryable statt 500", async () => {
    // Über createEnforcePrivileged2FA wird ein gefälschter Token-Resolver
    // injiziert, der TokenLookupDbError wirft. So wird kein globaler Zustand
    // mutiert — der Test läuft concurrency-safe neben allen anderen Testdateien.
    const failingMiddleware = createEnforcePrivileged2FA(async () => {
      throw new TokenLookupDbError(new Error("simulated DB connection failure"));
    });

    const app = express();
    app.use((req: any, _res, next) => {
      req.session = {}; // kein userId → Token-Resolver wird aufgerufen
      next();
    });
    app.use(failingMiddleware as any);
    app.get("/api/resource", (_req, res) => res.json({ ok: true }));
    // Dieser Handler darf NICHT erreicht werden — käme er, wäre der Status 500
    app.use((_err: any, _req: any, res: any, _next: any) =>
      res.status(500).json({ error: "boom" }),
    );

    const r = await request(app)
      .get("/api/resource")
      .set("Authorization", "Bearer some-fake-token");

    assert.equal(
      r.status,
      503,
      `Erwartet 503, bekam ${r.status}: ${JSON.stringify(r.body)}`,
    );
    assert.equal(r.body.retryable, true, "retryable fehlt im Response");
    assert.equal(r.body.code, "TOKEN_DB_ERROR", "code fehlt im Response");
  });
});
