/**
 * Integrationstest für cleanupTestData() — Task #183.
 *
 * Beweist dass cleanupTestData() eine vollständige Org-Hierarchie
 * (Profile + Org + Property + Unit + Tenant + monthly_invoice) spurlos
 * entfernt.
 *
 * WICHTIG: Dieser Test ruft cleanupTestData() auf, das ALLE @test.at-Profile
 * löscht. Deshalb läuft er NICHT im parallelen test-Haupt-Skript, sondern
 * ausschliesslich via `pnpm test:cleanup-integration` (sequenziell, allein).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { rootDb } from '../../server/db';
import { cleanupTestData } from '../../scripts/cleanup-test-data';

const ORG_ID         = randomUUID();
const PROF_ID        = randomUUID();
const PROP_ID        = randomUUID();
const UNIT_ID        = randomUUID();
const TENANT_ID      = randomUUID();
const INVOICE_ID     = randomUUID();
const OWNER_ID       = randomUUID();   // owners.id
const PROP_OWNER_ID  = randomUUID();   // property_owners.id (PK of junction table)
const PAYOUT_ID      = randomUUID();   // owner_payouts.id
const SIG_REQ_ID     = randomUUID();   // signature_requests.id
const SIG_ID         = randomUUID();   // signatures.id — unterzeichnet von PROF_ID2 (Cross-Profil!)
const TICKET_ID      = randomUUID();   // support_ticket erstellt von PROF_ID
const COMMENT_ID     = randomUUID();   // ticket_comment authored von PROF_ID2 (Cross-Profil!)
// PROF_ID2 hat ebenfalls @test.at damit cleanupTestData() die Org leert und cleanupOrgById() aufruft.
// Cross-Profil-Sinn: PROF_ID2 kommentiert PROF_IDs Ticket und unterzeichnet PROF_IDs Anfrage.
// Das testet die FK-Reihenfolge (ticket_comments VOR support_tickets, signatures VOR signature_requests).
const PROF_ID2       = randomUUID();
const TEST_EMAIL     = `cleanup-inttest-${PROF_ID.slice(0, 8)}@test.at`;
const EMAIL2         = `cleanup-inttest2-${PROF_ID2.slice(0, 8)}@test.at`;

before(async () => {
  process.env.ALLOW_TEST_DATA_CLEANUP = '1';

  // Org
  await rootDb.execute(sql`
    INSERT INTO organizations (id, name)
    VALUES (${ORG_ID}::uuid, 'CleanupIntTest-Org')
    ON CONFLICT (id) DO NOTHING
  `);
  // Profil
  await rootDb.execute(sql`
    INSERT INTO profiles (id, email, full_name, organization_id)
    VALUES (${PROF_ID}::uuid, ${TEST_EMAIL}, 'IntTest User', ${ORG_ID}::uuid)
    ON CONFLICT (id) DO NOTHING
  `);
  // Audit-Log → FK ON DELETE NO ACTION
  await rootDb.execute(sql`
    INSERT INTO audit_logs (user_id, table_name, record_id, action)
    VALUES (${PROF_ID}::uuid, 'profiles', ${PROF_ID}, 'create')
  `);
  // Property
  await rootDb.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code)
    VALUES (${PROP_ID}::uuid, ${ORG_ID}::uuid, 'IntTest-Liegenschaft', 'Musterstr. 1', 'Wien', '1010')
    ON CONFLICT (id) DO NOTHING
  `);
  // Unit
  await rootDb.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type)
    VALUES (${UNIT_ID}::uuid, ${PROP_ID}::uuid, 'Top 99', 'wohnung')
    ON CONFLICT (id) DO NOTHING
  `);
  // Tenant
  await rootDb.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status,
                         grundmiete, betriebskosten_vorschuss,
                         heizungskosten_vorschuss, mietbeginn)
    VALUES (${TENANT_ID}::uuid, ${UNIT_ID}::uuid, 'Int', 'Test',
            'inttest-tenant@example.com', 'aktiv',
            500, 100, 50, '2025-01-01')
    ON CONFLICT (id) DO NOTHING
  `);
  // monthly_invoice → verknüpft via unit_id (kein direktes org_id)
  await rootDb.execute(sql`
    INSERT INTO monthly_invoices (id, unit_id, tenant_id, year, month, gesamtbetrag)
    VALUES (${INVOICE_ID}::uuid, ${UNIT_ID}::uuid, ${TENANT_ID}::uuid, 2025, 1, 650.00)
    ON CONFLICT (id) DO NOTHING
  `);
  // owners → kein org_id-direkter Pfad, wird via cleanupOrgById über owners-Löschung entfernt
  await rootDb.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name)
    VALUES (${OWNER_ID}::uuid, ${ORG_ID}::uuid, 'Int', 'TestOwner')
    ON CONFLICT (id) DO NOTHING
  `);
  // property_owners: junction table (kein org_id) — owner_payouts.owner_id → property_owners.id
  await rootDb.execute(sql`
    INSERT INTO property_owners (id, property_id, owner_id)
    VALUES (${PROP_OWNER_ID}::uuid, ${PROP_ID}::uuid, ${OWNER_ID}::uuid)
    ON CONFLICT (id) DO NOTHING
  `);
  // owner_payouts: org_id + property_id + owner_id (→ property_owners.id!)
  // Testet: owner_payouts muss VOR property_owners gelöscht werden
  await rootDb.execute(sql`
    INSERT INTO owner_payouts (id, organization_id, property_id, owner_id, period_from, period_to)
    VALUES (${PAYOUT_ID}::uuid, ${ORG_ID}::uuid, ${PROP_ID}::uuid, ${PROP_OWNER_ID}::uuid,
            '2025-01-01', '2025-12-31')
    ON CONFLICT (id) DO NOTHING
  `);
  // signature_requests (org_id): document_id ist eine text-Spalte, erstellt von PROF_ID
  await rootDb.execute(sql`
    INSERT INTO signature_requests (id, organization_id, document_id, document_name, requested_by)
    VALUES (${SIG_REQ_ID}::uuid, ${ORG_ID}::uuid, ${PROP_ID}::text, 'IntTest-Dokument', ${PROF_ID}::uuid)
    ON CONFLICT (id) DO NOTHING
  `);

  // ─── Cross-Profil-Fixtures: zweites Profil (kein @test.at) in derselben Org ─
  // Testet: cleanup muss auch Kinder löschen die von anderen Profilen stammen.
  await rootDb.execute(sql`
    INSERT INTO profiles (id, email, full_name, organization_id)
    VALUES (${PROF_ID2}::uuid, ${EMAIL2}, 'CrossProfile User', ${ORG_ID}::uuid)
    ON CONFLICT (id) DO NOTHING
  `);
  // support_ticket erstellt von PROF_ID
  await rootDb.execute(sql`
    INSERT INTO support_tickets
      (id, organization_id, property_id, ticket_number, category, priority, status, subject, description, created_by_id)
    VALUES
      (${TICKET_ID}::uuid, ${ORG_ID}::uuid, ${PROP_ID}::uuid,
       'INT-001', 'general', 'low', 'open', 'IntTest Ticket', 'Cross-profile test ticket', ${PROF_ID}::uuid)
    ON CONFLICT (id) DO NOTHING
  `);
  // ticket_comment authored von PROF_ID2 (Cross-Profil!) → blockiert Ticket-Löschung ohne Fix
  await rootDb.execute(sql`
    INSERT INTO ticket_comments (id, ticket_id, author_id, content)
    VALUES (${COMMENT_ID}::uuid, ${TICKET_ID}::uuid, ${PROF_ID2}::uuid, 'Cross-profile comment')
    ON CONFLICT (id) DO NOTHING
  `);
  // signatures: unterzeichnet von PROF_ID2, aber Anfrage von PROF_ID → Cross-Profil!
  // Testet: signatures muss via request_id VOR signature_requests gelöscht werden
  await rootDb.execute(sql`
    INSERT INTO signatures (id, request_id, signer_id, signer_name, signer_email)
    VALUES (${SIG_ID}::uuid, ${SIG_REQ_ID}::uuid, ${PROF_ID2}::uuid,
            'Cross Profile', 'cross@example.com')
    ON CONFLICT (id) DO NOTHING
  `);
});

after(async () => {
  // Defensive Bereinigung falls der Test selbst scheitert (FK-Reihenfolge einhalten)
  await rootDb.execute(sql`DELETE FROM ticket_comments   WHERE id = ${COMMENT_ID}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM support_tickets   WHERE id = ${TICKET_ID}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM signatures        WHERE id = ${SIG_ID}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM signature_requests WHERE id = ${SIG_REQ_ID}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM owner_payouts     WHERE id = ${PAYOUT_ID}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM property_owners   WHERE id = ${PROP_OWNER_ID}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM owners            WHERE id = ${OWNER_ID}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM monthly_invoices  WHERE id = ${INVOICE_ID}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM tenants           WHERE id = ${TENANT_ID}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM units             WHERE id = ${UNIT_ID}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM properties        WHERE id = ${PROP_ID}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM audit_logs        WHERE user_id = ${PROF_ID}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM profiles          WHERE id = ${PROF_ID2}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM profiles          WHERE id = ${PROF_ID}::uuid`).catch(() => {});
  await rootDb.execute(sql`DELETE FROM organizations     WHERE id = ${ORG_ID}::uuid`).catch(() => {});
});

describe('cleanupTestData() — vollständige Org-Hierarchie', () => {

  it('löscht Profil + Organisation + Property + Unit + Tenant + monthly_invoice spurlos', async () => {
    // Vorbedingungen
    type Row = Record<string, unknown>;
    const profCheck = await rootDb.execute(sql`SELECT COUNT(*)::int AS n FROM profiles WHERE id = ${PROF_ID}::uuid`);
    assert.equal(Number((profCheck.rows[0] as Row).n), 1, 'Profil muss vorhanden sein');

    const orgCheck = await rootDb.execute(sql`SELECT COUNT(*)::int AS n FROM organizations WHERE id = ${ORG_ID}::uuid`);
    assert.equal(Number((orgCheck.rows[0] as Row).n), 1, 'Org muss vorhanden sein');

    const invCheck = await rootDb.execute(sql`SELECT COUNT(*)::int AS n FROM monthly_invoices WHERE id = ${INVOICE_ID}::uuid`);
    assert.equal(Number((invCheck.rows[0] as Row).n), 1, 'monthly_invoice muss vorhanden sein');

    // Globaler Cleanup
    const result = await cleanupTestData({ verbose: false });

    // Profil weg
    const profAfter = await rootDb.execute(sql`SELECT COUNT(*)::int AS n FROM profiles WHERE id = ${PROF_ID}::uuid`);
    assert.equal(Number((profAfter.rows[0] as Row).n), 0, 'Profil muss nach Cleanup weg sein');

    // audit_logs weg (FK ON DELETE NO ACTION)
    const auditAfter = await rootDb.execute(sql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE user_id = ${PROF_ID}::uuid`);
    assert.equal(Number((auditAfter.rows[0] as Row).n), 0, 'audit_logs müssen weg sein');

    // Organisation weg
    const orgAfter = await rootDb.execute(sql`SELECT COUNT(*)::int AS n FROM organizations WHERE id = ${ORG_ID}::uuid`);
    assert.equal(Number((orgAfter.rows[0] as Row).n), 0, 'Org muss nach Cleanup weg sein');

    // Property weg
    const propAfter = await rootDb.execute(sql`SELECT COUNT(*)::int AS n FROM properties WHERE id = ${PROP_ID}::uuid`);
    assert.equal(Number((propAfter.rows[0] as Row).n), 0, 'Property muss nach Cleanup weg sein');

    // Unit weg
    const unitAfter = await rootDb.execute(sql`SELECT COUNT(*)::int AS n FROM units WHERE id = ${UNIT_ID}::uuid`);
    assert.equal(Number((unitAfter.rows[0] as Row).n), 0, 'Unit muss nach Cleanup weg sein');

    // Tenant weg
    const tenantAfter = await rootDb.execute(sql`SELECT COUNT(*)::int AS n FROM tenants WHERE id = ${TENANT_ID}::uuid`);
    assert.equal(Number((tenantAfter.rows[0] as Row).n), 0, 'Tenant muss nach Cleanup weg sein');

    // monthly_invoice weg (kein direktes org_id — via unit_id verknüpft)
    const invoiceAfter = await rootDb.execute(sql`SELECT COUNT(*)::int AS n FROM monthly_invoices WHERE id = ${INVOICE_ID}::uuid`);
    assert.equal(Number((invoiceAfter.rows[0] as Row).n), 0,
      'monthly_invoice muss nach Cleanup weg sein (Org-Hierarchie inkl. indirekter FK-Kinder)');

    // owner_payouts weg (testet: owner_payouts VOR property_owners)
    const payoutAfter = await rootDb.execute(sql`SELECT COUNT(*)::int AS n FROM owner_payouts WHERE id = ${PAYOUT_ID}::uuid`);
    assert.equal(Number((payoutAfter.rows[0] as Row).n), 0,
      'owner_payout muss weg sein (owner_id → property_owners.id, muss VOR property_owners gelöscht werden)');

    // property_owners weg (kein org_id — via property_id)
    const propOwnerAfter = await rootDb.execute(sql`SELECT COUNT(*)::int AS n FROM property_owners WHERE id = ${PROP_OWNER_ID}::uuid`);
    assert.equal(Number((propOwnerAfter.rows[0] as Row).n), 0, 'property_owners muss weg sein');

    // signatures weg (testet: signatures.request_id → signature_requests VOR signature_requests)
    const sigAfter = await rootDb.execute(sql`SELECT COUNT(*)::int AS n FROM signatures WHERE id = ${SIG_ID}::uuid`);
    assert.equal(Number((sigAfter.rows[0] as Row).n), 0,
      'signature muss weg sein (request_id → signature_requests, muss VOR signature_requests gelöscht werden)');

    // signature_requests weg
    const sigReqAfter = await rootDb.execute(sql`SELECT COUNT(*)::int AS n FROM signature_requests WHERE id = ${SIG_REQ_ID}::uuid`);
    assert.equal(Number((sigReqAfter.rows[0] as Row).n), 0, 'signature_request muss weg sein');

    // ── Cross-Profil-Prüfungen ──────────────────────────────────────────────
    // ticket_comment von PROF_ID2 auf Ticket von PROF_ID muss ebenfalls weg sein
    const commentAfter = await rootDb.execute(sql`SELECT COUNT(*)::int AS n FROM ticket_comments WHERE id = ${COMMENT_ID}::uuid`);
    assert.equal(Number((commentAfter.rows[0] as Row).n), 0,
      'ticket_comment von drittem Profil muss weg sein (via ticketsSub vor support_tickets)');

    // support_ticket weg
    const ticketAfter = await rootDb.execute(sql`SELECT COUNT(*)::int AS n FROM support_tickets WHERE id = ${TICKET_ID}::uuid`);
    assert.equal(Number((ticketAfter.rows[0] as Row).n), 0, 'support_ticket muss weg sein');

    // signature (signer = PROF_ID2, aber request = PROF_ID) muss weg sein
    const sigCrossAfter = await rootDb.execute(sql`SELECT COUNT(*)::int AS n FROM signatures WHERE id = ${SIG_ID}::uuid`);
    assert.equal(Number((sigCrossAfter.rows[0] as Row).n), 0,
      'Cross-Profil-Signatur muss weg sein (via sigReqSub.request_id VOR signature_requests)');

    // PROF_ID2 selbst (kein @test.at!) muss ebenfalls weg sein (cleanupOrgById löscht alle Profile der Org)
    const prof2After = await rootDb.execute(sql`SELECT COUNT(*)::int AS n FROM profiles WHERE id = ${PROF_ID2}::uuid`);
    assert.equal(Number((prof2After.rows[0] as Row).n), 0, 'PROF_ID2 muss via cleanupOrgById weg sein');

    assert.ok(result.profilesDeleted >= 1, `profilesDeleted >= 1, war: ${result.profilesDeleted}`);
    assert.ok(result.orgsDeleted >= 1,     `orgsDeleted >= 1, war: ${result.orgsDeleted}`);
  });

});
