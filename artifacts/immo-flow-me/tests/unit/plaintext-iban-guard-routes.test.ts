import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { requireProductionIbanScanAccess } from "../../server/routes/plaintextIbanGuardRoutes";

const originalAdminEmail = process.env.ADMIN_EMAIL;

after(() => {
  if (originalAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = originalAdminEmail;
});

function runGuard(email?: string): { statusCode?: number; body?: unknown; allowed: boolean } {
  const result: { statusCode?: number; body?: unknown; allowed: boolean } = { allowed: false };
  const req = { session: email ? { email } : {} } as any;
  const res = {
    status: (statusCode: number) => {
      result.statusCode = statusCode;
      return res;
    },
    json: (body: unknown) => {
      result.body = body;
      return res;
    },
  } as any;

  requireProductionIbanScanAccess(req, res, () => {
    result.allowed = true;
  });
  return result;
}

describe("Produktions-Klartext-IBAN-Scan: Zugriffsschutz", () => {
  it("verweigert Organisations-Admins ohne konfigurierte Plattform-E-Mail", () => {
    process.env.ADMIN_EMAIL = "platform@example.test";
    const result = runGuard("org-admin@example.test");

    assert.equal(result.allowed, false);
    assert.equal(result.statusCode, 403);
  });

  it("verweigert den Scan fail-closed, wenn ADMIN_EMAIL fehlt", () => {
    delete process.env.ADMIN_EMAIL;
    const result = runGuard("platform@example.test");

    assert.equal(result.allowed, false);
    assert.equal(result.statusCode, 403);
  });

  it("lässt nur die konfigurierte Plattform-Administration durch", () => {
    process.env.ADMIN_EMAIL = "platform@example.test";
    const result = runGuard("PLATFORM@example.test");

    assert.equal(result.allowed, true);
    assert.equal(result.statusCode, undefined);
  });
});