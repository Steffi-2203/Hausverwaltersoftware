/**
 * Pro-Rata (Aliquote) Mietzinsberechnung — echte Produktionsfunktionen
 *
 * Testet die exportierten Funktionen aus proRataBillingService.ts:
 *   - getDaysInMonth
 *   - calculateProRata
 *   - calculateMoveInProRata
 *   - calculateMoveOutProRata
 *
 * Alle Berechnungen werden gegen den echten Produktionscode geprüft.
 * Zuvor enthielt diese Datei lokal definierte Hilfsfunktionen (Scheintest) —
 * diese wurden in den Produktions-Service ausgelagert und die Tests importieren
 * jetzt den echten Service.
 */
import { describe, it } from 'node:test';
import { expect } from '../helpers/expect';
import {
  getDaysInMonth,
  calculateProRata,
  calculateMoveInProRata,
  calculateMoveOutProRata,
} from '../../server/services/proRataBillingService';
import { roundMoney } from '../../shared/utils';

describe('getDaysInMonth — Produktionsfunktion aus proRataBillingService', () => {
  it('gibt 31 für Januar zurück', () => {
    expect(getDaysInMonth(2025, 1)).toBe(31);
  });

  it('gibt 28 für Februar im Nicht-Schaltjahr zurück', () => {
    expect(getDaysInMonth(2025, 2)).toBe(28);
  });

  it('gibt 29 für Februar im Schaltjahr 2024 zurück', () => {
    expect(getDaysInMonth(2024, 2)).toBe(29);
  });

  it('gibt korrekte Tageszahlen für alle 12 Monate 2025', () => {
    const expected = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (let m = 1; m <= 12; m++) {
      expect(getDaysInMonth(2025, m)).toBe(expected[m - 1]);
    }
  });
});

describe('calculateProRata — Produktionsfunktion aus proRataBillingService', () => {
  it('voller Monat (Tag 1 bis 31) = volle Miete', () => {
    expect(calculateProRata(1000, 1, 31, 31)).toBe(1000);
  });

  it('negativer Zeitraum (startDay > endDay): gibt 0 zurück', () => {
    expect(calculateProRata(1000, 20, 10, 30)).toBe(0);
  });

  it('Miete = 0: gibt 0 zurück', () => {
    expect(calculateProRata(0, 1, 15, 30)).toBe(0);
  });

  it('10 Tage im 30-Tage-Monat (Tag 10–19) = 10/30 × 900', () => {
    const result = calculateProRata(900, 10, 19, 30);
    expect(result).toBe(roundMoney(900 * 10 / 30));
  });

  it('Mieter-Wechsel im Monat: alter + neuer Mieter = volle Miete (kein Cent verloren)', () => {
    // Alt: Tag 1–15, Neu: Tag 16–30 in 30-Tage-Monat
    const old = calculateProRata(900, 1, 15, 30);
    const neu = calculateProRata(900, 16, 30, 30);
    expect(roundMoney(old + neu)).toBe(900);
  });

  it('Cent-Genauigkeit: 1 € auf 15 von 30 Tage = 0,50 €', () => {
    expect(calculateProRata(1, 1, 15, 30)).toBe(0.50);
  });

  it('große Miete (5.000 €): korrekt berechnet', () => {
    const result = calculateProRata(5000, 16, 31, 31);
    expect(result).toBe(roundMoney(5000 * 16 / 31));
  });
});

describe('calculateMoveInProRata — Produktionsfunktion aus proRataBillingService', () => {
  it('Einzug am 1.: volle Miete', () => {
    const result = calculateMoveInProRata(1000, new Date(2026, 0, 1));
    expect(result).toBe(1000);
  });

  it('Einzug am 15. April (30 Tage): 16/30 × 900', () => {
    const result = calculateMoveInProRata(900, new Date(2026, 3, 15));
    expect(result).toBe(roundMoney(900 * 16 / 30));
  });

  it('Einzug am 29. Feb im Schaltjahr 2024: 1/29 × 900', () => {
    const result = calculateMoveInProRata(900, new Date(2024, 1, 29));
    expect(result).toBe(roundMoney(900 * 1 / 29));
  });

  it('Einzug am 15. Feb 2025 (28 Tage): 14/28 × 900', () => {
    const result = calculateMoveInProRata(900, new Date(2025, 1, 15));
    expect(result).toBe(roundMoney(900 * 14 / 28));
  });
});

describe('calculateMoveOutProRata — Produktionsfunktion aus proRataBillingService', () => {
  it('Auszug am letzten Tag: volle Miete', () => {
    const result = calculateMoveOutProRata(1000, new Date(2026, 0, 31));
    expect(result).toBe(1000);
  });

  it('Auszug am 15. Jänner (31 Tage): 15/31 × 1.000', () => {
    const result = calculateMoveOutProRata(1000, new Date(2026, 0, 15));
    expect(result).toBe(roundMoney(1000 * 15 / 31));
  });
});
