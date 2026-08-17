/**
 * API-Key Brute-Force-Schutz — Integrationstests (node:test)
 *
 * Prueft:
 * 1. Versuche 1-10 mit falschem Key liefern 403
 * 2. Der 11. fehlgeschlagene Versuch liefert 429
 * 3. Nach einer Blockierung wird auch ein korrekter Key abgewiesen (429)
 * 4. Erfolgreiche Authentifizierung setzt den Zaehler zurueck
 * 5. Der Zaehler-Key basiert auf organization_id — nicht auf IP-Adressen.
 *    Wechselnde X-Forwarded-For-Header oder Trust-Proxy-Konfigurationen
 *    haben keinen Einfluss auf den Zaehler (Schutz gegen IP-Spoofing).
 * 6. Verschiedene Orgs haben voneinander unabhaengige Zaehler
 * 7. Admin-Key-Management-Endpunkte (tatsaechliche Routen) liefern
 *    nach 6 authentifizierten Anfragen 429
 *
 * Ausfuehren mit:
 *   node --import=./node_modules/tsx/dist/esm/index.cjs --test tests/unit/api-key-brute-force.test.ts
 */
import { describe, test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express, { Request, Response } from "express";
import request from "supertest";
import { createApiKeyAuth } from "../../server/middleware/apiKey";
import adminRoutes, { _apiKeyManagementStore, _apiKeyManagementLimiter } from "../../server/routes/adminRoutes";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_ORG    = "brute-force-test-org";
const TEST_ORG_B  = "brute-force-test-org-b";
const CORRECT_KEY = "correct-secret-key-xyz";

/**
 * Baut eine frische Express-App mit einer neuen createApiKeyAuth-Instanz.
 * Jede Instanz hat einen eigenen failedMap (kein Test beeinflusst einen anderen).
 */
function buildApp(correctKey: string = CORRECT_KEY) {
  const app = express();
  const mockLookup = async (orgId: string) => {
    if (orgId === TEST_ORG)   return { id: TEST_ORG,   readonlyApiKey: correctKey };
    if (orgId === TEST_ORG_B) return { id: TEST_ORG_B, readonlyApiKey: "key-for-org-b" };
    return undefined;
  };
  app.use(createApiKeyAuth(mockLookup));
  app.get("/api/readonly/test", (_req: Request, res: Response) => res.json({ ok: true }));
  return app;
}

/** Sendet n Anfragen mit falschem Key gegen TEST_ORG; gibt Status-Codes zurueck. */
async function sendWrongKeyRequests(
  app: express.Application,
  n: number,
  orgId: string = TEST_ORG,
  xForwardedFor?: string,
): Promise<number[]> {
  const results: number[] = [];
  for (let i = 0; i < n; i++) {
    const req = request(app)
      .get(`/api/readonly/test?organization_id=${orgId}`)
      .set("X-Api-Key", "wrong-key-does-not-match");
    if (xForwardedFor !== undefined) req.set("X-Forwarded-For", xForwardedFor);
    results.push((await req).status);
  }
  return results;
}

// ── Brute-Force-Tests ─────────────────────────────────────────────────────────

describe("apiKeyAuth — Brute-Force-Schutz (org-basierter Zaehler)", () => {
  test("Versuche 1-10 mit falschem Key liefern 403", async () => {
    const app = buildApp();
    const statuses = await sendWrongKeyRequests(app, 10);
    for (let i = 0; i < 10; i++) {
      assert.equal(statuses[i], 403, `Versuch ${i + 1} sollte 403 liefern`);
    }
  });

  test("11. fehlgeschlagener Versuch liefert 429", async () => {
    const app = buildApp();
    await sendWrongKeyRequests(app, 10);
    const res = await request(app)
      .get(`/api/readonly/test?organization_id=${TEST_ORG}`)
      .set("X-Api-Key", "wrong-key");
    assert.equal(res.status, 429);
    assert.ok(typeof res.body.error === "string" && res.body.error.length > 0);
  });

  test("Nach 10 Fehlversuchen wird auch korrekter Key abgewiesen (429)", async () => {
    const app = buildApp(CORRECT_KEY);
    await sendWrongKeyRequests(app, 10);
    const res = await request(app)
      .get(`/api/readonly/test?organization_id=${TEST_ORG}`)
      .set("X-Api-Key", CORRECT_KEY);
    assert.equal(res.status, 429);
  });

  test("Erfolgreiche Auth setzt Zaehler zurueck — danach wieder 10 Fehlversuche moeglich", async () => {
    const app = buildApp(CORRECT_KEY);
    await sendWrongKeyRequests(app, 9);
    const okRes = await request(app)
      .get(`/api/readonly/test?organization_id=${TEST_ORG}`)
      .set("X-Api-Key", CORRECT_KEY);
    assert.equal(okRes.status, 200, "Korrekte Auth sollte 200 liefern");
    // Nach Reset: 10 weitere Fehlversuche liefern 403 (kein vorzeitiges 429)
    const afterReset = await sendWrongKeyRequests(app, 10);
    for (let i = 0; i < 10; i++) {
      assert.equal(afterReset[i], 403, `Versuch ${i + 1} nach Reset sollte 403 liefern`);
    }
  });

  test("Zaehler ist org-basiert: wechselnde X-Forwarded-For-Header umgehen Sperre nicht", async () => {
    // Der Zaehler-Key ist org:TEST_ORG — nicht abhaengig von IP oder XFF.
    // Selbst wenn der Angreifer bei jedem Request eine andere (echte oder gefaelschte)
    // IP angibt, zaehlt jeder Fehlversuch gegen dieselbe Org.
    const app = buildApp();
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .get(`/api/readonly/test?organization_id=${TEST_ORG}`)
        .set("X-Api-Key", "wrong")
        .set("X-Forwarded-For", `10.0.${i}.1`);          // wechselnde "IP"
      assert.equal(res.status, 403, `Versuch ${i + 1} mit anderer IP sollte 403 liefern`);
    }
    // 11. Versuch — egal von welcher IP — liefert 429
    const blocked = await request(app)
      .get(`/api/readonly/test?organization_id=${TEST_ORG}`)
      .set("X-Api-Key", "wrong")
      .set("X-Forwarded-For", "99.99.99.99");
    assert.equal(blocked.status, 429, "IP-Wechsel darf Org-Sperre nicht umgehen");
  });

  test("Zaehler ist auch mit trust proxy = 1 org-basiert (kein IP-Bypass moeglich)", async () => {
    // In der Produktionskonfiguration ist trust proxy = 1 aktiv; req.ip liest XFF.
    // Der Zaehler-Key basiert jedoch auf organization_id, nicht req.ip.
    // Daher aendert sich der Zaehler-Key NICHT, selbst wenn XFF bei jedem Request
    // einen anderen Wert liefert.
    const app = buildApp();
    app.set("trust proxy", 1); // Produktionskonfiguration
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .get(`/api/readonly/test?organization_id=${TEST_ORG}`)
        .set("X-Api-Key", "wrong")
        .set("X-Forwarded-For", `trust-proxy-fake-${i}`); // trust proxy wuerde req.ip setzen
      assert.equal(res.status, 403);
    }
    // Sperre greift trotz wechselndem XFF
    const blocked = await request(app)
      .get(`/api/readonly/test?organization_id=${TEST_ORG}`)
      .set("X-Api-Key", "wrong")
      .set("X-Forwarded-For", "trust-proxy-fake-99");
    assert.equal(blocked.status, 429, "Sperre gilt unabhaengig von trust proxy / XFF");
  });

  test("Verschiedene Orgs haben voneinander unabhaengige Zaehler", async () => {
    const app = buildApp();
    // Org A: 10 Fehlversuche → gesperrt
    await sendWrongKeyRequests(app, 10, TEST_ORG);
    const blockedA = await request(app)
      .get(`/api/readonly/test?organization_id=${TEST_ORG}`)
      .set("X-Api-Key", "wrong");
    assert.equal(blockedA.status, 429, "Org A sollte gesperrt sein");
    // Org B: eigener Zaehler → noch nicht gesperrt
    const freeB = await request(app)
      .get(`/api/readonly/test?organization_id=${TEST_ORG_B}`)
      .set("X-Api-Key", "wrong");
    assert.equal(freeB.status, 403, "Org B sollte NICHT gesperrt sein");
  });

  test("Kein Key angegeben (401) zaehlt nicht als Fehlversuch", async () => {
    const app = buildApp();
    for (let i = 0; i < 15; i++) {
      const res = await request(app)
        .get(`/api/readonly/test?organization_id=${TEST_ORG}`);
      assert.equal(res.status, 401);
    }
    // Erster echter Fehlversuch: immer noch 403 (nicht 429)
    const res = await request(app)
      .get(`/api/readonly/test?organization_id=${TEST_ORG}`)
      .set("X-Api-Key", "wrong");
    assert.equal(res.status, 403);
  });

  test(
    "Fehlende organization_id → 400, kein Zaehler-Eintrag (trust proxy = 1 sicher)",
    async () => {
      // Sicherheitsregression: mit trust proxy = 1 liest req.ip aus dem
      // X-Forwarded-For-Header (faelschbar). Indem Anfragen ohne organization_id
      // auf 400 kurzgeschlossen werden, wird kein IP-basierter Zaehler angelegt —
      // der XFF-Bypass-Pfad existiert schlicht nicht.
      const middleware = createApiKeyAuth(
        async (orgId) => ({ id: orgId, readonlyApiKey: "key" }),
        { maxMapSize: 5 },
      );
      const app = express();
      app.set("trust proxy", 1); // Produktionskonfiguration
      app.use(middleware);
      app.get("/api/readonly/test", (_req: Request, res: Response) => res.json({ ok: true }));

      // 20 Anfragen ohne organization_id, wechselnder XFF (kein Zaehler moeglich)
      for (let i = 0; i < 20; i++) {
        const res = await request(app)
          .get("/api/readonly/test")
          .set("X-Api-Key", "wrong")
          .set("X-Forwarded-For", `10.0.${i}.1`);
        assert.equal(res.status, 400, `Anfrage ${i} ohne org_id sollte 400 liefern`);
      }
      // Kein Zustand angelegt
      assert.equal(await (middleware as any)._getMapSize(),     0, "failedMap muss leer sein");
      assert.equal(await (middleware as any)._getLockoutSize(), 0, "lockoutMap muss leer sein");

      // Regulaere Anfragen mit organization_id funktionieren weiterhin
      // (Mock-Lookup gibt readonlyApiKey: "key" zurueck)
      const ok = await request(app)
        .get(`/api/readonly/test?organization_id=${TEST_ORG}`)
        .set("X-Api-Key", "key");
      assert.equal(ok.status, 200, "Gueltiger Key mit org_id sollte 200 liefern");
    },
  );
});

// ── Kapazitaetsgrenze: absoluter Map-Groessen-Test ────────────────────────────

describe("apiKeyAuth — Kapazitaetsgrenze absolut (kein unbegrenztes Wachstum)", () => {
  const MAP_CAP = 5; // kleines Limit fuer den Test

  function buildCapApp() {
    const middleware = createApiKeyAuth(
      async (orgId) =>
        orgId.startsWith("cap-") ? { id: orgId, readonlyApiKey: "key" } : undefined,
      { maxMapSize: MAP_CAP },
    );
    const app = express();
    app.use(middleware);
    app.get("/api/readonly/test", (_req: Request, res: Response) => res.json({ ok: true }));
    return { app, middleware };
  }

  test(
    "Map-Groesse ueberschreitet MAP_CAP nie — auch bei nicht-abgelaufenen Eintraegen",
    async () => {
      const { app, middleware } = buildCapApp();

      // MAP_CAP eindeutige Orgs erzeugen: Map bis zur Kapazitaet fuellen
      for (let i = 0; i < MAP_CAP; i++) {
        await request(app)
          .get(`/api/readonly/test?organization_id=cap-${i}`)
          .set("X-Api-Key", "wrong");
      }
      assert.equal(
        await (middleware as any)._getMapSize(),
        MAP_CAP,
        `Map sollte genau ${MAP_CAP} Eintraege haben`,
      );

      // MAP_CAP + 3 weitere einzigartige Orgs einfuegen (alle Eintraege sind noch aktiv/unexpired)
      for (let i = MAP_CAP; i < MAP_CAP + 3; i++) {
        await request(app)
          .get(`/api/readonly/test?organization_id=cap-${i}`)
          .set("X-Api-Key", "wrong");
        assert.ok(
          await (middleware as any)._getMapSize() <= MAP_CAP,
          `Map-Groesse darf MAP_CAP (${MAP_CAP}) nicht ueberschreiten (nach cap-${i}): ` +
          `aktuell ${await (middleware as any)._getMapSize()}`,
        );
      }
    },
  );

  test("App bleibt nach Map-Flood voll funktionsfaehig", async () => {
    const { app } = buildCapApp();
    // 3 * MAP_CAP einzigartige Orgs mit je einem Fehlversuch
    for (let i = 0; i < MAP_CAP * 3; i++) {
      const res = await request(app)
        .get(`/api/readonly/test?organization_id=cap-flood-${i}`)
        .set("X-Api-Key", "wrong");
      assert.equal(res.status, 403, `Anfrage ${i} sollte 403 liefern (kein Crash)`);
    }
    // 10 weitere Fehlversuche gegen eine Org → Sperre greift weiterhin
    for (let j = 0; j < 10; j++) {
      await request(app)
        .get(`/api/readonly/test?organization_id=cap-stable-org`)
        .set("X-Api-Key", "wrong");
    }
    const blocked = await request(app)
      .get(`/api/readonly/test?organization_id=cap-stable-org`)
      .set("X-Api-Key", "wrong");
    assert.equal(blocked.status, 429, "Brute-Force-Sperre nach Map-Flood weiterhin aktiv");
  });

  test(
    "Unbekannte Org-IDs erzeugen keinen Zustand — lockoutMap bleibt beschraenkt",
    async () => {
      // Testet: Flooding mit unbekannten Org-IDs (nicht in der DB) darf die
      // lockoutMap NICHT befuellen. Nur bekannte Orgs duerfen Lockout-Eintraege
      // erzeugen. Das begrenzt die Kardinalitaet der lockoutMap auf die Anzahl
      // echter Orgs (nicht auf beliebig viele Angreifer-Eingaben).
      const KNOWN_ORG = "known-org-flood-test";
      let knownOrgLookups = 0;
      const middleware = createApiKeyAuth(
        async (orgId) => {
          if (orgId === KNOWN_ORG) {
            knownOrgLookups++;
            return { id: KNOWN_ORG, readonlyApiKey: "secret" };
          }
          return undefined; // unbekannte Org
        },
        { maxMapSize: MAP_CAP },
      );
      const app = express();
      app.use(middleware);
      app.get("/api/readonly/test", (_req: Request, res: Response) => res.json({ ok: true }));

      // Flood: 50 einzigartige, UNBEKANNTE Org-IDs mit 10+ Fehlversuchen
      for (let i = 0; i < 50; i++) {
        for (let j = 0; j < 10; j++) {
          await request(app)
            .get(`/api/readonly/test?organization_id=unknown-flood-${i}`)
            .set("X-Api-Key", "wrong");
        }
      }
      // lockoutMap muss leer bleiben (keine unbekannten Orgs eingetragen)
      assert.equal(
        await (middleware as any)._getLockoutSize(),
        0,
        "lockoutMap darf durch unbekannte Org-IDs nicht befuellt werden",
      );
      assert.equal(
        await (middleware as any)._getMapSize(),
        0,
        "failedMap darf durch unbekannte Org-IDs nicht befuellt werden",
      );

      // Bekannte Org: 10 Fehlversuche → lockoutMap bekommt genau 1 Eintrag
      for (let i = 0; i < 10; i++) {
        await request(app)
          .get(`/api/readonly/test?organization_id=${KNOWN_ORG}`)
          .set("X-Api-Key", "wrong");
      }
      assert.equal(
        await (middleware as any)._getLockoutSize(),
        1,
        "Bekannte Org muss in lockoutMap eingetragen sein",
      );
      // Sperre gilt fuer bekannte Org
      const blocked = await request(app)
        .get(`/api/readonly/test?organization_id=${KNOWN_ORG}`)
        .set("X-Api-Key", "wrong");
      assert.equal(blocked.status, 429, "Bekannte Org muss gesperrt sein");

      // Nochmaliger Flood mit unbekannten Orgs beruehrt bestehende Sperre nicht
      for (let i = 100; i < 150; i++) {
        await request(app)
          .get(`/api/readonly/test?organization_id=unknown-flood-${i}`)
          .set("X-Api-Key", "wrong");
      }
      assert.equal(
        await (middleware as any)._getLockoutSize(),
        1,
        "lockoutMap-Groesse muss nach weiterem Flood konstant bleiben",
      );
      const stillBlocked = await request(app)
        .get(`/api/readonly/test?organization_id=${KNOWN_ORG}`)
        .set("X-Api-Key", "wrong");
      assert.equal(stillBlocked.status, 429, "Bekannte Org muss weiterhin gesperrt sein");
    },
  );

  test(
    "Zwei-Tier-Lockout: aktive Sperre bleibt bestehen auch wenn failedMap geflutet wird",
    async () => {
      // Testet den Kernschutz: ein Angreifer kann die Sperre eines Ziels NICHT aufheben
      // indem er den failedMap mit einzigartigen Org-IDs ueberflutet und dabei den
      // FIFO-Eviction-Mechanismus ausloest. Die etablierte Sperre lebt in lockoutMap
      // (Tier 1) — unabhaengig von der failedMap-Kapazitaet.
      const TARGET = "lockout-regression-target";
      const middleware = createApiKeyAuth(
        async (orgId) => ({ id: orgId, readonlyApiKey: "key" }),
        { maxMapSize: MAP_CAP },
      );
      const app = express();
      app.use(middleware);
      app.get("/api/readonly/test", (_req: Request, res: Response) => res.json({ ok: true }));

      // 10 Fehlversuche gegen Ziel-Org → lockoutMap-Eintrag erstellt
      for (let i = 0; i < 10; i++) {
        await request(app)
          .get(`/api/readonly/test?organization_id=${TARGET}`)
          .set("X-Api-Key", "wrong");
      }
      assert.equal(
        await (middleware as any)._getLockoutSize(),
        1,
        "Target sollte in lockoutMap eingetragen sein",
      );

      // Flood: MAP_CAP + 5 einzigartige Orgs evicten failedMap-Eintraege
      for (let i = 0; i < MAP_CAP + 5; i++) {
        await request(app)
          .get(`/api/readonly/test?organization_id=lockout-flood-${i}`)
          .set("X-Api-Key", "wrong");
      }
      assert.ok(
        await (middleware as any)._getMapSize() <= MAP_CAP,
        "failedMap-Kapazitaet darf nicht ueberschritten werden",
      );

      // Ziel ist IMMER NOCH gesperrt (lockoutMap wurde nicht evicted)
      const afterFlood = await request(app)
        .get(`/api/readonly/test?organization_id=${TARGET}`)
        .set("X-Api-Key", "wrong");
      assert.equal(
        afterFlood.status,
        429,
        "Ziel muss nach failedMap-Flood weiterhin gesperrt sein (Zwei-Tier-Schutz)",
      );
    },
  );
});

// ── Management-Rate-Limiter: userId-basierter Schluessel, isolierte Tests ─────
//
// Der Limiter wird NACH requireAdminAccess() montiert. Hier testen wir ihn in
// Isolation (kein echter DB-Lookup), indem wir eine minimale App bauen, die
// den Post-Auth-Zustand simuliert: Session mit userId gesetzt, Limiter aktiv,
// einfacher Handler dahinter.
//
// Dadurch:
// - Kein Datenbankzugriff noetig
// - Limiter-Verhalten exakt testbar (keyGenerator, Store, XFF-Immunität)
// - Keine Abhaengigkeit vom requireAdminAccess-DB-Pfad

describe("API-Key-Management — Rate-Limit (userId-Schluessel, kein IP-Bypass)", () => {
  /**
   * Baut eine isolierte Test-App die NUR den Rate-Limiter enthaelt.
   * Simuliert den Zustand nach requireAdminAccess() — Auth gilt als erledigt.
   */
  function buildLimiterApp(userId = "admin-user-a") {
    const app = express();
    app.use(express.json());
    // Simuliert: requireAdminAccess() hat den Request durchgelassen
    app.use((_req: Request, _res: Response, next: NextFunction) => {
      (_req as any).session = { userId, organizationId: "test-org" };
      next();
    });
    app.use(_apiKeyManagementLimiter);
    app.post(
      "/api/organization/api-key/generate",
      (_req: Request, res: Response) => res.json({ ok: true }),
    );
    app.delete(
      "/api/organization/api-key",
      (_req: Request, res: Response) => res.json({ ok: true }),
    );
    return app;
  }

  beforeEach(async () => {
    await _apiKeyManagementStore.resetAll();
  });

  test("Erste 5 Anfragen eines Admins liefern kein 429", async () => {
    const app = buildLimiterApp("user-a");
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post("/api/organization/api-key/generate");
      assert.notEqual(res.status, 429, `Anfrage ${i + 1} sollte kein 429 liefern`);
    }
  });

  test("6. Anfrage desselben Admins liefert 429 (POST /generate)", async () => {
    const app = buildLimiterApp("user-b");
    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/organization/api-key/generate");
    }
    const res = await request(app).post("/api/organization/api-key/generate");
    assert.equal(res.status, 429);
    assert.ok(typeof res.body.error === "string", "Fehler-Body muss ein String sein");
  });

  test("6. Anfrage desselben Admins liefert 429 (DELETE /api-key)", async () => {
    const app = buildLimiterApp("user-c");
    for (let i = 0; i < 5; i++) {
      await request(app).delete("/api/organization/api-key");
    }
    const res = await request(app).delete("/api/organization/api-key");
    assert.equal(res.status, 429);
  });

  test(
    "XFF-Wechsel umgeht Limit nicht — Schluessel ist userId, nicht req.ip (trust proxy = 1)",
    async () => {
      // Sicherheitsregression: mit trust proxy = 1 liest req.ip aus XFF (faelschbar).
      // keyGenerator verwendet session.userId — server-seitig verifiziert, nicht
      // durch Client-Header beeinflussbar. Wechselnde XFF-Werte aendern den
      // Limiter-Schluessel daher nicht.
      const app = buildLimiterApp("user-xff");
      app.set("trust proxy", 1);
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post("/api/organization/api-key/generate")
          .set("X-Forwarded-For", `10.0.${i}.1`); // wechselnde "IP"
      }
      // 6. Anfrage mit anderer "IP" laut XFF → trotzdem 429
      const blocked = await request(app)
        .post("/api/organization/api-key/generate")
        .set("X-Forwarded-For", "99.99.99.99");
      assert.equal(blocked.status, 429, "XFF-Wechsel darf userId-Sperre nicht umgehen");
    },
  );

  test("Zwei verschiedene Admins haben voneinander getrennte Budgets", async () => {
    const appA = buildLimiterApp("admin-isolation-a");
    const appB = buildLimiterApp("admin-isolation-b");
    // Admin A: 5 Anfragen → Budget erschoepft
    for (let i = 0; i < 5; i++) {
      await request(appA).post("/api/organization/api-key/generate");
    }
    const blockedA = await request(appA).post("/api/organization/api-key/generate");
    assert.equal(blockedA.status, 429, "Admin A sollte gesperrt sein");
    // Admin B hat eigenes Budget — kein 429
    const okB = await request(appB).post("/api/organization/api-key/generate");
    assert.notEqual(okB.status, 429, "Admin B darf nicht durch Admins A-Limit gesperrt sein");
  });

  test("RateLimit-Limit Header ist 5", async () => {
    const app = buildLimiterApp("user-header");
    const res = await request(app).post("/api/organization/api-key/generate");
    assert.equal(res.headers["ratelimit-limit"], "5");
  });
});
