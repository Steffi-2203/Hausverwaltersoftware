/**
 * Cent-Integer-Geldarithmetik — Regressionstests für Task "Geldberechnungen
 * auf Cent-Integer umstellen".
 *
 * Prüft:
 *  1. roundMoney (shared/utils): dezimalsicher, kaufmännisch (1.005-Fall, Negativwerte)
 *  2. toCents/fromCents: exakte Konvertierung von DB-Decimal-Strings
 *  3. ustFromGrossCents: USt-Herausrechnung mit definierter Rundung
 *  4. sumCents: Summen vieler Kleinbeträge ohne Float-Drift
 *  5. distributeCents: Drittel-Verteilungen restcent-frei
 */

import { describe, test } from 'node:test';
import { expect } from '../helpers/expect';
import { roundMoney } from '../../shared/utils';
import {
  toCents, fromCents, sumCents, distributeCents, ustFromGrossCents, percentOfCents,
} from '../../server/lib/money';

describe('roundMoney — dezimalsichere kaufmännische Rundung', () => {
  test('1.005 rundet auf 1.01 (Float-Artefakt eliminiert)', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68); // klassischer Math.round-Fehlerfall
    expect(roundMoney(1.0044)).toBe(1.0);
  });

  test('kein Double-Rounding knapp unter der Halbcent-Grenze', () => {
    expect(roundMoney(1.0046)).toBe(1.0);
    expect(roundMoney(-1.0046)).toBe(-1.0);
    expect(roundMoney(1.0045)).toBe(1.0); // < 0.005 → abrunden
    expect(roundMoney(1.00451)).toBe(1.0);
    expect(roundMoney(1.0051)).toBe(1.01);
    expect(roundMoney(-1.0051)).toBe(-1.01);
    expect(toCents(1.0046)).toBe(100);
    expect(toCents(-1.0046)).toBe(-100);
    expect(toCents(1.0051)).toBe(101);
  });

  test('0.1 + 0.2 → 0.3', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });

  test('Negativwerte kaufmännisch (half away from zero)', () => {
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(roundMoney(-2.675)).toBe(-2.68);
    expect(roundMoney(-0.004) === 0).toBe(true);
  });

  test('bereits gerundete Werte bleiben identisch', () => {
    expect(roundMoney(1234.56)).toBe(1234.56);
    expect(roundMoney(0)).toBe(0);
    expect(roundMoney(-99.99)).toBe(-99.99);
  });
});

describe('toCents / fromCents', () => {
  test('DB-Decimal-Strings exakt', () => {
    expect(toCents('19.90')).toBe(1990);
    expect(toCents('0.01')).toBe(1);
    expect(toCents('-123.45')).toBe(-12345);
    expect(fromCents(1990)).toBe(19.9);
  });

  test('Float-Eingaben mit Repräsentationsfehler', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(1.005)).toBe(101);
  });
});

describe('ustFromGrossCents — USt aus Brutto', () => {
  test('10% aus 1.100,00 € → 100,00 €', () => {
    expect(ustFromGrossCents(110000, 10)).toBe(10000);
  });

  test('20% aus 1.200,00 € → 200,00 €', () => {
    expect(ustFromGrossCents(120000, 20)).toBe(20000);
  });

  test('rundungskritische Beträge: 20% aus 0,99 €', () => {
    // 99 * 20/120 = 16.5 → kaufmännisch 17 Cent
    expect(ustFromGrossCents(99, 20)).toBe(17);
  });

  test('0%-Satz → 0', () => {
    expect(ustFromGrossCents(99999, 0)).toBe(0);
  });

  test('Summenbildung: USt über Summe vieler Kleinbeträge driftet nicht', () => {
    // 1000 Ausgaben à 1,23 € mit 20% USt: exakt via Cents
    const items = Array.from({ length: 1000 }, () => 123);
    const perItemUst = items.map((c) => ustFromGrossCents(c, 20)); // je 21 Cent (20.5 → 21)
    expect(sumCents(perItemUst)).toBe(21 * 1000);
  });
});

describe('sumCents / distributeCents', () => {
  test('Summe vieler Kleinbeträge exakt (10.000 × 0,01 €)', () => {
    const cents = Array.from({ length: 10000 }, () => 1);
    expect(sumCents(cents)).toBe(10000);
    expect(fromCents(sumCents(cents))).toBe(100);
  });

  test('Drittel-Verteilung restcent-frei: 100,00 € auf 3', () => {
    const parts = distributeCents(10000, [1, 1, 1]);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(10000);
    expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
  });

  test('percentOfCents kaufmännisch', () => {
    expect(percentOfCents(10000, 10)).toBe(1000);
    expect(percentOfCents(1, 50)).toBe(1); // 0.5 → 1 (half away from zero)
  });
});
