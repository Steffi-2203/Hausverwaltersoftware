/**
 * VPI-Indexanpassung — Schwellenwert & Berechnungslogik
 *
 * Testet die reinen Berechnungsfunktionen aus vpiAutomationService.ts:
 *   - computeVpiPercentage   (Prozentualer Anstieg gegenüber Basiswert)
 *   - meetsSchwellenwert     (Schwellenwertprüfung)
 *   - SCHWELLENWERT          (globaler Standardwert: 5%)
 *
 * Kernprüfung: Bei 4,9% Steigerung wird kein Kandidat zurückgegeben,
 * bei 5,0% einer.
 */
import { describe, it } from 'node:test';
import { expect } from '../helpers/expect';
import {
  computeVpiPercentage,
  meetsSchwellenwert,
  SCHWELLENWERT,
} from '../../server/services/vpiAutomationService';

describe('computeVpiPercentage — Produktionsfunktion aus vpiAutomationService', () => {
  it('berechnet 5% Steigerung korrekt', () => {
    const increase = computeVpiPercentage(105, 100);
    expect(increase).toBeCloseTo(0.05, 6);
  });

  it('berechnet 4.9% Steigerung korrekt', () => {
    const increase = computeVpiPercentage(104.9, 100);
    expect(increase).toBeCloseTo(0.049, 6);
  });

  it('berechnet 0% bei gleichem Wert', () => {
    expect(computeVpiPercentage(105, 105)).toBe(0);
  });

  it('gibt 0 zurück wenn Basiswert ≤ 0 (Schutz vor Division durch 0)', () => {
    expect(computeVpiPercentage(105, 0)).toBe(0);
    expect(computeVpiPercentage(105, -1)).toBe(0);
  });

  it('deflation: negativer Wert möglich (Deflationsschutz liegt im Aufrufer)', () => {
    const increase = computeVpiPercentage(95, 100);
    expect(increase).toBeCloseTo(-0.05, 6);
  });
});

describe('meetsSchwellenwert — Schwellenwertprüfung aus vpiAutomationService', () => {
  it('4.9% Steigerung löst KEINE Anpassung aus (< 5%)', () => {
    const increase = computeVpiPercentage(104.9, 100);
    expect(meetsSchwellenwert(increase)).toBe(false);
  });

  it('5.0% Steigerung löst Anpassung aus (= 5%)', () => {
    const increase = computeVpiPercentage(105, 100);
    expect(meetsSchwellenwert(increase)).toBe(true);
  });

  it('5.1% Steigerung löst Anpassung aus (> 5%)', () => {
    const increase = computeVpiPercentage(105.1, 100);
    expect(meetsSchwellenwert(increase)).toBe(true);
  });

  it('individueller Schwellenwert 3%: 3.0% löst aus', () => {
    const increase = computeVpiPercentage(103, 100);
    expect(meetsSchwellenwert(increase, 0.03)).toBe(true);
  });

  it('individueller Schwellenwert 3%: 2.9% löst NICHT aus', () => {
    const increase = computeVpiPercentage(102.9, 100);
    expect(meetsSchwellenwert(increase, 0.03)).toBe(false);
  });

  it('globaler SCHWELLENWERT beträgt 5% (§ 16 MRG Standardwert)', () => {
    expect(SCHWELLENWERT).toBe(0.05);
  });
});
