/**
 * IBAN-Validierung nach ISO 7064 (Modulo-97-Algorithmus)
 *
 * Validiert IBAN-Prüfziffern korrekt — reine Regex-Prüfungen erkennen
 * falsch eingegebene IBANs (falsche Prüfziffer) nicht.
 *
 * Supported: AT (20), DE (22), CH (21), + generische Längen-Checks
 */

/** Bekannte IBAN-Längen nach Land (ISO 13616) */
const IBAN_LENGTHS: Record<string, number> = {
  AT: 20,
  DE: 22,
  CH: 21,
  LI: 21,
  LU: 20,
  NL: 18,
  BE: 16,
  FR: 27,
  IT: 27,
  ES: 24,
  PL: 28,
  CZ: 24,
  HU: 28,
  SK: 24,
  SI: 19,
  HR: 21,
  BA: 20,
  RS: 22,
  ME: 22,
  MK: 19,
  BG: 22,
  RO: 24,
  GB: 22,
};

export interface IbanValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Ersetzt Buchstaben durch Ziffern für den Modulo-97-Algorithmus:
 * A=10, B=11, ..., Z=35
 */
function lettersToDigits(str: string): string {
  return str
    .split('')
    .map(ch => {
      const code = ch.charCodeAt(0);
      if (code >= 65 && code <= 90) {
        // A=10 ... Z=35
        return String(code - 55);
      }
      return ch;
    })
    .join('');
}

/**
 * Berechnet BigInt-Modulo-97 für sehr lange Ziffernstrings.
 * Teilt den String in 9-stellige Chunks um JS-Number-Overflow zu vermeiden.
 */
function mod97(numStr: string): number {
  let remainder = 0;
  for (let i = 0; i < numStr.length; i += 7) {
    const chunk = remainder.toString() + numStr.slice(i, i + 7);
    remainder = parseInt(chunk, 10) % 97;
  }
  return remainder;
}

/**
 * Validiert eine IBAN nach ISO 7064 (Modulo-97-Algorithmus).
 *
 * @param iban - IBAN-String (mit oder ohne Leerzeichen, Groß- oder Kleinschreibung)
 * @returns { valid, error? }
 */
export function validateIban(iban: string): IbanValidationResult {
  if (!iban || typeof iban !== 'string') {
    return { valid: false, error: 'IBAN darf nicht leer sein' };
  }

  // Leerzeichen entfernen, Großschreibung erzwingen
  const cleaned = iban.replace(/\s+/g, '').toUpperCase();

  // Grundformat: 2 Buchstaben Ländercode + 2 Ziffern Prüfziffer + 4–30 Zeichen BBAN
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/.test(cleaned)) {
    return { valid: false, error: `Ungültiges IBAN-Format: ${cleaned}` };
  }

  const countryCode = cleaned.slice(0, 2);
  const expectedLength = IBAN_LENGTHS[countryCode];

  if (expectedLength && cleaned.length !== expectedLength) {
    return {
      valid: false,
      error: `IBAN für ${countryCode} muss ${expectedLength} Zeichen lang sein (ist ${cleaned.length})`,
    };
  }

  // Modulo-97: Ländercode + Prüfziffer an das Ende verschieben
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);

  // Buchstaben in Ziffern umwandeln
  const digits = lettersToDigits(rearranged);

  // Prüfziffer: mod97 muss 1 ergeben
  const remainder = mod97(digits);
  if (remainder !== 1) {
    return {
      valid: false,
      error: `Ungültige IBAN (Prüfziffer falsch): ${cleaned}`,
    };
  }

  return { valid: true };
}

/**
 * Kurzform: gibt true zurück wenn die IBAN gültig ist.
 */
export function isValidIban(iban: string): boolean {
  return validateIban(iban).valid;
}
