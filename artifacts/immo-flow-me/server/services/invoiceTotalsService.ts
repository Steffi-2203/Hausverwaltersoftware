import { and, inArray } from "drizzle-orm";
import { db } from "../db";
import { invoiceLines } from "@shared/schema";
import { roundMoney } from "@shared/utils";

export const DUNNING_LINE_TYPES = ['mahnstufe_fee', 'verzugszinsen'] as const;

/**
 * The invoice header amount is immutable. Dunning charges are append-only
 * ledger entries, so all receivables views and payment paths must add them to
 * the header amount rather than attempting to update monthly_invoices.
 */
export async function getDunningChargesByInvoice(
  invoiceIds: string[],
  database: any = db,
): Promise<Map<string, number>> {
  if (invoiceIds.length === 0) return new Map();

  const lines = await database.select({
    invoiceId: invoiceLines.invoiceId,
    amount: invoiceLines.amount,
  })
    .from(invoiceLines)
    .where(and(
      inArray(invoiceLines.invoiceId, invoiceIds),
      inArray(invoiceLines.lineType, [...DUNNING_LINE_TYPES]),
    ));

  const totals = new Map<string, number>();
  for (const line of lines) {
    totals.set(
      line.invoiceId,
      roundMoney((totals.get(line.invoiceId) || 0) + Number(line.amount)),
    );
  }
  return totals;
}

export function getEffectiveInvoiceTotal(headerAmount: unknown, dunningCharges = 0): number {
  return roundMoney(Number(headerAmount || 0) + dunningCharges);
}

export function getOutstandingInvoiceAmount(
  headerAmount: unknown,
  paidAmount: unknown,
  dunningCharges = 0,
): number {
  return roundMoney(Math.max(
    0,
    getEffectiveInvoiceTotal(headerAmount, dunningCharges) - Number(paidAmount || 0),
  ));
}
