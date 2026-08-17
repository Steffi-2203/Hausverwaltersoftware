/**
 * VPI Advisory Lock — Concurrent-Safety Protocol (Task #74)
 *
 * Zwei Test-Gruppen:
 *
 * 1. Advisory Lock Protocol — prueft direkt das PG-Lock-Verhalten:
 *    SHARED/EXCLUSIVE gegenseitig exklusiv, mehrere SHAREDs koennen koexistieren.
 *
 * 2. Route-Ebene (Interleaving) — beweist dass DELETE nicht erfolgreich sein
 *    kann wenn apply seinen VPI-Referenzwert bereits committet hat:
 *    - apply haelt shared Lock und schreibt vpi_base
 *    - DELETE blockiert auf exclusive Lock bis apply committet
 *    - Nach apply-Commit findet DELETE den Referenzwert → 409
 *
 * Alle Transaktionen laufen auf separaten DB-Verbindungen aus dem Pool.
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { rootDb as db } from '../../server/db';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import vpiRouter, { VPI_ADVISORY_LOCK_ID } from '../../server/routes/vpiRoutes';
import { addOrgContext } from '../helpers/withOrgContext';
import { acquireVpiTestLock, releaseVpiTestLock } from '../helpers/vpiTestLock';

/** Haelt eine Transaktion offen bis releaseFn() aufgerufen wird */
function openTx(lockSql: string): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const promise = db.transaction(async (tx) => {
    await tx.execute(sql.raw(lockSql));
    await gate;
  });
  return { promise, release };
}

/** Gibt dem Hintergrund-Transaction genuegend Zeit um zu starten und den Lock zu erwerben */
const settle = () => new Promise<void>(r => setTimeout(r, 200));

// ── Express-Testapp (wie andere Router-Tests) ─────────────────────────────────
const adminId      = uuidv4();
const vpiTestOrgId = uuidv4(); // Org-Kontext für db-Proxy; VPI-Daten sind org-unabhängig

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: adminId, organizationId: vpiTestOrgId };
    next();
  });
  addOrgContext(app, vpiTestOrgId);
  app.use(vpiRouter);
  return app;
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────
const IL_BASE_YEAR = 2094; // isoliertes Jahr fuer Interleaving-Tests

async function insertVpi(year: number, month: number, value: number) {
  const r = await db.execute(sql`
    INSERT INTO vpi_values (year, month, value, source)
    VALUES (${year}, ${month}, ${value}, 'test')
    ON CONFLICT (year, month) DO UPDATE SET value = EXCLUDED.value
    RETURNING id, value::float AS value
  `);
  return r.rows[0] as { id: string; value: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Interleaving-Fixture: minimales Org/Property/Unit/Tenant-Setup
// ─────────────────────────────────────────────────────────────────────────────
const ilOrgId   = uuidv4();
const ilPropId  = uuidv4();
const ilUnitId  = uuidv4();
const ilTenId   = uuidv4();
const ilUserId  = adminId; // gleicher User wie App-Session

beforeAll(async () => {
  await acquireVpiTestLock();
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${vpiTestOrgId}::uuid, 'VPI-Test-Org') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${ilOrgId}::uuid, 'IL-Org') ON CONFLICT DO NOTHING`);
  // E-Mail pro Lauf eindeutig: Fixe E-Mails + zufällige IDs führen bei
  // abgebrochenen Läufen zu ON-CONFLICT-Skips und user_roles-FK-Fehlern.
  await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${ilUserId}::uuid, ${'il-admin-' + ilUserId.slice(0, 8) + '@test.at'}, ${ilOrgId}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${ilUserId}::uuid, 'admin') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${ilUserId}::uuid, 'admin') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${ilPropId}::uuid, ${ilOrgId}::uuid, 'IL-Prop', 'Str 1', 'Wien', '1010', 'mietverwaltung')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status)
    VALUES (${ilUnitId}::uuid, ${ilPropId}::uuid, 'T1', 'wohnung', 'aktiv')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name)
    VALUES (${ilTenId}::uuid, ${ilUnitId}::uuid, 'IL', 'Tenant')
    ON CONFLICT DO NOTHING
  `);
});

afterAll(async () => {
  try {
    await db.execute(sql`DELETE FROM vpi_values WHERE year = ${IL_BASE_YEAR}`);
    await db.execute(sql`DELETE FROM tenants     WHERE id = ${ilTenId}::uuid`);
    await db.execute(sql`DELETE FROM units        WHERE id = ${ilUnitId}::uuid`);
    await db.execute(sql`DELETE FROM properties   WHERE id = ${ilPropId}::uuid`);
    await db.execute(sql`DELETE FROM user_roles   WHERE user_id = ${ilUserId}::uuid`);
    await db.execute(sql`DELETE FROM profiles     WHERE id = ${ilUserId}::uuid`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${ilOrgId}::uuid`);
  } catch { /* non-fatal */ }
  await releaseVpiTestLock();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('VPI Advisory Lock — Exclusive vs. Shared Protokoll', () => {

  test('SHARED Lock blockiert nicht-blockierendes EXCLUSIVE Try auf anderer Verbindung', async () => {
    const { promise: txA, release } = openTx(
      `SELECT pg_advisory_xact_lock_shared(${VPI_ADVISORY_LOCK_ID})`,
    );
    await settle();

    // Exklusiver Try muss false liefern waehrend txA den shared Lock haelt
    const excl = await db.transaction(async (tx) =>
      tx.execute(sql`SELECT pg_try_advisory_xact_lock(${VPI_ADVISORY_LOCK_ID}) AS acquired`),
    );
    expect((excl.rows[0] as any).acquired).toBe(false);

    // Nach Freigabe muss der exklusive Try erfolgreich sein
    release();
    await txA;

    const exclAfter = await db.transaction(async (tx) =>
      tx.execute(sql`SELECT pg_try_advisory_xact_lock(${VPI_ADVISORY_LOCK_ID}) AS acquired`),
    );
    expect((exclAfter.rows[0] as any).acquired).toBe(true);
  });

  test('EXCLUSIVE Lock blockiert nicht-blockierendes SHARED Try auf anderer Verbindung', async () => {
    const { promise: txA, release } = openTx(
      `SELECT pg_advisory_xact_lock(${VPI_ADVISORY_LOCK_ID})`,
    );
    await settle();

    // Shared Try muss false liefern waehrend txA den exklusiven Lock haelt
    const shared = await db.transaction(async (tx) =>
      tx.execute(sql`SELECT pg_try_advisory_xact_lock_shared(${VPI_ADVISORY_LOCK_ID}) AS acquired`),
    );
    expect((shared.rows[0] as any).acquired).toBe(false);

    // Nach Freigabe muss der shared Try erfolgreich sein
    release();
    await txA;

    const sharedAfter = await db.transaction(async (tx) =>
      tx.execute(sql`SELECT pg_try_advisory_xact_lock_shared(${VPI_ADVISORY_LOCK_ID}) AS acquired`),
    );
    expect((sharedAfter.rows[0] as any).acquired).toBe(true);
  });

  test('Zwei SHARED Locks koeennen gleichzeitig gehalten werden (apply/apply)', async () => {
    const { promise: tx1, release: r1 } = openTx(
      `SELECT pg_advisory_xact_lock_shared(${VPI_ADVISORY_LOCK_ID})`,
    );
    const { promise: tx2, release: r2 } = openTx(
      `SELECT pg_advisory_xact_lock_shared(${VPI_ADVISORY_LOCK_ID})`,
    );
    await settle();

    // Ein dritter Shared Try muss noch erfolgreich sein (shared/shared kompatibel)
    const thirdShared = await db.transaction(async (tx) =>
      tx.execute(sql`SELECT pg_try_advisory_xact_lock_shared(${VPI_ADVISORY_LOCK_ID}) AS acquired`),
    );
    expect((thirdShared.rows[0] as any).acquired).toBe(true);

    // Aber Exclusive Try muss scheitern (zwei Shared Locks aktiv)
    const excl = await db.transaction(async (tx) =>
      tx.execute(sql`SELECT pg_try_advisory_xact_lock(${VPI_ADVISORY_LOCK_ID}) AS acquired`),
    );
    expect((excl.rows[0] as any).acquired).toBe(false);

    r1(); r2();
    await Promise.all([tx1, tx2]);
  });

  test('DELETE-Semantik: exklusiver Lock → nach Freigabe aller Shared Locks erreichbar', async () => {
    // Simuliert: zwei apply-Transaktionen laufen gleichzeitig
    const { promise: tx1, release: r1 } = openTx(
      `SELECT pg_advisory_xact_lock_shared(${VPI_ADVISORY_LOCK_ID})`,
    );
    const { promise: tx2, release: r2 } = openTx(
      `SELECT pg_advisory_xact_lock_shared(${VPI_ADVISORY_LOCK_ID})`,
    );
    await settle();

    // DELETE versucht exklusiven Lock → muss scheitern solange apply laeuft
    const deleteBlocked = await db.transaction(async (tx) =>
      tx.execute(sql`SELECT pg_try_advisory_xact_lock(${VPI_ADVISORY_LOCK_ID}) AS acquired`),
    );
    expect((deleteBlocked.rows[0] as any).acquired).toBe(false);

    // Eine der apply-Transaktionen beendet sich
    r1();
    await tx1;
    await settle();

    // Noch immer blockiert (tx2 haelt noch)
    const stillBlocked = await db.transaction(async (tx) =>
      tx.execute(sql`SELECT pg_try_advisory_xact_lock(${VPI_ADVISORY_LOCK_ID}) AS acquired`),
    );
    expect((stillBlocked.rows[0] as any).acquired).toBe(false);

    // Zweite apply-Transaktion beendet sich
    r2();
    await tx2;

    // Jetzt darf DELETE den exklusiven Lock erwerben
    const deleteAllowed = await db.transaction(async (tx) =>
      tx.execute(sql`SELECT pg_try_advisory_xact_lock(${VPI_ADVISORY_LOCK_ID}) AS acquired`),
    );
    expect((deleteAllowed.rows[0] as any).acquired).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Route-Ebene: Interleaving — DELETE blockiert waehrend apply committet
// ─────────────────────────────────────────────────────────────────────────────

describe('Route-Ebene — Interleaving: DELETE kann VPI-Wert nicht entfernen wenn apply committet', () => {
  const app = buildApp();

  test('DELETE blockiert auf exclusive Lock; nach apply-Commit findet es den Referenzwert und liefert 409', async () => {
    // ── Setup ──────────────────────────────────────────────────────────────
    // VPI-Wert anlegen; Tenant hat noch kein vpi_base (apply noch nicht gelaufen)
    const vpiRow = await insertVpi(IL_BASE_YEAR, 1, 54321.11);
    await db.execute(sql`UPDATE tenants SET vpi_base = NULL WHERE id = ${ilTenId}::uuid`);

    // ── Schritt 1: apply-Transaktion startet, haelt shared Lock ────────────
    // Simuliert: apply hat VPI gelesen und berechnet; der Commit steht noch aus.
    let releaseApply!: () => void;
    const applyReady = new Promise<void>(r => { releaseApply = r; });

    const applyTx = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${VPI_ADVISORY_LOCK_ID})`);
      // apply haelt den shared Lock und wartet — simuliert "apply hat VPI gelesen"
      await applyReady;
      // apply committet: schreibt vpi_base (was POST /api/vpi/apply tun wuerde)
      await tx.execute(sql`
        UPDATE tenants SET vpi_base = ${String(54321.11)} WHERE id = ${ilTenId}::uuid
      `);
      // Transaction wird commitet → shared Lock freigegeben
    });

    // Warten bis applyTx den shared Lock haelt
    await settle();

    // ── Schritt 2: DELETE-Anfrage feuern (laeuft im Hintergrund, blockiert auf exclusive Lock)
    const deletePromise = request(app)
      .delete(`/api/vpi/values/${vpiRow.id}`);

    // Kurz warten: DELETE sollte jetzt auf dem exclusive Lock blockieren
    await settle();

    // Verify: shared Lock ist noch gehalten, exclusive Try schlaegt fehl
    const tryExcl = await db.transaction(async (tx) =>
      tx.execute(sql`SELECT pg_try_advisory_xact_lock(${VPI_ADVISORY_LOCK_ID}) AS acquired`),
    );
    expect((tryExcl.rows[0] as any).acquired).toBe(false);

    // ── Schritt 3: apply committet (schreibt vpi_base, gibt shared Lock frei)
    releaseApply();
    await applyTx;

    // ── Schritt 4: DELETE bekommt exclusive Lock, findet vpi_base-Referenz → 409
    const res = await deletePromise;
    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe('VPI_IN_USE_TENANTS');

    // VPI-Wert muss noch in der DB sein
    const stillThere = await db.execute(sql`SELECT id FROM vpi_values WHERE id = ${vpiRow.id}::uuid`);
    expect(stillThere.rows).toHaveLength(1);

    // ── Cleanup ────────────────────────────────────────────────────────────
    await db.execute(sql`UPDATE tenants SET vpi_base = NULL WHERE id = ${ilTenId}::uuid`);
    await db.execute(sql`DELETE FROM vpi_values WHERE id = ${vpiRow.id}::uuid`);
  });

  test('Ohne Referenz: DELETE nach apply-Transaktion erfolgreich (200)', async () => {
    // Kontrollfall: kein Mieter referenziert den Wert → DELETE darf erfolgreich sein
    const vpiRow = await insertVpi(IL_BASE_YEAR, 2, 54322.22);
    await db.execute(sql`UPDATE tenants SET vpi_base = NULL WHERE id = ${ilTenId}::uuid`);

    // apply-Transaktion OHNE vpi_base-Schreibvorgang
    let releaseApply!: () => void;
    const applyReady = new Promise<void>(r => { releaseApply = r; });

    const applyTx = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${VPI_ADVISORY_LOCK_ID})`);
      await applyReady;
      // kein vpi_base-Update (apply-Schwellenwert nicht erreicht o. ae.)
    });

    await settle();
    const deletePromise = request(app).delete(`/api/vpi/values/${vpiRow.id}`);
    await settle();

    releaseApply();
    await applyTx;

    const res = await deletePromise;
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Wert ist geloescht
    const gone = await db.execute(sql`SELECT id FROM vpi_values WHERE id = ${vpiRow.id}::uuid`);
    expect(gone.rows).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Route-Ebene: POST /api/vpi-adjustments vs. DELETE /api/vpi/values/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('Route-Ebene — Interleaving: DELETE kann nicht erfolgreich sein wenn POST /api/vpi-adjustments committet', () => {
  const app = buildApp();

  test('DELETE blockiert auf exclusive Lock; nach vpi-adjustment-Commit → 409 VPI_IN_USE_ADJUSTMENTS', async () => {
    // ── Setup ──────────────────────────────────────────────────────────────
    const VPI_VAL = 77777.77;
    const vpiRow = await insertVpi(IL_BASE_YEAR, 3, VPI_VAL);

    // ── Schritt 1: POST /api/vpi-adjustments-Transaktion haelt shared Lock
    // und committet eine Anpassung mit vpi_new = VPI_VAL
    let releaseAdj!: () => void;
    const adjReady = new Promise<void>(r => { releaseAdj = r; });

    const adjTx = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${VPI_ADVISORY_LOCK_ID})`);
      await adjReady;
      // Schreibt vpi_adjustment mit vpi_new = VPI_VAL (was POST /api/vpi-adjustments tun wuerde)
      await tx.execute(sql`
        INSERT INTO vpi_adjustments
          (tenant_id, adjustment_date, previous_rent, new_rent, vpi_old, vpi_new, percentage_change)
        VALUES
          (${ilTenId}::uuid, CURRENT_DATE, '800', '850', '100', ${String(VPI_VAL)}, '6.25')
      `);
    });

    await settle();

    // ── Schritt 2: DELETE-Anfrage feuern (blockiert auf exclusive Lock)
    const deletePromise = request(app).delete(`/api/vpi/values/${vpiRow.id}`);
    await settle();

    // Verify: shared Lock gehalten, exclusive Try schlaegt fehl
    const tryExcl = await db.transaction(async (tx) =>
      tx.execute(sql`SELECT pg_try_advisory_xact_lock(${VPI_ADVISORY_LOCK_ID}) AS acquired`),
    );
    expect((tryExcl.rows[0] as any).acquired).toBe(false);

    // ── Schritt 3: vpi-adjustments-Transaktion committet
    releaseAdj();
    await adjTx;

    // ── Schritt 4: DELETE bekommt exclusive Lock, findet vpi_new-Referenz → 409
    const res = await deletePromise;
    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe('VPI_IN_USE_ADJUSTMENTS');

    // VPI-Wert muss noch existieren
    const stillThere = await db.execute(sql`SELECT id FROM vpi_values WHERE id = ${vpiRow.id}::uuid`);
    expect(stillThere.rows).toHaveLength(1);

    // ── Cleanup ────────────────────────────────────────────────────────────
    await db.execute(sql`DELETE FROM vpi_adjustments WHERE vpi_new = ${String(VPI_VAL)}`);
    await db.execute(sql`DELETE FROM vpi_values WHERE id = ${vpiRow.id}::uuid`);
  });

  test('Ohne Adjustment-Referenz: DELETE nach vpi-adjustment-Transaktion erfolgreich (200)', async () => {
    // Kontrollfall: Transaktion haelt shared Lock aber committet keinen Datensatz
    const vpiRow = await insertVpi(IL_BASE_YEAR, 4, 77778.88);

    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });

    const tx = db.transaction(async (t) => {
      await t.execute(sql`SELECT pg_advisory_xact_lock_shared(${VPI_ADVISORY_LOCK_ID})`);
      await gate;
      // kein INSERT (Schwellenwert nicht erreicht)
    });

    await settle();
    const deletePromise = request(app).delete(`/api/vpi/values/${vpiRow.id}`);
    await settle();

    release();
    await tx;

    const res = await deletePromise;
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const gone = await db.execute(sql`SELECT id FROM vpi_values WHERE id = ${vpiRow.id}::uuid`);
    expect(gone.rows).toHaveLength(0);
  });
});
