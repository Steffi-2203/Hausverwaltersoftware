/**
 * Task #134: FIELD_ENCRYPTION_KEY muss strikt validiert werden.
 * parseEncryptionKey ist die gemeinsame Validierung für Boot-Check
 * (server/index.ts), Deployment-Check (scripts/check-deployment-env.ts)
 * und Schlüsselrotation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { parseEncryptionKey } from '../../server/lib/fieldEncryption';

test('akzeptiert einen korrekt erzeugten 32-Byte-Base64-Schlüssel', () => {
  const b64 = randomBytes(32).toString('base64');
  const key = parseEncryptionKey(b64);
  assert.equal(key.length, 32);
  assert.equal(key.toString('base64'), b64);
});

test('lehnt zu kurze und zu lange Schlüssel ab', () => {
  assert.throws(() => parseEncryptionKey(randomBytes(16).toString('base64')), /32 Bytes/);
  assert.throws(() => parseEncryptionKey(randomBytes(33).toString('base64')), /32 Bytes/);
  assert.throws(() => parseEncryptionKey(''), /Base64/);
});

test('lehnt malformtes Base64 ab das Node still auf 32 Bytes dekodieren würde', () => {
  // 43 gültige Zeichen + 1 ungültiges: Buffer.from ignoriert das '!' still
  // und liefert 32 Bytes — genau der Fall, den die strikte Prüfung abfangen muss.
  const malformed = 'A'.repeat(43) + '!';
  assert.throws(() => parseEncryptionKey(malformed), /Base64/);
});

test('lehnt nicht-kanonisches Base64 ab (Decode/Re-Encode-Differenz)', () => {
  const canonical = randomBytes(32).toString('base64'); // endet auf '='
  assert.ok(canonical.endsWith('='), 'Testannahme: 32-Byte-Key hat Padding');
  // Padding entfernen → dekodiert weiterhin zu 32 Bytes, ist aber nicht kanonisch
  const unpadded = canonical.replace(/=+$/, '');
  assert.throws(() => parseEncryptionKey(unpadded), /kanonisches Base64/);
  // letztes Datenzeichen verändert non-zero Padding-Bits → ebenfalls nicht kanonisch
});
