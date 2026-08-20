/**
 * End-to-End-Tests für die 2FA-Erzwingung über die ECHTEN Auth-Endpunkte
 * (Task #151, aufbauend auf der Middleware aus Task #130).
 *
 * Abgedeckte Wege — jeweils mit echten Endpunkten, echter Session und echter DB:
 *  1. Magic-Login eines Admins ohne 2FA → 403 2FA_SETUP_REQUIRED, nur
 *     pending-Session und kein Bearer-Token; via staged Enrollment klappt der Zugriff.
 *  2. Ein nicht-privilegierter Nutzer kommt per Magic-Login unverändert mit
 *     Bearer-Token durch.
 *  3. Staged Enrollment: Passwort-Login eines Admins ohne 2FA → 403 mit
 *     pending-Session → /api/2fa/enrollment-setup + enrollment-verify →
 *     Vollzugang per Session UND per zurückgegebenem Bearer-Token.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import * as OTPAuth from "otpauth";
import { eq, inArray } from "drizzle-orm";

import { rootDb, db, currentOrgId } from "../../server/db";
import * as schema from "@shared/schema";
import { setupAuth, enforcePrivileged2FA, isAuthenticated } from "../../server/auth";
import { registerTwoFactorRoutes } from "../../server/routes/twoFactorRoutes";
import { rlsMiddleware } from "../../server/middleware/rlsMiddleware";
import { bearerSessionHydration } from "../../server/middleware/bearerSessionHydration";
import { pool } from "../../server/db";

const RUN = randomUUID().slice(0, 8);
const ORG_ID = randomUUID();
const ADMIN_MAGIC = randomUUID();   // Magic-Login + Setup-Flow
const ADMIN_BEARER = randomUUID();  // Bearer-Block-Test (bleibt ohne 2FA)
const VIEWER = randomUUID();        // Bearer-Erlaubt-Test
const ADMIN_STAGED = randomUUID();  // Passwort-Login → staged Enrollment
const VIEWER_HTML = randomUUID();   // Browser-Magic-Login (GET /api/auth/magic-login)
const ADMIN_MAGIC_BROWSER = randomUUID(); // Browser-Magic-Login → staged Enrollment
const VIEWER_MAGIC_API_RACE = randomUUID();
const VIEWER_MAGIC_BROWSER_RACE = randomUUID();
const ALL = [
  ADMIN_MAGIC,
  ADMIN_BEARER,
  VIEWER,
  ADMIN_STAGED,
  VIEWER_HTML,
  ADMIN_MAGIC_BROWSER,
  VIEWER_MAGIC_API_RACE,
  VIEWER_MAGIC_BROWSER_RACE,
];

const STAGED_PASSWORD = "E2e!Test-Passwort-2026-lang";

function totpFor(secret: string): string {
  return new OTPAuth.TOTP({
    issuer: "ImmoFlowMe",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate();
}

/** Baut die App wie in Produktion: Session → Auth-Routen → 2FA-Middleware → Routen. */
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
  // Wie in Produktion: Bearer-Token → Session-Hydration vor den Auth-Routen
  app.use(bearerSessionHydration(pool, () => {}));
  setupAuth(app);
  app.use(enforcePrivileged2FA);
  app.use(rlsMiddleware);
  registerTwoFactorRoutes(app);
  // Wie in Produktion: geschützte Routen tragen zusätzlich isAuthenticated
  app.get("/api/dashboard", isAuthenticated, (_req, res) => res.json({ ok: true }));
  // Echte org-gebundene Route: nutzt den RLS-`db`-Proxy, der ohne
  // Org-Kontext wirft — beweist, dass die Session organizationId trägt
  // und rlsMiddleware den Kontext aufgebaut hat.
  app.get("/api/org-scoped", isAuthenticated, async (_req, res) => {
    try {
      const rows = await db.select().from(schema.properties).limit(1);
      res.json({ orgId: currentOrgId(), count: rows.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
  // Fehler (z.B. TokenLookupDbError) nicht als HTML-Stacktrace
  app.use((err: any, _req: any, res: any, _next: any) =>
    res.status(500).json({ error: err?.message || "err" }));
  return app;
}

async function seedMagicToken(userId: string): Promise<string> {
  const token = `e2e-${RUN}-${randomUUID()}`;
  await rootDb.insert(schema.passwordResetTokens).values({
    userId,
    token,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return token;
}

describe("2FA-Erzwingung End-to-End über echte Auth-Endpunkte", () => {
  before(async () => {
    const hash = await bcrypt.hash(STAGED_PASSWORD, 10);
    await rootDb.insert(schema.organizations).values({
      id: ORG_ID,
      name: `2FA-E2E-Org-${RUN}`,
    });
    const rows: Array<[string, string, string]> = [
      [ADMIN_MAGIC, "admin", "magic"],
      [ADMIN_BEARER, "admin", "bearer"],
      [VIEWER, "viewer", "viewer"],
      [ADMIN_STAGED, "admin", "staged"],
      [VIEWER_HTML, "viewer", "html"],
      [ADMIN_MAGIC_BROWSER, "admin", "magic-browser"],
      [VIEWER_MAGIC_API_RACE, "viewer", "magic-api-race"],
      [VIEWER_MAGIC_BROWSER_RACE, "viewer", "magic-browser-race"],
    ];
    for (const [id, role, tag] of rows) {
      await rootDb.insert(schema.profiles).values({
        id,
        email: `2fa-e2e-${tag}-${RUN}@test.local`,
        passwordHash: id === ADMIN_STAGED ? hash : "x",
        fullName: `E2E ${tag}`,
        organizationId: ORG_ID,
      });
      await rootDb.insert(schema.userRoles).values({ userId: id, role: role as any });
    }
  });

  after(async () => {
    await rootDb.delete(schema.user2fa).where(inArray(schema.user2fa.userId, ALL));
    await rootDb.delete(schema.passwordResetTokens).where(inArray(schema.passwordResetTokens.userId, ALL));
    await rootDb.delete(schema.authTokens).where(inArray(schema.authTokens.userId, ALL));
    await rootDb.delete(schema.userRoles).where(inArray(schema.userRoles.userId, ALL));
    await rootDb.delete(schema.profiles).where(inArray(schema.profiles.id, ALL));
    await rootDb.delete(schema.organizations).where(eq(schema.organizations.id, ORG_ID));
  });

  test("Magic-Login-API eines Admins ohne 2FA startet staged Enrollment ohne Token", async () => {
    const app = makeApp();
    const agent = request.agent(app);

    const magicToken = await seedMagicToken(ADMIN_MAGIC);
    const login = await agent.post("/api/auth/magic-login-api").send({ token: magicToken });
    assert.equal(login.status, 403, JSON.stringify(login.body));
    assert.equal(login.body.code, "2FA_SETUP_REQUIRED");
    assert.equal(login.body.token, undefined, "vor Enrollment darf kein Bearer-Token ausgegeben werden");
    const beforeEnrollment = await rootDb.select().from(schema.authTokens)
      .where(eq(schema.authTokens.userId, ADMIN_MAGIC));
    assert.equal(beforeEnrollment.length, 0, "vor Enrollment darf kein auth_token persistiert werden");

    // Die pending-Session ist kein Vollzugang.
    const blocked = await agent.get("/api/dashboard");
    assert.equal(blocked.status, 401);

    // Nur der staged Enrollment-Pfad darf fortfahren.
    const setup = await agent.post("/api/2fa/enrollment-setup").send({});
    assert.equal(setup.status, 200, JSON.stringify(setup.body));
    assert.ok(setup.body.secret, "Setup muss ein TOTP-Secret liefern");

    const verify = await agent
      .post("/api/2fa/enrollment-verify")
      .send({ token: totpFor(setup.body.secret) });
    assert.equal(verify.status, 200, JSON.stringify(verify.body));
    assert.ok(verify.body.token, "erst enrollment-verify darf ein Bearer-Token liefern");
    assert.ok(Array.isArray(verify.body.backupCodes) && verify.body.backupCodes.length > 0);

    // Jetzt kommt derselbe Nutzer durch
    const allowed = await agent.get("/api/dashboard");
    assert.equal(allowed.status, 200);
    assert.deepEqual(allowed.body, { ok: true });

    // Und die Cookie-Session trägt den Org-Kontext: eine echte RLS-gebundene
    // Route (db-Proxy) funktioniert und sieht die richtige Organisation.
    const orgScoped = await agent.get("/api/org-scoped");
    assert.equal(orgScoped.status, 200, JSON.stringify(orgScoped.body));
    assert.equal(orgScoped.body.orgId, ORG_ID);
  });

  test("Browser-Magic-Login (GET) etabliert Session inkl. Org-Kontext", async () => {
    const app = makeApp();
    const agent = request.agent(app);

    const magicToken = await seedMagicToken(VIEWER_HTML);
    const login = await agent.get(`/api/auth/magic-login?token=${magicToken}`);
    assert.equal(login.status, 200);

    // Viewer (nicht privilegiert): direkt Vollzugang inkl. RLS-Org-Kontext
    const orgScoped = await agent.get("/api/org-scoped");
    assert.equal(orgScoped.status, 200, JSON.stringify(orgScoped.body));
    assert.equal(orgScoped.body.orgId, ORG_ID);
  });

  test("Browser-Magic-Login eines Admins ohne 2FA startet ebenfalls staged Enrollment", async () => {
    const app = makeApp();
    const agent = request.agent(app);

    const magicToken = await seedMagicToken(ADMIN_MAGIC_BROWSER);
    const login = await agent.get(`/api/auth/magic-login?token=${magicToken}`);
    assert.equal(login.status, 302, JSON.stringify(login.body));
    assert.equal(login.headers.location, "/2fa-einrichten");
    const authTokens = await rootDb.select().from(schema.authTokens)
      .where(eq(schema.authTokens.userId, ADMIN_MAGIC_BROWSER));
    assert.equal(authTokens.length, 0, "Browser-Magic-Login darf vor Enrollment keinen Token erzeugen");

    const blocked = await agent.get("/api/dashboard");
    assert.equal(blocked.status, 401);
    const setup = await agent.post("/api/2fa/enrollment-setup").send({});
    assert.equal(setup.status, 200, JSON.stringify(setup.body));
  });

  test("API-Magic-Login verbraucht denselben Viewer-Link parallel nur einmal", async () => {
    const app = makeApp();
    const magicToken = await seedMagicToken(VIEWER_MAGIC_API_RACE);

    const attempts = await Promise.all([
      request(app).post("/api/auth/magic-login-api").send({ token: magicToken }),
      request(app).post("/api/auth/magic-login-api").send({ token: magicToken }),
    ]);

    assert.equal(attempts.filter((attempt) => attempt.status === 200).length, 1);
    assert.equal(attempts.filter((attempt) => attempt.status === 400).length, 1);
    const authTokens = await rootDb.select().from(schema.authTokens)
      .where(eq(schema.authTokens.userId, VIEWER_MAGIC_API_RACE));
    assert.equal(authTokens.length, 1, "ein Einmal-Link darf höchstens einen Bearer-Token ausstellen");
  });

  test("Browser-Magic-Login verbraucht denselben Viewer-Link parallel nur einmal", async () => {
    const app = makeApp();
    const magicToken = await seedMagicToken(VIEWER_MAGIC_BROWSER_RACE);

    const attempts = await Promise.all([
      request(app).get(`/api/auth/magic-login?token=${magicToken}`),
      request(app).get(`/api/auth/magic-login?token=${magicToken}`),
    ]);

    assert.equal(attempts.filter((attempt) => attempt.status === 200).length, 1);
    assert.equal(attempts.filter((attempt) => attempt.status === 302).length, 1);
    const authTokens = await rootDb.select().from(schema.authTokens)
      .where(eq(schema.authTokens.userId, VIEWER_MAGIC_BROWSER_RACE));
    assert.equal(authTokens.length, 1, "ein Einmal-Link darf höchstens einen Bearer-Token ausstellen");
  });

  test("Bearer-Token eines nicht-privilegierten Nutzers wird durchgelassen", async () => {
    const app = makeApp();

    const magicToken = await seedMagicToken(VIEWER);
    const login = await request(app)
      .post("/api/auth/magic-login-api")
      .send({ token: magicToken });
    assert.equal(login.status, 200, JSON.stringify(login.body));

    const allowed = await request(app)
      .get("/api/dashboard")
      .set("Authorization", `Bearer ${login.body.token}`);
    assert.equal(allowed.status, 200);
    assert.deepEqual(allowed.body, { ok: true });

    // Bearer-Pfad hydratisiert auch den Org-Kontext (Audit-Befund K2)
    const orgScoped = await request(app)
      .get("/api/org-scoped")
      .set("Authorization", `Bearer ${login.body.token}`);
    assert.equal(orgScoped.status, 200, JSON.stringify(orgScoped.body));
    assert.equal(orgScoped.body.orgId, ORG_ID);
  });

  test("Staged Enrollment: Passwort-Login → enrollment-setup/verify → Vollzugang", async () => {
    const app = makeApp();
    const agent = request.agent(app);
    const email = `2fa-e2e-staged-${RUN}@test.local`;

    // Passwort-Login eines Admins ohne 2FA → kein Vollzugang, pending-Session
    const login = await agent
      .post("/api/auth/login")
      .send({ email, password: STAGED_PASSWORD });
    assert.equal(login.status, 403, JSON.stringify(login.body));
    assert.equal(login.body.code, "2FA_SETUP_REQUIRED");

    // Mit der pending-Session ist die geschützte API weiterhin dicht
    const blocked = await agent.get("/api/dashboard");
    assert.equal(blocked.status, 401, "pending-Session darf keinen Vollzugang geben");

    const setup = await agent.post("/api/2fa/enrollment-setup").send({});
    assert.equal(setup.status, 200, JSON.stringify(setup.body));
    assert.ok(setup.body.secret);

    const verify = await agent
      .post("/api/2fa/enrollment-verify")
      .send({ token: totpFor(setup.body.secret) });
    assert.equal(verify.status, 200, JSON.stringify(verify.body));
    assert.ok(verify.body.token, "enrollment-verify muss ein Bearer-Token liefern");
    assert.ok(Array.isArray(verify.body.backupCodes) && verify.body.backupCodes.length > 0);

    // Vollzugang per hochgestufter Session — inkl. Org-Kontext
    const bySession = await agent.get("/api/dashboard");
    assert.equal(bySession.status, 200);
    const orgScoped = await agent.get("/api/org-scoped");
    assert.equal(orgScoped.status, 200, JSON.stringify(orgScoped.body));
    assert.equal(orgScoped.body.orgId, ORG_ID);

    // ... und per zurückgegebenem Bearer-Token (ohne Cookie)
    const byBearer = await request(app)
      .get("/api/dashboard")
      .set("Authorization", `Bearer ${verify.body.token}`);
    assert.equal(byBearer.status, 200);
  });

  test("enrollment-setup ohne pending-Session bleibt verboten", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/2fa/enrollment-setup").send({});
    assert.equal(res.status, 403);
  });
});
