/**
 * MRG-Mietzinsberechnung — reiner Berechnungsservice ohne DB-Aufrufe.
 *
 * Berechnet den zulässigen Hauptmietzins nach § 16 MRG:
 *  - Richtwertmietzins (§ 16 Abs. 2 MRG)
 *  - Kategoriemietzins (§ 15a MRG)
 *  - Freier Markt (kein gesetzliches Limit)
 *
 * Richtwerte 2025/2026 (§ 5 RichtWG), Kategoriemietzinse § 15a MRG (indexiert).
 */

import { roundMoney } from "@shared/utils";

export type MrgRentType = 'richtwert' | 'kategorie' | 'frei';

/** Richtwerte je Bundesland (€/m², Stand 2025/2026). */
export const RICHTWERTE_2025: Record<string, number> = {
  Wien:            6.67,
  Niederösterreich: 6.85,
  Oberösterreich:  7.23,
  Salzburg:        9.22,
  Tirol:           8.14,
  Vorarlberg:     10.25,
  Steiermark:      9.21,
  Kärnten:         7.81,
  Burgenland:      6.09,
};

/** Kategoriemietzinse § 15a MRG (€/m²/Monat, Stand 2024). */
export const KATEGORIE_MIETZINSE: Record<string, number> = {
  A:             4.47,
  B:             3.35,
  C:             2.24,
  D_brauchbar:   2.24,
  D_unbrauchbar: 1.12,
};

export interface MrgRentInput {
  rentType:         MrgRentType;
  nutzflaeche:      number;        // m²
  // Richtwert-Parameter
  bundesland?:      string;
  /**
   * Lagezuschlag in €/m² (≥ 0) nach § 16 Abs. 2 MRG.
   * Wird zum Richtwert addiert, bevor mit der Nutzfläche multipliziert wird:
   *   HMZ = (Richtwert_€/m² + lagezuschlag + abschlaege) × m²
   * Typische Werte: 0 – 4 €/m² (Quelle: Lagezuschlags-Rechner der Gemeinde).
   */
  lagezuschlag?:    number;        // €/m² (nicht Prozent)
  /**
   * Ausstattungs-/sonstige Abschläge in €/m² (≤ 0) nach § 16 Abs. 2 MRG.
   * Negativer Betrag; wird ebenfalls zum Richtwert addiert (vermindert HMZ).
   */
  abschlaege?:      number;        // €/m² (nicht Prozent, muss ≤ 0 sein)
  // Kategorie-Parameter
  kategorie?:       keyof typeof KATEGORIE_MIETZINSE;
  // Befristungsparameter (§ 16 Abs. 7 MRG)
  befristet?:       boolean;
  laufzeitJahre?:   number;        // Laufzeit in Jahren (Befristungsabschlag wenn ≤ 3 Jahre)
}

export interface MrgRentResult {
  zulassigerNettomietzins: number;   // Maximalmiete ohne Befristungsabschlag (€/Monat)
  befristungsabschlag:     number;   // Abschlag in % (0 oder 25)
  zulassigerHmz:           number;   // Maximalmiete nach Befristungsabschlag (€/Monat)
  berechnungsgrundlage:    string;   // Gesetzliche Grundlage
  rentType:                MrgRentType;
}

/**
 * Berechnet den zulässigen Hauptmietzins nach MRG.
 * Gibt null zurück für 'frei' Mietrecht (kein gesetzliches Limit).
 */
export function calculateMrgRent(input: MrgRentInput): MrgRentResult | null {
  const { rentType, nutzflaeche, befristet = false, laufzeitJahre } = input;

  if (rentType === 'frei') {
    return {
      zulassigerNettomietzins: Infinity,
      befristungsabschlag: 0,
      zulassigerHmz: Infinity,
      berechnungsgrundlage: 'Freier Markt — kein gesetzliches Limit (§ 16 Abs. 1 MRG)',
      rentType: 'frei',
    };
  }

  // Befristungsabschlag: § 16 Abs. 7 MRG — 25% für alle befristeten Mietverhältnisse.
  // Mindestlaufzeit nach § 29 MRG ist 3 Jahre; das ist die Untergrenze für ein gültiges
  // befristetes Mietverhältnis, NICHT die Schwelle für den Abschlag.
  // Der Abschlag gilt für JEDES befristete Mietverhältnis (Mindestlaufzeit 3 Jahre).
  const befristungsabschlag = befristet ? 25 : 0;

  if (rentType === 'richtwert') {
    const bundesland = input.bundesland ?? 'Wien';
    const baseRichtwert = RICHTWERTE_2025[bundesland] ?? RICHTWERTE_2025['Wien']!;
    const lagezuschlag = input.lagezuschlag ?? 0;  // €/m²
    const abschlaege   = input.abschlaege   ?? 0;  // €/m² (≤ 0)

    // Gesetzeskonforme Formel nach § 16 Abs. 2 MRG:
    //   HMZ = (Richtwert_€/m² + Lagezuschlag_€/m² + Abschläge_€/m²) × Nutzfläche_m²
    //
    // Die Zu-/Abschläge werden zum Richtwert addiert, BEVOR mit der Fläche
    // multipliziert wird.  Erst das Endergebnis runden — Zwischenrundung
    // vor dem 25%-Befristungsabschlag (§ 16 Abs. 7) kann den HMZ um 1 Cent
    // verfälschen (gesetzliche Obergrenze!).
    const rawNetto = (baseRichtwert + lagezuschlag + abschlaege) * nutzflaeche;
    const zulassigerNettomietzins = roundMoney(rawNetto);
    // zulassigerHmz = endgültiger Höchstmietzins NACH §16 Abs.7 Abschlag
    const zulassigerHmz = befristungsabschlag > 0
      ? roundMoney(rawNetto * 0.75)
      : zulassigerNettomietzins;

    const lagezuschlagLabel = lagezuschlag !== 0
      ? `, Lagezuschlag ${lagezuschlag.toFixed(2)} €/m²`
      : '';
    const abschlaegeLabel = abschlaege !== 0
      ? `, Abschläge ${abschlaege.toFixed(2)} €/m²`
      : '';

    return {
      zulassigerNettomietzins,
      befristungsabschlag,
      zulassigerHmz,
      berechnungsgrundlage: `Richtwert ${bundesland} ${baseRichtwert} €/m²${lagezuschlagLabel}${abschlaegeLabel} (§ 16 Abs. 2 MRG, Stand 2025/2026)`,
      rentType: 'richtwert',
    };
  }

  if (rentType === 'kategorie') {
    const kategorie = input.kategorie ?? 'B';
    const rate = KATEGORIE_MIETZINSE[kategorie] ?? KATEGORIE_MIETZINSE['B']!;
    const rawNetto = nutzflaeche * rate;
    const zulassigerNettomietzins = roundMoney(rawNetto);
    const zulassigerHmz = befristungsabschlag > 0
      ? roundMoney(rawNetto * 0.75)
      : zulassigerNettomietzins;

    return {
      zulassigerNettomietzins,
      befristungsabschlag,
      zulassigerHmz,
      berechnungsgrundlage: `Kategorie ${kategorie}: ${rate} €/m² (§ 15a MRG)`,
      rentType: 'kategorie',
    };
  }

  return null;
}

/**
 * Prüft ob eine Grundmiete den zulässigen Höchstmietzins übersteigt.
 */
export function checkMrgExcess(grundmiete: number, input: MrgRentInput): {
  ueberschritten: boolean;
  differenz: number;
  zulassigerHmz: number | null;
  berechnungsgrundlage: string;
} {
  const result = calculateMrgRent(input);

  if (!result || result.rentType === 'frei' || result.zulassigerHmz === Infinity) {
    return { ueberschritten: false, differenz: 0, zulassigerHmz: null, berechnungsgrundlage: 'Freier Markt' };
  }

  const differenz = roundMoney(grundmiete - result.zulassigerHmz);
  return {
    ueberschritten: differenz > 0,
    differenz,
    zulassigerHmz: result.zulassigerHmz,
    berechnungsgrundlage: result.berechnungsgrundlage,
  };
}
