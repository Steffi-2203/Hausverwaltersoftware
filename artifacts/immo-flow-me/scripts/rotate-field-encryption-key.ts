/**
 * CLI: Feldverschlüsselungs-Schlüssel rotieren.
 *
 * Verwendung (Schlüssel NUR über Umgebungsvariablen, nie als Argument —
 * Argumente landen in der Shell-History und Prozessliste):
 *
 *   FIELD_ENCRYPTION_KEY_OLD=<alter Base64-Key> \
 *   FIELD_ENCRYPTION_KEY_NEW=<neuer Base64-Key> \
 *   pnpm run rotate-encryption-key
 *
 * WICHTIG: In einem Wartungsfenster ausführen — Server vorher stoppen (keine
 * parallelen Writes). Danach FIELD_ENCRYPTION_KEY auf den neuen Wert setzen
 * (Development UND Production/Deployment-Secrets) und den Server neu starten.
 *
 * Exit-Codes: 0 = alles rotiert, 1 = mindestens eine Zeile fehlgeschlagen
 * (Details im Log, ohne Klartext). Ein erneuter Lauf ist gefahrlos (idempotent).
 */
import { rotateFieldEncryptionKey } from "../server/lib/rotateFieldEncryption";

async function main() {
  const oldKey = process.env.FIELD_ENCRYPTION_KEY_OLD;
  const newKey = process.env.FIELD_ENCRYPTION_KEY_NEW;

  if (!oldKey || !newKey) {
    console.error(
      "FIELD_ENCRYPTION_KEY_OLD und FIELD_ENCRYPTION_KEY_NEW müssen gesetzt sein.\n" +
      "Neuen Schlüssel erzeugen: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
    process.exit(1);
  }
  if (oldKey === newKey) {
    console.error("Alter und neuer Schlüssel sind identisch — nichts zu tun.");
    process.exit(1);
  }

  const result = await rotateFieldEncryptionKey(oldKey, newKey);
  console.log(
    `Rotation abgeschlossen: ${result.rotated} rotiert, ${result.encrypted} neu verschlüsselt, ` +
    `${result.skipped} übersprungen, ${result.errors.length} Fehler.`,
  );
  if (result.errors.length > 0) {
    console.error("Fehlerhafte Zeilen (Details im Server-Log, ohne Klartext):");
    for (const e of result.errors) console.error(" - " + e);
    process.exit(1);
  }
  console.log("WICHTIG: Jetzt FIELD_ENCRYPTION_KEY auf den neuen Wert setzen und Server neu starten.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Rotation fehlgeschlagen:", err?.message ?? err);
  process.exit(1);
});
