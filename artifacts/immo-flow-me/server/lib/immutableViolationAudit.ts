/**
 * Immutability-Trigger-Verletzungen im Audit-Log nachverfolgen (Task #89)
 * und den Admin per E-Mail benachrichtigen (Task #179).
 *
 * Die Ledger-Trigger (kautions_bewegungen, invoice_lines, payment_allocations,
 * weg_settlement_details, journal_entry_lines, payments, monthly_invoices)
 * werfen bei einer Verletzung eine PostgreSQL-Exception (P0001). Diese rollt
 * die Transaktion zurück — deshalb KANN der Trigger selbst keinen dauerhaften
 * audit_logs-Eintrag schreiben (er würde mit zurückgerollt).
 *
 * Stattdessen meldet der Pool-Wrapper in server/db.ts jede P0001-Verletzung
 * mit "unveränderlich" in der Meldung an diesen Handler, der:
 *   1. Den Audit-Eintrag auf einer SEPARATEN Verbindung schreibt.
 *   2. (Gedrosselt, max. 1×/Std. pro Tabelle) dem Admin eine E-Mail schickt.
 *
 * Schlägt der Audit-Write oder die E-Mail fehl, wird das laut auf stderr
 * protokolliert — niemals lautlos verschluckt.
 */

// setImmutableViolationHandler und ImmutableViolationEvent kommen aus der
// zyklenfreien Registry — NICHT aus ../db — damit der ESM-TDZ-Fehler
// beim Initialisierungsaufruf vermieden wird.
import { setImmutableViolationHandler, type ImmutableViolationEvent } from "./immutableViolationRegistry";
import { currentOrgId } from "../db";
import { createAuditLogStrict } from "./auditLog";

// ── Throttle-Schutz für Admin-E-Mails ────────────────────────────────────────
// Pro Tabelle wird max. 1 Benachrichtigungsmail pro Stunde gesendet.
// Das verhindert Mail-Floods bei systematischen Angriffen oder Bugs.

export const VIOLATION_THROTTLE_MS = 60 * 60 * 1000; // 1 Stunde

// In-Memory-Map: tableName → Zeitstempel der letzten Benachrichtigung
const lastNotifiedAt = new Map<string, number>();

/**
 * Prüft ob eine Benachrichtigung für `tableName` gesendet werden darf.
 * Aktualisiert den Zeitstempel wenn true zurückgegeben wird.
 *
 * Testbar über den optionalen `nowMs`-Parameter (injizierbare Uhr).
 */
export function shouldNotify(tableName: string, nowMs = Date.now()): boolean {
  const last = lastNotifiedAt.get(tableName);
  if (last === undefined || nowMs - last >= VIOLATION_THROTTLE_MS) {
    lastNotifiedAt.set(tableName, nowMs);
    return true;
  }
  return false;
}

// ── E-Mail-Benachrichtigung ───────────────────────────────────────────────────

async function sendViolationAlert(
  tableName: string,
  e: ImmutableViolationEvent,
  orgId: string | undefined,
): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return; // kein Empfänger konfiguriert

  // Dynamischer Import — vermeidet Modul-Ladereihenfolge-Probleme beim Boot
  // und hält den Kaltstart von db.ts schnell.
  const { sendEmail } = await import("./resend");

  const now = new Date().toLocaleString("de-AT", { timeZone: "Europe/Vienna" });
  const querySnippet = e.queryText
    ? e.queryText.slice(0, 300)
    : "(nicht verfügbar)";

  const html = `
<h2 style="color:#b91c1c">⚠️ Manipulationsversuch erkannt</h2>
<table style="border-collapse:collapse;font-family:monospace;font-size:14px">
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Zeitpunkt</td><td>${now}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Tabelle</td><td>${tableName}</td></tr>
  ${orgId ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Organisation</td><td>${orgId}</td></tr>` : ""}
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Fehlermeldung</td><td>${e.message}</td></tr>
</table>
<h3>SQL-Ausschnitt (Parameter entfernt)</h3>
<pre style="background:#f3f4f6;padding:12px;border-radius:4px;overflow-x:auto">${querySnippet}</pre>
<hr>
<p style="color:#6b7280;font-size:12px">
  Automatisch gesendet von ImmoFlowMe · Max. 1 Mail pro Tabelle pro Stunde ·
  Details: Sicherheits-Dashboard → Manipulationsversuche
</p>`;

  const text =
    `MANIPULATIONSVERSUCH ERKANNT\n\n` +
    `Zeitpunkt:    ${now}\n` +
    `Tabelle:      ${tableName}\n` +
    (orgId ? `Organisation: ${orgId}\n` : "") +
    `Meldung:      ${e.message}\n\n` +
    `SQL-Ausschnitt:\n${querySnippet}\n`;

  await sendEmail({
    to: adminEmail,
    subject: `⚠️ Manipulationsversuch erkannt: ${tableName}`,
    html,
    text,
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────

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
  const tableName = parseViolatedTable(e.message);

  // Throttle-Check synchron, damit gleichzeitige Verletzungen derselben
  // Tabelle nicht mehrere Mails auslösen.
  const notify = shouldNotify(tableName);

  const p = createAuditLogStrict({
    tableName,
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
          `konnte nicht geschrieben werden (${tableName}):`,
        err,
      );
    })
    .finally(() => pending.delete(p));
  pending.add(p);

  // E-Mail fire-and-forget — kein Eintrag in `pending`, damit Tests nicht
  // auf Netzwerkcalls warten müssen.
  if (notify) {
    sendViolationAlert(tableName, e, orgId).catch((err) => {
      console.error(
        "[immutable-violation-audit] Benachrichtigungs-E-Mail konnte nicht " +
          `gesendet werden (${tableName}):`,
        err,
      );
    });
  }
}

setImmutableViolationHandler(handleViolation);

/** Wartet auf alle noch laufenden Verletzungs-Audit-Writes (für Tests/Shutdown). */
export async function flushImmutableViolationAudits(): Promise<void> {
  while (pending.size > 0) {
    await Promise.all([...pending]);
  }
}
