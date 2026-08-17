import { describe, it } from 'node:test';
import { expect } from '../helpers/expect';

interface VersionedRecord {
  id: string;
  version: number;
  [key: string]: unknown;
}

interface LockResult {
  success: boolean;
  conflict?: boolean;
  updatedRecord?: VersionedRecord;
}

function optimisticLockUpdate(
  record: VersionedRecord,
  newValues: Record<string, unknown>,
  expectedVersion: number
): LockResult {
  if (record.version !== expectedVersion) {
    return { success: false, conflict: true };
  }
  const updatedRecord: VersionedRecord = {
    ...record,
    ...newValues,
    version: record.version + 1,
  };
  return { success: true, updatedRecord };
}

function detectDuplicate(existingIds: Set<string>, newId: string): boolean {
  return existingIds.has(newId);
}

function idempotentOperation(
  operationId: string,
  executedOps: Map<string, unknown>,
  operation: () => unknown
): { executed: boolean; result: unknown } {
  if (executedOps.has(operationId)) {
    return { executed: false, result: executedOps.get(operationId) };
  }
  const result = operation();
  executedOps.set(operationId, result);
  return { executed: true, result };
}

function generateIdempotencyKey(tenantId: string, year: number, month: number, type: string): string {
  return `${tenantId}:${year}:${String(month).padStart(2, '0')}:${type}`;
}

describe('Concurrency Patterns and Idempotency', () => {
  it('optimistic lock succeeds when version matches', () => {
    const record: VersionedRecord = { id: 'r1', version: 1, name: 'old' };
    const result = optimisticLockUpdate(record, { name: 'new' }, 1);
    expect(result.success).toBe(true);
    expect(result.updatedRecord!.name).toBe('new');
  });

  it('optimistic lock fails when version mismatch (conflict)', () => {
    const record: VersionedRecord = { id: 'r1', version: 2, name: 'old' };
    const result = optimisticLockUpdate(record, { name: 'new' }, 1);
    expect(result.success).toBe(false);
    expect(result.conflict).toBe(true);
  });

  it('optimistic lock increments version on success', () => {
    const record: VersionedRecord = { id: 'r1', version: 3, name: 'old' };
    const result = optimisticLockUpdate(record, { name: 'new' }, 3);
    expect(result.success).toBe(true);
    expect(result.updatedRecord!.version).toBe(4);
  });

  it('duplicate detection finds existing ID', () => {
    const existingIds = new Set(['id-1', 'id-2', 'id-3']);
    expect(detectDuplicate(existingIds, 'id-2')).toBe(true);
  });

  it('duplicate detection allows new ID', () => {
    const existingIds = new Set(['id-1', 'id-2', 'id-3']);
    expect(detectDuplicate(existingIds, 'id-4')).toBe(false);
  });

  it('idempotent operation executes first time', () => {
    const executedOps = new Map<string, unknown>();
    let callCount = 0;
    const result = idempotentOperation('op-1', executedOps, () => {
      callCount++;
      return { total: 925 };
    });
    expect(result.executed).toBe(true);
    expect(callCount).toBe(1);
    expect(result.result).toEqual({ total: 925 });
  });

  it('idempotent operation skips second execution', () => {
    const executedOps = new Map<string, unknown>();
    let callCount = 0;
    const op = () => { callCount++; return { total: 925 }; };
    idempotentOperation('op-1', executedOps, op);
    const result = idempotentOperation('op-1', executedOps, op);
    expect(result.executed).toBe(false);
    expect(callCount).toBe(1);
  });

  it('idempotent operation returns cached result on retry', () => {
    const executedOps = new Map<string, unknown>();
    idempotentOperation('op-1', executedOps, () => ({ total: 925 }));
    const result = idempotentOperation('op-1', executedOps, () => ({ total: 999 }));
    expect(result.result).toEqual({ total: 925 });
  });

  it('idempotency key is deterministic (same inputs = same key)', () => {
    const key1 = generateIdempotencyKey('t-123', 2026, 1, 'miete');
    const key2 = generateIdempotencyKey('t-123', 2026, 1, 'miete');
    expect(key1).toBe(key2);
  });

  it('different inputs produce different idempotency keys', () => {
    const key1 = generateIdempotencyKey('t-123', 2026, 1, 'miete');
    const key2 = generateIdempotencyKey('t-123', 2026, 2, 'miete');
    const key3 = generateIdempotencyKey('t-456', 2026, 1, 'miete');
    const key4 = generateIdempotencyKey('t-123', 2026, 1, 'bk');
    expect(key1).not.toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key1).not.toBe(key4);
  });
});
