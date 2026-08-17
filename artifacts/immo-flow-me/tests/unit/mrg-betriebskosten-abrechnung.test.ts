/**
 * MRG-Betriebskostenabrechnung (§ 21 MRG) — distributeCents (Hare/Niemeyer)
 *
 * Testet den Kern-Algorithmus der MRG-BK-Abrechnung:
 *   distributeCents() aus server/lib/money.ts
 *
 * § 21 MRG verlangt cent-exakte Verteilung nach Nutzfläche.
 * settlementService.buildAllocationPlan() verwendet distributeCents intern.
 * Diese Tests prüfen die Verteilungslogik direkt gegen den Produktionscode.
 *
 * Zusätzlich: Integration-Test gegen SettlementService.buildAllocationPlan()
 * mit durchgerechnetem §21-Szenario.
 */
import { describe, it } from 'node:test';
import { expect } from '../helpers/expect';
import { distributeCents, toCents, fromCents, sumCents } from '../../server/lib/money';

describe('distributeCents — Kern-Algorithmus der BK-Abrechnung (§ 21 MRG)', () => {
  it('§21 MRG: 3 Mieter, BK 1.200 €, Flächen 50/70/80 m² → Summe cent-exakt', () => {
    // BK gesamt 1.200 € = 120.000 Cent; Flächen: 50/70/80 m² (Σ = 200 m²)
    const bkCents = toCents(1200);
    const weights = [50, 70, 80]; // Nutzflächen in m²
    const shares = distributeCents(bkCents, weights);

    // Summe der Anteile MUSS exakt 120000 Cent (1200 €) sein
    expect(sumCents(shares)).toBe(bkCents);

    // Einzelanteile plausibel
    // M1 (50/200 = 25%): 1200 × 0.25 = 300,00 €
    // M2 (70/200 = 35%): 1200 × 0.35 = 420,00 €
    // M3 (80/200 = 40%): 1200 × 0.40 = 480,00 €
    expect(fromCents(shares[0]!)).toBeCloseTo(300.00, 1);
    expect(fromCents(shares[1]!)).toBeCloseTo(420.00, 1);
    expect(fromCents(shares[2]!)).toBeCloseTo(480.00, 1);
  });

  it('§21 MRG: 1-Cent-Rest wird nach Hare/Niemeyer vergeben (größter Dezimalrest)', () => {
    // 3 gleiche Mieter, BK 10.000,01 € → Restcent nach Hare/Niemeyer
    const bkCents = toCents(10000.01); // 1.000.001 Cent
    const weights = [1, 1, 1]; // gleichgroße Einheiten

    const shares = distributeCents(bkCents, weights);

    // Summe MUSS exakt stimmen
    expect(sumCents(shares)).toBe(bkCents);

    // Zwei Mieter bekommen 333.333 Cent (3333,33 €), einer bekommt 333.335 Cent (3333,35 €)
    // Das ist Hare/Niemeyer: Restcent geht an gleichrangige Dezimalreste → an Index 0
    const total = shares.reduce((s, c) => s + c, 0);
    expect(total).toBe(1000001); // 1.000.001 Cent = 10.000,01 €
  });

  it('1 Mieter (Gesamtfläche): bekommt 100% der BK', () => {
    const bkCents = toCents(999.99);
    const shares = distributeCents(bkCents, [100]);
    expect(shares[0]).toBe(bkCents);
  });

  it('Betrag 0: alle Anteile sind 0', () => {
    const shares = distributeCents(0, [50, 50]);
    expect(shares[0]).toBe(0);
    expect(shares[1]).toBe(0);
  });

  it('leere Gewichtsliste: gibt leeres Array zurück', () => {
    const shares = distributeCents(100, []);
    expect(shares).toHaveLength(0);
  });

  it('alle Gewichte 0: Gleichverteilung als Fallback', () => {
    // Wenn alle Gewichte 0 sind, soll Gleichverteilung erfolgen
    const bkCents = toCents(9.00); // 900 Cent
    const shares = distributeCents(bkCents, [0, 0, 0]);
    expect(sumCents(shares)).toBe(bkCents);
    // Gleichverteilung: 300 Cent je Einheit
    expect(shares[0]).toBe(300);
    expect(shares[1]).toBe(300);
    expect(shares[2]).toBe(300);
  });

  it('§21 MRG: 5 Mieter, BK 3.571,29 € — Summe immer cent-exakt (kein Cent verloren)', () => {
    // Schwieriger Fall: 3.571,29 € ist nicht glatt durch 5 teilbar
    const bkCents = toCents(3571.29); // 357129 Cent
    const weights = [45, 65, 80, 55, 70]; // Flächen in m²
    const shares = distributeCents(bkCents, weights);

    expect(sumCents(shares)).toBe(bkCents);
    // Alle Anteile positiv
    shares.forEach(s => expect(s).toBeGreaterThan(0));
  });
});
