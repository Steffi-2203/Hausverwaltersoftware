/**
 * PII-Maskierung für Log-Ausgaben.
 *
 * Sensible Werte (IBAN, BIC, Kontonummern) dürfen niemals vollständig
 * in Logs erscheinen. Diese Helfer maskieren den Großteil des Wertes
 * und zeigen nur genug, um das Debugging zu unterstützen.
 */

/**
 * Maskiert eine IBAN für Log-Ausgaben.
 * Zeigt Ländercode + Prüfziffer (4 Zeichen) und die letzten 4 Zeichen;
 * der Rest wird mit '*' ersetzt.
 *
 * Beispiel:  AT611904300234573201  →  AT61****3201
 */
export function maskIban(iban: string | null | undefined): string {
  if (!iban) return "[keine IBAN]";
  const clean = iban.replace(/\s/g, "").toUpperCase();
  if (clean.length < 8) return "****";
  const visible = 4; // Ländercode + Prüfziffer
  const tail = 4;
  const masked = clean.length - visible - tail;
  return clean.slice(0, visible) + "*".repeat(Math.max(0, masked)) + clean.slice(-tail);
}

/**
 * Maskiert ein beliebiges sensibles Feld.
 * Zeigt die letzten `visibleSuffix` Zeichen, Rest wird mit '*' ersetzt.
 *
 * Beispiel (visibleSuffix=4):  BKAUATWW  →  ****ATWW
 */
export function maskField(
  value: string | null | undefined,
  visibleSuffix = 4
): string {
  if (!value) return "[leer]";
  if (value.length <= visibleSuffix) return "*".repeat(value.length);
  return "*".repeat(value.length - visibleSuffix) + value.slice(-visibleSuffix);
}

/**
 * Maskiert einen BIC-Code für Log-Ausgaben.
 *
 * Beispiel:  BKAUATWW  →  BKA*ATWW
 */
export function maskBic(bic: string | null | undefined): string {
  if (!bic) return "[kein BIC]";
  const clean = bic.replace(/\s/g, "").toUpperCase();
  if (clean.length < 6) return "****";
  return clean.slice(0, 3) + "*".repeat(clean.length - 6) + clean.slice(-3);
}
