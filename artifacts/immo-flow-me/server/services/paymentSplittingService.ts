import { db } from "../db";
import { eq, and, sql, asc } from "drizzle-orm";
import * as schema from "@shared/schema";
import { roundMoney } from "@shared/utils";
import { toCents, fromCents, roundHalfAwayFromZero } from "../lib/money";

interface ComponentAllocation {
  miete: number;
  bk: number;
  hk: number;
  wk: number;
  ust: number;
}

interface InvoiceAllocation {
  invoiceId: string;
  allocatedAmount: number;
  components: ComponentAllocation;
  remaining: number;
  status: string;
}

interface SplitResult {
  allocations: InvoiceAllocation[];
  totalAllocated: number;
  remainingAmount: number;
}

interface AutoMatchResult {
  matched: Array<{ paymentId: string; invoiceId: string; amount: number; reason: string }>;
  unmatched: string[];
  suggestions: Array<{
    paymentId: string;
    invoiceId: string;
    amount: number;
    confidence: number;
    reason: string;
  }>;
}

export async function splitPaymentByPriority(
  paymentAmount: number,
  tenantId: string,
  orgId: string
): Promise<SplitResult> {
  // Intern in Integer-Cents rechnen — Float-Akkumulation in der Prioritätsschleife vermieden
  let remainingCents = toCents(paymentAmount);
  const allocations: InvoiceAllocation[] = [];

  const invoices = await db.execute(sql`
    SELECT mi.*
    FROM monthly_invoices mi
    JOIN units u ON u.id = mi.unit_id
    JOIN properties p ON p.id = u.property_id
    WHERE mi.tenant_id = ${tenantId}
      AND mi.status IN ('offen', 'teilbezahlt', 'ueberfaellig')
      AND p.organization_id = ${orgId}
      AND mi.is_vacancy = false
    ORDER BY mi.faellig_am ASC NULLS LAST, mi.year ASC, mi.month ASC
  `);

  const invoiceRows: any[] = invoices.rows || invoices;

  for (const inv of invoiceRows) {
    if (remainingCents <= 0) break;

    const existingAllocations = await db.execute(sql`
      SELECT COALESCE(SUM(applied_amount::numeric), 0) AS already_paid
      FROM payment_allocations
      WHERE invoice_id = ${inv.id}
    `);
    const alreadyPaidCents = toCents(String(((existingAllocations.rows || existingAllocations)[0] as any).already_paid || 0));

    const grundmieteCents = toCents(inv.grundmiete || 0);
    const bkCents = toCents(inv.betriebskosten || 0);
    const hkCents = toCents(inv.heizungskosten || 0);
    const wkCents = toCents(inv.wasserkosten || 0);
    const ustCents = toCents(inv.ust || 0);
    const totalCents = toCents(inv.gesamtbetrag || 0);
    const invoiceDueCents = Math.max(0, totalCents - alreadyPaidCents);

    if (invoiceDueCents <= 0) continue;

    const nettoTotalCents = grundmieteCents + bkCents + hkCents + wkCents;
    // USt- und Proporz-Berechnungen mit Integer-Zähler/Nenner statt vorberechneter Float-Quote:
    // round(a * b / c) statt round(a * (b/c)) — vermeidet Verlust durch Zwischenrundung.
    const denominatorCents = nettoTotalCents + ustCents; // Netto + USt = Bruttobasis

    // Komponenten intern in Cents
    const componentsCents = { miete: 0, bk: 0, hk: 0, wk: 0, ust: 0 };
    let invoiceAllocatedCents = 0;

    const priorityItems: Array<{ key: keyof Omit<ComponentAllocation, 'ust'>; amountCents: number }> = [
      { key: "miete", amountCents: grundmieteCents },
      { key: "bk", amountCents: bkCents },
      { key: "hk", amountCents: hkCents },
      { key: "wk", amountCents: wkCents },
    ];

    // Unbezahlter Anteil als Integer-Zähler/Nenner: (totalCents - alreadyPaidCents) / totalCents
    const unpaidNumerator = totalCents - alreadyPaidCents;

    for (const item of priorityItems) {
      if (remainingCents <= 0) break;

      // Komponenten-Anteil proportional zum noch offenen Rechnungsteil
      const componentDueCents = totalCents > 0
        ? roundHalfAwayFromZero(item.amountCents * unpaidNumerator / totalCents)
        : 0;
      if (componentDueCents <= 0) continue;

      // USt auf diese Komponente: componentDue * ust / netto  (ganzzahlig gerundet)
      const componentUstCents = nettoTotalCents > 0
        ? roundHalfAwayFromZero(componentDueCents * ustCents / nettoTotalCents)
        : 0;
      const componentTotalCents = componentDueCents + componentUstCents;
      const applyCents = Math.min(remainingCents, componentTotalCents);

      // Netto-Anteil am angewandten Betrag: apply * netto / (netto + ust), Rest = USt
      const netApplyCents = denominatorCents > 0
        ? roundHalfAwayFromZero(applyCents * nettoTotalCents / denominatorCents)
        : applyCents;
      const ustApplyCents = applyCents - netApplyCents;

      componentsCents[item.key] += netApplyCents;
      componentsCents.ust += ustApplyCents;
      invoiceAllocatedCents += applyCents;
      remainingCents -= applyCents;
    }

    if (invoiceAllocatedCents > 0) {
      const newTotalPaidCents = alreadyPaidCents + invoiceAllocatedCents;
      const newTotalPaid = fromCents(newTotalPaidCents);
      const newStatus = newTotalPaidCents >= totalCents ? "bezahlt" : "teilbezahlt";

      await db.execute(sql`
        UPDATE monthly_invoices
        SET status = ${newStatus},
            paid_amount = ${newTotalPaid},
            updated_at = NOW()
        WHERE id = ${inv.id}
      `);

      allocations.push({
        invoiceId: inv.id,
        allocatedAmount: fromCents(invoiceAllocatedCents),
        components: {
          miete: fromCents(componentsCents.miete),
          bk: fromCents(componentsCents.bk),
          hk: fromCents(componentsCents.hk),
          wk: fromCents(componentsCents.wk),
          ust: fromCents(componentsCents.ust),
        },
        remaining: fromCents(Math.max(0, totalCents - newTotalPaidCents)),
        status: newStatus,
      });
    }
  }

  const paymentAmountCents = toCents(paymentAmount);
  return {
    allocations,
    totalAllocated: fromCents(paymentAmountCents - remainingCents),
    remainingAmount: fromCents(remainingCents),
  };
}

export async function allocatePaymentToInvoice(
  paymentId: string,
  invoiceId: string,
  amount: number,
  orgId?: string
): Promise<any> {
  // Intern in Cents — kein Float-Subtraktions-Drift bei Aggregat-Vergleich
  const amountCents = toCents(amount);
  const dbAmount = fromCents(amountCents); // kanonischer 2-Dezimal-String für die DB

  // Audit-Befund K2: Zugriffsprüfung ist Pflicht, nicht optional
  if (!orgId) {
    throw new Error("Kein Organisationskontext — Zuordnung abgelehnt");
  }
  {
    const paymentCheck = await db.execute(sql`
      SELECT p.id FROM payments p
      JOIN tenants t ON t.id = p.tenant_id
      JOIN units u ON u.id = t.unit_id
      JOIN properties pr ON pr.id = u.property_id
      WHERE p.id = ${paymentId} AND pr.organization_id = ${orgId}
    `);
    if (!(paymentCheck.rows || paymentCheck).length) {
      throw new Error("Zahlung nicht gefunden oder kein Zugriff");
    }

    const invoiceCheck = await db.execute(sql`
      SELECT mi.id FROM monthly_invoices mi
      JOIN units u ON u.id = mi.unit_id
      JOIN properties pr ON pr.id = u.property_id
      WHERE mi.id = ${invoiceId} AND pr.organization_id = ${orgId}
    `);
    if (!(invoiceCheck.rows || invoiceCheck).length) {
      throw new Error("Rechnung nicht gefunden oder kein Zugriff");
    }
  }

  const [allocation] = await db
    .insert(schema.paymentAllocations)
    .values({
      paymentId,
      invoiceId,
      appliedAmount: String(dbAmount),
      allocationType: "miete",
    })
    .returning();

  // Aggregat-Summe aus der DB in Cents — kein Float-Vergleich mit roundMoney
  const totalAllocResult = await db.execute(sql`
    SELECT COALESCE(SUM(applied_amount::numeric), 0) AS total_allocated
    FROM payment_allocations
    WHERE invoice_id = ${invoiceId}
  `);

  const totalAllocatedCents = toCents(
    String(((totalAllocResult.rows || totalAllocResult)[0] as any).total_allocated || 0)
  );

  const [invoice] = await db
    .select()
    .from(schema.monthlyInvoices)
    .where(eq(schema.monthlyInvoices.id, invoiceId))
    .limit(1);

  if (invoice) {
    const totalCents = toCents(invoice.gesamtbetrag || 0);
    const newStatus = totalAllocatedCents >= totalCents
      ? "bezahlt"
      : totalAllocatedCents > 0
      ? "teilbezahlt"
      : "offen";

    await db.execute(sql`
      UPDATE monthly_invoices
      SET status = ${newStatus},
          paid_amount = ${fromCents(totalAllocatedCents)},
          updated_at = NOW()
      WHERE id = ${invoiceId}
    `);
  }

  return allocation;
}

export async function getUnallocatedPayments(
  orgId: string,
  tenantId?: string
): Promise<any[]> {
  let tenantFilter = sql``;
  if (tenantId) {
    tenantFilter = sql`AND p.tenant_id = ${tenantId}`;
  }

  const result = await db.execute(sql`
    SELECT
      p.*,
      t.first_name AS tenant_first_name,
      t.last_name AS tenant_last_name,
      COALESCE(pa.allocated_total, 0) AS allocated_total,
      p.betrag::numeric - COALESCE(pa.allocated_total, 0) AS unallocated_amount
    FROM payments p
    JOIN tenants t ON t.id = p.tenant_id
    JOIN units u ON u.id = t.unit_id
    JOIN properties prop ON prop.id = u.property_id
    LEFT JOIN (
      SELECT payment_id, SUM(applied_amount::numeric) AS allocated_total
      FROM payment_allocations
      GROUP BY payment_id
    ) pa ON pa.payment_id = p.id
    WHERE prop.organization_id = ${orgId}
      AND (pa.allocated_total IS NULL OR pa.allocated_total < p.betrag::numeric)
      ${tenantFilter}
    ORDER BY p.buchungs_datum DESC
  `);

  return result.rows || result;
}

export async function autoMatchPayments(orgId: string): Promise<AutoMatchResult> {
  const matched: AutoMatchResult["matched"] = [];
  const unmatched: string[] = [];
  const suggestions: AutoMatchResult["suggestions"] = [];

  const unallocated = await getUnallocatedPayments(orgId);

  for (const payment of unallocated) {
    // Alle Geldwerte intern als Integer-Cents — kein roundMoney/float-Subtraktions-Drift
    const paymentCents = toCents(payment.betrag || 0);
    const allocatedTotalCents = toCents(payment.allocated_total || 0);
    const unallocatedCents = paymentCents - allocatedTotalCents;

    if (unallocatedCents <= 0) continue;

    const openInvoicesResult = await db.execute(sql`
      SELECT mi.*, COALESCE(pa_sum.allocated, 0) AS already_allocated
      FROM monthly_invoices mi
      LEFT JOIN (
        SELECT invoice_id, SUM(applied_amount::numeric) AS allocated
        FROM payment_allocations
        GROUP BY invoice_id
      ) pa_sum ON pa_sum.invoice_id = mi.id
      WHERE mi.tenant_id = ${payment.tenant_id}
        AND mi.status IN ('offen', 'teilbezahlt', 'ueberfaellig')
        AND mi.is_vacancy = false
      ORDER BY mi.year ASC, mi.month ASC
    `);

    const openInvoices: any[] = openInvoicesResult.rows || openInvoicesResult;

    let didMatch = false;

    for (const inv of openInvoices) {
      const invTotalCents = toCents(inv.gesamtbetrag || 0);
      const invAllocatedCents = toCents(inv.already_allocated || 0);
      const invDueCents = invTotalCents - invAllocatedCents;

      if (invDueCents <= 0) continue;

      // Exakter Cent-Vergleich (< 1 Cent Toleranz)
      if (Math.abs(unallocatedCents - invDueCents) < 1) {
        await allocatePaymentToInvoice(payment.id, inv.id, fromCents(unallocatedCents), orgId);
        matched.push({
          paymentId: payment.id,
          invoiceId: inv.id,
          amount: fromCents(unallocatedCents),
          reason: "Exakte Betragsübereinstimmung",
        });
        didMatch = true;
        break;
      }

      // Nahe-Übereinstimmung: weniger als 1 € (100 Cent) Differenz
      if (Math.abs(unallocatedCents - invDueCents) < 100) {
        suggestions.push({
          paymentId: payment.id,
          invoiceId: inv.id,
          amount: fromCents(invDueCents),
          confidence: 80,
          reason: `Betrag fast identisch (Differenz: ${fromCents(Math.abs(unallocatedCents - invDueCents)).toFixed(2)} EUR)`,
        });
      }
    }

    if (!didMatch && suggestions.filter((s) => s.paymentId === payment.id).length === 0) {
      // Cent-Summe über alle offenen Rechnungen
      let totalDueCents = 0;
      for (const inv of openInvoices) {
        totalDueCents += toCents(inv.gesamtbetrag || 0) - toCents(inv.already_allocated || 0);
      }

      if (totalDueCents > 0 && Math.abs(unallocatedCents - totalDueCents) < 1) {
        for (const inv of openInvoices) {
          const invDueCents = toCents(inv.gesamtbetrag || 0) - toCents(inv.already_allocated || 0);
          if (invDueCents > 0) {
            await allocatePaymentToInvoice(payment.id, inv.id, fromCents(invDueCents), orgId);
            matched.push({
              paymentId: payment.id,
              invoiceId: inv.id,
              amount: fromCents(invDueCents),
              reason: "Summe aller offenen Rechnungen stimmt überein",
            });
          }
        }
        didMatch = true;
      }
    }

    if (!didMatch) {
      unmatched.push(payment.id);
    }
  }

  return { matched, unmatched, suggestions };
}
