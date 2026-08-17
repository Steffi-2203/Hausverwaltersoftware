/**
 * Ledger-Unveränderlichkeit — PostgreSQL-Trigger auf Buchungs-Tabellen (Task #51)
 *
 * Prüft dass BEFORE UPDATE OR DELETE Trigger auf allen kritischen Append-Only-
 * Tabellen feuern. UPDATE und DELETE werden auf DB-Ebene blockiert; INSERT
 * (Append) bleibt jederzeit erlaubt.
 *
 * Getestete Tabellen (alle aus Migration 20260820b_ledger_immutable_triggers.sql):
 *   - invoice_lines        (Mietbuchungszeilen)
 *   - payment_allocations  (Zahlungszuordnungen)
 *   - weg_settlement_details (WEG-Jahresabrechnungs-Eigentümeranteile)
 *   - journal_entry_lines  (Doppik-Buchungszeilenzeilen, § 190 UGB)
 *
 * Muster analog zu deposit-lifecycle.test.ts (kautions_bewegungen-Trigger).
 */

import { describe, it, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';
import { rootDb as db } from '../../server/db';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

// ── Gemeinsame Seed-IDs ────────────────────────────────────────────────────
const orgId      = uuidv4();
const propId     = uuidv4();
const unitId     = uuidv4();
const tenantId   = uuidv4();
const ownerId    = uuidv4();

async function seedBase() {
  await db.execute(sql`
    INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'Trigger-Test-Org')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'Trigger-Haus', 'Triggerstr. 1', 'Wien', '1010', 'mietverwaltung')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status)
    VALUES (${unitId}::uuid, ${propId}::uuid, 'Top T1', 'wohnung', 'aktiv')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email)
    VALUES (${tenantId}::uuid, ${unitId}::uuid, 'Trigger', 'Tenant', 'trigger@test.at')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name)
    VALUES (${ownerId}::uuid, ${orgId}::uuid, 'Trigger', 'Owner')
    ON CONFLICT DO NOTHING
  `);
}

async function cleanupBase() {
  await db.execute(sql`DELETE FROM owners     WHERE id = ${ownerId}::uuid`);
  await db.execute(sql`DELETE FROM tenants    WHERE id = ${tenantId}::uuid`);
  await db.execute(sql`DELETE FROM units      WHERE id = ${unitId}::uuid`);
  await db.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
  await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
}

/** Hilfsfunktion: Prüft ob ein Trigger auf einer Tabelle existiert. */
async function triggerExists(triggerName: string, tableName: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname = ${triggerName}
      AND c.relname = ${tableName}
      AND NOT t.tgisinternal
  `);
  return (result.rows?.length ?? 0) > 0;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. invoice_lines
// ══════════════════════════════════════════════════════════════════════════════
//
// Trigger ist bedingungslos — jedes UPDATE und DELETE wird geblockt, unabhängig
// vom Status der Parent-Vorschreibung.
// billing.service.ts verwendet DO NOTHING statt DO UPDATE, womit keine legitimen
// Anwendungspfade durch den Trigger blockiert werden.

describe('invoice_lines — Trigger trg_invoice_lines_immutable', () => {
  const invoiceId = uuidv4();
  const lineId    = uuidv4();

  beforeAll(async () => {
    await seedBase();
    await db.execute(sql`
      INSERT INTO monthly_invoices (id, unit_id, year, month, gesamtbetrag, status)
      VALUES (${invoiceId}::uuid, ${unitId}::uuid, 2085, 1, 800.00, 'offen')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO invoice_lines (id, invoice_id, unit_id, line_type, description, amount)
      VALUES (${lineId}::uuid, ${invoiceId}::uuid, ${unitId}::uuid, 'miete', 'Grundmiete', 800.00)
      ON CONFLICT DO NOTHING
    `);
  });

  afterAll(async () => {
    await db.execute(sql`ALTER TABLE invoice_lines DISABLE TRIGGER ALL`);
    try {
      await db.execute(sql`DELETE FROM invoice_lines WHERE id = ${lineId}::uuid`);
    } finally {
      await db.execute(sql`ALTER TABLE invoice_lines ENABLE TRIGGER ALL`);
    }
    await db.execute(sql`ALTER TABLE monthly_invoices DISABLE TRIGGER ALL`);
    try {
      await db.execute(sql`DELETE FROM monthly_invoices WHERE id = ${invoiceId}::uuid`);
    } finally {
      await db.execute(sql`ALTER TABLE monthly_invoices ENABLE TRIGGER ALL`);
    }
    await cleanupBase();
  });

  it('Trigger trg_invoice_lines_immutable ist auf der Tabelle registriert', async () => {
    expect(await triggerExists('trg_invoice_lines_immutable', 'invoice_lines')).toBe(true);
  });

  it('INSERT in invoice_lines ist erlaubt (positiver Smoke-Test)', async () => {
    const tmpId = uuidv4();
    let err: Error | null = null;
    try {
      await db.execute(sql`
        INSERT INTO invoice_lines (id, invoice_id, unit_id, line_type, description, amount)
        VALUES (${tmpId}::uuid, ${invoiceId}::uuid, ${unitId}::uuid, 'betriebskosten', 'BK-Anteil', 50.00)
      `);
    } catch (e: any) { err = e; }
    expect(err).toBeNull();

    await db.execute(sql`ALTER TABLE invoice_lines DISABLE TRIGGER ALL`);
    try {
      await db.execute(sql`DELETE FROM invoice_lines WHERE id = ${tmpId}::uuid`);
    } finally {
      await db.execute(sql`ALTER TABLE invoice_lines ENABLE TRIGGER ALL`);
    }
  });

  it('UPDATE auf invoice_lines wird vom Trigger blockiert', async () => {
    await expect(
      db.execute(sql`UPDATE invoice_lines SET amount = 999.00 WHERE id = ${lineId}::uuid`)
    ).rejects.toThrow();
  });

  it('DELETE auf invoice_lines wird vom Trigger blockiert', async () => {
    await expect(
      db.execute(sql`DELETE FROM invoice_lines WHERE id = ${lineId}::uuid`)
    ).rejects.toThrow();
  });

  it('Trigger-Meldung enthält Hinweis auf Ledger-Integrität', async () => {
    let caughtErr: any = null;
    try {
      await db.execute(sql`UPDATE invoice_lines SET description = 'manipuliert' WHERE id = ${lineId}::uuid`);
    } catch (e: any) { caughtErr = e; }
    expect(caughtErr).not.toBeNull();
    const fullText = [
      caughtErr?.message,
      caughtErr?.cause?.message,
      JSON.stringify(caughtErr?.cause ?? {}),
    ].join(' ');
    expect(fullText).toMatch(/unveränderlich|Ledger|nicht zulässig|invoice_lines/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. payment_allocations
// ══════════════════════════════════════════════════════════════════════════════

describe('payment_allocations — Trigger trg_payment_allocations_immutable', () => {
  const invoiceId    = uuidv4();
  const paymentId    = uuidv4();
  const allocationId = uuidv4();

  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'Trigger-Test-Org') ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
      VALUES (${propId}::uuid, ${orgId}::uuid, 'Trigger-Haus', 'Triggerstr. 1', 'Wien', '1010', 'mietverwaltung')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO units (id, property_id, top_nummer, type, status)
      VALUES (${unitId}::uuid, ${propId}::uuid, 'Top T1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO tenants (id, unit_id, first_name, last_name, email)
      VALUES (${tenantId}::uuid, ${unitId}::uuid, 'Trigger', 'Tenant', 'trigger@test.at') ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO monthly_invoices (id, unit_id, year, month, gesamtbetrag, status)
      VALUES (${invoiceId}::uuid, ${unitId}::uuid, 2085, 2, 900.00, 'offen')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO payments (id, tenant_id, invoice_id, betrag, buchungs_datum, payment_type)
      VALUES (${paymentId}::uuid, ${tenantId}::uuid, ${invoiceId}::uuid, 900.00, CURRENT_DATE, 'ueberweisung')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO payment_allocations (id, payment_id, invoice_id, applied_amount)
      VALUES (${allocationId}::uuid, ${paymentId}::uuid, ${invoiceId}::uuid, 900.00)
      ON CONFLICT DO NOTHING
    `);
  });

  afterAll(async () => {
    await db.execute(sql`ALTER TABLE payment_allocations DISABLE TRIGGER ALL`);
    try {
      await db.execute(sql`DELETE FROM payment_allocations WHERE id = ${allocationId}::uuid`);
    } finally {
      await db.execute(sql`ALTER TABLE payment_allocations ENABLE TRIGGER ALL`);
    }
    await db.execute(sql`DELETE FROM payments WHERE id = ${paymentId}::uuid`);
    await db.execute(sql`ALTER TABLE monthly_invoices DISABLE TRIGGER ALL`);
    try {
      await db.execute(sql`DELETE FROM monthly_invoices WHERE id = ${invoiceId}::uuid`);
    } finally {
      await db.execute(sql`ALTER TABLE monthly_invoices ENABLE TRIGGER ALL`);
    }
  });

  it('Trigger trg_payment_allocations_immutable ist registriert', async () => {
    expect(await triggerExists('trg_payment_allocations_immutable', 'payment_allocations')).toBe(true);
  });

  it('UPDATE auf payment_allocations wird blockiert', async () => {
    await expect(
      db.execute(sql`UPDATE payment_allocations SET applied_amount = 1.00 WHERE id = ${allocationId}::uuid`)
    ).rejects.toThrow();
  });

  it('DELETE auf payment_allocations wird blockiert', async () => {
    await expect(
      db.execute(sql`DELETE FROM payment_allocations WHERE id = ${allocationId}::uuid`)
    ).rejects.toThrow();
  });

  it('Trigger-Meldung enthält Hinweis auf Zahlungszuordnungen', async () => {
    let caughtErr: any = null;
    try {
      await db.execute(sql`UPDATE payment_allocations SET applied_amount = 0 WHERE id = ${allocationId}::uuid`);
    } catch (e: any) { caughtErr = e; }
    const fullText = [caughtErr?.message, JSON.stringify(caughtErr?.cause ?? {})].join(' ');
    expect(fullText).toMatch(/unveränderlich|Ledger|payment_allocations|Zahlungszuordnungen/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. weg_settlement_details
// ══════════════════════════════════════════════════════════════════════════════

describe('weg_settlement_details — Trigger trg_weg_settlement_details_immutable', () => {
  const wegPropId      = uuidv4();
  const wegUnitId      = uuidv4();
  const wegOwnerId     = uuidv4();
  const settlementId   = uuidv4();
  const detailId       = uuidv4();

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'Trigger-Test-Org') ON CONFLICT DO NOTHING`);
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
      VALUES (${wegPropId}::uuid, ${orgId}::uuid, 'WEG-Trigger-Haus', 'WEGstr. 1', 'Wien', '1010', 'weg')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO units (id, property_id, top_nummer, type, status)
      VALUES (${wegUnitId}::uuid, ${wegPropId}::uuid, 'Top W1', 'wohnung', 'aktiv') ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO owners (id, organization_id, first_name, last_name)
      VALUES (${wegOwnerId}::uuid, ${orgId}::uuid, 'WEG', 'Owner') ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO weg_settlements (id, organization_id, property_id, year, status)
      VALUES (${settlementId}::uuid, ${orgId}::uuid, ${wegPropId}::uuid, 2085, 'entwurf')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO weg_settlement_details
        (id, settlement_id, owner_id, unit_id, mea_share, mea_ratio, total_soll, total_ist, saldo)
      VALUES
        (${detailId}::uuid, ${settlementId}::uuid, ${wegOwnerId}::uuid, ${wegUnitId}::uuid,
         1000, 0.5, 2400.00, 2200.00, -200.00)
      ON CONFLICT DO NOTHING
    `);
  });

  afterAll(async () => {
    await db.execute(sql`ALTER TABLE weg_settlement_details DISABLE TRIGGER ALL`);
    try {
      await db.execute(sql`DELETE FROM weg_settlement_details WHERE id = ${detailId}::uuid`);
    } finally {
      await db.execute(sql`ALTER TABLE weg_settlement_details ENABLE TRIGGER ALL`);
    }
    await db.execute(sql`DELETE FROM weg_settlements WHERE id = ${settlementId}::uuid`);
    await db.execute(sql`DELETE FROM owners          WHERE id = ${wegOwnerId}::uuid`);
    await db.execute(sql`DELETE FROM units           WHERE id = ${wegUnitId}::uuid`);
    await db.execute(sql`DELETE FROM properties      WHERE id = ${wegPropId}::uuid`);
  });

  it('Trigger trg_weg_settlement_details_immutable ist registriert', async () => {
    expect(await triggerExists('trg_weg_settlement_details_immutable', 'weg_settlement_details')).toBe(true);
  });

  it('UPDATE auf weg_settlement_details wird blockiert', async () => {
    await expect(
      db.execute(sql`UPDATE weg_settlement_details SET saldo = 0 WHERE id = ${detailId}::uuid`)
    ).rejects.toThrow();
  });

  it('DELETE auf weg_settlement_details wird blockiert', async () => {
    await expect(
      db.execute(sql`DELETE FROM weg_settlement_details WHERE id = ${detailId}::uuid`)
    ).rejects.toThrow();
  });

  it('Trigger-Meldung enthält Hinweis auf WEG-Abrechnung', async () => {
    let caughtErr: any = null;
    try {
      await db.execute(sql`UPDATE weg_settlement_details SET total_soll = 0 WHERE id = ${detailId}::uuid`);
    } catch (e: any) { caughtErr = e; }
    const fullText = [caughtErr?.message, JSON.stringify(caughtErr?.cause ?? {})].join(' ');
    expect(fullText).toMatch(/unveränderlich|Ledger|weg_settlement_details|WEG/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. journal_entry_lines
// ══════════════════════════════════════════════════════════════════════════════

describe('journal_entry_lines — Trigger trg_journal_entry_lines_immutable', () => {
  const journalEntryId = uuidv4();
  const journalLineId  = uuidv4();
  let   accountId: string;

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'Trigger-Test-Org') ON CONFLICT DO NOTHING`);

    // Chart-of-Accounts Eintrag suchen oder anlegen
    const existing = await db.execute(sql`
      SELECT id FROM chart_of_accounts
      WHERE organization_id = ${orgId}::uuid OR organization_id IS NULL
      LIMIT 1
    `);
    if (existing.rows.length > 0) {
      accountId = (existing.rows[0] as any).id;
    } else {
      accountId = uuidv4();
      await db.execute(sql`
        INSERT INTO chart_of_accounts (id, organization_id, account_number, name, account_type)
        VALUES (${accountId}::uuid, ${orgId}::uuid, '4000', 'Mieterlöse', 'revenue')
        ON CONFLICT DO NOTHING
      `);
    }

    await db.execute(sql`
      INSERT INTO journal_entries
        (id, organization_id, booking_number, entry_date, description)
      VALUES
        (${journalEntryId}::uuid, ${orgId}::uuid, 'JE-TRIGGER-TEST', CURRENT_DATE, 'Trigger-Test Buchung')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO journal_entry_lines
        (id, journal_entry_id, account_id, debit, credit)
      VALUES
        (${journalLineId}::uuid, ${journalEntryId}::uuid, ${accountId}::uuid, 800.00, 0.00)
      ON CONFLICT DO NOTHING
    `);
  });

  afterAll(async () => {
    await db.execute(sql`ALTER TABLE journal_entry_lines DISABLE TRIGGER ALL`);
    try {
      await db.execute(sql`DELETE FROM journal_entry_lines WHERE id = ${journalLineId}::uuid`);
    } finally {
      await db.execute(sql`ALTER TABLE journal_entry_lines ENABLE TRIGGER ALL`);
    }
    await db.execute(sql`DELETE FROM journal_entries WHERE id = ${journalEntryId}::uuid`);
  });

  it('Trigger trg_journal_entry_lines_immutable ist registriert', async () => {
    expect(await triggerExists('trg_journal_entry_lines_immutable', 'journal_entry_lines')).toBe(true);
  });

  it('UPDATE auf journal_entry_lines wird blockiert', async () => {
    await expect(
      db.execute(sql`UPDATE journal_entry_lines SET debit = 1.00 WHERE id = ${journalLineId}::uuid`)
    ).rejects.toThrow();
  });

  it('DELETE auf journal_entry_lines wird blockiert', async () => {
    await expect(
      db.execute(sql`DELETE FROM journal_entry_lines WHERE id = ${journalLineId}::uuid`)
    ).rejects.toThrow();
  });

  it('Trigger-Meldung enthält Hinweis auf Doppik / § 190 UGB', async () => {
    let caughtErr: any = null;
    try {
      await db.execute(sql`UPDATE journal_entry_lines SET credit = 9999 WHERE id = ${journalLineId}::uuid`);
    } catch (e: any) { caughtErr = e; }
    const fullText = [caughtErr?.message, JSON.stringify(caughtErr?.cause ?? {})].join(' ');
    expect(fullText).toMatch(/unveränderlich|Ledger|journal_entry_lines|UGB|Doppik/i);
  });
});
