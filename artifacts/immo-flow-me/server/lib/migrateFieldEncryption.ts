/**
 * Boot-Zeit-Migration: Klartext-IBANs in der Datenbank verschlüsseln.
 *
 * Läuft VOR listen() — blockiert den Server-Start bis die Migration abgeschlossen
 * ist oder fehlschlägt. Fehler auf Zeilen-Ebene werden gesammelt und am Ende
 * als aggregierter Error geworfen, damit index.ts mit process.exit(1) reagieren kann.
 *
 * Idempotent: Zeilen mit enc:v1:-Präfix werden übersprungen.
 * Ohne FIELD_ENCRYPTION_KEY kehrt die Funktion sofort zurück.
 */

import { rootDb } from "../db";
import { decryptField, encryptField, isEncrypted } from "./fieldEncryption";
import {
  tenants,
  owners,
  bankAccounts,
  ebicsConnections,
  organizations,
  contractors,
  transactions,
  kautionen,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

/** Zeile mit id plus einem oder zwei verschlüsselbaren Feldern. */
type IbanRow = { id: string; iban?: string | null; bic?: string | null };
type SingleFieldRow = { id: string; value?: string | null };

/**
 * Prüft vor einer normalen Boot-Migration, ob der aktuelle Schlüssel alle
 * vorhandenen Ciphertexte lesen kann. Ohne diesen Check würde die
 * Klartextmigration enc:v1-Werte überspringen und ein versehentlich geänderter
 * Schlüssel erst bei einer späteren Fachabfrage als kryptischer GCM-Fehler
 * auffallen.
 */
async function assertCurrentKeyCanReadExistingCiphertexts(): Promise<void> {
  let unreadable = 0;

  const verify = (
    rows: Array<{ iban?: string | null; bic?: string | null; value?: string | null }>,
  ): void => {
    for (const row of rows) {
      for (const value of [row.iban, row.bic, row.value]) {
        if (!value || !isEncrypted(value)) continue;
        try {
          decryptField(value);
        } catch {
          unreadable++;
        }
      }
    }
  };

  verify(await rootDb.select({ iban: bankAccounts.iban, bic: bankAccounts.bic }).from(bankAccounts));
  verify(await rootDb.select({ iban: tenants.iban, bic: tenants.bic }).from(tenants));
  verify(await rootDb.select({ iban: owners.iban, bic: owners.bic }).from(owners));
  verify(await rootDb.select({ iban: organizations.iban, bic: organizations.bic }).from(organizations));
  verify(await rootDb.select({ iban: contractors.iban, bic: contractors.bic }).from(contractors));
  verify(await rootDb.select({ iban: ebicsConnections.iban, bic: ebicsConnections.bic }).from(ebicsConnections));
  verify(await rootDb.select({ value: transactions.partnerIban }).from(transactions));
  verify(await rootDb.select({ value: kautionen.treuhandkontoIban }).from(kautionen));

  if (unreadable > 0) {
    throw new Error(
      `[fieldEncryption] ${unreadable} vorhandene(r) enc:v1-Ciphertext(e) ist/sind mit ` +
      `FIELD_ENCRYPTION_KEY nicht lesbar. Der Schlüssel wurde vermutlich geändert. ` +
      `Setze den bisherigen Schlüssel als FIELD_ENCRYPTION_KEY_OLD und starte erneut, ` +
      `damit die Schlüsselrotation die Bestandsdaten sicher umschlüsseln kann.`,
    );
  }
}

/**
 * Verschlüsselt IBAN/BIC-Felder einer Tabelle.
 * Wirft einen AggregateError wenn mindestens eine Zeile fehlschlägt.
 */
async function encryptTableIbans(
  tableLabel: string,
  rows: IbanRow[],
  updateFn: (id: string, data: { iban?: string | null; bic?: string | null }) => Promise<void>,
): Promise<number> {
  let count = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const updates: { iban?: string | null; bic?: string | null } = {};
    let needsUpdate = false;

    if (row.iban && !isEncrypted(row.iban)) {
      updates.iban = encryptField(row.iban);
      needsUpdate = true;
    }
    if (row.bic && !isEncrypted(row.bic)) {
      updates.bic = encryptField(row.bic);
      needsUpdate = true;
    }

    if (needsUpdate) {
      try {
        await updateFn(row.id, updates);
        count++;
      } catch (err) {
        const msg = `[fieldEncryption] ${tableLabel} id=${row.id}: ${err}`;
        logger.error(msg);
        errors.push(msg);
      }
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(
      errors.map((m) => new Error(m)),
      `${errors.length} Zeile(n) in ${tableLabel} konnten nicht verschlüsselt werden`,
    );
  }

  return count;
}

/**
 * Verschlüsselt ein einzelnes benanntes Feld einer Tabelle.
 * Wirft einen AggregateError wenn mindestens eine Zeile fehlschlägt.
 */
async function encryptTableField(
  tableLabel: string,
  fieldName: string,
  rows: SingleFieldRow[],
  updateFn: (id: string, value: string | null) => Promise<void>,
): Promise<number> {
  let count = 0;
  const errors: string[] = [];

  for (const row of rows) {
    if (!row.value || isEncrypted(row.value)) continue;

    try {
      await updateFn(row.id, encryptField(row.value));
      count++;
    } catch (err) {
      const msg = `[fieldEncryption] ${tableLabel}.${fieldName} id=${row.id}: ${err}`;
      logger.error(msg);
      errors.push(msg);
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(
      errors.map((m) => new Error(m)),
      `${errors.length} Zeile(n) in ${tableLabel}.${fieldName} konnten nicht verschlüsselt werden`,
    );
  }

  return count;
}

export async function migrateFieldEncryption(): Promise<void> {
  if (!process.env.FIELD_ENCRYPTION_KEY) {
    return; // Kein Schlüssel — index.ts hat bereits gewarnt/abgebrochen
  }

  // ── Schlüsselrotation (FIELD_ENCRYPTION_KEY_OLD gesetzt) ─────────────────
  // Bestandsdaten werden über die CAS+Verify-Routine (rotateFieldEncryption)
  // auf den aktuellen Schlüssel umgeschlüsselt — nebenläufigkeitssicher:
  // Compare-and-Swap-Updates plus Verifikationsdurchgänge, bis kein Wert mehr
  // existiert, der nur mit dem Alt-Schlüssel lesbar ist. Fehler oder eine
  // fehlgeschlagene Verifikation brechen den Boot ab (Fail-Closed), damit
  // _OLD nicht entfernt wird solange alt-verschlüsselte Werte übrig sind.
  const oldKeyEnv = process.env.FIELD_ENCRYPTION_KEY_OLD;
  const hasDistinctOldKey = Boolean(
    oldKeyEnv && oldKeyEnv !== process.env.FIELD_ENCRYPTION_KEY,
  );
  if (oldKeyEnv) {
    if (!hasDistinctOldKey) {
      logger.warn(
        "[fieldEncryption] FIELD_ENCRYPTION_KEY_OLD ist identisch mit FIELD_ENCRYPTION_KEY — " +
        "Rotation bereits abgeschlossen? _OLD entfernen.",
      );
    } else {
      logger.info("[fieldEncryption] Rotationsfenster aktiv — schlüssele Bestandsdaten um...");
      const { rotateFieldEncryptionKey } = await import("./rotateFieldEncryption");
      const result = await rotateFieldEncryptionKey(oldKeyEnv, process.env.FIELD_ENCRYPTION_KEY);
      if (!result.verified || result.errors.length > 0) {
        throw new Error(
          `[fieldEncryption] Schlüsselrotation unvollständig — verified=${result.verified}, ` +
          `${result.errors.length} Fehler: ${result.errors.join("; ")}. ` +
          `FIELD_ENCRYPTION_KEY_OLD NICHT entfernen bis die Rotation sauber durchläuft.`,
        );
      }
      if (result.rotated === 0) {
        // Nichts mehr umzuschlüsseln → Rotation war bereits vollständig abgeschlossen.
        // Das Rotationsfenster (FIELD_ENCRYPTION_KEY_OLD) ist unnötig offen —
        // ein kompromittierter Alt-Schlüssel bleibt solange nutzbar.
        logger.warn(
          "⚠️  [fieldEncryption] ROTATIONSFENSTER OFFEN: FIELD_ENCRYPTION_KEY_OLD ist gesetzt, " +
          "aber es gibt keine Werte mehr, die umgeschlüsselt werden müssen. " +
          "Die Rotation ist vollständig abgeschlossen — FIELD_ENCRYPTION_KEY_OLD sofort entfernen, " +
          "um das Angriffsfenster durch den Alt-Schlüssel zu schließen.",
        );
      } else {
        logger.info(
          `[fieldEncryption] Rotation abgeschlossen (${result.rotated} rotiert, ${result.encrypted} ` +
          `neu verschlüsselt). FIELD_ENCRYPTION_KEY_OLD kann jetzt entfernt werden.`,
        );
      }
    }
  }

  if (!hasDistinctOldKey) {
    logger.info("[fieldEncryption] Prüfe, ob der aktuelle Schlüssel Bestands-Ciphertexte lesen kann...");
    await assertCurrentKeyCanReadExistingCiphertexts();
  }

  logger.info("[fieldEncryption] Prüfe auf unverschlüsselte IBAN-Felder...");

  const errors: Error[] = [];
  let total = 0;

  /** Fehler einer Tabelle sammeln; alle Tabellen werden versucht bevor abgebrochen wird. */
  async function runTable<T extends IbanRow>(
    label: string,
    rows: T[],
    updateFn: (id: string, data: { iban?: string | null; bic?: string | null }) => Promise<void>,
  ) {
    try {
      total += await encryptTableIbans(label, rows, updateFn);
    } catch (err: any) {
      errors.push(err);
    }
  }

  async function runField(
    label: string,
    fieldName: string,
    rows: SingleFieldRow[],
    updateFn: (id: string, value: string | null) => Promise<void>,
  ) {
    try {
      total += await encryptTableField(label, fieldName, rows, updateFn);
    } catch (err: any) {
      errors.push(err);
    }
  }

  // ── Tabellen mit IBAN + BIC ──────────────────────────────────────────────

  await runTable(
    "bank_accounts",
    await rootDb.select({ id: bankAccounts.id, iban: bankAccounts.iban, bic: bankAccounts.bic }).from(bankAccounts),
    (id, data) => rootDb.update(bankAccounts).set(data).where(eq(bankAccounts.id, id)).then(() => {}),
  );

  await runTable(
    "tenants",
    await rootDb.select({ id: tenants.id, iban: tenants.iban, bic: tenants.bic }).from(tenants),
    (id, data) => rootDb.update(tenants).set(data).where(eq(tenants.id, id)).then(() => {}),
  );

  await runTable(
    "owners",
    await rootDb.select({ id: owners.id, iban: owners.iban, bic: owners.bic }).from(owners),
    (id, data) => rootDb.update(owners).set(data).where(eq(owners.id, id)).then(() => {}),
  );

  await runTable(
    "organizations",
    await rootDb.select({ id: organizations.id, iban: organizations.iban, bic: organizations.bic }).from(organizations),
    (id, data) => rootDb.update(organizations).set(data).where(eq(organizations.id, id)).then(() => {}),
  );

  await runTable(
    "contractors",
    await rootDb.select({ id: contractors.id, iban: contractors.iban, bic: contractors.bic }).from(contractors),
    (id, data) => rootDb.update(contractors).set(data).where(eq(contractors.id, id)).then(() => {}),
  );

  await runTable(
    "ebics_connections",
    await rootDb.select({ id: ebicsConnections.id, iban: ebicsConnections.iban, bic: ebicsConnections.bic }).from(ebicsConnections),
    (id, data) => rootDb.update(ebicsConnections).set(data).where(eq(ebicsConnections.id, id)).then(() => {}),
  );

  // ── Tabellen mit einzelnen IBAN-Feldern ──────────────────────────────────

  await runField(
    "transactions",
    "partnerIban",
    await rootDb
      .select({ id: transactions.id, value: transactions.partnerIban })
      .from(transactions),
    (id, value) =>
      rootDb.update(transactions).set({ partnerIban: value }).where(eq(transactions.id, id)).then(() => {}),
  );

  await runField(
    "kautionen",
    "treuhandkontoIban",
    await rootDb
      .select({ id: kautionen.id, value: kautionen.treuhandkontoIban })
      .from(kautionen),
    (id, value) =>
      rootDb.update(kautionen).set({ treuhandkontoIban: value }).where(eq(kautionen.id, id)).then(() => {}),
  );

  // ── Abschluss ────────────────────────────────────────────────────────────

  if (errors.length > 0) {
    const msgs = errors.map((e) => e.message).join("; ");
    throw new Error(
      `[fieldEncryption] Migration fehlgeschlagen — ${errors.length} Tabelle(n) hatten Fehler: ${msgs}`,
    );
  }

  if (total > 0) {
    logger.info(`[fieldEncryption] ${total} Zeile(n) mit Klartext-IBAN/SEPA-Felder verschlüsselt.`);
  } else {
    logger.info("[fieldEncryption] Alle IBAN/SEPA-Felder bereits verschlüsselt oder leer.");
  }
}
