/**
 * MRG-Mietzinsberechnung — Tests für mrgRentCalculationService.ts
 *
 * Prüft Richtwert-Fall, Kategorie-B-Fall, Befristungsabschlag und Freier-Markt-Fall.
 */
import { describe, it } from 'node:test';
import { expect } from '../helpers/expect';
import {
  calculateMrgRent,
  checkMrgExcess,
  RICHTWERTE_2025,
  KATEGORIE_MIETZINSE,
} from '../../server/services/mrgRentCalculationService';

describe('calculateMrgRent — Richtwertmietzins', () => {
  it('Wien, 60m², ohne Zuschläge: Grundbetrag = 60 × 6.67 = 400.20 €', () => {
    const result = calculateMrgRent({ rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 60 });
    expect(result).not.toBeNull();
    expect(result!.zulassigerHmz).toBe(400.20);
    expect(result!.befristungsabschlag).toBe(0);
    expect(result!.rentType).toBe('richtwert');
  });

  it('Lagezuschlag +10%: erhöht zulässigen HMZ proportional', () => {
    const ohne = calculateMrgRent({ rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 60 });
    const mit   = calculateMrgRent({ rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 60, lagezuschlag: 10 });
    expect(mit!.zulassigerHmz).toBeCloseTo(ohne!.zulassigerHmz * 1.10, 1);
  });

  it('Berechnungsgrundlage enthält § 16 MRG', () => {
    const result = calculateMrgRent({ rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 50 });
    expect(result!.berechnungsgrundlage).toContain('§ 16');
  });
});

describe('calculateMrgRent — Kategoriemietzins', () => {
  it('Kategorie B, 50m²: zulässiger HMZ = 50 × 3.35 = 167.50 €', () => {
    const result = calculateMrgRent({ rentType: 'kategorie', kategorie: 'B', nutzflaeche: 50 });
    expect(result).not.toBeNull();
    expect(result!.zulassigerHmz).toBe(167.50);
    expect(result!.berechnungsgrundlage).toContain('§ 15a MRG');
  });

  it('Kategorie A: höherer Satz als Kategorie B', () => {
    const a = calculateMrgRent({ rentType: 'kategorie', kategorie: 'A', nutzflaeche: 50 });
    const b = calculateMrgRent({ rentType: 'kategorie', kategorie: 'B', nutzflaeche: 50 });
    expect(a!.zulassigerHmz).toBeGreaterThan(b!.zulassigerHmz);
  });
});

describe('calculateMrgRent — Befristungsabschlag (§ 16 Abs. 7 MRG)', () => {
  // § 16 Abs. 7 MRG: Befristete Mietverhältnisse erhalten 25% Abschlag auf den
  // zulässigen HMZ. Mindestlaufzeit nach § 29 MRG = 3 Jahre (das ist die
  // Untergrenze für gültige befristete Mietverhältnisse, NICHT die Schwelle
  // für den Abschlag — der Abschlag gilt für ALLE befristeten MRG-Mietverhältnisse).

  it('befristet=true: immer 25% Abschlag (§ 16 Abs. 7 MRG gilt für alle befristeten MRG-Verträge)', () => {
    const unbefristet = calculateMrgRent({ rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 60 });
    const befristet   = calculateMrgRent({ rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 60, befristet: true, laufzeitJahre: 3 });
    expect(befristet!.befristungsabschlag).toBe(25);
    expect(befristet!.zulassigerHmz).toBeCloseTo(unbefristet!.zulassigerHmz * 0.75, 1);
  });

  it('befristet=true, Laufzeit 5 Jahre: ebenfalls 25% Abschlag (Laufzeit ist nicht die Schwelle)', () => {
    const unbefristet = calculateMrgRent({ rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 60 });
    const befristet   = calculateMrgRent({ rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 60, befristet: true, laufzeitJahre: 5 });
    expect(befristet!.befristungsabschlag).toBe(25);
    expect(befristet!.zulassigerHmz).toBeCloseTo(unbefristet!.zulassigerHmz * 0.75, 1);
  });

  it('unbefristet: kein Abschlag', () => {
    const result = calculateMrgRent({ rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 60, befristet: false });
    expect(result!.befristungsabschlag).toBe(0);
  });

  it('Kategorie B, befristet: 25% Abschlag', () => {
    const result = calculateMrgRent({ rentType: 'kategorie', kategorie: 'B', nutzflaeche: 50, befristet: true });
    expect(result!.befristungsabschlag).toBe(25);
    expect(result!.zulassigerHmz).toBeCloseTo(167.50 * 0.75, 1);
  });
});

describe('calculateMrgRent — Freier Markt', () => {
  it('freier Markt: kein gesetzliches Limit (Infinity)', () => {
    const result = calculateMrgRent({ rentType: 'frei', nutzflaeche: 60 });
    expect(result!.zulassigerHmz).toBe(Infinity);
    expect(result!.rentType).toBe('frei');
  });
});

describe('checkMrgExcess — Überschreitungsprüfung', () => {
  it('Miete unter Limit: ueberschritten = false', () => {
    const check = checkMrgExcess(300, { rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 60 });
    expect(check.ueberschritten).toBe(false);
  });

  it('Miete über Limit: ueberschritten = true, Differenz korrekt', () => {
    // Wien 60m² = 400.20 €, Miete 500 € → Differenz 99.80 €
    const check = checkMrgExcess(500, { rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 60 });
    expect(check.ueberschritten).toBe(true);
    expect(check.differenz).toBeCloseTo(99.80, 1);
  });

  it('lagezuschlag > 0 erhöht den zulässigen HMZ (§ 16 Abs. 2 MRG)', () => {
    // Wien 75 m² Basis = 500,25 €; +10 % Lagezuschlag → 550,28 €
    const base = checkMrgExcess(520, { rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 75 });
    expect(base.ueberschritten).toBe(true);
    expect(base.zulassigerHmz).toBeCloseTo(500.25, 2);

    const mitZuschlag = checkMrgExcess(520, { rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 75, lagezuschlag: 10 });
    expect(mitZuschlag.zulassigerHmz).toBeCloseTo(550.28, 2);
    expect(mitZuschlag.ueberschritten).toBe(false);
    expect(mitZuschlag.differenz).toBeCloseTo(520 - 550.28, 2);
  });

  it('abschlaege < 0 senkt den zulässigen HMZ', () => {
    // Wien 75 m² Basis = 500,25 €; -5 % Abschlag → 475,24 €
    const base = checkMrgExcess(490, { rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 75 });
    expect(base.ueberschritten).toBe(false);

    const mitAbschlag = checkMrgExcess(490, { rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 75, abschlaege: -5 });
    expect(mitAbschlag.zulassigerHmz).toBeCloseTo(475.24, 2);
    expect(mitAbschlag.ueberschritten).toBe(true);
    expect(mitAbschlag.differenz).toBeCloseTo(490 - 475.24, 2);
  });

  it('lagezuschlag und abschlaege kombiniert mit Befristungsabschlag', () => {
    // Wien 75 m²: (1 + (10 - 20)/100) → 450,23 €; befristet → × 0,75 = 337,67 €
    const check = checkMrgExcess(400, {
      rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 75,
      lagezuschlag: 10, abschlaege: -20, befristet: true,
    });
    expect(check.zulassigerHmz).toBeCloseTo(337.67, 2);
    expect(check.ueberschritten).toBe(true);
  });

  it('Rundung: 25%-Abschlag wird auf voller Präzision berechnet (keine Zwischenrundung)', () => {
    // Wien 75 m², Lagezuschlag 0,13 %: raw = 500,25 × 1,0013 = 500,900325
    // Zwischenrundung (500,90 × 0,75) ergäbe 375,67 — korrekt ist 375,68.
    const check = checkMrgExcess(400, {
      rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 75,
      lagezuschlag: 0.13, befristet: true,
    });
    expect(check.zulassigerHmz).toBeCloseTo(375.68, 2);
  });

  it('freier Markt: nie überschritten', () => {
    const check = checkMrgExcess(9999, { rentType: 'frei', nutzflaeche: 60 });
    expect(check.ueberschritten).toBe(false);
  });
});

describe('Richtwert-Konstanten', () => {
  it('alle 9 Bundesländer sind definiert', () => {
    const bundeslaender = ['Wien', 'Niederösterreich', 'Oberösterreich', 'Salzburg', 'Tirol', 'Vorarlberg', 'Steiermark', 'Kärnten', 'Burgenland'];
    for (const bl of bundeslaender) {
      expect(RICHTWERTE_2025[bl]).toBeGreaterThan(0);
    }
  });

  it('Kategoriesätze A > B > C', () => {
    expect(KATEGORIE_MIETZINSE['A']!).toBeGreaterThan(KATEGORIE_MIETZINSE['B']!);
    expect(KATEGORIE_MIETZINSE['B']!).toBeGreaterThan(KATEGORIE_MIETZINSE['C']!);
  });
});
