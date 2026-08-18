import { drizzle } from "drizzle-orm/node-postgres";
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import * as schema from "@shared/schema";
import {
  fireImmutableViolation,
  setImmutableViolationHandler,
  hasImmutableViolationHandler,
  type ImmutableViolationEvent,
} from "./lib/immutableViolationRegistry";
// Garantierte Handler-Registrierung für ALLE Prozesse die db.ts verwenden
// (HTTP-Server, Skripte, CLI-Tools). Muss NACH dem Registry-Import stehen.
// ESM-Zyklus ist sicher: audit.ts holt setImmutableViolationHandler aus der
// zyklenfreien Registry; currentOrgId ist eine function-Deklaration (hoistbar).
import "./lib/immutableViolationAudit";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * Superuser-Pool — ausschließlich für Migrationen, RLS-Setup, Boot-Seeds und
 * den Auth-Bootstrap (Login-Pfad, bevor der Org-Kontext bekannt ist).
 *
 * Verbindet als `postgres` (rolsuper=true, rolbypassrls=true) und DARF NICHT
 * für normale Request-Handler verwendet werden, da er RLS vollständig umgeht.
 *
 * Immutability-Trigger-Verletzungen (P0001, "… unveränderlich …") werden auf
 * Pool-Ebene abgefangen und an den über die Registry registrierten Handler
 * weitergeleitet (siehe server/lib/immutableViolationAudit.ts).
 */

// Re-Exporte für Abwärtskompatibilität mit Code der diese Symbole aus db.ts
// importiert. Die eigentlichen Implementierungen leben jetzt in der zyklenfreien
// immutableViolationRegistry.ts.
export type { ImmutableViolationEvent } from "./lib/immutableViolationRegistry";
export { setImmutableViolationHandler, hasImmutableViolationHandler } from "./lib/immutableViolationRegistry";

function notifyImmutableViolation(err: unknown, args: unknown[]): void {
  try {
    const e = err as { code?: string; message?: string } | null;
    if (e?.code !== "P0001" || !/unveränderlich/.test(String(e?.message ?? ""))) return;
    const first = args[0] as string | { text?: string } | undefined;
    const q = typeof first === "string" ? first : first?.text;
    fireImmutableViolation({
      message: String(e.message),
      queryText: typeof q === "string" ? q.slice(0, 500) : undefined,
    });
  } catch {
    // Der Melde-Pfad darf niemals den eigentlichen Fehlerfluss stören.
  }
}

function wrapClientForImmutableAudit(client: pg.PoolClient): pg.PoolClient {
  const c = client as pg.PoolClient & { __immoImmutableAuditWrapped?: boolean; query: any };
  if (c.__immoImmutableAuditWrapped) return client;
  c.__immoImmutableAuditWrapped = true;
  const origQuery = c.query.bind(client);
  c.query = (...args: any[]) => {
    // Callback-Stil (pg-pool intern: pool.query → client.query(text, values, cb)).
    const last = args[args.length - 1];
    if (typeof last === "function") {
      args[args.length - 1] = (err: unknown, res: unknown) => {
        if (err) notifyImmutableViolation(err, args);
        last(err, res);
      };
      return origQuery(...args);
    }
    // Promise-Stil (drizzle mit dediziertem Client).
    const result = origQuery(...args);
    if (result && typeof result.catch === "function") {
      // Seiten-Kanal: beobachtet die Ablehnung, verschluckt sie aber nicht —
      // der Aufrufer erhält weiterhin das originale (rejected) Promise.
      result.catch((err: unknown) => notifyImmutableViolation(err, args));
    }
    return result;
  };
  return client;
}

/**
 * Pool-Basisklasse: jede ausgecheckte Verbindung meldet Immutability-
 * Trigger-Verletzungen (P0001) an den registrierten Audit-Handler.
 */
class AuditedPool extends Pool {
  // pg-pool ruft connect() intern MIT Callback auf (pool.query → this.connect(cb));
  // beide Aufrufstile müssen unterstützt werden, sonst hängen pool.query-Aufrufe.
  connect(): Promise<pg.PoolClient>;
  connect(
    callback: (err?: Error, client?: pg.PoolClient, done?: (release?: unknown) => void) => void,
  ): void;
  connect(
    callback?: (err?: Error, client?: pg.PoolClient, done?: (release?: unknown) => void) => void,
  ): Promise<pg.PoolClient> | void {
    if (callback) {
      super.connect((err, client, done) => {
        if (!err && client) {
          try {
            wrapClientForImmutableAudit(client);
          } catch {
            // Wrapper-Fehler dürfen den Verbindungsaufbau nicht verhindern.
          }
        }
        callback(err as Error | undefined, client, done);
      });
      return;
    }
    return super.connect().then(wrapClientForImmutableAudit);
  }
}

export const pool = new AuditedPool({ connectionString: process.env.DATABASE_URL });

/**
 * App-Pool — verbindet als immo_app (NOSUPERUSER, kein BYPASSRLS).
 *
 * Jede ausgecheckte Verbindung erhält `SET ROLE immo_app` BEVOR sie
 * zurückgegeben wird (fail-closed). Schlägt die Rollenaktivierung fehl
 * (z.B. Rolle noch nicht angelegt), wird die Verbindung mit dem Fehler
 * freigegeben und der Aufrufer erhält eine Ablehnung — kein "log and continue".
 *
 * Verwendet von: rlsMiddleware, withOrgContext, Portal-Middleware.
 */

// Eigene Pool-Klasse, damit connect() auf der Klasse selbst überschrieben
// wird — nicht als Object.create-Proxy über eine Instanz. So greifen auch
// interne pg-pool-Aufrufe (pool.query → this.connect()) auf die richtige
// Implementierung zu.
class _AppPool extends AuditedPool {
  // Wie AuditedPool: beide Aufrufstile unterstützen (pg-pool ruft intern
  // connect(cb) auf — z.B. bei appPool.query). SET ROLE erfolgt in beiden
  // Pfaden BEVOR die Verbindung herausgegeben wird (fail-closed).
  connect(): Promise<pg.PoolClient>;
  connect(
    callback: (err?: Error, client?: pg.PoolClient, done?: (release?: unknown) => void) => void,
  ): void;
  connect(
    callback?: (err?: Error, client?: pg.PoolClient, done?: (release?: unknown) => void) => void,
  ): Promise<pg.PoolClient> | void {
    const activateRole = async (client: pg.PoolClient): Promise<pg.PoolClient> => {
      try {
        await client.query("SET ROLE immo_app");
        return client;
      } catch (err) {
        // Verbindung als fehlerhaft zurückgeben — pg-pool entfernt sie aus dem Pool.
        client.release(err as Error);
        throw new Error(
          `[appPool] SET ROLE immo_app fehlgeschlagen — Verbindung abgelehnt: ${(err as Error).message}`,
        );
      }
    };
    if (callback) {
      super.connect((err, client, done) => {
        if (err || !client) {
          callback(err as Error | undefined, client, done);
          return;
        }
        activateRole(client).then(
          (c) => callback(undefined, c, done),
          (roleErr) => callback(roleErr as Error), // Client wurde bereits mit Fehler released
        );
      });
      return;
    }
    return super.connect().then(activateRole);
  }
}

export const appPool = new _AppPool({ connectionString: process.env.DATABASE_URL });

/**
 * Superuser-Datenbankinstanz (postgres/BYPASSRLS).
 *
 * Nur für: Migrationen, RLS-Setup, Auth-Bootstrap (Login vor Org-Kontext),
 * Testfixtures (außerhalb von Org-Scoping). NICHT für Request-Handler.
 */
export const rootDb = drizzle(pool, { schema });

/**
 * App-Datenbankinstanz (immo_app-Rolle, kein Org-Kontext).
 *
 * Liegt der orgContext vor, verwende lieber den `db`-Proxy oder `activeDb()`.
 * Nützlich für Systemtabellen ohne org_id-Spalte (z.B. organizations,
 * job_queue) in Background-Jobs, die explizit keinen Org-Kontext benötigen.
 */
export const appDb = drizzle(appPool, { schema });

export type Db = typeof rootDb;

export interface OrgRequestContext {
  organizationId: string;
  db: Db;
  client: pg.PoolClient;
}

/**
 * Request-scoped Organisationskontext.
 *
 * rlsMiddleware checkt pro Anfrage eine Verbindung aus appPool aus, setzt
 * `app.current_org` (Row Level Security) und führt die gesamte Anfrage in
 * diesem Kontext aus. Der exportierte `db`-Proxy leitet dadurch automatisch
 * auf die RLS-gebundene Verbindung um.
 */
export const orgContext = new AsyncLocalStorage<OrgRequestContext>();

/** Aktive Organisation der laufenden Anfrage, sonst null. */
export function currentOrgId(): string | null {
  return orgContext.getStore()?.organizationId ?? null;
}

/**
 * Gibt die RLS-gebundene Drizzle-Instanz der laufenden Anfrage zurück.
 *
 * Wirft explizit, wenn kein orgContext gesetzt ist — es gibt keinen Fallback
 * auf den Superuser-Pool. Jede Anfrage, die `db` oder `activeDb()` nutzt,
 * muss zuvor durch `rlsMiddleware` oder `withOrgContext` gelaufen sein.
 *
 * Für Systemoperationen ohne Org-Kontext (Migrationen, Auth, Seeds):
 * `rootDb` explizit verwenden.
 */
export function activeDb(): Db {
  const store = orgContext.getStore();
  if (!store) {
    throw new Error(
      "[db] Kein Org-Kontext gesetzt. Verwende rootDb für Systemoperationen " +
        "oder stelle sicher, dass rlsMiddleware vor diesem Handler aktiv ist.",
    );
  }
  return store.db;
}

/**
 * Führt einen Block explizit ohne Organisationskontext aus (Systemaufgaben,
 * Login-Pfad, Cron). Damit bleibt sichtbar, wo RLS bewusst umgangen wird.
 */
export function withoutOrgContext<T>(fn: () => T): T {
  return orgContext.exit(fn);
}

/**
 * Führt fn in einem explizit gesetzten Org-Kontext aus — identisch zu dem,
 * was rlsMiddleware pro Request tut, aber für Hintergrundjobs und Portal-Routen.
 * Innerhalb von fn greift der globale `db`-Proxy automatisch auf die
 * RLS-gebundene Verbindung (app.current_org = organizationId).
 */
export async function withOrgContext<T>(
  organizationId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_org', $1, true)", [organizationId]);
    const orgDb = drizzle(client as any, { schema });
    const result = await orgContext.run({ organizationId, db: orgDb, client }, fn);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * `db` verhält sich wie die gewohnte Drizzle-Instanz, zeigt aber innerhalb
 * einer Anfrage immer auf die RLS-gebundene Verbindung mit gesetztem
 * `app.current_org`. Außerhalb eines orgContext wirft jeder Zugriff einen
 * Fehler — kein stiller Fallback auf Superuser-Zugriff möglich.
 */
export const db: Db = new Proxy(rootDb as any, {
  get(_target, prop) {
    const active: any = activeDb(); // wirft wenn kein orgContext
    const value = Reflect.get(active, prop, active);
    return typeof value === "function" ? value.bind(active) : value;
  },
  has(_target, prop) {
    return Reflect.has(activeDb() as any, prop); // wirft wenn kein orgContext
  },
}) as Db;

// ── Garantierte Handler-Registrierung ────────────────────────────────────────
//
// Dieser Import MUSS am Ende der Datei stehen — nach allen export-Anweisungen.
//
// Warum am Ende (CJS-Zirkularität):
//   immutableViolationAudit.ts importiert seinerseits aus dieser Datei
//   (setImmutableViolationHandler, currentOrgId). In CommonJS gibt Node.js
//   beim Zirkular-Import das bereits vorhandene exports-Objekt zurück.
//   Da alle export const … hier oben abgearbeitet sind, bevor diese Zeile
//   ausgeführt wird, sieht immutableViolationAudit.ts ein vollständig
//   befülltes exports-Objekt — kein undefined, kein Initialisierungsfehler.
//
// Warum hier und nicht nur in server/index.ts:
//   Skripte (server/scripts/*), CLI-Tools und Testhelper importieren direkt
//   aus server/db.ts, ohne den HTTP-Server zu starten. Der Handler muss in
//   ALLEN Prozessen registriert sein, die die DB-Pools verwenden — sonst
//   werden Trigger-Verletzungen in Hintergrundjobs lautlos verschluckt.
//
// server/index.ts enthält einen eigenen import für denselben Pfad; da Node.js
// Module cached, ist der zweite require ein No-Op — keine Doppel-Registrierung.
import "./lib/immutableViolationAudit";
