import { db } from "../db";
import { auditLogs } from "@shared/schema";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import * as schema from "@shared/schema";

type TransactionType = PgTransaction<PostgresJsQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

interface BulkOperationSummary {
  operationType: 'invoice_generation' | 'payment_allocation' | 'settlement_calculation' | 'dunning_batch' | 'sepa_export';
  totalRecords: number;
  successCount: number;
  failureCount: number;
  affectedTenants?: string[];
  affectedProperties?: string[];
  totalAmount?: number;
  details?: Record<string, unknown>;
}

interface BulkAuditEntry {
  tableName: string;
  recordId: string;
  action: 'create' | 'update' | 'delete';
  newData?: Record<string, unknown>;
  oldData?: Record<string, unknown>;
}

export async function writeBulkAuditSummary(
  tx: TransactionType,
  userId: string,
  summary: BulkOperationSummary
): Promise<string> {
  const summaryId = crypto.randomUUID();
  
  await tx.insert(auditLogs).values({
    id: summaryId,
    userId,
    tableName: 'bulk_operations',
    recordId: summaryId,
    action: 'create',
    oldData: null,
    newData: {
      type: 'bulk_summary',
      operationType: summary.operationType,
      totalRecords: summary.totalRecords,
      successCount: summary.successCount,
      failureCount: summary.failureCount,
      affectedTenants: summary.affectedTenants?.length || 0,
      affectedProperties: summary.affectedProperties?.length || 0,
      totalAmount: summary.totalAmount,
      timestamp: new Date().toISOString(),
    },
  });

  return summaryId;
}

export async function writeBulkAuditDetails(
  entries: BulkAuditEntry[],
  userId: string,
  bulkSummaryId: string
): Promise<void> {
  if (entries.length === 0) return;

  const batchSize = 100;
  
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    
    await db.insert(auditLogs).values(
      batch.map(entry => ({
        userId,
        tableName: entry.tableName,
        recordId: entry.recordId,
        action: entry.action,
        oldData: entry.oldData ? { ...entry.oldData, bulkSummaryId } : null,
        newData: entry.newData ? { ...entry.newData, bulkSummaryId } : null,
      }))
    );
  }
}

export function createBulkAuditCollector() {
  const entries: BulkAuditEntry[] = [];
  
  return {
    add(entry: BulkAuditEntry) {
      entries.push(entry);
    },
    
    addCreate(tableName: string, recordId: string, newData: Record<string, unknown>) {
      entries.push({ tableName, recordId, action: 'create', newData });
    },
    
    addUpdate(tableName: string, recordId: string, oldData: Record<string, unknown>, newData: Record<string, unknown>) {
      entries.push({ tableName, recordId, action: 'update', oldData, newData });
    },
    
    getEntries() {
      return entries;
    },
    
    count() {
      return entries.length;
    },
    
    async flushAsync(userId: string, bulkSummaryId: string): Promise<void> {
      if (entries.length === 0) return;
      
      setImmediate(async () => {
        try {
          await writeBulkAuditDetails(entries, userId, bulkSummaryId);
        } catch (error) {
          console.error('Async bulk audit flush failed:', error);
        }
      });
    },
    
    async flush(userId: string, bulkSummaryId: string): Promise<void> {
      await writeBulkAuditDetails(entries, userId, bulkSummaryId);
    },
  };
}

export async function withBulkAudit<T>(
  operationType: BulkOperationSummary['operationType'],
  userId: string,
  operation: (collector: ReturnType<typeof createBulkAuditCollector>) => Promise<{
    result: T;
    summary: Omit<BulkOperationSummary, 'operationType'>;
  }>
): Promise<T> {
  const collector = createBulkAuditCollector();
  
  const { result, summary } = await operation(collector);
  
  const fullSummary: BulkOperationSummary = {
    operationType,
    ...summary,
  };
  
  const summaryId = await db.transaction(async (tx) => {
    return writeBulkAuditSummary(tx, userId, fullSummary);
  });
  
  await collector.flushAsync(userId, summaryId);
  
  return result;
}

export type { BulkOperationSummary, BulkAuditEntry, TransactionType };
