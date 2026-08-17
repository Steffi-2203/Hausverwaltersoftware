/**
 * IBAN-Validator — Unit-Tests
 *
 * Prüft den Modulo-97-Algorithmus (ISO 7064) korrekt:
 * - gültige AT/DE/CH-IBANs → valid
 * - falsche Prüfziffer (z.B. AT60 statt AT61) → invalid
 * - Leerstring / Formatfehler → invalid
 * - SEPA-Export bricht bei ungültiger Schuldner-IBAN ab
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// Wir importieren die Utility direkt (keine Express-Abhängigkeit)
import { validateIban, isValidIban } from '../../src/utils/ibanValidator.js';
import {
  validateCreditor,
  validateDebtor,
  validateSepaOptions,
  generateSepaXml,
} from '../../src/utils/sepaExport.js';
import type { SepaExportOptions } from '../../src/utils/sepaExport.js';

// ── Gültige IBANs ─────────────────────────────────────────────────────────────

describe('Gültige IBANs', () => {
  test('AT61 1904 3002 3457 3201 (korrekte Prüfziffer)', () => {
    const r = validateIban('AT611904300234573201');
    assert.equal(r.valid, true, r.error);
  });

  test('AT61 mit Leerzeichen → ebenfalls gültig', () => {
    assert.equal(validateIban('AT61 1904 3002 3457 3201').valid, true);
  });

  test('DE89 3704 0044 0532 0130 00', () => {
    assert.equal(validateIban('DE89370400440532013000').valid, true);
  });

  test('CH93 0076 2011 6238 5295 7', () => {
    assert.equal(validateIban('CH9300762011623852957').valid, true);
  });

  test('Kleinschreibung wird akzeptiert', () => {
    assert.equal(validateIban('at611904300234573201').valid, true);
  });
});

// ── Ungültige IBANs ───────────────────────────────────────────────────────────

describe('Ungültige IBANs', () => {
  test('AT60 — falsche Prüfziffer (sollte AT61 sein)', () => {
    const r = validateIban('AT601904300234573201');
    assert.equal(r.valid, false);
    assert.match(r.error ?? '', /Prüfziffer/);
  });

  test('AT61 mit falscher Länge (19 statt 20 Zeichen)', () => {
    const r = validateIban('AT6119043002345732');
    assert.equal(r.valid, false);
    assert.match(r.error ?? '', /20 Zeichen/);
  });

  test('Leerstring → invalid', () => {
    assert.equal(validateIban('').valid, false);
  });

  test('Nur Buchstaben → invalid', () => {
    assert.equal(validateIban('ABCDEF').valid, false);
  });

  test('Numerisch → invalid', () => {
    assert.equal(validateIban('12345678').valid, false);
  });

  test('AT12345 (zu kurz) → invalid', () => {
    assert.equal(validateIban('AT12345').valid, false);
  });

  test('DE8937040044053201300 (21 statt 22 Zeichen) → invalid', () => {
    const r = validateIban('DE8937040044053201300');
    assert.equal(r.valid, false);
    assert.match(r.error ?? '', /22 Zeichen/);
  });

  test('CH93 mit falscher Prüfziffer', () => {
    assert.equal(validateIban('CH1200762011623852957').valid, false);
  });
});

// ── isValidIban Kurzform ──────────────────────────────────────────────────────

describe('isValidIban Kurzform', () => {
  test('AT61... → true', () => assert.equal(isValidIban('AT611904300234573201'), true));
  test('AT60... → false', () => assert.equal(isValidIban('AT601904300234573201'), false));
  test('"" → false', () => assert.equal(isValidIban(''), false));
});

// ── Grenzwert-Tests ───────────────────────────────────────────────────────────

describe('Grenzwertfälle', () => {
  test('Nur Leerzeichen → invalid', () => {
    assert.equal(validateIban('   ').valid, false);
  });

  test('IBAN mit Sonderzeichen → invalid', () => {
    assert.equal(validateIban('AT61-1904-3002-3457-3201').valid, false);
  });

  test('null-artige Eingabe (undefined cast) → invalid', () => {
    assert.equal(validateIban(undefined as any).valid, false);
  });
});

// ── SEPA validateCreditor ─────────────────────────────────────────────────────

describe('SEPA validateCreditor — Mod-97-Prüfung', () => {
  test('Gültiger Gläubiger → keine Fehler', () => {
    const errors = validateCreditor({
      name: 'Hausverwaltung GmbH',
      iban: 'AT611904300234573201',
      bic: 'OPSKATWW',
      creditorId: 'AT98ZZZ01234567890',
    });
    assert.deepEqual(errors, []);
  });

  test('Gläubiger mit falscher IBAN → Fehlermeldung enthält Prüfziffer', () => {
    const errors = validateCreditor({
      name: 'Test GmbH',
      iban: 'AT601904300234573201',
      bic: 'OPSKATWW',
      creditorId: 'AT98ZZZ01234567890',
    });
    assert.equal(errors.length > 0, true);
    assert.ok(errors.some(e => /Prüfziffer|ungültig/i.test(e)), `Errors: ${errors.join(', ')}`);
  });
});

// ── SEPA validateDebtor ───────────────────────────────────────────────────────

describe('SEPA validateDebtor — Mod-97-Prüfung', () => {
  test('Gültiger Schuldner → keine Fehler', () => {
    const errors = validateDebtor({
      name: 'Max Mustermann',
      iban: 'AT611904300234573201',
      bic: 'OPSKATWW',
      mandateId: 'MANDAT-001',
      mandateDate: '2024-01-01',
      amount: 500,
      remittanceInfo: 'Miete Jänner 2026',
    });
    assert.deepEqual(errors, []);
  });

  test('Schuldner mit falscher IBAN → Fehlermeldung', () => {
    const errors = validateDebtor({
      name: 'Max Mustermann',
      iban: 'AT601904300234573201',
      bic: 'OPSKATWW',
      mandateId: 'MANDAT-001',
      mandateDate: '2024-01-01',
      amount: 500,
      remittanceInfo: 'Miete',
    });
    assert.ok(errors.some(e => /Prüfziffer|ungültig/i.test(e)), `Errors: ${errors.join(', ')}`);
  });
});

// ── generateSepaXml bricht bei ungültiger IBAN ab ────────────────────────────

describe('generateSepaXml — Abbruch bei ungültiger IBAN', () => {
  const baseOptions: SepaExportOptions = {
    creditor: {
      name: 'Hausverwaltung GmbH',
      iban: 'AT611904300234573201',
      bic: 'OPSKATWW',
      creditorId: 'AT98ZZZ01234567890',
    },
    debtors: [
      {
        id: 'debtor-1',
        name: 'Anna Müller',
        iban: 'AT611904300234573201',
        bic: 'OPSKATWW',
        mandateId: 'MANDAT-001',
        mandateDate: '2024-01-01',
        amount: 750,
        remittanceInfo: 'Miete 01/2026',
      },
    ],
    collectionDate: '2026-01-31',
    batchBooking: true,
  };

  test('Gültige Daten → XML wird generiert', () => {
    const xml = generateSepaXml(baseOptions);
    assert.ok(xml.includes('<Document'), 'XML sollte <Document> enthalten');
    assert.ok(xml.includes('pain.008.003.02'), 'XML sollte pain.008.003.02 enthalten');
  });

  test('Schuldner mit falscher Prüfziffer → Fehler, kein XML', () => {
    const badOptions: SepaExportOptions = {
      ...baseOptions,
      debtors: [
        {
          ...baseOptions.debtors[0],
          iban: 'AT601904300234573201', // falsche Prüfziffer
        },
      ],
    };
    assert.throws(
      () => generateSepaXml(badOptions),
      (err: Error) => {
        assert.ok(err.message.includes('SEPA-Export abgebrochen') || err.message.includes('ungültig'));
        return true;
      }
    );
  });

  test('Gläubiger mit falscher IBAN → Fehler, kein XML', () => {
    const badOptions: SepaExportOptions = {
      ...baseOptions,
      creditor: {
        ...baseOptions.creditor,
        iban: 'AT601904300234573201',
      },
    };
    assert.throws(
      () => generateSepaXml(badOptions),
      (err: Error) => {
        assert.ok(err.message.includes('SEPA-Export abgebrochen') || err.message.includes('ungültig'));
        return true;
      }
    );
  });
});
