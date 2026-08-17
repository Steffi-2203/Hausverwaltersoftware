/**
 * Tests für die Schlüsselauflösung der Feldverschlüsselung:
 *  - kanonischer Base64-32-Byte-Schlüssel wird direkt verwendet
 *  - Passphrasen NUR mit explizitem Präfix "passphrase:" (>= 16 Zeichen danach),
 *    deterministisch per scrypt abgeleitet
 *  - malformtes/falsch langes/nicht-kanonisches Base64 schlägt weiterhin fehl
 *    (ein Tippfehler darf nie stillschweigend ein anderer Schlüssel werden)
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { parseEncryptionKey } from "../../server/lib/fieldEncryption";

describe("parseEncryptionKey — Schlüsselauflösung", () => {
  test("kanonischer Base64-Schlüssel (32 Bytes) wird direkt dekodiert", () => {
    const raw = crypto.randomBytes(32);
    const key = parseEncryptionKey(raw.toString("base64"));
    assert.equal(key.length, 32);
    assert.ok(key.equals(raw), "Base64-Schlüssel muss unverändert dekodiert werden");
  });

  test("umgebendes Whitespace wird toleriert", () => {
    const raw = crypto.randomBytes(32);
    const key = parseEncryptionKey(`  ${raw.toString("base64")}\n`);
    assert.ok(key.equals(raw));
  });

  test("passphrase:-Präfix (>= 16 Zeichen) wird deterministisch zu 32 Bytes abgeleitet", () => {
    const pass = "passphrase:eine lange Passphrase mit Umlauten äöü!";
    const k1 = parseEncryptionKey(pass);
    const k2 = parseEncryptionKey(pass);
    assert.equal(k1.length, 32);
    assert.ok(k1.equals(k2), "Ableitung muss deterministisch sein");
  });

  test("verschiedene Passphrasen ergeben verschiedene Schlüssel", () => {
    const k1 = parseEncryptionKey("passphrase:Nummer eins ist lang genug");
    const k2 = parseEncryptionKey("passphrase:Nummer zwei ist lang genug");
    assert.ok(!k1.equals(k2));
  });

  test("passphrase: mit zu kurzer Passphrase wird abgelehnt", () => {
    assert.throws(() => parseEncryptionKey("passphrase:kurz"), /mindestens 16 Zeichen/);
  });

  test("Satz mit Leerzeichen wird auch OHNE Präfix als Passphrase abgeleitet", () => {
    const sentence = "eine lange Passphrase mit Umlauten äöü!";
    const k1 = parseEncryptionKey(sentence);
    const k2 = parseEncryptionKey(`passphrase:${sentence}`);
    assert.equal(k1.length, 32);
    assert.ok(k1.equals(k2), "mit/ohne Präfix muss derselbe Schlüssel entstehen");
  });

  test("Wert ohne Leerzeichen und ohne Präfix wird NICHT abgeleitet, sondern abgelehnt", () => {
    assert.throws(
      () => parseEncryptionKey("nurEinWortMitUmlautäöüaberOhneLeerzeichen"),
      /kein gültiges Base64/,
    );
  });

  test("mehrzeilig umbrochenes kanonisches Base64 wird normalisiert und direkt verwendet", () => {
    const raw = crypto.randomBytes(32);
    const b64 = raw.toString("base64");
    const wrapped = b64.slice(0, 20) + "\n" + b64.slice(20);
    const key = parseEncryptionKey(wrapped);
    assert.ok(key.equals(raw), "umbrochenes Base64 muss als Schlüssel erkannt werden");
  });

  test("zu kurzer Satz mit Leerzeichen wird abgelehnt", () => {
    assert.throws(() => parseEncryptionKey("zu kurz satz"), /mindestens 16 Zeichen/);
  });

  test("malformtes Base64 (43 gültige Zeichen + '!') schlägt fehl — kein stiller Passphrase-Fallback", () => {
    assert.throws(() => parseEncryptionKey("A".repeat(43) + "!"), /kein gültiges Base64/);
  });

  test("Base64 mit falscher Länge (16 Bytes) schlägt fehl", () => {
    const b64of16 = crypto.randomBytes(16).toString("base64");
    assert.throws(() => parseEncryptionKey(b64of16), /32 Bytes/);
  });

  test("nicht-kanonisches Base64 (Padding entfernt) schlägt fehl", () => {
    const canonical = crypto.randomBytes(32).toString("base64");
    const unpadded = canonical.replace(/=+$/, "");
    assert.throws(() => parseEncryptionKey(unpadded), /kanonisches Base64/);
  });
});
