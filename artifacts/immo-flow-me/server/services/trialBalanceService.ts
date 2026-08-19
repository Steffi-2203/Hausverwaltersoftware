import { db } from "../db";
import { eq, and, sql, between } from "drizzle-orm";
import * as schema from "@shared/schema";
import { roundMoney } from "@shared/utils";
import { toCents, fromCents, sumCents } from "../lib/money";

interface AccountBalance {
  kontoNummer: string;
  kontoName: string;
  accountType: string;
  totalSoll: number;
  totalHaben: number;
  saldo: number;
}

interface TrialBalanceResult {
  isBalanced: boolean;
  totalSoll: number;
  totalHaben: number;
  difference: number;
  entryCount: number;
  checkedAt: Date;
  warnings: string[];
  details?: AccountBalance[];
}

interface SettlementValidation {
  isValid: boolean;
  totalSoll: number;
  totalIst: number;
  expenseTotal: number;
  discrepancy: number;
}

interface ReconciliationRate {
  invoiceMatchRate: number;
  paymentMatchRate: number;
  unmatchedPayments: number;
  unmatchedInvoices: number;
  totalInvoices: number;
  paidInvoices: number;
  totalPaymentAmount: number;
  allocatedAmount: number;
}

function buildDateAndFilterConditions(orgId: string, propertyId?: string, fromDate?: string, toDate?: string) {
  const conditions: any[] = [];

  conditions.push(sql`je.organization_id = ${orgId}`);

  if (propertyId) {
    conditions.push(sql`je.property_id = ${propertyId}`);
  }

  if (fromDate && toDate) {
    conditions.push(sql`je.entry_date BETWEEN ${fromDate} AND ${toDate}`);
  } else if (fromDate) {
    conditions.push(sql`je.entry_date >= ${fromDate}`);
  } else if (toDate) {
    conditions.push(sql`je.entry_date <= ${toDate}`);
  }

  return conditions.length > 0
    ? sql.join(conditions, sql` AND `)
    : sql`1=1`;
}

export async function validateTrialBalance(
  orgId: string,
  propertyId?: string,
  fromDate?: string,
  toDate?: string,
  includeDetails = false
): Promise<TrialBalanceResult> {
  const whereClause = buildDateAndFilterConditions(orgId, propertyId, fromDate, toDate);

  const totalsResult = await db.execute(sql`
    SELECT
      COALESCE(SUM(jel.debit), 0) AS total_soll,
      COALESCE(SUM(jel.credit), 0) AS total_haben,
      COUNT(DISTINCT je.id) AS entry_count
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE ${whereClause}
  `);

  const row = (totalsResult.rows || totalsResult)[0] as any;
  // Intern in Cents rechnen — Float-Akkumulation vermieden
  const totalSollCents = toCents(String(row.total_soll || 0));
  const totalHabenCents = toCents(String(row.total_haben || 0));
  const differenceCents = totalSollCents - totalHabenCents;
  const totalSoll = fromCents(totalSollCents);
  const totalHaben = fromCents(totalHabenCents);
  const difference = fromCents(differenceCents);
  const entryCount = Number(row.entry_count || 0);

  const warnings: string[] = [];

  // Schwelle: 1 Cent (statt 0.01 Float-Vergleich)
  if (Math.abs(differenceCents) >= 1) {
    warnings.push(`Saldendifferenz: Soll ${totalSoll.toFixed(2)} != Haben ${totalHaben.toFixed(2)}, Differenz: ${difference.toFixed(2)}`);
  }

  if (entryCount === 0) {
    warnings.push("Keine Buchungen im gewählten Zeitraum gefunden");
  }

  let details: AccountBalance[] | undefined;
  if (includeDetails) {
    details = await getAccountBalances(orgId, propertyId, fromDate, toDate);
  }

  return {
    isBalanced: Math.abs(differenceCents) < 1,
    totalSoll,
    totalHaben,
    difference,
    entryCount,
    checkedAt: new Date(),
    warnings,
    details,
  };
}

export async function getAccountBalances(
  orgId: string,
  propertyId?: string,
  fromDate?: string,
  toDate?: string
): Promise<AccountBalance[]> {
  const whereClause = buildDateAndFilterConditions(orgId, propertyId, fromDate, toDate);

  const result = await db.execute(sql`
    SELECT
      coa.account_number AS konto_nummer,
      coa.name AS konto_name,
      coa.account_type,
      COALESCE(SUM(jel.debit), 0) AS total_soll,
      COALESCE(SUM(jel.credit), 0) AS total_haben
    FROM chart_of_accounts coa
    JOIN journal_entry_lines jel ON jel.account_id = coa.id
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE ${whereClause}
    GROUP BY coa.id, coa.account_number, coa.name, coa.account_type
    ORDER BY coa.account_number
  `);

  const rows: any[] = result.rows || result;

  return rows.map((r) => {
    const totalSollCents = toCents(String(r.total_soll || 0));
    const totalHabenCents = toCents(String(r.total_haben || 0));
    const accountType = r.account_type as string;
    const isPassive = accountType === "liability" || accountType === "equity" || accountType === "revenue";
    const saldoCents = isPassive
      ? totalHabenCents - totalSollCents
      : totalSollCents - totalHabenCents;

    return {
      kontoNummer: r.konto_nummer,
      kontoName: r.konto_name,
      accountType,
      totalSoll: fromCents(totalSollCents),
      totalHaben: fromCents(totalHabenCents),
      saldo: fromCents(saldoCents),
    };
  });
}

export async function validateSettlementTotals(settlementId: string): Promise<SettlementValidation> {
  const [settlement] = await db
    .select()
    .from(schema.wegSettlements)
    .where(eq(schema.wegSettlements.id, settlementId))
    .limit(1);

  if (!settlement) {
    return { isValid: false, totalSoll: 0, totalIst: 0, expenseTotal: 0, discrepancy: 0 };
  }

  const details = await db
    .select()
    .from(schema.wegSettlementDetails)
    .where(eq(schema.wegSettlementDetails.settlementId, settlementId));

  // Float-Akkumulation durch Cent-Summen ersetzt
  const totalSollCents = sumCents(details.map((d) => toCents(d.totalSoll || 0)));
  const totalIstCents = sumCents(details.map((d) => toCents(d.totalIst || 0)));
  const expenseTotalCents = toCents(settlement.totalExpenses || 0);

  const discrepancyCents = Math.abs(totalSollCents - expenseTotalCents);
  const isValid = discrepancyCents < 1;

  return {
    isValid,
    totalSoll: fromCents(totalSollCents),
    totalIst: fromCents(totalIstCents),
    expenseTotal: fromCents(expenseTotalCents),
    discrepancy: fromCents(discrepancyCents),
  };
}

export async function getReconciliationRate(
  orgId: string,
  propertyId?: string,
  year?: number
): Promise<ReconciliationRate> {
  const currentYear = year || new Date().getFullYear();

  let invoiceConditions = sql`
    u.property_id IN (
      SELECT id FROM properties WHERE organization_id = ${orgId} AND deleted_at IS NULL
    )
    AND mi.year = ${currentYear}
    AND mi.is_vacancy = false
  `;

  if (propertyId) {
    invoiceConditions = sql`${invoiceConditions} AND u.property_id = ${propertyId}`;
  }

  const invoiceResult = await db.execute(sql`
    SELECT
      COUNT(*) AS total_invoices,
      COUNT(*) FILTER (WHERE mi.status = 'bezahlt') AS paid_invoices,
      COALESCE(SUM(mi.gesamtbetrag::numeric), 0) AS total_invoice_amount
    FROM monthly_invoices mi
    JOIN units u ON u.id = mi.unit_id
    WHERE ${invoiceConditions}
  `);

  const invRow = (invoiceResult.rows || invoiceResult)[0] as any;
  const totalInvoices = Number(invRow.total_invoices || 0);
  const paidInvoices = Number(invRow.paid_invoices || 0);

  let paymentConditions = sql`
    t.unit_id IN (
      SELECT u.id FROM units u
      JOIN properties p ON p.id = u.property_id
      WHERE p.organization_id = ${orgId} AND p.deleted_at IS NULL
    )
    AND EXTRACT(YEAR FROM p.buchungs_datum::date) = ${currentYear}
  `;

  if (propertyId) {
    paymentConditions = sql`${paymentConditions} AND t.unit_id IN (
      SELECT id FROM units WHERE property_id = ${propertyId}
    )`;
  }

  const paymentResult = await db.execute(sql`
    SELECT
      COALESCE(SUM(p.betrag::numeric), 0) AS total_payment_amount,
      COALESCE(SUM(pa.applied_total), 0) AS allocated_amount,
      COUNT(*) FILTER (WHERE pa.applied_total IS NULL OR pa.applied_total < p.betrag::numeric) AS unmatched_payments
    FROM payments p
    JOIN tenants t ON t.id = p.tenant_id
    LEFT JOIN (
      SELECT payment_id, SUM(applied_amount::numeric) AS applied_total
      FROM payment_allocations
      GROUP BY payment_id
    ) pa ON pa.payment_id = p.id
    WHERE ${paymentConditions}
  `);

  const payRow = (paymentResult.rows || paymentResult)[0] as any;
  // Einzel-DB-Werte in Cents überführen
  const totalPaymentAmountCents = toCents(String(payRow.total_payment_amount || 0));
  const allocatedAmountCents = toCents(String(payRow.allocated_amount || 0));
  const totalPaymentAmount = fromCents(totalPaymentAmountCents);
  const allocatedAmount = fromCents(allocatedAmountCents);
  const unmatchedPayments = Number(payRow.unmatched_payments || 0);

  const unmatchedInvoices = totalInvoices - paidInvoices;
  const invoiceMatchRate = totalInvoices > 0 ? roundMoney((paidInvoices / totalInvoices) * 100) : 0;
  const paymentMatchRate = totalPaymentAmountCents > 0
    ? roundMoney((allocatedAmountCents / totalPaymentAmountCents) * 100)
    : 0;

  return {
    invoiceMatchRate,
    paymentMatchRate,
    unmatchedPayments,
    unmatchedInvoices,
    totalInvoices,
    paidInvoices,
    totalPaymentAmount,
    allocatedAmount,
  };
}

export async function runDailyChecks(orgId: string): Promise<string[]> {
  const warnings: string[] = [];

  const trialBalance = await validateTrialBalance(orgId);
  if (!trialBalance.isBalanced) {
    warnings.push(
      `Saldenbilanz nicht ausgeglichen: Differenz ${trialBalance.difference.toFixed(2)} EUR`
    );
  }
  warnings.push(...trialBalance.warnings);

  const unbalancedResult = await db.execute(sql`
    SELECT
      je.id,
      je.booking_number,
      je.description,
      je.entry_date,
      COALESCE(SUM(jel.debit), 0) AS total_debit,
      COALESCE(SUM(jel.credit), 0) AS total_credit
    FROM journal_entries je
    JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
    WHERE je.organization_id = ${orgId}
    GROUP BY je.id, je.booking_number, je.description, je.entry_date
    HAVING ABS(COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)) >= 0.005
    ORDER BY je.entry_date DESC
    LIMIT 50
  `);

  const unbalancedRows: any[] = unbalancedResult.rows || unbalancedResult;
  for (const row of unbalancedRows) {
    const diff = fromCents(toCents(String(row.total_debit || 0)) - toCents(String(row.total_credit || 0)));
    warnings.push(
      `Unausgeglichene Buchung ${row.booking_number} (${row.entry_date}): Soll ${Number(row.total_debit).toFixed(2)} / Haben ${Number(row.total_credit).toFixed(2)}, Differenz ${diff.toFixed(2)}`
    );
  }

  const negativeAssets = await db.execute(sql`
    SELECT
      coa.account_number,
      coa.name,
      COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0) AS balance
    FROM chart_of_accounts coa
    JOIN journal_entry_lines jel ON jel.account_id = coa.id
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.organization_id = ${orgId}
      AND coa.account_type = 'asset'
    GROUP BY coa.id, coa.account_number, coa.name
    HAVING COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0) <= -0.005
  `);

  const negRows: any[] = negativeAssets.rows || negativeAssets;
  for (const row of negRows) {
    warnings.push(
      `Negativer Saldo auf Aktivkonto ${row.account_number} (${row.name}): ${Number(row.balance).toFixed(2)} EUR`
    );
  }

  return warnings;
}
