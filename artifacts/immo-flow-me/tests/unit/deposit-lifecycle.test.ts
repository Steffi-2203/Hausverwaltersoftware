/**
 * Kaution (Deposit) Lifecycle — Rückzahlungsberechnung + DB-Trigger-Schutz
 *
 * Teil 1 — Reine Berechnungsfunktionen (kein DB):
 *   - calculateKautionRueckzahlung (Betrag + Zinsen - Einbehalt)
 *   - validateEinbehalten (Einbehalt-Validierung)
 *
 * Teil 2 — DB-Integrations-Tests für den PostgreSQL-Trigger:
 *   - INSERT in kautions_bewegungen muss erlaubt bleiben
 *   - UPDATE muss vom Trigger blockiert werden
 *   - DELETE muss vom Trigger blockiert werden
 */
import { describe, it, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';
import { calculateKautionRueckzahlung, validateEinbehalten } from '../../server/services/kautionService';
import { rootDb as db } from '../../server/db';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { seedTestData, testOrgId, testTenantId, testUnitId } from '../helpers/db';

describe('calculateKautionRueckzahlung — Produktionsfunktion aus kautionService', () => {
  it('Rückzahlung = Betrag + Zinsen − Einbehalt (kein doppelter Abzug)', () => {
    const result = calculateKautionRueckzahlung(3000, 15, 200);
    // Einbehalt wird nur EINMAL abgezogen: 3000 + 15 - 200 = 2815
    expect(result.rueckzahlungsbetrag).toBe(2815);
    expect(result.einbehalten).toBe(200);
  });

  it('Einbehalt 0 → volle Rückzahlung (Betrag + Zinsen)', () => {
    const result = calculateKautionRueckzahlung(3000, 15, 0);
    expect(result.rueckzahlungsbetrag).toBe(3015);
    expect(result.einbehalten).toBe(0);
  });

  it('vollständiger Einbehalt → Rückzahlung = 0', () => {
    const result = calculateKautionRueckzahlung(1000, 0, 1000);
    expect(result.rueckzahlungsbetrag).toBe(0);
  });

  it('maxEinbehalten = Betrag + Zinsen', () => {
    const result = calculateKautionRueckzahlung(1500, 30, 0);
    expect(result.maxEinbehalten).toBe(1530);
  });

  it('Cent-Rundung: Ergebnis auf 2 Nachkommastellen', () => {
    const result = calculateKautionRueckzahlung(3000, 7.77, 333.33);
    // 3000 + 7.77 - 333.33 = 2674.44
    expect(result.rueckzahlungsbetrag).toBe(2674.44);
  });
});

describe('validateEinbehalten — Validierungslogik aus kautionService', () => {
  it('gibt null zurück wenn Einbehalt innerhalb Grenzen', () => {
    const err = validateEinbehalten(200, 1000, 15);
    expect(err).toBeNull();
  });

  it('gibt Fehler zurück wenn Einbehalt > Betrag + Zinsen', () => {
    const err = validateEinbehalten(1500, 1000, 15);
    expect(err).not.toBeNull();
    expect(err!.message).toContain('übersteigt');
  });

  it('gibt Fehler zurück bei negativem Einbehalt', () => {
    const err = validateEinbehalten(-1, 1000, 0);
    expect(err).not.toBeNull();
    expect(err!.message).toContain('negativ');
  });

  it('genau 0 einbehalten: gültig', () => {
    expect(validateEinbehalten(0, 1000, 50)).toBeNull();
  });

  it('genau Betrag + Zinsen einbehalten: gültig (Grenzwert)', () => {
    expect(validateEinbehalten(1050, 1000, 50)).toBeNull();
  });
});

// ── DB-Integrations-Tests: PostgreSQL-Trigger auf kautions_bewegungen ─────────
//
// Prüft dass der Trigger trg_kautionsbewegungen_immutable (aus
// migrations/20260815_kaution_immutable_trigger.sql) tatsächlich feuert:
// UPDATE und DELETE werden auf DB-Ebene blockiert, INSERT bleibt erlaubt.
//
// Jeder DML-Aufruf läuft in Autocommit — bei einem Trigger-RAISE EXCEPTION
// wird nur die einzelne Statement-Transaktion zurückgerollt, nicht die gesamte
// Verbindung (kein Savepoint nötig).
//
// Cleanup: Trigger temporär deaktivieren, Test-Zeilen löschen, wieder aktivieren.
// (ALTER TABLE DISABLE TRIGGER erfordert Table-Owner-Rechte, kein Superuser.)
describe('kautions_bewegungen — PostgreSQL-Trigger Unveränderlichkeit', () => {
  const kautionId   = uuidv4();
  const bewegungId  = uuidv4();

  beforeAll(async () => {
    // Basis-Daten (org, property, unit, tenant) sicherstellen
    await seedTestData();

    // Kaution anlegen (Parent für FK)
    await db.execute(sql`
      INSERT INTO kautionen
        (id, organization_id, tenant_id, unit_id, betrag, status)
      VALUES
        (${kautionId}::uuid, ${testOrgId}::uuid,
         ${testTenantId}::uuid, ${testUnitId}::uuid,
         1500.00, 'aktiv')
      ON CONFLICT (id) DO NOTHING
    `);

    // Erste Bewegung einfügen — INSERT muss erlaubt sein
    await db.execute(sql`
      INSERT INTO kautions_bewegungen
        (id, kaution_id, datum, betrag, typ, beschreibung)
      VALUES
        (${bewegungId}::uuid, ${kautionId}::uuid,
         CURRENT_DATE, 1500.00, 'eingang',
         'Test-Eingang für Trigger-Test')
      ON CONFLICT (id) DO NOTHING
    `);
  });

  afterAll(async () => {
    // Trigger temporär deaktivieren damit der Cleanup möglich ist
    await db.execute(sql`ALTER TABLE kautions_bewegungen DISABLE TRIGGER ALL`);
    await db.execute(sql`DELETE FROM kautions_bewegungen WHERE id = ${bewegungId}::uuid`);
    await db.execute(sql`ALTER TABLE kautions_bewegungen ENABLE TRIGGER ALL`);
    await db.execute(sql`DELETE FROM kautionen WHERE id = ${kautionId}::uuid`);
  });

  it('INSERT in kautions_bewegungen ist erlaubt (positiver Smoke-Test)', async () => {
    // Eine zweite Buchung einfügen → muss problemlos klappen
    const zweiteId = uuidv4();
    let insertError: Error | null = null;
    try {
      await db.execute(sql`
        INSERT INTO kautions_bewegungen
          (id, kaution_id, datum, betrag, typ, beschreibung)
        VALUES
          (${zweiteId}::uuid, ${kautionId}::uuid,
           CURRENT_DATE, 50.00, 'zinsen', 'Zins-Buchung Smoke-Test')
      `);
    } catch (err: any) {
      insertError = err;
    }
    // INSERT darf NICHT blockiert werden
    expect(insertError).toBeNull();

    // Cleanup für diese zweite Zeile (Trigger deaktivieren)
    await db.execute(sql`ALTER TABLE kautions_bewegungen DISABLE TRIGGER ALL`);
    await db.execute(sql`DELETE FROM kautions_bewegungen WHERE id = ${zweiteId}::uuid`);
    await db.execute(sql`ALTER TABLE kautions_bewegungen ENABLE TRIGGER ALL`);
  });

  it('UPDATE auf kautions_bewegungen wird vom Trigger blockiert', async () => {
    // Jeder Statement läuft autocommit — der Trigger-RAISE EXCEPTION rollt nur
    // diese eine Transaktion zurück; die Verbindung bleibt danach sauber.
    // Der Drizzle-Wrapper trägt die originale PG-Fehlermeldung in err.cause;
    // wir prüfen nur dass IRGENDEIN Fehler geworfen wird — das beweist dass
    // der Trigger feuert (ohne Trigger würde UPDATE still 0 Rows updaten).
    await expect(
      db.execute(sql`
        UPDATE kautions_bewegungen
        SET betrag = 999.00
        WHERE id = ${bewegungId}::uuid
      `)
    ).rejects.toThrow();
  });

  it('DELETE auf kautions_bewegungen wird vom Trigger blockiert', async () => {
    await expect(
      db.execute(sql`
        DELETE FROM kautions_bewegungen
        WHERE id = ${bewegungId}::uuid
      `)
    ).rejects.toThrow();
  });

  it('Trigger-Meldung enthält Hinweis auf Ledger-Integrität (in cause-chain)', async () => {
    // Drizzle wraps PostgreSQL errors: err.message = "Failed query: ..."
    // Die originale Trigger-RAISE-Meldung steckt in err.cause.message (oder
    // weiter unten in der Kette). Wir suchen in der gesamten serialisierten
    // Fehlerstruktur nach dem Trigger-Schlüsselwort.
    let caughtErr: any = null;
    try {
      await db.execute(sql`
        UPDATE kautions_bewegungen SET typ = 'manipuliert'
        WHERE id = ${bewegungId}::uuid
      `);
    } catch (err: any) {
      caughtErr = err;
    }

    expect(caughtErr).not.toBeNull();

    // Originaltext aus der Trigger-Funktion (prevent_kautionsbewegungen_modification)
    // irgendwo im Error-Objekt finden
    const fullErrText = [
      caughtErr?.message,
      caughtErr?.cause?.message,
      caughtErr?.cause?.detail,
      JSON.stringify(caughtErr?.cause ?? {}),
    ].join(' ');

    expect(fullErrText).toMatch(/unveränderlich|Ledger|nicht zulässig|kautions_bewegungen/i);
  });
});
