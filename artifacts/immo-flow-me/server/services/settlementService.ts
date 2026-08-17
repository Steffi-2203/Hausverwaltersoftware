import { db } from "../db";
import { 
  settlements, 
  settlementDetails,
  expenseAllocations,
  expenses,
  tenants,
  units,
  monthlyInvoices,
  distributionKeys,
  unitDistributionValues
} from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { writeAudit } from "../lib/auditLog";
import { roundMoney } from "@shared/utils";
import { toCents, fromCents, sumCents, distributeCents, type Cents } from "../lib/money";

interface TenantSettlementResult {
  tenantId: string;
  tenantName: string;
  unitId: string;
  unitName: string;
  anteil: number;
  sollBetrag: number;
  istBetrag: number;
  differenz: number;
  details: SettlementDetailItem[];
}

interface SettlementDetailItem {
  category: string;
  description: string;
  totalCost: number;
  tenantShare: number;
  distributionKey: string;
}

interface AllocationPlan {
  /** unitId -> Kategorie -> Anteil in Cents */
  perUnit: Map<string, Map<string, Cents>>;
  categoryTotals: Map<string, Cents>;
  categoryKeyName: Map<string, string>;
}

interface CreateSettlementParams {
  propertyId: string;
  year: number;
  organizationId: string;
  createdBy: string;
}

interface SettlementSummary {
  propertyId: string;
  year: number;
  totalExpenses: number;
  totalPrepayments: number;
  totalDifference: number;
  tenantCount: number;
  unitCount: number;
}

export class SettlementService {
  async calculatePropertyExpenses(propertyId: string, year: number): Promise<{
    totalExpenses: number;
    totalCents: Cents;
    byCategory: Map<string, number>;
    byCategoryCents: Map<string, Cents>;
    byDistributionKey: Map<string, { amount: number; keyId: string | null }[]>;
    expenses: Array<typeof expenses.$inferSelect>;
  }> {
    const propertyExpenses = await db.select()
      .from(expenses)
      .where(and(
        eq(expenses.propertyId, propertyId),
        eq(expenses.year, year),
        eq(expenses.istUmlagefaehig, true)
      ));

    // Audit-Befund K4: Summen wurden in Float-Euro gebildet; über hunderte
    // Belege entstanden Cent-Abweichungen zur Belegsumme. Jetzt Integer-Cents.
    const byCategory = new Map<string, number>();
    const byCategoryCents = new Map<string, Cents>();
    const byDistributionKey = new Map<string, { amount: number; keyId: string | null }[]>();
    let totalCents: Cents = 0;

    for (const expense of propertyExpenses) {
      const cents = toCents(expense.betrag ?? 0);
      const amount = fromCents(cents);
      totalCents += cents;

      const category = expense.mrgKategorie || expense.category || 'sonstige';
      byCategoryCents.set(category, (byCategoryCents.get(category) || 0) + cents);
      byCategory.set(category, fromCents(byCategoryCents.get(category)!));

      const keyId = expense.distributionKeyId || null;
      if (!byDistributionKey.has(category)) {
        byDistributionKey.set(category, []);
      }
      byDistributionKey.get(category)!.push({ amount, keyId });
    }

    return {
      totalExpenses: fromCents(totalCents),
      totalCents,
      byCategory,
      byCategoryCents,
      byDistributionKey,
      expenses: propertyExpenses
    };
  }

  async getTenantPrepayments(tenantId: string, year: number): Promise<number> {
    const yearInvoices = await db.select()
      .from(monthlyInvoices)
      .where(and(
        eq(monthlyInvoices.tenantId, tenantId),
        eq(monthlyInvoices.year, year)
      ));

    // Audit-Befund K4: Vorschreibungsanteile jetzt cent-exakt.
    let totalCents: Cents = 0;
    for (const inv of yearInvoices) {
      const bkPrescribedCents = toCents(inv.betriebskosten || 0) + toCents(inv.heizungskosten || 0);
      const invoiceTotalCents = toCents(inv.gesamtbetrag || 0);
      const paidCents = toCents(inv.paidAmount || 0);
      if (invoiceTotalCents <= 0) continue;
      const ratio = bkPrescribedCents / invoiceTotalCents;
      totalCents += Math.round(paidCents * ratio);
    }

    return fromCents(totalCents);
  }

  async getDistributionValue(
    unitId: string,
    keyId: string,
    propertyUnits: Array<typeof units.$inferSelect>
  ): Promise<{ unitValue: number; totalValue: number }> {
    const unitDistValues = await db.select()
      .from(unitDistributionValues)
      .where(eq(unitDistributionValues.keyId, keyId));

    const unitDistValue = unitDistValues.find(v => v.unitId === unitId);
    const unitValue = unitDistValue ? Number(unitDistValue.value) || 0 : 0;
    const totalValue = unitDistValues.reduce((sum, v) => sum + (Number(v.value) || 0), 0);

    if (totalValue === 0) {
      const unit = propertyUnits.find(u => u.id === unitId);
      const unitSize = Number(unit?.flaeche) || 1;
      const totalSize = propertyUnits.reduce((sum, u) => sum + (Number(u.flaeche) || 1), 0);
      return { unitValue: unitSize, totalValue: totalSize };
    }

    return { unitValue, totalValue };
  }

  /**
   * Audit-Befund K4 (kritisch): Jeder Mieteranteil wurde einzeln als Float
   * berechnet und gerundet. Die Summe der Mieteranteile wich dadurch von der
   * Belegsumme ab — bei einer MRG-Abrechnung ein Prüfungsmangel.
   *
   * Neu: Jeder Beleg wird EINMAL cent-exakt auf alle Einheiten verteilt
   * (Hare/Niemeyer, siehe distributeCents). Die Summe der Einheitenanteile
   * ergibt immer exakt den Belegbetrag, und damit die Summe aller Anteile
   * exakt die Gesamtausgaben.
   */
  async buildAllocationPlan(
    propertyId: string,
    year: number,
    propertyUnits: Array<typeof units.$inferSelect>,
    organizationId: string
  ): Promise<AllocationPlan> {
    const propertyExpenses = await db.select()
      .from(expenses)
      .where(and(
        eq(expenses.propertyId, propertyId),
        eq(expenses.year, year),
        eq(expenses.istUmlagefaehig, true)
      ));

    const allKeys = await db.select().from(distributionKeys)
      .where(eq(distributionKeys.isActive, true));
    const orgKeys = allKeys.filter(k => k.organizationId === organizationId || k.isSystem);
    const keyMap = new Map(allKeys.map(k => [k.id, k]));

    const allValues = await db.select().from(unitDistributionValues);
    const valuesByKey = new Map<string, Map<string, number>>();
    for (const v of allValues) {
      if (!valuesByKey.has(v.keyId)) valuesByKey.set(v.keyId, new Map());
      valuesByKey.get(v.keyId)!.set(v.unitId, Number(v.value) || 0);
    }

    const flaecheWeights = propertyUnits.map(u => Number(u.flaeche) || 1);

    const perUnit = new Map<string, Map<string, Cents>>();
    const categoryTotals = new Map<string, Cents>();
    const categoryKeyName = new Map<string, string>();
    for (const u of propertyUnits) perUnit.set(u.id, new Map());

    for (const expense of propertyExpenses) {
      const category = expense.mrgKategorie || expense.category || 'sonstige';
      const amountCents = toCents(expense.betrag ?? 0);
      categoryTotals.set(category, (categoryTotals.get(category) || 0) + amountCents);

      const key = (expense.distributionKeyId ? keyMap.get(expense.distributionKeyId) : null)
        || orgKeys.find(k => k.keyCode === category)
        || orgKeys.find(k => k.inputType === 'flaeche')
        || orgKeys[0];

      const keyValues = key ? valuesByKey.get(key.id) : undefined;
      let weights = flaecheWeights;
      if (keyValues) {
        const candidate = propertyUnits.map(u => keyValues.get(u.id) ?? 0);
        if (candidate.reduce((a, b) => a + b, 0) > 0) weights = candidate;
      }

      if (!categoryKeyName.has(category)) {
        categoryKeyName.set(category, key?.name || 'Fläche');
      }

      const shares = distributeCents(amountCents, weights);
      propertyUnits.forEach((u, i) => {
        const bucket = perUnit.get(u.id)!;
        bucket.set(category, (bucket.get(category) || 0) + shares[i]);
      });
    }

    return { perUnit, categoryTotals, categoryKeyName };
  }

  async calculateTenantSettlement(
    tenantId: string,
    propertyId: string,
    year: number,
    propertyUnits: Array<typeof units.$inferSelect>,
    plan: AllocationPlan
  ): Promise<TenantSettlementResult | null> {
    const tenant = await db.select().from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant.length) return null;

    const unit = propertyUnits.find(u => u.id === tenant[0].unitId);
    if (!unit) return null;

    const prepayments = await this.getTenantPrepayments(tenantId, year);
    const prepaymentCents = toCents(prepayments);

    const unitFlaeche = Number(unit.flaeche) || 1;
    const totalFlaeche = propertyUnits.reduce((sum, u) => sum + (Number(u.flaeche) || 1), 0);
    const anteil = totalFlaeche > 0 ? (unitFlaeche / totalFlaeche) : 0;

    const details: SettlementDetailItem[] = [];
    const unitShares = plan.perUnit.get(unit.id) ?? new Map<string, Cents>();
    let totalShareCents: Cents = 0;

    for (const [category, shareCents] of unitShares) {
      if (shareCents === 0) continue;
      totalShareCents += shareCents;
      details.push({
        category,
        description: `Anteil an ${category}`,
        totalCost: fromCents(plan.categoryTotals.get(category) || 0),
        tenantShare: fromCents(shareCents),
        distributionKey: plan.categoryKeyName.get(category) || 'Fläche',
      });
    }

    return {
      tenantId,
      tenantName: `${tenant[0].firstName} ${tenant[0].lastName}`,
      unitId: unit.id,
      unitName: unit.topNummer || `Einheit`,
      anteil: Math.round(anteil * 10000) / 10000,
      sollBetrag: fromCents(totalShareCents),
      istBetrag: fromCents(prepaymentCents),
      differenz: fromCents(prepaymentCents - totalShareCents),
      details
    };
  }

  async createSettlement(params: CreateSettlementParams): Promise<{
    settlement: typeof settlements.$inferSelect;
    tenantResults: TenantSettlementResult[];
    summary: SettlementSummary;
  }> {
    const { propertyId, year, organizationId, createdBy } = params;

    const { totalExpenses, byCategory, byDistributionKey } = 
      await this.calculatePropertyExpenses(propertyId, year);

    const propertyUnits = await db.select().from(units)
      .where(eq(units.propertyId, propertyId));

    const unitIds = propertyUnits.map(u => u.id);
    const propertyTenants = await db.select().from(tenants)
      .where(and(
        inArray(tenants.unitId, unitIds),
        eq(tenants.status, 'aktiv')
      ));

    const plan = await this.buildAllocationPlan(propertyId, year, propertyUnits, organizationId);

    const tenantResults: TenantSettlementResult[] = [];

    for (const tenant of propertyTenants) {
      const result = await this.calculateTenantSettlement(
        tenant.id,
        propertyId,
        year,
        propertyUnits,
        plan
      );
      if (result) {
        tenantResults.push(result);
      }
    }

    const totalPrepayments = fromCents(sumCents(tenantResults.map(r => toCents(r.istBetrag))));
    const totalDifference = fromCents(sumCents(tenantResults.map(r => toCents(r.differenz))));

    const { expenses: propertyExpenses } = await db.select()
      .from(expenses)
      .where(and(
        eq(expenses.propertyId, propertyId),
        eq(expenses.year, year),
        eq(expenses.istUmlagefaehig, true)
      ))
      .then(result => ({ expenses: result }));
    
    const [settlement] = await db.transaction(async (tx) => {
      const [newSettlement] = await tx.insert(settlements).values({
        propertyId,
        year,
        status: 'entwurf',
        gesamtausgaben: totalExpenses.toString(),
        gesamtvorschuss: totalPrepayments.toString(),
        differenz: totalDifference.toString(),
        berechnungsDatum: new Date(),
        createdBy,
      }).returning();

      for (const result of tenantResults) {
        const [detail] = await tx.insert(settlementDetails).values({
          settlementId: newSettlement.id,
          tenantId: result.tenantId,
          unitId: result.unitId,
          anteil: result.anteil.toString(),
          ausgabenAnteil: result.sollBetrag.toString(),
          vorschuss: result.istBetrag.toString(),
          differenz: result.differenz.toString(),
        }).returning();

        for (const d of result.details) {
          const matchingExpense = propertyExpenses.find(e => 
            (e.mrgKategorie || e.category) === d.category
          );
          
          if (matchingExpense) {
            await tx.insert(expenseAllocations).values({
              expenseId: matchingExpense.id,
              unitId: result.unitId,
              allocatedNet: d.tenantShare.toString(),
              allocationBasis: d.distributionKey,
              allocationDetail: JSON.stringify({
                settlementDetailId: detail.id,
                tenantId: result.tenantId,
                category: d.category,
                anteil: result.anteil,
                totalCost: d.totalCost,
              }),
            });
          }
        }
      }

      await writeAudit(tx, createdBy, 'settlements', newSettlement.id, 'create', null, {
        settlementId: newSettlement.id,
        propertyId,
        year,
        totalExpenses,
        totalPrepayments,
        totalDifference,
        tenantCount: tenantResults.length,
      });

      return [newSettlement];
    });

    return {
      settlement,
      tenantResults,
      summary: {
        propertyId,
        year,
        totalExpenses,
        totalPrepayments,
        totalDifference,
        tenantCount: tenantResults.length,
        unitCount: propertyUnits.length
      }
    };
  }

  async getSettlementPreview(propertyId: string, year: number): Promise<{
    expenses: typeof expenses.$inferSelect[];
    summary: {
      totalExpenses: number;
      byCategory: Record<string, number>;
      tenantCount: number;
    };
  }> {
    const { totalExpenses, byCategory, expenses: propertyExpenses } = 
      await this.calculatePropertyExpenses(propertyId, year);

    const propertyUnits = await db.select().from(units)
      .where(eq(units.propertyId, propertyId));

    const unitIds = propertyUnits.map(u => u.id);
    const propertyTenants = await db.select().from(tenants)
      .where(inArray(tenants.unitId, unitIds));

    return {
      expenses: propertyExpenses,
      summary: {
        totalExpenses,
        byCategory: Object.fromEntries(byCategory),
        tenantCount: propertyTenants.length
      }
    };
  }
}

export const settlementService = new SettlementService();
