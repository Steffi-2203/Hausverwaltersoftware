import { rootDb as db } from "../db"; // direkt aufgerufene Service-Fns brauchen keinen RLS-Proxy
import { eq, and, inArray, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { roundMoney } from "@shared/utils";
import { toCents, fromCents, distributeCents, sumCents } from "../lib/money";

interface OwnerSettlementResult {
  ownerId: string;
  ownerName: string;
  unitId: string;
  unitTop: string;
  meaShare: number;
  meaRatio: number;
  nutzwert: number | null;
  nutzwertRatio: number | null;
  categories: CategoryAllocation[];
  totalSoll: number;       // laufende Aufwände + Sonderumlagen
  totalIst: number;
  saldo: number;
  ruecklageAnteil: number;
  sonderumlagen: number;   // Einzelposten für Anzeige
  warnings: string[];
}

interface CategoryAllocation {
  category: string;
  label: string;
  totalCost: number;
  ownerShare: number;
  allocationKey: string;
}

interface WegSettlementSummary {
  propertyId: string;
  propertyName: string;
  year: number;
  totalExpenses: number;
  totalPrepayments: number;
  totalDifference: number;
  ownerCount: number;
  totalMea: number;
  reserveFundBalance: number;
}

/**
 * Verteilt einen Euro-Betrag anteilig nach Ratios — cent-exakt via Hare/Niemeyer.
 *
 * Frühere Implementierung: Restcent wurde dem Eigentümer mit dem größten Anteil
 * zugewiesen (nicht nachvollziehbar). Neue Implementierung: Hare/Niemeyer-Verfahren
 * (größter Dezimalrest bekommt den Restcent). Die Summe der Anteile ist IMMER
 * exakt gleich totalAmount — kein Cent verloren oder doppelt vergeben.
 */
export function distributeWithRemainder(
  totalAmount: number,
  shares: { id: string; ratio: number }[]
): { id: string; amount: number }[] {
  if (shares.length === 0) return [];

  // Intern in Integer-Cents rechnen, um Float-Drift zu vermeiden.
  // distributeCents implementiert Hare/Niemeyer (größter Rest bekommt Restcent).
  const totalCents = toCents(totalAmount);
  const weights = shares.map((s) => s.ratio);
  const distributedCents = distributeCents(totalCents, weights);

  return shares.map((s, i) => ({
    id: s.id,
    amount: fromCents(distributedCents[i] ?? 0),
  }));
}

export async function getReserveFundBalance(
  propertyId: string,
  orgId: string
): Promise<number> {
  const entries = await db
    .select()
    .from(schema.wegReserveFund)
    .where(
      and(
        eq(schema.wegReserveFund.propertyId, propertyId),
        eq(schema.wegReserveFund.organizationId, orgId)
      )
    );

  // Cent-Integer-Summe: DB-Decimal-Strings exakt addieren, kein Float-Drift
  const balanceCents = sumCents(entries.map((e) => toCents(e.amount ?? "0")));
  return fromCents(balanceCents);
}

/**
 * PUNKT 2 FIX: Tatsächlich bezahlten Betrag bei Teilzahlungen verwenden.
 *
 * - status 'bezahlt':     → gesamtbetrag (vollständig bezahlt)
 * - status 'teilbezahlt': → paidAmount wenn gesetzt, sonst 0
 *   (paidAmount muss beim Erfassen einer Teilzahlung gesetzt werden)
 */
export async function getOwnerPrepayments(
  ownerId: string,
  unitId: string,
  year: number
): Promise<number> {
  const vorschreibungen = await db
    .select()
    .from(schema.wegVorschreibungen)
    .where(
      and(
        eq(schema.wegVorschreibungen.ownerId, ownerId),
        eq(schema.wegVorschreibungen.unitId, unitId),
        eq(schema.wegVorschreibungen.year, year)
      )
    );

  // Cent-Integer-Summe (Teilzahlungs-/Restbetragslogik dezimalsicher)
  const totalCents = sumCents(
    vorschreibungen
      .filter((v) => v.status === "bezahlt" || v.status === "teilbezahlt")
      .map((v) => {
        if (v.status === "bezahlt") return toCents(v.gesamtbetrag ?? "0");
        // teilbezahlt: paidAmount ist der tatsächlich eingegangene Betrag.
        // Wenn nicht gesetzt, wird 0 angerechnet (sicherer als gesamtbetrag).
        return v.paidAmount != null ? toCents(v.paidAmount) : 0;
      })
  );

  return fromCents(totalCents);
}

export async function calculateOwnerSettlement(
  propertyId: string,
  year: number,
  orgId: string
): Promise<{
  ownerResults: OwnerSettlementResult[];
  summary: WegSettlementSummary;
}> {
  const propertyExpenses = await db
    .select()
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.propertyId, propertyId),
        eq(schema.expenses.year, year),
        eq(schema.expenses.istUmlagefaehig, true)
      )
    );

  const unitOwners = await db
    .select()
    .from(schema.wegUnitOwners)
    .where(
      and(
        eq(schema.wegUnitOwners.propertyId, propertyId),
        eq(schema.wegUnitOwners.organizationId, orgId)
      )
    );

  if (unitOwners.length === 0) {
    throw new Error("Keine Eigentümer für diese Liegenschaft hinterlegt");
  }

  const totalMea = unitOwners.reduce(
    (s, uo) => s + (Number(uo.meaShare) || 0),
    0
  );
  if (totalMea <= 0) {
    throw new Error("Gesamt-MEA ist 0, bitte Anteile pflegen");
  }

  // PUNKT 1: Nutzwert-Gesamtsumme für Verhältnis-Berechnung
  const totalNutzwert = unitOwners.reduce(
    (s, uo) => s + (Number(uo.nutzwert) || 0),
    0
  );

  const unitIds = [...new Set(unitOwners.map((uo) => uo.unitId))];
  const unitsData =
    unitIds.length > 0
      ? await db
          .select()
          .from(schema.units)
          .where(inArray(schema.units.id, unitIds))
      : [];

  const ownerIds = [...new Set(unitOwners.map((uo) => uo.ownerId))];
  const ownersData =
    ownerIds.length > 0
      ? await db
          .select()
          .from(schema.owners)
          .where(inArray(schema.owners.id, ownerIds))
      : [];

  const budgetLines = await db
    .select()
    .from(schema.wegBudgetLines)
    .innerJoin(
      schema.wegBudgetPlans,
      eq(schema.wegBudgetLines.budgetPlanId, schema.wegBudgetPlans.id)
    )
    .where(
      and(
        eq(schema.wegBudgetPlans.propertyId, propertyId),
        eq(schema.wegBudgetPlans.year, year),
        eq(schema.wegBudgetPlans.organizationId, orgId)
      )
    );

  const allocationKeyMap = new Map<string, string>();
  // Kategorien mit mindestens einer Zeile OHNE expliziten Schlüssel bzw. mit
  // mehreren unterschiedlichen expliziten Schlüsseln — beides darf nicht
  // stillschweigend durchgehen (Task #83).
  const nullKeyCategories = new Set<string>();
  const conflictingKeyCategories = new Set<string>();
  for (const bl of budgetLines) {
    const cat = (bl.weg_budget_lines.category || "").toLowerCase();
    const key = bl.weg_budget_lines.allocationKey;
    // Nur explizit gesetzte Schlüssel zählen als "konfiguriert".
    // Eine Zeile mit NULL-Key darf NICHT still als 'mea' gelten — sonst
    // verschwindet die Warnung, obwohl der Verwalter nie einen Schlüssel
    // beschlossen hat.
    if (key) {
      const existing = allocationKeyMap.get(cat);
      if (existing && existing !== key) conflictingKeyCategories.add(cat);
      allocationKeyMap.set(cat, key);
    } else {
      nullKeyCategories.add(cat);
    }
  }

  // Kategorie-Subtotale in Integer-Cents akkumulieren (kein Float-Drift bis
  // zur Verteilung; Umrechnung nach Euro erst an der Ausgabegrenze).
  const expensesByCategory = new Map<
    string,
    { totalCostCents: number; label: string }
  >();
  let totalExpensesCents = 0;

  for (const expense of propertyExpenses) {
    const amountCents = toCents(expense.betrag ?? "0");
    totalExpensesCents += amountCents;
    const category =
      expense.expenseType || expense.mrgKategorie || expense.category || "sonstiges";
    const existing = expensesByCategory.get(category);
    if (existing) {
      existing.totalCostCents += amountCents;
    } else {
      expensesByCategory.set(category, { totalCostCents: amountCents, label: category });
    }
  }
  const totalExpenses = fromCents(totalExpensesCents);

  const totalNutzflaeche = unitsData.reduce(
    (s, u) => s + (Number(u.flaeche) || 0),
    0
  );
  const totalUnits = unitOwners.length;

  const ownerMap = new Map<
    string,
    {
      ownerId: string;
      unitId: string;
      meaShare: number;
      nutzwert: number | null;
      categories: CategoryAllocation[];
      totalSollCents: number;
      ruecklageAnteilCents: number;
      warnings: string[];
    }
  >();

  for (const uo of unitOwners) {
    const key = `${uo.ownerId}_${uo.unitId}`;
    if (!ownerMap.has(key)) {
      ownerMap.set(key, {
        ownerId: uo.ownerId,
        unitId: uo.unitId,
        meaShare: Number(uo.meaShare) || 0,
        nutzwert: uo.nutzwert != null ? Number(uo.nutzwert) : null,
        categories: [],
        totalSollCents: 0,
        ruecklageAnteilCents: 0,
        warnings: [],
      });
    }
  }

  for (const [category, { totalCostCents, label }] of expensesByCategory) {
    const catLower = category.toLowerCase();
    const configuredKey = allocationKeyMap.get(catLower);
    const allocKey = configuredKey || "mea";
    const addWarning = (w: string) => {
      for (const [, ownerData] of ownerMap) {
        if (!ownerData.warnings.includes(w)) ownerData.warnings.push(w);
      }
    };
    if (!configuredKey) {
      // Kein expliziter Verteilungsschlüssel im Wirtschaftsplan für diese Kategorie.
      // MEA wird als gesetzlicher Standard verwendet — klar im Ergebnis dokumentiert,
      // damit kein stiller Default unbemerkt einen rechtlich falschen Schlüssel anwendet.
      addWarning(
        `Kategorie '${category}': kein Verteilungsschlüssel konfiguriert → MEA-Anteil als Standard verwendet`
      );
    } else if (nullKeyCategories.has(catLower)) {
      // Mindestens EINE Budgetzeile dieser Kategorie hat keinen expliziten Schlüssel,
      // obwohl eine andere Zeile einen gesetzt hat — der gesetzte Schlüssel wird
      // angewendet, aber der Verwalter muss die unvollständige Konfiguration sehen.
      addWarning(
        `Kategorie '${category}': mindestens eine Budgetzeile ohne expliziten Verteilungsschlüssel → '${configuredKey}' aus einer anderen Zeile angewendet, bitte Schlüssel vervollständigen`
      );
    }
    if (conflictingKeyCategories.has(catLower)) {
      addWarning(
        `Kategorie '${category}': widersprüchliche Verteilungsschlüssel in mehreren Budgetzeilen → '${configuredKey}' angewendet, bitte vereinheitlichen`
      );
    }
    const roundedTotalCents = totalCostCents;

    let shares: { id: string; ratio: number }[] = [];

    if (allocKey === "nutzflaeche" && totalNutzflaeche > 0) {
      for (const [key, ownerData] of ownerMap) {
        const unit = unitsData.find((u) => u.id === ownerData.unitId);
        const unitArea = Number(unit?.flaeche) || 0;
        shares.push({ id: key, ratio: unitArea / totalNutzflaeche });
      }
    } else if (allocKey === "einheiten" && totalUnits > 0) {
      for (const [key] of ownerMap) {
        shares.push({ id: key, ratio: 1 / totalUnits });
      }
    } else if (allocKey === "nutzwert" && totalNutzwert > 0) {
      // PUNKT 1 NEU: Nutzwert-Schlüssel
      for (const [key, ownerData] of ownerMap) {
        if (ownerData.nutzwert != null && ownerData.nutzwert > 0) {
          shares.push({ id: key, ratio: ownerData.nutzwert / totalNutzwert });
        } else {
          // Fallback auf MEA, Warnung protokollieren
          const warning = `Kategorie '${category}': Nutzwert nicht gepflegt → Fallback auf MEA-Anteil`;
          if (!ownerData.warnings.includes(warning)) {
            ownerData.warnings.push(warning);
          }
          shares.push({ id: key, ratio: ownerData.meaShare / totalMea });
        }
      }
    } else {
      // Standard: MEA — falls allocationKey 'mea' oder unbekannt
      for (const [key, ownerData] of ownerMap) {
        shares.push({ id: key, ratio: ownerData.meaShare / totalMea });
      }
    }

    // Verteilung direkt in Cents (Hare/Niemeyer): Summe der Anteile ist exakt
    // gleich dem Kategorie-Total, kein Cent verloren oder doppelt vergeben.
    const distributedCents = distributeCents(roundedTotalCents, shares.map((sh) => sh.ratio));

    for (let i = 0; i < shares.length; i++) {
      const dist = { id: shares[i]!.id, amountCents: distributedCents[i] ?? 0 };
      const ownerData = ownerMap.get(dist.id);
      if (!ownerData) continue;

      const allocationLabel =
        allocKey === "nutzflaeche"
          ? "Nutzfläche"
          : allocKey === "einheiten"
            ? "Einheiten"
            : allocKey === "nutzwert"
              ? "Nutzwert"
              : "MEA";

      ownerData.categories.push({
        category,
        label,
        totalCost: fromCents(roundedTotalCents),
        ownerShare: fromCents(dist.amountCents),
        allocationKey: allocationLabel,
      });
      ownerData.totalSollCents += dist.amountCents;

      const isReserve =
        catLower.includes("rücklage") ||
        catLower.includes("ruecklage") ||
        catLower.includes("rucklage");
      if (isReserve) {
        ownerData.ruecklageAnteilCents += dist.amountCents;
      }
    }
  }

  // PUNKT 3: Sonderumlagen berechnen
  const specialAssessments = await db
    .select()
    .from(schema.wegSpecialAssessments)
    .where(
      and(
        eq(schema.wegSpecialAssessments.propertyId, propertyId),
        eq(schema.wegSpecialAssessments.organizationId, orgId)
      )
    );

  const yearAssessments = specialAssessments.filter(
    (sa) =>
      sa.createdAt &&
      new Date(sa.createdAt).getFullYear() === year &&
      sa.status === "beschlossen"
  );

  // Sonderumlagen ebenfalls durchgehend in Integer-Cents
  const sonderumlagenCentsByOwner = new Map<string, number>();
  for (const sa of yearAssessments) {
    const saAmountCents = toCents(sa.totalAmount ?? "0");
    const shares: { id: string; ratio: number }[] = [];
    for (const [key, ownerData] of ownerMap) {
      shares.push({ id: key, ratio: ownerData.meaShare / totalMea });
    }
    const distributedCents = distributeCents(saAmountCents, shares.map((sh) => sh.ratio));
    for (let i = 0; i < shares.length; i++) {
      const current = sonderumlagenCentsByOwner.get(shares[i]!.id) || 0;
      sonderumlagenCentsByOwner.set(shares[i]!.id, current + (distributedCents[i] ?? 0));
    }
  }

  const [property] = await db
    .select()
    .from(schema.properties)
    .where(eq(schema.properties.id, propertyId))
    .limit(1);

  const reserveFundBalance = await getReserveFundBalance(propertyId, orgId);

  const ownerResults: OwnerSettlementResult[] = [];

  for (const [key, ownerData] of ownerMap) {
    const owner = ownersData.find((o) => o.id === ownerData.ownerId);
    const unit = unitsData.find((u) => u.id === ownerData.unitId);

    const prepayments = await getOwnerPrepayments(
      ownerData.ownerId,
      ownerData.unitId,
      year
    );

    // Alles in Cents: laufendes Soll + Sonderumlagen − Ist (Vorschreibungen)
    const laufendeSollCents = ownerData.totalSollCents;
    const sonderumlagenCents = sonderumlagenCentsByOwner.get(key) || 0;
    const prepaymentsCents = toCents(prepayments);

    // PUNKT 3 FIX: Sonderumlagen fließen in totalSoll und saldo ein
    const totalSollCents = laufendeSollCents + sonderumlagenCents;
    const saldoCents = totalSollCents - prepaymentsCents;
    const sonderumlagen = fromCents(sonderumlagenCents);
    const totalSoll = fromCents(totalSollCents);
    const saldo = fromCents(saldoCents);

    // Nutzwert-Verhältnis für Ausgabe
    const nutzwertRatio =
      ownerData.nutzwert != null && totalNutzwert > 0
        ? ownerData.nutzwert / totalNutzwert
        : null;

    ownerResults.push({
      ownerId: ownerData.ownerId,
      ownerName: owner
        ? `${owner.firstName} ${owner.lastName}`
        : "Unbekannt",
      unitId: ownerData.unitId,
      unitTop: unit?.topNummer || "?",
      meaShare: ownerData.meaShare,
      meaRatio: ownerData.meaShare / totalMea,
      nutzwert: ownerData.nutzwert,
      nutzwertRatio,
      categories: ownerData.categories,
      totalSoll,
      totalIst: prepayments,
      saldo,
      ruecklageAnteil: fromCents(ownerData.ruecklageAnteilCents),
      sonderumlagen,
      warnings: ownerData.warnings,
    });
  }

  // Summen dezimalsicher in Cents bilden (Werte sind exakte 2-Dezimal-Euros)
  const totalPrepayments = fromCents(
    sumCents(ownerResults.map((r) => toCents(r.totalIst)))
  );
  const totalDifference = fromCents(
    sumCents(ownerResults.map((r) => toCents(r.saldo)))
  );

  return {
    ownerResults,
    summary: {
      propertyId,
      propertyName: property?.name || "",
      year,
      totalExpenses,
      totalPrepayments,
      totalDifference,
      ownerCount: ownerResults.length,
      totalMea,
      reserveFundBalance,
    },
  };
}

export async function createWegSettlement(
  propertyId: string,
  year: number,
  orgId: string,
  createdBy: string
): Promise<{
  settlement: typeof schema.wegSettlements.$inferSelect;
  ownerResults: OwnerSettlementResult[];
  summary: WegSettlementSummary;
}> {
  const { ownerResults, summary } = await calculateOwnerSettlement(
    propertyId,
    year,
    orgId
  );

  const [settlement] = await db.transaction(async (tx) => {
    const [newSettlement] = await tx
      .insert(schema.wegSettlements)
      .values({
        organizationId: orgId,
        propertyId,
        year,
        totalExpenses: summary.totalExpenses.toString(),
        totalPrepayments: summary.totalPrepayments.toString(),
        totalDifference: summary.totalDifference.toString(),
        ownerCount: summary.ownerCount,
        totalMea: summary.totalMea.toString(),
        reserveFundBalance: summary.reserveFundBalance.toString(),
        status: "berechnet",
        createdBy,
      })
      .returning();

    for (const result of ownerResults) {
      await tx.insert(schema.wegSettlementDetails).values({
        settlementId: newSettlement!.id,
        ownerId: result.ownerId,
        unitId: result.unitId,
        meaShare: result.meaShare.toString(),
        meaRatio: result.meaRatio.toString(),
        totalSoll: result.totalSoll.toString(),
        totalIst: result.totalIst.toString(),
        saldo: result.saldo.toString(),
        ruecklageAnteil: result.ruecklageAnteil.toString(),
        sonderumlagen: result.sonderumlagen.toString(),
        categoryDetails: result.categories,
      });
    }

    return [newSettlement];
  });

  return { settlement: settlement!, ownerResults, summary };
}
