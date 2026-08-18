/**
 * Task #183: Testläufe hinterlassen keine Datenreste mehr.
 *
 * Beweist:
 * 1. cleanupProfileById() löscht ein Profil inkl. audit_logs FK (ON DELETE NO ACTION)
 *    → Enge Scope, sicher für parallele Testläufe (kein globaler Sweep)
 * 2. Idempotenz — zweimaliger Aufruf ohne Fehler
 * 3. Sicherheitssperre — Ausführung in Produktionsumgebung wird verweigert
 * 4. Sicherheitssperre — Ausführung ohne Opt-in (ALLOW_TEST_DATA_CLEANUP) verweigert
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { rootDb } from '../../server/db';
import {
  cleanupProfileById,
  cleanupTestData,
  UnsafeEnvironmentError,
} from '../../scripts/cleanup-test-data';

// Eindeutige IDs für diesen Testlauf (werden nach dem Test bereinigt).
const ORG_ID     = randomUUID();
const PROF_ID    = randomUUID();
// E-Mail-Adresse endet auf @test.at → wird von globalem Sweep erfasst,
// aber im Test selbst wird AUSSCHLIESSLICH cleanupProfileById(PROF_ID) verwendet,
// sodass kein globaler Sweep mit parallelen Tests konkurriert.
const TEST_EMAIL = `cleanup-test-${PROF_ID.slice(0, 8)}@test.at`;

before(async () => {
  // Explizites Opt-in für den gesamten Testkontext
  process.env.ALLOW_TEST_DATA_CLEANUP = '1';

  // Fixtures anlegen
  await rootDb.execute(sql`
    INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Cleanup-Test-Org')
    ON CONFLICT (id) DO NOTHING
  `);
  await rootDb.execute(sql`
    INSERT INTO profiles (id, email, full_name, organization_id)
    VALUES (${PROF_ID}::uuid, ${TEST_EMAIL}, 'Cleanup Test User', ${ORG_ID}::uuid)
    ON CONFLICT (id) DO NOTHING
  `);
  // Audit-Log → das ist die FK die direkte DELETE FROM profiles blockiert
  await rootDb.execute(sql`
    INSERT INTO audit_logs (user_id, table_name, record_id, action)
    VALUES (${PROF_ID}::uuid, 'profiles', ${PROF_ID}, 'create')
  `);
});

after(async () => {
  // Defensive Bereinigung falls ein Test selbst scheitert
  await rootDb.execute(sql`DELETE FROM audit_logs   WHERE user_id = ${PROF_ID}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM profiles      WHERE id      = ${PROF_ID}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM organizations WHERE id      = ${ORG_ID}::uuid`).catch(() => {});
});

describe('cleanupProfileById()', () => {

  it('löscht ein Test-Profil inkl. audit_logs-Abhängigkeit (FK ON DELETE NO ACTION)', async () => {
    // Vorbedingung
    const profBefore = await rootDb.execute(sql`
      SELECT COUNT(*)::int AS n FROM profiles WHERE id = ${PROF_ID}::uuid
    `);
    assert.equal(Number((profBefore.rows[0] as Record<string, unknown>).n), 1,
      'Test-Profil muss vor dem Cleanup vorhanden sein');

    const auditBefore = await rootDb.execute(sql`
      SELECT COUNT(*)::int AS n FROM audit_logs WHERE user_id = ${PROF_ID}::uuid
    `);
    assert.ok(Number((auditBefore.rows[0] as Record<string, unknown>).n) >= 1,
      'Audit-Eintrag muss vor dem Cleanup vorhanden sein');

    // Enger Scope — nur dieses Profil, kein globaler Sweep
    const result = await cleanupProfileById(PROF_ID, { verbose: false });

    // Profil muss weg sein
    const profAfter = await rootDb.execute(sql`
      SELECT COUNT(*)::int AS n FROM profiles WHERE id = ${PROF_ID}::uuid
    `);
    assert.equal(Number((profAfter.rows[0] as Record<string, unknown>).n), 0,
      'Test-Profil muss nach dem Cleanup gelöscht sein');

    // audit_logs müssen ebenfalls weg sein
    const auditAfter = await rootDb.execute(sql`
      SELECT COUNT(*)::int AS n FROM audit_logs WHERE user_id = ${PROF_ID}::uuid
    `);
    assert.equal(Number((auditAfter.rows[0] as Record<string, unknown>).n), 0,
      'audit_logs des Test-Profils müssen mitgelöscht worden sein (FK ON DELETE NO ACTION)');

    assert.ok(result.dependentsDeleted >= 1,
      `dependentsDeleted muss >= 1 (min. audit_logs), war: ${result.dependentsDeleted}`);
  });

  it('ist idempotent — zweimaliger Aufruf ohne Fehler (Profil bereits weg)', async () => {
    // Profil nach erstem Test schon gelöscht; zweiter Aufruf muss lautlos durchlaufen
    const result = await cleanupProfileById(PROF_ID, { verbose: false });
    assert.equal(result.dependentsDeleted, 0,
      'keine abhängigen Zeilen wenn Profil schon weg ist');
  });

});

describe('Sicherheitssperren (cleanupTestData + cleanupProfileById)', () => {

  it('verweigert Ausführung wenn REPLIT_DEPLOYMENT gesetzt ist (Produktions-Guard)', async () => {
    const saved = process.env.REPLIT_DEPLOYMENT;
    process.env.REPLIT_DEPLOYMENT = '1';
    try {
      await assert.rejects(
        () => cleanupTestData({ verbose: false }),
        (err: unknown) => {
          assert.ok(err instanceof UnsafeEnvironmentError, 'Muss UnsafeEnvironmentError sein');
          assert.ok((err as Error).message.includes('REPLIT_DEPLOYMENT'),
            'Fehlermeldung muss REPLIT_DEPLOYMENT erwähnen');
          return true;
        },
      );
      // Auch cleanupProfileById muss verweigern
      await assert.rejects(
        () => cleanupProfileById(PROF_ID, { verbose: false }),
        UnsafeEnvironmentError,
      );
    } finally {
      if (saved === undefined) delete process.env.REPLIT_DEPLOYMENT;
      else process.env.REPLIT_DEPLOYMENT = saved;
    }
  });

  it('verweigert Ausführung ohne Opt-in (ALLOW_TEST_DATA_CLEANUP != "1")', async () => {
    const savedDeployment = process.env.REPLIT_DEPLOYMENT;
    const savedOptIn      = process.env.ALLOW_TEST_DATA_CLEANUP;

    delete process.env.REPLIT_DEPLOYMENT;
    delete process.env.ALLOW_TEST_DATA_CLEANUP;

    try {
      await assert.rejects(
        () => cleanupTestData({ verbose: false }),
        (err: unknown) => {
          assert.ok(err instanceof UnsafeEnvironmentError);
          assert.ok((err as Error).message.includes('ALLOW_TEST_DATA_CLEANUP'));
          return true;
        },
      );
      await assert.rejects(
        () => cleanupProfileById(PROF_ID, { verbose: false }),
        UnsafeEnvironmentError,
      );
    } finally {
      if (savedDeployment !== undefined) process.env.REPLIT_DEPLOYMENT     = savedDeployment;
      if (savedOptIn      !== undefined) process.env.ALLOW_TEST_DATA_CLEANUP = savedOptIn;
      else process.env.ALLOW_TEST_DATA_CLEANUP = '1'; // Opt-in für restliche Tests wiederherstellen
    }
  });

});
