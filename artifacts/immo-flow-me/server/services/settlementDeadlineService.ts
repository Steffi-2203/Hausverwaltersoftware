import { db } from "../db";
import { eq, and, inArray } from "drizzle-orm";
import { properties, settlements } from "@shared/schema";

export interface SettlementDeadlineWarning {
  propertyId: string;
  propertyName: string;
  address: string;
  year: number;
  deadlineDate: string;
  daysRemaining: number;
  status: 'ok' | 'warnung' | 'ueberfaellig';
}

export async function checkSettlementDeadlines(organizationId: string): Promise<SettlementDeadlineWarning[]> {
  if (!organizationId) return [];

  const orgProperties = await db.select()
    .from(properties)
    .where(eq(properties.organizationId, organizationId));

  if (orgProperties.length === 0) return [];

  const today = new Date();
  const currentYear = today.getFullYear();
  const previousYear = currentYear - 1;
  const deadlineDate = new Date(currentYear, 5, 30);
  const daysRemaining = Math.ceil((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  const orgPropertyIds = orgProperties.map(p => p.id);
  const existingSettlements = await db.select({ propertyId: settlements.propertyId })
    .from(settlements)
    .where(
      and(
        eq(settlements.year, previousYear),
        inArray(settlements.propertyId, orgPropertyIds)
      )
    );
  const settledPropertyIds = new Set(existingSettlements.map(s => s.propertyId));

  const warnings: SettlementDeadlineWarning[] = [];

  for (const prop of orgProperties) {
    if (settledPropertyIds.has(prop.id)) continue;

    let status: 'ok' | 'warnung' | 'ueberfaellig';
    if (daysRemaining < 0) {
      status = 'ueberfaellig';
    } else if (daysRemaining <= 90) {
      status = 'warnung';
    } else {
      status = 'ok';
    }

    if (status !== 'ok') {
      warnings.push({
        propertyId: prop.id,
        propertyName: prop.name,
        address: `${prop.address || ''}, ${prop.postalCode || ''} ${prop.city || ''}`.trim(),
        year: previousYear,
        deadlineDate: `30.06.${currentYear}`,
        daysRemaining: Math.max(0, daysRemaining),
        status,
      });
    }
  }

  return warnings;
}
