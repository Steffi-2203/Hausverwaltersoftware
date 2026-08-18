/**
 * Task #195 — Bearer-Token-Ablauf und Fälschung: fail-closed
 *
 * Sicherheits-Invariante: Wenn ein Authorization-Header mit Bearer-Token
 * vorhanden ist, MUSS der Token gültig und nicht abgelaufen sein.
 * Eine vorhandene Session-Cookie darf abgelaufene oder gefälschte Tokens
 * NICHT "still" akzeptieren.
 *
 * Szenarien:
 *   A) Abgelaufener Token, keine Session         → 401
 *   B) Gefälschter Token, keine Session          → 401
 *   C) Abgelaufener Token + bestehende Session   → 401 (KEY: kein "silent pass")
 *   D) Gefälschter Token + bestehende Session    → 401 (KEY: kein "silent pass")
 *   E) Gültiger Token, keine Session             → 200
 *   F) Gültiger Token + Session (gleicher User)  → 200
 *   G) Kein Token, bestehende Session            → 200 (normaler Web-Pfad)
 *   H) Kein Token, keine Session                 → 401
 *   I) DB-Fehler beim Token-Lookup               → 503 retryable
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { Request, Response } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import request from "supertest";
import crypto from "crypto";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";

import { rootDb, pool } from "../../server/db";
import * as schema from "@shared/schema";
import {
  isAuthenticated,
  TokenLookupDbError,
  createEnforcePrivileged2FA,
} from "../../server/auth";
import { bearerSessionHydration } from "../../server/middleware/bearerSessionHydration";

// ── Test-Daten ───────────────────────────────────────────────────────────────

const RUN = randomUUID().slice(0, 8);
const ORG_ID = randomUUID();
const USER_ID = randomUUID();
const EMAIL = `tok-reject-${RUN}@test.local`;

// ── Test-App ──────────────────────────────────────────────────────────────────

/**
 * Baut eine schlanke Express-App mit echter bearerSessionHydration + isAuthenticated.
 * Kein CSRF, kein 2FA — nur der Token-Validierungspfad.
 */
function makeApp(poolOverride?: any) {
  const app = express();
  app.use(express.json());

  const PgStore = connectPgSimple(session);
  app.use(
    session({
      store: new PgStore({
        pool: pool as any,
        tableName: "user_sessions",
        createTableIfMissing: false,
      }),
      secret: "test-secret-195",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false },
    }),
  );

  app.use(bearerSessionHydration(poolOverride ?? pool, () => {}));

  app.get("/api/protected", isAuthenticated, (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Fehler-Handler
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (err instanceof TokenLookupDbError) {
      return res.status(503).json({ retryable: true, code: "TOKEN_DB_ERROR" });
    }
    res.status(500).json({ error: err?.message || "err" });
  });

  return app;
}

/**
 * App mit enforcePrivileged2FA (kein Token-Resolver, Fokus auf Flag-Check).
 * Privilegierte Route: gibt 401 zurück, wenn _bearerTokenRejected gesetzt ist.
 */
function makePrivilegedApp() {
  const app = express();
  app.use(express.json());

  const PgStore = connectPgSimple(session);
  app.use(
    session({
      store: new PgStore({
        pool: pool as any,
        tableName: "user_sessions",
        createTableIfMissing: false,
      }),
      secret: "test-secret-195b",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false },
    }),
  );

  app.use(bearerSessionHydration(pool, () => {}));

  // enforcePrivileged2FA mit Dummy-Resolver (immer ok=true, damit 2FA nicht blockiert)
  const enforce2FA = createEnforcePrivileged2FA(async () => true);
  app.use(enforce2FA as any);

  app.get("/api/protected", isAuthenticated, (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: err?.message || "err" });
  });

  return app;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function insertToken(userId: string, expiresInMs: number): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + expiresInMs);
  await rootDb.execute(sql`
    INSERT INTO auth_tokens (user_id, token, expires_at)
    VALUES (${userId}::uuid, ${token}, ${expiresAt})
    ON CONFLICT DO NOTHING
  `);
  return token;
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

before(async () => {
  const hash = await bcrypt.hash("test-password-195", 10);
  await rootDb.insert(schema.organizations).values({
    id: ORG_ID,
    name: `TokReject-Org-${RUN}`,
  });
  await rootDb.insert(schema.profiles).values({
    id: USER_ID,
    email: EMAIL,
    passwordHash: hash,
    fullName: `TokReject-${RUN}`,
    organizationId: ORG_ID,
  });
});

after(async () => {
  await rootDb.execute(sql`DELETE FROM auth_tokens WHERE user_id = ${USER_ID}::uuid`);
  await rootDb.execute(sql`DELETE FROM user_sessions WHERE sess->>'userId' = ${USER_ID}`);
  await rootDb.execute(sql`DELETE FROM user_roles WHERE user_id = ${USER_ID}::uuid`);
  await rootDb.execute(sql`DELETE FROM profiles WHERE id = ${USER_ID}::uuid`);
  await rootDb.execute(sql`DELETE FROM organizations WHERE id = ${ORG_ID}::uuid`);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Token-Ablauf und Fälschung: fail-closed (Task #195)", () => {
  // ── A: Abgelaufener Token, keine Session ──────────────────────────────────
  test("[A] Abgelaufener Token (expires_at in Vergangenheit), keine Session → 401", async () => {
    const expiredToken = await insertToken(USER_ID, -60_000); // 1 min in Vergangenheit
    const app = makeApp();

    const res = await request(app)
      .get("/api/protected")
      .set("Authorization", `Bearer ${expiredToken}`);

    assert.equal(res.status, 401, `Erwartet 401, bekam ${res.status}: ${JSON.stringify(res.body)}`);
  });

  // ── B: Gefälschter Token (nicht in DB), keine Session ────────────────────
  test("[B] Gefälschter Token (nicht in auth_tokens), keine Session → 401", async () => {
    const forgedToken = crypto.randomBytes(32).toString("hex");
    const app = makeApp();

    const res = await request(app)
      .get("/api/protected")
      .set("Authorization", `Bearer ${forgedToken}`);

    assert.equal(res.status, 401, `Erwartet 401, bekam ${res.status}`);
  });

  // ── C: Abgelaufener Token + bestehende Session → MUSS 401 sein ───────────
  test("[C] Abgelaufener Token + gültige Session-Cookie → 401 (kein silent pass)", async () => {
    const app = makeApp();
    const agent = request.agent(app); // behält Session-Cookie

    // Schritt 1: Gültige Session herstellen (über gültigen Token)
    const validToken = await insertToken(USER_ID, 60 * 60_000); // 1h Zukunft
    const step1 = await agent
      .get("/api/protected")
      .set("Authorization", `Bearer ${validToken}`);
    assert.equal(step1.status, 200, `Setup-Schritt fehlgeschlagen: ${JSON.stringify(step1.body)}`);

    // Schritt 2: Denselben Token direkt in der DB auf abgelaufen setzen
    await rootDb.execute(sql`
      UPDATE auth_tokens
      SET expires_at = NOW() - INTERVAL '1 minute'
      WHERE token = ${validToken}
    `);

    // Schritt 3: Anfrage mit abgelaufenem Token — Session-Cookie noch aktiv
    // ERWARTUNG: 401, obwohl Session-Cookie vorhanden ist (bearerTokenRejected-Flag)
    const step3 = await agent
      .get("/api/protected")
      .set("Authorization", `Bearer ${validToken}`);

    assert.equal(
      step3.status,
      401,
      `Abgelaufener Token + Session-Cookie: Erwartet 401, bekam ${step3.status} — "silent acceptance" Regression!`,
    );
    assert.ok(
      step3.body.code === "TOKEN_INVALID_OR_EXPIRED" || step3.body.message === "Unauthorized",
      `Response-Body sollte expliziten Fehlercode enthalten: ${JSON.stringify(step3.body)}`,
    );
  });

  // ── D: Gefälschter Token + bestehende Session → MUSS 401 sein ────────────
  test("[D] Gefälschter Token + gültige Session-Cookie → 401 (kein silent pass)", async () => {
    const app = makeApp();
    const agent = request.agent(app);

    // Schritt 1: Gültige Session herstellen
    const setupToken = await insertToken(USER_ID, 60 * 60_000);
    const setup = await agent
      .get("/api/protected")
      .set("Authorization", `Bearer ${setupToken}`);
    assert.equal(setup.status, 200, `Setup fehlgeschlagen: ${JSON.stringify(setup.body)}`);

    // Schritt 2: Anfrage mit GEFÄLSCHTEM Token — Session-Cookie noch aktiv
    const forgedToken = crypto.randomBytes(32).toString("hex");
    const res = await agent
      .get("/api/protected")
      .set("Authorization", `Bearer ${forgedToken}`);

    assert.equal(
      res.status,
      401,
      `Gefälschter Token + Session-Cookie: Erwartet 401, bekam ${res.status} — "silent acceptance" Regression!`,
    );
  });

  // ── E: Gültiger Token, keine Session ─────────────────────────────────────
  test("[E] Gültiger Token, keine Session → 200", async () => {
    const validToken = await insertToken(USER_ID, 60 * 60_000);
    const app = makeApp();

    const res = await request(app)
      .get("/api/protected")
      .set("Authorization", `Bearer ${validToken}`);

    assert.equal(res.status, 200, `Gültiger Token: Erwartet 200, bekam ${res.status}`);
  });

  // ── F: Gültiger Token + Session (gleicher User) ───────────────────────────
  test("[F] Gültiger Token + Session (gleicher User) → 200", async () => {
    const app = makeApp();
    const agent = request.agent(app);

    const token1 = await insertToken(USER_ID, 60 * 60_000);
    const step1 = await agent
      .get("/api/protected")
      .set("Authorization", `Bearer ${token1}`);
    assert.equal(step1.status, 200);

    // Zweite Anfrage mit einem anderen gültigen Token desselben Users + Session
    const token2 = await insertToken(USER_ID, 60 * 60_000);
    const step2 = await agent
      .get("/api/protected")
      .set("Authorization", `Bearer ${token2}`);
    assert.equal(step2.status, 200);
  });

  // ── G: Kein Token, bestehende Session (normaler Web-Pfad) ─────────────────
  test("[G] Kein Bearer-Token, bestehende Session → 200 (normaler Web-Pfad)", async () => {
    const app = makeApp();
    const agent = request.agent(app);

    // Session via Token aufbauen
    const token = await insertToken(USER_ID, 60 * 60_000);
    const setup = await agent
      .get("/api/protected")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(setup.status, 200);

    // Folge-Request OHNE Bearer-Header — Session-Cookie soll weiterhin funktionieren
    const res = await agent.get("/api/protected"); // kein Authorization-Header
    assert.equal(res.status, 200, `Web-Session ohne Token: Erwartet 200, bekam ${res.status}`);
  });

  // ── H: Kein Token, keine Session ─────────────────────────────────────────
  test("[H] Kein Bearer-Token, keine Session → 401", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/protected");
    assert.equal(res.status, 401);
  });

  // ── I: DB-Fehler beim Token-Lookup → 503 ─────────────────────────────────
  test("[I] DB-Fehler beim Token-Lookup → 503 retryable", async () => {
    // Fehlerhafter Pool, der bei jedem Query wirft
    const brokenPool = {
      query: async () => { throw new Error("simulated DB failure"); },
    } as any;

    const app = makeApp(brokenPool);
    const res = await request(app)
      .get("/api/protected")
      .set("Authorization", "Bearer some-token-that-triggers-db-error");

    assert.equal(res.status, 503, `DB-Fehler: Erwartet 503, bekam ${res.status}`);
    assert.equal(res.body.retryable, true, "retryable-Flag fehlt");
  });

  // ── Privilegierte Routen: enforcePrivileged2FA prüft Flag ebenfalls ────────
  test("[C2] Abgelaufener Token + Session → enforcePrivileged2FA gibt ebenfalls 401", async () => {
    const app = makePrivilegedApp();
    const agent = request.agent(app);

    // Setup: Session via gültigem Token
    const validToken = await insertToken(USER_ID, 60 * 60_000);
    const setup = await agent
      .get("/api/protected")
      .set("Authorization", `Bearer ${validToken}`);
    assert.equal(setup.status, 200);

    // Token ablaufen lassen
    await rootDb.execute(sql`
      UPDATE auth_tokens
      SET expires_at = NOW() - INTERVAL '1 minute'
      WHERE token = ${validToken}
    `);

    const res = await agent
      .get("/api/protected")
      .set("Authorization", `Bearer ${validToken}`);

    assert.equal(
      res.status,
      401,
      `enforcePrivileged2FA: Abgelaufener Token + Session soll 401 liefern, bekam ${res.status}`,
    );
  });
});
