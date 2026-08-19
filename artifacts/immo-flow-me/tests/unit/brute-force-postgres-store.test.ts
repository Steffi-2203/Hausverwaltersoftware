/**
 * Persistenztests für den PostgreSQL-Brute-Force-Store.
 *
 * Prüft den tatsächlichen Produktionspfad: atomare Zählung, Sperre,
 * Neustart-Persistenz und zeitbasiertes Ablaufen.
 *
 * Ausführen:
 *   node --import=./node_modules/tsx/dist/esm/index.cjs --test tests/unit/brute-force-postgres-store.test.ts
 */
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { appPool, rootDb } from "../../server/db";
import { createApiKeyAuth } from "../../server/middleware/apiKey";
import { PostgresBruteForceStore } from "../../server/middleware/bruteForceStore";

const createdKeys: string[] = [];

function key(label: string): string {
  const value = `test:brute-force-postgres:${label}:${process.pid}:${Date.now()}:${createdKeys.length}`;
  createdKeys.push(createHash("sha256").update(value).digest("hex"));
  return value;
}

after(async () => {
  if (!createdKeys.length) return;
  await rootDb.execute(sql`
    DELETE FROM api_key_brute_force
    WHERE key_hash IN ${sql.raw(`(${createdKeys.map((hash) => `'${hash}'`).join(",")})`)}
  `);
});

describe("PostgresBruteForceStore", () => {
  test("Sperre überlebt eine neue Store-Instanz", async () => {
    const subject = key("restart");
    const store1 = new PostgresBruteForceStore({ maxFailedAttempts: 3, blockDurationMs: 60_000 });
    for (let i = 0; i < 3; i++) await store1.recordFailure(subject);
    assert.equal(await store1.isBlocked(subject), true);

    const store2 = new PostgresBruteForceStore({ maxFailedAttempts: 3, blockDurationMs: 60_000 });
    assert.equal(await store2.isBlocked(subject), true);
  });

  test("parallele Fehlversuche setzen atomar die Sperre", async () => {
    const subject = key("parallel");
    const store = new PostgresBruteForceStore({ maxFailedAttempts: 10, blockDurationMs: 60_000 });
    await Promise.all(Array.from({ length: 10 }, () => store.recordFailure(subject)));
    assert.equal(await store.isBlocked(subject), true);
  });

  test("Erfolg löscht nur den Zähler, nicht eine aktive Sperre", async () => {
    const counterOnly = key("clear-counter");
    const store = new PostgresBruteForceStore({ maxFailedAttempts: 3, blockDurationMs: 60_000 });
    await store.recordFailure(counterOnly);
    await store.recordFailure(counterOnly);
    await store.clearFailures(counterOnly);
    assert.equal(await store.isBlocked(counterOnly), false);

    const locked = key("clear-lock");
    for (let i = 0; i < 3; i++) await store.recordFailure(locked);
    await store.clearFailures(locked);
    assert.equal(await store.isBlocked(locked), true);
  });

  test("Sperre läuft nach dem Zeitfenster ab", async () => {
    const subject = key("expiry");
    const store = new PostgresBruteForceStore({ maxFailedAttempts: 3, blockDurationMs: 80 });
    for (let i = 0; i < 3; i++) await store.recordFailure(subject);
    assert.equal(await store.isBlocked(subject), true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(await store.isBlocked(subject), false);
  });

  test("Default-Middleware verwendet PostgreSQL über eine neue Instanz hinweg", async () => {
    const organizationId = key("middleware");
    const buildApp = () => {
      const app = express();
      app.use(createApiKeyAuth(
        async (id) => id === organizationId
          ? { id: organizationId, readonlyApiKey: "correct-test-key" }
          : undefined,
        { maxFailedAttempts: 3, blockDurationMs: 60_000 },
      ));
      app.get("/api/readonly/test", (_req, res) => res.json({ ok: true }));
      return app;
    };

    const firstApp = buildApp();
    for (let i = 0; i < 3; i++) {
      const response = await request(firstApp)
        .get(`/api/readonly/test?organization_id=${organizationId}`)
        .set("X-Api-Key", "wrong-test-key");
      assert.equal(response.status, 403);
    }

    const restartedApp = buildApp();
    const blocked = await request(restartedApp)
      .get(`/api/readonly/test?organization_id=${organizationId}`)
      .set("X-Api-Key", "correct-test-key");
    assert.equal(blocked.status, 429);
  });

  test("normale App-Rolle kann Sperrdaten nicht lesen oder ändern", async () => {
    const client = await appPool.connect();
    try {
      await assert.rejects(
        client.query("SELECT key_hash FROM api_key_brute_force LIMIT 1"),
        (error: { code?: string }) => error.code === "42501",
      );
      await assert.rejects(
        client.query("UPDATE api_key_brute_force SET updated_at = NOW() WHERE false"),
        (error: { code?: string }) => error.code === "42501",
      );
    } finally {
      client.release();
    }
  });
});