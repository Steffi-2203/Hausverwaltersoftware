import { describe, it } from 'node:test';
import { expect } from './helpers/expect';
import { normalizeDescription } from '../server/lib/normalizeDescription';

describe('normalizeDescription', () => {
  it('should collapse whitespace and lowercase', () => {
    expect(normalizeDescription('  Heizkosten  Abrechnung\n2026 ')).toBe('heizkosten abrechnung 2026');
  });

  it('should be deterministic for Unicode variants', () => {
    expect(normalizeDescription('Straße')).toBe(normalizeDescription('Straße'));
  });

  it('should return null for null/undefined', () => {
    expect(normalizeDescription(null)).toBeNull();
    expect(normalizeDescription(undefined)).toBeNull();
  });

  it('should remove zero-width characters', () => {
    expect(normalizeDescription('Miete\u200BJänner')).toBe('mietejänner');
    expect(normalizeDescription('BK\uFEFF2026')).toBe('bk 2026');
  });

  it('should handle empty string', () => {
    expect(normalizeDescription('')).toBe('');
    expect(normalizeDescription('   ')).toBe('');
  });

  it('should normalize tabs and newlines to single space', () => {
    expect(normalizeDescription('BK\t\tVorschreibung\nSeptember\r\n2026')).toBe('bk vorschreibung september 2026');
  });

  it('should produce identical output for varying whitespace', () => {
    const a = normalizeDescription('Betriebskosten   September  2026');
    const b = normalizeDescription('Betriebskosten September 2026');
    expect(a).toBe(b);
  });
});
