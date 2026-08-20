import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { rootDb } from "../db";

/**
 * Brute-Force-Zaehler-Stores fuer die API-Key-Middleware.
 *
 * Zwei-Tier-Design (siehe apiKey.ts):
 *   Tier 1 — Aktive Sperren: nur zeitbasiert entfernt, nie durch Eviction.
 *   Tier 2 — Fehlversuch-Zaehler: zaehlt Fehlversuche pro Key.
 *
 * Implementierungen:
 *   - InMemoryBruteForceStore: prozesslokales Verhalten für Tests und einen
 *     expliziten Notfall-Fallback.
 *   - RedisBruteForceStore: INCR + PEXPIRE (Zaehler) und SET PX (Sperre). Ueberlebt
 *     Server-Neustarts und funktioniert ueber mehrere Prozesse hinweg.
 *   - PostgresBruteForceStore: persistenter Produktions-Store in der vorhandenen
 *     PostgreSQL-Datenbank; kein externer Redis-Dienst nötig.
 *
 * Der Redis-Client bleibt für bestehende Tests injizierbar. Der Standardpfad
 * für die API-Key-Middleware verwendet PostgreSQL.
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
  /**
   * Loescht den Zähler nur, wenn keine aktive Sperre besteht. Verhindert, dass
   * ein erfolgreicher paralleler Request eine gerade gesetzte Sperre umgeht.
   */
  clearFailuresIfNotBlocked(key: string): Promise<boolean>;
  /** Aktueller Fehlversuchstand im Zeitfenster für die Login-Rückmeldung. */
  getFailureCount(key: string): Promise<number>;
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

  async clearFailuresIfNotBlocked(key: string): Promise<boolean> {
    if (await this.isBlocked(key)) return false;
    this.failedMap.delete(key);
    return true;
  }

  async getFailureCount(key: string): Promise<number> {
    const rec = this.failedMap.get(key);
    if (!rec) return 0;
    if (Date.now() > rec.resetAt) {
      this.failedMap.delete(key);
      return 0;
    }
    return rec.count;
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

const CLEAR_IF_NOT_BLOCKED_LUA = `
if redis.call('EXISTS', KEYS[2]) > 0 then
  return 0
end
local c = redis.call('GET', KEYS[1])
if c and tonumber(c) >= tonumber(ARGV[1]) then
  return 0
end
redis.call('DEL', KEYS[1])
return 1
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

  async clearFailuresIfNotBlocked(key: string): Promise<boolean> {
    const result = await this.redis.eval(CLEAR_IF_NOT_BLOCKED_LUA, {
      keys: [FAIL_PREFIX + key, LOCK_PREFIX + key],
      arguments: [String(this.maxFailedAttempts)],
    });
    return Number(result) === 1;
  }

  async getFailureCount(key: string): Promise<number> {
    const raw = await this.redis.get(FAIL_PREFIX + key);
    return raw === null ? 0 : Number(raw);
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

// ── PostgreSQL ────────────────────────────────────────────────────────────────

function hashBruteForceKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Persistenter Store für den API-Key-Pfad.
 *
 * Der Zähler-Schlüssel wird nur als Hash abgelegt, damit IP-basierte Schlüssel
 * nicht im Klartext in der Datenbank landen. Der UPSERT zählt atomar hoch und
 * bleibt daher auch bei parallelen App-Prozessen korrekt.
 */
export class PostgresBruteForceStore implements BruteForceStore {
  private readonly blockDurationMs: number;
  private readonly maxFailedAttempts: number;
  private nextCleanupAt = 0;
  private static readonly cleanupIntervalMs = 5 * 60_000;
  private static readonly cleanupBatchSize = 500;

  constructor(
    options: BruteForceStoreOptions = {},
    private readonly database: typeof rootDb = rootDb,
  ) {
    this.blockDurationMs = options.blockDurationMs ?? 60_000;
    this.maxFailedAttempts = options.maxFailedAttempts ?? 10;
  }

  /**
   * Begrenzte Bereinigung abgelaufener Sperren/Zähler. Sie läuft höchstens alle
   * fünf Minuten pro Store-Instanz und löscht pro Durchlauf maximal 500 Zeilen,
   * damit eine alte Tabelle keinen normalen API-Request ausbremst.
   */
  private async cleanupExpiredRows(): Promise<void> {
    if (Date.now() < this.nextCleanupAt) return;
    this.nextCleanupAt = Date.now() + PostgresBruteForceStore.cleanupIntervalMs;
    await this.database.execute(sql`
      DELETE FROM api_key_brute_force
      WHERE ctid IN (
        SELECT ctid
        FROM api_key_brute_force
        WHERE (blocked_until IS NOT NULL AND blocked_until <= NOW())
           OR (blocked_until IS NULL AND window_started_at <= NOW() - (${this.blockDurationMs} * INTERVAL '1 millisecond'))
        ORDER BY updated_at
        LIMIT ${PostgresBruteForceStore.cleanupBatchSize}
      )
    `);
  }

  async isBlocked(key: string): Promise<boolean> {
    await this.cleanupExpiredRows();
    const keyHash = hashBruteForceKey(key);
    const result = await this.database.execute(sql`
      SELECT failure_count, window_started_at, blocked_until
      FROM api_key_brute_force
      WHERE key_hash = ${keyHash}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return false;

    const now = Date.now();
    const blockedUntil = row.blocked_until instanceof Date
      ? row.blocked_until.getTime()
      : row.blocked_until ? new Date(String(row.blocked_until)).getTime() : null;
    if (blockedUntil !== null && blockedUntil > now) return true;

    const windowStartedAt = row.window_started_at instanceof Date
      ? row.window_started_at.getTime()
      : new Date(String(row.window_started_at)).getTime();
    if (blockedUntil !== null || now - windowStartedAt >= this.blockDurationMs) {
      await this.database.execute(sql`
        DELETE FROM api_key_brute_force
        WHERE key_hash = ${keyHash}
          AND (
            (blocked_until IS NOT NULL AND blocked_until <= NOW())
            OR (blocked_until IS NULL AND window_started_at <= NOW() - (${this.blockDurationMs} * INTERVAL '1 millisecond'))
          )
      `);
      return false;
    }

    return Number(row.failure_count) >= this.maxFailedAttempts;
  }

  async recordFailure(key: string): Promise<void> {
    await this.cleanupExpiredRows();
    const keyHash = hashBruteForceKey(key);
    await this.database.execute(sql`
      INSERT INTO api_key_brute_force
        (key_hash, failure_count, window_started_at, blocked_until, updated_at)
      VALUES
        (${keyHash}, 1, NOW(), NULL, NOW())
      ON CONFLICT (key_hash) DO UPDATE SET
        failure_count = CASE
          WHEN api_key_brute_force.blocked_until IS NOT NULL
            AND api_key_brute_force.blocked_until > NOW()
            THEN api_key_brute_force.failure_count
          WHEN api_key_brute_force.window_started_at <= NOW() - (${this.blockDurationMs} * INTERVAL '1 millisecond')
            THEN 1
          ELSE api_key_brute_force.failure_count + 1
        END,
        window_started_at = CASE
          WHEN api_key_brute_force.blocked_until IS NOT NULL
            AND api_key_brute_force.blocked_until > NOW()
            THEN api_key_brute_force.window_started_at
          WHEN api_key_brute_force.window_started_at <= NOW() - (${this.blockDurationMs} * INTERVAL '1 millisecond')
            THEN NOW()
          ELSE api_key_brute_force.window_started_at
        END,
        blocked_until = CASE
          WHEN api_key_brute_force.blocked_until IS NOT NULL
            AND api_key_brute_force.blocked_until > NOW()
            THEN api_key_brute_force.blocked_until
          WHEN api_key_brute_force.window_started_at <= NOW() - (${this.blockDurationMs} * INTERVAL '1 millisecond')
            THEN NULL
          WHEN api_key_brute_force.failure_count + 1 >= ${this.maxFailedAttempts}
            THEN NOW() + (${this.blockDurationMs} * INTERVAL '1 millisecond')
          ELSE NULL
        END,
        updated_at = NOW()
    `);
  }

  async clearFailures(key: string): Promise<void> {
    const keyHash = hashBruteForceKey(key);
    await this.database.execute(sql`
      UPDATE api_key_brute_force
      SET failure_count = 0,
          window_started_at = NOW(),
          updated_at = NOW()
      WHERE key_hash = ${keyHash}
        AND (blocked_until IS NULL OR blocked_until <= NOW())
    `);
  }

  async clearFailuresIfNotBlocked(key: string): Promise<boolean> {
    const keyHash = hashBruteForceKey(key);
    const updated = await this.database.execute(sql`
      UPDATE api_key_brute_force
      SET failure_count = 0,
          window_started_at = NOW(),
          updated_at = NOW()
      WHERE key_hash = ${keyHash}
        AND (blocked_until IS NULL OR blocked_until <= NOW())
        AND failure_count < ${this.maxFailedAttempts}
      RETURNING key_hash
    `);
    if (updated.rows.length > 0) return true;

    const existing = await this.database.execute(sql`
      SELECT failure_count, blocked_until
      FROM api_key_brute_force
      WHERE key_hash = ${keyHash}
      LIMIT 1
    `);
    const row = existing.rows[0] as Record<string, unknown> | undefined;
    if (!row) return true;

    const blockedUntil = row.blocked_until instanceof Date
      ? row.blocked_until.getTime()
      : row.blocked_until ? new Date(String(row.blocked_until)).getTime() : null;
    if (blockedUntil !== null && blockedUntil > Date.now()) return false;
    return Number(row.failure_count) < this.maxFailedAttempts;
  }

  async getFailureCount(key: string): Promise<number> {
    await this.cleanupExpiredRows();
    const keyHash = hashBruteForceKey(key);
    const result = await this.database.execute(sql`
      SELECT failure_count, window_started_at, blocked_until
      FROM api_key_brute_force
      WHERE key_hash = ${keyHash}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return 0;

    const now = Date.now();
    const blockedUntil = row.blocked_until instanceof Date
      ? row.blocked_until.getTime()
      : row.blocked_until ? new Date(String(row.blocked_until)).getTime() : null;
    const windowStartedAt = row.window_started_at instanceof Date
      ? row.window_started_at.getTime()
      : new Date(String(row.window_started_at)).getTime();

    if (
      (blockedUntil !== null && blockedUntil <= now) ||
      (blockedUntil === null && now - windowStartedAt >= this.blockDurationMs)
    ) {
      return 0;
    }
    return Number(row.failure_count);
  }

  async _counterSize(): Promise<number> {
    const result = await this.database.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM api_key_brute_force
      WHERE blocked_until IS NULL
        AND failure_count > 0
        AND window_started_at > NOW() - (${this.blockDurationMs} * INTERVAL '1 millisecond')
    `);
    return Number((result.rows[0] as Record<string, unknown> | undefined)?.count ?? 0);
  }

  async _lockoutSize(): Promise<number> {
    const result = await this.database.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM api_key_brute_force
      WHERE blocked_until > NOW()
    `);
    return Number((result.rows[0] as Record<string, unknown> | undefined)?.count ?? 0);
  }
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
 * Erzeugt den dauerhaften Standard-Store. Redis bleibt nur für kompatible
 * Tests oder eine explizite Injection verfügbar.
 */
export function createDefaultBruteForceStore(options: BruteForceStoreOptions = {}): BruteForceStore {
  return new PostgresBruteForceStore(options);
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
  async clearFailuresIfNotBlocked(key: string) { return this.withFallback((s) => s.clearFailuresIfNotBlocked(key)); }
  async getFailureCount(key: string) { return this.withFallback((s) => s.getFailureCount(key)); }
  async _counterSize() { return this.withFallback((s) => s._counterSize()); }
  async _lockoutSize() { return this.withFallback((s) => s._lockoutSize()); }
}
