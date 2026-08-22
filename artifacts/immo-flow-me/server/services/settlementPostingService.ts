import { sql } from "drizzle-orm";
import { fromCents, toCents } from "../lib/money";

type SettlementPostingInput = {
  organizationId: string;
  propertyId: string;
  unitId: string;
  tenantId?: string | null;
  ownerId?: string | null;
  settlementId: string;
  detailId: string;
  year: number;
  /** Positive means a receivable; negative means a credit for the occupant. */
  balance: number | string;
  source: "bk" | "weg";
  userId?: string | null;
};

type SettlementPostingResult = {
  openItemId?: string;
  journalEntryId?: string;
  kind: "receivable" | "credit" | "none";
};

function sourceType(source: SettlementPostingInput["source"]): string {
  return source === "bk" ? "bk_settlement_detail" : "weg_settlement_detail";
}

async function nextBookingNumber(tx: any, organizationId: string, year: number): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`settlement-booking:${organizationId}:${year}`}))`);
  const existing: any = await tx.execute(sql`
    SELECT current_number FROM booking_number_sequences
    WHERE organization_id = ${organizationId} AND current_year = ${year}
    FOR UPDATE
  `);
  const row = existing.rows?.[0];
  const next = Number(row?.current_number || 0) + 1;
  if (row) {
    await tx.execute(sql`
      UPDATE booking_number_sequences SET current_number = ${next}
      WHERE organization_id = ${organizationId} AND current_year = ${year}
    `);
  } else {
    await tx.execute(sql`
      INSERT INTO booking_number_sequences (organization_id, current_year, current_number)
      VALUES (${organizationId}, ${year}, ${next})
    `);
  }
  return `BU-${year}-${String(next).padStart(6, "0")}`;
}

async function ensureSettlementAccounts(tx: any, organizationId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`settlement-accounts:${organizationId}`}))`);
  const receivableResult: any = await tx.execute(sql`
    SELECT id FROM chart_of_accounts
    WHERE organization_id = ${organizationId}
      AND (account_number = '2000' OR name ILIKE '%forderung%')
    ORDER BY account_number
    LIMIT 1
  `);
  let receivableId = receivableResult.rows?.[0]?.id as string | undefined;
  if (!receivableId) {
    const inserted: any = await tx.execute(sql`
      INSERT INTO chart_of_accounts (organization_id, account_number, name, account_type, is_system)
      VALUES (${organizationId}, '2000', 'Forderungen aus Abrechnungen', 'asset', true)
      RETURNING id
    `);
    receivableId = inserted.rows?.[0]?.id;
  }

  const resultResult: any = await tx.execute(sql`
    SELECT id FROM chart_of_accounts
    WHERE organization_id = ${organizationId}
      AND (account_number = '4890' OR name ILIKE '%abrechnungsergebnis%')
    ORDER BY account_number
    LIMIT 1
  `);
  let resultId = resultResult.rows?.[0]?.id as string | undefined;
  if (!resultId) {
    const inserted: any = await tx.execute(sql`
      INSERT INTO chart_of_accounts (organization_id, account_number, name, account_type, is_system)
      VALUES (${organizationId}, '4890', 'Abrechnungsergebnis', 'revenue', true)
      RETURNING id
    `);
    resultId = inserted.rows?.[0]?.id;
  }
  if (!receivableId || !resultId) throw new Error("Konten für Abrechnungsfolge konnten nicht angelegt werden");
  return { receivableId, resultId };
}

/**
 * Creates the open item and double-entry posting for one settlement detail.
 * Callers must hold the settlement header lock and pass their active DB transaction.
 */
export async function postSettlementDetail(tx: any, input: SettlementPostingInput): Promise<SettlementPostingResult> {
  const balanceCents = toCents(input.balance);
  if (balanceCents === 0) return { kind: "none" };

  const amount = fromCents(Math.abs(balanceCents));
  const kind = balanceCents > 0 ? "receivable" : "credit";
  const type = sourceType(input.source);
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);
  const dueDateString = dueDate.toISOString().slice(0, 10);

  let openItemId: string | undefined;
  if (kind === "credit") {
    const result: any = await tx.execute(sql`
      INSERT INTO settlement_credits (
        organization_id, property_id, unit_id, tenant_id, owner_id, settlement_id,
        settlement_source_type, settlement_detail_id, amount, status, faellig_am, created_at, updated_at
      )
      VALUES (
        ${input.organizationId}, ${input.propertyId}, ${input.unitId}, ${input.tenantId || null},
        ${input.ownerId || null}, ${input.settlementId}, ${type}, ${input.detailId},
        ${amount}, 'offen', ${dueDateString}, now(), now()
      )
      ON CONFLICT (settlement_source_type, settlement_detail_id) DO NOTHING
      RETURNING id
    `);
    openItemId = result.rows?.[0]?.id;
  } else if (input.source === "bk") {
    if (!input.tenantId) throw new Error("BK-Abrechnungsdetail ohne Mieter kann nicht gebucht werden");
    const result: any = await tx.execute(sql`
      INSERT INTO monthly_invoices (
        tenant_id, unit_id, year, month, grundmiete, betriebskosten, heizungskosten,
        wasserkosten, ust, gesamtbetrag, status, faellig_am, is_vacancy,
        settlement_source_type, settlement_detail_id, created_at, updated_at
      )
      VALUES (
        ${input.tenantId}, ${input.unitId}, ${input.year}, 12, 0, ${amount}, 0,
        0, 0, ${amount}, 'offen', ${dueDateString}, false,
        ${type}, ${input.detailId}, now(), now()
      )
      ON CONFLICT (settlement_source_type, settlement_detail_id)
        WHERE settlement_source_type IS NOT NULL AND settlement_detail_id IS NOT NULL
      DO NOTHING
      RETURNING id
    `);
    openItemId = result.rows?.[0]?.id;
  } else {
    if (!input.ownerId) throw new Error("WEG-Abrechnungsdetail ohne Eigentümer kann nicht gebucht werden");
    const result: any = await tx.execute(sql`
      INSERT INTO weg_vorschreibungen (
        organization_id, property_id, unit_id, owner_id, year, month, mea_share,
        betriebskosten, ruecklage, instandhaltung, verwaltungshonorar, heizung, ust,
        gesamtbetrag, status, faellig_am, settlement_source_type, settlement_detail_id,
        created_at, updated_at
      )
      VALUES (
        ${input.organizationId}, ${input.propertyId}, ${input.unitId}, ${input.ownerId},
        ${input.year}, 12, 0, ${amount}, 0, 0, 0, 0, 0,
        ${amount}, 'offen', ${dueDateString}, ${type}, ${input.detailId}, now(), now()
      )
      ON CONFLICT (settlement_source_type, settlement_detail_id)
        WHERE settlement_source_type IS NOT NULL AND settlement_detail_id IS NOT NULL
      DO NOTHING
      RETURNING id
    `);
    openItemId = result.rows?.[0]?.id;
  }

  const existingEntry: any = await tx.execute(sql`
    SELECT id FROM journal_entries
    WHERE organization_id = ${input.organizationId}
      AND source_type = ${type}
      AND source_id = ${input.detailId}
    LIMIT 1
  `);
  let journalEntryId = existingEntry.rows?.[0]?.id as string | undefined;
  if (!journalEntryId) {
    const { receivableId, resultId } = await ensureSettlementAccounts(tx, input.organizationId);
    const bookingNumber = await nextBookingNumber(tx, input.organizationId, input.year);
    const description = `${input.source === "bk" ? "BK" : "WEG"}-Abrechnung ${input.year}: ${kind === "receivable" ? "Nachzahlung" : "Gutschrift"}`;
    const created: any = await tx.execute(sql`
      INSERT INTO journal_entries (
        organization_id, booking_number, entry_date, description, source_type, source_id,
        property_id, unit_id, tenant_id, created_by
      )
      VALUES (
        ${input.organizationId}, ${bookingNumber}, CURRENT_DATE, ${description}, ${type}, ${input.detailId},
        ${input.propertyId}, ${input.unitId}, ${input.tenantId || null}, ${input.userId || null}
      )
      ON CONFLICT (organization_id, source_type, source_id)
        WHERE source_type IN ('bk_settlement_detail', 'weg_settlement_detail')
      DO NOTHING
      RETURNING id
    `);
    journalEntryId = created.rows?.[0]?.id;
    if (!journalEntryId) {
      const concurrent: any = await tx.execute(sql`
        SELECT id FROM journal_entries
        WHERE organization_id = ${input.organizationId} AND source_type = ${type} AND source_id = ${input.detailId}
        LIMIT 1
      `);
      journalEntryId = concurrent.rows?.[0]?.id;
    } else {
      const debitAccount = balanceCents > 0 ? receivableId : resultId;
      const creditAccount = balanceCents > 0 ? resultId : receivableId;
      await tx.execute(sql`
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
        VALUES
          (${journalEntryId}, ${debitAccount}, ${amount}, 0, ${description}),
          (${journalEntryId}, ${creditAccount}, 0, ${amount}, ${description})
      `);
    }
  }

  await tx.execute(sql`
    INSERT INTO audit_logs (user_id, table_name, record_id, action, new_data, created_at)
    VALUES (
      ${input.userId || null}, ${input.source === "bk" ? "settlement_details" : "weg_settlement_details"},
      ${input.detailId}, 'financial_consequence',
      ${JSON.stringify({ settlementId: input.settlementId, kind, amount, openItemId, journalEntryId })}::jsonb,
      now()
    )
  `);

  return { openItemId, journalEntryId, kind };
}