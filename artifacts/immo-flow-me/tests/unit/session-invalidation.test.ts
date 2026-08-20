/**
 * Cross-Session-Invalidierung (Task #152):
 * Sicherheitsrelevante Änderungen (2FA-Deaktivierung, Rollenänderung) melden
 * alle anderen Sitzungen und sämtliche Bearer-Tokens des Nutzers sofort ab —
 * der 60s-2FA-Konformitäts-Cache darf nicht weiterwirken.
 *
 * Nutzt den ECHTEN Produktions-Session-Store (connect-pg-simple auf
 * user_sessions), damit die serverseitige Löschung wirklich greift.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import request from "supertest";
import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import * as OTPAuth from "otpauth";
import { eq, inArray, sql } from "drizzle-orm";

import { rootDb, pool } from "../../server/db";
import * as schema from "@shared/schema";
import { setupAuth, enforcePrivileged2FA, isAuthenticated } from "../../server/auth";
import { registerTwoFactorRoutes } from "../../server/routes/twoFactorRoutes";
import { rlsMiddleware } from "../../server/middleware/rlsMiddleware";
import { bearerSessionHydration } from "../../server/middleware/bearerSessionHydration";
import { registerRoutes } from "../../server/routes";

const RUN = randomUUID().slice(0, 8);
const ORG_ID = randomUUID();
const ADMIN = randomUUID();   // deaktiviert 2FA in Session A
const ADMIN2 = randomUUID();  // Admin MIT 2FA — löst die Rollenänderung aus
const MEMBER = randomUUID();  // verliert Rolle → alle Sessions weg
const RESET_USER = randomUUID(); // setzt Passwort zurück → andere Sessions weg
const ALL = [ADMIN, ADMIN2, MEMBER, RESET_USER];
const PASSWORD = "E2e!Sess-Passwort-2026-lang";

function totpFor(secret: string): string {
  return new OTPAuth.TOTP({
    issuer: "ImmoFlowMe",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate();
}

/** Produktionsnahe App: pg-Session-Store, Auth, 2FA-Middleware, RLS. */
function makeApp() {
  const app = express();
  app.use(express.json());
  const PgStore = connectPgSimple(session);
  app.use(
    session({
      store: new PgStore({ pool: pool as any, tableName: "user_sessions", createTableIfMissing: false }),
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

/** Volle Produktions-App: wie makeApp, aber mit registerRoutes (alle Endpunkte). */
async function makeFullApp() {
  const app = express();
  app.use(express.json());
  const PgStore = connectPgSimple(session);
  app.use(
    session({
      store: new PgStore({ pool: pool as any, tableName: "user_sessions", createTableIfMissing: false }),
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
  await registerRoutes(app);
  app.use((err: any, _req: any, res: any, _next: any) =>
    res.status(500).json({ error: err?.message || "err" }));
  return app;
}

async function seedMagicToken(userId: string): Promise<string> {
  const token = `sess-inv-${RUN}-${randomUUID()}`;
  await rootDb.insert(schema.passwordResetTokens).values({
    userId,
    token,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return token;
}

describe("Cross-Session-Invalidierung bei 2FA-Disable und Rollenänderung", () => {
  before(async () => {
    const hash = await bcrypt.hash(PASSWORD, 10);
    await rootDb.insert(schema.organizations).values({ id: ORG_ID, name: `SessInv-Org-${RUN}` });
    for (const [id, role, tag] of [
      [ADMIN, "admin", "admin"],
      [ADMIN2, "admin", "admin2"],
      [MEMBER, "viewer", "member"],
      [RESET_USER, "viewer", "reset"],
    ] as const) {
      await rootDb.insert(schema.profiles).values({
        id,
        email: `sess-inv-${tag}-${RUN}@test.local`,
        passwordHash: hash,
        fullName: `SessInv ${tag}`,
        organizationId: ORG_ID,
      });
      await rootDb.insert(schema.userRoles).values({ userId: id, role: role as any });
    }
    // ADMIN2 hat 2FA bereits aktiviert → passiert die 2FA-Pflicht-Middleware
    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    await rootDb.insert(schema.user2fa).values({
      userId: ADMIN2,
      secret,
      isEnabled: true,
    });
  });

  after(async () => {
    for (const id of ALL) {
      await rootDb.delete(schema.user2fa).where(eq(schema.user2fa.userId, id));
      await rootDb.delete(schema.passwordResetTokens).where(eq(schema.passwordResetTokens.userId, id));
      await rootDb.delete(schema.passwordHistory).where(eq(schema.passwordHistory.userId, id));
      await rootDb.delete(schema.authTokens).where(eq(schema.authTokens.userId, id));
      await rootDb.delete(schema.userRoles).where(eq(schema.userRoles.userId, id));
      await rootDb.execute(sql`DELETE FROM user_sessions WHERE sess->>'userId' = ${id}`);
    }
    await rootDb.delete(schema.profiles).where(inArray(schema.profiles.id, ALL));
    await rootDb.delete(schema.organizations).where(eq(schema.organizations.id, ORG_ID));
  });

  test("2FA-Deaktivierung meldet alle anderen Sessions ab und löscht Bearer-Tokens", async () => {
    const app = makeApp();
    const agentA = request.agent(app);
    const agentB = request.agent(app);

    // Session A: Magic-Login → staged 2FA Enrollment (echter Flow)
    const loginA = await agentA
      .post("/api/auth/magic-login-api")
      .send({ token: await seedMagicToken(ADMIN) });
    assert.equal(loginA.status, 403, JSON.stringify(loginA.body));
    assert.equal(loginA.body.code, "2FA_SETUP_REQUIRED");

    const setup = await agentA.post("/api/2fa/enrollment-setup");
    assert.equal(setup.status, 200, JSON.stringify(setup.body));
    const secret = setup.body.secret as string;
    const verify = await agentA
      .post("/api/2fa/enrollment-verify")
      .send({ token: totpFor(secret) });
    assert.equal(verify.status, 200, JSON.stringify(verify.body));
    const bearer = verify.body.token as string;
    assert.ok(bearer);

    // Session B: zweiter Login desselben Nutzers, funktioniert
    const loginB = await agentB
      .post("/api/auth/magic-login-api")
      .send({ token: await seedMagicToken(ADMIN) });
    assert.equal(loginB.status, 200);
    assert.equal((await agentB.get("/api/dashboard")).status, 200);

    // Session A deaktiviert 2FA (Passwort + gültiger TOTP-Code)
    const disable = await agentA
      .post("/api/2fa/disable")
      .send({ password: PASSWORD, token: totpFor(secret) });
    assert.equal(disable.status, 200, JSON.stringify(disable.body));

    // Session B ist sofort abgemeldet
    const afterB = await agentB.get("/api/dashboard");
    assert.equal(afterB.status, 401);

    // Bearer-Tokens sind gelöscht
    const byToken = await request(app)
      .get("/api/dashboard")
      .set("Authorization", `Bearer ${bearer}`);
    assert.equal(byToken.status, 401);

    // Auch die auslösende Session A ist beendet — überall neu anmelden
    const afterA = await agentA.get("/api/dashboard");
    assert.equal(afterA.status, 401);
  });

  test("Rollenänderung über den echten Endpunkt invalidiert Sessions und Tokens des Betroffenen", async () => {
    // Volle Produktions-Routen (inkl. /api/organization/members/:id/roles)
    const app = await makeFullApp();
    const agentAdmin = request.agent(app);
    const agentM = request.agent(app);

    // Admin mit aktivierter 2FA (direkt geseedet) — passiert die 2FA-Pflicht
    const loginA = await agentAdmin
      .post("/api/auth/magic-login-api")
      .send({ token: await seedMagicToken(ADMIN2) });
    assert.equal(loginA.status, 200, JSON.stringify(loginA.body));

    // Betroffenes Mitglied: Cookie-Session + Bearer-Token aktiv
    const loginM = await agentM
      .post("/api/auth/magic-login-api")
      .send({ token: await seedMagicToken(MEMBER) });
    assert.equal(loginM.status, 200);
    const bearerM = loginM.body.token as string;
    assert.equal((await agentM.get("/api/auth/user")).status, 200);

    // Admin entzieht/ändert die Rolle über den echten Endpunkt
    const change = await agentAdmin
      .post(`/api/organization/members/${MEMBER}/roles`)
      .send({ role: "viewer", action: "remove" });
    assert.equal(change.status, 200, JSON.stringify(change.body));

    // Mitglied ist überall abgemeldet: Cookie-Session UND Bearer-Token
    assert.equal((await agentM.get("/api/auth/user")).status, 401);
    const byToken = await request(app)
      .get("/api/auth/user")
      .set("Authorization", `Bearer ${bearerM}`);
    assert.equal(byToken.status, 401);
  });

  test("Passwort-Reset invalidiert andere Sessions und Bearer-Tokens, behält aber die auslösende Sitzung", async () => {
    const app = await makeFullApp();
    const agentA = request.agent(app);
    const agentB = request.agent(app);

    const loginA = await agentA
      .post("/api/auth/magic-login-api")
      .send({ token: await seedMagicToken(RESET_USER) });
    assert.equal(loginA.status, 200, JSON.stringify(loginA.body));
    const bearerA = loginA.body.token as string;

    const loginB = await agentB
      .post("/api/auth/magic-login-api")
      .send({ token: await seedMagicToken(RESET_USER) });
    assert.equal(loginB.status, 200, JSON.stringify(loginB.body));
    const bearerB = loginB.body.token as string;
    assert.equal((await agentB.get("/api/auth/user")).status, 200);

    const resetToken = await seedMagicToken(RESET_USER);
    const reset = await agentA
      .post("/api/auth/reset-password")
      .send({ token: resetToken, password: "Reset!Passwort-2026-lang" });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));

    // Andere Cookie-Sessions und alle langlebigen Bearer-Tokens sind sofort
    // ungültig.
    assert.equal((await agentB.get("/api/auth/user")).status, 401);
    assert.equal(
      (await request(app).get("/api/auth/user").set("Authorization", `Bearer ${bearerA}`)).status,
      401,
    );
    assert.equal(
      (await request(app).get("/api/auth/user").set("Authorization", `Bearer ${bearerB}`)).status,
      401,
    );

    // Die Session, aus der der Reset ausgelöst wurde, bleibt erhalten.
    assert.equal((await agentA.get("/api/auth/user")).status, 200);
  });
});
