/**
 * Regression-Test #191: Verschlüsselungs-Wartungsläufe dürfen nie Daten
 * einer falschen Organisation anfassen.
 *
 * migrateFieldEncryption und rotateFieldEncryptionKey schreiben mit rootDb
 * (RLS-Bypass) per Primärschlüssel zurück — das ist als Ausnahme dokumentiert,
 * weil sie alle Zeilen selbst gelesen haben. Dieser Test beweist:
 *
 *  1. MIGRATION: Zeilen BEIDER Orgs werden korrekt verschlüsselt.
 *  2. ROTATION:  Zeilen BEIDER Orgs werden korrekt umgeschlüsselt.
 *  3. ISOLATION: Eine unlesbare Zeile (Fremd-Schlüssel) in Org A
 *                korrumpiert NICHT die Zeilen in Org B.
 *  4. KEIN SEITENEFFEKT: Nicht-verschlüsselte Felder (first_name, last_name)
 *     bleiben vor/nach dem Lauf byte-identisch; die Zeilenzahl ist unverändert.
 *
 * Serialisiert per pg_advisory_lock mit den anderen field-encryption-Tests
 * (gleicher Lock-Schlüssel wie encryptionTestLock.ts).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { rootDb } from '../../server/db.js';
import {
  parseEncryptionKey,
  encryptFieldWithKey,
  decryptFieldWithKey,
  isEncrypted,
} from '../../server/lib/fieldEncryption.js';
import { rotateFieldEncryptionKey } from '../../server/lib/rotateFieldEncryption.js';
import { migrateFieldEncryption } from '../../server/lib/migrateFieldEncryption.js';
import {
  acquireEncryptionTestLock,
  releaseEncryptionTestLock,
} from '../helpers/encryptionTestLock.js';

// ── Schlüssel ────────────────────────────────────────────────────────────────

/** Schlüssel für Migration-Test (temporär als FIELD_ENCRYPTION_KEY gesetzt). */
const MIGRATE_KEY_B64 = randomBytes(32).toString('base64');
const MIGRATE_KEY     = parseEncryptionKey(MIGRATE_KEY_B64);

/** Schlüssel-Paar für Rotation-Test. */
const OLD_KEY_B64 = randomBytes(32).toString('base64');
const NEW_KEY_B64 = randomBytes(32).toString('base64');
const OLD_KEY     = parseEncryptionKey(OLD_KEY_B64);
const NEW_KEY     = parseEncryptionKey(NEW_KEY_B64);

/** Schlüssel, den KEIN Lauf kennt — simuliert Fremd-Ciphertext. */
const FOREIGN_KEY = parseEncryptionKey(randomBytes(32).toString('base64'));

// ── Fixture-IDs ───────────────────────────────────────────────────────────────

// Zwei vollständig getrennte Orgs (eigene Liegenschaft, Einheit, Mieter)
const ORG_A  = randomUUID();
const PROP_A = randomUUID();
const UNIT_A = randomUUID();

const ORG_B  = randomUUID();
const PROP_B = randomUUID();
const UNIT_B = randomUUID();

// ── Hilfs-Funktionen ─────────────────────────────────────────────────────────

async function readTenant(id: string): Promise<{ iban: string | null; firstName: string; lastName: string }> {
  const r = await rootDb.execute(sql`
    SELECT iban, first_name, last_name FROM tenants WHERE id = ${id}::uuid
  `);
  const row = r.rows[0] as { iban: string | null; first_name: string; last_name: string };
  return { iban: row.iban, firstName: row.first_name, lastName: row.last_name };
}

async function insertTenant(
  id: string,
  unitId: string,
  iban: string,
  firstName: string,
  lastName: string,
): Promise<void> {
  await rootDb.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, iban, email, status,
                         grundmiete, betriebskosten_vorschuss, heizungskosten_vorschuss, mietbeginn)
    VALUES (
      ${id}::uuid,
      ${unitId}::uuid,
      ${firstName}, ${lastName},
      ${iban},
      ${`${id}@cross-org-test.invalid`},
      'aktiv', 500, 100, 50, '2025-01-01'
    )
    ON CONFLICT (id) DO NOTHING
  `);
}

// ── Fixture-Setup ─────────────────────────────────────────────────────────────

before(async () => {
  await acquireEncryptionTestLock();

  // Org A
  await rootDb.execute(sql`
    INSERT INTO organizations (id, name) VALUES (${ORG_A}::uuid, 'CrossOrg-A')
    ON CONFLICT (id) DO NOTHING`);
  await rootDb.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code)
    VALUES (${PROP_A}::uuid, ${ORG_A}::uuid, 'CrossA-Liegenschaft', 'A-Str. 1', 'Wien', '1010')
    ON CONFLICT (id) DO NOTHING`);
  await rootDb.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type)
    VALUES (${UNIT_A}::uuid, ${PROP_A}::uuid, 'Top A1', 'wohnung')
    ON CONFLICT (id) DO NOTHING`);

  // Org B
  await rootDb.execute(sql`
    INSERT INTO organizations (id, name) VALUES (${ORG_B}::uuid, 'CrossOrg-B')
    ON CONFLICT (id) DO NOTHING`);
  await rootDb.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code)
    VALUES (${PROP_B}::uuid, ${ORG_B}::uuid, 'CrossB-Liegenschaft', 'B-Str. 1', 'Graz', '8010')
    ON CONFLICT (id) DO NOTHING`);
  await rootDb.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type)
    VALUES (${UNIT_B}::uuid, ${PROP_B}::uuid, 'Top B1', 'wohnung')
    ON CONFLICT (id) DO NOTHING`);
});

after(async () => {
  // FK-Reihenfolge: Mieter → Einheit → Liegenschaft → Org
  await rootDb.execute(sql`DELETE FROM tenants WHERE unit_id IN (${UNIT_A}::uuid, ${UNIT_B}::uuid)`);
  await rootDb.execute(sql`DELETE FROM units WHERE id IN (${UNIT_A}::uuid, ${UNIT_B}::uuid)`);
  await rootDb.execute(sql`DELETE FROM properties WHERE id IN (${PROP_A}::uuid, ${PROP_B}::uuid)`);
  await rootDb.execute(sql`DELETE FROM organizations WHERE id IN (${ORG_A}::uuid, ${ORG_B}::uuid)`);
  await releaseEncryptionTestLock();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('migrateFieldEncryption — cross-org', () => {
  const T_A_MIG = randomUUID(); // Org-A-Mieter mit Klartext-IBAN
  const T_B_MIG = randomUUID(); // Org-B-Mieter mit Klartext-IBAN
  const IBAN_A_MIG = 'AT611904300234573201';
  const IBAN_B_MIG = 'AT026000000001349870';

  // Ursprünglicher FIELD_ENCRYPTION_KEY — nach dem Test wiederherstellen
  const savedKey = process.env.FIELD_ENCRYPTION_KEY;

  before(async () => {
    await insertTenant(T_A_MIG, UNIT_A, IBAN_A_MIG, 'OrgA', 'Mig');
    await insertTenant(T_B_MIG, UNIT_B, IBAN_B_MIG, 'OrgB', 'Mig');
  });

  after(async () => {
    process.env.FIELD_ENCRYPTION_KEY = savedKey ?? '';
    if (!savedKey) delete process.env.FIELD_ENCRYPTION_KEY;
    await rootDb.execute(sql`DELETE FROM tenants WHERE id IN (${T_A_MIG}::uuid, ${T_B_MIG}::uuid)`);
  });

  it('verschlüsselt Klartext-IBANs beider Orgs und lässt andere Felder unberührt', async () => {
    // Zustand VOR der Migration prüfen
    const beforeA = await readTenant(T_A_MIG);
    const beforeB = await readTenant(T_B_MIG);
    assert.equal(beforeA.iban, IBAN_A_MIG, 'Org-A-IBAN muss vor Migration Klartext sein');
    assert.equal(beforeB.iban, IBAN_B_MIG, 'Org-B-IBAN muss vor Migration Klartext sein');

    // Migration mit Test-Schlüssel ausführen
    process.env.FIELD_ENCRYPTION_KEY = MIGRATE_KEY_B64;
    await migrateFieldEncryption();

    // Zustand NACH der Migration prüfen
    const afterA = await readTenant(T_A_MIG);
    const afterB = await readTenant(T_B_MIG);

    // Beide Orgs: IBAN jetzt verschlüsselt
    assert.ok(isEncrypted(afterA.iban!), 'Org-A-IBAN muss nach Migration enc:v1: haben');
    assert.ok(isEncrypted(afterB.iban!), 'Org-B-IBAN muss nach Migration enc:v1: haben');

    // Korrekte Entschlüsselung mit dem Test-Schlüssel
    assert.equal(decryptFieldWithKey(afterA.iban!, MIGRATE_KEY), IBAN_A_MIG,
      'Org-A-IBAN muss nach Migration mit Test-Schlüssel korrekt entschlüsselbar sein');
    assert.equal(decryptFieldWithKey(afterB.iban!, MIGRATE_KEY), IBAN_B_MIG,
      'Org-B-IBAN muss nach Migration mit Test-Schlüssel korrekt entschlüsselbar sein');

    // Nicht-verschlüsselte Felder unverändert (Seiteneffektprüfung)
    assert.equal(afterA.firstName, beforeA.firstName, 'Org-A: first_name darf nicht geändert werden');
    assert.equal(afterA.lastName,  beforeA.lastName,  'Org-A: last_name darf nicht geändert werden');
    assert.equal(afterB.firstName, beforeB.firstName, 'Org-B: first_name darf nicht geändert werden');
    assert.equal(afterB.lastName,  beforeB.lastName,  'Org-B: last_name darf nicht geändert werden');

    // Zeilenzahl unverändert (keine Zeile erzeugt oder gelöscht)
    const countR = await rootDb.execute(sql`
      SELECT COUNT(*)::int AS n FROM tenants WHERE id IN (${T_A_MIG}::uuid, ${T_B_MIG}::uuid)
    `);
    const countRow = countR.rows[0] as { n: number };
    assert.equal(countRow.n, 2, 'Zeilenzahl muss nach Migration unverändert 2 sein');
  });

  it('Idempotenz: zweiter Migrations-Lauf ändert bereits verschlüsselte IBANs nicht', async () => {
    const beforeA = await readTenant(T_A_MIG);
    const beforeB = await readTenant(T_B_MIG);

    // Beide IBANs sollten nach dem ersten Test schon enc:v1: sein
    assert.ok(isEncrypted(beforeA.iban!));
    assert.ok(isEncrypted(beforeB.iban!));

    await migrateFieldEncryption(); // Schlüssel ist noch MIGRATE_KEY_B64

    const afterA = await readTenant(T_A_MIG);
    const afterB = await readTenant(T_B_MIG);

    assert.equal(afterA.iban, beforeA.iban,
      'Org-A-IBAN darf bei idempotenter Migration nicht erneut verschlüsselt werden');
    assert.equal(afterB.iban, beforeB.iban,
      'Org-B-IBAN darf bei idempotenter Migration nicht erneut verschlüsselt werden');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('rotateFieldEncryptionKey — cross-org', () => {
  const T_A_ROT = randomUUID(); // Org-A-Mieter mit alt-verschlüsselter IBAN
  const T_B_ROT = randomUUID(); // Org-B-Mieter mit alt-verschlüsselter IBAN
  const IBAN_A_ROT = 'AT483200000012345864';
  const IBAN_B_ROT = 'AT531900000012345678';

  before(async () => {
    await insertTenant(T_A_ROT, UNIT_A, encryptFieldWithKey(IBAN_A_ROT, OLD_KEY)!, 'OrgA', 'Rot');
    await insertTenant(T_B_ROT, UNIT_B, encryptFieldWithKey(IBAN_B_ROT, OLD_KEY)!, 'OrgB', 'Rot');
  });

  after(async () => {
    await rootDb.execute(sql`DELETE FROM tenants WHERE id IN (${T_A_ROT}::uuid, ${T_B_ROT}::uuid)`);
  });

  it('rotiert alte Ciphertexte beider Orgs auf neuen Schlüssel, other fields unberührt', async () => {
    const beforeA = await readTenant(T_A_ROT);
    const beforeB = await readTenant(T_B_ROT);

    // Beide IBANs sind vor Rotation mit OLD_KEY verschlüsselt
    assert.ok(isEncrypted(beforeA.iban!));
    assert.ok(isEncrypted(beforeB.iban!));
    assert.equal(decryptFieldWithKey(beforeA.iban!, OLD_KEY), IBAN_A_ROT, 'Org-A-IBAN vor Rotation mit OLD_KEY lesbar');
    assert.equal(decryptFieldWithKey(beforeB.iban!, OLD_KEY), IBAN_B_ROT, 'Org-B-IBAN vor Rotation mit OLD_KEY lesbar');

    const result = await rotateFieldEncryptionKey(OLD_KEY_B64, NEW_KEY_B64, { tables: ['tenants'] });

    // Andere Testdateien laufen mit --test-concurrency=6 parallel und können
    // Tenants mit IBANs halten, die mit ihren eigenen Testschlüsseln verschlüsselt
    // sind. Die Rotation sieht alle Zeilen und schreibt für diese Fehler.
    // Relevant ist ausschließlich, dass MEINE Zeilen fehlerfrei rotiert wurden.
    const myErrorsA = result.errors.filter(e => e.includes(`id=${T_A_ROT}`));
    const myErrorsB = result.errors.filter(e => e.includes(`id=${T_B_ROT}`));
    assert.equal(myErrorsA.length, 0,
      `Org-A-Zeile darf keinen Rotationsfehler haben: ${myErrorsA.join(', ')}`);
    assert.equal(myErrorsB.length, 0,
      `Org-B-Zeile darf keinen Rotationsfehler haben: ${myErrorsB.join(', ')}`);
    assert.equal(result.verified, true, 'Lauf muss als verifiziert enden');

    const afterA = await readTenant(T_A_ROT);
    const afterB = await readTenant(T_B_ROT);

    // Beide Orgs: IBAN jetzt mit NEW_KEY lesbar
    assert.ok(isEncrypted(afterA.iban!), 'Org-A-IBAN muss nach Rotation enc:v1: haben');
    assert.ok(isEncrypted(afterB.iban!), 'Org-B-IBAN muss nach Rotation enc:v1: haben');
    assert.equal(decryptFieldWithKey(afterA.iban!, NEW_KEY), IBAN_A_ROT,
      'Org-A-IBAN muss nach Rotation mit NEW_KEY korrekt lesbar sein');
    assert.equal(decryptFieldWithKey(afterB.iban!, NEW_KEY), IBAN_B_ROT,
      'Org-B-IBAN muss nach Rotation mit NEW_KEY korrekt lesbar sein');

    // Alter Schlüssel darf nicht mehr passen
    assert.throws(() => decryptFieldWithKey(afterA.iban!, OLD_KEY),
      'Org-A-IBAN darf nach Rotation mit OLD_KEY nicht mehr lesbar sein');
    assert.throws(() => decryptFieldWithKey(afterB.iban!, OLD_KEY),
      'Org-B-IBAN darf nach Rotation mit OLD_KEY nicht mehr lesbar sein');

    // Nicht-verschlüsselte Felder unverändert
    assert.equal(afterA.firstName, 'OrgA', 'Org-A: first_name darf nicht geändert werden');
    assert.equal(afterB.firstName, 'OrgB', 'Org-B: first_name darf nicht geändert werden');
    assert.equal(afterA.lastName, 'Rot', 'Org-A: last_name darf nicht geändert werden');
    assert.equal(afterB.lastName, 'Rot', 'Org-B: last_name darf nicht geändert werden');

    // Zeilenzahl unverändert
    const countR = await rootDb.execute(sql`
      SELECT COUNT(*)::int AS n FROM tenants WHERE id IN (${T_A_ROT}::uuid, ${T_B_ROT}::uuid)
    `);
    const countRow = countR.rows[0] as { n: number };
    assert.equal(countRow.n, 2, 'Zeilenzahl muss nach Rotation unverändert 2 sein');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Isolation: Fremd-Ciphertext in Org A korrumpiert Org B nicht', () => {
  const T_A_FOREIGN = randomUUID(); // IBAN mit FREMDEM Schlüssel verschlüsselt
  const T_B_GOOD    = randomUUID(); // IBAN mit OLD_KEY verschlüsselt (soll rotiert werden)
  const IBAN_A_FOREIGN = 'AT026000000001349870';
  const IBAN_B_GOOD    = 'AT613204200036698509';

  before(async () => {
    await insertTenant(T_A_FOREIGN, UNIT_A, encryptFieldWithKey(IBAN_A_FOREIGN, FOREIGN_KEY)!, 'OrgA', 'Foreign');
    await insertTenant(T_B_GOOD,    UNIT_B, encryptFieldWithKey(IBAN_B_GOOD, OLD_KEY)!, 'OrgB', 'Good');
  });

  after(async () => {
    await rootDb.execute(sql`DELETE FROM tenants WHERE id IN (${T_A_FOREIGN}::uuid, ${T_B_GOOD}::uuid)`);
  });

  it('rotiert Org-B korrekt, sammelt Org-A als Fehler ohne Abbruch und lässt Org-A-Zeile unverändert', async () => {
    const beforeForeign = await readTenant(T_A_FOREIGN);

    const result = await rotateFieldEncryptionKey(OLD_KEY_B64, NEW_KEY_B64, { tables: ['tenants'] });

    // Org-A (Fremd-Ciphertext): Fehler gesammelt, aber Lauf lief durch
    assert.ok(
      result.errors.some(e => e.includes(`tenants.iban id=${T_A_FOREIGN}`)),
      `Fremd-Zeile muss als Fehler gemeldet sein: ${result.errors.join('; ')}`,
    );

    // Kein Klartext (IBAN-Werte) in Fehlermeldungen
    for (const e of result.errors) {
      assert.ok(
        !e.includes(IBAN_A_FOREIGN) && !e.includes(IBAN_B_GOOD),
        `Fehlermeldung darf keine IBAN enthalten: ${e}`,
      );
    }

    // Org-A-Zeile: unverändert (weiterhin mit FOREIGN_KEY lesbar)
    const afterForeign = await readTenant(T_A_FOREIGN);
    assert.equal(afterForeign.iban, beforeForeign.iban,
      'Org-A-Zeile mit Fremd-Ciphertext darf nicht verändert werden');
    assert.equal(decryptFieldWithKey(afterForeign.iban!, FOREIGN_KEY), IBAN_A_FOREIGN,
      'Org-A-Zeile muss weiterhin mit dem Fremd-Schlüssel lesbar sein');

    // Org-B-Zeile: korrekt rotiert, unabhängig vom Fehler in Org A
    const afterGood = await readTenant(T_B_GOOD);
    assert.ok(isEncrypted(afterGood.iban!));
    assert.equal(decryptFieldWithKey(afterGood.iban!, NEW_KEY), IBAN_B_GOOD,
      'Org-B-IBAN muss trotz Fehler in Org A korrekt mit NEW_KEY lesbar sein');
    assert.throws(() => decryptFieldWithKey(afterGood.iban!, OLD_KEY),
      'Org-B-IBAN darf nach Rotation nicht mehr mit OLD_KEY lesbar sein');

    // Non-IBAN-Felder beider Zeilen unberührt
    assert.equal(afterForeign.firstName, 'OrgA', 'Org-A: first_name darf nicht geändert werden');
    assert.equal(afterGood.firstName, 'OrgB', 'Org-B: first_name darf nicht geändert werden');
  });
});
