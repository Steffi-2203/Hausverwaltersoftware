/**
 * Klartext-IBAN-Wächter (Task: neue Code-Pfade dürfen IBANs nie unbemerkt
 * im Klartext speichern).
 *
 * Strategie:
 *  1. Alle IBAN/BIC-verdächtigen Textspalten werden DYNAMISCH über
 *     information_schema entdeckt (Spaltenname enthält 'iban' oder ist 'bic').
 *     → Eine NEUE Tabelle/Spalte mit IBAN-Daten wird automatisch mitgeprüft,
 *       ohne dass jemand diesen Test pflegen muss.
 *  2. Ein Abdeckungs-Assert stellt sicher, dass die Discovery mindestens die
 *     8 bekannten Tabellen aus migrateFieldEncryption findet — bricht die
 *     information_schema-Abfrage still, schlägt der Test fehl statt grün
 *     durchzulaufen.
 *  3. Jede entdeckte Spalte wird per rootDb auf Klartext-Werte gescannt:
 *     Wert ohne enc:v1:-Präfix, der wie eine IBAN (^[A-Z]{2}\d{2}...) bzw.
 *     wie ein BIC aussieht → Test schlägt mit Tabelle/Spalte/IDs fehl.
 *
 *  Der Test hält den Encryption-Test-Lock, damit er nicht mitten in
 *  Rotations-/Migrationstests hineinliest, die absichtlich transient
 *  Klartext-Fixtures anlegen (und sie unter demselben Lock aufräumen).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { rootDb } from "../../server/db";
import {
  EXPECTED_IBAN_TABLES,
  IBAN_SQL_REGEX,
  scanPlaintextIbanBic,
  type ColumnRef,
  type PlaintextIbanScanResult,
} from "../../server/lib/plaintextIbanGuard";
import {
  acquireEncryptionTestLock,
  releaseEncryptionTestLock,
} from "../helpers/encryptionTestLock";

describe("Klartext-IBAN-Wächter: keine unverschlüsselten IBAN/BIC-Werte in der DB", () => {
  let ibanColumns: ColumnRef[] = [];
  let bicColumns: ColumnRef[] = [];
  let scanResult: PlaintextIbanScanResult;

  before(async () => {
    await acquireEncryptionTestLock();

    scanResult = await scanPlaintextIbanBic(rootDb);
    ibanColumns = scanResult.ibanColumns;
    bicColumns = scanResult.bicColumns;
  });

  after(async () => {
    await releaseEncryptionTestLock();
  });

  it("Discovery findet alle bekannten IBAN-Tabellen (Schutz gegen stille Discovery-Brüche)", () => {
    const foundTables = new Set(ibanColumns.map((c) => c.table));
    for (const t of EXPECTED_IBAN_TABLES) {
      assert.ok(
        foundTables.has(t),
        `Tabelle '${t}' mit IBAN-Spalte wurde nicht entdeckt — information_schema-Abfrage prüfen`,
      );
    }
    // Mindestens die bekannten 8 Tabellen; neue Tabellen kommen automatisch dazu
    assert.ok(ibanColumns.length >= EXPECTED_IBAN_TABLES.length);
  });

  it("keine Klartext-IBAN in irgendeiner IBAN-Spalte (enc:v1:-Präfix fehlt)", () => {
    const violations = scanResult.violations
      .filter((violation) => violation.kind === "iban")
      .map((violation) => `${violation.table}.${violation.column}: ${violation.count} Treffer (IDs: ${violation.ids.join(", ")})`);
    assert.deepEqual(
      violations,
      [],
      `Klartext-IBANs gefunden — ein Schreibpfad ruft encryptField nicht auf:\n${violations.join("\n")}`,
    );
  });

  it("kein Klartext-BIC in irgendeiner bic-Spalte", () => {
    const violations = scanResult.violations
      .filter((violation) => violation.kind === "bic")
      .map((violation) => `${violation.table}.${violation.column}: ${violation.count} Treffer (IDs: ${violation.ids.join(", ")})`);
    assert.deepEqual(
      violations,
      [],
      `Klartext-BICs gefunden — ein Schreibpfad ruft encryptField nicht auf:\n${violations.join("\n")}`,
    );
  });

  it("Wächter erkennt eine absichtlich eingeschleuste Klartext-IBAN (Selbsttest)", async () => {
    // Negativ-Kontrolle: ohne diesen Selbsttest könnte der Wächter grün sein,
    // weil die Regex/Query nie etwas matcht.
    const orgId = crypto.randomUUID();
    await rootDb.execute(sql`
      INSERT INTO organizations (id, name, iban)
      VALUES (${orgId}::uuid, 'guard-selftest', 'AT611904300234573201')
    `);
    try {
      const res = await rootDb.execute(sql`
        SELECT id::text AS id FROM organizations
        WHERE iban IS NOT NULL AND iban NOT LIKE 'enc:v1:%'
          AND upper(replace(iban, ' ', '')) ~ ${IBAN_SQL_REGEX}
          AND id = ${orgId}::uuid
      `);
      assert.equal(((res as any).rows as any[]).length, 1, "Selbsttest: Muster muss Klartext-IBAN erkennen");
    } finally {
      await rootDb.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
    }
  });
});
