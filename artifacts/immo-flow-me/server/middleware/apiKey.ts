/**
 * API-Key-Middleware fuer /api/readonly/*
 *
 * Prioritaetsregel:
 *   1. organization_id angegeben + Org hat eigenen readonlyApiKey → nur DIESER Key.
 *   2. organization_id angegeben + Org hat KEINEN Key → globaler READONLY_API_KEY.
 *   3. Keine organization_id → nur globaler READONLY_API_KEY.
 *   4. Falscher Key → 403.
 *
 * Brute-Force-Schutz (Zwei-Tier-Design):
 *
 *   Tier 1 — Aktive Sperren (lockoutMap):
 *     Sobald MAX_FAILED_ATTEMPTS Fehlversuche gegen eine Org erreicht sind,
 *     wandert der Eintrag aus failedMap in lockoutMap. lockoutMap-Eintraege
 *     werden NUR zeitbasiert entfernt (nach BLOCK_DURATION_MS), niemals durch
 *     Kapazitaetseviction. Ein Angreifer der mit Millionen gefaelschter Org-IDs
 *     flutet kann damit keine bestehende Sperre aufheben.
 *
 *   Tier 2 — Fehlversuch-Zaehler (failedMap):
 *     Zaehlt Fehlversuche pro Zaehler-Key. Unterliegt FIFO-Kapazitaetseviction
 *     (MAX_MAP_SIZE). Wenn der Zaehler durch Flooding evicted wird, verliert der
 *     Angreifer seinen "Fortschritt" gegen ein noch nicht gesperrtes Ziel — die
 *     etablierten Sperren in lockoutMap bleiben jedoch erhalten.
 *
 *   Zaehler-Key: organization_id (URL-Parameter, nicht durch Netzwerk-Header
 *   faelschbar), Fallback auf req.ip fuer Anfragen ohne Org.
 *
 * Implementierung als Factory (createApiKeyAuth) fuer testbare Dependency-Injection.
 * ApiKeyAuthOptions erlauben kleinere Limits in Tests.
 */
import type { Request, Response, NextFunction } from "express";
// organizations-Tabelle ist von RLS ausgeschlossen, wird aber hier trotzdem
// über rootDb abgefragt: apiKeyAuth läuft vor rlsMiddleware (kein orgContext)
// und muss die Organisation aus der URL-Parameter-ID nachschlagen.
import { rootDb } from "../db";
import { eq } from "drizzle-orm";
import { organizations } from "@shared/schema";
import {
  type BruteForceStore,
  createDefaultBruteForceStore,
} from "./bruteForceStore";

export type OrgKeyRecord = { id: string; readonlyApiKey: string | null };
export type OrgLookupFn = (orgId: string) => Promise<OrgKeyRecord | undefined>;

export interface ApiKeyAuthOptions {
  maxMapSize?: number;         // failedMap-Kapazitaet (nur In-Memory), default: 50_000
  blockDurationMs?: number;   // Sperrdauer, default: 60_000
  maxFailedAttempts?: number; // Schwellwert, default: 10
  cleanupIntervalMs?: number; // Cleanup-Intervall (nur In-Memory), default: 5 * 60_000
  /**
   * Injizierbarer Zaehler-Store. Default: PostgreSQL (ueberlebt
   * Neustarts/Scaling), In-Memory/Redis nur bei expliziter Injection.
   */
  store?: BruteForceStore;
}

async function defaultOrgLookup(orgId: string): Promise<OrgKeyRecord | undefined> {
  const rows = await rootDb
    .select({ id: organizations.id, readonlyApiKey: organizations.readonlyApiKey })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return rows[0];
}

function getFailKey(req: Request): string {
  const orgId = req.query.organization_id as string | undefined;
  if (orgId) return `org:${orgId}`;
  return `ip:${req.ip ?? req.socket?.remoteAddress ?? "unknown"}`;
}


export function createApiKeyAuth(
  lookupOrg: OrgLookupFn = defaultOrgLookup,
  options: ApiKeyAuthOptions = {},
) {
  // Injizierbarer Store; Default: persistenter PostgreSQL-Store.
  // Die Zwei-Tier-Logik (Sperren vs. Zaehler) lebt jetzt in bruteForceStore.ts.
  const store: BruteForceStore = options.store ?? createDefaultBruteForceStore(options);

  const middleware = async function apiKeyAuthMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    // organization_id ist fuer alle /api/readonly/*-Endpunkte Pflicht.
    // Wir pruefen das VOR dem API-Key-Check und VOR dem Brute-Force-Zaehler.
    // Anfragen ohne organization_id erzeugen keinen Zaehler-Eintrag und koennen
    // weder lockoutMap noch failedMap befuellen. Das verhindert den DoS-Pfad,
    // bei dem Angreifer XFF-Header faelschen und req.ip (mit trust proxy = 1)
    // als Zaehler-Key umgehen wuerden — da dieser Pfad komplett nicht existiert.
    const requestedOrgId = req.query.organization_id as string | undefined;
    if (!requestedOrgId) {
      res.status(400).json({ error: "organization_id ist erforderlich" });
      return;
    }

    // Zaehler-Key: org:${requestedOrgId} — URL-Parameter, nicht durch Netzwerk-
    // Header faelschbar (im Gegensatz zu req.ip bei trust proxy = 1).
    const failKey = getFailKey(req);

    if (await store.isBlocked(failKey)) {
      res.status(429).json({
        error: "Zu viele fehlgeschlagene Versuche. Bitte warte 60 Sekunden.",
      });
      return;
    }

    const apiKey = (req.headers["x-api-key"] ?? req.query.api_key) as string | undefined;
    if (!apiKey) {
      res.status(401).json({ error: "API key required (X-Api-Key header or api_key query param)" });
      return;
    }

    let org: OrgKeyRecord | undefined;
    try {
      org = await lookupOrg(requestedOrgId);
    } catch {
      res.status(500).json({ error: "Datenbankfehler bei der API-Key-Pruefung" });
      return;
    }

    if (!org) {
      // Unbekannte Org-ID: KEIN Zaehler-Eintrag.
      // Faelschliche Org-IDs duerfen lockoutMap/failedMap nicht befuellen — sonst
      // waere ein DoS durch Flooding mit einzigartigen Org-IDs moeglich.
      res.status(403).json({ error: "Organisation nicht gefunden" });
      return;
    }

    if (org.readonlyApiKey) {
      if (apiKey !== org.readonlyApiKey) {
        await store.recordFailure(failKey);
        res.status(403).json({ error: "Ungültiger API-Key fuer diese Organisation" });
        return;
      }
    } else {
      // Org hat keinen eigenen Key → globaler READONLY_API_KEY als Fallback.
      const globalKey = process.env.READONLY_API_KEY;
      if (!globalKey) {
        console.error(
          "READONLY_API_KEY not configured and org has no org-specific key — " +
          `cannot authenticate request for org ${requestedOrgId}`
        );
        res.status(500).json({ error: "API key not configured for this organisation" });
        return;
      }
      if (apiKey !== globalKey) {
        await store.recordFailure(failKey);
        res.status(403).json({ error: "Ungültiger API-Key" });
        return;
      }
    }

    await store.clearFailures(failKey);
    (req as any).authorizedOrgId = org.id;
    next();
  };

  // Test-Hilfsmethoden (nur fuer Tests gedacht)
  (middleware as any)._getMapSize     = () => store._counterSize();
  (middleware as any)._getLockoutSize = () => store._lockoutSize();
  (middleware as any)._store          = store;

  return middleware;
}

export const apiKeyAuth = createApiKeyAuth();
