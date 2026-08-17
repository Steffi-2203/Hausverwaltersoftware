import { db } from "../db";
import { eq, and, lte, isNull, sql } from "drizzle-orm";

export interface ComplianceWarning {
  type: 'weg_reserve' | 'weg_invitation' | 'mrg_deposit_return';
  severity: 'info' | 'warnung' | 'fehler';
  message: string;
  details: Record<string, unknown>;
}

export async function checkWEGReserveCompliance(propertyId: string): Promise<ComplianceWarning[]> {
  const warnings: ComplianceWarning[] = [];
  try {
    const ownerData = await db.execute(sql`
      SELECT unit_id, mea_share
      FROM weg_unit_owners
      WHERE property_id = ${propertyId}::uuid
        AND (valid_to IS NULL OR valid_to > NOW())
    `);
    const owners = (ownerData as any).rows || [];

    const ownerByUnit = new Map<string, number>();
    let totalMea = 0;
    for (const o of owners) {
      const mea = parseFloat(o.mea_share || '0');
      ownerByUnit.set(o.unit_id, (ownerByUnit.get(o.unit_id) || 0) + mea);
      totalMea += mea;
    }

    if (ownerByUnit.size === 0 || totalMea <= 0) {
      const unitCount = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM units WHERE property_id = ${propertyId}::uuid
      `);
      const count = parseInt((unitCount as any).rows?.[0]?.cnt || '0');
      if (count > 0) {
        warnings.push({
          type: 'weg_reserve',
          severity: 'info',
          message: `WEG §31: Keine MEA-Daten vorhanden – Rücklagenprüfung nicht möglich (${count} Einheiten ohne WEG-Zuordnung)`,
          details: { propertyId, unitCount: count },
        });
      }
      return warnings;
    }

    const reserveData = await db.execute(sql`
      SELECT unit_id, COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as total_reserve
      FROM weg_reserve_fund
      WHERE property_id = ${propertyId}::uuid AND year = EXTRACT(YEAR FROM NOW())
      GROUP BY unit_id
    `);
    const reserveByUnit = new Map<string, number>();
    let actualReserve = 0;
    for (const r of (reserveData as any).rows || []) {
      const amt = parseFloat(r.total_reserve || '0');
      reserveByUnit.set(r.unit_id, amt);
      actualReserve += amt;
    }

    const budgetResult = await db.execute(sql`
      SELECT COALESCE(reserve_contribution, 0) as planned_reserve
      FROM weg_budget_plans
      WHERE property_id = ${propertyId}::uuid AND year = EXTRACT(YEAR FROM NOW())
      ORDER BY created_at DESC LIMIT 1
    `);
    const plannedReserve = parseFloat((budgetResult as any).rows?.[0]?.planned_reserve || '0');

    const MIN_RESERVE_PER_MEA_PERCENT = 0.50;
    const recommendedMinimum = plannedReserve > 0 ? plannedReserve : totalMea * MIN_RESERVE_PER_MEA_PERCENT * 100;

    const unitsWithLowReserve: { unitId: string; meaShare: number; reserve: number; expected: number }[] = [];
    for (const [unitId, unitMea] of ownerByUnit.entries()) {
      const reserve = reserveByUnit.get(unitId) || 0;
      const meaPercent = unitMea / totalMea;
      const expectedReserve = recommendedMinimum * meaPercent;
      if (reserve < expectedReserve * 0.8) {
        unitsWithLowReserve.push({ unitId, meaShare: unitMea, reserve, expected: Math.round(expectedReserve * 100) / 100 });
      }
    }

    if (actualReserve < recommendedMinimum) {
      warnings.push({
        type: 'weg_reserve',
        severity: actualReserve < recommendedMinimum * 0.5 ? 'fehler' : 'warnung',
        message: `WEG §31: Rücklage unter MEA-gewichteter Empfehlung (${actualReserve.toFixed(2)} EUR, empfohlen: ${recommendedMinimum.toFixed(2)} EUR)`,
        details: {
          propertyId,
          totalReserve: actualReserve,
          totalMea,
          unitCount: ownerByUnit.size,
          recommendedMinimum,
          plannedReserve,
          unitsWithLowReserve: unitsWithLowReserve.slice(0, 5),
        },
      });
    } else if (unitsWithLowReserve.length > 0) {
      warnings.push({
        type: 'weg_reserve',
        severity: 'info',
        message: `WEG §31: ${unitsWithLowReserve.length} Einheit(en) mit unterdurchschnittlicher Rücklage (MEA-gewichtet)`,
        details: {
          propertyId,
          totalReserve: actualReserve,
          totalMea,
          unitsWithLowReserve: unitsWithLowReserve.slice(0, 5),
        },
      });
    }
  } catch {}
  return warnings;
}

export function checkWEGInvitationDeadline(assemblyDate: Date | string, invitationSentDate: Date | string | null): ComplianceWarning[] {
  const warnings: ComplianceWarning[] = [];
  const assembly = typeof assemblyDate === 'string' ? new Date(assemblyDate) : assemblyDate;
  
  if (!invitationSentDate) {
    warnings.push({
      type: 'weg_invitation',
      severity: 'fehler',
      message: 'WEG §24 Abs 5: Keine Einladung versendet',
      details: { assemblyDate: assembly.toISOString() },
    });
    return warnings;
  }

  const invitation = typeof invitationSentDate === 'string' ? new Date(invitationSentDate) : invitationSentDate;
  const diffDays = Math.ceil((assembly.getTime() - invitation.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 14) {
    warnings.push({
      type: 'weg_invitation',
      severity: 'fehler',
      message: `WEG §24 Abs 5: Einladungsfrist nicht eingehalten (${diffDays} Tage statt mindestens 14)`,
      details: { assemblyDate: assembly.toISOString(), invitationDate: invitation.toISOString(), daysBefore: diffDays },
    });
  }

  return warnings;
}

export async function checkDepositReturnCompliance(organizationId: string): Promise<ComplianceWarning[]> {
  const warnings: ComplianceWarning[] = [];
  try {
    const overdueDeposits = await db.execute(sql`
      SELECT d.id, d.amount, d.deposit_type, t.first_name, t.last_name, t.mietende,
             EXTRACT(DAY FROM NOW() - t.mietende::timestamp) as days_since_end
      FROM deposits d
      JOIN tenants t ON d.tenant_id = t.id
      JOIN units u ON t.unit_id = u.id
      JOIN properties p ON u.property_id = p.id
      WHERE p.organization_id = ${organizationId}::uuid
        AND t.mietende IS NOT NULL
        AND t.mietende < NOW()
        AND d.status != 'zurückgegeben'
        AND d.status != 'aufgelöst'
    `);

    for (const row of (overdueDeposits as any).rows || []) {
      const daysSinceEnd = parseInt(row.days_since_end || '0');
      if (daysSinceEnd > 30) {
        warnings.push({
          type: 'mrg_deposit_return',
          severity: daysSinceEnd > 180 ? 'fehler' : 'warnung',
          message: `MRG §27: Kaution für ${row.first_name} ${row.last_name} seit ${daysSinceEnd} Tagen nicht zurückgegeben (${parseFloat(row.amount).toFixed(2)} EUR)`,
          details: {
            depositId: row.id,
            tenantName: `${row.first_name} ${row.last_name}`,
            amount: parseFloat(row.amount),
            daysSinceLeaseEnd: daysSinceEnd,
            depositType: row.deposit_type,
          },
        });
      }
    }
  } catch {}
  return warnings;
}

export async function runFullComplianceCheck(organizationId: string): Promise<ComplianceWarning[]> {
  const warnings: ComplianceWarning[] = [];
  
  const depositWarnings = await checkDepositReturnCompliance(organizationId);
  warnings.push(...depositWarnings);

  try {
    const orgProperties = await db.execute(sql`
      SELECT id FROM properties WHERE organization_id = ${organizationId}::uuid
    `);
    for (const prop of (orgProperties as any).rows || []) {
      const reserveWarnings = await checkWEGReserveCompliance(prop.id);
      warnings.push(...reserveWarnings);
    }
  } catch {}

  return warnings;
}
