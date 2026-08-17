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
  acquireEncryptionTestLock,
  releaseEncryptionTestLock,
} from "../helpers/encryptionTestLock";

// Bekannte Tabellen aus server/lib/migrateFieldEncryption.ts — Mindestabdeckung
const EXPECTED_TABLES = [
  "bank_accounts",
  "tenants",
  "owners",
  "organizations",
  "contractors",
  "ebics_connections",
  "transactions",
  "kautionen",
];

// Klartext-Muster: IBAN (Ländercode + Prüfziffer + 11–30 alphanumerisch),
// optional mit Leerzeichen gruppiert.
const IBAN_SQL_REGEX = "^[A-Z]{2}[0-9]{2}[A-Z0-9 ]{11,34}$";
// BIC: 4 Buchstaben Bank, 2 Buchstaben Land, 2 alphanum. Ort, optional 3 Filiale
const BIC_SQL_REGEX = "^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$";

type ColumnRef = { table: string; column: string };

describe("Klartext-IBAN-Wächter: keine unverschlüsselten IBAN/BIC-Werte in der DB", () => {
  let ibanColumns: ColumnRef[] = [];
  let bicColumns: ColumnRef[] = [];

  before(async () => {
    await acquireEncryptionTestLock();

    const result = await rootDb.execute(sql`
      SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
        AND c.data_type IN ('text', 'character varying')
        AND (c.column_name ILIKE '%iban%' OR c.column_name = 'bic')
      ORDER BY c.table_name, c.column_name
    `);
    const rows = (result as any).rows as { table_name: string; column_name: string }[];
    ibanColumns = rows
      .filter((r) => r.column_name.toLowerCase().includes("iban"))
      .map((r) => ({ table: r.table_name, column: r.column_name }));
    bicColumns = rows
      .filter((r) => r.column_name === "bic")
      .map((r) => ({ table: r.table_name, column: r.column_name }));
  });

  after(async () => {
    await releaseEncryptionTestLock();
  });

  it("Discovery findet alle bekannten IBAN-Tabellen (Schutz gegen stille Discovery-Brüche)", () => {
    const foundTables = new Set(ibanColumns.map((c) => c.table));
    for (const t of EXPECTED_TABLES) {
      assert.ok(
        foundTables.has(t),
        `Tabelle '${t}' mit IBAN-Spalte wurde nicht entdeckt — information_schema-Abfrage prüfen`,
      );
    }
    // Mindestens die bekannten 8 Tabellen; neue Tabellen kommen automatisch dazu
    assert.ok(ibanColumns.length >= EXPECTED_TABLES.length);
  });

  it("keine Klartext-IBAN in irgendeiner IBAN-Spalte (enc:v1:-Präfix fehlt)", async () => {
    const violations: string[] = [];
    for (const { table, column } of ibanColumns) {
      const res = await rootDb.execute(sql`
        SELECT id::text AS id, ${sql.identifier(column)} AS val
        FROM ${sql.identifier(table)}
        WHERE ${sql.identifier(column)} IS NOT NULL
          AND ${sql.identifier(column)} <> ''
          AND ${sql.identifier(column)} NOT LIKE 'enc:v1:%'
          AND upper(replace(${sql.identifier(column)}, ' ', '')) ~ ${IBAN_SQL_REGEX}
        LIMIT 20
      `);
      const rows = (res as any).rows as { id: string; val: string }[];
      for (const r of rows) {
        violations.push(
          `${table}.${column} id=${r.id}: Klartext-IBAN beginnend mit '${String(r.val).slice(0, 4)}…'`,
        );
      }
    }
    assert.deepEqual(
      violations,
      [],
      `Klartext-IBANs gefunden — ein Schreibpfad ruft encryptField nicht auf:\n${violations.join("\n")}`,
    );
  });

  it("kein Klartext-BIC in irgendeiner bic-Spalte", async () => {
    const violations: string[] = [];
    for (const { table, column } of bicColumns) {
      const res = await rootDb.execute(sql`
        SELECT id::text AS id
        FROM ${sql.identifier(table)}
        WHERE ${sql.identifier(column)} IS NOT NULL
          AND ${sql.identifier(column)} <> ''
          AND ${sql.identifier(column)} NOT LIKE 'enc:v1:%'
          AND upper(replace(${sql.identifier(column)}, ' ', '')) ~ ${BIC_SQL_REGEX}
        LIMIT 20
      `);
      const rows = (res as any).rows as { id: string }[];
      for (const r of rows) {
        violations.push(`${table}.${column} id=${r.id}: Klartext-BIC`);
      }
    }
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
