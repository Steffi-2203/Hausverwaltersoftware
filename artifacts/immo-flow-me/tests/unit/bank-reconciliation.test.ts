import { describe, it } from 'node:test';
import { expect } from '../helpers/expect';
import { roundMoney } from '../../shared/utils';

interface Tenant {
  id: string;
  name: string;
  iban?: string;
}

interface InvoicePattern {
  invoiceId: string;
  pattern: RegExp;
  tenantId: string;
}

interface Transaction {
  text: string;
  iban?: string;
  reference?: string;
  amount: number;
}

interface MatchResult {
  tenantId: string;
  score: number;
}

function calculateLevenshtein(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= an; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= bn; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= an; i++) {
    for (let j = 1; j <= bn; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[an][bn];
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ü/g, 'ue')
    .replace(/ö/g, 'oe')
    .replace(/ä/g, 'ae')
    .replace(/ß/g, 'ss')
    .trim();
}

function fuzzyMatchTenant(transactionText: string, tenants: Tenant[]): MatchResult | null {
  const normalized = normalizeText(transactionText);
  let bestMatch: MatchResult | null = null;

  for (const tenant of tenants) {
    const tenantNormalized = normalizeText(tenant.name);

    if (normalized.includes(tenantNormalized) || tenantNormalized.includes(normalized)) {
      const score = normalized === tenantNormalized ? 1.0 : 0.85;
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { tenantId: tenant.id, score };
      }
      continue;
    }

    const distance = calculateLevenshtein(normalized, tenantNormalized);
    const maxLen = Math.max(normalized.length, tenantNormalized.length);
    const score = maxLen > 0 ? 1 - distance / maxLen : 0;

    if (score > 0.7 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { tenantId: tenant.id, score };
    }
  }

  return bestMatch;
}

function matchByIban(transactionIban: string, tenants: Tenant[]): Tenant | null {
  const cleaned = transactionIban.replace(/\s/g, '').toUpperCase();
  return tenants.find(t => t.iban && t.iban.replace(/\s/g, '').toUpperCase() === cleaned) || null;
}

function matchByReference(reference: string, invoicePatterns: InvoicePattern[]): { invoiceId: string; tenantId: string } | null {
  for (const pattern of invoicePatterns) {
    if (pattern.pattern.test(reference)) {
      return { invoiceId: pattern.invoiceId, tenantId: pattern.tenantId };
    }
  }
  return null;
}

function reconcileTransaction(
  transaction: Transaction,
  tenants: Tenant[],
  invoicePatterns: InvoicePattern[]
): { tenantId: string | null; invoiceId: string | null; method: string } {
  if (transaction.iban) {
    const ibanMatch = matchByIban(transaction.iban, tenants);
    if (ibanMatch) {
      let invoiceId: string | null = null;
      if (transaction.reference) {
        const refMatch = matchByReference(transaction.reference, invoicePatterns);
        if (refMatch && refMatch.tenantId === ibanMatch.id) {
          invoiceId = refMatch.invoiceId;
        }
      }
      return { tenantId: ibanMatch.id, invoiceId, method: 'iban' };
    }
  }

  if (transaction.reference) {
    const refMatch = matchByReference(transaction.reference, invoicePatterns);
    if (refMatch) {
      return { tenantId: refMatch.tenantId, invoiceId: refMatch.invoiceId, method: 'reference' };
    }
  }

  const fuzzy = fuzzyMatchTenant(transaction.text, tenants);
  if (fuzzy) {
    return { tenantId: fuzzy.tenantId, invoiceId: null, method: 'fuzzy' };
  }

  return { tenantId: null, invoiceId: null, method: 'none' };
}

describe('Bank Reconciliation', () => {
  const tenants: Tenant[] = [
    { id: 't1', name: 'Müller', iban: 'AT611904300234573201' },
    { id: 't2', name: 'Schmidt', iban: 'AT891904300234573202' },
    { id: 't3', name: 'Huber', iban: 'AT121904300234573203' },
  ];

  const invoicePatterns: InvoicePattern[] = [
    { invoiceId: 'inv-jan-t1', pattern: /Miete\s+Jan(uar)?\s+2026.*Top\s*3/i, tenantId: 't1' },
    { invoiceId: 'inv-feb-t2', pattern: /Miete\s+Feb(ruar)?\s+2026.*Top\s*5/i, tenantId: 't2' },
  ];

  it('exact name match scores 1.0', () => {
    const result = fuzzyMatchTenant('Müller', tenants);
    expect(result).not.toBeNull();
    expect(result!.score).toBe(1.0);
    expect(result!.tenantId).toBe('t1');
  });

  it('fuzzy match "Mueller" matches "Müller" (score > 0.7)', () => {
    const result = fuzzyMatchTenant('Mueller', tenants);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0.7);
    expect(result!.tenantId).toBe('t1');
  });

  it('no match returns null', () => {
    const result = fuzzyMatchTenant('Schwarzenegger', tenants);
    expect(result).toBeNull();
  });

  it('IBAN exact match finds tenant', () => {
    const result = matchByIban('AT611904300234573201', tenants);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('t1');
  });

  it('IBAN mismatch returns null', () => {
    const result = matchByIban('AT999999999999999999', tenants);
    expect(result).toBeNull();
  });

  it('reference "Miete Jan 2026 Top 3" matches invoice pattern', () => {
    const result = matchByReference('Miete Jan 2026 Top 3', invoicePatterns);
    expect(result).not.toBeNull();
    expect(result!.invoiceId).toBe('inv-jan-t1');
    expect(result!.tenantId).toBe('t1');
  });

  it('reference with no pattern returns null', () => {
    const result = matchByReference('Unbekannte Überweisung', invoicePatterns);
    expect(result).toBeNull();
  });

  it('Levenshtein distance "kitten"/"sitting" = 3', () => {
    expect(calculateLevenshtein('kitten', 'sitting')).toBe(3);
  });

  it('full reconciliation: transaction matched to tenant and invoice', () => {
    const transaction: Transaction = {
      text: 'Müller Mietzahlung',
      iban: 'AT611904300234573201',
      reference: 'Miete Jan 2026 Top 3',
      amount: 925,
    };
    const result = reconcileTransaction(transaction, tenants, invoicePatterns);
    expect(result.tenantId).toBe('t1');
    expect(result.invoiceId).toBe('inv-jan-t1');
    expect(result.method).toBe('iban');
  });
});
