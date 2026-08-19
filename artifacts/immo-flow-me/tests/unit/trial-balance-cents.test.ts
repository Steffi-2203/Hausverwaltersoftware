/**
 * Service-Level-Regressionstests für trialBalanceService — Cent-Grenzwerte.
 *
 * Verifiziert, dass runDailyChecks eine exakt-1-Cent-Differenz (0.01 €)
 * in Journalbuchungen als Warnung ausgibt (vorher durch SQL `> 0.01` unterdrückt).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";

import { rootDb as db, withOrgContext } from "../../server/db";
import { runDailyChecks } from "../../server/services/trialBalanceService";

const orgId   = randomUUID();
const propId  = randomUUID();
const jeId1   = randomUUID(); // ausgeglichen
const jeId2   = randomUUID(); // exakt 1 Cent unausgeglichen
const coaId1  = randomUUID(); // Konto Soll
const coaId2  = randomUUID(); // Konto Haben

async function seed() {
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'TBCentsOrg') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'TB-Obj', 'Str 1', 'Wien', '1010', 'mietverwaltung')
    ON CONFLICT DO NOTHING`);

  // Kontenplan-Einträge
  await db.execute(sql`
    INSERT INTO chart_of_accounts (id, organization_id, account_number, name, account_type)
    VALUES (${coaId1}::uuid, ${orgId}::uuid, '1001', 'TB-Kasse', 'asset')
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO chart_of_accounts (id, organization_id, account_number, name, account_type)
    VALUES (${coaId2}::uuid, ${orgId}::uuid, '4001', 'TB-Ertrag', 'revenue')
    ON CONFLICT DO NOTHING`);

  // Journaleintrag 1: perfekt ausgeglichen (100.00 = 100.00)
  await db.execute(sql`
    INSERT INTO journal_entries (id, organization_id, property_id, booking_number, description, entry_date)
    VALUES (${jeId1}::uuid, ${orgId}::uuid, ${propId}::uuid, 'TB-001', 'Ausgeglichen', '2090-01-01')
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
    VALUES (${jeId1}::uuid, ${coaId1}::uuid, 100.00, 0)
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
    VALUES (${jeId1}::uuid, ${coaId2}::uuid, 0, 100.00)
    ON CONFLICT DO NOTHING`);

  // Journaleintrag 2: exakt 1 Cent unausgeglichen (100.01 Soll vs 100.00 Haben)
  await db.execute(sql`
    INSERT INTO journal_entries (id, organization_id, property_id, booking_number, description, entry_date)
    VALUES (${jeId2}::uuid, ${orgId}::uuid, ${propId}::uuid, 'TB-002', 'EinCentDiff', '2090-01-02')
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
    VALUES (${jeId2}::uuid, ${coaId1}::uuid, 100.01, 0)
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
    VALUES (${jeId2}::uuid, ${coaId2}::uuid, 0, 100.00)
    ON CONFLICT DO NOTHING`);
}

async function cleanup() {
  try {
    await db.execute(sql`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (${jeId1}::uuid, ${jeId2}::uuid)`);
    await db.execute(sql`DELETE FROM journal_entries WHERE id IN (${jeId1}::uuid, ${jeId2}::uuid)`);
    await db.execute(sql`DELETE FROM chart_of_accounts WHERE id IN (${coaId1}::uuid, ${coaId2}::uuid)`);
    await db.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
  } catch (err) {
    console.warn("TBCents-Cleanup (non-fatal):", (err as Error).message);
  }
}

describe("runDailyChecks — Cent-Grenzwert-Erkennung (DB-Level)", () => {
  before(async () => { await seed(); });
  after(async () => { await cleanup(); });

  it("exakt 1 Cent Differenz (0.01 €) wird als Warnung erkannt — nicht mehr durch SQL >= 0.005 unterdrückt", async () => {
    // runDailyChecks verwendet db (RLS-Proxy) → withOrgContext nötig
    const warnings = await withOrgContext(orgId, () => runDailyChecks(orgId));

    // Buchung TB-001 ist ausgeglichen → keine Warnung für sie
    const balancedMentioned = warnings.some(w => w.includes("TB-001"));
    assert.ok(!balancedMentioned, "Ausgeglichene Buchung TB-001 darf keine Warnung erzeugen");

    // Buchung TB-002 hat exakt 0.01 € Differenz → MUSS eine Warnung erzeugen
    const oneCentWarning = warnings.some(w => w.includes("TB-002"));
    assert.ok(
      oneCentWarning,
      `Erwarte Warnung für TB-002 (0.01 € Differenz), bekam: ${JSON.stringify(warnings)}`,
    );
  });

  it("ausgeglichene Buchung erzeugt keine Ungleichgewichts-Warnung", async () => {
    const warnings = await withOrgContext(orgId, () => runDailyChecks(orgId));
    const balancedWarning = warnings.some(w => w.includes("TB-001") && w.includes("Unausgeglichene"));
    assert.ok(!balancedWarning, "Keine Ungleichgewichts-Warnung für perfekt ausgeglichene Buchung");
  });
});
