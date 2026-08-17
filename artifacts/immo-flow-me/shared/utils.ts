/**
 * Rundet auf ganze Cent (2 Nachkommastellen) — dezimalsicher, kaufmännisch
 * (half away from zero). Zentrale Rundungsfunktion für alle Geldbeträge im
 * gesamten System: billing.service (dryRun + persist), upsert tools, dryrun
 * script, tests.
 *
 * Warum nicht `Math.round(v*100)/100`: IEEE-754-Floats machen daraus stille
 * Fehler (1.005*100 === 100.49999... → 1.00 statt 1.01) und Math.round
 * rundet Negativwerte Richtung +∞ statt kaufmännisch.
 * Diese Implementierung rekonstruiert den Dezimalwert string-basiert über
 * toFixed(3) und rundet ab der Zehntel-Cent-Stelle kaufmännisch.
 *
 * Alias: roundToCents (identisch, für explizite Semantik)
 */
export function roundMoney(value: number): number {
  const n = Number(value) || 0;
  const neg = n < 0;
  // Kürzeste Round-Trip-Dezimaldarstellung verwenden (String(n)), damit die
  // vom Aufrufer gemeinte Zahl (z. B. 1.005) erhalten bleibt, aber KEIN
  // Double-Rounding entsteht (1.0046 darf nicht über "1.005" zu 1.01 werden).
  let s = String(Math.abs(n));
  if (s.includes("e") || s.includes("E")) s = Math.abs(n).toFixed(20);
  const [intPart, frac = ""] = s.split(".");
  let cents = Number(intPart) * 100 + Number((frac + "00").slice(0, 2));
  // Einstufige kaufmännische Entscheidung: Rest ≥ 0.5 Cent ⟺ 3. Dezimalziffer ≥ 5
  if (frac.length > 2 && Number(frac[2]) >= 5) cents += 1;
  return (neg ? -cents : cents) / 100;
}

export const roundToCents = roundMoney;

export function formatMoney(amount: number, locale: string = 'de-AT'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
  }).format(amount);
}

export function parseMoneyInput(input: string): number {
  const cleaned = input.replace(/[^\d,.-]/g, '').replace(',', '.');
  return roundMoney(parseFloat(cleaned) || 0);
}
