import { db } from "../db";
import { eq, and, gte, sql } from "drizzle-orm";

export interface RetentionCheckResult {
  allowed: boolean;
  reason?: string;
  retentionEndDate?: string;
}

const BAO_RETENTION_YEARS = 7;

export function calculateRetentionEnd(documentDate: Date): Date {
  const endOfYear = new Date(documentDate.getFullYear(), 11, 31);
  const retentionEnd = new Date(endOfYear);
  retentionEnd.setFullYear(retentionEnd.getFullYear() + BAO_RETENTION_YEARS);
  return retentionEnd;
}

export function checkRetentionPeriod(documentDate: Date | string): RetentionCheckResult {
  const docDate = typeof documentDate === "string" ? new Date(documentDate) : documentDate;
  const retentionEnd = calculateRetentionEnd(docDate);
  const now = new Date();

  if (now < retentionEnd) {
    return {
      allowed: false,
      reason: `BAO §132: Aufbewahrungspflicht bis ${retentionEnd.toLocaleDateString("de-AT", { year: "numeric", month: "2-digit", day: "2-digit" })}. Löschung nicht gestattet.`,
      retentionEndDate: retentionEnd.toISOString(),
    };
  }

  return { allowed: true };
}

export function checkFinancialRecordDeletion(createdAt: Date | string, type: string): RetentionCheckResult {
  const result = checkRetentionPeriod(createdAt);
  if (!result.allowed) {
    return {
      ...result,
      reason: `${type}: ${result.reason}`,
    };
  }
  return result;
}

export function isGoBDImmutable(record: { createdAt: Date | string | null; status?: string }): boolean {
  if (!record.createdAt) return false;
  const check = checkRetentionPeriod(record.createdAt);
  return !check.allowed;
}
