/**
 * Schützt die Route-Schicht davor, den Superuser-Pool versehentlich zu nutzen.
 *
 * `db` ist innerhalb eines Org-Kontexts an `immo_app`/RLS gebunden. Dagegen
 * umgehen `rootDb` und `pool` die RLS-Regeln. Auch `appPool` wird hier erfasst:
 * Er ist zwar nicht privilegiert, öffnet aber einen manuellen RLS-Kontext und
 * muss deshalb auf die zwei Portal-Middlewares beschränkt bleiben.
 *
 * Jede Ausnahmestelle steht mit Begründung in der Allowlist. Die
 * Referenzanzahl ist absichtlich Teil der Prüfung: Ein zusätzlicher Query über
 * eine bereits erlaubte Import-Bindung verlangt damit ebenfalls eine bewusste
 * Aktualisierung der Allowlist.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, test } from "node:test";
import * as ts from "typescript";

type SensitiveDbHandle = "rootDb" | "pool" | "appPool" | "appDb";

interface AllowlistedAccess {
  file: string;
  imported: SensitiveDbHandle;
  local: string;
  expectedReferences: number;
  reason: string;
}

/**
 * Jede Route, die einen nicht standardmäßigen DB-Handle importiert, braucht
 * einen eng gefassten Grund. Neue Einträge sind Sicherheitsentscheidungen,
 * keine reine Testpflege.
 */
const ROUTE_DB_ACCESS_ALLOWLIST: readonly AllowlistedAccess[] = [
  {
    file: "auth.ts",
    imported: "rootDb",
    local: "db",
    expectedReferences: 44,
    reason:
      "Der zentrale Login-, Passwort- und Session-Bootstrap verarbeitet Auth-Tabellen vor einem Organisationskontext; alle Organisationsdaten werden daraus erst nach erfolgreicher Authentifizierung abgeleitet.",
  },
  {
    file: "helpers.ts",
    imported: "rootDb",
    local: "rootDb",
    expectedReferences: 2,
    reason:
      "Liest das Profil und die Rollen ausschließlich für die bereits authentifizierte Session, bevor ein Handler daraus seinen Organisationskontext ableitet.",
  },
  {
    file: "index.ts",
    imported: "pool",
    local: "pool",
    expectedReferences: 5,
    reason:
      "Der Server-Start verdrahtet den Pool ausschließlich für Session-/Bearer-Hydration sowie die nicht organisationsgebundenen Gesundheitschecks; fachliche Route-Datenzugriffe bleiben am RLS-gebundenen db-Pfad.",
  },
  {
    file: "routes.ts",
    imported: "rootDb",
    local: "rootDb",
    expectedReferences: 12,
    reason:
      "Das weiterhin aktive Legacy-Routing ermittelt globale Organisationen und verarbeitet Portal-Einladungen vor einem Organisationskontext; alle übrigen tenantgebundenen Handler verwenden den RLS-gebundenen db-Pfad.",
  },
  {
    file: "ownerAuthRoutes.ts",
    imported: "rootDb",
    local: "db",
    expectedReferences: 9,
    reason:
      "Enthält den Auth-Bootstrap auf der von Organisations-RLS ausgenommenen Portalzugangstabelle sowie den Legacy-Invite-Pfad, der die Session-Organisation vor jedem Zugriff selbst prüft.",
  },
  {
    file: "ownerPortalRoutes.ts",
    imported: "rootDb",
    local: "rootDb",
    expectedReferences: 2,
    reason:
      "Liest genau den Portalzugang, um dessen Organisation vor dem Aufbau des RLS-Kontexts zu bestimmen oder gegen einen bestehenden Kontext abzugleichen.",
  },
  {
    file: "ownerPortalRoutes.ts",
    imported: "appPool",
    local: "appPool",
    expectedReferences: 1,
    reason:
      "Erstellt für eine reine Eigentümer-Portal-Session eine immo_app-Verbindung mit gesetztem Organisations- und Eigentümerkontext.",
  },
  {
    file: "plaintextIbanGuardRoutes.ts",
    imported: "rootDb",
    local: "rootDb",
    expectedReferences: 1,
    reason:
      "Der read-only Klartext-IBAN-Scan muss alle Organisationen prüfen und ist zusätzlich auf die konfigurierte Plattform-Administration beschränkt.",
  },
  {
    file: "securityRoutes.ts",
    imported: "rootDb",
    local: "rootDb",
    expectedReferences: 1,
    reason:
      "Liest die globale, nicht organisationsgebundene Audit-Log-Tabelle für den geschützten Sicherheitsverletzungs-Endpunkt.",
  },
  {
    file: "tenantAuthRoutes.ts",
    imported: "rootDb",
    local: "db",
    expectedReferences: 9,
    reason:
      "Enthält den Auth-Bootstrap auf der von Organisations-RLS ausgenommenen Portalzugangstabelle sowie den Legacy-Invite-Pfad, der die Session-Organisation vor jedem Zugriff selbst prüft.",
  },
  {
    file: "tenantPortalRoutes.ts",
    imported: "rootDb",
    local: "rootDb",
    expectedReferences: 2,
    reason:
      "Liest genau den Portalzugang, um dessen Organisation vor dem Aufbau des RLS-Kontexts zu bestimmen oder gegen einen bestehenden Kontext abzugleichen.",
  },
  {
    file: "tenantPortalRoutes.ts",
    imported: "appPool",
    local: "appPool",
    expectedReferences: 1,
    reason:
      "Erstellt für eine reine Mieter-Portal-Session eine immo_app-Verbindung mit gesetztem Organisations- und Mieterkontext.",
  },
  {
    file: "twoFactorRoutes.ts",
    imported: "rootDb",
    local: "db",
    expectedReferences: 27,
    reason:
      "2FA-Setup, staged Enrollment und Magic-Login laufen vor einem Org-Kontext und bearbeiten nur Auth-Tabellen, die an die Session-User-ID gebunden sind.",
  },
  {
    file: "vpiRoutes.ts",
    imported: "rootDb",
    local: "rootDb",
    expectedReferences: 2,
    reason:
      "Die beiden Referenzchecks beim Löschen eines globalen VPI-Werts müssen Verwendungen in allen Organisationen sehen, damit keine fremde Referenz übersehen wird.",
  },
  { file: "lib/auditLog.ts", imported: "rootDb", local: "db", expectedReferences: 7, reason: "Schreibt den globalen, manipulationsgeschützten Audit-Trail für sicherheitsrelevante Request-Ereignisse." },
  { file: "lib/ensureIndexes.ts", imported: "rootDb", local: "db", expectedReferences: 4, reason: "Prüft und ergänzt technische Datenbankindizes für den globalen Serverbetrieb außerhalb einer einzelnen Organisation." },
  { file: "lib/fullTextSearch.ts", imported: "pool", local: "pool", expectedReferences: 2, reason: "Führt die technische Volltextsuche auf dem globalen Suchindex aus und filtert Ergebnisse anschließend fachlich." },
  { file: "lib/migrateFieldEncryption.ts", imported: "rootDb", local: "rootDb", expectedReferences: 24, reason: "Migriert und verifiziert verschlüsselte Felder global vor dem Boot, damit ein geänderter Schlüssel keine Bestandsdaten unbemerkt unlesbar macht." },
  { file: "lib/populateAuditIntegrityQueue.ts", imported: "pool", local: "pool", expectedReferences: 1, reason: "Initialisiert die globale Warteschlange für Audit-Integritätsprüfungen beim Serverstart." },
  { file: "lib/rlsPolicies.ts", imported: "pool", local: "pool", expectedReferences: 1, reason: "Verwaltet die datenbankweiten RLS-Policies als Bootstrapping-Aufgabe außerhalb von Fachrouten." },
  { file: "lib/rotateFieldEncryption.ts", imported: "rootDb", local: "rootDb", expectedReferences: 3, reason: "Rotiere Verschlüsselung global über alle geschützten Datensätze, unabhängig von einem Request-Organisationskontext." },
  { file: "lib/runSqlMigrations.ts", imported: "pool", local: "pool", expectedReferences: 2, reason: "Führt globale SQL-Migrationen beim Start aus und ist keine organisationsgebundene Fachabfrage." },
  { file: "lib/sessionInvalidation.ts", imported: "rootDb", local: "rootDb", expectedReferences: 3, reason: "Invalidiert Auth-Sessions organisationsübergreifend nach sicherheitsrelevanten Kontoänderungen." },
  { file: "middleware/apiKey.ts", imported: "rootDb", local: "rootDb", expectedReferences: 1, reason: "Validiert globale API-Schlüssel vor dem Aufbau eines organisationsgebundenen Request-Kontexts." },
  { file: "middleware/bruteForceStore.ts", imported: "rootDb", local: "rootDb", expectedReferences: 2, reason: "Speichert Sicherheits-Sperrzähler zentral, bevor eine Login- oder Auth-Anfrage einer Organisation zugeordnet ist." },
  { file: "middleware/rlsMiddleware.ts", imported: "appPool", local: "appPool", expectedReferences: 1, reason: "Öffnet die immo_app-Verbindung und setzt den verpflichtenden Organisationskontext für RLS-gebundene Requests." },
  { file: "seedDistributionKeys.ts", imported: "rootDb", local: "db", expectedReferences: 2, reason: "Seedet Standard-Verteilungsschlüssel beim Anlegen einer Organisation als kontrollierte globale Initialisierung." },
  { file: "seeds/production-seed.ts", imported: "rootDb", local: "db", expectedReferences: 7, reason: "Erstellt kontrollierte Produktions-Startdaten als globaler Setup-Schritt außerhalb einer Nutzeranfrage." },
  { file: "services/jobQueueService.ts", imported: "rootDb", local: "db", expectedReferences: 9, reason: "Verwaltet die globale Hintergrundjob-Warteschlange, deren Ausführung nicht an eine einzelne Request-Organisation gebunden ist." },
  { file: "services/leaseExpiryService.ts", imported: "rootDb", local: "db", expectedReferences: 9, reason: "Verarbeitet globale Mietvertragsabläufe im Hintergrund und prüft dabei organisationsübergreifende Fälligkeiten." },
  { file: "services/vpiImportService.ts", imported: "rootDb", local: "rootDb", expectedReferences: 2, reason: "Importiert globale VPI-Referenzwerte, die bewusst von allen Organisationen gemeinsam genutzt werden." },
  { file: "services/wegSettlementEmailService.ts", imported: "rootDb", local: "db", expectedReferences: 6, reason: "Versendet WEG-Abrechnungen als Hintergrundservice und benötigt dafür den dokumentierten Systemzugriff." },
  { file: "services/wegSettlementPdfService.ts", imported: "rootDb", local: "db", expectedReferences: 6, reason: "Erzeugt WEG-Abrechnungs-PDFs im Hintergrund über den dokumentierten Systemzugriff." },
  { file: "services/wegSettlementService.ts", imported: "rootDb", local: "db", expectedReferences: 10, reason: "Berechnet WEG-Abrechnungen als kontrollierter Hintergrundservice über den dokumentierten Systemzugriff." },
  { file: "services/wegVorschreibungEmailService.ts", imported: "rootDb", local: "db", expectedReferences: 5, reason: "Versendet WEG-Vorschreibungen als Hintergrundservice über den dokumentierten Systemzugriff." },
  { file: "services/wegVotingService.ts", imported: "rootDb", local: "db", expectedReferences: 4, reason: "Berechnet WEG-Abstimmungen im kontrollierten Servicepfad über den dokumentierten Systemzugriff." },
  { file: "storage.ts", imported: "rootDb", local: "rootDb", expectedReferences: 3, reason: "Stellt ausgewählte systemweite Speicheroperationen bereit, die ihren Organisationszugriff selbst explizit begrenzen." },
];

const SENSITIVE_HANDLES = new Set<SensitiveDbHandle>([
  "rootDb",
  "pool",
  "appPool",
  "appDb",
]);
const routesDirectory = fileURLToPath(new URL("../../server/routes/", import.meta.url));
const dbModulePath = fileURLToPath(new URL("../../server/db", import.meta.url));
const serverDirectory = dirname(dbModulePath);
const ACTIVE_ROUTE_ENTRYPOINTS = [
  resolve(serverDirectory, "auth.ts"),
  resolve(serverDirectory, "index.ts"),
  resolve(serverDirectory, "routes.ts"),
] as const;

function accessKey(access: Pick<AllowlistedAccess, "file" | "imported" | "local">): string {
  return `${access.file}:${access.imported}:${access.local}`;
}

function countBindingReferences(sourceFile: ts.SourceFile, localName: string): number {
  let count = 0;

  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      node.text === localName &&
      !ts.isImportSpecifier(node.parent)
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return count;
}

function collectSensitiveDbBindingNames(
  sourceFile: ts.SourceFile,
  sourcePath: string,
): Set<string> {
  const bindings = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !isDbModuleSpecifier(sourcePath, statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const namedBindings = statement.importClause?.namedBindings;
    assert.ok(
      !statement.importClause?.name &&
        (!namedBindings || ts.isNamedImports(namedBindings)),
      `${relative(serverDirectory, sourcePath)} darf server/db nicht als Namespace oder Default importieren; das könnte privilegierte Handles verdecken.`,
    );
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;

    for (const specifier of namedBindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      if (SENSITIVE_HANDLES.has(imported as SensitiveDbHandle)) {
        bindings.add(specifier.name.text);
      }
    }
  }

  return bindings;
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

function assertNoSensitiveDbHandleReexports(
  sourcePath: string,
  source: string,
): void {
  if (sourcePath.replace(/\.(?:js|ts)$/, "") === dbModulePath) return;

  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const sensitiveBindings = collectSensitiveDbBindingNames(sourceFile, sourcePath);
  const displayPath = relative(serverDirectory, sourcePath);

  const unexecutedSensitiveBinding = (expression: ts.Expression): string | null => {
    let found: string | null = null;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (ts.isIdentifier(node) && sensitiveBindings.has(node.text)) {
        const parent = node.parent;
        const isExecutedDbCall =
          ts.isPropertyAccessExpression(parent) &&
          parent.expression === node &&
          ts.isCallExpression(parent.parent) &&
          parent.parent.expression === parent;
        // Der ausschließlich read-only arbeitende Klartext-IBAN-Scanner ist
        // der dokumentierte Sonderfall: Er konsumiert rootDb nur als Argument
        // und gibt Prüfresultate zurück, niemals den Handle selbst.
        const isApprovedReadOnlyConsumer =
          displayPath === "routes/plaintextIbanGuardRoutes.ts" &&
          ts.isCallExpression(parent) &&
          parent.arguments.includes(node) &&
          ts.isIdentifier(parent.expression) &&
          parent.expression.text === "scanPlaintextIbanBic";
        if (!isExecutedDbCall && !isApprovedReadOnlyConsumer) found = node.text;
      }
      ts.forEachChild(node, visit);
    };
    visit(expression);
    return found;
  };

  const assertNoSensitiveHandleAliases = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const sourceBinding = unexecutedSensitiveBinding(node.initializer);
      assert.ok(
        !sourceBinding,
        `${displayPath} darf den sensiblen DB-Handle ${sourceBinding} nicht in einer lokalen Variable ${node.name.text} weiterreichen.`,
      );
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      const sourceBinding = unexecutedSensitiveBinding(node.right);
      assert.ok(
        !sourceBinding,
        `${displayPath} darf den sensiblen DB-Handle ${sourceBinding} nicht einer lokalen Variable ${node.left.text} zuweisen.`,
      );
    }
    ts.forEachChild(node, assertNoSensitiveHandleAliases);
  };
  assertNoSensitiveHandleAliases(sourceFile);

  const assertFunctionDoesNotReturnSensitiveHandle = (
    declaration: ts.FunctionLikeDeclaration,
  ): void => {
    const visit = (node: ts.Node): void => {
      if (
        ts.isReturnStatement(node) &&
        node.expression
      ) {
        const sensitiveBinding = unexecutedSensitiveBinding(node.expression);
        if (sensitiveBinding) {
          assert.fail(
            `${displayPath} darf den sensiblen DB-Handle ${sensitiveBinding} nicht aus einer exportierten Funktion zurückgeben.`,
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    if (declaration.body) visit(declaration.body);
  };

  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      isDbModuleSpecifier(sourcePath, statement.moduleSpecifier.text)
    ) {
      assert.fail(
        `${displayPath} darf keinen Handle aus server/db re-exportieren; Route-Module könnten damit RLS umgehen.`,
      );
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const specifier of statement.exportClause.elements) {
        const localName = specifier.propertyName?.text ?? specifier.name.text;
        assert.ok(
          !sensitiveBindings.has(localName),
          `${displayPath} darf den sensiblen DB-Handle ${localName} nicht re-exportieren.`,
        );
      }
    }

    const assertNoSensitiveBindingInExportedValue = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && sensitiveBindings.has(node.text)) {
        assert.fail(
          `${displayPath} darf den sensiblen DB-Handle ${node.text} nicht über einen exportierten Wrapper weiterreichen.`,
        );
      }
      ts.forEachChild(node, assertNoSensitiveBindingInExportedValue);
    };

    if (ts.isExportAssignment(statement)) {
      assertNoSensitiveBindingInExportedValue(statement.expression);
    }
    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.initializer) {
          assertNoSensitiveBindingInExportedValue(declaration.initializer);
        }
      }
    }
    if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) {
      assertFunctionDoesNotReturnSensitiveHandle(statement);
    }
    if (ts.isClassDeclaration(statement) && hasExportModifier(statement)) {
      for (const member of statement.members) {
        if (
          ts.isMethodDeclaration(member) ||
          ts.isGetAccessorDeclaration(member) ||
          ts.isSetAccessorDeclaration(member)
        ) {
          assertFunctionDoesNotReturnSensitiveHandle(member);
        }
      }
    }
  }
}

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [entryPath]
      : [];
  });
}

function isDbModuleSpecifier(sourcePath: string, moduleSpecifier: string): boolean {
  const resolvedByTypeScript = ts.resolveModuleName(
    moduleSpecifier,
    sourcePath,
    {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    },
    ts.sys,
  ).resolvedModule?.resolvedFileName;
  if (resolvedByTypeScript?.replace(/\.(?:js|ts)$/, "") === dbModulePath) {
    return true;
  }

  if (moduleSpecifier.startsWith("file:")) {
    try {
      return fileURLToPath(moduleSpecifier).replace(/\.(?:js|ts)$/, "") === dbModulePath;
    } catch {
      return false;
    }
  }

  const resolved = resolve(dirname(sourcePath), moduleSpecifier)
    .replace(/\.(?:js|ts)$/, "");
  return resolved === dbModulePath;
}

function collectSensitiveDbAccessesFromSource(
  file: string,
  sourcePath: string,
  source: string,
): AllowlistedAccess[] {
  const accesses: AllowlistedAccess[] = [];
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );

  const inspect = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const moduleSpecifier = node.arguments[0];
      assert.ok(
        node.arguments.length === 1 && ts.isStringLiteral(moduleSpecifier),
        `${file} darf server/db nicht über einen berechneten dynamischen Import verschleiern.`,
      );
      assert.ok(
        !isDbModuleSpecifier(sourcePath, moduleSpecifier.text),
        `${file} darf server/db nicht dynamisch importieren; nutze einen statischen, allowlistbaren Import.`,
      );
    }
    if (
      ts.isIdentifier(node) &&
      (node.text === "require" || node.text === "createRequire")
    ) {
      assert.fail(
        `${file} darf require/createRequire nicht verwenden; dadurch könnten RLS-umgehende DB-Handles verdeckt geladen werden.`,
      );
    }
    ts.forEachChild(node, inspect);
  };
  inspect(sourceFile);

  for (const statement of sourceFile.statements) {
    const moduleSpecifier =
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : null;
    if (!moduleSpecifier || !isDbModuleSpecifier(sourcePath, moduleSpecifier)) {
      continue;
    }

    assert.ok(
      ts.isImportDeclaration(statement),
      `${file} darf server/db nicht re-exportieren; das würde privilegierte Handles indirekt für Routen verfügbar machen.`,
    );
    if (!ts.isImportDeclaration(statement)) continue;

    const bindings = statement.importClause?.namedBindings;
    assert.ok(
      !statement.importClause?.name &&
        (!bindings || ts.isNamedImports(bindings)),
      `${file} darf server/db nicht als Namespace oder Default importieren; das würde privilegierte Handles verbergen.`,
    );
    if (!bindings || !ts.isNamedImports(bindings)) continue;

    for (const specifier of bindings.elements) {
      const imported = (specifier.propertyName?.text ?? specifier.name.text) as SensitiveDbHandle;
      if (!SENSITIVE_HANDLES.has(imported)) continue;

      accesses.push({
        file,
        imported,
        local: specifier.name.text,
        expectedReferences: countBindingReferences(sourceFile, specifier.name.text),
        reason: "",
      });
    }
  }

  return accesses;
}

function collectRouteSourceFiles(): string[] {
  return [
    ...collectTypeScriptFiles(routesDirectory),
    ...ACTIVE_ROUTE_ENTRYPOINTS,
  ].sort();
}

function routeSourceName(sourcePath: string): string {
  const pathWithinRoutesDirectory = relative(routesDirectory, sourcePath);
  return pathWithinRoutesDirectory.startsWith("..")
    ? relative(serverDirectory, sourcePath)
    : pathWithinRoutesDirectory;
}

function resolveServerModule(
  sourcePath: string,
  moduleSpecifier: string,
): string | null {
  if (!moduleSpecifier.startsWith(".") && !moduleSpecifier.startsWith("file:")) {
    return null;
  }
  const resolved = ts.resolveModuleName(
    moduleSpecifier,
    sourcePath,
    {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    },
    ts.sys,
  ).resolvedModule?.resolvedFileName;
  if (!resolved || !resolved.startsWith(`${serverDirectory}/`) || !resolved.endsWith(".ts")) {
    return null;
  }
  return resolved;
}

function collectRouteReachableSourceFiles(): string[] {
  const reachable = new Set<string>();
  const pending = [...collectRouteSourceFiles()];

  while (pending.length > 0) {
    const sourcePath = pending.pop();
    if (!sourcePath || reachable.has(sourcePath)) continue;
    reachable.add(sourcePath);

    const sourceFile = ts.createSourceFile(
      sourcePath,
      readFileSync(sourcePath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const enqueue = (moduleSpecifier: string): void => {
      const resolved = resolveServerModule(sourcePath, moduleSpecifier);
      if (resolved && !reachable.has(resolved)) pending.push(resolved);
    };

    for (const statement of sourceFile.statements) {
      if (
        (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        enqueue(statement.moduleSpecifier.text);
      }
    }
    const inspectDynamicImports = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        enqueue(node.arguments[0].text);
      }
      ts.forEachChild(node, inspectDynamicImports);
    };
    inspectDynamicImports(sourceFile);
  }

  return [...reachable].sort();
}

function collectSensitiveRouteDbAccesses(): AllowlistedAccess[] {
  const sourceFiles = collectRouteReachableSourceFiles();

  return sourceFiles.flatMap((sourcePath) =>
    collectSensitiveDbAccessesFromSource(
      routeSourceName(sourcePath),
      sourcePath,
      readFileSync(sourcePath, "utf8"),
    ),
  );
}

function assertImportsAreAllowlisted(actual: readonly AllowlistedAccess[]): void {
  const allowedKeys = new Set(ROUTE_DB_ACCESS_ALLOWLIST.map(accessKey));
  const unexpected = actual
    .map(accessKey)
    .filter((key) => !allowedKeys.has(key));

  assert.equal(
    unexpected.length,
    0,
    `Nicht allowlistete privilegierte DB-Importe: ${unexpected.join(", ")}`,
  );
}

describe("Route-DB-Access-Allowlist", () => {
  test("blockiert alternative und verdeckte Importformen für server/db", () => {
    const fixturePath = resolve(routesDirectory, "fixture.ts");

    assert.throws(
      () => assertImportsAreAllowlisted(
        collectSensitiveDbAccessesFromSource(
          "fixture.ts",
          fixturePath,
          `import { rootDb as privileged } from "../db.ts"; void privileged;`,
        ),
      ),
      /fixture\.ts:rootDb:privileged/,
      "Die .ts-Variante muss wie ein direkter server/db-Import erfasst werden.",
    );
    assert.throws(
      () => collectSensitiveDbAccessesFromSource(
        "fixture.ts",
        fixturePath,
        `export { rootDb } from "../db";`,
      ),
      /nicht re-exportieren/,
      "Ein Re-Export darf keinen indirekten privilegierten Route-Import ermöglichen.",
    );
    assert.throws(
      () => collectSensitiveDbAccessesFromSource(
        "fixture.ts",
        fixturePath,
        `async function load() { return import("../" + "db"); } void load;`,
      ),
      /dynamischen Import/,
      "Auch berechnete dynamische Imports müssen in Routen fail-closed abgelehnt werden.",
    );
    for (const moduleSpecifier of [
      `${dbModulePath}.ts`,
      pathToFileURL(`${dbModulePath}.ts`).href,
    ]) {
      assert.throws(
        () => assertImportsAreAllowlisted(
          collectSensitiveDbAccessesFromSource(
            "fixture.ts",
            fixturePath,
            `import { rootDb as privileged } from ${JSON.stringify(moduleSpecifier)}; void privileged;`,
          ),
        ),
        /fixture\.ts:rootDb:privileged/,
        `Der Pfad ${moduleSpecifier} muss wie ein direkter server/db-Import erfasst werden.`,
      );
    }
    assert.throws(
      () => collectSensitiveDbAccessesFromSource(
        "fixture.ts",
        fixturePath,
        `const db = require("../" + "db"); void db;`,
      ),
      /require\/createRequire/,
      "Auch berechnete CommonJS-Imports müssen in Routen fail-closed abgelehnt werden.",
    );
    assert.throws(
      () => assertNoSensitiveDbHandleReexports(
        resolve(serverDirectory, "lib/dbHandles.ts"),
        `import { rootDb } from "../db"; export { rootDb };`,
      ),
      /nicht re-exportieren/,
      "Ein Zwischenmodul darf rootDb nicht für eine Route weiterreichen.",
    );
    assert.throws(
      () => assertNoSensitiveDbHandleReexports(
        resolve(serverDirectory, "lib/dbHandles.ts"),
        `import { rootDb } from "../db"; export function getDb() { return rootDb; }`,
      ),
      /nicht aus einer exportierten Funktion zurückgeben/,
      "Ein Zwischenmodul darf rootDb nicht über eine exportierte Funktion weiterreichen.",
    );
    assert.throws(
      () => assertNoSensitiveDbHandleReexports(
        resolve(serverDirectory, "lib/dbHandles.ts"),
        `import { rootDb } from "../db"; const privileged = rootDb; export { privileged };`,
      ),
      /lokalen Variable privileged/,
      "Ein Zwischenmodul darf rootDb nicht in eine re-exportierbare Aliasvariable kopieren.",
    );
    assert.throws(
      () => assertNoSensitiveDbHandleReexports(
        resolve(serverDirectory, "lib/dbHandles.ts"),
        `import { rootDb } from "../db"; const handles = { rootDb }; export { handles };`,
      ),
      /lokalen Variable handles/,
      "Ein Zwischenmodul darf rootDb nicht in einem re-exportierbaren Objekt weiterreichen.",
    );
    assert.throws(
      () => assertNoSensitiveDbHandleReexports(
        resolve(serverDirectory, "lib/dbHandles.ts"),
        `import * as database from "../db"; export const handles = { rootDb: database.rootDb };`,
      ),
      /Namespace oder Default/,
      "Ein Zwischenmodul darf server/db nicht als Namespace importieren und daraus Handles weiterreichen.",
    );
    assert.throws(
      () => assertNoSensitiveDbHandleReexports(
        resolve(serverDirectory, "lib/dbHandles.ts"),
        `import database from "../db"; export default database;`,
      ),
      /Namespace oder Default/,
      "Ein Zwischenmodul darf server/db nicht als Default importieren und weiterreichen.",
    );
    assert.throws(
      () => assertImportsAreAllowlisted(
        collectSensitiveDbAccessesFromSource(
          "admin/foo.ts",
          resolve(routesDirectory, "admin/foo.ts"),
          `import { rootDb } from "../../db"; void rootDb;`,
        ),
      ),
      /admin\/foo\.ts:rootDb:rootDb/,
      "Eine verschachtelte Route muss genauso wie eine flache Route inventarisiert werden.",
    );
    for (const returnedValue of [
      `rootDb as unknown as Record<string, unknown>`,
      `{ rootDb }`,
    ]) {
      assert.throws(
        () => assertNoSensitiveDbHandleReexports(
          resolve(serverDirectory, "lib/dbHandles.ts"),
          `import { rootDb } from "../db"; export function getDb() { return ${returnedValue}; }`,
        ),
        /nicht aus einer exportierten Funktion zurückgeben/,
        `Ein Zwischenmodul darf rootDb nicht getarnt zurückgeben: ${returnedValue}.`,
      );
    }
  });

  test("verbietet Re-Exports sensibler DB-Handles in allen Servermodulen", () => {
    for (const sourcePath of collectTypeScriptFiles(serverDirectory)) {
      assertNoSensitiveDbHandleReexports(
        sourcePath,
        readFileSync(sourcePath, "utf8"),
      );
    }
  });

  test("erfasst alle aktiven Route-Einstiegsmodule außerhalb server/routes", () => {
    const actual = collectSensitiveRouteDbAccesses();
    for (const entrypoint of ACTIVE_ROUTE_ENTRYPOINTS) {
      assert.ok(
        collectRouteSourceFiles().includes(entrypoint),
        `${basename(entrypoint)} wird beim Server-Start registriert und muss Teil der Route-Inventur bleiben.`,
      );
    }
    for (const expected of [
      { file: "auth.ts", imported: "rootDb", local: "db" },
      { file: "index.ts", imported: "pool", local: "pool" },
      { file: "routes.ts", imported: "rootDb", local: "rootDb" },
    ] as const) {
      assert.ok(
        actual.some(
          (access) =>
            access.file === expected.file &&
            access.imported === expected.imported &&
            access.local === expected.local,
        ),
        `Der privilegierte Zugriff in ${expected.file} muss allowlistbar inventarisiert werden.`,
      );
    }
  });

  test("verfolgt privilegierte Zugriffe über statische und dynamische Route-Serviceimporte", () => {
    const actual = collectSensitiveRouteDbAccesses();
    for (const expected of [
      { file: "services/jobQueueService.ts", imported: "rootDb", local: "db" },
      { file: "services/wegSettlementService.ts", imported: "rootDb", local: "db" },
    ] as const) {
      assert.ok(
        actual.some(
          (access) =>
            access.file === expected.file &&
            access.imported === expected.imported &&
            access.local === expected.local,
        ),
        `${expected.file} ist von einer Route erreichbar und muss mit seinem privilegierten Zugriff inventarisiert werden.`,
      );
    }
  });

  test("dokumentiert jede privilegierte DB-Importbindung unter server/routes", () => {
    const actual = collectSensitiveRouteDbAccesses();
    const expectedKeys = ROUTE_DB_ACCESS_ALLOWLIST.map(accessKey).sort();
    const actualKeys = actual.map(accessKey).sort();

    assertImportsAreAllowlisted(actual);
    assert.deepEqual(
      actualKeys,
      expectedKeys,
      "Ein neuer rootDb-/pool-/appPool-Import in einer Route braucht einen expliziten, begründeten Allowlist-Eintrag.",
    );

    for (const allowed of ROUTE_DB_ACCESS_ALLOWLIST) {
      assert.ok(
        allowed.reason.length >= 40,
        `${accessKey(allowed)} braucht eine aussagekräftige Begründung für den RLS-Ausnahmefall.`,
      );
    }
  });

  test("erkennt zusätzliche Abfragen über bereits erlaubte privilegierte Bindungen", () => {
    const actualByKey = new Map(
      collectSensitiveRouteDbAccesses().map((access) => [accessKey(access), access]),
    );

    for (const allowed of ROUTE_DB_ACCESS_ALLOWLIST) {
      const actual = actualByKey.get(accessKey(allowed));
      assert.ok(actual, `${accessKey(allowed)} fehlt in den Routenquellen.`);
      assert.equal(
        actual.expectedReferences,
        allowed.expectedReferences,
        `${accessKey(allowed)} hat zusätzliche oder entfernte Verwendungen. Prüfe die RLS-Auswirkung und aktualisiere anschließend die Allowlist samt Begründung bewusst.`,
      );
    }
  });
});