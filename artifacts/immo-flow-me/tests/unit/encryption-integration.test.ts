/**
 * Integration tests: IBAN/PII Feldverschlüsselung — Persistenz & Crypto-Helpers.
 *
 * Beweist mit echter Datenbank:
 *  1. encryptField → rootDb insert → rootDb read → Chiffretext in DB
 *  2. decryptIbanFields / decryptIbanRows entschlüsseln korrekt
 *  3. transactions.partnerIban: encryptField + DB-Roundtrip
 *  4. kautionen.treuhandkontoIban: encryptField + DB-Roundtrip
 *  5. migrateFieldEncryption läuft idempotent durch
 *  6. migrateFieldEncryption kehrt ohne Key sofort zurück
 *
 * Hinweis: storage.*-Methoden benötigen RLS-Org-Kontext; deshalb wird für
 * Fixture-Erstellung und Verifikation rootDb verwendet. Die storage-Decrypt-
 * Logik wird über decryptIbanFields/decryptIbanRows direkt geprüft.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { v4 as uuidv4 } from "uuid";
import { eq, inArray } from "drizzle-orm";
import { rootDb } from "../../server/db";

// ── Schlüssel-Setup: deterministischer Test-Key (32 Byte) ────────────────────
const TEST_KEY = Buffer.alloc(32, 0).toString("base64");
const _origKey = process.env.FIELD_ENCRYPTION_KEY;
before(() => { process.env.FIELD_ENCRYPTION_KEY = TEST_KEY; });
// Serialisierung gegen andere Encryption-DB-Tests (siehe encryptionTestLock.ts):
// diese Datei erzeugt verschlüsselte Fixtures und ruft die globale Boot-Migration auf.
import { acquireEncryptionTestLock, releaseEncryptionTestLock } from "../helpers/encryptionTestLock";
before(async () => { await acquireEncryptionTestLock(); });
after(() => {
  if (_origKey === undefined) delete process.env.FIELD_ENCRYPTION_KEY;
  else process.env.FIELD_ENCRYPTION_KEY = _origKey;
});
import * as schema from "../../shared/schema";
import {
  isEncrypted,
  encryptField,
  decryptField,
  decryptIbanFields,
  decryptIbanRows,
} from "../../server/lib/fieldEncryption";

// ── ID-Tracking für Cleanup ──────────────────────────────────────────────────

const ids = {
  orgs:         [] as string[],
  properties:   [] as string[],
  units:        [] as string[],
  tenants:      [] as string[],
  bankAccounts: [] as string[],
  transactions: [] as string[],
  kautionen:    [] as string[],
};

after(async () => {
  if (ids.kautionen.length)
    await rootDb.delete(schema.kautionen).where(inArray(schema.kautionen.id, ids.kautionen));
  if (ids.transactions.length)
    await rootDb.delete(schema.transactions).where(inArray(schema.transactions.id, ids.transactions));
  if (ids.bankAccounts.length)
    await rootDb.delete(schema.bankAccounts).where(inArray(schema.bankAccounts.id, ids.bankAccounts));
  if (ids.tenants.length)
    await rootDb.delete(schema.tenants).where(inArray(schema.tenants.id, ids.tenants));
  if (ids.units.length)
    await rootDb.delete(schema.units).where(inArray(schema.units.id, ids.units));
  if (ids.properties.length)
    await rootDb.delete(schema.properties).where(inArray(schema.properties.id, ids.properties));
  if (ids.orgs.length)
    await rootDb.delete(schema.organizations).where(inArray(schema.organizations.id, ids.orgs));
  // Lock erst NACH dem Fixture-Cleanup freigeben — after-Hooks laufen in
  // Registrierungsreihenfolge; eine frühere Freigabe würde parallelen
  // Rotations-Tests noch lesbare Fremd-Fixtures zeigen.
  await releaseEncryptionTestLock();
});

// ── helpers ──────────────────────────────────────────────────────────────────

async function makeOrg() {
  const id = uuidv4();
  ids.orgs.push(id);
  await rootDb.insert(schema.organizations).values({
    id, name: `enc-int-test-${id.slice(0, 8)}`, subscriptionTier: "starter",
  } as any);
  return id;
}

async function makeProp(orgId: string) {
  const [p] = await rootDb.insert(schema.properties).values({
    id: uuidv4(), organizationId: orgId,
    name: "Enc-Test-Liegenschaft", address: "Testgasse 1",
    postalCode: "1010", city: "Wien", country: "AT",
  } as any).returning();
  ids.properties.push(p!.id);
  return p!;
}

async function makeUnit(propId: string) {
  const [u] = await rootDb.insert(schema.units).values({
    id: uuidv4(), propertyId: propId, topNummer: "1", type: "wohnung",
  } as any).returning();
  ids.units.push(u!.id);
  return u!;
}

// ── 1 & 2: BankAccount — Chiffretext in DB, Klartext nach Decrypt ────────────

describe("BankAccount IBAN: Chiffretext in DB, decryptIbanFields gibt Klartext", () => {
  const PLAIN_IBAN = "AT611904300234573201";
  const PLAIN_BIC  = "RLNWATW1";
  let baId: string;

  before(async () => {
    const orgId = await makeOrg();
    const prop = await makeProp(orgId);
    // Direkte rootDb-Insertion mit encryptField (spiegelt storage.createBankAccount wider)
    const [ba] = await rootDb.insert(schema.bankAccounts).values({
      id: uuidv4(),
      organizationId: orgId,
      propertyId: prop.id,
      bankName: "Test Bank",
      accountName: "Hauskonto",
      iban: encryptField(PLAIN_IBAN),
      bic:  encryptField(PLAIN_BIC),
    } as any).returning();
    baId = ba!.id;
    ids.bankAccounts.push(baId);
  });

  it("speichert enc:v1:-Chiffretext in der Datenbank", async () => {
    const [raw] = await rootDb.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, baId));
    assert.ok(isEncrypted(raw!.iban!), `IBAN muss enc:v1: sein, ist: ${raw!.iban}`);
    assert.ok(isEncrypted(raw!.bic!),  `BIC muss enc:v1: sein, ist: ${raw!.bic}`);
    assert.notEqual(raw!.iban, PLAIN_IBAN);
  });

  it("decryptIbanFields entschlüsselt den DB-Chiffretext zu Klartext", async () => {
    const [raw] = await rootDb.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, baId));
    const dec = decryptIbanFields(raw!);
    assert.equal(dec.iban, PLAIN_IBAN);
    assert.equal(dec.bic,  PLAIN_BIC);
  });

  it("decryptIbanRows verarbeitet eine Liste korrekt", async () => {
    const rows = await rootDb.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, baId));
    const [dec] = decryptIbanRows(rows);
    assert.equal(dec!.iban, PLAIN_IBAN);
    assert.equal(dec!.bic,  PLAIN_BIC);
  });
});

// ── 3: Tenant IBAN — Chiffretext in DB ───────────────────────────────────────

describe("Tenant IBAN: Chiffretext in DB, decryptIbanFields gibt Klartext", () => {
  const PLAIN_IBAN = "AT483200000012345864";
  const PLAIN_BIC  = "RLNOAT2L";
  let tenantId: string;

  before(async () => {
    const orgId = await makeOrg();
    const prop = await makeProp(orgId);
    const unit = await makeUnit(prop.id);

    const [t] = await rootDb.insert(schema.tenants).values({
      id: uuidv4(),
      unitId: unit.id,
      firstName: "Enc",
      lastName: "Test",
      email: `enc-${uuidv4()}@test.at`,
      iban: encryptField(PLAIN_IBAN),
      bic:  encryptField(PLAIN_BIC),
    } as any).returning();
    tenantId = t!.id;
    ids.tenants.push(tenantId);
  });

  it("speichert enc:v1:-Chiffretext in der Datenbank", async () => {
    const [raw] = await rootDb.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
    assert.ok(isEncrypted(raw!.iban!), `IBAN muss verschlüsselt sein, ist: ${raw!.iban}`);
    assert.ok(isEncrypted(raw!.bic!),  `BIC muss verschlüsselt sein, ist: ${raw!.bic}`);
  });

  it("decryptIbanFields entschlüsselt den Chiffretext zu Klartext", async () => {
    const [raw] = await rootDb.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
    const dec = decryptIbanFields(raw!);
    assert.equal(dec.iban, PLAIN_IBAN);
    assert.equal(dec.bic,  PLAIN_BIC);
  });
});

// ── 4: Organization IBAN — Chiffretext in DB ─────────────────────────────────

describe("Organization IBAN: Chiffretext in DB, decryptIbanFields gibt Klartext", () => {
  const PLAIN_IBAN = "AT611904300234573201";
  const PLAIN_BIC  = "BKAUATWW";
  let orgId: string;

  before(async () => {
    orgId = uuidv4();
    ids.orgs.push(orgId);
    await rootDb.insert(schema.organizations).values({
      id: orgId,
      name: `enc-org-test-${orgId.slice(0, 8)}`,
      subscriptionTier: "starter",
      iban: encryptField(PLAIN_IBAN),
      bic:  encryptField(PLAIN_BIC),
    } as any);
  });

  it("speichert enc:v1:-Chiffretext in der Datenbank", async () => {
    const [raw] = await rootDb.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
    assert.ok(isEncrypted(raw!.iban!), `IBAN muss verschlüsselt sein, ist: ${raw!.iban}`);
    assert.ok(isEncrypted(raw!.bic!),  `BIC muss verschlüsselt sein, ist: ${raw!.bic}`);
  });

  it("decryptIbanFields entschlüsselt den Chiffretext zu Klartext", async () => {
    const [raw] = await rootDb.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
    const dec = decryptIbanFields(raw!);
    assert.equal(dec.iban, PLAIN_IBAN);
    assert.equal(dec.bic,  PLAIN_BIC);
  });
});

// ── 5: transactions.partnerIban ───────────────────────────────────────────────

describe("Transaction partnerIban: Chiffretext in DB, decryptField gibt Klartext", () => {
  const PLAIN_IBAN = "DE89370400440532013000";
  let txId: string;

  before(async () => {
    const orgId = await makeOrg();
    const [tx] = await rootDb.insert(schema.transactions).values({
      id: uuidv4(),
      organizationId: orgId,
      amount: "100.00",
      transactionDate: new Date().toISOString().slice(0, 10),
      partnerIban: encryptField(PLAIN_IBAN),
      partnerName: "Gegenkonto GmbH",
    } as any).returning();
    txId = tx!.id;
    ids.transactions.push(txId);
  });

  it("speichert enc:v1:-Chiffretext in der Datenbank", async () => {
    const [raw] = await rootDb.select().from(schema.transactions).where(eq(schema.transactions.id, txId));
    assert.ok(isEncrypted(raw!.partnerIban!), `partnerIban muss enc:v1: sein, ist: ${raw!.partnerIban}`);
    assert.notEqual(raw!.partnerIban, PLAIN_IBAN);
  });

  it("decryptField entschlüsselt den Chiffretext zu Klartext", async () => {
    const [raw] = await rootDb.select().from(schema.transactions).where(eq(schema.transactions.id, txId));
    assert.equal(decryptField(raw!.partnerIban), PLAIN_IBAN);
  });
});

// ── 6: kautionen.treuhandkontoIban ───────────────────────────────────────────

describe("Kaution treuhandkontoIban: Chiffretext in DB, decryptField gibt Klartext", () => {
  const PLAIN_IBAN = "AT483200000012345864";
  let kautionId: string;

  before(async () => {
    const orgId = await makeOrg();
    const prop = await makeProp(orgId);
    const unit = await makeUnit(prop.id);

    const [tenant] = await rootDb.insert(schema.tenants).values({
      id: uuidv4(), unitId: unit.id,
      firstName: "K", lastName: "Test", email: `k-${uuidv4()}@test.at`,
    } as any).returning();
    ids.tenants.push(tenant!.id);

    const [k] = await rootDb.insert(schema.kautionen).values({
      id: uuidv4(),
      organizationId: orgId,
      tenantId: tenant!.id,
      unitId: unit.id,
      betrag: "2400",
      treuhandkontoIban: encryptField(PLAIN_IBAN),
      treuhandkontoBank: "Test Bank",
      status: "aktiv",
      zinssatz: "0",
    } as any).returning();
    kautionId = k!.id;
    ids.kautionen.push(kautionId);
  });

  it("speichert enc:v1:-Chiffretext in der Datenbank", async () => {
    const [raw] = await rootDb.select().from(schema.kautionen).where(eq(schema.kautionen.id, kautionId));
    assert.ok(isEncrypted(raw!.treuhandkontoIban!),
      `treuhandkontoIban muss enc:v1: sein, ist: ${raw!.treuhandkontoIban}`);
  });

  it("decryptField entschlüsselt den Chiffretext zu Klartext", async () => {
    const [raw] = await rootDb.select().from(schema.kautionen).where(eq(schema.kautionen.id, kautionId));
    assert.equal(decryptField(raw!.treuhandkontoIban), PLAIN_IBAN);
  });

  it("PATCH: encryptField-Wert in DB + decryptField = Klartext (update-Pfad)", async () => {
    const NEW_IBAN = "AT611904300234573201";
    await rootDb.update(schema.kautionen)
      .set({ treuhandkontoIban: encryptField(NEW_IBAN) })
      .where(eq(schema.kautionen.id, kautionId));

    const [raw] = await rootDb.select().from(schema.kautionen).where(eq(schema.kautionen.id, kautionId));
    assert.ok(isEncrypted(raw!.treuhandkontoIban!), "Nach PATCH muss Chiffretext in DB stehen");
    assert.equal(decryptField(raw!.treuhandkontoIban), NEW_IBAN);
  });
});

// ── 7: encryptField / decryptField Invarianten ───────────────────────────────

describe("encryptField / decryptField Invarianten", () => {
  it("decryptField(encryptField(x)) === x (Roundtrip)", () => {
    const ibans = ["AT611904300234573201", "DE89370400440532013000", "AT483200000012345864"];
    for (const iban of ibans) {
      const enc = encryptField(iban)!;
      assert.ok(isEncrypted(enc), `Muss Chiffretext sein für: ${iban}`);
      assert.equal(decryptField(enc), iban);
    }
  });

  it("decryptField gibt Klartext zurück wenn kein enc:v1:-Präfix (passthrough)", () => {
    const plain = "AT611904300234573201";
    assert.equal(decryptField(plain), plain);
  });

  it("encryptField(null) gibt null zurück", () => {
    assert.equal(encryptField(null), null);
  });

  it("jeder encryptField-Aufruf erzeugt einzigartigen Chiffretext (zufälliges IV)", () => {
    const iban = "AT611904300234573201";
    const enc1 = encryptField(iban);
    const enc2 = encryptField(iban);
    assert.notEqual(enc1, enc2, "Zwei Verschlüsselungen derselben IBAN müssen verschieden sein");
    assert.equal(decryptField(enc1), iban);
    assert.equal(decryptField(enc2), iban);
  });
});

// ── 8 & 9: Migration ─────────────────────────────────────────────────────────

describe("migrateFieldEncryption", () => {
  it("läuft idempotent durch (kein Fehler bei bereits verschlüsselten Feldern)", async () => {
    const { migrateFieldEncryption } = await import("../../server/lib/migrateFieldEncryption");
    await assert.doesNotReject(
      migrateFieldEncryption(),
      "Migration darf bei bereits verschlüsselten Feldern nicht werfen",
    );
  });

  it("kehrt sofort zurück wenn FIELD_ENCRYPTION_KEY fehlt", async () => {
    const { migrateFieldEncryption } = await import("../../server/lib/migrateFieldEncryption");
    const prev = process.env.FIELD_ENCRYPTION_KEY;
    delete process.env.FIELD_ENCRYPTION_KEY;
    try {
      await assert.doesNotReject(migrateFieldEncryption(), "Ohne Key darf kein Fehler kommen");
    } finally {
      process.env.FIELD_ENCRYPTION_KEY = prev;
    }
  });
});
