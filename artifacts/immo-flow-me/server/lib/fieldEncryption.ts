/**
 * Feldverschlüsselung für sensible PII- und Bankdaten (IBAN, BIC).
 *
 * Algorithmus:  AES-256-GCM
 * Schlüssel:    FIELD_ENCRYPTION_KEY (32-Byte, Base64-kodiert)
 * Ciphertext-Format: "enc:v1:" + Base64(IV[12] | AuthTag[16] | Ciphertext)
 *
 * Verhalten ohne FIELD_ENCRYPTION_KEY:
 *  - encryptField gibt den Klartext unverändert zurück + loggt einmalig eine Warnung.
 *  - decryptField gibt verschlüsselte Werte zurück, wenn der Schlüssel fehlt → wirft.
 *  - Plantext-Passthrough (kein enc:v1:-Präfix) ermöglicht rollende Datenmigration.
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;   // 96-bit IV für GCM
const TAG_BYTES = 16;
const PREFIX = "enc:v1:";

/** Mindestlänge für Passphrasen (nach dem Präfix), aus denen ein Schlüssel abgeleitet wird. */
const MIN_PASSPHRASE_LENGTH = 16;

/**
 * Explizites Präfix für Passphrasen-Schlüssel. Nur Werte, die exakt so
 * beginnen, werden per KDF abgeleitet — alles andere durchläuft weiterhin die
 * strikte Base64-Validierung. Damit kann ein vertipptes/korruptes Base64
 * niemals stillschweigend zu einem anderen (abgeleiteten) Schlüssel werden.
 */
const PASSPHRASE_PREFIX = "passphrase:";

/**
 * Fester, anwendungsspezifischer Salt für die Passphrase-Ableitung.
 * Muss stabil bleiben — eine Änderung würde alle abgeleiteten Schlüssel ändern
 * und bestehende Ciphertexte unlesbar machen.
 */
const PASSPHRASE_SALT = "immo-flow-me/field-encryption/v1";

const derivedKeyInfoLogged = new Set<string>();

/**
 * Löst einen Schlüsselwert auf:
 *  - "passphrase:<min. 16 Zeichen>" → deterministische scrypt-Ableitung (32 Bytes)
 *  - sonst: strikt kanonisches Base64, exakt 32 Bytes (fail-fast bei jedem
 *    malformten, falsch langen oder nicht-kanonischen Base64)
 */
function resolveKeyValue(raw: string, label: string): Buffer {
  // Umgebendes Whitespace (z.B. Zeilenumbruch beim Einfügen des Secrets)
  // tolerieren — der eigentliche Wert bleibt strikt validiert.
  const value = raw.trim();

  // Sonderfall: beim Einfügen mehrzeilig umbrochenes Base64 — nach Entfernen
  // von Whitespace muss es ein exakt kanonischer 32-Byte-Schlüssel sein,
  // sonst greift diese Normalisierung nicht.
  if (!value.startsWith(PASSPHRASE_PREFIX) && /\s/.test(value)) {
    const compact = value.replace(/\s+/g, "");
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
      const candidate = Buffer.from(compact, "base64");
      if (candidate.length === 32 && candidate.toString("base64") === compact) {
        return candidate;
      }
    }
  }

  // Passphrase-Fälle — beide eindeutig von einem (auch vertippten) Base64-
  // Schlüssel unterscheidbar:
  //  1. Explizites Präfix "passphrase:".
  //  2. Wert mit innenliegendem Whitespace (ein Base64-Schlüssel enthält nie
  //     Leerzeichen; ein Kopierfehler fügt keine hinzu — mehrzeilig
  //     umbrochenes Base64 wird oben separat normalisiert geprüft).
  const hasPrefix = value.startsWith(PASSPHRASE_PREFIX);
  const hasInnerWhitespace = /\s/.test(value);
  if (hasPrefix || hasInnerWhitespace) {
    const passphrase = hasPrefix ? value.slice(PASSPHRASE_PREFIX.length) : value;
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      throw new Error(
        `[fieldEncryption] ${label}: Passphrase muss ` +
        `mindestens ${MIN_PASSPHRASE_LENGTH} Zeichen haben.`,
      );
    }
    if (!derivedKeyInfoLogged.has(label)) {
      derivedKeyInfoLogged.add(label);
      console.info(
        `[fieldEncryption] ${label}: Schlüssel wird per scrypt aus der Passphrase ` +
        `abgeleitet. Wichtig: Passphrase nicht mehr ändern, sonst werden ` +
        `bestehende verschlüsselte Daten unlesbar.`,
      );
    }
    return crypto.scryptSync(passphrase, PASSPHRASE_SALT, 32);
  }

  // Strikt: nur kanonisches Base64 akzeptieren. Node's Buffer.from ignoriert
  // ungültige Zeichen still — deshalb Format-Check + Decode/Re-Encode-Vergleich.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(
      `[fieldEncryption] ${label}: Schlüssel ist kein gültiges Base64 (unerlaubte Zeichen). ` +
      `Alternativ eine Passphrase im Format '${PASSPHRASE_PREFIX}<min. ${MIN_PASSPHRASE_LENGTH} Zeichen>' verwenden.`,
    );
  }
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error(
      `[fieldEncryption] ${label}: Schlüssel muss exakt 32 Bytes (Base64) sein, aktuell: ${key.length} Bytes. ` +
      `Neuen Schlüssel mit ` +
      `'node -e "console.log(require(\\"crypto\\").randomBytes(32).toString(\\"base64\\"))"' erzeugen.`,
    );
  }
  if (key.toString("base64") !== value) {
    throw new Error(
      `[fieldEncryption] ${label}: Schlüssel ist kein kanonisches Base64 — exakt so verwenden, wie er erzeugt wurde.`,
    );
  }
  return key;
}

function getKey(): Buffer | null {
  const keyEnv = process.env.FIELD_ENCRYPTION_KEY?.trim();
  if (!keyEnv) return null;
  return resolveKeyValue(keyEnv, "FIELD_ENCRYPTION_KEY");
}

/**
 * Alt-Schlüssel für Schlüsselrotation (FIELD_ENCRYPTION_KEY_OLD).
 *
 * Rotationsablauf:
 *   1. Neuen Schlüssel als FIELD_ENCRYPTION_KEY setzen,
 *      bisherigen als FIELD_ENCRYPTION_KEY_OLD.
 *   2. Server neu starten — die Boot-Migration schlüsselt alle Bestandsdaten
 *      auf den neuen Schlüssel um; decryptField liest übergangsweise beides.
 *   3. FIELD_ENCRYPTION_KEY_OLD entfernen.
 */
function getOldKey(): Buffer | null {
  const keyEnv = process.env.FIELD_ENCRYPTION_KEY_OLD?.trim();
  if (!keyEnv) return null;
  return resolveKeyValue(keyEnv, "FIELD_ENCRYPTION_KEY_OLD");
}

/**
 * Wirft einen klaren Fehler wenn FIELD_ENCRYPTION_KEY nicht gesetzt ist.
 * Keine Plaintext-Fallbacks: ohne Schlüssel ist keine Verschlüsselung möglich.
 */
function requireKey(): Buffer {
  const key = getKey();
  if (!key) {
    throw new Error(
      "[fieldEncryption] FIELD_ENCRYPTION_KEY nicht gesetzt. " +
      "Einen 32-Byte-Base64-Schlüssel konfigurieren: " +
      "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\" " +
      "und als Umgebungsvariable FIELD_ENCRYPTION_KEY setzen."
    );
  }
  return key;
}

/**
 * Parst einen Base64-kodierten 32-Byte-Schlüssel (z.B. für Schlüsselrotation).
 * Wirft bei falscher Länge — identische Validierung wie FIELD_ENCRYPTION_KEY.
 */
export function parseEncryptionKey(base64Key: string): Buffer {
  // Identische Auflösung wie FIELD_ENCRYPTION_KEY: kanonisches Base64 (32 Byte)
  // bevorzugt, sonst scrypt-Ableitung aus einer Passphrase (min. 16 Zeichen).
  return resolveKeyValue(base64Key, "Schlüssel");
}

/** Gibt true zurück wenn der Wert mit dem Verschlüsselungspräfix beginnt. */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/**
 * Verschlüsselt einen Klartext-Wert.
 * - null/undefined → null
 * - Leerer String → leerer String
 * - Bereits verschlüsselte Werte werden nicht erneut verschlüsselt (idempotent).
 * - Ohne Schlüssel: Klartext wird unverändert zurückgegeben (mit Warnung).
 */
export function encryptField(plaintext: string | null | undefined): string | null {
  if (plaintext == null) return null;
  if (plaintext === "") return "";
  if (isEncrypted(plaintext)) return plaintext;

  const key = requireKey();
  return encryptWithKey(plaintext, key);
}

/**
 * Verschlüsselt mit einem explizit übergebenen Schlüssel (Schlüsselrotation).
 * Gleiche Semantik wie encryptField, aber ohne env-Abhängigkeit.
 */
export function encryptFieldWithKey(plaintext: string | null | undefined, key: Buffer): string | null {
  if (plaintext == null) return null;
  if (plaintext === "") return "";
  if (isEncrypted(plaintext)) return plaintext;
  return encryptWithKey(plaintext, key);
}

function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, tag, enc]);
  return PREFIX + combined.toString("base64");
}

/**
 * Entschlüsselt einen Feldwert.
 * - null/undefined → null
 * - Leerer String → leerer String
 * - Werte ohne Präfix (Klartext-Migration) werden unverändert zurückgegeben.
 * - Wenn Schlüssel fehlt und Wert verschlüsselt ist → wirft (Fail-Closed).
 */
export function decryptField(ciphertext: string | null | undefined): string | null {
  if (ciphertext == null) return null;
  if (ciphertext === "") return "";
  if (!isEncrypted(ciphertext)) return ciphertext; // Klartext-Passthrough während Migration

  const key = getKey();
  if (!key) {
    throw new Error(
      "[fieldEncryption] Verschlüsselte Felder vorhanden, aber FIELD_ENCRYPTION_KEY fehlt. " +
      "Schlüssel konfigurieren um die Daten lesen zu können."
    );
  }

  try {
    return decryptWithKey(ciphertext, key);
  } catch (err) {
    // Schlüsselrotation: Wert kann noch mit dem Alt-Schlüssel verschlüsselt
    // sein (Übergangsfenster bis die Re-Encrypt-Migration gelaufen ist).
    const oldKey = getOldKey();
    if (oldKey) {
      try {
        return decryptWithKey(ciphertext, oldKey);
      } catch {
        // Alt-Schlüssel passt auch nicht → Originalfehler werfen (unten).
      }
    }
    throw err;
  }
}

/**
 * Schlüsselt einen Wert bei Bedarf auf den aktuellen Schlüssel um (Rotation).
 *
 * - Klartext → mit aktuellem Schlüssel verschlüsseln
 * - Bereits mit aktuellem Schlüssel verschlüsselt → unverändert zurückgeben
 * - Mit Alt-Schlüssel (FIELD_ENCRYPTION_KEY_OLD) verschlüsselt → entschlüsseln
 *   und mit aktuellem Schlüssel neu verschlüsseln
 * - Mit KEINEM der Schlüssel lesbar → wirft (kein stilles Überspringen —
 *   ein unlesbarer Wert wäre Datenverlust)
 */
export function reEncryptField(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (value === "") return "";
  const key = requireKey();
  if (!isEncrypted(value)) return encryptWithKey(value, key);

  try {
    decryptWithKey(value, key);
    return value; // bereits mit aktuellem Schlüssel verschlüsselt
  } catch {
    const oldKey = getOldKey();
    if (!oldKey) {
      throw new Error(
        "[fieldEncryption] Wert ist mit dem aktuellen Schlüssel nicht lesbar und " +
        "FIELD_ENCRYPTION_KEY_OLD ist nicht gesetzt — Rotation nicht möglich."
      );
    }
    const plaintext = decryptWithKey(value, oldKey); // wirft wenn auch Alt-Schlüssel falsch
    return encryptWithKey(plaintext, key);
  }
}

/** true wenn FIELD_ENCRYPTION_KEY_OLD gesetzt (Rotationsfenster aktiv). */
export function isKeyRotationActive(): boolean {
  return getOldKey() !== null;
}

/**
 * Entschlüsselt mit einem explizit übergebenen Schlüssel (Schlüsselrotation).
 * Wirft bei falschem Schlüssel (GCM-AuthTag-Prüfung schlägt fehl).
 */
export function decryptFieldWithKey(ciphertext: string | null | undefined, key: Buffer): string | null {
  if (ciphertext == null) return null;
  if (ciphertext === "") return "";
  if (!isEncrypted(ciphertext)) return ciphertext;
  return decryptWithKey(ciphertext, key);
}

function decryptWithKey(ciphertext: string, key: Buffer): string {
  const data = Buffer.from(ciphertext.slice(PREFIX.length), "base64");
  if (data.length < IV_BYTES + TAG_BYTES) {
    throw new Error("[fieldEncryption] Ungültiges Ciphertext-Format (zu kurz).");
  }
  const iv = data.subarray(0, IV_BYTES);
  const tag = data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const enc = data.subarray(IV_BYTES + TAG_BYTES);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc).toString("utf8") + decipher.final("utf8");
}

/**
 * Entschlüsselt IBAN und BIC in einem Datenobjekt in-place.
 * Gibt das modifizierte Objekt zurück.
 */
export function decryptIbanFields<T extends { iban?: string | null; bic?: string | null }>(
  row: T
): T {
  if (row.iban != null) row.iban = decryptField(row.iban);
  if (row.bic != null) row.bic = decryptField(row.bic);
  return row;
}

/** Wendet decryptIbanFields auf ein ganzes Array an. */
export function decryptIbanRows<T extends { iban?: string | null; bic?: string | null }>(
  rows: T[]
): T[] {
  return rows.map(decryptIbanFields);
}
