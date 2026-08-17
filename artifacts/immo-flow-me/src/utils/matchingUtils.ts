/**
 * Gemeinsame Utility-Funktionen für das Matching von 
 * Transaktionen und Ausgaben
 */

/**
 * Fuzzy string matching - vergleicht zwei Strings und gibt Score 0-1 zurück
 * @param str1 - Erster String zum Vergleich
 * @param str2 - Zweiter String zum Vergleich
 * @returns Score zwischen 0 (keine Übereinstimmung) und 1 (exakte Übereinstimmung)
 */
export function fuzzyMatch(str1: string | null, str2: string | null): number {
  if (!str1 || !str2) return 0;
  
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  if (s1 === s2) return 1;
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;
  
  // Check for common words
  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);
  const commonWords = words1.filter(w => words2.some(w2 => w2.includes(w) || w.includes(w2)));
  
  if (commonWords.length > 0) {
    return 0.5 + (commonWords.length / Math.max(words1.length, words2.length)) * 0.3;
  }
  
  return 0;
}

/**
 * Prüft ob zwei Daten innerhalb eines Bereichs liegen
 * @param date1 - Erstes Datum (ISO string)
 * @param date2 - Zweites Datum (ISO string)
 * @param rangeDays - Maximale Differenz in Tagen (Standard: 14)
 * @returns true wenn Daten innerhalb des Bereichs
 */
export function datesWithinRange(
  date1: string, 
  date2: string, 
  rangeDays: number = 14
): boolean {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffMs = Math.abs(d1.getTime() - d2.getTime());
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= rangeDays;
}

/**
 * Berechnet Proximity-Score basierend auf Datumsunterschied
 * @param date1 - Erstes Datum (ISO string)
 * @param date2 - Zweites Datum (ISO string)
 * @returns Score zwischen 0.3 (>7 Tage) und 1 (gleicher Tag)
 */
export function dateProximityScore(date1: string, date2: string): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffDays = Math.abs(d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24);
  
  if (diffDays === 0) return 1;
  if (diffDays <= 1) return 0.9;
  if (diffDays <= 3) return 0.7;
  if (diffDays <= 7) return 0.5;
  return 0.3;
}
