import { describe, test } from 'node:test';
import { expect } from '../helpers/expect';
import crypto from 'crypto';
import { checkRetentionPeriod, calculateRetentionEnd, isGoBDImmutable, checkFinancialRecordDeletion } from '../../server/services/retentionService';
import { checkWEGInvitationDeadline } from '../../server/services/legalComplianceService';
import { ApiError, Errors } from '../../server/lib/apiErrors';

// ============================================================================
// BAO §132 Aufbewahrungspflicht (Retention Service)
// ============================================================================

describe('BAO §132 Aufbewahrungspflicht', () => {
  test('rejects deletion of recent financial record (within 7 years)', () => {
    const recentDate = new Date();
    recentDate.setFullYear(recentDate.getFullYear() - 2);
    const result = checkRetentionPeriod(recentDate);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('BAO §132');
  });

  test('allows deletion of old financial record (>7 years)', () => {
    const oldDate = new Date();
    oldDate.setFullYear(oldDate.getFullYear() - 10);
    const result = checkRetentionPeriod(oldDate);
    expect(result.allowed).toBe(true);
  });

  test('calculates retention end correctly (end of year + 7)', () => {
    const docDate = new Date(2020, 5, 15);
    const retentionEnd = calculateRetentionEnd(docDate);
    expect(retentionEnd.getFullYear()).toBe(2027);
    expect(retentionEnd.getMonth()).toBe(11);
    expect(retentionEnd.getDate()).toBe(31);
  });

  test('isGoBDImmutable returns true for recent records', () => {
    expect(isGoBDImmutable({ createdAt: new Date() })).toBe(true);
  });

  test('isGoBDImmutable returns false for null createdAt', () => {
    expect(isGoBDImmutable({ createdAt: null })).toBe(false);
  });

  test('checkFinancialRecordDeletion includes type in message', () => {
    const result = checkFinancialRecordDeletion(new Date(), 'Rechnung');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Rechnung');
  });
});

// ============================================================================
// WEG §24 Einladungsfristen (Legal Compliance Service)
// ============================================================================

describe('WEG §24 Einladungsfristen', () => {
  test('rejects invitation sent less than 14 days before assembly', () => {
    const assemblyDate = new Date('2026-03-15');
    const invitationDate = new Date('2026-03-05');
    const warnings = checkWEGInvitationDeadline(assemblyDate, invitationDate);
    expect(warnings.length).toBe(1);
    expect(warnings[0].severity).toBe('fehler');
    expect(warnings[0].message).toContain('14');
  });

  test('accepts invitation sent exactly 14 days before', () => {
    const assemblyDate = new Date('2026-03-15');
    const invitationDate = new Date('2026-03-01');
    const warnings = checkWEGInvitationDeadline(assemblyDate, invitationDate);
    expect(warnings.length).toBe(0);
  });

  test('accepts invitation sent well in advance', () => {
    const assemblyDate = new Date('2026-03-15');
    const invitationDate = new Date('2026-02-01');
    const warnings = checkWEGInvitationDeadline(assemblyDate, invitationDate);
    expect(warnings.length).toBe(0);
  });

  test('error when no invitation sent', () => {
    const warnings = checkWEGInvitationDeadline('2026-03-15', null);
    expect(warnings.length).toBe(1);
    expect(warnings[0].severity).toBe('fehler');
    expect(warnings[0].message).toContain('Keine Einladung');
  });
});

// ============================================================================
// Audit Hash Chain (GoBD)
// ============================================================================

describe('Audit Hash Chain (GoBD)', () => {
  function computeTestHash(data: Record<string, unknown>): string {
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  }

  test('hash is deterministic for same input', () => {
    const data = {
      action: 'create',
      entityType: 'invoice',
      entityId: '123',
      organizationId: 'org1',
      userId: 'u1',
      payload: { amount: 100 },
      previousHash: 'GENESIS',
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    const hash1 = computeTestHash(data);
    const hash2 = computeTestHash(data);
    expect(hash1).toBe(hash2);
  });

  test('hash changes when data changes', () => {
    const data1 = {
      action: 'create',
      entityType: 'invoice',
      entityId: '123',
      organizationId: 'org1',
      userId: 'u1',
      payload: { amount: 100 },
      previousHash: 'GENESIS',
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    const data2 = { ...data1, payload: { amount: 200 } };
    expect(computeTestHash(data1)).not.toBe(computeTestHash(data2));
  });

  test('hash changes when previousHash changes (chain integrity)', () => {
    const data1 = {
      action: 'create',
      entityType: 'invoice',
      entityId: '123',
      organizationId: 'org1',
      userId: 'u1',
      payload: { amount: 100 },
      previousHash: 'GENESIS',
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    const data2 = { ...data1, previousHash: 'different_hash' };
    expect(computeTestHash(data1)).not.toBe(computeTestHash(data2));
  });

  test('SHA-256 produces 64 character hex string', () => {
    const hash = computeTestHash({ test: 'data' });
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ============================================================================
// API Error Standard
// ============================================================================

describe('API Error Standard', () => {
  test('Errors.notFound creates 404 error', () => {
    const err = Errors.notFound('Mieter');
    expect(err).toBeInstanceOf(ApiError);
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toContain('Mieter');
  });

  test('Errors.periodLocked creates 423 error with period info', () => {
    const err = Errors.periodLocked(2025, 12);
    expect(err.statusCode).toBe(423);
    expect(err.code).toBe('PERIOD_LOCKED');
    expect(err.message).toContain('12/2025');
  });

  test('Errors.validation includes field details', () => {
    const err = Errors.validation({ email: 'ungültig', name: 'erforderlich' });
    expect(err.statusCode).toBe(422);
    expect(err.details).toHaveProperty('fields');
  });
});
