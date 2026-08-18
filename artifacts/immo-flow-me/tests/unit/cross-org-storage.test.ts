/**
 * Regression test: storage operations executed through the production middleware
 * stack (rlsMiddleware) must be scoped to the requesting org.
 *
 * Scenario: Org-A creates a property. A request authenticated as Org-B queries
 * all properties through storage. RLS must return an empty list — Org-B must
 * never see Org-A's property.
 *
 * This guards against the regression where storage was switched to rootDb
 * (bypassing RLS) instead of being kept on the orgContext-bound db proxy.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { v4 as uuidv4 } from "uuid";
import { rootDb } from "../../server/db";
import * as schema from "../../shared/schema";
import { cleanupOrgById } from "../../scripts/cleanup-test-data";
import { rlsMiddleware } from "../../server/middleware/rlsMiddleware";
import { storage } from "../../server/storage";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

async function createOrg(name: string) {
  const [org] = await rootDb
    .insert(schema.organizations)
    .values({ id: uuidv4(), name, subscriptionTier: "starter" })
    .returning();
  return org;
}

async function createProperty(orgId: string, name: string) {
  const [prop] = await rootDb
    .insert(schema.properties)
    .values({
      id: uuidv4(),
      organizationId: orgId,
      name,
      address: "Testgasse 1",
      postalCode: "1010",
      city: "Wien",
      country: "AT",
    } as any)
    .returning();
  return prop;
}

// ---------------------------------------------------------------------------
// Test app factory — mirrors production middleware order
// ---------------------------------------------------------------------------

function buildStorageApp(sessionOrgId: string) {
  const app = express();
  app.use(express.json());

  // Inject session with organizationId (same as production after login)
  app.use((req: any, _res, next) => {
    req.session = { organizationId: sessionOrgId };
    next();
  });

  // Production RLS middleware
  app.use(rlsMiddleware);

  // Route that reads all properties via storage (no explicit org filter)
  app.get("/properties", async (_req, res) => {
    try {
      const props = await storage.getProperties();
      res.json(props);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cross-org storage isolation via rlsMiddleware", () => {
  let orgA: schema.Organization;
  let orgB: schema.Organization;
  let propertyA: any;

  before(async () => {
    orgA = await createOrg("CrossOrgTest-A-" + uuidv4().slice(0, 8));
    orgB = await createOrg("CrossOrgTest-B-" + uuidv4().slice(0, 8));
    propertyA = await createProperty(orgA.id, "Liegenschaft-A");
  });

  after(async () => {
    // cleanupOrgById() löscht alle FK-Abhängigkeiten in korrekter topologischer
    // Reihenfolge (Blätter zuerst) und dann die Organisation selbst.
    // Wirft bei Fehler — kein silent-ignore.
    for (const org of [orgA, orgB]) {
      await cleanupOrgById(org.id);
    }
  });

  it("Org-B cannot read Org-A's property via storage.getProperties()", async () => {
    const app = buildStorageApp(orgB.id);
    const res = await (request(app) as any).get("/properties");

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);

    const ids: string[] = (res.body as any[]).map((p: any) => p.id);
    assert.ok(
      !ids.includes(propertyA.id),
      `Org-B should not see Org-A's property ${propertyA.id}, but got: ${ids.join(", ")}`
    );
  });

  it("Org-A can read its own property via storage.getProperties()", async () => {
    const app = buildStorageApp(orgA.id);
    const res = await (request(app) as any).get("/properties");

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);

    const ids: string[] = (res.body as any[]).map((p: any) => p.id);
    assert.ok(
      ids.includes(propertyA.id),
      `Org-A should see its own property ${propertyA.id}`
    );
  });
});
