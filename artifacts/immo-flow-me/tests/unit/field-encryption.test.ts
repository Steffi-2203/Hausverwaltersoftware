/**
 * Tests für Feldverschlüsselung (IBAN/BIC at-rest) und PII-Maskierung.
 *
 * Setzt FIELD_ENCRYPTION_KEY temporär für die Testdauer.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

// ---- Schlüssel-Setup -----
const TEST_KEY = Buffer.from("0".repeat(32), "utf8").toString("base64"); // 32 Byte, deterministisch
const origKey = process.env.FIELD_ENCRYPTION_KEY;
before(() => { process.env.FIELD_ENCRYPTION_KEY = TEST_KEY; });
after(() => {
  if (origKey === undefined) delete process.env.FIELD_ENCRYPTION_KEY;
  else process.env.FIELD_ENCRYPTION_KEY = origKey;
});

// ---- Import nach Key-Setup -----
import {
  encryptField,
  decryptField,
  isEncrypted,
  decryptIbanFields,
  decryptIbanRows,
} from "../../server/lib/fieldEncryption.js";
import { maskIban, maskBic, maskField } from "../../server/lib/maskPii.js";

// ============================================================
// fieldEncryption
// ============================================================

describe("fieldEncryption — encryptField", () => {
  it("verschlüsselt einen Klartext-IBAN", () => {
    const iban = "AT611904300234573201";
    const enc = encryptField(iban);
    assert.ok(enc, "Ergebnis muss truthy sein");
    assert.ok(enc!.startsWith("enc:v1:"), "Präfix enc:v1: erwartet");
    assert.notEqual(enc, iban, "Ciphertext darf nicht dem Klartext entsprechen");
  });

  it("ist idempotent — verschlüsselt nicht erneut", () => {
    const iban = "AT611904300234573201";
    const enc1 = encryptField(iban)!;
    const enc2 = encryptField(enc1)!;
    assert.equal(enc2, enc1, "Doppeltes Verschlüsseln muss dasselbe Ergebnis liefern");
  });

  it("gibt null für null zurück", () => {
    assert.equal(encryptField(null), null);
  });

  it("gibt leeren String für leeren String zurück", () => {
    assert.equal(encryptField(""), "");
  });
});

describe("fieldEncryption — decryptField", () => {
  it("Roundtrip: encrypt → decrypt ergibt Original", () => {
    const ibans = ["AT611904300234573201", "DE89370400440532013000", "CH9300762011623852957"];
    for (const iban of ibans) {
      const enc = encryptField(iban)!;
      const dec = decryptField(enc);
      assert.equal(dec, iban, `Roundtrip fehlgeschlagen für ${iban}`);
    }
  });

  it("Klartext-Passthrough (noch nicht verschlüsselt)", () => {
    const plain = "AT611904300234573201";
    assert.equal(decryptField(plain), plain, "Klartext-Wert muss unverändert zurückgegeben werden");
  });

  it("gibt null für null zurück", () => {
    assert.equal(decryptField(null), null);
  });

  it("gibt leeren String für leeren String zurück", () => {
    assert.equal(decryptField(""), "");
  });

  it("wirft bei beschädigtem Ciphertext", () => {
    assert.throws(() => decryptField("enc:v1:UNGÜLTIG!!!"), /Ciphertext|Fehler|invalid/i);
  });
});

describe("fieldEncryption — isEncrypted", () => {
  it("erkennt verschlüsselte Werte", () => {
    assert.ok(isEncrypted(encryptField("AT611904300234573201")));
  });

  it("erkennt unverschlüsselte Werte als false", () => {
    assert.equal(isEncrypted("AT611904300234573201"), false);
    assert.equal(isEncrypted(null), false);
    assert.equal(isEncrypted(undefined), false);
    assert.equal(isEncrypted(""), false);
  });
});

describe("fieldEncryption — decryptIbanFields / decryptIbanRows", () => {
  it("entschlüsselt iban und bic in einem Objekt", () => {
    const row = {
      id: "1",
      iban: encryptField("AT611904300234573201")!,
      bic: encryptField("BKAUATWW")!,
    };
    const dec = decryptIbanFields(row);
    assert.equal(dec.iban, "AT611904300234573201");
    assert.equal(dec.bic, "BKAUATWW");
  });

  it("entschlüsselt ein Array von Zeilen", () => {
    const rows = [
      { id: "1", iban: encryptField("AT611904300234573201")!, bic: null },
      { id: "2", iban: null, bic: encryptField("BKAUATWW")! },
    ];
    const dec = decryptIbanRows(rows);
    assert.equal(dec[0].iban, "AT611904300234573201");
    assert.equal(dec[1].bic, "BKAUATWW");
  });

  it("lässt null-Felder unverändert", () => {
    const row = { id: "1", iban: null, bic: null };
    const dec = decryptIbanFields(row);
    assert.equal(dec.iban, null);
    assert.equal(dec.bic, null);
  });
});

describe("fieldEncryption — At-Rest: verschlüsselt gespeicherter Wert ist nie Klartext", () => {
  it("gespeicherter Ciphertext enthält nicht den IBAN-Klartext", () => {
    const iban = "AT611904300234573201";
    const enc = encryptField(iban)!;
    assert.ok(!enc.includes(iban), "Ciphertext darf die Klartext-IBAN nicht enthalten");
  });

  it("zwei Verschlüsselungen desselben Wertes sind verschieden (zufälliges IV)", () => {
    const iban = "AT611904300234573201";
    const enc1 = encryptField(iban)!;
    const enc2 = encryptField(iban)!;
    // Reset isEncrypted-Cache zwischen Aufrufen ist nicht nötig — neue IV-Erzeugung
    assert.notEqual(enc1, enc2, "Jede Verschlüsselung muss einen anderen Ciphertext erzeugen");
  });
});

// ============================================================
// maskPii
// ============================================================

describe("maskPii — maskIban", () => {
  it("maskiert Standardformat (AT)", () => {
    const masked = maskIban("AT611904300234573201");
    assert.match(masked, /^AT61\*+\d{4}$/, "Format: Ländercode + Prüfz. + Sterne + letzte 4");
    assert.ok(!masked.includes("1904"), "Mittelteil darf nicht sichtbar sein");
  });

  it("maskiert IBAN-Varianten", () => {
    const de = maskIban("DE89370400440532013000");
    assert.ok(de.startsWith("DE89"), "Deutsch IBAN muss mit DE89 beginnen");
    assert.ok(de.endsWith("3000"), "Letzte 4 Ziffern müssen sichtbar sein");
  });

  it("gibt Placeholder für null zurück", () => {
    assert.equal(maskIban(null), "[keine IBAN]");
    assert.equal(maskIban(""), "[keine IBAN]");
  });

  it("vollständige IBAN erscheint nicht im Ergebnis", () => {
    const iban = "AT611904300234573201";
    const masked = maskIban(iban);
    assert.notEqual(masked, iban, "Maskierter Wert darf nicht der vollständigen IBAN entsprechen");
    assert.ok(masked.includes("*"), "Maskierter Wert muss Sterne enthalten");
  });
});

describe("maskPii — maskBic", () => {
  it("maskiert BIC-Code", () => {
    const masked = maskBic("BKAUATWW");
    assert.ok(masked.includes("*"), "BIC muss Sterne enthalten");
    assert.ok(!masked.includes("BKAUATWW"), "Vollständiger BIC darf nicht sichtbar sein");
  });
});

describe("maskPii — maskField", () => {
  it("maskiert generisches Feld", () => {
    // "Geheimwert123" = 13 Zeichen; letzte 4 = "t123", erste 9 = "*"
    const masked = maskField("Geheimwert123", 4);
    assert.equal(masked, "*********t123", "Letzte 4 Zeichen sichtbar");
  });

  it("gibt Placeholder für null zurück", () => {
    assert.equal(maskField(null), "[leer]");
  });
});

// ============================================================
// Schlüsselfehlerbehandlung
// ============================================================

describe("fieldEncryption — fehlender Schlüssel", () => {
  it("decryptField wirft wenn Schlüssel fehlt und Wert verschlüsselt ist", () => {
    const enc = encryptField("AT611904300234573201")!;
    const savedKey = process.env.FIELD_ENCRYPTION_KEY;
    delete process.env.FIELD_ENCRYPTION_KEY;
    try {
      assert.throws(() => decryptField(enc), /FIELD_ENCRYPTION_KEY/);
    } finally {
      process.env.FIELD_ENCRYPTION_KEY = savedKey;
    }
  });
});
