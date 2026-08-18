/**
 * Nachweis: mahnstufe wird nach einem Mahnlauf dauerhaft gespeichert
 * und geht bei erneutem Laden nicht verloren.
 *
 * Testet: Schema-Spalte mahnstufe, zahlungserinnerung_am, mahnung_am auf
 * monthly_invoices existieren und werden von Drizzle ORM korrekt persistiert.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rootDb } from '../../server/db.js';
import { sql } from 'drizzle-orm';
import { eq, and } from 'drizzle-orm';
import { monthlyInvoices, organizations, properties, units, tenants } from '../../shared/schema.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const ORG_ID     = randomUUID();
const PROP_ID    = randomUUID();
const UNIT_ID    = randomUUID();
const TENANT_ID  = randomUUID();
const INV_ID     = randomUUID();

before(async () => {
  await rootDb.execute(sql`
    INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'MahnstufeTest-Org')
    ON CONFLICT (id) DO NOTHING`);
  await rootDb.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code)
    VALUES (${PROP_ID}::uuid, ${ORG_ID}::uuid, 'MTest-Liegenschaft', 'Str. 1', 'Wien', '1010')
    ON CONFLICT (id) DO NOTHING`);
  await rootDb.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type)
    VALUES (${UNIT_ID}::uuid, ${PROP_ID}::uuid, 'Top M1', 'wohnung')
    ON CONFLICT (id) DO NOTHING`);
  await rootDb.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status,
                         grundmiete, betriebskosten_vorschuss,
                         heizungskosten_vorschuss, mietbeginn)
    VALUES (${TENANT_ID}::uuid, ${UNIT_ID}::uuid, 'Mahn', 'Tester',
            'mahntester@test.at', 'aktiv', 500, 100, 50, '2025-01-01')
    ON CONFLICT (id) DO NOTHING`);
  await rootDb.insert(monthlyInvoices).values({
    id:           INV_ID,
    unitId:       UNIT_ID,
    tenantId:     TENANT_ID,
    year:         2025,
    month:        3,
    gesamtbetrag: '650.00',
    status:       'offen',
    mahnstufe:    0,
  }).onConflictDoNothing();
});

after(async () => {
  // FK-Reihenfolge: Rechnung → Mieter → Einheit → Liegenschaft → Org
  await rootDb.delete(monthlyInvoices).where(eq(monthlyInvoices.id, INV_ID)).catch(() => {});
  await rootDb.execute(sql`DELETE FROM tenants WHERE id = ${TENANT_ID}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM units   WHERE id = ${UNIT_ID}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM properties WHERE id = ${PROP_ID}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM organizations WHERE id = ${ORG_ID}::uuid`).catch(() => {});
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('mahnstufe Persistenz', () => {

  it('startet bei 0', async () => {
    const [inv] = await rootDb
      .select({ mahnstufe: monthlyInvoices.mahnstufe })
      .from(monthlyInvoices)
      .where(eq(monthlyInvoices.id, INV_ID));
    assert.equal(inv.mahnstufe, 0, 'Neue Rechnung muss mahnstufe=0 haben');
  });

  it('persistiert mahnstufe=1 + zahlungserinnerungAm nach Stufe-1-Mahnlauf', async () => {
    const now = new Date();
    await rootDb
      .update(monthlyInvoices)
      .set({ mahnstufe: 1, zahlungserinnerungAm: now })
      .where(eq(monthlyInvoices.id, INV_ID));

    // Erneutes Laden — simuliert nächsten Mahnlauf
    const [inv] = await rootDb
      .select({
        mahnstufe:           monthlyInvoices.mahnstufe,
        zahlungserinnerungAm: monthlyInvoices.zahlungserinnerungAm,
        mahnungAm:           monthlyInvoices.mahnungAm,
      })
      .from(monthlyInvoices)
      .where(eq(monthlyInvoices.id, INV_ID));

    assert.equal(inv.mahnstufe, 1,
      'mahnstufe muss nach Reload 1 sein (war vorher silent verworfen)');
    assert.ok(inv.zahlungserinnerungAm !== null,
      'zahlungserinnerungAm muss gespeichert sein');
    assert.equal(inv.mahnungAm, null,
      'mahnungAm darf bei Stufe 1 noch nicht gesetzt sein');
  });

  it('eskaliert auf mahnstufe=2 + mahnungAm und behält wert nach Reload', async () => {
    const now = new Date();
    await rootDb
      .update(monthlyInvoices)
      .set({ mahnstufe: 2, mahnungAm: now, status: 'ueberfaellig' })
      .where(eq(monthlyInvoices.id, INV_ID));

    const [inv] = await rootDb
      .select({
        mahnstufe: monthlyInvoices.mahnstufe,
        mahnungAm: monthlyInvoices.mahnungAm,
        status:    monthlyInvoices.status,
      })
      .from(monthlyInvoices)
      .where(eq(monthlyInvoices.id, INV_ID));

    assert.equal(inv.mahnstufe, 2, 'Eskalation auf Stufe 2 muss gespeichert sein');
    assert.ok(inv.mahnungAm !== null, 'mahnungAm muss nach Stufe-2-Update gesetzt sein');
    assert.equal(inv.status, 'ueberfaellig');
  });

  it('erkennt im nächsten Mahnlauf korrekt: currentLevel ist jetzt 2, nicht 0', async () => {
    // Simuliert automatedDunningService.checkOverdueInvoices():
    // currentLevel = row.invoice.mahnstufe || 0
    // Früher war mahnstufe nie gespeichert → immer 0 → immer erneute Eskalation
    const [inv] = await rootDb
      .select({ mahnstufe: monthlyInvoices.mahnstufe })
      .from(monthlyInvoices)
      .where(eq(monthlyInvoices.id, INV_ID));

    const currentLevel = inv.mahnstufe || 0;
    assert.equal(currentLevel, 2,
      'currentLevel muss 2 sein — bei Stufe 0 würde Mahnlauf fälschlicherweise erneut eskalieren');
  });

});
