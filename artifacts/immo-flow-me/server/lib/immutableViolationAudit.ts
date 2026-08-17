/**
 * Immutability-Trigger-Verletzungen im Audit-Log nachverfolgen (Task #89).
 *
 * Die Ledger-Trigger (kautions_bewegungen, invoice_lines, payment_allocations,
 * weg_settlement_details, journal_entry_lines, payments, monthly_invoices)
 * werfen bei einer Verletzung eine PostgreSQL-Exception (P0001). Diese rollt
 * die Transaktion zurück — deshalb KANN der Trigger selbst keinen dauerhaften
 * audit_logs-Eintrag schreiben (er würde mit zurückgerollt).
 *
 * Stattdessen meldet der Pool-Wrapper in server/db.ts jede P0001-Verletzung
 * mit "unveränderlich" in der Meldung an diesen Handler, der den Audit-Eintrag
 * auf einer SEPARATEN Verbindung (rootDb, eigene Transaktion) schreibt —
 * unabhängig vom Rollback der blockierten Anfrage.
 *
 * Der Eintrag: action = 'IMMUTABLE_VIOLATION', table_name aus der
 * Trigger-Meldung, details mit Fehlermeldung + (gekürztem) SQL-Text.
 * Schlägt der Audit-Write fehl, wird das laut auf stderr protokolliert —
 * niemals lautlos verschluckt.
 */

import { setImmutableViolationHandler, currentOrgId, type ImmutableViolationEvent } from "../db";
import { createAuditLogStrict } from "./auditLog";

/**
 * Tabellenname aus der Trigger-Meldung extrahieren.
 * Formate:
 *   "invoice_lines-Einträge sind unveränderlich — …"
 *   "payments: betrag und buchungs_datum sind … unveränderlich …"
 */
export function parseViolatedTable(message: string): string {
  const m = message.match(/^([a-z_]+)(?:-Einträge)?\s*:?\s/);
  return m?.[1] ?? "unbekannt";
}

// Laufende Audit-Writes — Tests können mit flushImmutableViolationAudits()
// deterministisch darauf warten.
const pending = new Set<Promise<void>>();

function handleViolation(e: ImmutableViolationEvent): void {
  const orgId = currentOrgId();
  const p = createAuditLogStrict({
    tableName: parseViolatedTable(e.message),
    recordId: "unknown", // Trigger-Meldung enthält keine Row-ID; SQL-Text steht in details
    action: "IMMUTABLE_VIOLATION",
    details: {
      errorMessage: e.message,
      // Gekürzter SQL-Text der blockierten Query (Parameter-Werte sind NICHT
      // enthalten — bewusst, um keine sensiblen Daten ins Audit-Log zu ziehen).
      query: e.queryText ?? null,
      organizationId: orgId,
      source: "pg-trigger P0001 (Pool-Interceptor)",
    },
  })
    .catch((err) => {
      // Laut scheitern — der ursprüngliche Request ist bereits blockiert,
      // aber ein fehlender Audit-Eintrag darf nicht unbemerkt bleiben.
      console.error(
        "[immutable-violation-audit] FEHLER: Audit-Eintrag für Trigger-Verletzung " +
          `konnte nicht geschrieben werden (${parseViolatedTable(e.message)}):`,
        err,
      );
    })
    .finally(() => pending.delete(p));
  pending.add(p);
}

setImmutableViolationHandler(handleViolation);

/** Wartet auf alle noch laufenden Verletzungs-Audit-Writes (für Tests/Shutdown). */
export async function flushImmutableViolationAudits(): Promise<void> {
  while (pending.size > 0) {
    await Promise.all([...pending]);
  }
}
