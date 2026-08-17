import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";

export interface PeriodLock {
  id: string;
  organizationId: string;
  year: number;
  month: number;
  lockedAt: Date;
  lockedBy: string;
}

/**
 * Audit-Befund M4: Die Tabelle wird jetzt regulär per Migration angelegt
 * (migrations/20260815_period_locks.sql). Diese Funktion bleibt als No-Op
 * erhalten, damit bestehende Aufrufer nicht brechen — sie erzeugt kein
 * Schema mehr zur Laufzeit.
 */
export async function ensurePeriodLockTable() {
  return;
}


export async function lockPeriod(organizationId: string, year: number, month: number, userId: string): Promise<void> {
  await ensurePeriodLockTable();
  await db.execute(sql`
    INSERT INTO period_locks (organization_id, year, month, locked_by)
    VALUES (${organizationId}, ${year}, ${month}, ${userId})
    ON CONFLICT (organization_id, year, month) DO NOTHING
  `);
}

export async function unlockPeriod(organizationId: string, year: number, month: number): Promise<void> {
  await db.execute(sql`
    DELETE FROM period_locks WHERE organization_id = ${organizationId} AND year = ${year} AND month = ${month}
  `);
}

export async function isPeriodLocked(organizationId: string, year: number, month: number): Promise<boolean> {
  await ensurePeriodLockTable();
  const result = await db.execute(sql`
    SELECT 1 FROM period_locks WHERE organization_id = ${organizationId} AND year = ${year} AND month = ${month} LIMIT 1
  `);
  return (result as any).rows?.length > 0 || (result as any).length > 0;
}

export async function getLockedPeriods(organizationId: string): Promise<Array<{year: number, month: number, lockedAt: string}>> {
  await ensurePeriodLockTable();
  const result = await db.execute(sql`
    SELECT year, month, locked_at FROM period_locks WHERE organization_id = ${organizationId} ORDER BY year DESC, month DESC
  `);
  return (result as any).rows || [];
}

export async function checkPeriodLockGuard(organizationId: string, year: number, month: number): Promise<void> {
  const locked = await isPeriodLocked(organizationId, year, month);
  if (locked) {
    throw new Error(`Buchungsperiode ${month}/${year} ist gesperrt (BAO §132). Entsperrung durch Admin erforderlich.`);
  }
}
