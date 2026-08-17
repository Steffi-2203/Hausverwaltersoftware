/**
 * Selbsttests für den expect/vi-Kompatibilitäts-Helper (tests/helpers/expect.ts).
 *
 * Prüft insbesondere die Fälle, die im Code-Review als Lücken identifiziert wurden:
 *  - Error-Klassen-Matching bei toThrow / rejects.toThrow
 *  - Negierte Matcher (not.toEqual, not.toHaveProperty) dürfen NICHT stillschweigend durchgehen
 *
 * Ausführen:
 *   node --import=./node_modules/tsx/dist/esm/index.cjs --test tests/unit/expect-helper.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { expect } from '../helpers/expect';

class CustomError extends Error {
  constructor(msg = 'custom boom') { super(msg); this.name = 'CustomError'; }
}
class OtherError extends Error {}

function fails(fn: () => unknown | Promise<unknown>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(
      () => { throw new Error('EXPECTED_ASSERTION_FAILURE'); },
      (e) => {
        if (e instanceof Error && e.message === 'EXPECTED_ASSERTION_FAILURE') {
          assert.fail('Matcher hätte fehlschlagen müssen, ist aber durchgegangen');
        }
      },
    );
}

describe('expect-Helper — Error-Klassen-Matching', () => {
  test('toThrow(ErrorClass) besteht bei passender Klasse', () => {
    expect(() => { throw new CustomError(); }).toThrow(CustomError);
  });

  test('toThrow(ErrorClass) schlägt bei falscher Klasse fehl', async () => {
    await fails(() => expect(() => { throw new OtherError('x'); }).toThrow(CustomError));
  });

  test('toThrow(ErrorClass) matcht auch Subklassen (instanceof)', () => {
    expect(() => { throw new CustomError(); }).toThrow(Error);
  });

  test('rejects.toThrow(ErrorClass) besteht bei passender Klasse', async () => {
    await expect(Promise.reject(new CustomError())).rejects.toThrow(CustomError);
  });

  test('rejects.toThrow(ErrorClass) schlägt bei falscher Klasse fehl', async () => {
    await fails(() => expect(Promise.reject(new OtherError('y'))).rejects.toThrow(CustomError));
  });

  test('rejects.toThrow(String/RegExp) prüft weiterhin die Message', async () => {
    await expect(Promise.reject(new CustomError('custom boom'))).rejects.toThrow('boom');
    await expect(Promise.reject(new CustomError('custom boom'))).rejects.toThrow(/^custom/);
    await fails(() => expect(Promise.reject(new CustomError('custom boom'))).rejects.toThrow('anders'));
  });

  test('toThrow(Error-Instanz) vergleicht Klasse + Message', async () => {
    expect(() => { throw new CustomError('genau'); }).toThrow(new CustomError('genau'));
    await fails(() => expect(() => { throw new CustomError('genau'); }).toThrow(new CustomError('anders')));
  });

  test('rejects.toThrow schlägt fehl wenn Promise auflöst', async () => {
    await fails(() => expect(Promise.resolve(42)).rejects.toThrow(CustomError));
  });
});

describe('expect-Helper — negierte Matcher', () => {
  test('not.toEqual schlägt fehl bei tatsächlich gleichen Werten', async () => {
    await fails(() => expect({ a: 1 }).not.toEqual({ a: 1 }));
  });

  test('not.toEqual besteht bei ungleichen Werten', () => {
    expect({ a: 1 }).not.toEqual({ a: 2 });
  });

  test('not.toHaveProperty(key, value) schlägt fehl wenn Property gleich ist', async () => {
    await fails(() => expect({ a: { b: 3 } }).not.toHaveProperty('a.b', 3));
  });

  test('not.toHaveProperty(key, value) besteht bei anderem Wert', () => {
    expect({ a: { b: 3 } }).not.toHaveProperty('a.b', 4);
  });

  test('not.toBe / not.toContain verhalten sich korrekt', async () => {
    expect(1).not.toBe(2);
    await fails(() => expect(1).not.toBe(1));
    expect([1, 2]).not.toContain(3);
    await fails(() => expect([1, 2]).not.toContain(2));
  });
});

describe('expect-Helper — positive Basisfälle bleiben intakt', () => {
  test('toEqual / toHaveProperty / toThrow(String)', async () => {
    expect({ x: [1, 2] }).toEqual({ x: [1, 2] });
    await fails(() => expect({ x: 1 }).toEqual({ x: 2 }));
    expect({ a: { b: 'c' } }).toHaveProperty('a.b', 'c');
    await fails(() => expect({ a: {} }).toHaveProperty('a.b'));
    expect(() => { throw new Error('kaputt'); }).toThrow('kaputt');
  });
});
