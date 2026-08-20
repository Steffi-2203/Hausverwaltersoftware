import { pool } from "../db";
import { logger } from "./logger";
import fs from "fs";
import path from "path";

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS _sql_migrations (
    id          SERIAL PRIMARY KEY,
    filename    TEXT NOT NULL UNIQUE,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

async function ensureMigrationsTable(client: any): Promise<void> {
  await client.query(MIGRATIONS_TABLE);
}

async function isApplied(client: any, filename: string): Promise<boolean> {
  const result = await client.query(
    "SELECT 1 FROM _sql_migrations WHERE filename = $1",
    [filename]
  );
  return result.rowCount > 0;
}

async function markApplied(client: any, filename: string): Promise<void> {
  await client.query(
    "INSERT INTO _sql_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
    [filename]
  );
}

/**
 * PostgreSQL error codes that indicate "already exists" —
 * safe to ignore in idempotent migrations that lack full IF NOT EXISTS guards.
 */
const IGNORABLE_PG_CODES = new Set([
  "42701", // duplicate_column
  "42P07", // duplicate_table
  "42710", // duplicate_object
  "42P16", // invalid_table_definition (RLS already enabled)
]);

function isTransactionBegin(stmt: string): boolean {
  return /^(?:BEGIN(?:\s+(?:WORK|TRANSACTION))?|START\s+TRANSACTION)\b/i.test(
    stmt.trim()
  );
}

function isTransactionEnd(stmt: string): boolean {
  return /^(?:COMMIT|ROLLBACK)(?:\s+(?:WORK|TRANSACTION))?\b/i.test(
    stmt.trim()
  );
}

/**
 * Older migration files may already own their BEGIN/COMMIT boundaries. Newer
 * files are wrapped by the runner so a failed statement cannot leave a partial
 * schema change behind. Never nest those two transaction ownership models.
 */
export function hasExplicitTransactionControl(statements: string[]): boolean {
  return statements.some(
    (stmt) => isTransactionBegin(stmt) || isTransactionEnd(stmt)
  );
}

/**
 * Splits a SQL file into individual statements using a lexical state machine.
 *
 * Korrekt behandelt werden:
 * - '...' Literale inkl. '' Escapes (ein ';' darin splittet NICHT — das hat
 *   in Produktion die Migration 20260815 mit einem deutschen COMMENT gecrasht)
 * - E'...' Escape-Strings inkl. \' und \\ Escapes
 * - "..." quoted Identifier
 * - Dollar-Quotes mit beliebigem Tag: $$...$$, $func$...$func$
 * - -- Zeilenkommentare und Blockkommentare (auch verschachtelt) werden nur
 *   im Code-Zustand entfernt, nie innerhalb von Literalen
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  const n = sql.length;

  const push = () => {
    const stmt = current.trim();
    if (stmt.length > 0) statements.push(stmt);
    current = "";
  };

  while (i < n) {
    const ch = sql[i];
    const next = i + 1 < n ? sql[i + 1] : "";

    // -- Zeilenkommentar (nur im Code-Zustand): bis Zeilenende verwerfen
    if (ch === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }

    // /* Blockkommentar */ — Postgres erlaubt Verschachtelung
    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; }
        else if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; }
        else i++;
      }
      continue;
    }

    // E'...' Escape-String: \' und \\ sind Escapes, '' ebenfalls
    if ((ch === "E" || ch === "e") && next === "'" && !/[A-Za-z0-9_$]/.test(i > 0 ? sql[i - 1] : "")) {
      current += ch + next;
      i += 2;
      while (i < n) {
        if (sql[i] === "\\" && i + 1 < n) { current += sql[i] + sql[i + 1]; i += 2; continue; }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { current += "''"; i += 2; continue; }
          current += "'"; i++; break;
        }
        current += sql[i]; i++;
      }
      continue;
    }

    // '...' Standard-Literal: '' ist ein escaptes Quote
    if (ch === "'") {
      current += ch;
      i++;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { current += "''"; i += 2; continue; }
          current += "'"; i++; break;
        }
        current += sql[i]; i++;
      }
      continue;
    }

    // "..." quoted Identifier: "" ist ein escaptes Quote
    if (ch === '"') {
      current += ch;
      i++;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') { current += '""'; i += 2; continue; }
          current += '"'; i++; break;
        }
        current += sql[i]; i++;
      }
      continue;
    }

    // Dollar-Quote mit beliebigem Tag: $tag$ ... $tag$
    if (ch === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const delim = m[0];
        const end = sql.indexOf(delim, i + delim.length);
        if (end === -1) {
          // Unterminierter Dollar-Quote: Rest als Inhalt übernehmen
          current += sql.slice(i);
          i = n;
          continue;
        }
        current += sql.slice(i, end + delim.length);
        i = end + delim.length;
        continue;
      }
    }

    if (ch === ";") {
      push();
      i++;
      continue;
    }

    current += ch;
    i++;
  }
  push();

  return statements;
}

/**
 * Globaler Advisory-Lock: Bei Autoscale-Deployments können mehrere Instanzen
 * gleichzeitig booten. Ohne Lock rennen zwei Migrationsläufe gegeneinander
 * (z. B. CREATE TABLE-Races oder halb angewendete Dateien). Die zweite
 * Instanz wartet hier, bis die erste fertig ist, und sieht dann alle
 * Migrationen als bereits angewendet.
 */
const MIGRATION_LOCK_KEY = 727100153; // beliebige, projektweit feste Konstante

export async function runSqlMigrations(): Promise<void> {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    locked = true;

    await ensureMigrationsTable(client);

    const migrationsDir = path.join(process.cwd(), "migrations");
    if (!fs.existsSync(migrationsDir)) {
      if (process.env.NODE_ENV === "production") {
        // In Produktion wäre ein stiller Skip fatal: Die App würde mit
        // veraltetem Schema starten und erst bei Anfragen crashen.
        throw new Error(
          `[migrations] migrations/ directory not found at ${migrationsDir} — ` +
          "production boot aborted (schema state unknown)."
        );
      }
      logger.warn("[migrations] migrations/ directory not found, skipping");
      return;
    }

    // Match YYYYMMDD_ and YYYYMMDD[a-z]_ prefixes (e.g. 20260508e_...).
    // The original Drizzle migration (0000_...) was already applied and is excluded.
    const SQL_DATE_PREFIX = /^\d{8}[a-z]?_/;
    const sqlFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql") && SQL_DATE_PREFIX.test(f))
      .sort();

    let appliedCount = 0;

    for (const filename of sqlFiles) {
      const already = await isApplied(client, filename);
      if (already) continue;

      const filepath = path.join(migrationsDir, filename);
      const sqlContent = fs.readFileSync(filepath, "utf8");
      const statements = splitStatements(sqlContent).filter(
        (s) => s.trim().length > 0
      );
      const runnerOwnsTransaction = !hasExplicitTransactionControl(statements);
      let migrationTransactionOpen = false;

      try {
        if (runnerOwnsTransaction) {
          await client.query("BEGIN");
          migrationTransactionOpen = true;
        }

        for (const stmt of statements) {
          if (!runnerOwnsTransaction && isTransactionBegin(stmt)) {
            await client.query(stmt);
            migrationTransactionOpen = true;
            continue;
          }

          if (!runnerOwnsTransaction && isTransactionEnd(stmt)) {
            await client.query(stmt);
            migrationTransactionOpen = false;
            continue;
          }

          if (migrationTransactionOpen) {
            await client.query("SAVEPOINT sql_migration_statement");
          }

          try {
            await client.query(stmt);
            if (migrationTransactionOpen) {
              await client.query("RELEASE SAVEPOINT sql_migration_statement");
            }
          } catch (err: any) {
            const code: string = err.code ?? "";
            if (IGNORABLE_PG_CODES.has(code)) {
              if (migrationTransactionOpen) {
                await client.query("ROLLBACK TO SAVEPOINT sql_migration_statement");
                await client.query("RELEASE SAVEPOINT sql_migration_statement");
              }
              // "Already exists" — harmless in an idempotent migration.
              logger.info(
                `[migrations] ${filename}: ignorable pg error ${code} — ${err.message.split("\n")[0]}`
              );
              continue;
            }

            if (migrationTransactionOpen) {
              await client.query("ROLLBACK TO SAVEPOINT sql_migration_statement");
              await client.query("RELEASE SAVEPOINT sql_migration_statement");
            }
            logger.error(
              `[migrations] FATAL: Statement failed in ${filename} (pg ${code}): ${err.message}\nSQL: ${stmt.slice(0, 300)}`
            );
            throw err;
          }
        }

        await markApplied(client, filename);
        if (runnerOwnsTransaction) {
          await client.query("COMMIT");
          migrationTransactionOpen = false;
        }
        logger.info(`[migrations] Applied: ${filename}`);
        appliedCount++;
      } catch (err: any) {
        if (migrationTransactionOpen) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // A failed BEGIN cannot leave a transaction to roll back.
          }
        }
        throw new Error(
          `Migration ${filename} failed and was rolled back: ` +
          `[${err?.code ?? "unknown"}] ${err?.message?.split("\n")[0] ?? String(err)}`
        );
      }
    }

    if (appliedCount === 0) {
      logger.info("[migrations] All SQL migrations are up to date.");
    } else {
      logger.info(`[migrations] Applied ${appliedCount} migration(s).`);
    }

    await verifyCriticalIndexes(client);
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
      } catch {
        // Verbindung wird gleich freigegeben; Lock fällt spätestens mit ihr.
      }
    }
    client.release();
  }
}

async function verifyCriticalIndexes(client: any): Promise<void> {
  const required = [
    { name: "idx_properties_organization_id", table: "properties" },
    { name: "idx_audit_logs_created_at",      table: "audit_logs" },
  ];

  let ok = 0;
  for (const { name, table } of required) {
    const res = await client.query(
      `SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=$1 AND tablename=$2`,
      [name, table]
    );
    if (res.rowCount > 0) ok++;
  }
  logger.info(`[migrations] Critical index check OK (${ok} index(es) verified).`);
}

/**
 * Fast pre-boot check: returns true if the core RLS org-isolation policies
 * already exist in the database (i.e. setupRLS() has run before).
 * Used in server/index.ts to decide whether to run setupRLS() before or
 * after server.listen().
 */
/**
 * Audit-Befund K1: Früher genügte eine einzige vorhandene Policy, damit das
 * RLS-Setup übersprungen wurde — neu hinzugekommene Tabellen blieben dadurch
 * dauerhaft ungeschützt. Jetzt wird gegen die tatsächliche Anzahl der
 * Tabellen mit organization_id verglichen.
 */
export async function isRlsAlreadyConfigured(): Promise<boolean> {
  const client = await pool.connect();
  try {
    const policies = await client.query(
      `SELECT COUNT(*) AS cnt FROM pg_policies
       WHERE schemaname = 'public' AND policyname LIKE 'org_isolation_%'`
    );
    const tables = await client.query(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public'
         AND c.column_name = 'organization_id'
         AND t.table_type = 'BASE TABLE'`
    );
    const policyCount = parseInt(policies.rows[0].cnt, 10);
    const tableCount = parseInt(tables.rows[0].cnt, 10);
    return policyCount > 0 && policyCount >= tableCount;
  } finally {
    client.release();
  }
}

