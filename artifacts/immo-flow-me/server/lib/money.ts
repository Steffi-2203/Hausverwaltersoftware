/**
 * money.ts — Zentrale Geld-Arithmetik für ImmoflowMe
 *
 * Grundregel: Alle Berechnungen intern in INTEGER-CENTS, nie in Float-Euros.
 *
 * Warum: IEEE-754-Floats können Dezimalbeträge nicht exakt darstellen.
 *   Math.round(1.005 * 100) / 100  === 1.00   // FALSCH, kaufmännisch wäre 1.01
 *   0.1 + 0.2                      === 0.30000000000000004
 * Bei Abrechnungen (HeizKG, MRG §21, SEPA) sind solche Fehler nicht tolerierbar.
 *
 * Konventionen:
 * - `Cents` ist ein ganzzahliger EUR-Betrag in Cent (number, aber immer Integer).
 * - Kaufmännische Rundung = "round half away from zero" (0.005 → 0.01, -0.005 → -0.01).
 *   Das entspricht der in Österreich üblichen kaufmännischen Rundung; JS-Math.round
 *   rundet Negativwerte stattdessen Richtung +∞ und ist daher NICHT geeignet.
 */

export type Cents = number;

/** Kaufmännische Rundung (half away from zero) auf Ganzzahl. */
export function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Euro-Betrag (Float oder String) exakt in Integer-Cents umwandeln.
 * String-basiert, um Float-Repräsentationsfehler zu neutralisieren:
 * toCents(1.005) === 101, toCents("19.90") === 1990.
 */
export function toCents(euro: number | string): Cents {
  if (typeof euro === "string") {
    const trimmed = euro.trim().replace(",", ".");
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      throw new Error(`Ungültiger Geldbetrag: "${euro}"`);
    }
    // Exakt über Dezimalstellen-Verschiebung, kein parseFloat-Umweg für die Cents
    const neg = trimmed.startsWith("-");
    const [intPart, fracPart = ""] = trimmed.replace("-", "").split(".");
    const frac3 = (fracPart + "000").slice(0, 3); // auf Zehntel-Cent genau lesen
    let cents = Number(intPart) * 100 + Number(frac3.slice(0, 2));
    if (Number(frac3[2]) >= 5) cents += 1; // kaufmännisch ab Zehntel-Cent
    return neg ? -cents : cents;
  }
  if (!Number.isFinite(euro)) {
    throw new Error(`Ungültiger Geldbetrag: ${euro}`);
  }
  // Float-Pfad: kürzeste Round-Trip-Dezimaldarstellung (String(n)) verwenden —
  // KEIN toFixed(3), das wäre Double-Rounding (1.0046 → "1.005" → 101 statt 100).
  let s = String(euro);
  if (s.includes("e") || s.includes("E")) s = euro.toFixed(20);
  return toCents(s);
}

/** Integer-Cents zurück in einen Euro-number (exakt bis 2 Nachkommastellen). */
export function fromCents(cents: Cents): number {
  assertCents(cents);
  return cents / 100;
}

/** Euro-Float kaufmännisch auf 2 Nachkommastellen runden — float-sicher. */
export function roundEuro(euro: number): number {
  return fromCents(toCents(euro));
}

/** Anteil eines Cent-Betrags: pool * ratio, kaufmännisch auf ganze Cents gerundet. */
export function shareOfCents(poolCents: Cents, ratio: number): Cents {
  assertCents(poolCents);
  if (!Number.isFinite(ratio)) throw new Error(`Ungültige Quote: ${ratio}`);
  return roundHalfAwayFromZero(poolCents * ratio);
}

/** Prozentsatz eines Cent-Betrags (z. B. USt, Verteilschlüssel-Prozente). */
export function percentOfCents(cents: Cents, pct: number): Cents {
  return shareOfCents(cents, pct / 100);
}

/** Summe von Cent-Beträgen (exakt, da Integer). */
export function sumCents(values: Cents[]): Cents {
  let total = 0;
  for (const v of values) {
    assertCents(v);
    total += v;
  }
  return total;
}

/**
 * Cent-Betrag proportional zu Gewichten verteilen — restcent-frei
 * (Hare/Niemeyer-Verfahren, "largest remainder"): Die Summe der Teile
 * ergibt IMMER exakt den Ausgangsbetrag. Für Verteilschlüssel geeignet,
 * wenn kein expliziter Restcent-Ausweis gewünscht ist.
 */
export function distributeCents(totalCents: Cents, weights: number[]): Cents[] {
  assertCents(totalCents);
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (weights.length === 0) return [];
  if (weightSum <= 0) {
    // Gleichverteilung als Fallback
    return distributeCents(totalCents, weights.map(() => 1));
  }
  const raw = weights.map((w) => (totalCents * w) / weightSum);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = totalCents - floors.reduce((s, f) => s + f, 0);
  // Größte Nachkommareste bekommen die verbleibenden Cents
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const result = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const idx = order[k]!.i;
    result[idx] = (result[idx] ?? 0) + 1;
  }
  return result;
}

/**
 * USt aus einem BRUTTO-Cent-Betrag herausrechnen:
 * brutto * satz / (100 + satz), kaufmännisch auf ganze Cents gerundet.
 * Beispiel: ustFromGrossCents(110000, 10) === 10000 (1.100,00 € → 100,00 € USt).
 */
export function ustFromGrossCents(grossCents: Cents, ratePct: number): Cents {
  assertCents(grossCents);
  if (!Number.isFinite(ratePct) || ratePct < 0) {
    throw new Error(`Ungültiger USt-Satz: ${ratePct}`);
  }
  if (ratePct === 0) return 0;
  return roundHalfAwayFromZero((grossCents * ratePct) / (100 + ratePct));
}

/** Cent-Betrag als deutschsprachigen EUR-String formatieren: 123456 → "1.234,56 €". */
export function formatCents(cents: Cents): string {
  assertCents(cents);
  return (cents / 100).toLocaleString("de-AT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function assertCents(cents: number): void {
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`Erwartet Integer-Cents, erhalten: ${cents}`);
  }
}

/**
 * Validiert einen Geld-Eingabewert für numeric(12,2)-Spalten.
 * Akzeptiert number oder String (Komma oder Punkt), rundet kaufmännisch
 * auf 2 Nachkommastellen und prüft den Wertebereich (max. 10 Vorkommastellen).
 * Rückgabe: normalisierter String für die DB, oder Error bei ungültiger Eingabe.
 */
export function parseMoneyInput(
  value: unknown,
  fieldLabel: string,
  maxIntegerDigits: number = 10,
): { value: string } | { error: string } {
  if (typeof value !== "number" && typeof value !== "string") {
    return { error: `${fieldLabel}: Zahl erwartet` };
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return { error: `${fieldLabel}: Zahl erwartet` };
  }
  let cents: Cents;
  try {
    cents = toCents(typeof value === "number" ? value : value);
  } catch {
    return { error: `${fieldLabel}: Ungültiger Geldbetrag` };
  }
  // numeric(12,2): max. 10 Vorkommastellen → |Betrag| ≤ 9.999.999.999,99
  // (bei engeren Spalten wie numeric(10,2) via maxIntegerDigits=8 einschränkbar)
  const maxCents = Number(`${"9".repeat(maxIntegerDigits)}99`);
  if (Math.abs(cents) > maxCents) {
    const maxEuro = (maxCents / 100).toLocaleString("de-AT", { minimumFractionDigits: 2 });
    return { error: `${fieldLabel}: Betrag außerhalb des zulässigen Bereichs (max. ${maxEuro})` };
  }
  return { value: (cents / 100).toFixed(2) };
}

/**
 * Validiert mehrere optionale Geld-Felder eines Request-Bodys über
 * parseMoneyInput und NORMALISIERT sie in-place auf DB-taugliche Strings.
 * Felder, die fehlen/null/leer sind, werden übersprungen.
 * Rückgabe: erste Fehlermeldung (mit Feldname) oder null wenn alles gültig.
 */
export function validateMoneyFields(
  body: Record<string, unknown>,
  fields: Record<string, string>,
  maxIntegerDigits: number = 10,
): string | null {
  for (const [key, label] of Object.entries(fields)) {
    const v = body[key];
    if (v === undefined || v === null || v === "") continue;
    const r = parseMoneyInput(v, label, maxIntegerDigits);
    if ("error" in r) return r.error;
    body[key] = r.value;
  }
  return null;
}
