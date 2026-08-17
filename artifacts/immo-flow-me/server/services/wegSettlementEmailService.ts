/**
 * WEG-Jahresabrechnung — E-Mail-Versand-Service
 *
 * Kapselt die komplette Versand-Logik (DB-Lesen, HTML-Rendern, E-Mail senden,
 * Status aktualisieren). Die sendEmailFn kann in Tests durch eine Stub-Funktion
 * ersetzt werden — kein Modul-Mocking nötig.
 */
import { rootDb as db } from "../db"; // service functions called directly from tests
import { eq, and, inArray } from "drizzle-orm";
import * as schema from "@shared/schema";
import { sql } from "drizzle-orm";

export type SendEmailFn = (opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}) => Promise<any>;

export interface WegSettlementSendResult {
  emailsSent: number;
  emailsFailed: number;
  noEmailCount: number;
  sentTo: string[];
  failedRecipients: string[];
}

/**
 * Versendet die WEG-Jahresabrechnung per E-Mail an alle Eigentümer mit
 * hinterlegter E-Mail-Adresse.
 *
 * @param settlementId  UUID der Abrechnung
 * @param orgId         Organisation (Org-Isolation)
 * @param sendEmailFn   E-Mail-Funktion (default: Resend-Wrapper aus lib/resend)
 */
export async function sendWegSettlementEmails(
  settlementId: string,
  orgId: string,
  sendEmailFn?: SendEmailFn
): Promise<WegSettlementSendResult> {
  // ── Standardmäßig echten Resend-Wrapper verwenden ─────────────────────────
  if (!sendEmailFn) {
    const { sendEmail } = await import("../lib/resend");
    sendEmailFn = sendEmail;
  }

  // ── Abrechnung laden ──────────────────────────────────────────────────────
  const [settlement] = await db
    .select()
    .from(schema.wegSettlements)
    .where(
      and(
        eq(schema.wegSettlements.id, settlementId),
        eq(schema.wegSettlements.organizationId, orgId)
      )
    )
    .limit(1);

  if (!settlement) throw Object.assign(new Error("Abrechnung nicht gefunden"), { status: 404 });

  // ── Eigentümer-IDs aus Abrechnungs-Details ────────────────────────────────
  const details = await db
    .select()
    .from(schema.wegSettlementDetails)
    .where(eq(schema.wegSettlementDetails.settlementId, settlementId));

  const ownerIds = [...new Set(details.map(d => d.ownerId))];
  if (ownerIds.length === 0) {
    throw Object.assign(new Error("Keine Eigentümer in dieser Abrechnung"), { status: 400 });
  }

  // ── Liegenschaft für Betreffzeile ─────────────────────────────────────────
  const [property] = await db
    .select()
    .from(schema.properties)
    .where(eq(schema.properties.id, settlement.propertyId))
    .limit(1);
  const propName = property?.name || "Liegenschaft";

  // ── Eigentümer-Stammdaten (inkl. E-Mail) ──────────────────────────────────
  const owners = ownerIds.length > 0
    ? await db.select().from(schema.owners).where(inArray(schema.owners.id, ownerIds))
    : [];

  const ownersWithEmail  = owners.filter(o => o.email && o.email.trim());
  const noEmailCount     = owners.length - ownersWithEmail.length;

  if (ownersWithEmail.length === 0) {
    throw Object.assign(
      new Error(
        "Kein Eigentümer hat eine E-Mail-Adresse hinterlegt. " +
        "Bitte ergänzen Sie die E-Mail-Adressen in den Eigentümerstammdaten."
      ),
      { status: 400, noEmailCount: owners.length }
    );
  }

  // ── Pro Eigentümer individuelles HTML rendern und versenden ───────────────
  // Jeder Eigentümer erhält nur seinen eigenen Abrechnungsabschnitt (DSGVO Art. 5).
  const { renderWegSettlementHtml } = await import("../services/wegSettlementPdfService");

  const sentTo: string[]           = [];
  const failedRecipients: string[] = [];

  for (const owner of ownersWithEmail) {
    const ownerName = `${owner.firstName || ""} ${owner.lastName || ""}`.trim();
    const emailAddr = owner.email as string;
    let sendStatus: "sent" | "failed" = "sent";
    let errorMessage: string | undefined;

    try {
      // Individuelles HTML — enthält nur die Sektion dieses Eigentümers
      const html = await renderWegSettlementHtml(settlementId, orgId, owner.id);

      await sendEmailFn({
        to: emailAddr,
        subject: `WEG-Jahresabrechnung ${settlement.year} — ${propName}`,
        html,
        text:
          `Sehr geehrte/r ${ownerName},\n\n` +
          `hiermit erhalten Sie Ihre persönliche WEG-Jahresabrechnung ${settlement.year} für ${propName}.\n\n` +
          `Mit freundlichen Grüßen\nIhre Hausverwaltung`,
      });
      sentTo.push(emailAddr);
    } catch (err: any) {
      console.error(`[WEG Send] Fehler bei ${emailAddr}:`, err.message);
      failedRecipients.push(emailAddr);
      sendStatus = "failed";
      errorMessage = err.message ?? "Unbekannter Fehler";
    }

    // ── Versand-Log-Eintrag (unabhängig vom Ergebnis) ─────────────────────
    try {
      await db.insert(schema.wegSettlementEmails).values({
        settlementId,
        ownerId: owner.id,
        email: emailAddr,
        status: sendStatus,
        errorMessage: errorMessage ?? null,
      });
    } catch (logErr: any) {
      // Logging-Fehler dürfen den Versandprozess nicht abbrechen
      console.error(`[WEG Send] Log-Fehler für ${emailAddr}:`, logErr.message);
    }
  }

  // ── Status auf 'versendet' setzen wenn ≥1 E-Mail erfolgreich ──────────────
  if (sentTo.length > 0) {
    // Org-Scope (Defense-in-Depth zu RLS): explizite organization_id-Prüfung —
    // eine fremde settlementId trifft 0 Zeilen.
    await db
      .update(schema.wegSettlements)
      .set({ status: "versendet", approvedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(schema.wegSettlements.id, settlementId),
        eq(schema.wegSettlements.organizationId, orgId)
      ));
  }

  return {
    emailsSent:       sentTo.length,
    emailsFailed:     failedRecipients.length,
    noEmailCount,
    sentTo,
    failedRecipients,
  };
}
