/**
 * RedisBruteForceStore — Unit-Tests mit In-Memory-Fake-Redis.
 *
 * Prueft:
 * 1. INCR/PEXPIRE-Semantik: Fenster startet beim ersten Fehlversuch
 * 2. Schwellwert → Tier-1-Sperre (SET PX) + Zaehler-DEL
 * 3. Sperre laeuft nach blockDurationMs automatisch ab
 * 4. clearFailures loescht nur den Zaehler, nicht die aktive Sperre
 * 5. Neustart-Ueberleben: neue Middleware-Instanz (simulierter Serverneustart)
 *    mit demselben Redis sieht die bestehende Sperre weiterhin
 * 6. Unabhaengige Keys beeinflussen sich nicht
 *
 * Ausfuehren:
 *   node --import=./node_modules/tsx/dist/esm/index.cjs --test tests/unit/brute-force-redis-store.test.ts
 */
import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { RedisBruteForceStore, type MinimalRedisClient } from "../../server/middleware/bruteForceStore";
import { createApiKeyAuth } from "../../server/middleware/apiKey";

// ── Fake-Redis (In-Memory, mit PX-Ablauf) ────────────────────────────────────

function createFakeRedis(): MinimalRedisClient & { _dump(): Record<string, string> } {
  const data = new Map<string, { value: string; expiresAt: number | null }>();
  const alive = (k: string) => {
    const e = data.get(k);
    if (!e) return undefined;
    if (e.expiresAt !== null && Date.now() > e.expiresAt) { data.delete(k); return undefined; }
    return e;
  };
  return {
    // Emuliert das atomare INCR+PEXPIRE-Lua-Skript des Stores.
    async eval(_script, { keys, arguments: args }) {
      const key = keys[0];
      const e = alive(key);
      const next = e ? Number(e.value) + 1 : 1;
      const expiresAt = next === 1 ? Date.now() + Number(args[0]) : e?.expiresAt ?? null;
      data.set(key, { value: String(next), expiresAt });
      return next;
    },
    async exists(key) { return alive(key) ? 1 : 0; },
    async get(key) { return alive(key)?.value ?? null; },
    async set(key, value, options) {
      data.set(key, { value, expiresAt: options?.PX ? Date.now() + options.PX : null });
      return "OK";
    },
    async del(key) {
      const keys = Array.isArray(key) ? key : [key];
      let n = 0;
      for (const k of keys) if (data.delete(k)) n++;
      return n;
    },
    async scan(_cursor, { MATCH }) {
      const prefix = MATCH.replace(/\*$/, "");
      const keys = [...data.keys()].filter((k) => alive(k) && k.startsWith(prefix));
      return { cursor: 0, keys };
    },
    _dump() {
      const out: Record<string, string> = {};
      for (const k of data.keys()) { const e = alive(k); if (e) out[k] = e.value; }
      return out;
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Store-Tests ──────────────────────────────────────────────────────────────

describe("RedisBruteForceStore — Zaehler & Sperren", () => {
  let redis: ReturnType<typeof createFakeRedis>;
  let store: RedisBruteForceStore;

  beforeEach(() => {
    redis = createFakeRedis();
    store = new RedisBruteForceStore(redis, { maxFailedAttempts: 3, blockDurationMs: 120 });
  });

  test("unter Schwellwert: nicht gesperrt, Zaehler via INCR", async () => {
    await store.recordFailure("org:A");
    await store.recordFailure("org:A");
    assert.equal(await store.isBlocked("org:A"), false);
    assert.equal(redis._dump()["bf:fail:org:A"], "2");
  });

  test("Schwellwert erreicht: Tier-1-Sperre gesetzt, Zaehler geloescht", async () => {
    for (let i = 0; i < 3; i++) await store.recordFailure("org:A");
    assert.equal(await store.isBlocked("org:A"), true);
    const dump = redis._dump();
    assert.equal(dump["bf:fail:org:A"], undefined, "Zaehler muss nach Sperre geloescht sein");
    assert.equal(dump["bf:lock:org:A"], "1", "Sperr-Key muss existieren");
  });

  test("Sperre laeuft nach blockDurationMs ab", async () => {
    for (let i = 0; i < 3; i++) await store.recordFailure("org:A");
    assert.equal(await store.isBlocked("org:A"), true);
    await sleep(150);
    assert.equal(await store.isBlocked("org:A"), false);
  });

  test("Zaehler-Fenster laeuft ab (PEXPIRE beim ersten Fehlversuch)", async () => {
    await store.recordFailure("org:A");
    await sleep(150);
    assert.equal(redis._dump()["bf:fail:org:A"], undefined, "Zaehler muss abgelaufen sein");
    // Naechster Fehlversuch startet wieder bei 1
    await store.recordFailure("org:A");
    assert.equal(redis._dump()["bf:fail:org:A"], "1");
  });

  test("clearFailures loescht Zaehler aber nicht die aktive Sperre", async () => {
    for (let i = 0; i < 3; i++) await store.recordFailure("org:A");
    await store.clearFailures("org:A");
    assert.equal(await store.isBlocked("org:A"), true, "Sperre muss bestehen bleiben");
  });

  test("Keys sind unabhaengig", async () => {
    for (let i = 0; i < 3; i++) await store.recordFailure("org:A");
    assert.equal(await store.isBlocked("org:A"), true);
    assert.equal(await store.isBlocked("org:B"), false);
  });

  test("_counterSize/_lockoutSize via SCAN", async () => {
    await store.recordFailure("org:A");
    await store.recordFailure("org:B");
    for (let i = 0; i < 3; i++) await store.recordFailure("org:C");
    assert.equal(await store._counterSize(), 2);
    assert.equal(await store._lockoutSize(), 1);
  });
});

// ── Neustart-Ueberleben via Middleware ───────────────────────────────────────

describe("Brute-Force-Sperre ueberlebt Server-Neustart (Redis)", () => {
  const ORG = "restart-org";
  const KEY = "correct-key";

  function buildApp(redis: MinimalRedisClient) {
    const app = express();
    const store = new RedisBruteForceStore(redis, { maxFailedAttempts: 3, blockDurationMs: 60_000 });
    const lookup = async (orgId: string) =>
      orgId === ORG ? { id: ORG, readonlyApiKey: KEY } : undefined;
    app.use(createApiKeyAuth(lookup, { store }));
    app.get("/api/readonly/test", (_req, res) => { res.json({ ok: true }); });
    return app;
  }

  test("Sperre aus Instanz 1 gilt auch in frisch gebauter Instanz 2", async () => {
    const redis = createFakeRedis();

    // Instanz 1: bis zur Sperre fehlschlagen
    const app1 = buildApp(redis);
    for (let i = 0; i < 3; i++) {
      const res = await request(app1)
        .get(`/api/readonly/test?organization_id=${ORG}`)
        .set("X-Api-Key", "wrong");
      assert.equal(res.status, 403);
    }
    const blocked1 = await request(app1)
      .get(`/api/readonly/test?organization_id=${ORG}`)
      .set("X-Api-Key", KEY);
    assert.equal(blocked1.status, 429, "Instanz 1 muss gesperrt sein");

    // "Neustart": neue Middleware-Instanz, gleiche Redis-Daten
    const app2 = buildApp(redis);
    const blocked2 = await request(app2)
      .get(`/api/readonly/test?organization_id=${ORG}`)
      .set("X-Api-Key", KEY);
    assert.equal(blocked2.status, 429, "Sperre muss den Neustart ueberleben");
  });

  test("zweite Instanz zaehlt Fehlversuche der ersten weiter (horizontales Scaling)", async () => {
    const redis = createFakeRedis();
    const app1 = buildApp(redis);
    const app2 = buildApp(redis);

    // 2 Fehlversuche auf Instanz 1, 1 auf Instanz 2 → Schwellwert 3 erreicht
    for (const app of [app1, app1, app2]) {
      const res = await request(app)
        .get(`/api/readonly/test?organization_id=${ORG}`)
        .set("X-Api-Key", "wrong");
      assert.equal(res.status, 403);
    }
    const blocked = await request(app1)
      .get(`/api/readonly/test?organization_id=${ORG}`)
      .set("X-Api-Key", KEY);
    assert.equal(blocked.status, 429, "Zaehler muss instanzuebergreifend gelten");
  });
});
