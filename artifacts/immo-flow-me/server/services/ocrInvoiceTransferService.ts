import crypto from "crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { createAuditLogStrict } from "../lib/auditLog";

export class OcrInvoiceTransferValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrInvoiceTransferValidationError";
  }
}

export interface OcrInvoiceTransferInput {
  organizationId: string;
  userId: string | null;
  propertyId: unknown;
  ocrDocumentId: unknown;
  lieferant?: unknown;
  vendorName?: unknown;
  rechnungsnummer?: unknown;
  invoiceNumber?: unknown;
  rechnungsdatum?: unknown;
  invoiceDate?: unknown;
  datum?: unknown;
  bruttobetrag?: unknown;
  betrag?: unknown;
  amountGross?: unknown;
  nettobetrag?: unknown;
  netto_betrag?: unknown;
  amountNet?: unknown;
  ustSatz?: unknown;
  ust_satz?: unknown;
  vatRate?: unknown;
  ustBetrag?: unknown;
  ust_betrag?: unknown;
  vatAmount?: unknown;
  beschreibung?: unknown;
  description?: unknown;
  kategorie?: unknown;
  category?: unknown;
  expense_type?: unknown;
  expenseType?: unknown;
  iban?: unknown;
  vendorIban?: unknown;
  audit?: {
    originalData?: Record<string, unknown> | null;
    source?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  };
}

interface NormalizedTransfer {
  propertyId: string;
  ocrDocumentId: string;
  vendorName: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  grossCents: number;
  netCents: number;
  vatCents: number;
  vatRate: number;
  description: string;
  category: string;
  expenseType: string;
  vendorIban: string | null;
  payloadHash: string;
}

function nonEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readFirst(...values: unknown[]): string {
  for (const value of values) {
    const text = nonEmpty(value);
    if (text) return text;
  }
  return "";
}

function parseMoneyCents(value: unknown, field: string, required = true): number | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new OcrInvoiceTransferValidationError(`${field} ist erforderlich`);
    return null;
  }
  const normalized = typeof value === "string" ? value.trim().replace(",", ".") : value;
  const number = Number(normalized);
  if (!Number.isFinite(number)) {
    throw new OcrInvoiceTransferValidationError(`${field} muss eine gültige Zahl sein`);
  }
  return Math.round(number * 100);
}

function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

const OCR_EXPENSE_TYPE_MAP: Record<string, string> = {
  strom: "strom_allgemein",
  strom_allgemein: "strom_allgemein",
  gas: "heizung",
  heizung: "heizung",
  wasser: "wasser_abwasser",
  wasser_abwasser: "wasser_abwasser",
  kanalgebuehr: "wasser_abwasser",
  muellabfuhr: "muellabfuhr",
  hausreinigung: "hausbetreuung",
  hausbetreuung: "hausbetreuung",
  lift: "lift",
  versicherung: "versicherung",
  grundsteuer: "grundsteuer",
  winterdienst: "schneeraeumung",
  schneeraeumung: "schneeraeumung",
  gartenarbeit: "gartenpflege",
  gartenpflege: "gartenpflege",
  reparatur: "reparatur",
  wartung: "reparatur",
  verwaltung: "verwaltung",
  ruecklage: "ruecklage",
  sanierung: "sanierung",
  sonstiges: "sonstiges",
};

function normalizeExpenseType(value: unknown): string {
  const raw = nonEmpty(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (!raw) return "sonstiges";
  const normalized = OCR_EXPENSE_TYPE_MAP[raw];
  if (!normalized) {
    throw new OcrInvoiceTransferValidationError("Die Kostenart ist nicht zulässig. Bitte wählen Sie eine bekannte Kostenart oder „sonstiges“.");
  }
  return normalized;
}

function normalizeTransfer(input: OcrInvoiceTransferInput): NormalizedTransfer {
  const propertyId = nonEmpty(input.propertyId);
  const ocrDocumentId = nonEmpty(input.ocrDocumentId);
  const vendorName = readFirst(input.lieferant, input.vendorName);
  const invoiceDate = readFirst(input.rechnungsdatum, input.invoiceDate, input.datum);
  const description = readFirst(input.beschreibung, input.description);

  if (!propertyId) throw new OcrInvoiceTransferValidationError("Bitte wählen Sie eine Liegenschaft aus");
  if (!ocrDocumentId) throw new OcrInvoiceTransferValidationError("OCR-Vorgangs-ID fehlt. Bitte analysieren Sie den Beleg erneut.");
  if (!vendorName) throw new OcrInvoiceTransferValidationError("Lieferant ist erforderlich");
  if (!invoiceDate) throw new OcrInvoiceTransferValidationError("Rechnungsdatum ist erforderlich");
  if (!isValidDate(invoiceDate)) throw new OcrInvoiceTransferValidationError("Rechnungsdatum muss im Format JJJJ-MM-TT angegeben werden");
  if (!description) throw new OcrInvoiceTransferValidationError("Beschreibung ist erforderlich");

  const grossCents = parseMoneyCents(
    input.bruttobetrag ?? input.betrag ?? input.amountGross,
    "Bruttobetrag",
  )!;
  if (grossCents <= 0) throw new OcrInvoiceTransferValidationError("Bruttobetrag muss größer als 0 sein");

  const vatRateRaw = input.ustSatz ?? input.ust_satz ?? input.vatRate ?? 20;
  const vatRate = Number(typeof vatRateRaw === "string" ? vatRateRaw.replace(",", ".") : vatRateRaw);
  if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
    throw new OcrInvoiceTransferValidationError("USt-Satz muss zwischen 0 und 100 liegen");
  }

  const suppliedNet = parseMoneyCents(
    input.nettobetrag ?? input.netto_betrag ?? input.amountNet,
    "Nettobetrag",
    false,
  );
  const netCents = suppliedNet ?? Math.round(grossCents / (1 + vatRate / 100));
  if (netCents < 0 || netCents > grossCents) {
    throw new OcrInvoiceTransferValidationError("Nettobetrag passt nicht zum Bruttobetrag");
  }
  const vatCents = grossCents - netCents;
  const suppliedVat = parseMoneyCents(
    input.ustBetrag ?? input.ust_betrag ?? input.vatAmount,
    "USt-Betrag",
    false,
  );
  if (suppliedVat !== null && Math.abs(suppliedVat - vatCents) > 1) {
    throw new OcrInvoiceTransferValidationError("Netto-, USt- und Bruttobetrag widersprechen einander");
  }
  const expectedGrossCents = netCents + Math.round(netCents * vatRate / 100);
  if (Math.abs(expectedGrossCents - grossCents) > 1) {
    throw new OcrInvoiceTransferValidationError("Netto-, USt- und Bruttobetrag widersprechen einander");
  }

  const category = readFirst(input.kategorie, input.category) || "betriebskosten_umlagefaehig";
  const expenseType = normalizeExpenseType(input.expense_type ?? input.expenseType);
  const invoiceNumber = readFirst(input.rechnungsnummer, input.invoiceNumber) || null;
  const vendorIban = readFirst(input.iban, input.vendorIban) || null;
  const payload = {
    propertyId, vendorName, invoiceNumber, invoiceDate, grossCents, netCents, vatCents,
    vatRate, description, category, expenseType, vendorIban,
  };

  return {
    ...payload,
    ocrDocumentId,
    payloadHash: crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
  };
}

function rowsOf(result: any): any[] {
  return result?.rows ?? result ?? [];
}

/**
 * Speichert die geprüfte OCR-Rechnung als genau einen, vollständig verknüpften
 * Buchhaltungsbeleg. Der Unique-Index auf (organization_id, ocr_document_id)
 * ist die maßgebliche Wiederholsicherung, auch bei parallelen Requests.
 */
export async function transferOcrInvoice(input: OcrInvoiceTransferInput) {
  const normalized = normalizeTransfer(input);

  return db.transaction(async (tx) => {
    const propertyRows = rowsOf(await tx.execute(sql`
      SELECT id FROM properties
      WHERE id = ${normalized.propertyId}::uuid
        AND organization_id = ${input.organizationId}::uuid
      LIMIT 1
    `));
    if (!propertyRows.length) {
      throw new OcrInvoiceTransferValidationError("Die ausgewählte Liegenschaft gehört nicht zu Ihrer Organisation");
    }

    // Die Rechnung wird zuerst reserviert. Bei einem Konflikt wartet PostgreSQL
    // auf die erste Transaktion und liefert anschließend deren vollständigen Zustand.
    const invoiceRows = rowsOf(await tx.execute(sql`
      INSERT INTO incoming_invoices (
        organization_id, property_id, vendor_name, vendor_iban,
        invoice_number, invoice_date, amount_net, vat_rate, description, category,
        status, created_by, ocr_document_id, ocr_payload_hash
      ) VALUES (
        ${input.organizationId}::uuid, ${normalized.propertyId}::uuid, ${normalized.vendorName}, ${normalized.vendorIban},
        ${normalized.invoiceNumber}, ${normalized.invoiceDate}, ${centsToDecimal(normalized.netCents)}, ${normalized.vatRate}, ${normalized.description}, ${normalized.category},
        'offen', ${input.userId}, ${normalized.ocrDocumentId}, ${normalized.payloadHash}
      )
      ON CONFLICT (organization_id, ocr_document_id) WHERE ocr_document_id IS NOT NULL
      DO NOTHING
      RETURNING *
    `));

    if (!invoiceRows.length) {
      const existing = rowsOf(await tx.execute(sql`
        SELECT ii.*, je.id AS linked_journal_entry_id, e.id AS linked_expense_id
        FROM incoming_invoices ii
        LEFT JOIN journal_entries je ON je.id = ii.journal_entry_id
        LEFT JOIN expenses e ON e.incoming_invoice_id = ii.id
        WHERE ii.organization_id = ${input.organizationId}::uuid
          AND ii.ocr_document_id = ${normalized.ocrDocumentId}
        LIMIT 1
      `))[0];

      if (!existing) throw new Error("OCR-Übernahme konnte nicht erneut geladen werden");
      if (existing.ocr_payload_hash !== normalized.payloadHash) {
        throw new OcrInvoiceTransferValidationError("Diese OCR-Vorgangs-ID wurde bereits mit abweichenden Rechnungsdaten übernommen");
      }
      if (!existing.linked_journal_entry_id || !existing.linked_expense_id) {
        throw new Error("Die frühere OCR-Übernahme ist unvollständig und muss administrativ geprüft werden");
      }
      return {
        created: false,
        incomingInvoice: existing,
        journalEntryId: existing.linked_journal_entry_id,
        expenseId: existing.linked_expense_id,
        normalized,
      };
    }

    const invoice = invoiceRows[0];
    const expenseAccount = rowsOf(await tx.execute(sql`
      SELECT id FROM chart_of_accounts
      WHERE organization_id = ${input.organizationId}::uuid
        AND is_active = true
        AND (
          name ILIKE ${`%${normalized.category}%`}
          OR name ILIKE '%aufwand%'
          OR account_number LIKE '5%'
        )
      ORDER BY CASE WHEN name ILIKE ${`%${normalized.category}%`} THEN 0 ELSE 1 END
      LIMIT 1
    `))[0];
    const liabilityAccount = rowsOf(await tx.execute(sql`
      SELECT id FROM chart_of_accounts
      WHERE organization_id = ${input.organizationId}::uuid
        AND is_active = true
        AND (account_number = '3300' OR name ILIKE '%verbindlichkeit%lieferant%' OR name ILIKE '%kreditor%')
      LIMIT 1
    `))[0];
    const vatAccount = normalized.vatCents > 0 ? rowsOf(await tx.execute(sql`
      SELECT id FROM chart_of_accounts
      WHERE organization_id = ${input.organizationId}::uuid
        AND is_active = true
        AND (account_number = '2500' OR name ILIKE '%vorsteuer%')
      LIMIT 1
    `))[0] : null;

    if (!expenseAccount) throw new OcrInvoiceTransferValidationError("Kein aktives Aufwandskonto für diese Kategorie gefunden");
    if (!liabilityAccount) throw new OcrInvoiceTransferValidationError("Kein aktives Lieferanten-Verbindlichkeitskonto gefunden");
    if (normalized.vatCents > 0 && !vatAccount) throw new OcrInvoiceTransferValidationError("Kein aktives Vorsteuerkonto für den USt-Betrag gefunden");

    const year = Number(normalized.invoiceDate.slice(0, 4));
    const sequenceRows = rowsOf(await tx.execute(sql`
      INSERT INTO booking_number_sequences (organization_id, current_year, current_number)
      VALUES (${input.organizationId}::uuid, ${year}, 1)
      ON CONFLICT (organization_id, current_year)
      DO UPDATE SET current_number = booking_number_sequences.current_number + 1
      RETURNING current_number
    `));
    const bookingNumber = `ER-${year}-${String(Number(sequenceRows[0]?.current_number ?? 1)).padStart(4, "0")}`;

    const journalRows = rowsOf(await tx.execute(sql`
      INSERT INTO journal_entries (
        organization_id, booking_number, entry_date, description, beleg_nummer,
        source_type, source_id, property_id, created_by
      ) VALUES (
        ${input.organizationId}::uuid, ${bookingNumber}, ${normalized.invoiceDate},
        ${`OCR-Eingangsrechnung: ${normalized.vendorName} — ${normalized.description}`}, ${normalized.invoiceNumber},
        'ocr_incoming_invoice', ${invoice.id}::uuid, ${normalized.propertyId}::uuid, ${input.userId}
      )
      RETURNING id
    `));
    const journalEntryId = journalRows[0]?.id;
    if (!journalEntryId) throw new Error("Journalbuchung konnte nicht angelegt werden");

    await tx.execute(sql`
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
      VALUES
        (${journalEntryId}::uuid, ${expenseAccount.id}::uuid, ${centsToDecimal(normalized.netCents)}, 0, ${`Netto: ${normalized.vendorName}`}),
        ${normalized.vatCents > 0
          ? sql`(${journalEntryId}::uuid, ${vatAccount!.id}::uuid, ${centsToDecimal(normalized.vatCents)}, 0, ${`Vorsteuer ${normalized.vatRate}%`}),`
          : sql``}
        (${journalEntryId}::uuid, ${liabilityAccount.id}::uuid, 0, ${centsToDecimal(normalized.grossCents)}, ${`Verbindlichkeit: ${normalized.vendorName}`})
    `);

    await tx.execute(sql`
      UPDATE incoming_invoices
      SET journal_entry_id = ${journalEntryId}::uuid, updated_at = now()
      WHERE id = ${invoice.id}::uuid
    `);

    const expenseCategory = normalized.category === "instandhaltung" ? "instandhaltung" : "betriebskosten_umlagefaehig";
    const expenseRows = rowsOf(await tx.execute(sql`
      INSERT INTO expenses (
        property_id, category, expense_type, bezeichnung, betrag, datum,
        beleg_nummer, year, month, ist_umlagefaehig, notes, incoming_invoice_id
      ) VALUES (
        ${normalized.propertyId}::uuid, ${expenseCategory}, ${normalized.expenseType}, ${`${normalized.vendorName}: ${normalized.description}`},
        ${centsToDecimal(normalized.grossCents)}, ${normalized.invoiceDate}, ${normalized.invoiceNumber},
        ${year}, ${Number(normalized.invoiceDate.slice(5, 7))}, ${expenseCategory === "betriebskosten_umlagefaehig"},
        ${`OCR-Eingangsrechnung ${invoice.id}; Netto ${centsToDecimal(normalized.netCents)} EUR, USt ${normalized.vatRate}%`}, ${invoice.id}::uuid
      )
      RETURNING id
    `));
    const expenseId = expenseRows[0]?.id;
    if (!expenseId) throw new Error("Abrechnungsrelevante Kostenposition konnte nicht angelegt werden");

    // Der HMAC-Nachweis ist Teil derselben Datenbanktransaktion: Fehlschläge
    // rollen auch Rechnung, Journal und Kostenposition zurück.
    await createAuditLogStrict({
      userId: input.userId ?? undefined,
      tableName: "ocr_invoice_transfers",
      recordId: invoice.id,
      action: "ocr_invoice_transfer",
      oldData: input.audit?.originalData ?? null,
      newData: {
        lieferant: normalized.vendorName,
        rechnungsnummer: normalized.invoiceNumber,
        rechnungsdatum: normalized.invoiceDate,
        bruttobetrag: normalized.grossCents / 100,
        nettobetrag: normalized.netCents / 100,
        ustBetrag: normalized.vatCents / 100,
        ustSatz: normalized.vatRate,
        beschreibung: normalized.description,
        kategorie: normalized.category,
      },
      details: {
        source: input.audit?.source ?? "web_ocr",
        ocr_document_id: normalized.ocrDocumentId,
        incoming_invoice_id: invoice.id,
        journal_entry_id: journalEntryId,
        expense_id: expenseId,
      },
      ipAddress: input.audit?.ipAddress ?? undefined,
      userAgent: input.audit?.userAgent ?? undefined,
    }, tx as any);

    return { created: true, incomingInvoice: invoice, journalEntryId, expenseId, normalized };
  });
}