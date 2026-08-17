import { db } from "../db";
import { leases, units, properties } from "../../shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { createAuditLog } from "../lib/auditLog";

/**
 * Org-Scope-Subquery: Einheiten, deren Liegenschaft zur angegebenen
 * Organisation gehört (leases → units → properties → organization_id).
 * Defense-in-Depth zusätzlich zu RLS: ein Update/Delete mit fremder
 * Datensatz-ID trifft 0 Zeilen.
 */
function orgUnitIdsSq(organizationId: string) {
  return db.select({ id: units.id }).from(units)
    .innerJoin(properties, eq(units.propertyId, properties.id))
    .where(eq(properties.organizationId, organizationId));
}

export interface CreateLeaseData {
  tenantId: string;
  unitId: string;
  startDate: string;
  endDate?: string;
  grundmiete: string;
  betriebskostenVorschuss?: string;
  heizkostenVorschuss?: string;
  wasserkostenVorschuss?: string;
  kaution?: string;
  kautionBezahlt?: boolean;
  status?: 'aktiv' | 'beendet' | 'gekuendigt';
  notes?: string;
}

export async function createLease(data: CreateLeaseData, userId?: string) {
  const [lease] = await db.insert(leases).values({
    tenantId: data.tenantId,
    unitId: data.unitId,
    startDate: data.startDate,
    endDate: data.endDate || null,
    grundmiete: data.grundmiete,
    betriebskostenVorschuss: data.betriebskostenVorschuss || '0',
    heizkostenVorschuss: data.heizkostenVorschuss || '0',
    wasserkostenVorschuss: data.wasserkostenVorschuss || '0',
    kaution: data.kaution || null,
    kautionBezahlt: data.kautionBezahlt || false,
    status: data.status || 'aktiv',
    notes: data.notes || null,
  }).returning();

  await createAuditLog({
    userId: userId || 'system',
    tableName: 'leases',
    recordId: lease.id,
    action: 'create',
    newData: {
      tenantId: data.tenantId,
      unitId: data.unitId,
      startDate: data.startDate,
      grundmiete: data.grundmiete
    }
  });

  return lease;
}

export async function updateLease(
  id: string, 
  data: Partial<CreateLeaseData>,
  organizationId: string,
  userId?: string
) {
  const [updated] = await db.update(leases)
    .set({
      ...data,
      updatedAt: new Date()
    })
    .where(and(eq(leases.id, id), inArray(leases.unitId, orgUnitIdsSq(organizationId))))
    .returning();

  if (updated) {
    await createAuditLog({
      userId: userId || 'system',
      tableName: 'leases',
      recordId: id,
      action: 'update',
      newData: data as Record<string, unknown>
    });
  }

  return updated;
}

export async function terminateLease(
  id: string,
  endDate: string,
  organizationId: string,
  userId?: string
) {
  const [terminated] = await db.update(leases)
    .set({
      endDate,
      status: 'beendet',
      updatedAt: new Date()
    })
    .where(and(eq(leases.id, id), inArray(leases.unitId, orgUnitIdsSq(organizationId))))
    .returning();

  if (terminated) {
    await createAuditLog({
      userId: userId || 'system',
      tableName: 'leases',
      recordId: id,
      action: 'update',
      newData: { endDate, status: 'beendet' }
    });
  }

  return terminated;
}

export async function getLease(id: string) {
  const [lease] = await db.select().from(leases).where(eq(leases.id, id));
  return lease;
}

export async function getLeasesByTenant(tenantId: string) {
  return db.select().from(leases).where(eq(leases.tenantId, tenantId));
}

export async function getLeasesByUnit(unitId: string) {
  return db.select().from(leases).where(eq(leases.unitId, unitId));
}
