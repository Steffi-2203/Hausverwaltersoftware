/**
 * Eingangsrechnungen (Lieferantenrechnungen) mit doppelter Buchführung
 *
 * Jede gebuchte Eingangsrechnung erzeugt automatisch einen Journal-Satz:
 *   Soll: Aufwandskonto (nach Kategorie)
 *   Haben: Verbindlichkeiten (Lieferanten)
 *
 * Bei Bezahlung:
 *   Soll: Verbindlichkeiten
 *   Haben: Bank
 */
import { Router } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { isAuthenticated, requireRole, getProfileFromSession, snakeToCamel } from "./helpers";
import { logger } from "../lib/logger";

const router = Router();

function getOrgId(req: any): string | null {
  return req.user?.organizationId ?? req.session?.organizationId ?? null;
}

// ── GET /api/incoming-invoices ─────────────────────────────────────────────
router.get("/api/incoming-invoices", isAuthenticated, async (req: any, res) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation zugeordnet" });

    const { propertyId, status, from, to } = req.query;

    const rows = await db.execute(sql`
      SELECT ii.*,
             p.name AS property_name
      FROM incoming_invoices ii
      LEFT JOIN properties p ON ii.property_id = p.id
      WHERE ii.organization_id = ${orgId}
        ${propertyId ? sql`AND ii.property_id = ${propertyId}` : sql``}
        ${status ? sql`AND ii.status = ${status}` : sql``}
        ${from ? sql`AND ii.invoice_date >= ${from}` : sql``}
        ${to ? sql`AND ii.invoice_date <= ${to}` : sql``}
      ORDER BY ii.invoice_date DESC
      LIMIT 500
    `);

    res.json(rows.rows);
  } catch (err: any) {
    logger.error({ err }, "[IncomingInvoice] GET error");
    res.status(500).json({ error: "Fehler beim Laden der Eingangsrechnungen" });
  }
});

// ── POST /api/incoming-invoices ────────────────────────────────────────────
// Legt eine Eingangsrechnung an und bucht sie sofort ins Journal.
router.post("/api/incoming-invoices", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation zugeordnet" });
    const profile = await getProfileFromSession(req);

    const body = snakeToCamel(req.body) as any;
    const {
      propertyId,
      vendorName,
      vendorIban,
      invoiceNumber,
      invoiceDate,
      dueDate,
      amountNet,
      vatRate = 20,
      description,
      category = "sonstige",
    } = body;

    if (!vendorName || !invoiceDate || amountNet == null || !description) {
      return res.status(400).json({ error: "Pflichtfelder: vendorName, invoiceDate, amountNet, description" });
    }

    const netNum = Number(amountNet);
    if (!isFinite(netNum) || netNum < 0) {
      return res.status(400).json({ error: "amountNet muss eine nicht-negative Zahl sein" });
    }

    // Prüfen ob propertyId zur Org gehört
    if (propertyId) {
      const propCheck = await db.execute(sql`
        SELECT id FROM properties WHERE id = ${propertyId} AND organization_id = ${orgId} LIMIT 1
      `);
      if (!propCheck.rows?.length) {
        return res.status(403).json({ error: "Objekt gehört nicht zu Ihrer Organisation" });
      }
    }

    const result = await db.transaction(async (tx) => {
      // 1. Buchungsnummer generieren
      const year = new Date(invoiceDate).getFullYear();
      const seqResult = await tx.execute(sql`
        INSERT INTO booking_number_sequences (organization_id, current_year, current_number)
        VALUES (${orgId}, ${year}, 1)
        ON CONFLICT (organization_id, current_year)
        DO UPDATE SET current_number = booking_number_sequences.current_number + 1
        RETURNING current_number
      `);
      const seqNum = (seqResult.rows?.[0] as any)?.current_number ?? 1;
      const bookingNumber = `ER-${year}-${String(seqNum).padStart(4, '0')}`;

      // 2. Journal-Eintrag (Doppelte Buchführung)
      //    Soll: Aufwand (nach Kategorie) / Haben: Verbindlichkeit Lieferanten
      const jeResult = await tx.execute(sql`
        INSERT INTO journal_entries (
          organization_id, booking_number, entry_date, description,
          beleg_nummer, source_type, property_id, created_by
        )
        VALUES (
          ${orgId}, ${bookingNumber}, ${invoiceDate},
          ${`Eingangsrechnung: ${vendorName} — ${description}`},
          ${invoiceNumber || null}, 'incoming_invoice',
          ${propertyId || null}, ${profile?.userId || null}
        )
        RETURNING id
      `);
      const jeId = (jeResult.rows?.[0] as any)?.id;

      if (jeId) {
        const vatAmount = Math.round(netNum * Number(vatRate) / 100 * 100) / 100;
        const grossAmount = netNum + vatAmount;

        // Soll-Buchung: Aufwandskonto (nach Kategorie suchen, Fallback Generisches Aufwandskonto)
        await tx.execute(sql`
          INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
          SELECT ${jeId}, coa.id, ${netNum}, 0, ${`Netto: ${vendorName}`}
          FROM chart_of_accounts coa
          WHERE coa.organization_id = ${orgId}
            AND (
              coa.name ILIKE ${`%${category}%`}
              OR coa.name ILIKE '%aufwand%'
              OR coa.account_number LIKE '5%'
            )
          ORDER BY CASE WHEN coa.name ILIKE ${`%${category}%`} THEN 0 ELSE 1 END
          LIMIT 1
        `);

        // Vorsteuer-Buchung (Haben-Buchung)
        if (vatAmount > 0) {
          await tx.execute(sql`
            INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
            SELECT ${jeId}, coa.id, ${vatAmount}, 0, ${`Vorsteuer ${vatRate}%`}
            FROM chart_of_accounts coa
            WHERE coa.organization_id = ${orgId}
              AND (coa.account_number = '2500' OR coa.name ILIKE '%vorsteuer%')
            LIMIT 1
          `);
        }

        // Haben: Verbindlichkeit Lieferanten
        await tx.execute(sql`
          INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
          SELECT ${jeId}, coa.id, 0, ${grossAmount}, ${`Verbindlichkeit: ${vendorName}`}
          FROM chart_of_accounts coa
          WHERE coa.organization_id = ${orgId}
            AND (coa.account_number = '3300' OR coa.name ILIKE '%verbindlichkeit%lieferant%' OR coa.name ILIKE '%kreditor%')
          LIMIT 1
        `);
      }

      // 3. Eingangsrechnung speichern
      const invResult = await tx.execute(sql`
        INSERT INTO incoming_invoices (
          organization_id, property_id, vendor_name, vendor_iban,
          invoice_number, invoice_date, due_date,
          amount_net, vat_rate, description, category,
          status, journal_entry_id, created_by
        )
        VALUES (
          ${orgId}, ${propertyId || null}, ${vendorName}, ${vendorIban || null},
          ${invoiceNumber || null}, ${invoiceDate}, ${dueDate || null},
          ${netNum}, ${Number(vatRate)}, ${description}, ${category},
          'offen', ${jeId || null}, ${profile?.userId || null}
        )
        RETURNING *
      `);

      return invResult.rows?.[0];
    });

    res.status(201).json(result);
  } catch (err: any) {
    logger.error({ err }, "[IncomingInvoice] POST error");
    res.status(500).json({ error: err.message || "Fehler beim Anlegen der Eingangsrechnung" });
  }
});

// ── PATCH /api/incoming-invoices/:id/pay ──────────────────────────────────
// Markiert eine Eingangsrechnung als bezahlt und bucht Verbindlichkeit/Bank.
router.patch("/api/incoming-invoices/:id/pay", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation zugeordnet" });
    const profile = await getProfileFromSession(req);
    const { id } = req.params;
    const { paidAt, paidBy } = snakeToCamel(req.body) as any;

    // Rechnung holen + Org-Check
    const invRows = await db.execute(sql`
      SELECT * FROM incoming_invoices WHERE id = ${id} AND organization_id = ${orgId} LIMIT 1
    `);
    const inv = invRows.rows?.[0] as any;
    if (!inv) return res.status(404).json({ error: "Eingangsrechnung nicht gefunden" });
    if (inv.status === 'bezahlt') return res.status(409).json({ error: "Bereits als bezahlt markiert" });

    const paymentDate = paidAt || new Date().toISOString().split('T')[0];
    const grossAmount = Number(inv.amount_gross);

    await db.transaction(async (tx) => {
      // Journal: Verbindlichkeit aufgelöst / Bank belastet
      const year = new Date(paymentDate).getFullYear();
      const seqResult = await tx.execute(sql`
        INSERT INTO booking_number_sequences (organization_id, current_year, current_number)
        VALUES (${orgId}, ${year}, 1)
        ON CONFLICT (organization_id, current_year)
        DO UPDATE SET current_number = booking_number_sequences.current_number + 1
        RETURNING current_number
      `);
      const seqNum = (seqResult.rows?.[0] as any)?.current_number ?? 1;
      const bookingNumber = `ERZAHLUNG-${year}-${String(seqNum).padStart(4, '0')}`;

      const jeResult = await tx.execute(sql`
        INSERT INTO journal_entries (
          organization_id, booking_number, entry_date, description, source_type, created_by
        )
        VALUES (
          ${orgId}, ${bookingNumber}, ${paymentDate},
          ${`Bezahlung Eingangsrechnung ${inv.vendor_name} (${inv.invoice_number || id})`},
          'incoming_invoice_payment', ${profile?.userId || null}
        )
        RETURNING id
      `);
      const jeId = (jeResult.rows?.[0] as any)?.id;

      if (jeId) {
        // Soll: Verbindlichkeit auflösen
        await tx.execute(sql`
          INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
          SELECT ${jeId}, coa.id, ${grossAmount}, 0, 'Verbindlichkeit bezahlt'
          FROM chart_of_accounts coa
          WHERE coa.organization_id = ${orgId}
            AND (coa.account_number = '3300' OR coa.name ILIKE '%verbindlichkeit%' OR coa.name ILIKE '%kreditor%')
          LIMIT 1
        `);
        // Haben: Bank
        await tx.execute(sql`
          INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
          SELECT ${jeId}, coa.id, 0, ${grossAmount}, ${`Zahlung an ${inv.vendor_name}`}
          FROM chart_of_accounts coa
          WHERE coa.organization_id = ${orgId}
            AND (coa.account_number = '1200' OR coa.name ILIKE '%bank%')
          LIMIT 1
        `);
      }

      await tx.execute(sql`
        UPDATE incoming_invoices
        SET status = 'bezahlt', paid_at = ${paymentDate}, paid_by = ${paidBy || profile?.userId || null},
            updated_at = now()
        WHERE id = ${id} AND organization_id = ${orgId}
      `);
    });

    res.json({ success: true, message: "Eingangsrechnung als bezahlt markiert" });
  } catch (err: any) {
    logger.error({ err }, "[IncomingInvoice] PAY error");
    res.status(500).json({ error: err.message || "Fehler beim Bezahlen der Eingangsrechnung" });
  }
});

// ── DELETE /api/incoming-invoices/:id ─────────────────────────────────────
router.delete("/api/incoming-invoices/:id", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation zugeordnet" });

    const result = await db.execute(sql`
      UPDATE incoming_invoices SET status = 'storniert', updated_at = now()
      WHERE id = ${req.params.id} AND organization_id = ${orgId} AND status = 'offen'
      RETURNING id
    `);

    if (!result.rows?.length) {
      return res.status(404).json({ error: "Eingangsrechnung nicht gefunden oder bereits bezahlt/storniert" });
    }

    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err }, "[IncomingInvoice] DELETE error");
    res.status(500).json({ error: "Fehler beim Stornieren" });
  }
});

export default router;
