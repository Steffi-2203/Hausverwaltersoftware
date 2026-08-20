/**
 * Regressionstests für die prozessübergreifenden Sperren von Passwort- und
 * 2FA-Fehlversuchen. Beide Apps erhalten eigene Store-Instanzen und teilen nur
 * PostgreSQL – das bildet Neustart und horizontale Skalierung ab.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import express from "express";
import request from "supertest";
import * as OTPAuth from "otpauth";
import { eq, inArray, sql } from "drizzle-orm";

import { rootDb } from "../../server/db";
import { setupAuth } from "../../server/auth";
import { registerTwoFactorRoutes } from "../../server/routes/twoFactorRoutes";
import {
  createAuthBruteForceProtection,
  loginBruteForceKey,
  twoFactorBruteForceKey,
} from "../../server/middleware/authBruteForce";
import { PostgresBruteForceStore } from "../../server/middleware/bruteForceStore";
import type { BruteForceStore } from "../../server/middleware/bruteForceStore";
import * as schema from "@shared/schema";
import {
  acquireAuditLogTestLock,
  releaseAuditLogTestLock,
} from "../helpers/auditLogTestLock";

const RUN = randomUUID().slice(0, 8);
const LOGIN_USER_ID = randomUUID();
const TWO_FACTOR_USER_ID = randomUUID();
const FINALIZATION_USER_ID = randomUUID();
const TWO_FACTOR_FINALIZATION_USER_ID = randomUUID();
const LOGIN_EMAIL = `auth-brute-force-${RUN}@test.local`;
const FINALIZATION_EMAIL = `auth-brute-force-finalization-${RUN}@test.local`;
const TEST_PASSWORD = "Auth-Brute-Force-Test-Passwort-2026!";
const failureHashes = [
  createHash("sha256").update(loginBruteForceKey(LOGIN_EMAIL)).digest("hex"),
  createHash("sha256").update(loginBruteForceKey(FINALIZATION_EMAIL)).digest("hex"),
  createHash("sha256").update(twoFactorBruteForceKey(TWO_FACTOR_USER_ID)).digest("hex"),
  createHash("sha256").update(twoFactorBruteForceKey(TWO_FACTOR_FINALIZATION_USER_ID)).digest("hex"),
];

function createProtection() {
  return createAuthBruteForceProtection({
    store: new PostgresBruteForceStore({
      maxFailedAttempts: 3,
      blockDurationMs: 60_000,
    }),
    maxFailedAttempts: 3,
    blockDurationMs: 60_000,
  });
}

function createLoginApp(bruteForceProtection = createProtection()) {
  const app = express();
  app.use(express.json());
  setupAuth(app, bruteForceProtection);
  return app;
}

function createTwoFactorApp(
  userId = TWO_FACTOR_USER_ID,
  bruteForceProtection = createProtection(),
) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.session = {
      pending2FAUserId: userId,
      save: (callback: (error?: Error) => void) => callback(),
    };
    next();
  });
  registerTwoFactorRoutes(app, bruteForceProtection);
  return app;
}

function totpFor(secret: string): string {
  return new OTPAuth.TOTP({
    issuer: "ImmoFlowMe",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate();
}

function createFinalizationBarrierStore(delegate: BruteForceStore) {
  let markFinalizationReached!: () => void;
  let allowFinalization!: () => void;
  const finalizationReached = new Promise<void>((resolve) => { markFinalizationReached = resolve; });
  const finalizationAllowed = new Promise<void>((resolve) => { allowFinalization = resolve; });

  const store: BruteForceStore = {
    isBlocked: (key) => delegate.isBlocked(key),
    recordFailure: (key) => delegate.recordFailure(key),
    clearFailures: (key) => delegate.clearFailures(key),
    async clearFailuresIfNotBlocked(key) {
      markFinalizationReached();
      await finalizationAllowed;
      return delegate.clearFailuresIfNotBlocked(key);
    },
    getFailureCount: (key) => delegate.getFailureCount(key),
    _counterSize: () => delegate._counterSize(),
    _lockoutSize: () => delegate._lockoutSize(),
  };

  return { store, finalizationReached, allowFinalization };
}

before(async () => {
  await acquireAuditLogTestLock();
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);
  const backupCodeHash = await bcrypt.hash("valid-backup-code", 4);

  await rootDb.insert(schema.profiles).values([
    {
      id: LOGIN_USER_ID,
      email: LOGIN_EMAIL,
      passwordHash,
      fullName: "Auth Brute Force Login",
    },
    {
      id: TWO_FACTOR_USER_ID,
      email: `auth-brute-force-2fa-${RUN}@test.local`,
      passwordHash: "unused",
      fullName: "Auth Brute Force 2FA",
    },
    {
      id: FINALIZATION_USER_ID,
      email: FINALIZATION_EMAIL,
      passwordHash,
      fullName: "Auth Brute Force Login Finalization",
    },
    {
      id: TWO_FACTOR_FINALIZATION_USER_ID,
      email: `auth-brute-force-2fa-finalization-${RUN}@test.local`,
      passwordHash: "unused",
      fullName: "Auth Brute Force 2FA Finalization",
    },
  ]);
  await rootDb.insert(schema.user2fa).values([
    {
      userId: TWO_FACTOR_USER_ID,
      secret: "JBSWY3DPEHPK3PXP",
      isEnabled: true,
      backupCodes: [backupCodeHash],
    },
    {
      userId: TWO_FACTOR_FINALIZATION_USER_ID,
      secret: "JBSWY3DPEHPK3PXP",
      isEnabled: true,
      backupCodes: [backupCodeHash],
    },
  ]);
});

after(async () => {
  try {
    await rootDb.execute(sql`
      DELETE FROM api_key_brute_force
      WHERE key_hash IN (${failureHashes[0]}, ${failureHashes[1]}, ${failureHashes[2]}, ${failureHashes[3]})
    `);
    await rootDb.delete(schema.loginAttempts)
      .where(inArray(schema.loginAttempts.email, [LOGIN_EMAIL, FINALIZATION_EMAIL]));
    await rootDb.execute(sql`
      DELETE FROM audit_logs
      WHERE user_id IN (
        ${LOGIN_USER_ID}::uuid,
        ${TWO_FACTOR_USER_ID}::uuid,
        ${FINALIZATION_USER_ID}::uuid,
        ${TWO_FACTOR_FINALIZATION_USER_ID}::uuid
      )
    `);
    await rootDb.delete(schema.user2fa)
      .where(inArray(schema.user2fa.userId, [TWO_FACTOR_USER_ID, TWO_FACTOR_FINALIZATION_USER_ID]));
    await rootDb.delete(schema.profiles)
      .where(inArray(schema.profiles.id, [
        LOGIN_USER_ID,
        TWO_FACTOR_USER_ID,
        FINALIZATION_USER_ID,
        TWO_FACTOR_FINALIZATION_USER_ID,
      ]));
  } finally {
    await releaseAuditLogTestLock();
  }
});

describe("persistente Auth-Brute-Force-Sperren", () => {
  test("zählt parallele Passwortfehler atomar und sperrt auch nach einem App-Neustart", async () => {
    const firstApp = createLoginApp();
    const failures = await Promise.all(
      Array.from({ length: 3 }, () => request(firstApp)
        .post("/api/auth/login")
        .send({ email: LOGIN_EMAIL, password: "falsch" })),
    );

    for (const response of failures) {
      assert.ok([401, 429].includes(response.status), JSON.stringify(response.body));
    }

    const restartedApp = createLoginApp();
    const blocked = await request(restartedApp)
      .post("/api/auth/login")
      .send({ email: LOGIN_EMAIL, password: TEST_PASSWORD });
    assert.equal(blocked.status, 429, JSON.stringify(blocked.body));

    const stored = await rootDb.execute(sql`
      SELECT key_hash FROM api_key_brute_force
      WHERE key_hash = ${failureHashes[0]}
    `);
    assert.equal(stored.rows.length, 1);
    assert.notEqual(String((stored.rows[0] as { key_hash: string }).key_hash), LOGIN_EMAIL);
  });

  test("TOTP- und Backup-Code-Fehler teilen einen zentralen Zähler über App-Instanzen", async () => {
    const firstApp = createTwoFactorApp();
    const [firstTotp, secondTotp] = await Promise.all([
      request(firstApp).post("/api/2fa/verify").send({ token: "000000" }),
      request(firstApp).post("/api/2fa/verify").send({ token: "000000" }),
    ]);
    assert.equal(firstTotp.status, 400, JSON.stringify(firstTotp.body));
    assert.equal(secondTotp.status, 400, JSON.stringify(secondTotp.body));

    const backupFailure = await request(firstApp)
      .post("/api/2fa/backup-verify")
      .send({ code: "wrong-backup-code" });
    assert.equal(backupFailure.status, 400, JSON.stringify(backupFailure.body));

    const restartedApp = createTwoFactorApp();
    const blocked = await request(restartedApp)
      .post("/api/2fa/verify")
      .send({ token: "000000" });
    assert.equal(blocked.status, 429, JSON.stringify(blocked.body));

    const stored = await rootDb.execute(sql`
      SELECT key_hash FROM api_key_brute_force
      WHERE key_hash = ${failureHashes[2]}
    `);
    assert.equal(stored.rows.length, 1);
    assert.notEqual(String((stored.rows[0] as { key_hash: string }).key_hash), TWO_FACTOR_USER_ID);
  });

  test("ein gültiger Passwort-Login verliert gegen den gleichzeitig gesetzten Lock", async () => {
    const failingProcess = createProtection();
    await failingProcess.recordLoginFailure(FINALIZATION_EMAIL);
    await failingProcess.recordLoginFailure(FINALIZATION_EMAIL);

    const barrier = createFinalizationBarrierStore(
      new PostgresBruteForceStore({ maxFailedAttempts: 3, blockDurationMs: 60_000 }),
    );
    const successfulApp = createLoginApp(createAuthBruteForceProtection({
      store: barrier.store,
      maxFailedAttempts: 3,
      blockDurationMs: 60_000,
    }));
    const validRequest = request(successfulApp)
      .post("/api/auth/login")
      .send({ email: FINALIZATION_EMAIL, password: TEST_PASSWORD })
      .then((response) => response);
    await barrier.finalizationReached;

    const thresholdFailure = await request(createLoginApp())
      .post("/api/auth/login")
      .send({ email: FINALIZATION_EMAIL, password: "falsch" });
    assert.equal(thresholdFailure.status, 429, JSON.stringify(thresholdFailure.body));

    barrier.allowFinalization();
    const validResponse = await validRequest;
    assert.equal(validResponse.status, 429, JSON.stringify(validResponse.body));
    assert.equal(validResponse.body.token, undefined);
  });

  test("ein gültiger TOTP-Code verliert gegen den gleichzeitig gesetzten Lock", async () => {
    const failingProcess = createProtection();
    await failingProcess.recordTwoFactorFailure(TWO_FACTOR_FINALIZATION_USER_ID);
    await failingProcess.recordTwoFactorFailure(TWO_FACTOR_FINALIZATION_USER_ID);

    const barrier = createFinalizationBarrierStore(
      new PostgresBruteForceStore({ maxFailedAttempts: 3, blockDurationMs: 60_000 }),
    );
    const successfulApp = createTwoFactorApp(
      TWO_FACTOR_FINALIZATION_USER_ID,
      createAuthBruteForceProtection({
        store: barrier.store,
        maxFailedAttempts: 3,
        blockDurationMs: 60_000,
      }),
    );
    const validRequest = request(successfulApp)
      .post("/api/2fa/verify")
      .send({ token: totpFor("JBSWY3DPEHPK3PXP") })
      .then((response) => response);
    await barrier.finalizationReached;

    const thresholdFailure = await request(createTwoFactorApp(TWO_FACTOR_FINALIZATION_USER_ID))
      .post("/api/2fa/verify")
      .send({ token: "000000" });
    assert.equal(thresholdFailure.status, 400, JSON.stringify(thresholdFailure.body));

    barrier.allowFinalization();
    const validResponse = await validRequest;
    assert.equal(validResponse.status, 429, JSON.stringify(validResponse.body));
    assert.equal(validResponse.body.token, undefined);
  });
});