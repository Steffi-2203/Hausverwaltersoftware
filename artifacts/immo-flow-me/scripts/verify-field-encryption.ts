/**
 * Verifiziert dass alle verschlüsselten Felder in den 8 Zieltabellen
 * mit dem aktuellen FIELD_ENCRYPTION_KEY (und NUR mit diesem) lesbar sind.
 *
 * WICHTIG: Dieses Skript verwendet ausschließlich den aktuellen Schlüssel
 * (nie den _OLD-Fallback). Damit ist es auch während des Rotationsfensters
 * zuverlässig: Alt-verschlüsselte Zeilen erzeugen einen Fehler (Rotation noch
 * nicht vollständig), Klartext-Zeilen sind bei gesetztem _OLD ein Fehler
 * (Boot-Migration hätte sie bereits verschlüsseln müssen).
 *
 * Verwendung:
 *   pnpm --filter @workspace/immo-flow-me run verify-encryption
 *
 * Gegen Produktions-DB (nach Rotation, FIELD_ENCRYPTION_KEY = neuer Key):
 *   DATABASE_URL=<prod-url> FIELD_ENCRYPTION_KEY=<neuer-key> \
 *     pnpm --filter @workspace/immo-flow-me run verify-encryption
 *
 * Exit-Codes: 0 = alle Felder mit aktuellem Schlüssel lesbar (kein Alt-Ciphertext,
 *             kein unerwarteter Klartext), 1 = mindestens ein Problem
 *
 * Wichtig: Keine Klartextwerte werden geloggt — nur Tabelle, Spalte, ID.
 */

import { rootDb } from "../server/db";
import { sql } from "drizzle-orm";
import {
  parseEncryptionKey,
  decryptFieldWithKey,
  isEncrypted,
} from "../server/lib/fieldEncryption";
import { ENCRYPTED_COLUMNS } from "../server/lib/rotateFieldEncryption";

interface TableResult {
  table: string;
  column: string;
  total: number;
  encrypted: number;
  plaintext: number;
  errors: string[];
}

async function verifyTable(
  table: string,
  column: string,
  currentKey: Buffer,
  inRotationWindow: boolean,
): Promise<TableResult> {
  const rows = (await rootDb.execute(sql`
    SELECT id, ${sql.identifier(column)} AS value
    FROM ${sql.identifier(table)}
    WHERE ${sql.identifier(column)} IS NOT NULL AND ${sql.identifier(column)} <> ''
  `)).rows as Array<{ id: string; value: string }>;

  const result: TableResult = {
    table,
    column,
    total: rows.length,
    encrypted: 0,
    plaintext: 0,
    errors: [],
  };

  for (const row of rows) {
    if (!isEncrypted(row.value)) {
      // Klartext — immer ein Fehler. Die Boot-Migration hätte diesen Wert
      // beim Start verschlüsseln müssen. Klartext nach der Migration bedeutet:
      // Rotation unvollständig → _OLD NICHT entfernen.
      result.plaintext++;
      result.errors.push(
        `${table}.${column} id=${row.id}: Klartext-Wert — Boot-Migration ` +
        `noch nicht vollständig, _OLD NICHT entfernen.`,
      );
      continue;
    }

    result.encrypted++;
    try {
      // EXPLIZIT nur mit dem aktuellen Schlüssel — kein _OLD-Fallback.
      // Schlägt fehl wenn der Wert noch mit dem alten Schlüssel verschlüsselt ist.
      const plain = decryptFieldWithKey(row.value, currentKey);
      if (plain == null || plain === "") {
        result.errors.push(
          `${table}.${column} id=${row.id}: Entschlüsselung ergab leeren Wert (korrupter Ciphertext?)`,
        );
      }
    } catch {
      // Bewusst ohne Klartext oder Schlüsselwert
      result.errors.push(
        `${table}.${column} id=${row.id}: Mit aktuellem Schlüssel nicht lesbar — ` +
        (inRotationWindow
          ? `noch nicht rotiert (Rotation unvollständig, _OLD NICHT entfernen).`
          : `Schlüssel falsch oder Ciphertext korrupt.`),
      );
    }
  }

  return result;
}

async function main() {
  const keyEnv = process.env.FIELD_ENCRYPTION_KEY;
  if (!keyEnv) {
    console.error("FIELD_ENCRYPTION_KEY ist nicht gesetzt.");
    process.exit(1);
  }

  // Schlüssel einmalig parsen — identische Validierung wie die Server-Runtime.
  let currentKey: Buffer;
  try {
    currentKey = parseEncryptionKey(keyEnv);
  } catch (err) {
    console.error(`FIELD_ENCRYPTION_KEY ungültig: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const inRotationWindow = !!process.env.FIELD_ENCRYPTION_KEY_OLD;
  if (inRotationWindow) {
    console.warn(
      "⚠️  FIELD_ENCRYPTION_KEY_OLD ist gesetzt — Rotationsfenster aktiv.\n" +
      "   Verifikation prüft NUR den aktuellen Schlüssel.\n" +
      "   Jede Zeile, die nur mit dem alten Schlüssel lesbar ist, wird als FEHLER gewertet.\n" +
      "   _OLD NICHT entfernen, bis diese Prüfung mit 0 Fehlern abschließt.\n",
    );
  }

  console.log("Prüfe Feldverschlüsselung in allen 8 Tabellen (nur aktueller Schlüssel)...\n");

  const allResults: TableResult[] = [];
  let totalRows = 0;
  let totalErrors = 0;
  let totalEncrypted = 0;
  let totalPlaintext = 0;

  for (const { table, columns } of ENCRYPTED_COLUMNS) {
    for (const column of columns) {
      const result = await verifyTable(table, column, currentKey, inRotationWindow);
      allResults.push(result);

      totalRows += result.total;
      totalEncrypted += result.encrypted;
      totalPlaintext += result.plaintext;
      totalErrors += result.errors.length;

      const icon = result.errors.length === 0 ? "✓" : "✗";
      const label = `${result.table}.${result.column}`.padEnd(40);
      const stats = `${result.total} Zeilen (${result.encrypted} enc, ${result.plaintext} plain)`;
      const errInfo = result.errors.length > 0 ? ` — ${result.errors.length} FEHLER` : "";
      console.log(`${icon} ${label} ${stats}${errInfo}`);

      for (const err of result.errors) {
        console.error(`  ✗ ${err}`);
      }
    }
  }

  console.log("\n" + "─".repeat(70));
  console.log(
    `Gesamt: ${totalRows} Zeilen geprüft — ` +
    `${totalEncrypted} verschlüsselt, ${totalPlaintext} Klartext, ${totalErrors} Fehler`,
  );

  if (totalErrors === 0) {
    if (inRotationWindow) {
      console.log(
        "\n✓ Alle verschlüsselten Felder mit dem aktuellen Schlüssel lesbar.\n" +
        "  FIELD_ENCRYPTION_KEY_OLD kann jetzt entfernt werden.",
      );
    } else {
      console.log("\n✓ Schlüssel korrekt — alle verschlüsselten Felder lesbar.");
    }
    process.exit(0);
  } else {
    console.error(
      `\n✗ ${totalErrors} Feld(er) konnten NICHT mit dem aktuellen Schlüssel entschlüsselt werden.\n` +
      `  FIELD_ENCRYPTION_KEY_OLD NICHT entfernen.\n` +
      `  Rotation erneut ausführen (Boot oder CLI) bevor diese Prüfung wiederholt wird.`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Verifikation abgebrochen:", err?.message ?? err);
  process.exit(1);
});
