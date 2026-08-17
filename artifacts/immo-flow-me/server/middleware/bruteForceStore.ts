/**
 * Brute-Force-Zaehler-Stores fuer die API-Key-Middleware.
 *
 * Zwei-Tier-Design (siehe apiKey.ts):
 *   Tier 1 — Aktive Sperren: nur zeitbasiert entfernt, nie durch Eviction.
 *   Tier 2 — Fehlversuch-Zaehler: zaehlt Fehlversuche pro Key.
 *
 * Implementierungen:
 *   - InMemoryBruteForceStore: bisheriges Map-basiertes Verhalten (Default ohne REDIS_URL,
 *     und fuer Tests).
 *   - RedisBruteForceStore: INCR + PEXPIRE (Zaehler) und SET PX (Sperre). Ueberlebt
 *     Server-Neustarts und funktioniert ueber mehrere Prozesse hinweg.
 *
 * Der Redis-Client ist injizierbar (MinimalRedisClient) — Tests koennen einen
 * In-Memory-Fake verwenden, Produktion nutzt node-redis via REDIS_URL.
 */

export interface BruteForceStoreOptions {
  maxMapSize?: number;        // nur InMemory: failedMap-Kapazitaet, default 50_000
  blockDurationMs?: number;   // Sperrdauer/Zaehler-Fenster, default 60_000
  maxFailedAttempts?: number; // Schwellwert, default 10
  cleanupIntervalMs?: number; // nur InMemory: Cleanup-Intervall, default 5 Min.
}

export interface BruteForceStore {
  /** true wenn key aktiv gesperrt ist (Tier 1 zuerst, dann Tier 2). */
  isBlocked(key: string): Promise<boolean>;
  /** Zaehlt einen Fehlversuch; ab Schwellwert wird eine Tier-1-Sperre gesetzt. */
  recordFailure(key: string): Promise<void>;
  /** Loescht den Fehlversuch-Zaehler nach erfolgreicher Authentifizierung. */
  clearFailures(key: string): Promise<void>;
  /** Testdiagnostik. */
  _counterSize(): Promise<number>;
  _lockoutSize(): Promise<number>;
}

// ── In-Memory (bisheriges Verhalten) ─────────────────────────────────────────

interface FailRecord { count: number; resetAt: number }

export class InMemoryBruteForceStore implements BruteForceStore {
  private readonly maxMapSize: number;
  private readonly blockDurationMs: number;
  private readonly maxFailedAttempts: number;
  private readonly lockoutMap = new Map<string, number>();
  private readonly failedMap = new Map<string, FailRecord>();

  constructor(options: BruteForceStoreOptions = {}) {
    this.maxMapSize = options.maxMapSize ?? 50_000;
    this.blockDurationMs = options.blockDurationMs ?? 60_000;
    this.maxFailedAttempts = options.maxFailedAttempts ?? 10;
    const cleanupIntervalMs = options.cleanupIntervalMs ?? 5 * 60_000;
    const cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [k, rec] of this.failedMap) if (now > rec.resetAt) this.failedMap.delete(k);
      for (const [k, exp] of this.lockoutMap) if (now > exp) this.lockoutMap.delete(k);
    }, cleanupIntervalMs);
    cleanupTimer.unref();
  }

  private evictIfNeeded(): void {
    if (this.failedMap.size < this.maxMapSize) return;
    const now = Date.now();
    for (const [k, rec] of this.failedMap) {
      if (now > rec.resetAt) this.failedMap.delete(k);
      if (this.failedMap.size < Math.ceil(this.maxMapSize / 2)) return;
    }
    if (this.failedMap.size >= this.maxMapSize) {
      const oldest = this.failedMap.keys().next().value;
      if (oldest !== undefined) this.failedMap.delete(oldest);
    }
  }

  async isBlocked(key: string): Promise<boolean> {
    const now = Date.now();
    const lockoutExp = this.lockoutMap.get(key);
    if (lockoutExp !== undefined) {
      if (now <= lockoutExp) return true;
      this.lockoutMap.delete(key);
    }
    const rec = this.failedMap.get(key);
    if (!rec) return false;
    if (now > rec.resetAt) { this.failedMap.delete(key); return false; }
    return rec.count >= this.maxFailedAttempts;
  }

  async recordFailure(key: string): Promise<void> {
    const now = Date.now();
    const rec = this.failedMap.get(key);
    if (!rec || now > rec.resetAt) {
      this.evictIfNeeded();
      this.failedMap.set(key, { count: 1, resetAt: now + this.blockDurationMs });
    } else {
      rec.count += 1;
      if (rec.count >= this.maxFailedAttempts) {
        this.lockoutMap.set(key, now + this.blockDurationMs);
        this.failedMap.delete(key);
      }
    }
  }

  async clearFailures(key: string): Promise<void> {
    this.failedMap.delete(key);
    // lockoutMap wird NICHT geleert (siehe apiKey.ts-Kommentar).
  }

  async _counterSize(): Promise<number> { return this.failedMap.size; }
  async _lockoutSize(): Promise<number> { return this.lockoutMap.size; }
}

// ── Redis ────────────────────────────────────────────────────────────────────

/**
 * Minimale Redis-Client-Schnittstelle (Untermenge von node-redis v4/v5).
 * Injizierbar fuer Tests.
 */
export interface MinimalRedisClient {
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
  exists(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { PX?: number }): Promise<unknown>;
  del(key: string | string[]): Promise<number>;
  scan(cursor: number | string, options: { MATCH: string; COUNT: number }): Promise<{ cursor: number | string; keys: string[] }>;
}

const FAIL_PREFIX = "bf:fail:";
const LOCK_PREFIX = "bf:lock:";

/**
 * Atomarer Fehlversuch: INCR + (nur beim ersten Versuch) PEXPIRE in EINEM
 * Redis-Roundtrip. Damit kann nie ein Zaehler ohne TTL entstehen — auch nicht
 * wenn der Prozess zwischen zwei Kommandos abstuerzt.
 * KEYS[1] = Zaehler-Key, ARGV[1] = Fenster in ms.
 */
const INCR_WITH_EXPIRE_LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return c
`.trim();

export class RedisBruteForceStore implements BruteForceStore {
  private readonly blockDurationMs: number;
  private readonly maxFailedAttempts: number;

  constructor(private readonly redis: MinimalRedisClient, options: BruteForceStoreOptions = {}) {
    this.blockDurationMs = options.blockDurationMs ?? 60_000;
    this.maxFailedAttempts = options.maxFailedAttempts ?? 10;
  }

  async isBlocked(key: string): Promise<boolean> {
    // Tier 1: aktive Sperre (laeuft via PX automatisch ab)
    if ((await this.redis.exists(LOCK_PREFIX + key)) > 0) return true;
    // Tier 2: Zaehler
    const raw = await this.redis.get(FAIL_PREFIX + key);
    return raw !== null && Number(raw) >= this.maxFailedAttempts;
  }

  async recordFailure(key: string): Promise<void> {
    const failKey = FAIL_PREFIX + key;
    // Atomar (Lua): INCR + erstes PEXPIRE in einem Schritt — kein TTL-loser Zaehler moeglich.
    const count = Number(await this.redis.eval(INCR_WITH_EXPIRE_LUA, {
      keys: [failKey],
      arguments: [String(this.blockDurationMs)],
    }));
    if (count >= this.maxFailedAttempts) {
      // Schwellwert erreicht → Tier-1-Sperre mit voller Dauer; Zaehler freigeben.
      await this.redis.set(LOCK_PREFIX + key, "1", { PX: this.blockDurationMs });
      await this.redis.del(failKey);
    }
  }

  async clearFailures(key: string): Promise<void> {
    await this.redis.del(FAIL_PREFIX + key);
    // Tier-1-Sperre bleibt bestehen (laeuft zeitbasiert ab).
  }

  private async countKeys(pattern: string): Promise<number> {
    let cursor: number | string = 0;
    let total = 0;
    do {
      const res = await this.redis.scan(cursor, { MATCH: pattern, COUNT: 500 });
      cursor = res.cursor;
      total += res.keys.length;
    } while (String(cursor) !== "0");
    return total;
  }

  async _counterSize(): Promise<number> { return this.countKeys(FAIL_PREFIX + "*"); }
  async _lockoutSize(): Promise<number> { return this.countKeys(LOCK_PREFIX + "*"); }
}

// ── Default-Factory ──────────────────────────────────────────────────────────

let sharedRedisClient: Promise<MinimalRedisClient> | null = null;

/** Verbindet mit hartem Zeitlimit — haengt nie laenger als connectTimeoutMs. */
async function getSharedRedisClient(url: string, connectTimeoutMs: number): Promise<MinimalRedisClient> {
  if (!sharedRedisClient) {
    sharedRedisClient = (async () => {
      const { createClient } = await import("redis");
      const client = createClient({
        url,
        socket: {
          connectTimeout: connectTimeoutMs,
          // Begrenzte Reconnects mit kurzem Backoff; danach endgueltig aufgeben
          // statt Anfragen unbegrenzt aufzuhalten.
          reconnectStrategy: (retries: number) =>
            retries >= 3 ? new Error("Redis reconnect aufgegeben") : Math.min(retries * 200, 1_000),
        },
      });
      client.on("error", (err: unknown) => {
        console.error("[bruteForceStore] Redis-Fehler:", err instanceof Error ? err.message : err);
      });
      // client.connect() kann trotz connectTimeout durch Reconnect-Versuche laenger
      // brauchen — hart mit Timeout racen, damit Requests nie blockieren.
      await Promise.race([
        client.connect(),
        new Promise((_res, rej) =>
          setTimeout(() => rej(new Error(`Redis-Verbindung nach ${connectTimeoutMs}ms aufgegeben`)), connectTimeoutMs).unref(),
        ),
      ]);
      console.log("[bruteForceStore] Redis verbunden — Brute-Force-Zaehler ueberleben Neustarts.");
      return client as unknown as MinimalRedisClient;
    })();
    sharedRedisClient.catch(() => { sharedRedisClient = null; });
  }
  return sharedRedisClient;
}

/**
 * Erzeugt den Default-Store:
 *   - REDIS_URL gesetzt → RedisBruteForceStore (Verbindung lazy, Fehler → Fallback siehe apiKey.ts)
 *   - sonst → InMemoryBruteForceStore (mit Warnung, da Neustarts den Zaehler leeren)
 */
export function createDefaultBruteForceStore(options: BruteForceStoreOptions = {}): BruteForceStore {
  const url = process.env.REDIS_URL;
  if (!url) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[bruteForceStore] REDIS_URL nicht gesetzt — Brute-Force-Zaehler laeuft in-memory " +
        "und wird bei Neustart/Scaling zurueckgesetzt.",
      );
    }
    return new InMemoryBruteForceStore(options);
  }
  return new LazyRedisBruteForceStore(url, options);
}

/**
 * Wrapper der die Redis-Verbindung lazy und mit hartem Zeitlimit aufbaut und
 * bei Redis-Ausfall (Verbindung ODER einzelnes Kommando) auf einen
 * In-Memory-Store zurueckfaellt — besser ein prozesslokaler Zaehler als gar
 * keiner, und Requests haengen nie an einem toten Redis.
 *
 * Exportiert fuer Tests (Fehlerpfade mit unerreichbarem Redis).
 */
export class LazyRedisBruteForceStore implements BruteForceStore {
  private redisStore: RedisBruteForceStore | null = null;
  private readonly fallback: InMemoryBruteForceStore;
  private readonly connectTimeoutMs: number;
  /** Nach einem Verbindungsfehler bis hierhin gar nicht neu versuchen (ms epoch). */
  private retryNotBefore = 0;

  constructor(
    private readonly url: string,
    private readonly options: BruteForceStoreOptions,
    connectTimeoutMs = 3_000,
    private readonly retryBackoffMs = 30_000,
  ) {
    this.fallback = new InMemoryBruteForceStore(options);
    this.connectTimeoutMs = connectTimeoutMs;
  }

  private async resolve(): Promise<BruteForceStore> {
    if (this.redisStore) return this.redisStore;
    if (Date.now() < this.retryNotBefore) return this.fallback;
    try {
      const client = await getSharedRedisClient(this.url, this.connectTimeoutMs);
      this.redisStore = new RedisBruteForceStore(client, this.options);
      return this.redisStore;
    } catch (err) {
      this.retryNotBefore = Date.now() + this.retryBackoffMs;
      console.error(
        "[bruteForceStore] Redis nicht erreichbar — Fallback auf In-Memory-Zaehler:",
        err instanceof Error ? err.message : err,
      );
      return this.fallback;
    }
  }

  /** Fuehrt op auf Redis aus; bei Laufzeitfehler eines Kommandos → In-Memory-Fallback. */
  private async withFallback<T>(op: (s: BruteForceStore) => Promise<T>): Promise<T> {
    const store = await this.resolve();
    if (store === this.fallback) return op(this.fallback);
    try {
      return await op(store);
    } catch (err) {
      console.error(
        "[bruteForceStore] Redis-Kommando fehlgeschlagen — Fallback auf In-Memory-Zaehler:",
        err instanceof Error ? err.message : err,
      );
      // Verbindung als defekt markieren; naechste Anfrage versucht Redis erneut
      // (nach Backoff), bis dahin zaehlt der In-Memory-Store weiter.
      this.redisStore = null;
      this.retryNotBefore = Date.now() + this.retryBackoffMs;
      return op(this.fallback);
    }
  }

  async isBlocked(key: string) { return this.withFallback((s) => s.isBlocked(key)); }
  async recordFailure(key: string) { return this.withFallback((s) => s.recordFailure(key)); }
  async clearFailures(key: string) { return this.withFallback((s) => s.clearFailures(key)); }
  async _counterSize() { return this.withFallback((s) => s._counterSize()); }
  async _lockoutSize() { return this.withFallback((s) => s._lockoutSize()); }
}
