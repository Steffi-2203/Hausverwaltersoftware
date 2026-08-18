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

  it('Lagezuschlag +1.00 €/m²: erhöht zulässigen HMZ um lagezuschlag × Fläche', () => {
    // HMZ = (6,67 + 1,00) × 60 = 460,20 € — d.h. um genau 1,00 × 60 = 60 € mehr als ohne
    const ohne = calculateMrgRent({ rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 60 });
    const mit   = calculateMrgRent({ rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 60, lagezuschlag: 1.0 });
    expect(mit!.zulassigerHmz).toBeCloseTo(ohne!.zulassigerHmz + 1.0 * 60, 1);
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

  it('lagezuschlag 0.50 €/m² erhöht den zulässigen HMZ (§ 16 Abs. 2 MRG)', () => {
    // Wien 75 m² Basis = 500,25 €; +0,50 €/m² → (6,67+0,50) × 75 = 537,75 €
    const base = checkMrgExcess(520, { rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 75 });
    expect(base.ueberschritten).toBe(true);
    expect(base.zulassigerHmz).toBeCloseTo(500.25, 2);

    const mitZuschlag = checkMrgExcess(520, { rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 75, lagezuschlag: 0.50 });
    expect(mitZuschlag.zulassigerHmz).toBeCloseTo(537.75, 2);
    expect(mitZuschlag.ueberschritten).toBe(false);
    expect(mitZuschlag.differenz).toBeCloseTo(520 - 537.75, 2);
  });

  it('abschlaege -0.50 €/m² senkt den zulässigen HMZ', () => {
    // Wien 75 m² Basis = 500,25 €; Grundmiete 490 → nicht überschritten
    const base = checkMrgExcess(490, { rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 75 });
    expect(base.ueberschritten).toBe(false);

    // Mit Abschlag -0,50 €/m²: HMZ = (6,67 − 0,50) × 75 = 462,75 €
    const mitAbschlag = checkMrgExcess(490, { rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 75, abschlaege: -0.50 });
    expect(mitAbschlag.zulassigerHmz).toBeCloseTo(462.75, 2);
    expect(mitAbschlag.ueberschritten).toBe(true);
    expect(mitAbschlag.differenz).toBeCloseTo(490 - 462.75, 2);
  });

  it('lagezuschlag und abschlaege kombiniert mit Befristungsabschlag', () => {
    // Wien 75 m²: (6,67 + 0,50 − 1,00) × 75 = 6,17 × 75 = 462,75 €
    // befristet → × 0,75 = 347,0625 → 347,06 €
    const check = checkMrgExcess(400, {
      rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 75,
      lagezuschlag: 0.50, abschlaege: -1.00, befristet: true,
    });
    expect(check.zulassigerHmz).toBeCloseTo(347.06, 2);
    expect(check.ueberschritten).toBe(true);
  });

  it('Rundung: 25%-Abschlag wird auf voller Präzision berechnet (keine Zwischenrundung)', () => {
    // Wien 75 m², Lagezuschlag 0,001 €/m²: raw = (6,67 + 0,001) × 75 = 500,325
    // Korrekt:  500,325 × 0,75 = 375,24375 → 375,24
    // Mit Zwischenrundung: round(500,325) = 500,33 → × 0,75 = 375,2475 → 375,25 (falsch)
    const check = checkMrgExcess(400, {
      rentType: 'richtwert', bundesland: 'Wien', nutzflaeche: 75,
      lagezuschlag: 0.001, befristet: true,
    });
    expect(check.zulassigerHmz).toBeCloseTo(375.24, 2);
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
