/**
 * WEG-Vorschreibung — E-Mail-Versand-Service
 *
 * Kapselt die komplette Versand-Logik für monatliche Vorschreibungen eines
 * Wirtschaftsplans. Analog zu wegSettlementEmailService.
 *
 * Pro Eigentümer werden alle Vorschreibungen des Plans gesammelt und in einer
 * E-Mail versendet. Jeder Versandversuch wird in weg_vorschreibung_emails geloggt.
 */
import { rootDb as db } from "../db";
import { eq, and, inArray } from "drizzle-orm";
import * as schema from "@shared/schema";

export type SendEmailFn = (opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}) => Promise<any>;

export interface WegVorschreibungSendResult {
  emailsSent: number;
  emailsFailed: number;
  noEmailCount: number;
  sentTo: string[];
  failedRecipients: string[];
}

const monthNames = [
  "Jänner", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function fmt(val: number | string | null | undefined): string {
  const n = Number(val ?? 0);
  return n.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function buildHtml(
  ownerName: string,
  propName: string,
  year: number,
  invoices: { month: number; gesamtbetrag: string | null; faelligAm: string | null }[],
): string {
  const rows = invoices
    .sort((a, b) => a.month - b.month)
    .map(
      inv => `
      <tr>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb">${monthNames[inv.month - 1]} ${year}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${fmt(inv.gesamtbetrag)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb">${inv.faelligAm ?? "—"}</td>
      </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"/></head>
<body style="font-family:sans-serif;color:#111;max-width:640px;margin:auto;padding:24px">
  <h2 style="font-size:1.2rem;margin-bottom:4px">WEG-Vorschreibungen ${year}</h2>
  <p style="color:#6b7280;margin:0 0 16px">${propName}</p>
  <p>Sehr geehrte/r ${ownerName},</p>
  <p>hiermit erhalten Sie Ihre monatlichen Vorschreibungen für das Wirtschaftsjahr <strong>${year}</strong>.</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0">
    <thead>
      <tr style="background:#f3f4f6">
        <th style="padding:8px 12px;text-align:left">Monat</th>
        <th style="padding:8px 12px;text-align:right">Gesamtbetrag</th>
        <th style="padding:8px 12px;text-align:left">Fällig am</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="color:#6b7280;font-size:0.85rem">Mit freundlichen Grüßen<br/>Ihre Hausverwaltung</p>
</body>
</html>`;
}

/**
 * Versendet alle Vorschreibungen eines Wirtschaftsplans per E-Mail an die
 * jeweiligen Eigentümer. Jeder Versandversuch wird in weg_vorschreibung_emails geloggt.
 *
 * @param planId      UUID des Wirtschaftsplans
 * @param orgId       Organisation (Org-Isolation)
 * @param sendEmailFn E-Mail-Funktion (default: Resend-Wrapper aus lib/resend)
 */
export async function sendWegVorschreibungEmails(
  planId: string,
  orgId: string,
  sendEmailFn?: SendEmailFn,
): Promise<WegVorschreibungSendResult> {
  // ── Standardmäßig echten Resend-Wrapper verwenden ──────────────────────────
  if (!sendEmailFn) {
    const { sendEmail } = await import("../lib/resend");
    sendEmailFn = sendEmail;
  }

  // ── Wirtschaftsplan laden (Org-Grenze) ─────────────────────────────────────
  const [plan] = await db
    .select()
    .from(schema.wegBudgetPlans)
    .where(
      and(
        eq(schema.wegBudgetPlans.id, planId),
        eq(schema.wegBudgetPlans.organizationId, orgId),
      ),
    )
    .limit(1);

  if (!plan) throw Object.assign(new Error("Wirtschaftsplan nicht gefunden"), { status: 404 });

  // ── Alle Vorschreibungen des Plans (monthly_invoices) ──────────────────────
  const invoices = await db
    .select()
    .from(schema.monthlyInvoices)
    .where(eq(schema.monthlyInvoices.wegBudgetPlanId, planId));

  if (invoices.length === 0) {
    throw Object.assign(new Error("Keine Vorschreibungen für diesen Plan"), { status: 400 });
  }

  // ── Liegenschaft für Betreffzeile ──────────────────────────────────────────
  const [property] = await db
    .select()
    .from(schema.properties)
    .where(eq(schema.properties.id, plan.propertyId))
    .limit(1);
  const propName = property?.name ?? "Liegenschaft";
  const year = plan.year;

  // ── Eigentümer gruppieren ──────────────────────────────────────────────────
  const ownerIds = [...new Set(invoices.filter(i => i.ownerId).map(i => i.ownerId!))];
  if (ownerIds.length === 0) {
    throw Object.assign(new Error("Keine Eigentümer in diesem Plan"), { status: 400 });
  }

  const owners = await db
    .select()
    .from(schema.owners)
    .where(inArray(schema.owners.id, ownerIds));

  const ownersWithEmail = owners.filter(o => o.email && o.email.trim());
  const noEmailCount = owners.length - ownersWithEmail.length;

  if (ownersWithEmail.length === 0) {
    throw Object.assign(
      new Error(
        "Kein Eigentümer hat eine E-Mail-Adresse hinterlegt. " +
          "Bitte ergänzen Sie die E-Mail-Adressen in den Eigentümerstammdaten.",
      ),
      { status: 400, noEmailCount: owners.length },
    );
  }

  const sentTo: string[] = [];
  const failedRecipients: string[] = [];

  // ── Pro Eigentümer: alle seine Vorschreibungen bündeln und versenden ───────
  for (const owner of ownersWithEmail) {
    const ownerInvoices = invoices.filter(i => i.ownerId === owner.id);
    const ownerName = `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim();
    const emailAddr = owner.email as string;

    let sendStatus: "sent" | "failed" = "sent";
    let errorMessage: string | undefined;

    try {
      const html = buildHtml(ownerName, propName, year, ownerInvoices);
      await sendEmailFn({
        to: emailAddr,
        subject: `WEG-Vorschreibungen ${year} — ${propName}`,
        html,
        text:
          `Sehr geehrte/r ${ownerName},\n\n` +
          `hiermit erhalten Sie Ihre monatlichen Vorschreibungen für das Wirtschaftsjahr ${year} (${propName}).\n\n` +
          `Mit freundlichen Grüßen\nIhre Hausverwaltung`,
      });
      sentTo.push(emailAddr);
    } catch (err: any) {
      console.error(`[WEG Vorschreibung Send] Fehler bei ${emailAddr}:`, err.message);
      failedRecipients.push(emailAddr);
      sendStatus = "failed";
      errorMessage = err.message ?? "Unbekannter Fehler";
    }

    // ── Versand-Log-Eintrag pro Vorschreibung (analog Settlement) ─────────
    for (const inv of ownerInvoices) {
      try {
        await db.insert(schema.wegVorschreibungEmails).values({
          vorschreibungId: inv.id,
          ownerId: owner.id,
          email: emailAddr,
          status: sendStatus,
          errorMessage: errorMessage ?? null,
        });
      } catch (logErr: any) {
        // Logging-Fehler dürfen den Versandprozess nicht abbrechen
        console.error(`[WEG Vorschreibung Send] Log-Fehler für ${emailAddr}:`, logErr.message);
      }
    }
  }

  return {
    emailsSent: sentTo.length,
    emailsFailed: failedRecipients.length,
    noEmailCount,
    sentTo,
    failedRecipients,
  };
}
