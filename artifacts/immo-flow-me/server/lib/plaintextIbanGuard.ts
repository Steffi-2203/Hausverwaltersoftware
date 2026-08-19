import { sql, type SQL } from "drizzle-orm";

/**
 * Klartext-Muster des At-Rest-Wächters.
 *
 * Die Werte werden nur in der Datenbank per Regex geprüft. Der Scan selektiert
 * niemals den eigentlichen Feldwert, damit auch Diagnose-/Admin-Antworten
 * keine IBAN oder BIC enthalten können.
 */
export const IBAN_SQL_REGEX = "^[A-Z]{2}[0-9]{2}[A-Z0-9 ]{11,34}$";
export const BIC_SQL_REGEX = "^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$";

export const EXPECTED_IBAN_TABLES = [
  "bank_accounts",
  "tenants",
  "owners",
  "organizations",
  "contractors",
  "ebics_connections",
  "transactions",
  "kautionen",
] as const;

export type ColumnRef = { table: string; column: string };
export type PlaintextViolation = {
  table: string;
  column: string;
  kind: "iban" | "bic";
  count: number;
  ids: string[];
};

export type PlaintextIbanScanResult = {
  ibanColumns: ColumnRef[];
  bicColumns: ColumnRef[];
  violations: PlaintextViolation[];
  totalViolations: number;
};

type QueryResult = { rows?: unknown[] };
export type SqlExecutor = {
  execute(query: SQL): Promise<QueryResult>;
};

function rowsOf(result: QueryResult): Record<string, unknown>[] {
  return Array.isArray(result.rows) ? (result.rows as Record<string, unknown>[]) : [];
}

/**
 * Entdeckt alle textartigen IBAN-/BIC-Spalten in public-Basistabellen.
 *
 * Dynamische Discovery sorgt dafür, dass neue verschlüsselbare Spalten ohne
 * zusätzliche Pflege in den Scan aufgenommen werden.
 */
export async function discoverPlaintextIbanColumns(db: SqlExecutor): Promise<{
  ibanColumns: ColumnRef[];
  bicColumns: ColumnRef[];
}> {
  const result = await db.execute(sql`
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.data_type IN ('text', 'character varying')
      AND (c.column_name ILIKE '%iban%' OR c.column_name = 'bic')
    ORDER BY c.table_name, c.column_name
  `);

  const rows = rowsOf(result) as Array<{ table_name?: unknown; column_name?: unknown }>;
  const columns = rows
    .filter((row) => typeof row.table_name === "string" && typeof row.column_name === "string")
    .map((row) => ({ table: row.table_name as string, column: row.column_name as string }));

  return {
    ibanColumns: columns.filter((column) => column.column.toLowerCase().includes("iban")),
    bicColumns: columns.filter((column) => column.column === "bic"),
  };
}

async function scanColumn(
  db: SqlExecutor,
  { table, column }: ColumnRef,
  kind: PlaintextViolation["kind"],
  regex: string,
): Promise<PlaintextViolation | null> {
  const result = await db.execute(sql`
    SELECT id::text AS id, count(*) OVER()::int AS total
    FROM ${sql.identifier(table)}
    WHERE ${sql.identifier(column)} IS NOT NULL
      AND ${sql.identifier(column)} <> ''
      AND ${sql.identifier(column)} NOT LIKE 'enc:v1:%'
      AND upper(replace(${sql.identifier(column)}, ' ', '')) ~ ${regex}
    LIMIT 20
  `);

  const rows = rowsOf(result) as Array<{ id?: unknown; total?: unknown }>;
  if (rows.length === 0) return null;

  const count = Number(rows[0].total);
  return {
    table,
    column,
    kind,
    count: Number.isFinite(count) && count >= rows.length ? count : rows.length,
    ids: rows
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string"),
  };
}

/**
 * Führt den vollständigen Klartext-Scan aus.
 *
 * Diese Funktion enthält ausschließlich SELECT-Abfragen. Die dynamischen
 * Tabellen-/Spaltennamen kommen nur aus information_schema bzw. werden von
 * drizzle-orm als SQL-Identifier escaped.
 */
export async function scanPlaintextIbanBic(db: SqlExecutor): Promise<PlaintextIbanScanResult> {
  const { ibanColumns, bicColumns } = await discoverPlaintextIbanColumns(db);
  const violations: PlaintextViolation[] = [];

  for (const column of ibanColumns) {
    const violation = await scanColumn(db, column, "iban", IBAN_SQL_REGEX);
    if (violation) violations.push(violation);
  }
  for (const column of bicColumns) {
    const violation = await scanColumn(db, column, "bic", BIC_SQL_REGEX);
    if (violation) violations.push(violation);
  }

  return {
    ibanColumns,
    bicColumns,
    violations,
    totalViolations: violations.reduce((total, violation) => total + violation.count, 0),
  };
}