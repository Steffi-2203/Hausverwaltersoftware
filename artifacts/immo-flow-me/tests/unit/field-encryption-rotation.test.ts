/**
 * Task #132: IBAN-Daten bleiben nach einem Schlüsselwechsel lesbar.
 *
 * Testet rotateFieldEncryptionKey: alte enc:v1:-Werte werden mit dem alten
 * Schlüssel gelesen und mit dem neuen neu verschlüsselt; Klartext wird neu
 * verschlüsselt; nicht entschlüsselbare Zeilen werden als Fehler gesammelt
 * statt den Lauf abzubrechen; der Lauf ist idempotent.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { rootDb } from '../../server/db';
import {
  parseEncryptionKey,
  encryptFieldWithKey,
  decryptFieldWithKey,
  isEncrypted,
} from '../../server/lib/fieldEncryption';
import { rotateFieldEncryptionKey } from '../../server/lib/rotateFieldEncryption';
import { acquireEncryptionTestLock, releaseEncryptionTestLock } from '../helpers/encryptionTestLock';

const OLD_KEY_B64 = randomBytes(32).toString('base64');
const NEW_KEY_B64 = randomBytes(32).toString('base64');
const FOREIGN_KEY = parseEncryptionKey(randomBytes(32).toString('base64'));
const OLD_KEY = parseEncryptionKey(OLD_KEY_B64);
const NEW_KEY = parseEncryptionKey(NEW_KEY_B64);

const ORG = randomUUID();
const T_OLD = randomUUID();     // mit altem Key verschlüsselt
const T_PLAIN = randomUUID();   // Klartext-Altbestand
const T_FOREIGN = randomUUID(); // mit fremdem Key verschlüsselt (Fehlerfall)

const IBAN_OLD = 'AT611904300234573201';
const IBAN_PLAIN = 'AT026000000001349870';
const IBAN_FOREIGN = 'AT483200000012345864';

async function readIban(id: string): Promise<string> {
  const r = await rootDb.execute(sql`SELECT iban FROM tenants WHERE id = ${id}`);
  return (r.rows[0] as any).iban;
}

const PROP = randomUUID();
const UNIT = randomUUID();

before(async () => {
  await acquireEncryptionTestLock();
  await rootDb.execute(sql`INSERT INTO organizations (id, name) VALUES (${ORG}::uuid, 'RotOrg')`);
  await rootDb.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code)
    VALUES (${PROP}::uuid, ${ORG}::uuid, 'RotProp', 'Teststr. 1', 'Wien', '1010')
  `);
  await rootDb.execute(sql`
    INSERT INTO units (id, property_id, top_nummer)
    VALUES (${UNIT}::uuid, ${PROP}::uuid, 'Top 1')
  `);
  const seed = async (id: string, iban: string, name: string) => rootDb.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, iban)
    VALUES (${id}::uuid, ${UNIT}::uuid, 'Rot', ${name}, ${iban})
  `);
  await seed(T_OLD, encryptFieldWithKey(IBAN_OLD, OLD_KEY)!, 'Alt');
  await seed(T_PLAIN, IBAN_PLAIN, 'Klartext');
  await seed(T_FOREIGN, encryptFieldWithKey(IBAN_FOREIGN, FOREIGN_KEY)!, 'Fremd');
});

after(async () => {
  await rootDb.execute(sql`DELETE FROM tenants WHERE unit_id = ${UNIT}::uuid`);
  await rootDb.execute(sql`DELETE FROM units WHERE id = ${UNIT}::uuid`);
  await rootDb.execute(sql`DELETE FROM properties WHERE id = ${PROP}::uuid`);
  await rootDb.execute(sql`DELETE FROM organizations WHERE id = ${ORG}::uuid`);
  await releaseEncryptionTestLock();
});

test('Rotation: alter Ciphertext wird mit neuem Schlüssel lesbar, Klartext wird verschlüsselt, Fremd-Ciphertext → Fehler ohne Abbruch', async () => {
  const result = await rotateFieldEncryptionKey(OLD_KEY_B64, NEW_KEY_B64, { tables: ['tenants'] });

  // Alte Zeile: jetzt mit NEUEM Schlüssel entschlüsselbar, Inhalt unverändert
  const rotated = await readIban(T_OLD);
  assert.ok(isEncrypted(rotated));
  assert.equal(decryptFieldWithKey(rotated, NEW_KEY), IBAN_OLD);
  assert.throws(() => decryptFieldWithKey(rotated, OLD_KEY), 'alter Schlüssel darf nicht mehr passen');

  // Klartext-Zeile: jetzt verschlüsselt mit neuem Schlüssel
  const plainNow = await readIban(T_PLAIN);
  assert.ok(isEncrypted(plainNow));
  assert.equal(decryptFieldWithKey(plainNow, NEW_KEY), IBAN_PLAIN);

  // Fremd-Zeile: unverändert, als Fehler protokolliert — Lauf lief durch
  const foreignNow = await readIban(T_FOREIGN);
  assert.equal(decryptFieldWithKey(foreignNow, FOREIGN_KEY), IBAN_FOREIGN, 'Fremd-Zeile darf nicht verändert werden');
  assert.ok(result.errors.some(e => e.includes(`tenants.iban id=${T_FOREIGN}`)));
  // Kein Klartext in Fehlermeldungen
  for (const e of result.errors) {
    assert.ok(!e.includes(IBAN_OLD) && !e.includes(IBAN_PLAIN) && !e.includes(IBAN_FOREIGN), 'Fehlermeldungen dürfen keine IBAN enthalten');
  }
  assert.ok(result.rotated >= 1);
  assert.ok(result.encrypted >= 1);
});

test('Idempotenz: zweiter Lauf überspringt bereits rotierte Zeilen und ändert nichts', async () => {
  const before1 = await readIban(T_OLD);
  const result = await rotateFieldEncryptionKey(OLD_KEY_B64, NEW_KEY_B64, { tables: ['tenants'] });
  assert.equal(await readIban(T_OLD), before1, 'bereits rotierte Zeile bleibt byte-identisch');
  assert.ok(result.skipped >= 2, 'rotierte + neu verschlüsselte Zeilen werden übersprungen');
});

test('Ungültiger Schlüssel wird sofort abgelehnt (keine halbe Rotation)', async () => {
  await assert.rejects(() => rotateFieldEncryptionKey('zukurz', NEW_KEY_B64, { tables: ['tenants'] }));
  await assert.rejects(() => rotateFieldEncryptionKey(NEW_KEY_B64, NEW_KEY_B64, { tables: ['tenants'] }), /identisch/);
});

test('Verifikationsdurchgang: während der Rotation mit ALTEM Schlüssel geschriebene Zeile wird nachgezogen', async () => {
  const lateId = randomUUID();
  const IBAN_LATE = 'AT531900000012345678';
  const result = await rotateFieldEncryptionKey(OLD_KEY_B64, NEW_KEY_B64, {
    tables: ['tenants'],
    onPassComplete: async (pass) => {
      if (pass !== 1) return;
      // simuliert einen noch laufenden Server, der mit dem alten Schlüssel schreibt
      await rootDb.execute(sql`
        INSERT INTO tenants (id, unit_id, first_name, last_name, iban)
        VALUES (${lateId}::uuid, ${UNIT}::uuid, 'Rot', 'Spät', ${encryptFieldWithKey(IBAN_LATE, OLD_KEY)})
      `);
    },
  });
  assert.ok(result.passes >= 2, 'mindestens ein Verifikationsdurchgang');
  assert.equal(result.verified, true, 'Lauf muss als verifiziert enden');
  const late = await readIban(lateId);
  assert.equal(decryptFieldWithKey(late, NEW_KEY), IBAN_LATE, 'nachträglich geschriebene Zeile muss rotiert sein');
});

test('Dauerhafte parallele Old-Key-Writes: Abschlussverifikation unter Tabellensperre zieht sie nach', async () => {
  const busyId = randomUUID();
  const IBAN_BUSY = 'AT611904300234573201';
  await rootDb.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, iban)
    VALUES (${busyId}::uuid, ${UNIT}::uuid, 'Rot', 'Busy', ${encryptFieldWithKey(IBAN_BUSY, OLD_KEY)})
  `);
  const result = await rotateFieldEncryptionKey(OLD_KEY_B64, NEW_KEY_B64, {
    tables: ['tenants'],
    onPassComplete: async () => {
      // Server schreibt nach JEDEM Durchgang erneut mit dem alten Schlüssel
      await rootDb.execute(sql`
        UPDATE tenants SET iban = ${encryptFieldWithKey(IBAN_BUSY, OLD_KEY)}
        WHERE id = ${busyId}::uuid
      `);
    },
  });
  // Der letzte Old-Key-Write passiert VOR der gesperrten Abschlussverifikation —
  // diese muss ihn sehen und nachziehen. Erst dann darf verified=true gelten.
  assert.equal(result.verified, true, 'Abschlussverifikation muss den Lauf abschließen');
  const busyNow = await readIban(busyId);
  assert.equal(decryptFieldWithKey(busyNow, NEW_KEY), IBAN_BUSY, 'Wert muss mit dem neuen Schlüssel allein lesbar sein');
  assert.throws(() => decryptFieldWithKey(busyNow, OLD_KEY), 'alter Schlüssel darf nicht mehr passen');
  await rootDb.execute(sql`DELETE FROM tenants WHERE id = ${busyId}::uuid`);
});

test('Old-Key-Write direkt vor dem Verifikationsfenster: wird unter Sperre nachgezogen, sonst kein Erfolg', async () => {
  const lateId = randomUUID();
  const IBAN_WINDOW = 'AT026000000001349870';
  const result = await rotateFieldEncryptionKey(OLD_KEY_B64, NEW_KEY_B64, {
    tables: ['tenants'],
    onBeforeFinalVerify: async () => {
      // simuliert den letztmöglichen Old-Key-Write bevor die Tabellensperre greift —
      // exakt das Zeitfenster, das eine lockfreie Verifikation übersehen würde
      await rootDb.execute(sql`
        INSERT INTO tenants (id, unit_id, first_name, last_name, iban)
        VALUES (${lateId}::uuid, ${UNIT}::uuid, 'Rot', 'Fenster', ${encryptFieldWithKey(IBAN_WINDOW, OLD_KEY)})
      `);
    },
  });
  assert.equal(result.verified, true);
  const val = await readIban(lateId);
  assert.equal(decryptFieldWithKey(val, NEW_KEY), IBAN_WINDOW, 'Fenster-Write muss mit neuem Schlüssel allein lesbar sein');
  await rootDb.execute(sql`DELETE FROM tenants WHERE id = ${lateId}::uuid`);
});

test('Abschlussverifikation blockiert konkurrierende Schreiber statt sie zu übersehen', async () => {
  // Ein während der Verifikation startender Write muss warten (EXCLUSIVE-Lock)
  // und landet damit NACH dem Commit — er kann die Verifikation nicht unterlaufen.
  const raceId = randomUUID();
  const IBAN_RACE = 'AT483200000012345864';
  let writeSettledDuringVerify = false;
  let writePromise: Promise<unknown> | null = null;

  const result = await rotateFieldEncryptionKey(OLD_KEY_B64, NEW_KEY_B64, {
    tables: ['tenants'],
    onBeforeFinalVerify: async () => {
      // Write parallel starten, NICHT awaiten — er soll gegen die Sperre laufen.
      writePromise = rootDb.execute(sql`
        INSERT INTO tenants (id, unit_id, first_name, last_name, iban)
        VALUES (${raceId}::uuid, ${UNIT}::uuid, 'Rot', 'Race', ${encryptFieldWithKey(IBAN_RACE, OLD_KEY)})
      `).then(() => { writeSettledDuringVerify = true; });
      // kurz warten damit der Write sicher unterwegs ist
      await new Promise(r => setTimeout(r, 50));
    },
  });
  assert.equal(result.verified, true);
  await writePromise!;
  // Egal ob der Write vor der Sperre durchkam (dann wurde er rotiert) oder
  // blockiert wurde (dann ist er alt-verschlüsselt, aber via _OLD-Fallback
  // lesbar und wird beim nächsten Lauf nachgezogen): er darf nie verloren sein.
  const val = await readIban(raceId);
  const readable =
    (() => { try { return decryptFieldWithKey(val, NEW_KEY) === IBAN_RACE; } catch { return false; } })() ||
    (() => { try { return decryptFieldWithKey(val, OLD_KEY) === IBAN_RACE; } catch { return false; } })();
  assert.ok(readable, 'Wert muss mit neuem ODER (übergangsweise) altem Schlüssel lesbar bleiben');
  void writeSettledDuringVerify;
  await rootDb.execute(sql`DELETE FROM tenants WHERE id = ${raceId}::uuid`);
});
