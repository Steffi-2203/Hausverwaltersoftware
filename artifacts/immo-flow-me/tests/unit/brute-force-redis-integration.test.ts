/**
 * RedisBruteForceStore — Integrationstests gegen ECHTES Redis.
 *
 * Startet einen lokalen redis-server auf einem freien Port und prueft:
 * 1. Atomaritaet: nach jedem recordFailure hat der Zaehler IMMER eine TTL
 *    (Lua-Skript INCR+PEXPIRE — kein TTL-loser Zaehler moeglich)
 * 2. Sperre ueberlebt eine neue Store-Instanz (simulierter Server-Neustart)
 * 3. Unerreichbares Redis: LazyRedisBruteForceStore haengt nicht, faellt
 *    innerhalb des Timeouts auf In-Memory zurueck und sperrt weiterhin
 *
 * Ausfuehren:
 *   node --import=./node_modules/tsx/dist/esm/index.cjs --test tests/unit/brute-force-redis-integration.test.ts
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createClient } from "redis";
import {
  RedisBruteForceStore,
  LazyRedisBruteForceStore,
  type MinimalRedisClient,
} from "../../server/middleware/bruteForceStore";

const PORT = 6390 + Math.floor(Math.random() * 100);
let server: ChildProcess | null = null;
let client: ReturnType<typeof createClient> | null = null;

async function waitForRedis(url: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const probe = createClient({ url, socket: { connectTimeout: 500, reconnectStrategy: false } });
      probe.on("error", () => {});
      await probe.connect();
      await probe.quit();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("redis-server wurde nicht rechtzeitig erreichbar");
}

describe("RedisBruteForceStore — echtes Redis", () => {
  before(async () => {
    server = spawn("redis-server", ["--port", String(PORT), "--save", "", "--appendonly", "no"], {
      stdio: "ignore",
    });
    await waitForRedis(`redis://127.0.0.1:${PORT}`);
    client = createClient({ url: `redis://127.0.0.1:${PORT}` });
    client.on("error", () => {});
    await client.connect();
  });

  after(async () => {
    try { await client?.quit(); } catch {}
    server?.kill("SIGKILL");
  });

  test("Zaehler hat nach JEDEM recordFailure eine TTL (atomares Lua-Skript)", async () => {
    const store = new RedisBruteForceStore(client as unknown as MinimalRedisClient, {
      maxFailedAttempts: 10,
      blockDurationMs: 60_000,
    });
    for (let i = 1; i <= 5; i++) {
      await store.recordFailure("org:ttl-check");
      const ttl = await client!.pTTL("bf:fail:org:ttl-check");
      assert.ok(ttl > 0 && ttl <= 60_000, `Nach Versuch ${i}: TTL muss gesetzt sein, war ${ttl}`);
      const count = await client!.get("bf:fail:org:ttl-check");
      assert.equal(count, String(i));
    }
  });

  test("Schwellwert setzt Sperr-Key mit TTL und loescht den Zaehler", async () => {
    const store = new RedisBruteForceStore(client as unknown as MinimalRedisClient, {
      maxFailedAttempts: 3,
      blockDurationMs: 60_000,
    });
    for (let i = 0; i < 3; i++) await store.recordFailure("org:lock-check");
    assert.equal(await store.isBlocked("org:lock-check"), true);
    assert.equal(await client!.exists("bf:fail:org:lock-check"), 0, "Zaehler muss geloescht sein");
    const lockTtl = await client!.pTTL("bf:lock:org:lock-check");
    assert.ok(lockTtl > 0 && lockTtl <= 60_000, `Sperr-Key braucht TTL, war ${lockTtl}`);
  });

  test("Sperre ueberlebt neue Store-Instanz (simulierter Neustart)", async () => {
    const store1 = new RedisBruteForceStore(client as unknown as MinimalRedisClient, {
      maxFailedAttempts: 3,
      blockDurationMs: 60_000,
    });
    for (let i = 0; i < 3; i++) await store1.recordFailure("org:restart");
    // "Neustart": frische Store-Instanz UND frische Redis-Verbindung
    const client2 = createClient({ url: `redis://127.0.0.1:${PORT}` });
    client2.on("error", () => {});
    await client2.connect();
    try {
      const store2 = new RedisBruteForceStore(client2 as unknown as MinimalRedisClient, {
        maxFailedAttempts: 3,
        blockDurationMs: 60_000,
      });
      assert.equal(await store2.isBlocked("org:restart"), true, "Sperre muss Neustart ueberleben");
    } finally {
      await client2.quit();
    }
  });

  test("clearFailures loescht Zaehler, laesst aktive Sperre stehen", async () => {
    const store = new RedisBruteForceStore(client as unknown as MinimalRedisClient, {
      maxFailedAttempts: 3,
      blockDurationMs: 60_000,
    });
    for (let i = 0; i < 3; i++) await store.recordFailure("org:clear");
    await store.clearFailures("org:clear");
    assert.equal(await store.isBlocked("org:clear"), true);
  });
});

describe("LazyRedisBruteForceStore — unerreichbares Redis", () => {
  test("haengt nicht: faellt innerhalb des Timeouts auf In-Memory zurueck und sperrt weiter", async () => {
    // Port ohne Listener → Verbindung schlaegt fehl
    const store = new LazyRedisBruteForceStore(
      "redis://127.0.0.1:1", // reserviert/geschlossen
      { maxFailedAttempts: 3, blockDurationMs: 60_000 },
      500,   // connectTimeoutMs
      60_000 // retryBackoffMs
    );
    const started = Date.now();
    for (let i = 0; i < 3; i++) await store.recordFailure("org:down");
    const blocked = await store.isBlocked("org:down");
    const elapsed = Date.now() - started;
    assert.equal(blocked, true, "In-Memory-Fallback muss weiterhin sperren");
    assert.ok(elapsed < 5_000, `Darf nicht haengen (brauchte ${elapsed}ms)`);
  });
});
