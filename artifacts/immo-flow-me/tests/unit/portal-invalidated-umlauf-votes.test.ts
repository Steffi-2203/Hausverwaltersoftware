/**
 * Task #165 — Eigentümer sehen invalidierten Umlaufbeschluss sofort
 *
 * GET /api/owner-portal/invalidated-votes liefert Umlaufbeschlüsse,
 * die von passed=true auf passed=false gekippt sind (§ 24 Abs. 1 WEG 2002).
 *
 * Teststruktur:
 *   A) Kein Eintrag zurück wenn kein invalidation_warning gesetzt
 *   B) Eintrag zurück wenn invalidation_warning gesetzt (Kernfall)
 *   C) Cross-Org-Isolation: Org-B-Eigentümer sieht keine Org-A-Warnungen
 *   D) Kein Zugriff ohne Portal-Session → 401
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { rootDb as db } from '../../server/db';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { registerOwnerPortalRoutes } from '../../server/routes/ownerPortalRoutes';
import { calculateVoteResult } from '../../server/services/wegVotingService';

// ── Fixture A (Org mit invalidiertem Umlaufbeschluss) ───────────────────────

const orgA       = uuidv4();
const propA      = uuidv4();
const unitA1     = uuidv4();
const unitA2     = uuidv4();
const unitA3     = uuidv4();
const ownerA     = uuidv4();   // Eigentümer in Org A
const ownerA2    = uuidv4();   // weiterer Eigentümer (für MEA-Berechnung)
const ownerA3    = uuidv4();
const propOwnerA = uuidv4();
const opaA       = uuidv4();   // owner_portal_access für Eigentümer A
const assemblyA  = uuidv4();
const voteA      = uuidv4();

// ── Fixture B (andere Org, isoliert) ────────────────────────────────────────

const orgB       = uuidv4();
const propB      = uuidv4();
const ownerB     = uuidv4();
const propOwnerB = uuidv4();
const opaB       = uuidv4();
const assemblyB  = uuidv4();
const voteB      = uuidv4();
const unitB1     = uuidv4();
const unitB2     = uuidv4();
const unitB3     = uuidv4();
const ownerB2    = uuidv4();
const ownerB3    = uuidv4();

// ── App-Factory ───────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  // Testsession via Header injizieren (wie portal-cross-org-api.test.ts)
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const raw = req.headers['x-test-session'];
    (req as any).session = typeof raw === 'string' ? JSON.parse(raw) : {};
    next();
  });
  registerOwnerPortalRoutes(app as any);
  return app;
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

async function seedOrg(
  org: string, prop: string,
  units: [string, string, string], owners: [string, string, string],
  propOwner: string, opa: string, assembly: string, vote: string,
  tag: string,
) {
  const [u1, u2, u3] = units;
  const [o1, o2, o3] = owners;

  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${org}::uuid, ${'InvalOrg-' + tag}) ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${prop}::uuid, ${org}::uuid, ${'InvalHaus-' + tag}, 'Str 1', 'Wien', '1010', 'weg')
    ON CONFLICT DO NOTHING
  `);
  for (const [uid, top] of [[u1, 'A'], [u2, 'B'], [u3, 'C']] as const) {
    await db.execute(sql`
      INSERT INTO units (id, property_id, top_nummer, type, status)
      VALUES (${uid}::uuid, ${prop}::uuid, ${top}, 'wohnung', 'aktiv')
      ON CONFLICT DO NOTHING
    `);
  }
  for (const [oid, fn] of [[o1, 'Ana'], [o2, 'Ben'], [o3, 'Cla']] as const) {
    await db.execute(sql`
      INSERT INTO owners (id, organization_id, first_name, last_name)
      VALUES (${oid}::uuid, ${org}::uuid, ${fn}, ${'Inval-' + tag})
      ON CONFLICT DO NOTHING
    `);
  }
  await db.execute(sql`
    INSERT INTO property_owners (id, property_id, owner_id)
    VALUES (${propOwner}::uuid, ${prop}::uuid, ${o1}::uuid)
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO weg_unit_owners (property_id, organization_id, unit_id, owner_id, mea_share)
    VALUES
      (${prop}::uuid, ${org}::uuid, ${u1}::uuid, ${o1}::uuid, '333'),
      (${prop}::uuid, ${org}::uuid, ${u2}::uuid, ${o2}::uuid, '333'),
      (${prop}::uuid, ${org}::uuid, ${u3}::uuid, ${o3}::uuid, '334')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO owner_portal_access (id, organization_id, owner_id, email, is_active)
    VALUES (${opa}::uuid, ${org}::uuid, ${o1}::uuid, ${'inval-' + tag + '@test.at'}, true)
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO weg_assemblies (id, organization_id, property_id, title, assembly_date, is_circular_resolution, status)
    VALUES (${assembly}::uuid, ${org}::uuid, ${prop}::uuid, ${'Umlauf ' + tag}, NOW(), true, 'abgeschlossen')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO weg_votes (id, assembly_id, topic, vote_type, required_majority)
    VALUES (${vote}::uuid, ${assembly}::uuid, ${'Sanierung ' + tag}, 'umlauf', 'einstimmig')
    ON CONFLICT DO NOTHING
  `);
}

async function cleanupOrg(
  org: string, prop: string, units: string[], owners: string[],
  propOwner: string, opa: string, assembly: string, vote: string,
) {
  await db.execute(sql`DELETE FROM weg_vote_results WHERE vote_id = ${vote}::uuid`);
  await db.execute(sql`DELETE FROM weg_owner_votes  WHERE vote_id = ${vote}::uuid`);
  await db.execute(sql`DELETE FROM weg_votes        WHERE id = ${vote}::uuid`);
  await db.execute(sql`DELETE FROM weg_assemblies   WHERE id = ${assembly}::uuid`);
  await db.execute(sql`DELETE FROM weg_unit_owners  WHERE property_id = ${prop}::uuid`);
  await db.execute(sql`DELETE FROM owner_portal_access WHERE id = ${opa}::uuid`);
  await db.execute(sql`DELETE FROM property_owners  WHERE id = ${propOwner}::uuid`);
  await db.execute(sql`DELETE FROM units            WHERE property_id = ${prop}::uuid`);
  await db.execute(sql`DELETE FROM owners           WHERE id = ANY(${[...owners].map(o => o + '::uuid') as any})`);
  await db.execute(sql`DELETE FROM properties       WHERE id = ${prop}::uuid`);
  await db.execute(sql`DELETE FROM organizations    WHERE id = ${org}::uuid`);
}

// Einfacher: über raw SQL löschen
async function cleanupAll() {
  for (const vote of [voteA, voteB]) {
    await db.execute(sql`DELETE FROM weg_vote_results WHERE vote_id = ${vote}::uuid`);
    await db.execute(sql`DELETE FROM weg_owner_votes  WHERE vote_id = ${vote}::uuid`);
    await db.execute(sql`DELETE FROM weg_votes        WHERE id = ${vote}::uuid`);
  }
  for (const assembly of [assemblyA, assemblyB]) {
    await db.execute(sql`DELETE FROM weg_assemblies WHERE id = ${assembly}::uuid`);
  }
  for (const prop of [propA, propB]) {
    await db.execute(sql`DELETE FROM weg_unit_owners WHERE property_id = ${prop}::uuid`);
  }
  for (const opa of [opaA, opaB]) {
    await db.execute(sql`DELETE FROM owner_portal_access WHERE id = ${opa}::uuid`);
  }
  for (const po of [propOwnerA, propOwnerB]) {
    await db.execute(sql`DELETE FROM property_owners WHERE id = ${po}::uuid`);
  }
  for (const prop of [propA, propB]) {
    await db.execute(sql`DELETE FROM units WHERE property_id = ${prop}::uuid`);
  }
  for (const prop of [propA, propB]) {
    await db.execute(sql`DELETE FROM properties WHERE id = ${prop}::uuid`);
  }
  for (const owner of [ownerA, ownerA2, ownerA3, ownerB, ownerB2, ownerB3]) {
    await db.execute(sql`DELETE FROM owners WHERE id = ${owner}::uuid`);
  }
  for (const org of [orgA, orgB]) {
    await db.execute(sql`DELETE FROM organizations WHERE id = ${org}::uuid`);
  }
}

beforeAll(async () => {
  await cleanupAll();
  await seedOrg(
    orgA, propA, [unitA1, unitA2, unitA3], [ownerA, ownerA2, ownerA3],
    propOwnerA, opaA, assemblyA, voteA, 'A',
  );
  await seedOrg(
    orgB, propB, [unitB1, unitB2, unitB3], [ownerB, ownerB2, ownerB3],
    propOwnerB, opaB, assemblyB, voteB, 'B',
  );
});

afterAll(async () => {
  await cleanupAll();
});

// Hilfsfunktion: Abstimmung auf passed=true setzen, dann Flip erzeugen
async function seedInvalidation(vid: string, o1: string, o2: string, o3: string, orgId: string) {
  const stub = async () => {};
  // Alle Ja → passed=true
  for (const oid of [o1, o2, o3]) {
    await db.execute(sql`INSERT INTO weg_owner_votes (vote_id, owner_id, vote_value) VALUES (${vid}::uuid, ${oid}::uuid, 'ja')`);
  }
  await calculateVoteResult(vid, orgId, stub as any);
  // Nein-Stimme einfügen → passed=false → invalidation_warning
  await db.execute(sql`DELETE FROM weg_owner_votes WHERE vote_id = ${vid}::uuid`);
  await db.execute(sql`INSERT INTO weg_owner_votes (vote_id, owner_id, vote_value) VALUES (${vid}::uuid, ${o1}::uuid, 'ja')`);
  await db.execute(sql`INSERT INTO weg_owner_votes (vote_id, owner_id, vote_value) VALUES (${vid}::uuid, ${o2}::uuid, 'ja')`);
  await db.execute(sql`INSERT INTO weg_owner_votes (vote_id, owner_id, vote_value) VALUES (${vid}::uuid, ${o3}::uuid, 'nein')`);
  await calculateVoteResult(vid, orgId, stub as any);
}

async function clearVotes(vid: string) {
  await db.execute(sql`DELETE FROM weg_vote_results WHERE vote_id = ${vid}::uuid`);
  await db.execute(sql`DELETE FROM weg_owner_votes  WHERE vote_id = ${vid}::uuid`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('A) Kein Eintrag wenn kein invalidation_warning gesetzt', () => {
  test('Org-A-Eigentümer: leere Liste wenn Umlauf nie angenommen war', async () => {
    await clearVotes(voteA);
    const app = buildApp();
    const session = JSON.stringify({ ownerPortalId: opaA });
    const res = await request(app)
      .get('/api/owner-portal/invalidated-votes')
      .set('x-test-session', session);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });
});

describe('B) Eintrag zurück wenn invalidation_warning gesetzt (Kernfall)', () => {
  test('invalidation_warning erscheint nach true→false Flip', async () => {
    await clearVotes(voteA);
    await seedInvalidation(voteA, ownerA, ownerA2, ownerA3, orgA);

    const app = buildApp();
    const session = JSON.stringify({ ownerPortalId: opaA });
    const res = await request(app)
      .get('/api/owner-portal/invalidated-votes')
      .set('x-test-session', session);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);

    const entry = (res.body as any[]).find((v: any) => v.voteId === voteA);
    expect(entry).toBeDefined();
    expect(entry.invalidationWarning).not.toBeNull();
    expect(typeof entry.invalidationWarning).toBe('string');
    expect(entry.invalidationWarning).toContain('ACHTUNG');
    expect(entry.invalidationWarning).toContain('§ 24 Abs. 1 WEG 2002');
    expect(entry.propertyName).toBe('InvalHaus-A');
    expect(entry.topic).toBe('Sanierung A');

    await clearVotes(voteA);
  });
});

describe('C) Cross-Org-Isolation: Org-B-Eigentümer sieht keine Org-A-Warnungen', () => {
  test('Org A hat Warnung, Org B bekommt leere Liste', async () => {
    await clearVotes(voteA);
    await clearVotes(voteB);

    // Org A: Invalidierung anlegen
    await seedInvalidation(voteA, ownerA, ownerA2, ownerA3, orgA);

    const app = buildApp();

    // Org-B-Session: soll nichts von Org A sehen
    const sessionB = JSON.stringify({ ownerPortalId: opaB });
    const resB = await request(app)
      .get('/api/owner-portal/invalidated-votes')
      .set('x-test-session', sessionB);
    expect(resB.status).toBe(200);
    expect(resB.body).toHaveLength(0);

    // Org-A-Session: sieht eigene Warnung
    const sessionA = JSON.stringify({ ownerPortalId: opaA });
    const resA = await request(app)
      .get('/api/owner-portal/invalidated-votes')
      .set('x-test-session', sessionA);
    expect(resA.status).toBe(200);
    expect(resA.body.length).toBeGreaterThanOrEqual(1);
    const voteIds = (resA.body as any[]).map((v: any) => v.voteId);
    expect(voteIds).toContain(voteA);
    expect(voteIds).not.toContain(voteB);

    await clearVotes(voteA);
    await clearVotes(voteB);
  });
});

describe('D) Kein Zugriff ohne Portal-Session → 401', () => {
  test('Kein x-test-session Header → 401', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/owner-portal/invalidated-votes');
    expect(res.status).toBe(401);
  });
});
