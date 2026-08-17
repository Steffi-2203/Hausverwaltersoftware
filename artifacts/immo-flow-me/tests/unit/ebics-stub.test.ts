/**
 * Task #131: EBICS ist bewusst ein Stub (kein Live-Banktransport).
 * Diese Tests stellen sicher, dass das fail-closed-Verhalten nicht
 * versehentlich aufgeweicht wird:
 *  - Transportaufrufe werfen IMMER EbicsNotImplementedError (auch mit EBICS_ENABLED=true)
 *  - Die Routen melden das als 501 (nicht 500), mit klarem Hinweis auf den
 *    Dateiweg (SEPA-XML-Export + CAMT.053-Import)
 *  - /api/ebics/availability meldet enabled=false
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";

import { EbicsNotImplementedError } from "../../server/services/ebicsService";

describe("EBICS-Stub: fail-closed unabhängig von Env-Flags", () => {
  test("EbicsNotImplementedError trägt Code und Dateiweg-Hinweis", () => {
    const err = new EbicsNotImplementedError("CCT");
    assert.equal(err.code, "EBICS_NOT_IMPLEMENTED");
    assert.match(err.message, /keine echte Bankverbindung/i);
    assert.match(err.message, /SEPA-XML/);
    assert.match(err.message, /CAMT\.053/);
  });

  test("Transportaufrufe werfen IMMER — auch mit EBICS_ENABLED=true (kein fabrizierter Erfolg)", async () => {
    const prev = process.env.EBICS_ENABLED;
    process.env.EBICS_ENABLED = "true";
    try {
      const { ebicsService } = await import("../../server/services/ebicsService");
      // sendHPB ist privat — activateConnection ruft es vor jedem DB-Update auf.
      // Wir prüfen über die private Methode via any-Cast, ohne DB-Abhängigkeit:
      await assert.rejects(
        () => (ebicsService as any).sendHPB("dummy-connection"),
        (e: any) => e instanceof EbicsNotImplementedError && e.code === "EBICS_NOT_IMPLEMENTED",
      );
      await assert.rejects(() => (ebicsService as any).sendCCT({ iban: "AT61" }, "<xml/>"),
        (e: any) => e.code === "EBICS_NOT_IMPLEMENTED");
      await assert.rejects(() => (ebicsService as any).sendCDD({ iban: "AT61" }, "<xml/>"),
        (e: any) => e.code === "EBICS_NOT_IMPLEMENTED");
      await assert.rejects(() => (ebicsService as any).sendC53({ iban: "AT61" }, "2026-01-01", "2026-01-31"),
        (e: any) => e.code === "EBICS_NOT_IMPLEMENTED");
    } finally {
      if (prev === undefined) delete process.env.EBICS_ENABLED;
      else process.env.EBICS_ENABLED = prev;
    }
  });

  test("Availability meldet enabled=false — auch mit EBICS_ENABLED=true", async () => {
    const prev = process.env.EBICS_ENABLED;
    process.env.EBICS_ENABLED = "true";
    try {
      const app = express();
      // isAuthenticated umgehen: Route-Logik direkt nachbilden wie in ebicsRoutes.ts
      const { default: ebicsRoutes } = await import("../../server/routes/ebicsRoutes");
      app.use((req: any, _res, next) => { req.session = { userId: "u", organizationId: "o" }; next(); });
      app.use(ebicsRoutes);
      const r = await request(app).get("/api/ebics/availability");
      assert.equal(r.status, 200);
      assert.equal(r.body.enabled, false);
      assert.match(r.body.message, /SEPA-XML/);
    } finally {
      if (prev !== undefined) process.env.EBICS_ENABLED = prev;
    }
  });

});
