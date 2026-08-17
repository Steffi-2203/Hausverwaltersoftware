/**
 * API-Key Zugriffskontrolle — Sicherheitstests (node:test, kein vitest)
 *
 * Führe aus mit:
 *   node --import tsx/esm --test tests/security/api-key-access-control.test.ts
 *
 * Abgedeckte Szenarien (Task #59):
 *   1. Key von Org A wird gegen Org B's Endpunkt abgelehnt (403)
 *   2. Nach Widerruf (readonlyApiKey = null) schlägt der alte Key sofort fehl (403)
 *   3. Ohne organization_id im Request wird der org-spezifische Key nicht akzeptiert;
 *      nur der globale READONLY_API_KEY-Env-Key gilt.
 *
 * Alle Tests sind reine Unit-Tests (kein DB-Aufruf, kein laufender Server nötig).
 * Sie nutzen die createApiKeyAuth-Factory, um einen Mock-Lookup zu injizieren.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";
import { createApiKeyAuth, type OrgKeyRecord } from "../../server/middleware/apiKey.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_A_ID   = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_B_ID   = "bbbbbbbb-0000-0000-0000-000000000002";
const KEY_A      = "key-for-org-a-secret";
const KEY_B      = "key-for-org-b-secret";
const GLOBAL_KEY = "global-readonly-env-key";

// Mutable in-memory "database" — simulates DB state changes (e.g. revocation).
const orgStore: Record<string, OrgKeyRecord> = {
  [ORG_A_ID]: { id: ORG_A_ID, readonlyApiKey: KEY_A },
  [ORG_B_ID]: { id: ORG_B_ID, readonlyApiKey: KEY_B },
};

async function mockLookup(orgId: string): Promise<OrgKeyRecord | undefined> {
  return orgStore[orgId];
}

// ---------------------------------------------------------------------------
// Mini express mock — avoids importing express just for the types.
// ---------------------------------------------------------------------------

function makeReq(opts: {
  header?: string;
  queryKey?: string;
  organizationId?: string;
} = {}): Request {
  return {
    headers: opts.header ? { "x-api-key": opts.header } : {},
    query: {
      ...(opts.queryKey      ? { api_key: opts.queryKey }           : {}),
      ...(opts.organizationId ? { organization_id: opts.organizationId } : {}),
    },
  } as unknown as Request;
}

type FakeRes = {
  _status: number | undefined;
  _body: unknown;
  status(code: number): FakeRes;
  json(data: unknown): FakeRes;
};

function makeRes(): FakeRes {
  const r: FakeRes = {
    _status: undefined,
    _body:   undefined,
    status(code: number) { r._status = code; return r; },
    json(data: unknown)  { r._body   = data; return r; },
  };
  return r;
}

function makeNext(): { called: boolean; fn: NextFunction } {
  const obj = { called: false, fn: (() => { obj.called = true; }) as unknown as NextFunction };
  return obj;
}

// ---------------------------------------------------------------------------
// Helper: run middleware and return { status, body, nextCalled }
// ---------------------------------------------------------------------------

async function run(
  middlewareOpts: {
    header?: string;
    queryKey?: string;
    organizationId?: string;
  },
  envKey?: string | null,
  lookupFn = mockLookup,
) {
  // Manage env key
  const saved = process.env.READONLY_API_KEY;
  if (envKey === null) {
    delete process.env.READONLY_API_KEY;
  } else if (envKey !== undefined) {
    process.env.READONLY_API_KEY = envKey;
  } else {
    process.env.READONLY_API_KEY = GLOBAL_KEY; // default
  }

  const middleware = createApiKeyAuth(lookupFn);
  const req  = makeReq(middlewareOpts);
  const res  = makeRes() as unknown as Response;
  const next = makeNext();

  await middleware(req, res, next.fn);

  // Restore env
  if (saved === undefined) {
    delete process.env.READONLY_API_KEY;
  } else {
    process.env.READONLY_API_KEY = saved;
  }

  return {
    status:      (res as unknown as FakeRes)._status,
    body:        (res as unknown as FakeRes)._body,
    nextCalled:  next.called,
  };
}

// ---------------------------------------------------------------------------
// Szenario 1 — Cross-Org: Key von Org A wird für Org B abgelehnt
// ---------------------------------------------------------------------------

describe("Szenario 1 — Cross-Org-Isolierung", () => {
  test("Key von Org A gegen Org B → 403", async () => {
    // Restore default state before test
    orgStore[ORG_A_ID].readonlyApiKey = KEY_A;
    orgStore[ORG_B_ID].readonlyApiKey = KEY_B;

    const r = await run({ header: KEY_A, organizationId: ORG_B_ID });
    assert.equal(r.status, 403, "Erwartet HTTP 403 für Cross-Org-Key");
    assert.equal(r.nextCalled, false, "next() darf nicht aufgerufen werden");
  });

  test("Key von Org B gegen Org A → 403", async () => {
    orgStore[ORG_A_ID].readonlyApiKey = KEY_A;
    orgStore[ORG_B_ID].readonlyApiKey = KEY_B;

    const r = await run({ header: KEY_B, organizationId: ORG_A_ID });
    assert.equal(r.status, 403);
    assert.equal(r.nextCalled, false);
  });

  test("Richtiger Key für eigene Org A → next() wird aufgerufen", async () => {
    orgStore[ORG_A_ID].readonlyApiKey = KEY_A;

    const r = await run({ header: KEY_A, organizationId: ORG_A_ID });
    assert.equal(r.status, undefined, "Kein Fehler-Status erwartet");
    assert.equal(r.nextCalled, true);
  });

  test("Richtiger Key für eigene Org B → next() wird aufgerufen", async () => {
    orgStore[ORG_B_ID].readonlyApiKey = KEY_B;

    const r = await run({ header: KEY_B, organizationId: ORG_B_ID });
    assert.equal(r.status, undefined);
    assert.equal(r.nextCalled, true);
  });

  test("Nicht existierende Org → 403", async () => {
    const r = await run({ header: KEY_A, organizationId: "00000000-0000-0000-0000-999999999999" });
    assert.equal(r.status, 403);
    assert.equal(r.nextCalled, false);
  });
});

// ---------------------------------------------------------------------------
// Szenario 2 — Widerruf: nach DELETE schlägt der alte Key sofort fehl
// ---------------------------------------------------------------------------

describe("Szenario 2 — Widerruf (Revocation)", () => {
  test("Vor Widerruf: Key gültig → next() aufgerufen", async () => {
    orgStore[ORG_A_ID].readonlyApiKey = KEY_A;

    const r = await run({ header: KEY_A, organizationId: ORG_A_ID });
    assert.equal(r.nextCalled, true, "Vor Widerruf muss der Key akzeptiert werden");
  });

  test("Nach Widerruf (readonlyApiKey = null): alter Key sofort abgewiesen (≠ 200)", async () => {
    // Simulate DELETE /api/organization/api-key → sets readonlyApiKey to null
    orgStore[ORG_A_ID] = { id: ORG_A_ID, readonlyApiKey: null };

    // Old key is now invalid — middleware falls back to global env key.
    // KEY_A ≠ GLOBAL_KEY → 403.
    const r = await run({ header: KEY_A, organizationId: ORG_A_ID });
    assert.notEqual(r.status, undefined, "Fehler-Response muss gesetzt sein");
    assert.notEqual(r.status, 200, "Widerrufener Key darf keinen 200 produzieren");
    assert.equal(r.nextCalled, false, "next() darf nach Widerruf nicht aufgerufen werden");
  });

  test("Nach Widerruf: globaler Key als Fallback akzeptiert", async () => {
    orgStore[ORG_A_ID] = { id: ORG_A_ID, readonlyApiKey: null };

    // GLOBAL_KEY is the fallback when org has no own key
    const r = await run({ header: GLOBAL_KEY, organizationId: ORG_A_ID });
    assert.equal(r.status, undefined, "Globaler Key muss als Fallback funktionieren");
    assert.equal(r.nextCalled, true);

    // Restore for subsequent tests
    orgStore[ORG_A_ID].readonlyApiKey = KEY_A;
  });

  test("Nach Widerruf: kein globaler Key konfiguriert → 500 (kein 200)", async () => {
    orgStore[ORG_A_ID] = { id: ORG_A_ID, readonlyApiKey: null };

    const r = await run({ header: KEY_A, organizationId: ORG_A_ID }, null /* delete env key */);
    assert.equal(r.status, 500, "Fehlkonfiguration ohne Fallback-Key muss 500 liefern");
    assert.equal(r.nextCalled, false);

    orgStore[ORG_A_ID].readonlyApiKey = KEY_A;
  });
});

// ---------------------------------------------------------------------------
// Szenario 3 — Kein organization_id: org-spezifischer Key nicht akzeptiert
// ---------------------------------------------------------------------------

describe("Szenario 3 — Kein organization_id: nur globaler Key zählt", () => {
  test("Org-spezifischer Key (KEY_A) ohne organization_id → 403", async () => {
    orgStore[ORG_A_ID].readonlyApiKey = KEY_A;

    const r = await run({ header: KEY_A /* kein organizationId */ });
    assert.equal(r.status, 403,
      "Org-Key ohne organization_id muss abgewiesen werden (nur globaler Key gilt)");
    assert.equal(r.nextCalled, false);
  });

  test("Org-spezifischer Key (KEY_B) ohne organization_id → 403", async () => {
    orgStore[ORG_B_ID].readonlyApiKey = KEY_B;

    const r = await run({ header: KEY_B });
    assert.equal(r.status, 403);
    assert.equal(r.nextCalled, false);
  });

  test("Globaler Key ohne organization_id → next() aufgerufen", async () => {
    const r = await run({ header: GLOBAL_KEY });
    assert.equal(r.status, undefined, "Globaler Key ohne org_id muss akzeptiert werden");
    assert.equal(r.nextCalled, true);
  });

  test("Falscher Key ohne organization_id → 403", async () => {
    const r = await run({ header: "totally-wrong-key" });
    assert.equal(r.status, 403);
    assert.equal(r.nextCalled, false);
  });

  test("Kein Key angegeben → 401", async () => {
    const r = await run({ /* kein header, kein queryKey */ });
    assert.equal(r.status, 401, "Fehlender Key muss 401 liefern");
    assert.equal(r.nextCalled, false);
  });
});

// ---------------------------------------------------------------------------
// Zusätzlich: Key über Query-Parameter (api_key=...)
// ---------------------------------------------------------------------------

describe("Key als Query-Parameter (api_key=...)", () => {
  test("api_key=KEY_A + organization_id=ORG_A → akzeptiert", async () => {
    orgStore[ORG_A_ID].readonlyApiKey = KEY_A;

    const r = await run({ queryKey: KEY_A, organizationId: ORG_A_ID });
    assert.equal(r.nextCalled, true);
  });

  test("api_key=KEY_A + organization_id=ORG_B → 403 (Cross-Org)", async () => {
    orgStore[ORG_A_ID].readonlyApiKey = KEY_A;
    orgStore[ORG_B_ID].readonlyApiKey = KEY_B;

    const r = await run({ queryKey: KEY_A, organizationId: ORG_B_ID });
    assert.equal(r.status, 403);
    assert.equal(r.nextCalled, false);
  });

  test("api_key=GLOBAL_KEY ohne organization_id → akzeptiert", async () => {
    const r = await run({ queryKey: GLOBAL_KEY });
    assert.equal(r.nextCalled, true);
  });
});

// ---------------------------------------------------------------------------
// Fehlkonfiguration: READONLY_API_KEY fehlt
// ---------------------------------------------------------------------------

describe("Fehlkonfiguration — READONLY_API_KEY nicht gesetzt", () => {
  test("Org ohne eigenen Key + kein globaler Key → 500", async () => {
    orgStore[ORG_A_ID] = { id: ORG_A_ID, readonlyApiKey: null };

    const r = await run({ header: "any-key", organizationId: ORG_A_ID }, null);
    assert.equal(r.status, 500);
    assert.equal(r.nextCalled, false);

    orgStore[ORG_A_ID].readonlyApiKey = KEY_A;
  });

  test("Kein organization_id + kein globaler Key → 500", async () => {
    const r = await run({ header: "any-key" }, null);
    assert.equal(r.status, 500);
    assert.equal(r.nextCalled, false);
  });
});

// ---------------------------------------------------------------------------
// Datenbankfehler → 500
// ---------------------------------------------------------------------------

describe("Datenbankfehler", () => {
  test("Lookup wirft Fehler → 500", async () => {
    const brokenLookup = async (_id: string): Promise<OrgKeyRecord | undefined> => {
      throw new Error("DB connection lost");
    };

    const r = await run({ header: KEY_A, organizationId: ORG_A_ID }, GLOBAL_KEY, brokenLookup);
    assert.equal(r.status, 500);
    assert.equal(r.nextCalled, false);
  });
});
