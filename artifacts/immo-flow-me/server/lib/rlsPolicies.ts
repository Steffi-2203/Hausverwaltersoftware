import { pool } from "../db";
import { logger } from "./logger";

/**
 * Audit-Befund K1: Früher waren nur 2 Tabellen direkt und 7 abgeleitet
 * geschützt — bei 119 Tabellen im Schema. Die Liste wird jetzt zur Laufzeit
 * aus information_schema ermittelt: jede Tabelle mit einer Spalte
 * organization_id bekommt eine Isolations-Policy.
 */
const TABLES_WITH_ORG_ID_FALLBACK = [
  "properties",
  "journal_entries",
];

/**
 * Tabellen, die bewusst organisationsübergreifend lesbar bleiben.
 * - organizations, user_sessions, _sql_migrations: Systemtabellen ohne Mandantendaten.
 * - job_queue: systemübergreifende Job-Verwaltung; Org-Scope via Payload.
 *
 * tenant_portal_access / owner_portal_access sind hier ebenfalls gelistet,
 * bekommen aber unten (Step 5) eigene, strengere Policies: Org-Isolation
 * PLUS Selbst-Isolation für Portal-Sessions (app.current_tenant/app.current_owner).
 * Der Auth-Bootstrap (Login, Invite, Portal-Middleware) läuft über rootDb
 * (BYPASSRLS) und bleibt davon unberührt.
 */
const ORG_POLICY_EXCLUDES = new Set([
  "organizations",
  "user_sessions",
  "_sql_migrations",
  "tenant_portal_access",
  "owner_portal_access",
  "job_queue",
  // chart_of_accounts: bekommt unten eine eigene NULL-org-bewusste Policy.
]);

async function discoverOrgTables(client: any): Promise<string[]> {
  const result = await client.query(`
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'organization_id'
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name
  `);
  const found = result.rows.map((r: any) => r.table_name).filter((t: string) => !ORG_POLICY_EXCLUDES.has(t));
  return found.length > 0 ? found : TABLES_WITH_ORG_ID_FALLBACK;
}

/**
 * NULLIF-Wrapper: wenn app.current_org nicht gesetzt ist, gibt current_setting ''
 * zurück. NULLIF('', '') → NULL, und NULL::uuid → NULL, sodass
 * organization_id = NULL immer false ist → fail-closed, kein Cast-Fehler.
 */
const ORG_SETTING = `NULLIF(current_setting('app.current_org', true), '')::uuid`;

const TABLES_VIA_PROPERTY = [
  {
    table: "units",
    condition: `property_id IN (SELECT id FROM properties WHERE organization_id = ${ORG_SETTING})`,
  },
  {
    table: "settlements",
    condition: `property_id IN (SELECT id FROM properties WHERE organization_id = ${ORG_SETTING})`,
  },
];

const TABLES_VIA_UNIT = [
  {
    table: "tenants",
    condition: `unit_id IN (SELECT u.id FROM units u JOIN properties p ON u.property_id = p.id WHERE p.organization_id = ${ORG_SETTING})`,
  },
  {
    table: "monthly_invoices",
    condition: `unit_id IN (SELECT u.id FROM units u JOIN properties p ON u.property_id = p.id WHERE p.organization_id = ${ORG_SETTING})`,
  },
  {
    table: "leases",
    condition: `unit_id IN (SELECT u.id FROM units u JOIN properties p ON u.property_id = p.id WHERE p.organization_id = ${ORG_SETTING})`,
  },
];

const TABLES_VIA_TENANT = [
  {
    table: "payments",
    condition: `tenant_id IN (SELECT t.id FROM tenants t JOIN units u ON t.unit_id = u.id JOIN properties p ON u.property_id = p.id WHERE p.organization_id = ${ORG_SETTING})`,
  },
  {
    table: "payment_allocations",
    condition: `payment_id IN (SELECT py.id FROM payments py JOIN tenants t ON py.tenant_id = t.id JOIN units u ON t.unit_id = u.id JOIN properties p ON u.property_id = p.id WHERE p.organization_id = ${ORG_SETTING})`,
  },
];

/**
 * Tabellen, die keinen eigenen organization_id-Spalte haben und deren Org-Zugehörigkeit
 * über einen JOIN zur Elterntabelle (heating_settlements) ermittelt wird.
 * Policy: EXISTS-Subquery analog zu portalbezogenen Policies.
 */
const TABLES_VIA_HEATING_SETTLEMENT = [
  {
    table: "heating_settlement_details",
    condition: `EXISTS (SELECT 1 FROM heating_settlements hs WHERE hs.id = settlement_id AND hs.organization_id = ${ORG_SETTING})`,
  },
];

async function tableExists(client: any, tableName: string): Promise<boolean> {
  const result = await client.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)`,
    [tableName]
  );
  return result.rows[0].exists;
}

async function policyExists(client: any, tableName: string, policyName: string): Promise<boolean> {
  const result = await client.query(
    `SELECT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 AND policyname = $2)`,
    [tableName, policyName]
  );
  return result.rows[0].exists;
}

async function enableRLS(client: any, tableName: string): Promise<void> {
  // FORCE ROW LEVEL SECURITY macht den Table-Owner ebenfalls RLS-pflichtig.
  // Ohne FORCE bleibt der Owner (= App-User in Replit) immun gegen eigene Policies.
  await client.query(`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY`);
  await client.query(`ALTER TABLE ${tableName} FORCE ROW LEVEL SECURITY`);
  logger.info(`RLS enabled (FORCE) on ${tableName}`);
}

/**
 * Erstellt oder aktualisiert eine Isolations-Policy.
 * ALTER statt CREATE wenn die Policy bereits existiert — damit bestehende
 * Datenbanken die NULLIF-Bedingung (fail-closed) bekommen ohne DROP/CREATE.
 */
async function upsertPolicy(
  client: any,
  tableName: string,
  policyName: string,
  using: string
): Promise<void> {
  const exists = await policyExists(client, tableName, policyName);
  if (exists) {
    await client.query(
      `ALTER POLICY ${policyName} ON ${tableName} USING (${using})`
    );
    logger.info(`Policy ${policyName} updated on ${tableName}`);
  } else {
    await client.query(
      `CREATE POLICY ${policyName} ON ${tableName} AS PERMISSIVE FOR ALL USING (${using})`
    );
    logger.info(`Policy ${policyName} created on ${tableName}`);
  }
}

/**
 * Entfernt alle bypass_rls_*-Policies aus der Datenbank.
 * Diese Policies öffneten bei fehlendem app.current_org alle Zeilen (fail-open).
 * Nach dem Entfernen gibt ein nicht gesetzter Org-Kontext 0 Zeilen zurück (fail-closed).
 */
async function dropBypassPolicies(client: any): Promise<void> {
  const result = await client.query(
    `SELECT tablename, policyname FROM pg_policies
     WHERE schemaname = 'public' AND policyname LIKE 'bypass_rls_%'`
  );
  for (const row of result.rows) {
    await client.query(`DROP POLICY IF EXISTS "${row.policyname}" ON "${row.tablename}"`);
    logger.info(`Dropped bypass policy ${row.policyname} on ${row.tablename}`);
  }
  if (result.rows.length === 0) {
    logger.info("No bypass policies found to drop");
  } else {
    logger.info(`Dropped ${result.rows.length} bypass_rls_* policies`);
  }
}

export async function setupRLS(): Promise<void> {
  const client = await pool.connect();
  try {
    // Step 1: Remove all bypass (fail-open) policies.
    await dropBypassPolicies(client);

    const TABLES_WITH_ORG_ID = await discoverOrgTables(client);
    logger.info(`RLS: ${TABLES_WITH_ORG_ID.length} Tabellen mit organization_id gefunden`);

    const allTables = [
      ...TABLES_WITH_ORG_ID,
      ...TABLES_VIA_PROPERTY.map((t) => t.table),
      ...TABLES_VIA_UNIT.map((t) => t.table),
      ...TABLES_VIA_TENANT.map((t) => t.table),
      ...TABLES_VIA_HEATING_SETTLEMENT.map((t) => t.table),
    ];

    // Step 2: Enable RLS on all relevant tables (idempotent).
    for (const tableName of allTables) {
      const exists = await tableExists(client, tableName);
      if (!exists) {
        logger.warn(`Table ${tableName} does not exist, skipping RLS setup`);
        continue;
      }
      // Fatal: ein Fehler beim ENABLE/FORCE schlägt den gesamten Boot-Vorgang fehl.
      // Eine Tabelle deren RLS nicht aktiviert werden kann darf den Server
      // nicht ohne Schutz starten lassen (fail-closed).
      await enableRLS(client, tableName);
    }

    // Step 3: Upsert isolation policies with NULLIF (fail-closed).
    for (const tableName of TABLES_WITH_ORG_ID) {
      if (!(await tableExists(client, tableName))) continue;
      await upsertPolicy(
        client,
        tableName,
        `org_isolation_${tableName}`,
        `organization_id = ${ORG_SETTING}`
      );
    }

    for (const { table, condition } of TABLES_VIA_PROPERTY) {
      if (!(await tableExists(client, table))) continue;
      await upsertPolicy(client, table, `org_isolation_${table}`, condition);
    }

    for (const { table, condition } of TABLES_VIA_UNIT) {
      if (!(await tableExists(client, table))) continue;
      await upsertPolicy(client, table, `org_isolation_${table}`, condition);
    }

    for (const { table, condition } of TABLES_VIA_TENANT) {
      if (!(await tableExists(client, table))) continue;
      await upsertPolicy(client, table, `org_isolation_${table}`, condition);
    }

    for (const { table, condition } of TABLES_VIA_HEATING_SETTLEMENT) {
      if (!(await tableExists(client, table))) continue;
      await upsertPolicy(client, table, `org_isolation_${table}`, condition);
    }

    // Step 4.5: Portal-Zugangstabellen — Org-Isolation + Selbst-Isolation.
    // Admin-Sessions (nur app.current_org gesetzt) sehen alle Zeilen der Org.
    // Portal-Sessions setzen zusätzlich app.current_tenant/app.current_owner
    // und sehen dann NUR die eigene Zeile (tenant_id/owner_id-Match).
    // Auth-Bootstrap (Login, Invite-Token, Portal-Middleware) läuft über rootDb
    // (BYPASSRLS) und ist nicht betroffen. Fail-closed: ohne jeden Kontext 0 Zeilen.
    const TENANT_SETTING = `NULLIF(current_setting('app.current_tenant', true), '')::uuid`;
    const OWNER_SETTING = `NULLIF(current_setting('app.current_owner', true), '')::uuid`;
    if (await tableExists(client, "tenant_portal_access")) {
      await enableRLS(client, "tenant_portal_access");
      await upsertPolicy(
        client,
        "tenant_portal_access",
        "org_isolation_tenant_portal_access",
        `organization_id = ${ORG_SETTING} AND (${TENANT_SETTING} IS NULL OR tenant_id = ${TENANT_SETTING})`
      );
    }
    if (await tableExists(client, "owner_portal_access")) {
      await enableRLS(client, "owner_portal_access");
      await upsertPolicy(
        client,
        "owner_portal_access",
        "org_isolation_owner_portal_access",
        `organization_id = ${ORG_SETTING} AND (${OWNER_SETTING} IS NULL OR owner_id = ${OWNER_SETTING})`
      );
    }

    // Step 4: chart_of_accounts — NULL-org-bewusste Policy.
    // Systemkonten (organization_id IS NULL) bleiben org-übergreifend lesbar;
    // org-spezifische Konten sind nur für die eigene Organisation sichtbar.
    if (await tableExists(client, "chart_of_accounts")) {
      await enableRLS(client, "chart_of_accounts");
      await upsertPolicy(
        client,
        "chart_of_accounts",
        "org_isolation_chart_of_accounts",
        `organization_id = ${ORG_SETTING} OR organization_id IS NULL`
      );
      logger.info("RLS: chart_of_accounts — NULL-org-aware policy applied");
    }

    logger.info("RLS setup completed successfully (fail-closed)");
  } catch (err: any) {
    logger.error(`RLS setup failed: ${err.message}`);
    throw err; // fatal — caller must not silently continue
  } finally {
    client.release();
  }
}
