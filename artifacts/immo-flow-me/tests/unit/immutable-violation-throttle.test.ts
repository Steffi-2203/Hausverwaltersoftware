/**
 * Unit-Tests für die shouldNotify-Throttle-Logik (Task #179).
 *
 * Prüft: max. 1 Benachrichtigung pro Tabelle pro Stunde.
 * Keine DB-Verbindung erforderlich — reine Logik-Tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldNotify, VIOLATION_THROTTLE_MS } from '../../server/lib/immutableViolationAudit';

// Eindeutige Tabellennamen pro Testfall, damit sich Tests nicht gegenseitig
// beeinflussen (shouldNotify hält globalen State im Modul).
const T1 = '__throttle_test_payments__';
const T2 = '__throttle_test_invoices__';
const T3 = '__throttle_test_multi_1__';
const T4 = '__throttle_test_multi_2__';

describe('shouldNotify — Benachrichtigungs-Throttle (max. 1×/Std. pro Tabelle)', () => {

  it('erste Verletzung: sendet immer (kein Eintrag in der Map)', () => {
    const t0 = 1_000_000;
    assert.equal(shouldNotify(T1, t0), true, 'erste Verletzung muss Benachrichtigung auslösen');
  });

  it('zweite Verletzung kurz danach: unterdrückt (innerhalb Throttle-Fenster)', () => {
    const t0 = 2_000_000;
    shouldNotify(T2, t0);                    // erste — registriert t0
    assert.equal(shouldNotify(T2, t0 + 1),  false, 'sofortige Wiederholung muss unterdrückt werden');
    assert.equal(shouldNotify(T2, t0 + VIOLATION_THROTTLE_MS - 1), false, 'knapp vor Ablauf noch unterdrückt');
  });

  it('nach Ablauf der Throttle-Zeit: sendet wieder', () => {
    const t0 = 3_000_000;
    shouldNotify(T1.replace('payments', 'after_reset'), t0);   // anderer Name damit T1 nicht kollidiert
    const tAfter = t0 + VIOLATION_THROTTLE_MS;
    assert.equal(shouldNotify(T1.replace('payments', 'after_reset'), tAfter), true, 'nach 1 h muss erneut benachrichtigt werden');
  });

  it('genau am Throttle-Grenzwert: sendet (>=, nicht >)', () => {
    const t0 = 4_000_000;
    const tExact = t0 + VIOLATION_THROTTLE_MS;
    const tbl = '__throttle_boundary__';
    shouldNotify(tbl, t0);
    assert.equal(shouldNotify(tbl, tExact), true, 'genau beim Ablauf (>=) muss gesendet werden');
  });

  it('verschiedene Tabellen haben unabhängige Throttle-Fenster', () => {
    const t0 = 5_000_000;
    shouldNotify(T3, t0);  // T3 wird gesperrt
    // T4 wurde noch nicht gemeldet → darf senden
    assert.equal(shouldNotify(T4, t0 + 1), true, 'andere Tabelle muss unabhängig throttlen');
    // T3 immer noch gesperrt
    assert.equal(shouldNotify(T3, t0 + 1), false, 'ursprüngliche Tabelle bleibt gesperrt');
  });

  it('VIOLATION_THROTTLE_MS entspricht 1 Stunde (3 600 000 ms)', () => {
    assert.equal(VIOLATION_THROTTLE_MS, 3_600_000);
  });

});
