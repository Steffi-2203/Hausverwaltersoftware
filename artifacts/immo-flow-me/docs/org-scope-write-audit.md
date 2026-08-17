# Org-Scope-Audit: UPDATE/DELETE-Pfade (Task #118, Verifikation nach #76)

Stand: 2026-08-17. Systematische Durchsicht aller `db.update(` / `db.delete(` /
raw-`UPDATE`/`DELETE`-Aufrufe in `server/**` (~176 Fundstellen).

## Schutzmodell (zwei Schichten)

1. **RLS (wirksame Schranke):** Alle Route-Handler laufen unter `rlsMiddleware`
   (`SET ROLE immo_app` + `app.current_org`). Der `db`-Proxy ist dadurch
   org-gebunden — ein Write auf eine Fremd-Org-Zeile trifft 0 Zeilen,
   unabhängig vom Handler-Code. Nachweis: `tests/unit/rls-fail-closed.test.ts`,
   `tests/unit/owners-invoices-cross-org-write.test.ts`.
2. **Expliziter Org-Filter (Defense-in-Depth, Projektstandard seit #76):**
   Jeder Write auf org-gebundenen Tabellen trägt zusätzlich
   `eq(table.organizationId, orgId)` bzw. eine Parent-Chain-Subquery
   (tenant→unit→property→organization), damit ein künftiger Codepfad ohne
   RLS-Kontext (rootDb, Hintergrundjob, Test) nicht ungeschützt ist.

## In diesem Task geschlossene Lücken (vorher nur RLS)

Routen (`server/routes.ts`, `routes/financeRoutes.ts`, `routes/queryBuilderRoutes.ts`, `routes/adminRoutes.ts`):
- owners PATCH; monthly_invoices Mahnwesen (Send + Check-Loop, Parent-Chain);
  key_inventory PATCH + Handover (Parent-Chain, inkl. 403-Guard);
  report_schedules (Scheduler); property_owners PATCH/DELETE (Parent-Chain);
  saved_reports; tenant_portal_access / owner_portal_access (Parent-Chain, da
  organization_id dort nullable ist).

Services (`server/services/**`, `server/functions.ts`):
- rulesEngineService payments (Parent-Chain); automatedDunningService
  monthly_invoices (Parent-Chain); functions.ts send-dunning (Org aus
  Session-Profil, 403 wenn fehlt) + maintenance_contracts (self-consistent);
  gdprService tenants-Anonymisierung (Parent-Chain); wegSettlementEmailService
  weg_settlements; kautionService (calculateInterest/initiateReturn/
  completeReturn nehmen jetzt organizationId und binden den FOR-UPDATE-SELECT
  org-gebunden — Routen übergeben ctx.orgId); paymentService raw-SQL
  monthly_invoices/payments (`AND tenant_id = …`).

  Wichtig: monthly_invoices-Scopes verwenden einheitlich die kanonische Kette
  `invoice.unit_id → unit → property` (identisch zum RLS-Modell), nicht die
  Tenant-Kette — bei inkonsistenten Daten (Tenant und Unit in verschiedenen
  Orgs) bleibt der Write fail-closed.

## Bereits zuvor korrekt (Beispiele, unverändert)

- ebicsService (connScope), leaseService (Unit-Subquery), kautionService-Create,
  periodLockService, heatingSettlementRoutes (Subquery, #139), wegRoutes-Kern,
  financeRoutes heatingCostReadings/ownerPayouts/sepaCollections,
  propertyBudgets, wegAccountingService special_assessments,
  storage.distributionKeyScope / bankAccounts-Scope (mit orgId-Aufrufern),
  kautionRoutes PATCH, propertyDocuments/tenantDocuments DELETE.

## Dokumentierte Ausnahmen (bewusst ohne Org-Filter)

- **Globale/technische Tabellen:** sessions, `_sql_migrations`, `job_queue`
  (Worker, ORG_POLICY_EXCLUDES), audit_logs/audit_chain_anchor (system-global),
  vpi_values (global, Referenzchecks bewusst cross-org via rootDb),
  user_roles (keine organization_id).
- **Boot-/Wartungsjobs mit rootDb:** `lib/migrateFieldEncryption.ts`,
  `lib/rotateFieldEncryption.ts` — iterieren bewusst über alle Orgs (Zeilen
  werden per Full-Scan gelesen und per PK zurückgeschrieben); Migrations-/
  Rotationskontext, kein Request-Pfad.
- **Org-Verwaltung/Selbstverwaltung:** organizations-Updates in Admin-Flows,
  userOrganizations/profiles-Updates bei Org-Wechsel (operieren naturgemäß
  org-übergreifend auf eigenen Account-Daten).
- **storage.ts „nur RLS"-Pfade:** storage-Funktionen ohne orgId-Parameter
  werden ausschließlich über org-gebundenen Kontext (`db`-Proxy) aufgerufen;
  kritische Funktionen (bankAccounts, distributionKeys) haben zusätzlich
  optionale orgId-Scopes, die alle Routen-Aufrufer übergeben.
- **retestService:** Test-Harness, löscht nur selbst erzeugte IDs.

## Testabdeckung Cross-Org-Writes (kritische Ressourcen)

| Ressource | Test |
|---|---|
| Properties, Tenants, PropertyManagers, DistributionKeys | `write-cross-org.test.ts` |
| Leases, BankAccounts, EBICS, Kautionen, DistributionKeys (Service-Ebene) | `service-org-scope.test.ts` |
| Payments | `payments-cross-org.test.ts` |
| Owners, MonthlyInvoices | `owners-invoices-cross-org-write.test.ts` (neu) |
| Heizkostenabrechnung | `heating-settlement-cross-org.test.ts` |
| RLS fail-closed generisch | `rls-fail-closed.test.ts` |
