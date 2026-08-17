/**
 * Task #153: Registrierung privilegierter Konten (Verwalter/Admin) führt
 * direkt in die verpflichtende 2FA-Einrichtung — KEINE Vollsession, KEIN
 * Bearer-Token vor abgeschlossenem staged Enrollment.
 *
 *  1. Registrierung per Einladung als property_manager → 403 2FA_SETUP_REQUIRED,
 *     kein Token, pending-Session → enrollment-setup/verify → Vollzugang.
 *  2. Registrierung per Einladung als viewer → weiterhin Vollsession + Token.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import { randomUUID } from "crypto";
import * as OTPAuth from "otpauth";
import { eq, inArray } from "drizzle-orm";

import { rootDb, pool } from "../../server/db";
import * as schema from "@shared/schema";
import { setupAuth, enforcePrivileged2FA, isAuthenticated } from "../../server/auth";
import { registerTwoFactorRoutes } from "../../server/routes/twoFactorRoutes";
import { rlsMiddleware } from "../../server/middleware/rlsMiddleware";
import { bearerSessionHydration } from "../../server/middleware/bearerSessionHydration";

const RUN = randomUUID().slice(0, 8);
const ORG_ID = randomUUID();
const PM_EMAIL = `reg-2fa-pm-${RUN}@test.local`;
const VIEWER_EMAIL = `reg-2fa-viewer-${RUN}@test.local`;
const PASSWORD = "Reg!2fa-Passwort-2026-lang";

function totpFor(secret: string): string {
  return new OTPAuth.TOTP({
    issuer: "ImmoFlowMe",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate();
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false },
    }),
  );
  app.use(bearerSessionHydration(pool, () => {}));
  setupAuth(app);
  app.use(enforcePrivileged2FA);
  app.use(rlsMiddleware);
  registerTwoFactorRoutes(app);
  app.get("/api/dashboard", isAuthenticated, (_req, res) => res.json({ ok: true }));
  app.use((err: any, _req: any, res: any, _next: any) =>
    res.status(500).json({ error: err?.message || "err" }));
  return app;
}

async function seedInvite(email: string, role: string): Promise<string> {
  const token = `reg-2fa-${RUN}-${randomUUID()}`;
  await rootDb.insert(schema.organizationInvites).values({
    organizationId: ORG_ID,
    email,
    role: role as any,
    token,
    status: "pending" as any,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return token;
}

async function cleanupUser(email: string) {
  const profs = await rootDb
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(eq(schema.profiles.email, email));
  const ids = profs.map((p) => p.id);
  if (ids.length) {
    await rootDb.delete(schema.user2fa).where(inArray(schema.user2fa.userId, ids));
    await rootDb.delete(schema.authTokens).where(inArray(schema.authTokens.userId, ids));
    await rootDb.delete(schema.userRoles).where(inArray(schema.userRoles.userId, ids));
    await rootDb.delete(schema.userOrganizations).where(inArray(schema.userOrganizations.userId, ids));
    await rootDb.delete(schema.passwordHistory).where(inArray(schema.passwordHistory.userId, ids));
    await rootDb.delete(schema.auditLogs).where(inArray(schema.auditLogs.userId, ids));
    await rootDb.delete(schema.profiles).where(inArray(schema.profiles.id, ids));
  }
}

describe("Registrierung: privilegierte Konten müssen 2FA einrichten", () => {
  before(async () => {
    await rootDb.insert(schema.organizations).values({ id: ORG_ID, name: `Reg2FA-Org-${RUN}` });
  });

  after(async () => {
    await cleanupUser(PM_EMAIL);
    await cleanupUser(VIEWER_EMAIL);
    await rootDb.delete(schema.organizationInvites).where(eq(schema.organizationInvites.organizationId, ORG_ID));
    await rootDb.delete(schema.organizations).where(eq(schema.organizations.id, ORG_ID));
  });

  test("Verwalter-Registrierung: 403 + staged Enrollment statt Vollsession", async () => {
    const app = makeApp();
    const agent = request.agent(app);

    const invite = await seedInvite(PM_EMAIL, "property_manager");
    const reg = await agent
      .post("/api/auth/register")
      .send({ email: PM_EMAIL, password: PASSWORD, fullName: "Reg PM", token: invite });

    assert.equal(reg.status, 403, JSON.stringify(reg.body));
    assert.equal(reg.body.code, "2FA_SETUP_REQUIRED");
    assert.equal(reg.body.token, undefined, "kein Bearer-Token vor 2FA-Einrichtung");

    // Kein Bearer-Token in der DB angelegt
    const prof = await rootDb
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(eq(schema.profiles.email, PM_EMAIL));
    const tokens = await rootDb
      .select()
      .from(schema.authTokens)
      .where(eq(schema.authTokens.userId, prof[0].id));
    assert.equal(tokens.length, 0, "Registrierung darf kein auth_token anlegen");

    // pending-Session: geschützte API bleibt dicht
    assert.equal((await agent.get("/api/dashboard")).status, 401);

    // Staged Enrollment über die pending-Session
    const setup = await agent.post("/api/2fa/enrollment-setup").send({});
    assert.equal(setup.status, 200, JSON.stringify(setup.body));
    const verify = await agent
      .post("/api/2fa/enrollment-verify")
      .send({ token: totpFor(setup.body.secret) });
    assert.equal(verify.status, 200, JSON.stringify(verify.body));
    assert.ok(verify.body.token, "nach Enrollment gibt es das Bearer-Token");

    // Jetzt Vollzugang per Session und per Token
    assert.equal((await agent.get("/api/dashboard")).status, 200);
    const byBearer = await request(app)
      .get("/api/dashboard")
      .set("Authorization", `Bearer ${verify.body.token}`);
    assert.equal(byBearer.status, 200);
  });

  test("Viewer-Registrierung: weiterhin Vollsession + Token", async () => {
    const app = makeApp();
    const agent = request.agent(app);

    const invite = await seedInvite(VIEWER_EMAIL, "viewer");
    const reg = await agent
      .post("/api/auth/register")
      .send({ email: VIEWER_EMAIL, password: PASSWORD, fullName: "Reg Viewer", token: invite });

    assert.equal(reg.status, 200, JSON.stringify(reg.body));
    assert.ok(reg.body.token, "nicht-privilegierte Konten erhalten weiter ein Token");
    assert.equal((await agent.get("/api/dashboard")).status, 200);
  });
});
