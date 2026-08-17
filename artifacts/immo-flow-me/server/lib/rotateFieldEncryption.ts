/**
 * Schlüsselrotation für die Feldverschlüsselung (AES-256-GCM, enc:v1:).
 *
 * Liest alle verschlüsselten Zeilen mit dem ALTEN Schlüssel, entschlüsselt sie
 * und speichert sie mit dem NEUEN Schlüssel neu. Sicherheitsregeln:
 *  - Kein Klartext (IBAN/BIC) wird jemals geloggt — nur Tabelle, Spalte, Zeilen-ID.
 *  - Fehler auf Zeilen-Ebene werden protokolliert und gesammelt, der Lauf bricht
 *    NICHT ab (jede weitere Zeile wird trotzdem versucht).
 *  - Idempotent: Zeilen, die bereits mit dem neuen Schlüssel lesbar sind, werden
 *    übersprungen. Ein abgebrochener Lauf kann gefahrlos wiederholt werden.
 *  - Klartext-Zeilen (ohne enc:v1:-Präfix) werden mit dem neuen Schlüssel
 *    verschlüsselt (gleiches Verhalten wie die Boot-Migration).
 *  - Nebenläufigkeits-sicher: Updates sind Compare-and-Swap (nur wenn der Wert
 *    noch dem gelesenen Ciphertext entspricht); danach laufen Verifikations-
 *    Durchgänge, bis kein alt-verschlüsselter Wert mehr existiert. Zeilen, die
 *    während der Rotation von einem noch laufenden Server mit dem ALTEN
 *    Schlüssel geschrieben werden, werden so nachgezogen statt übersehen.
 *
 * WICHTIG (Betrieb): Rotation in einem Wartungsfenster ausführen — Server
 * stoppen oder zumindest keine Writes zulassen. Die CAS+Verify-Mechanik ist
 * ein Sicherheitsnetz, kein Ersatz für das Wartungsfenster.
 *
 * Verwendung über das CLI-Skript scripts/rotate-field-encryption-key.ts.
 */

import { timingSafeEqual } from "crypto";
import { rootDb } from "../db";
import { sql } from "drizzle-orm";
import {
  parseEncryptionKey,
  isEncrypted,
  encryptFieldWithKey,
  decryptFieldWithKey,
} from "./fieldEncryption";
import { logger } from "./logger";

/** Alle Tabellen/Spalten mit feldverschlüsselten Inhalten (DB-Spaltennamen). */
export const ENCRYPTED_COLUMNS: ReadonlyArray<{ table: string; columns: string[] }> = [
  { table: "bank_accounts", columns: ["iban", "bic"] },
  { table: "tenants", columns: ["iban", "bic"] },
  { table: "owners", columns: ["iban", "bic"] },
  { table: "organizations", columns: ["iban", "bic"] },
  { table: "contractors", columns: ["iban", "bic"] },
  { table: "ebics_connections", columns: ["iban", "bic"] },
  { table: "transactions", columns: ["partner_iban"] },
  { table: "kautionen", columns: ["treuhandkonto_iban"] },
];

const MAX_PASSES = 3;

export interface RotationResult {
  rotated: number;   // Zeilenfelder, die vom alten auf den neuen Schlüssel umgestellt wurden
  encrypted: number; // Klartext-Felder, die neu verschlüsselt wurden
  skipped: number;   // bereits mit neuem Schlüssel lesbar (idempotenter Re-Run)
  conflicts: number; // CAS-Konflikte (Wert wurde zwischen Lesen und Schreiben geändert; im nächsten Durchgang nachgezogen)
  passes: number;    // Anzahl der Scan-Durchgänge
  verified: boolean; // true = letzter Durchgang war sauber (kein alt-verschlüsselter Wert außer Fehlerzeilen)
  errors: string[];  // pro Feld: "tabelle.spalte id=… : <fehler>" — NIE Klartext
}

export interface RotationOptions {
  /** Nur diese Tabellen rotieren (Default: alle ENCRYPTED_COLUMNS). Für Tests. */
  tables?: string[];
  /** Test-Hook: läuft am Ende jedes Durchgangs (simuliert parallele Writes). */
  onPassComplete?: (pass: number) => Promise<void>;
  /** Test-Hook: läuft unmittelbar VOR der Abschlussverifikation unter Tabellensperre. */
  onBeforeFinalVerify?: () => Promise<void>;
}

/** Strikte Validierung (kanonisches Base64, exakt 32 Byte) mit klarem Kontext-Label. */
function parseKeyStrict(base64Key: string, label: string): Buffer {
  try {
    return parseEncryptionKey(base64Key);
  } catch (err) {
    throw new Error(`[keyRotation] ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Rotiert alle feldverschlüsselten Spalten von oldKeyBase64 auf newKeyBase64.
 * Wirft bei ungültigen/identischen Schlüsseln — Zeilenfehler landen in result.errors.
 */
export async function rotateFieldEncryptionKey(
  oldKeyBase64: string,
  newKeyBase64: string,
  options: RotationOptions = {},
): Promise<RotationResult> {
  const oldKey = parseKeyStrict(oldKeyBase64, "alter Schlüssel");
  const newKey = parseKeyStrict(newKeyBase64, "neuer Schlüssel");
  if (timingSafeEqual(oldKey, newKey)) {
    throw new Error("[keyRotation] Alter und neuer Schlüssel sind identisch — keine Rotation möglich.");
  }

  const targets = options.tables
    ? ENCRYPTED_COLUMNS.filter((t) => options.tables!.includes(t.table))
    : ENCRYPTED_COLUMNS;

  const result: RotationResult = { rotated: 0, encrypted: 0, skipped: 0, conflicts: 0, passes: 0, verified: false, errors: [] };
  // Fehler pro Feld nur einmal melden, aber über ALLE Durchgänge sammeln
  const errorByLabel = new Map<string, string>();

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    result.passes = pass;
    let pending = 0; // in diesem Durchgang bearbeitete (nicht übersprungene) Felder, inkl. CAS-Konflikte

    for (const { table, columns } of targets) {
      for (const column of columns) {
        const rows = (await rootDb.execute(sql`
          SELECT id, ${sql.identifier(column)} AS value
          FROM ${sql.identifier(table)}
          WHERE ${sql.identifier(column)} IS NOT NULL AND ${sql.identifier(column)} <> ''
        `)).rows as Array<{ id: string; value: string }>;

        for (const row of rows) {
          const label = `${table}.${column} id=${row.id}`;
          if (errorByLabel.has(label)) continue; // bekannt fehlerhaft — zählt nicht als offen
          try {
            let newValue: string;

            if (!isEncrypted(row.value)) {
              // Klartext-Altbestand → direkt mit neuem Schlüssel verschlüsseln
              newValue = encryptFieldWithKey(row.value, newKey)!;
            } else {
              // Bereits mit neuem Schlüssel lesbar? → überspringen (idempotent)
              try {
                decryptFieldWithKey(row.value, newKey);
                if (pass === 1) result.skipped++;
                continue;
              } catch {
                // erwartbar: mit altem Schlüssel verschlüsselt
              }
              const plaintext = decryptFieldWithKey(row.value, oldKey); // wirft bei fremdem/korruptem Ciphertext
              newValue = encryptFieldWithKey(plaintext, newKey)!;
            }

            pending++;
            // Compare-and-Swap: nur schreiben, wenn der Wert unverändert ist.
            // Bei Konflikt (paralleler Write) wird die Zeile im nächsten
            // Durchgang mit ihrem dann aktuellen Wert erneut verarbeitet.
            const upd = await rootDb.execute(sql`
              UPDATE ${sql.identifier(table)}
              SET ${sql.identifier(column)} = ${newValue}
              WHERE id = ${row.id} AND ${sql.identifier(column)} = ${row.value}
            `);
            if ((upd.rowCount ?? 0) === 0) {
              result.conflicts++;
              logger.warn(`[keyRotation] CAS-Konflikt bei ${label} — wird im nächsten Durchgang nachgezogen`);
            } else if (isEncrypted(row.value)) {
              result.rotated++;
            } else {
              result.encrypted++;
            }
          } catch (err) {
            // Bewusst OHNE Wert/Klartext loggen — nur Ort + Fehlertyp.
            const msg = `${label}: ${err instanceof Error ? err.message : String(err)}`;
            logger.error(`[keyRotation] ${msg}`);
            errorByLabel.set(label, msg);
          }
        }
      }
    }

    if (options.onPassComplete) await options.onPassComplete(pass);

    // Vorverifikation: Ein Durchgang ohne offene Arbeit (pending === 0)
    // bedeutet, dass die lockfreien Durchgänge fertig sind. Die eigentliche
    // Garantie liefert erst die abschließende Verifikation unter Tabellensperre.
    if (pass > 1 && pending === 0) {
      break;
    }
  }

  // ── Abschlussverifikation unter Tabellensperre ─────────────────────────────
  // Die CAS-Durchgänge oben sind lockfrei und daher gegen parallele Old-Key-
  // Writes NACH dem jeweiligen Tabellenscan blind. Die Abschlussverifikation
  // läuft deshalb in EINER Transaktion, die alle Zieltabellen mit
  // LOCK TABLE ... IN EXCLUSIVE MODE sperrt: Schreiber sind blockiert, alles
  // zuvor Committete ist sichtbar, und verbliebene alt-verschlüsselte oder
  // Klartext-Werte werden noch in derselben Transaktion umgeschlüsselt.
  // verified=true gilt erst nach erfolgreichem Commit dieser Transaktion.
  //
  // Grenze: Ein Server, der NACH dem Commit weiter mit dem alten Schlüssel
  // schreibt (Rolling Deploy), kann neue Alt-Werte erzeugen. Solange
  // FIELD_ENCRYPTION_KEY_OLD gesetzt ist, bleiben diese über den
  // decryptField-Fallback lesbar und werden beim nächsten Boot-/CLI-Lauf
  // nachrotiert. _OLD erst entfernen, wenn ALLE Instanzen mit dem neuen
  // Schlüssel laufen und ein anschließender Lauf sauber verifiziert hat.
  if (options.onBeforeFinalVerify) await options.onBeforeFinalVerify();
  try {
    await rootDb.transaction(async (tx) => {
      // Feste Sperr-Reihenfolge (Deadlock-Vermeidung), erst danach scannen.
      for (const { table } of targets) {
        await tx.execute(sql`LOCK TABLE ${sql.identifier(table)} IN EXCLUSIVE MODE`);
      }
      for (const { table, columns } of targets) {
        for (const column of columns) {
          const rows = (await tx.execute(sql`
            SELECT id, ${sql.identifier(column)} AS value
            FROM ${sql.identifier(table)}
            WHERE ${sql.identifier(column)} IS NOT NULL AND ${sql.identifier(column)} <> ''
          `)).rows as Array<{ id: string; value: string }>;

          for (const row of rows) {
            const label = `${table}.${column} id=${row.id}`;
            if (errorByLabel.has(label)) continue; // bekannt fehlerhaft (z.B. fremder Ciphertext)
            try {
              let newValue: string;
              if (!isEncrypted(row.value)) {
                newValue = encryptFieldWithKey(row.value, newKey)!;
              } else {
                try {
                  decryptFieldWithKey(row.value, newKey);
                  continue; // bereits mit neuem Schlüssel lesbar
                } catch {
                  // mit altem Schlüssel verschlüsselt — unter Sperre nachziehen
                }
                const plaintext = decryptFieldWithKey(row.value, oldKey);
                newValue = encryptFieldWithKey(plaintext, newKey)!;
              }
              // Unter EXCLUSIVE-Sperre sind parallele Writes ausgeschlossen —
              // kein CAS nötig.
              await tx.execute(sql`
                UPDATE ${sql.identifier(table)}
                SET ${sql.identifier(column)} = ${newValue}
                WHERE id = ${row.id}
              `);
              if (isEncrypted(row.value)) result.rotated++;
              else result.encrypted++;
              logger.warn(`[keyRotation] ${label} erst in der Abschlussverifikation nachgezogen (paralleler Old-Key-Write)`);
            } catch (err) {
              const msg = `${label}: ${err instanceof Error ? err.message : String(err)}`;
              logger.error(`[keyRotation] ${msg}`);
              errorByLabel.set(label, msg);
            }
          }
        }
      }
    });
    result.verified = true;
  } catch (err) {
    const msg =
      `Abschlussverifikation fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}. ` +
      `Rotation erneut ausführen; FIELD_ENCRYPTION_KEY_OLD nicht entfernen.`;
    logger.error(`[keyRotation] ${msg}`);
    errorByLabel.set("__final_verify__", msg);
  }

  result.errors = [...errorByLabel.values()];
  if (!result.verified) {
    const msg =
      `Verifikation fehlgeschlagen: es können weiterhin Werte existieren, ` +
      `die nicht mit dem neuen Schlüssel lesbar sind. ` +
      `Server stoppen und Rotation erneut ausführen.`;
    logger.error(`[keyRotation] ${msg}`);
    result.errors.push(msg);
  }

  logger.info(
    `[keyRotation] Fertig — rotiert: ${result.rotated}, neu verschlüsselt: ${result.encrypted}, ` +
    `übersprungen: ${result.skipped}, Konflikte: ${result.conflicts}, Durchgänge: ${result.passes}, ` +
    `Fehler: ${result.errors.length}`,
  );
  return result;
}
