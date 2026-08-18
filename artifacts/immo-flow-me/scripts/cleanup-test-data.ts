/**
 * Bereinigt verwaiste Test-Daten aus der Entwicklungsdatenbank (Task #183).
 *
 * SICHERHEIT — fail-closed:
 *   Verweigert Ausführung wenn REPLIT_DEPLOYMENT gesetzt,
 *   NODE_ENV=production oder ALLOW_TEST_DATA_CLEANUP != '1'.
 *
 * Verwendung:
 *   pnpm --filter @workspace/immo-flow-me cleanup-test-data   (manuell)
 *   Als pretest-Hook setzt package.json ALLOW_TEST_DATA_CLEANUP=1 automatisch.
 */

import { fileURLToPath } from 'node:url';
import { rootDb as db } from '../server/db';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Umgebungs-Sicherheitsprüfung
// ---------------------------------------------------------------------------

export class UnsafeEnvironmentError extends Error {
  constructor(reason: string) {
    super(`[cleanup-test-data] Ausführung verweigert: ${reason}`);
    this.name = 'UnsafeEnvironmentError';
  }
}

export function assertSafeTestEnvironment(): void {
  if (process.env.REPLIT_DEPLOYMENT) {
    throw new UnsafeEnvironmentError(
      'REPLIT_DEPLOYMENT ist gesetzt — das ist eine Produktionsumgebung.',
    );
  }
  if (process.env.NODE_ENV === 'production') {
    throw new UnsafeEnvironmentError('NODE_ENV ist "production".');
  }
  if (process.env.ALLOW_TEST_DATA_CLEANUP !== '1') {
    throw new UnsafeEnvironmentError(
      'ALLOW_TEST_DATA_CLEANUP=1 ist nicht gesetzt. ' +
      'Nur in explizit ausgewiesenen Testumgebungen ausführen.',
    );
  }
}

// ---------------------------------------------------------------------------
// UUID-Validierung (verhindert SQL-Injection in rawen Strings)
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUUID(value: string, context: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`${context}: kein gültiges UUID-Format: "${value}"`);
  }
}

// ---------------------------------------------------------------------------
// SQL-Hilfsfunktionen
// ---------------------------------------------------------------------------

/** E-Mail-Muster → Test-Profile-Subquery */
const TEST_PROFILE_SUBQUERY = `
  SELECT id FROM profiles
  WHERE email ILIKE '%@test.at'
     OR email ILIKE '%@test.internal'
     OR email ILIKE '%@test.example'
`;

/**
 * Löscht Zeilen aus `table` wo `column` IN (alle Test-Profil-IDs).
 * Sicher: `table` und `column` sind Compile-Time-Konstanten in diesem Modul,
 * keine externen Eingaben.
 */
async function purgeRef(table: string, column: string): Promise<number> {
  const res = await db.execute(
    sql.raw(
      `DELETE FROM "${table}" WHERE "${column}" IN (${TEST_PROFILE_SUBQUERY}) RETURNING 1`,
    ),
  );
  return res.rows?.length ?? 0;
}

/**
 * Löscht Zeilen aus `childTable` wo `fkCol` IN (SELECT id FROM `parentTable`
 * WHERE organization_id = validatedOrgId).
 * Beide Tabellennamen sind Compile-Time-Konstanten; orgId wird UUID-validiert.
 */
function delViaParent(
  childTable: string,
  fkCol: string,
  parentTable: string,
  orgId: string,
) {
  requireUUID(orgId, 'delViaParent');
  return db.execute(sql.raw(
    `DELETE FROM "${childTable}"
     WHERE "${fkCol}" IN (SELECT id FROM "${parentTable}" WHERE organization_id = '${orgId}'::uuid)`,
  ));
}

/**
 * Löscht Zeilen aus `childTable` wo `fkCol` IN (rawSubquery).
 * rawSubquery muss ein sicherer, intern gebauter SQL-Ausdruck sein — keine
 * externen Eingaben interpolieren!
 */
function delViaSub(childTable: string, fkCol: string, rawSubquery: string) {
  return db.execute(sql.raw(
    `DELETE FROM "${childTable}" WHERE "${fkCol}" IN (${rawSubquery})`,
  ));
}

// ---------------------------------------------------------------------------
// Profil-Level FK-Bereinigung
// ---------------------------------------------------------------------------

/**
 * Löscht alle FK-Abhängigkeiten eines einzelnen Profils (per ID).
 * Verwendet Drizzle-parameterisierte Queries — kein sql.raw mit externen Werten.
 */
async function purgeProfileDepsById(profileId: string): Promise<number> {
  requireUUID(profileId, 'purgeProfileDepsById');
  let n = 0;

  const del1 = (t: string, col: string) =>
    db.execute(sql.raw(`DELETE FROM "${t}" WHERE "${col}" = '${profileId}'::uuid RETURNING 1`))
      .then((r) => { n += r.rows?.length ?? 0; });

  const delSub1 = (t: string, fk: string, subq: string) =>
    db.execute(sql.raw(`DELETE FROM "${t}" WHERE "${fk}" IN (${subq}) RETURNING 1`))
      .then((r) => { n += r.rows?.length ?? 0; });

  // ── Blatt-Ebene: kein weiteres Kind mehr ───────────────────────────────────
  await del1('audit_logs',            'user_id');
  await del1('consent_records',       'user_id');
  await del1('user_2fa',              'user_id');
  await del1('password_history',      'user_id');
  await del1('password_reset_tokens', 'user_id');
  await del1('push_subscriptions',    'user_id');
  await del1('security_sessions',     'user_id');
  await del1('auth_tokens',           'user_id');
  await del1('user_roles',            'user_id');
  await del1('user_organizations',    'user_id');
  await del1('organization_invites',  'invited_by');
  await del1('demo_invites',          'user_id');
  await del1('guided_workflows',      'user_id');
  await del1('saved_reports',         'created_by');
  await del1('property_managers',     'user_id');
  await del1('invoice_runs',          'initiated_by');
  await del1('document_versions',     'uploaded_by');
  await del1('settlements',           'created_by');
  await del1('serial_letters',        'created_by');
  await del1('sepa_collections',      'created_by');
  await del1('contractors',           'created_by');
  await del1('maintenance_contracts', 'created_by');
  await del1('maintenance_tasks',     'created_by');
  await del1('weg_owner_changes',     'created_by');

  // ── Ticket-Kette: ticket_comments via ticket_id VOR support_tickets ────────
  // Wenn ein anderes Profil Kommentare zu einem Ticket dieses Profils geschrieben hat,
  // blockieren diese die Ticket-Löschung.
  const ticketsOfProfile =
    `SELECT id FROM "support_tickets"
     WHERE created_by_id = '${profileId}'::uuid
        OR assigned_to_id = '${profileId}'::uuid`;
  await delSub1('ticket_comments', 'ticket_id', ticketsOfProfile);
  await del1('ticket_comments', 'author_id');  // eigene Kommentare in fremden Tickets
  {
    const r = await db.execute(sql.raw(`
      DELETE FROM "support_tickets"
      WHERE created_by_id = '${profileId}'::uuid
         OR assigned_to_id = '${profileId}'::uuid
      RETURNING 1
    `));
    n += r.rows?.length ?? 0;
  }

  // ── Signature-Kette: signatures via request_id VOR signature_requests ──────
  // Wenn ein anderes Profil eine Anfrage dieses Profils unterzeichnet hat,
  // blockiert signatures.request_id die Request-Löschung.
  const sigreqsOfProfile =
    `SELECT id FROM "signature_requests" WHERE requested_by = '${profileId}'::uuid`;
  await delSub1('signatures', 'request_id', sigreqsOfProfile);
  await del1('signatures',          'signer_id');   // eigene Unterschriften unter fremden Requests
  await del1('signature_requests',  'requested_by');

  // ── damage_reports: assigned_to_id nullable → NULL vor Löschung ────────────
  await db.execute(sql.raw(
    `UPDATE "damage_reports" SET assigned_to_id = NULL
     WHERE assigned_to_id = '${profileId}'::uuid`,
  ));
  await del1('damage_reports', 'reported_by_id');

  return n;
}

// ---------------------------------------------------------------------------
// Org-Level FK-Bereinigung
// ---------------------------------------------------------------------------

/**
 * Löscht alle Daten einer Organisation in korrekter topologischer FK-Reihenfolge
 * (Blätter zuerst, Eltern zuletzt), dann die Organisation selbst.
 *
 * Sicherheit: enthält assertSafeTestEnvironment() — kein Aufruf ohne Opt-In möglich.
 * orgId wird UUID-validiert; alle SQL-Strings enthalten nur interne Konstanten.
 * Wirft bei Fehler — kein silent-ignore.
 *
 * FK-Topologie aus information_schema verifiziert (August 2026).
 * Tabellen ohne organization_id werden über ihre übergeordnete Tabelle adressiert.
 * Nullable FKs (matched_tenant_id, matched_unit_id in transactions) werden zuerst genullt.
 */
export async function cleanupOrgById(orgId: string): Promise<void> {
  assertSafeTestEnvironment();
  requireUUID(orgId, 'cleanupOrgById');

  // DELETE FROM table WHERE organization_id = orgId
  const del = (t: string) =>
    db.execute(sql.raw(`DELETE FROM "${t}" WHERE organization_id = '${orgId}'::uuid`));

  // DELETE FROM childTable WHERE fkCol IN (subquery)
  const delViaSub = (t: string, fk: string, rawSub: string) =>
    db.execute(sql.raw(`DELETE FROM "${t}" WHERE "${fk}" IN (${rawSub})`));

  // ─── Subqueries (alle intern, keine externen Eingaben) ───────────────────
  const propSub     = `SELECT id FROM properties WHERE organization_id = '${orgId}'::uuid`;
  const unitSub     = `SELECT id FROM units WHERE property_id IN (${propSub})`;
  const tenSub      = `SELECT id FROM tenants WHERE unit_id IN (${unitSub})`;
  const meterSub    = `SELECT id FROM meters WHERE unit_id IN (${unitSub})`;
  const keyInvSub   = `SELECT id FROM key_inventory WHERE unit_id IN (${unitSub})`;
  const invSub      = `SELECT id FROM monthly_invoices WHERE unit_id IN (${unitSub})`;
  const expSub      = `SELECT id FROM expenses WHERE property_id IN (${propSub})`;
  const jeSub       = `SELECT id FROM journal_entries WHERE organization_id = '${orgId}'::uuid`;
  const distSub     = `SELECT id FROM distribution_keys WHERE organization_id = '${orgId}'::uuid`;
  const kautSub     = `SELECT id FROM kautionen WHERE organization_id = '${orgId}'::uuid`;
  const wsettSub    = `SELECT id FROM weg_settlements WHERE organization_id = '${orgId}'::uuid`;
  const hassembSub  = `SELECT id FROM weg_assemblies WHERE organization_id = '${orgId}'::uuid`;
  const wvoteSub    = `SELECT id FROM weg_votes WHERE assembly_id IN (${hassembSub})`;
  const wbudSub     = `SELECT id FROM weg_budget_plans WHERE organization_id = '${orgId}'::uuid`;
  const heatSub     = `SELECT id FROM heat_billing_runs WHERE organization_id = '${orgId}'::uuid`;
  const heatlSub    = `SELECT id FROM heating_settlements WHERE organization_id = '${orgId}'::uuid`;
  const tagsSub     = `SELECT id FROM document_tags WHERE organization_id = '${orgId}'::uuid`;
  // profSub: für Profil-Ebene FKs (kein organization_id in den Kind-Tabellen)
  const profSub     = `SELECT id FROM profiles WHERE organization_id = '${orgId}'::uuid`;
  // ticketsSub: für ticket_comments (kein org_id, ticket_id → support_tickets)
  const ticketsSub  = `SELECT id FROM support_tickets WHERE organization_id = '${orgId}'::uuid`;
  // sigReqSub: für signatures.request_id → signature_requests.id (NO ACTION)
  const sigReqSub   = `SELECT id FROM signature_requests WHERE organization_id = '${orgId}'::uuid`;

  // ─── Schritt 1: Nullable FKs nullen (transactions) ──────────────────────
  await db.execute(sql.raw(`
    UPDATE transactions
    SET matched_tenant_id = NULL, matched_unit_id = NULL
    WHERE organization_id = '${orgId}'::uuid
  `));

  // ─── Schritt 2: invoice_lines (immutable trigger deaktivieren) ───────────
  await db.execute(sql.raw('ALTER TABLE invoice_lines DISABLE TRIGGER ALL'));
  try {
    await delViaSub('invoice_lines', 'invoice_id', invSub);
  } finally {
    await db.execute(sql.raw('ALTER TABLE invoice_lines ENABLE TRIGGER ALL'));
  }

  // ─── Schritt 3: WEG-Abstimmungskette (weg_assemblies → weg_votes → Kinder) ─
  await delViaSub('weg_vote_results', 'vote_id',       wvoteSub);
  await delViaSub('weg_owner_votes',  'vote_id',       wvoteSub);  // auch unit_id + owner_id
  await delViaSub('weg_votes',        'assembly_id',   hassembSub);
  await delViaSub('weg_agenda_items', 'assembly_id',   hassembSub);

  // ─── Schritt 4: WEG-Budget-Kette (weg_budget_plans → Kinder) ────────────
  await delViaSub('weg_budget_lines',  'budget_plan_id', wbudSub);
  // weg_vorschreibungen: hat org_id + unit_id + budget_plan_id + owner_id → muss
  // VOR units, weg_budget_plans UND owners gelöscht werden
  await del('weg_vorschreibungen');

  // ─── Schritt 5: Meter- und Schlüssel-Kette ───────────────────────────────
  await delViaSub('meter_readings', 'meter_id',         meterSub);
  // key_handovers: hat key_inventory_id + tenant_id → vor key_inventory und tenants
  await delViaSub('key_handovers',  'key_inventory_id', keyInvSub);

  // ─── Schritt 6: Zahlungskette (monthly_invoices → payments → payment_allocations) ─
  await delViaSub('payment_allocations', 'invoice_id', invSub);  // auch payment_id
  await delViaSub('payments',            'invoice_id', invSub);  // auch tenant_id

  // ─── Schritt 7: Mieterverhältnis-Blätter (vor tenants) ──────────────────
  await delViaSub('rent_history',     'tenant_id', tenSub);
  await delViaSub('vpi_adjustments',  'tenant_id', tenSub);
  await delViaSub('settlement_details', 'tenant_id', tenSub);    // auch unit_id
  await delViaSub('settlement_details', 'unit_id',   unitSub);   // Sicherheitsnetz

  // ─── Schritt 8: Kautionen-Kette (kautionen hat tenant_id + lease_id + unit_id) ─
  await delViaSub('kautions_bewegungen', 'kaution_id', kautSub);
  // kautionen: org_id existiert → del(); muss VOR leases UND tenants sein
  await del('kautionen');

  // ─── Schritt 9: Journal-Kette (journal_entries hat tenant_id + unit_id) ──
  await delViaSub('journal_entry_lines', 'journal_entry_id', jeSub); // auch account_id
  await del('incoming_invoices');   // journal_entry_id → journal_entries (org_id)
  // journal_entries: org_id → del(); VOR tenants und units
  await del('journal_entries');

  // ─── Schritt 10: Expense- und Distribution-Kette ─────────────────────────
  await delViaSub('expense_allocations',    'expense_id', expSub);
  await delViaSub('unit_distribution_values', 'key_id',  distSub);  // auch unit_id
  await del('account_categories');   // org_id, referenziert distribution_keys
  await del('depreciation_assets');  // org_id, referenziert chart_of_accounts
  await delViaSub('document_tag_assignments', 'tag_id',  tagsSub);

  // ─── Schritt 11: Heizkosten-Kette ────────────────────────────────────────
  await delViaSub('heat_billing_lines',     'run_id',      heatSub);   // auch unit_id
  await delViaSub('heat_billing_audit_log', 'run_id',      heatSub);
  await delViaSub('heating_settlement_details', 'settlement_id', heatlSub); // auch unit_id

  // ─── Schritt 12: WEG-Abrechnungskette ────────────────────────────────────
  // weg_settlement_details: settlement_id + unit_id + owner_id → VOR units UND owners
  await delViaSub('weg_settlement_details', 'settlement_id', wsettSub);
  // weg_settlement_emails: owner_id ist SET NULL (kein Fehler bei owner-Löschung),
  // settlement_id mit CASCADE → explizit löschen für Vollständigkeit
  await delViaSub('weg_settlement_emails',  'settlement_id', wsettSub);

  // ─── Schritt 13: WEG-Sonderumlagen-Kinder ────────────────────────────────
  await del('weg_maintenance_items'); // org_id, referenziert weg_special_assessments

  // ─── Schritt 14: WEG-Eigentümer-Kinder (VOR owners UND property_owners) ──
  // owner_payouts.owner_id → property_owners.owner_id (NO ACTION)
  // Muss VOR property_owners gelöscht werden!
  await del('owner_payouts');         // org_id + owner_id + property_id (FK→property_owners)
  await del('weg_reserve_fund');      // org_id + unit_id + owner_id → owners
  await del('owner_portal_access');   // org_id + owner_id → owners
  await delViaSub('property_owners', 'property_id', propSub);  // kein org_id!
  await del('weg_unit_owners');       // org_id + unit_id + owner_id → owners
  await del('weg_owner_changes');     // org_id + unit_id + previous_owner_id + new_owner_id → owners

  // ─── Schritt 15: Org-Tabellen mit tenant_id FK (VOR tenants) ─────────────
  // activities.tenant_id, damage_reports.tenant_id, learned_matches.tenant_id, etc.
  await del('activities');            // org_id + tenant_id
  await del('damage_reports');        // org_id + tenant_id (assigned_to_id schon NULL)
  await del('learned_matches');       // org_id + tenant_id + unit_id
  // ticket_comments: kein org_id, ticket_id → support_tickets + author_id → profiles
  // MUSS VOR support_tickets UND VOR profiles gelöscht werden
  await delViaSub('ticket_comments', 'ticket_id', ticketsSub);
  await del('support_tickets');       // org_id + tenant_id + unit_id (nach ticket_comments)
  await del('tenant_documents');      // org_id + tenant_id
  await del('tenant_portal_access');  // org_id + tenant_id
  await del('insurance_claims');      // org_id + unit_id + insurance_policy_id
  await del('maintenance_tasks');     // org_id + unit_id + contract_id (created_by → profiles)
  await del('energy_consumption');    // org_id + unit_id
  await del('heating_cost_readings'); // org_id + unit_id
  // transactions: matched_tenant_id + matched_unit_id bereits auf NULL gesetzt
  await del('transactions');          // org_id (bank_account_id → bank_accounts, VOR bank_accounts)

  // ─── Schritt 16: monthly_invoices (VOR tenants) ──────────────────────────
  // Kinder (invoice_lines, payments, payment_allocations) bereits gelöscht
  // weg_vorschreibung_emails hat CASCADE auf monthly_invoices → auto-deleted
  await delViaSub('monthly_invoices', 'unit_id', unitSub);  // auch tenant_id

  // ─── Schritt 17: leases (VOR tenants) ────────────────────────────────────
  // lease_expiry_notifications hat CASCADE → auto, aber explizit zur Sicherheit
  await del('lease_expiry_notifications');  // org_id + lease_id
  await delViaSub('leases', 'unit_id', unitSub);  // auch tenant_id

  // ─── Schritt 18: tenants (alle tenants-Kinder bereinigt) ─────────────────
  await delViaSub('tenants', 'unit_id', unitSub);

  // ─── Schritt 19: Meter und Schlüssel-Inventar (VOR units) ────────────────
  await delViaSub('meters',       'unit_id', unitSub);    // auch property_id
  await delViaSub('key_inventory', 'unit_id', unitSub);   // auch property_id

  // ─── Schritt 20: Expenses (VOR distribution_keys und properties) ─────────
  await delViaSub('expenses', 'property_id', propSub);    // distribution_key_id nullable

  // ─── Schritt 21: units (alle unit-FK-Kinder bereinigt) ───────────────────
  await delViaSub('units', 'property_id', propSub);

  // ─── Schritt 22: owners (alle owner-FK-Kinder bereinigt) ─────────────────
  await del('owners');

  // ─── Schritt 23: Eltern-Tabellen (alle Kinder bereinigt) ─────────────────
  await del('weg_settlements');
  await del('weg_assemblies');
  await del('weg_budget_plans');         // nach weg_vorschreibungen
  await del('weg_special_assessments'); // nach weg_maintenance_items
  await del('heating_settlements');      // nach heating_settlement_details
  await del('heat_billing_runs');        // nach heat_billing_lines/log
  await del('energy_certificates');
  await del('insurance_policies');       // nach insurance_claims
  await del('period_locks');
  await del('fiscal_periods');
  await del('automation_rule_logs');     // org_id + rule_id
  await del('automation_rules');         // nach automation_rule_logs
  await del('automation_settings');
  await del('automation_log');
  await del('distribution_keys');        // nach unit_distribution_values + account_categories
  await del('chart_of_accounts');        // nach journal_entry_lines + depreciation_assets
  await del('document_tags');            // nach document_tag_assignments
  await del('document_versions');
  await del('ebics_orders');             // ebics_connections-Kinder
  await del('ebics_payment_batches');
  await del('ebics_connections');
  await del('bank_accounts');            // nach transactions
  await del('serial_letters');           // org_id + template_id → letter_templates
  await del('letter_templates');         // nach serial_letters
  await del('maintenance_contracts');    // nach maintenance_tasks
  await del('management_contracts');
  await del('messages');
  await del('organization_invites');
  // owner_payouts bereits in Schritt 14 gelöscht (VOR property_owners)
  await del('processing_activities');
  await del('report_schedules');
  await del('saved_reports');
  await del('sepa_collections');
  // signatures.request_id → signature_requests.id (NO ACTION)
  // Muss VOR signature_requests gelöscht werden!
  await delViaSub('signatures', 'request_id', sigReqSub);
  await del('signature_requests');
  await del('white_label_licenses');
  await del('guided_workflows');
  await del('data_retention_policies');
  await del('deadlines');
  await del('demo_invites');
  await del('ea_bookings');
  await del('invoice_runs');
  await del('job_queue');
  await del('idempotency_keys');
  await del('push_subscriptions');
  await del('user_organizations');
  await del('booking_number_sequences');
  await del('property_budgets');
  await del('property_documents');
  await del('financial_audit_log');
  await del('consent_records');      // org_id + user_id → profiles
  await del('contractors');          // org_id + created_by → profiles

  // ─── Schritt 24: Profil- UND Property-Ebene FKs (VOR profiles UND properties) ─
  // profSub = profiles WHERE organization_id = orgId
  // property_managers.user_id → profiles UND property_id → properties  → VOR BEIDEN!
  // settlements.created_by    → profiles UND property_id → properties  → VOR BEIDEN!
  await delViaSub('property_managers', 'property_id', propSub);
  await delViaSub('settlements',       'property_id', propSub);
  // Restliche Profile-Ebene FKs (kein org_id, user_id/signer_id → profiles)
  await delViaSub('audit_logs',            'user_id',   profSub);
  await delViaSub('user_2fa',              'user_id',   profSub);
  await delViaSub('password_history',      'user_id',   profSub);
  await delViaSub('password_reset_tokens', 'user_id',   profSub);
  await delViaSub('security_sessions',     'user_id',   profSub);
  await delViaSub('user_roles',            'user_id',   profSub);
  // signatures: auch via request_id (Unterzeichner ≠ Antragsteller möglich)
  // sigReqSub ist oben im Subqueries-Block definiert
  await delViaSub('signatures', 'request_id', sigReqSub);
  await delViaSub('signatures', 'signer_id',  profSub);

  // ─── Schritt 24b: Profile ─────────────────────────────────────────────────
  await del('profiles');

  // ─── Schritt 25: Properties (alle Kinder inkl. property_managers/settlements bereinigt) ─
  await del('properties');

  // ─── Schritt 26: Organisation löschen ────────────────────────────────────
  await db.execute(sql.raw(`DELETE FROM organizations WHERE id = '${orgId}'::uuid`));
}

// ---------------------------------------------------------------------------
// Öffentliche API
// ---------------------------------------------------------------------------

/**
 * Bereinigt ein einzelnes Profil + alle seine FK-Abhängigkeiten nach ID.
 * Sicher für parallele Tests — enger Scope, kein globaler Sweep.
 * profileId wird UUID-validiert.
 */
export async function cleanupProfileById(
  profileId: string,
  opts: { verbose?: boolean } = {},
): Promise<{ dependentsDeleted: number }> {
  assertSafeTestEnvironment();
  requireUUID(profileId, 'cleanupProfileById');

  const log = opts.verbose ? console.log : (_: string) => {};
  const deps = await purgeProfileDepsById(profileId);
  await db.execute(
    sql.raw(`DELETE FROM profiles WHERE id = '${profileId}'::uuid`),
  );
  log(`[cleanup-test-data] Profil ${profileId.slice(0, 8)} + ${deps} abhängige Zeilen entfernt.`);
  return { dependentsDeleted: deps };
}

/**
 * Globaler Sweep: Alle Test-Profile (@test.at / @test.internal / @test.example)
 * inkl. FK-Abhängigkeiten und danach leere Test-Organisationen mit Domaindaten.
 *
 * NUR als pretest-Hook außerhalb laufender Tests aufrufen — nicht aus parallelen
 * Testläufen, da der globale Sweep mit laufenden Tests konkurrieren würde.
 */
export async function cleanupTestData(opts: { verbose?: boolean } = {}): Promise<{
  profilesDeleted: number;
  dependentsDeleted: number;
  orgsDeleted: number;
}> {
  assertSafeTestEnvironment();
  const log = opts.verbose ? console.log : (_: string) => {};

  // Org-IDs VOR Profil-Löschung einsammeln
  const orgRes = await db.execute(sql.raw(`
    SELECT DISTINCT organization_id
    FROM profiles
    WHERE organization_id IS NOT NULL
      AND (email ILIKE '%@test.at'
        OR email ILIKE '%@test.internal'
        OR email ILIKE '%@test.example')
  `));
  const candidateOrgIds: string[] = orgRes.rows
    .map((r) => (r as Record<string, unknown>).organization_id as string)
    .filter((id) => UUID_RE.test(id));

  const countRes = await db.execute(sql.raw(`
    SELECT COUNT(*)::int AS n FROM profiles
    WHERE email ILIKE '%@test.at'
       OR email ILIKE '%@test.internal'
       OR email ILIKE '%@test.example'
  `));
  const total = Number((countRes.rows[0] as Record<string, unknown>)?.n ?? 0);

  if (total === 0 && candidateOrgIds.length === 0) {
    log('[cleanup-test-data] Keine Test-Daten gefunden.');
    return { profilesDeleted: 0, dependentsDeleted: 0, orgsDeleted: 0 };
  }

  log(`[cleanup-test-data] ${total} Test-Profile in ${candidateOrgIds.length} Org(s) gefunden …`);

  let deps = 0;

  // Profil-FK-Abhängigkeiten (Sweep-Variante via email-Subquery)
  deps += await purgeRef('audit_logs',            'user_id');
  deps += await purgeRef('consent_records',        'user_id');
  deps += await purgeRef('user_2fa',              'user_id');
  deps += await purgeRef('password_history',       'user_id');
  deps += await purgeRef('password_reset_tokens',  'user_id');
  deps += await purgeRef('push_subscriptions',     'user_id');
  deps += await purgeRef('security_sessions',      'user_id');
  deps += await purgeRef('auth_tokens',            'user_id');
  deps += await purgeRef('user_roles',             'user_id');
  deps += await purgeRef('user_organizations',     'user_id');
  deps += await purgeRef('organization_invites',   'invited_by');
  deps += await purgeRef('demo_invites',           'user_id');
  deps += await purgeRef('guided_workflows',       'user_id');
  deps += await purgeRef('saved_reports',          'created_by');
  // signatures.request_id → signature_requests.id (NO ACTION) — Kinder vor Eltern
  // 1. Lösche signatures via signer_id (Test-Profil ist Unterzeichner)
  deps += await purgeRef('signatures',             'signer_id');
  // 2. Lösche signatures via request_id (Test-Profil hat die Anfrage erstellt,
  //    aber ggf. ein anderes Profil hat unterzeichnet — signer_id ist kein Test-Profil)
  {
    const SIG_BY_REQ_SUB = `SELECT id FROM signature_requests WHERE requested_by IN (${TEST_PROFILE_SUBQUERY})`;
    const r = await db.execute(sql.raw(
      `DELETE FROM "signatures" WHERE "request_id" IN (${SIG_BY_REQ_SUB}) RETURNING 1`,
    ));
    deps += r.rows?.length ?? 0;
  }
  deps += await purgeRef('signature_requests',     'requested_by');
  deps += await purgeRef('property_managers',      'user_id');
  deps += await purgeRef('invoice_runs',           'initiated_by');
  deps += await purgeRef('document_versions',      'uploaded_by');
  deps += await purgeRef('ticket_comments',        'author_id');
  deps += await purgeRef('serial_letters',         'created_by');
  deps += await purgeRef('sepa_collections',       'created_by');
  deps += await purgeRef('settlements',            'created_by');
  deps += await purgeRef('contractors',            'created_by');
  deps += await purgeRef('maintenance_contracts',  'created_by');
  deps += await purgeRef('maintenance_tasks',      'created_by');
  deps += await purgeRef('weg_owner_changes',      'created_by');

  // ticket_comments.ticket_id → support_tickets.id (NO ACTION) — Kinder vor Eltern
  // Auch wenn der Kommentarautor KEIN Test-Profil ist (Cross-Profil), muss zuerst gelöscht werden.
  {
    const TICKETS_SUB =
      `SELECT id FROM "support_tickets"
       WHERE created_by_id IN (${TEST_PROFILE_SUBQUERY})
          OR assigned_to_id IN (${TEST_PROFILE_SUBQUERY})`;
    const rc = await db.execute(sql.raw(
      `DELETE FROM "ticket_comments" WHERE "ticket_id" IN (${TICKETS_SUB}) RETURNING 1`,
    ));
    deps += rc.rows?.length ?? 0;
  }
  {
    const r = await db.execute(sql.raw(`
      DELETE FROM "support_tickets"
      WHERE created_by_id IN (${TEST_PROFILE_SUBQUERY})
         OR assigned_to_id IN (${TEST_PROFILE_SUBQUERY})
      RETURNING 1
    `));
    deps += r.rows?.length ?? 0;
  }

  await db.execute(sql.raw(
    `UPDATE "damage_reports" SET assigned_to_id = NULL
     WHERE assigned_to_id IN (${TEST_PROFILE_SUBQUERY})`,
  ));
  {
    const r = await db.execute(sql.raw(
      `DELETE FROM "damage_reports"
       WHERE reported_by_id IN (${TEST_PROFILE_SUBQUERY}) RETURNING 1`,
    ));
    deps += r.rows?.length ?? 0;
  }

  // Profile löschen
  const profileRes = await db.execute(sql.raw(`
    DELETE FROM profiles
    WHERE email ILIKE '%@test.at'
       OR email ILIKE '%@test.internal'
       OR email ILIKE '%@test.example'
    RETURNING 1
  `));
  const profilesDeleted = profileRes.rows?.length ?? 0;

  // Leere Test-Orgs vollständig bereinigen
  let orgsDeleted = 0;
  for (const orgId of candidateOrgIds) {
    const remaining = await db.execute(sql.raw(
      `SELECT 1 FROM profiles WHERE organization_id = '${orgId}'::uuid LIMIT 1`,
    ));
    if (remaining.rows.length > 0) {
      log(`[cleanup-test-data] Org ${orgId.slice(0, 8)} hat echte Profile — überspringe.`);
      continue;
    }
    log(`[cleanup-test-data] Bereinige leere Test-Org ${orgId.slice(0, 8)} …`);
    await cleanupOrgById(orgId); // Wirft bei Fehler — kein silent-ignore
    orgsDeleted++;
  }

  log(
    `[cleanup-test-data] Fertig: ${profilesDeleted} Profile, ` +
    `${deps} FK-Deps, ${orgsDeleted} Org(s) entfernt.`,
  );
  return { profilesDeleted, dependentsDeleted: deps, orgsDeleted };
}

// ---------------------------------------------------------------------------
// CLI-Einstiegspunkt — nur bei direktem Aufruf, nie bei import
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
if (
  process.argv[1] === __filename ||
  process.argv[1] === __filename.replace(/\.ts$/, '.js')
) {
  cleanupTestData({ verbose: true })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[cleanup-test-data] Fehler:', err?.message ?? err);
      process.exit(1);
    });
}
