/**
 * Schlüsselrotation der Feldverschlüsselung (FIELD_ENCRYPTION_KEY_OLD).
 *
 * Prüft:
 *  1. decryptField-Fallback: mit Alt-Schlüssel verschlüsselte Werte bleiben lesbar
 *  2. reEncryptField: Alt-Ciphertext → mit NEUEM Schlüssel allein lesbar
 *  3. reEncryptField: no-op für aktuellen Ciphertext, verschlüsselt Klartext
 *  4. reEncryptField wirft wenn Wert mit keinem Schlüssel lesbar ist
 *  5. Ohne FIELD_ENCRYPTION_KEY_OLD wirft decryptField bei Alt-Ciphertext
 *  6. DB-Rotation: migrateFieldEncryption schlüsselt eine bank_accounts-Zeile
 *     mit Alt-Ciphertext auf den neuen Schlüssel um
 *
 * Ausfuehren:
 *   node --import=./node_modules/tsx/dist/esm/index.cjs --test tests/unit/field-encryption-rotation-fallback.test.ts
 */

import { describe, it, test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

// ── Schlüssel-Setup: NEUER Schlüssel aktiv, ALTER als _OLD ───────────────────
const OLD_KEY_B64 = Buffer.from("o".repeat(32), "utf8").toString("base64");
const NEW_KEY_B64 = Buffer.from("n".repeat(32), "utf8").toString("base64");
const OLD_KEY = Buffer.from(OLD_KEY_B64, "base64");
const NEW_KEY = Buffer.from(NEW_KEY_B64, "base64");

const savedKey = process.env.FIELD_ENCRYPTION_KEY;
const savedOld = process.env.FIELD_ENCRYPTION_KEY_OLD;
before(() => {
  process.env.FIELD_ENCRYPTION_KEY = NEW_KEY_B64;
  process.env.FIELD_ENCRYPTION_KEY_OLD = OLD_KEY_B64;
});
after(() => {
  if (savedKey === undefined) delete process.env.FIELD_ENCRYPTION_KEY;
  else process.env.FIELD_ENCRYPTION_KEY = savedKey;
  if (savedOld === undefined) delete process.env.FIELD_ENCRYPTION_KEY_OLD;
  else process.env.FIELD_ENCRYPTION_KEY_OLD = savedOld;
});

import {
  decryptField,
  decryptFieldWithKey,
  encryptFieldWithKey,
  reEncryptField,
  isEncrypted,
  isKeyRotationActive,
} from "../../server/lib/fieldEncryption.js";

const IBAN = "AT611904300234573201";

describe("Schlüsselrotation — decryptField-Fallback", () => {
  it("liest Alt-Schlüssel-Ciphertext solange _OLD gesetzt ist", () => {
    const encOld = encryptFieldWithKey(IBAN, OLD_KEY)!;
    assert.equal(decryptField(encOld), IBAN);
  });

  it("liest Werte mit aktuellem Schlüssel weiterhin normal", () => {
    const encNew = encryptFieldWithKey(IBAN, NEW_KEY)!;
    assert.equal(decryptField(encNew), IBAN);
  });

  it("wirft wenn der Wert mit KEINEM der beiden Schlüssel lesbar ist", () => {
    const otherKey = crypto.randomBytes(32);
    const encOther = encryptFieldWithKey(IBAN, otherKey)!;
    assert.throws(() => decryptField(encOther));
  });

  it("ohne _OLD wirft decryptField bei Alt-Ciphertext (Fail-Closed)", () => {
    const encOld = encryptFieldWithKey(IBAN, OLD_KEY)!;
    delete process.env.FIELD_ENCRYPTION_KEY_OLD;
    try {
      assert.equal(isKeyRotationActive(), false);
      assert.throws(() => decryptField(encOld));
    } finally {
      process.env.FIELD_ENCRYPTION_KEY_OLD = OLD_KEY_B64;
    }
  });
});

describe("Schlüsselrotation — reEncryptField", () => {
  it("schlüsselt Alt-Ciphertext um: Ergebnis mit NEUEM Schlüssel allein lesbar", () => {
    const encOld = encryptFieldWithKey(IBAN, OLD_KEY)!;
    const rotated = reEncryptField(encOld)!;
    assert.notEqual(rotated, encOld, "Umschlüsselung muss neuen Ciphertext erzeugen");
    assert.ok(isEncrypted(rotated));
    // Entscheidend: OHNE Alt-Schlüssel lesbar
    assert.equal(decryptFieldWithKey(rotated, NEW_KEY), IBAN);
  });

  it("no-op für Werte die bereits mit dem aktuellen Schlüssel verschlüsselt sind", () => {
    const encNew = encryptFieldWithKey(IBAN, NEW_KEY)!;
    assert.equal(reEncryptField(encNew), encNew);
  });

  it("verschlüsselt Klartext mit dem aktuellen Schlüssel", () => {
    const rotated = reEncryptField(IBAN)!;
    assert.ok(isEncrypted(rotated));
    assert.equal(decryptFieldWithKey(rotated, NEW_KEY), IBAN);
  });

  it("null/leer bleiben unverändert", () => {
    assert.equal(reEncryptField(null), null);
    assert.equal(reEncryptField(""), "");
  });

  it("wirft wenn der Wert mit keinem Schlüssel lesbar ist (kein stilles Überspringen)", () => {
    const otherKey = crypto.randomBytes(32);
    const encOther = encryptFieldWithKey(IBAN, otherKey)!;
    assert.throws(() => reEncryptField(encOther));
  });
});

// ── DB-Rotation über die Boot-Migration ─────────────────────────────────────

describe("Schlüsselrotation — migrateFieldEncryption (DB)", () => {
  const orgId = uuidv4();
  const acctId = uuidv4();
  const txId = uuidv4();

  it("bricht bei geändertem Schlüssel ohne _OLD vor dem Start mit Rotationsanweisung ab", async () => {
    const unreadableOrgId = uuidv4();
    const unreadableAcctId = uuidv4();
    const { rootDb } = await import("../../server/db.js");
    const { sql } = await import("drizzle-orm");
    const { migrateFieldEncryption } = await import("../../server/lib/migrateFieldEncryption.js");
    const { acquireEncryptionTestLock, releaseEncryptionTestLock } = await import("../helpers/encryptionTestLock.js");
    await acquireEncryptionTestLock();

    try {
      const encWithPreviousKey = encryptFieldWithKey(IBAN, OLD_KEY)!;
      await rootDb.execute(sql`
        INSERT INTO organizations (id, name) VALUES (${unreadableOrgId}::uuid, 'Unlesbarer-Schluessel-Org')
      `);
      await rootDb.execute(sql`
        INSERT INTO bank_accounts (id, organization_id, account_name, iban)
        VALUES (${unreadableAcctId}::uuid, ${unreadableOrgId}::uuid, 'Unlesbares Konto', ${encWithPreviousKey})
      `);

      // Simuliert die gefährliche Konfigurationsänderung: neuer Key aktiv,
      // bisheriger Key wurde nicht als FIELD_ENCRYPTION_KEY_OLD mitgegeben.
      delete process.env.FIELD_ENCRYPTION_KEY_OLD;
      await assert.rejects(
        migrateFieldEncryption(),
        /FIELD_ENCRYPTION_KEY_OLD.*sicher umschlüsseln/i,
      );
    } finally {
      process.env.FIELD_ENCRYPTION_KEY_OLD = OLD_KEY_B64;
      await rootDb.execute(sql`DELETE FROM bank_accounts WHERE id = ${unreadableAcctId}::uuid`).catch(() => {});
      await rootDb.execute(sql`DELETE FROM organizations WHERE id = ${unreadableOrgId}::uuid`).catch(() => {});
      await releaseEncryptionTestLock();
    }
  });

  it("schlüsselt bank_accounts- und transactions-Bestandsdaten auf den neuen Schlüssel um", async () => {
    // Import erst hier: zieht server/db (braucht DATABASE_URL)
    const { rootDb } = await import("../../server/db.js");
    const { sql } = await import("drizzle-orm");
    const { migrateFieldEncryption } = await import("../../server/lib/migrateFieldEncryption.js");
    const { acquireEncryptionTestLock, releaseEncryptionTestLock } = await import("../helpers/encryptionTestLock.js");
    await acquireEncryptionTestLock();

    const encOldIban = encryptFieldWithKey(IBAN, OLD_KEY)!;
    const encOldBic = encryptFieldWithKey("BKAUATWW", OLD_KEY)!;

    try {
      await rootDb.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'Rotation-Org')`);
      await rootDb.execute(sql`
        INSERT INTO bank_accounts (id, organization_id, account_name, iban, bic)
        VALUES (${acctId}::uuid, ${orgId}::uuid, 'Rotation-Konto', ${encOldIban}, ${encOldBic})
      `);
      await rootDb.execute(sql`
        INSERT INTO transactions (id, bank_account_id, amount, transaction_date, partner_iban)
        VALUES (${txId}::uuid, ${acctId}::uuid, 1, now(), ${encOldIban})
      `);

      await migrateFieldEncryption();

      const acct = (await rootDb.execute(sql`SELECT iban, bic FROM bank_accounts WHERE id = ${acctId}::uuid`)).rows[0] as any;
      const tx = (await rootDb.execute(sql`SELECT partner_iban FROM transactions WHERE id = ${txId}::uuid`)).rows[0] as any;

      // Alle Werte: verschlüsselt UND mit dem neuen Schlüssel allein lesbar
      for (const [label, value, expected] of [
        ["bank_accounts.iban", acct.iban, IBAN],
        ["bank_accounts.bic", acct.bic, "BKAUATWW"],
        ["transactions.partner_iban", tx.partner_iban, IBAN],
      ] as const) {
        assert.ok(isEncrypted(value), `${label} muss verschlüsselt sein`);
        assert.notEqual(value, label === "bank_accounts.bic" ? encOldBic : encOldIban, `${label} muss umgeschlüsselt sein`);
        assert.equal(decryptFieldWithKey(value, NEW_KEY), expected, `${label} muss mit dem neuen Schlüssel lesbar sein`);
      }
    } finally {
      await rootDb.execute(sql`DELETE FROM transactions WHERE id = ${txId}::uuid`).catch(() => {});
      await rootDb.execute(sql`DELETE FROM bank_accounts WHERE id = ${acctId}::uuid`).catch(() => {});
      await rootDb.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`).catch(() => {});
      await releaseEncryptionTestLock();
    }
  });
});
