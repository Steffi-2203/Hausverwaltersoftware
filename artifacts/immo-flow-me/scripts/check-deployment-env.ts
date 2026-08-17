/**
 * Pre-Rollout-Check: verifiziert alle für den Produktionsbetrieb zwingend
 * erforderlichen Secrets, BEVOR ein Deployment ausgerollt wird.
 *
 *   pnpm run check-deploy-env
 *
 * Exit 0 = alles gesetzt und valide, Exit 1 = mindestens ein Problem
 * (Auflistung ohne Secret-Werte). Der Server prüft dieselben Bedingungen
 * zusätzlich beim Boot (fail-fast in NODE_ENV=production).
 */
import { parseEncryptionKey } from "../server/lib/fieldEncryption";

const problems: string[] = [];

// FIELD_ENCRYPTION_KEY: gesetzt + exakt 32 Byte Base64
const encKey = process.env.FIELD_ENCRYPTION_KEY;
if (!encKey) {
  problems.push(
    "FIELD_ENCRYPTION_KEY fehlt — IBAN/BIC-Verschlüsselung. Erzeugen: " +
    'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
  );
} else {
  try {
    parseEncryptionKey(encKey);
  } catch (err) {
    problems.push(`FIELD_ENCRYPTION_KEY ungültig — ${err instanceof Error ? err.message : String(err)}`);
  }
}

// SESSION_SECRET: gesetzt und nicht trivial kurz
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  problems.push("SESSION_SECRET fehlt — Session-Signierung.");
} else if (sessionSecret.length < 32) {
  problems.push("SESSION_SECRET ist zu kurz (< 32 Zeichen) — längeren zufälligen Wert verwenden.");
}

// DATABASE_URL: gesetzt
if (!process.env.DATABASE_URL) {
  problems.push("DATABASE_URL fehlt — Datenbankverbindung.");
}

if (problems.length > 0) {
  console.error("Deployment-Check FEHLGESCHLAGEN — folgende Secrets fehlen oder sind ungültig:\n");
  for (const p of problems) console.error(" ✖ " + p);
  console.error("\nSecrets in den Deployment-Einstellungen (Production) setzen und erneut prüfen.");
  process.exit(1);
}

console.log("Deployment-Check OK ✓ — FIELD_ENCRYPTION_KEY, SESSION_SECRET und DATABASE_URL sind gesetzt und valide.");
process.exit(0);
