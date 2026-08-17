/**
 * Task #187: Parallele Org-Anlagen dürfen keine doppelten Standard-Verteilerschlüssel erzeugen.
 *
 * Szenario: Eine frische Test-Organisation, gegen die gleichzeitig
 *   - mehrere seedDistributionKeysForOrg()-Aufrufe (Per-Org-Seed) und
 *   - ein seedDistributionKeys()-Aufruf (Boot-Seed, alle Orgs)
 * laufen. Der partielle Unique-Index (organization_id, key_code) WHERE
 * property_id IS NULL und das ON CONFLICT DO NOTHING in beiden Seed-Pfaden
 * verhindern Duplikate — dieser Test weist nach, dass die Invariante unter
 * tatsächlicher Parallelität gilt.
 *
 * Erwartet: genau 6 Zeilen (eine pro key_code) für die Test-Org, keine
 * Unique-Violations, keine unerwarteten Ausnahmen.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";

import { rootDb as db } from "../../server/db";
import {
  seedDistributionKeys,
  seedDistributionKeysForOrg,
  STANDARD_DISTRIBUTION_KEYS,
} from "../../server/seedDistributionKeys";

const EXPECTED_KEY_COUNT = STANDARD_DISTRIBUTION_KEYS.length; // 6
const testOrgId = randomUUID();

describe("Parallele Org-Anlage — doppelte Standard-Verteilerschlüssel verhindern", () => {
  before(async () => {
    // Frische Test-Org anlegen (ohne distribution_keys)
    await db.execute(sql`
      INSERT INTO organizations (id, name)
      VALUES (${testOrgId}::uuid, 'DK-Concurrent-Test-Org')
      ON CONFLICT DO NOTHING
    `);
  });

  after(async () => {
    // Testdaten aufräumen
    await db.execute(sql`
      DELETE FROM distribution_keys
      WHERE organization_id = ${testOrgId}::uuid
    `);
    await db.execute(sql`
      DELETE FROM organizations
      WHERE id = ${testOrgId}::uuid
    `);
  });

  it("erzeugt nach parallelen Seed-Aufrufen exakt 6 Zeilen pro Org ohne Unique-Violations", async () => {
    // Fünf gleichzeitige Per-Org-Seeds + ein Boot-Seed (alle Orgs)
    await assert.doesNotReject(
      Promise.all([
        seedDistributionKeysForOrg(testOrgId),
        seedDistributionKeysForOrg(testOrgId),
        seedDistributionKeysForOrg(testOrgId),
        seedDistributionKeysForOrg(testOrgId),
        seedDistributionKeysForOrg(testOrgId),
        seedDistributionKeys(), // Boot-Seed berücksichtigt alle Orgs inkl. testOrgId
      ]),
      "Keine der parallelen Seed-Operationen darf eine Ausnahme werfen"
    );

    // Exakt 6 org-weite Schlüssel (property_id IS NULL) für die Test-Org
    const result = await db.execute(sql`
      SELECT key_code
      FROM distribution_keys
      WHERE organization_id = ${testOrgId}::uuid
        AND property_id IS NULL
      ORDER BY key_code
    `);

    assert.strictEqual(
      result.rows.length,
      EXPECTED_KEY_COUNT,
      `Erwartet ${EXPECTED_KEY_COUNT} Schlüssel, gefunden: ${result.rows.length}. ` +
        `key_codes: ${result.rows.map((r: any) => r.key_code).join(", ")}`
    );

    // Jeden erwarteten key_code genau einmal vorhanden
    const foundCodes = new Set(result.rows.map((r: any) => r.key_code));
    for (const key of STANDARD_DISTRIBUTION_KEYS) {
      assert.ok(
        foundCodes.has(key.keyCode),
        `key_code '${key.keyCode}' fehlt in den geseedeten Schlüsseln`
      );
    }

    assert.strictEqual(
      foundCodes.size,
      EXPECTED_KEY_COUNT,
      "Duplikate gefunden — foundCodes.size stimmt nicht mit EXPECTED_KEY_COUNT überein"
    );
  });

  it("ein zweiter Lauf nach bestehendem Seed ändert die Anzahl nicht", async () => {
    // Voraussetzung: Seed aus dem vorherigen Test ist bereits angewendet
    await assert.doesNotReject(
      Promise.all([
        seedDistributionKeysForOrg(testOrgId),
        seedDistributionKeys(),
      ]),
      "Wiederholter Seed darf keine Ausnahme werfen"
    );

    const result = await db.execute(sql`
      SELECT count(*)::int AS n
      FROM distribution_keys
      WHERE organization_id = ${testOrgId}::uuid
        AND property_id IS NULL
    `);

    assert.strictEqual(
      (result.rows[0] as any).n,
      EXPECTED_KEY_COUNT,
      `Nach wiederholtem Seed weiterhin exakt ${EXPECTED_KEY_COUNT} Schlüssel erwartet`
    );
  });
});
