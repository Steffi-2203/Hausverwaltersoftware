/**
 * Task #165: Eigentümer sehen nachträglich ungültig gewordene Umlaufbeschlüsse
 *
 * GET /api/weg/votes muss invalidation_warning aus weg_vote_results per
 * LEFT JOIN mitliefern, damit das Frontend einen roten Warnbanner anzeigen kann.
 *
 * Teststruktur:
 *   A) Kein invalidation_warning wenn Umlauf noch nie passed=true war
 *   B) invalidation_warning gesetzt wenn passed=true → false Flip stattgefunden hat
 *   C) Normale Versammlungsabstimmung: invalidation_warning immer null
 */

import { describe, test, before as beforeAll, after as afterAll, afterEach } from 'node:test';
import { expect } from '../helpers/expect';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { rootDb as db } from '../../server/db';
import { sql, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { calculateVoteResult } from '../../server/services/wegVotingService';
import wegRouter from '../../server/routes/wegRoutes';
import { addOrgContext } from '../helpers/withOrgContext';

// ── Seed-Konstanten ───────────────────────────────────────────────────────────

const orgId      = uuidv4();
const propId     = uuidv4();
const assemblyId = uuidv4();
const voteId     = uuidv4();
const voteId2    = uuidv4(); // Versammlungsabstimmung (Test C)
const ownerA     = uuidv4();
const ownerB     = uuidv4();
const ownerC     = uuidv4();
const unitA      = uuidv4();
const unitB      = uuidv4();
const unitC      = uuidv4();
const userId     = uuidv4();

// ── App-Factory ───────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organizationId: orgId };
    next();
  });
  addOrgContext(app, orgId);
  app.use(wegRouter);
  return app;
}

// ── DB-Hilfsfunktionen ────────────────────────────────────────────────────────

async function clearVotes() {
  await db.execute(sql`DELETE FROM weg_vote_results WHERE vote_id IN (${voteId}::uuid, ${voteId2}::uuid)`);
  await db.execute(sql`DELETE FROM weg_owner_votes  WHERE vote_id IN (${voteId}::uuid, ${voteId2}::uuid)`);
}

async function seedOwnerVote(vid: string, ownerId: string, val: 'ja' | 'nein' | 'enthaltung') {
  await db.execute(sql`
    INSERT INTO weg_owner_votes (vote_id, owner_id, vote_value)
    VALUES (${vid}::uuid, ${ownerId}::uuid, ${val})
  `);
}

// ── Gesamtes Fixture ──────────────────────────────────────────────────────────

async function seedAll() {
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'WarnApi-Org') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'WarnApi-Haus', 'Gasse 1', 'Wien', '1010', 'weg')
    ON CONFLICT DO NOTHING
  `);
  for (const [uid, top] of [[unitA, 'A'], [unitB, 'B'], [unitC, 'C']] as const) {
    await db.execute(sql`
      INSERT INTO units (id, property_id, top_nummer, type, status)
      VALUES (${uid}::uuid, ${propId}::uuid, ${top}, 'wohnung', 'aktiv')
      ON CONFLICT DO NOTHING
    `);
  }
  for (const [oid, fn] of [[ownerA, 'Ana'], [ownerB, 'Ben'], [ownerC, 'Cla']] as const) {
    await db.execute(sql`
      INSERT INTO owners (id, organization_id, first_name, last_name)
      VALUES (${oid}::uuid, ${orgId}::uuid, ${fn}, 'Api')
      ON CONFLICT DO NOTHING
    `);
  }
  await db.execute(sql`
    INSERT INTO weg_unit_owners (property_id, organization_id, unit_id, owner_id, mea_share)
    VALUES
      (${propId}::uuid, ${orgId}::uuid, ${unitA}::uuid, ${ownerA}::uuid, '333'),
      (${propId}::uuid, ${orgId}::uuid, ${unitB}::uuid, ${ownerB}::uuid, '333'),
      (${propId}::uuid, ${orgId}::uuid, ${unitC}::uuid, ${ownerC}::uuid, '334')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO weg_assemblies (id, organization_id, property_id, title, assembly_date, is_circular_resolution, status)
    VALUES (${assemblyId}::uuid, ${orgId}::uuid, ${propId}::uuid, 'Umlauf API-Test', NOW(), true, 'abgeschlossen')
    ON CONFLICT DO NOTHING
  `);
  // Umlaufbeschluss
  await db.execute(sql`
    INSERT INTO weg_votes (id, assembly_id, topic, vote_type, required_majority)
    VALUES (${voteId}::uuid, ${assemblyId}::uuid, 'Sanierung API-Test', 'umlauf', 'einstimmig')
    ON CONFLICT DO NOTHING
  `);
  // Normale Versammlungsabstimmung (Test C)
  await db.execute(sql`
    INSERT INTO weg_votes (id, assembly_id, topic, vote_type, required_majority)
    VALUES (${voteId2}::uuid, ${assemblyId}::uuid, 'Hausordnung', 'versammlung', 'einfach')
    ON CONFLICT DO NOTHING
  `);
  // User für Auth-Kontext
  const uniqueEmail = `warn-api-${userId.slice(0, 8)}@test.at`;
  await db.execute(sql`
    INSERT INTO profiles (id, email, organization_id) VALUES (${userId}::uuid, ${uniqueEmail}, ${orgId}::uuid)
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO user_roles (user_id, role) VALUES (${userId}::uuid, 'admin') ON CONFLICT DO NOTHING
  `);
}

async function cleanupAll() {
  await db.execute(sql`DELETE FROM weg_vote_results WHERE vote_id IN (${voteId}::uuid, ${voteId2}::uuid)`);
  await db.execute(sql`DELETE FROM weg_owner_votes  WHERE vote_id IN (${voteId}::uuid, ${voteId2}::uuid)`);
  await db.execute(sql`DELETE FROM weg_votes        WHERE id IN (${voteId}::uuid, ${voteId2}::uuid)`);
  await db.execute(sql`DELETE FROM weg_assemblies   WHERE id = ${assemblyId}::uuid`);
  await db.execute(sql`DELETE FROM weg_unit_owners  WHERE property_id = ${propId}::uuid`);
  await db.execute(sql`DELETE FROM units            WHERE property_id = ${propId}::uuid`);
  await db.execute(sql`DELETE FROM properties       WHERE id = ${propId}::uuid`);
  await db.execute(sql`DELETE FROM owners           WHERE id IN (${ownerA}::uuid,${ownerB}::uuid,${ownerC}::uuid)`);
  await db.execute(sql`DELETE FROM user_roles       WHERE user_id = ${userId}::uuid`);
  await db.execute(sql`DELETE FROM profiles         WHERE id = ${userId}::uuid`);
  await db.execute(sql`DELETE FROM organizations    WHERE id = ${orgId}::uuid`);
}

// ─────────────────────────────────────────────────────────────────────────────

describe('A) GET /api/weg/votes — kein invalidation_warning ohne vorherigen passed=true', () => {
  beforeAll(async () => { await cleanupAll(); await seedAll(); });
  afterAll(async  () => { await cleanupAll(); });
  afterEach(async () => { await clearVotes(); });

  test('Umlauf wurde nie angenommen → invalidation_warning fehlt oder ist null', async () => {
    const stub = async () => {};
    await seedOwnerVote(voteId, ownerA, 'ja');
    await seedOwnerVote(voteId, ownerB, 'ja');
    await seedOwnerVote(voteId, ownerC, 'nein'); // noch nie passed=true gewesen
    await calculateVoteResult(voteId, orgId, stub as any);

    const app = buildApp();
    const res = await request(app).get(`/api/weg/votes?assemblyId=${assemblyId}`);
    expect(res.status).toBe(200);

    const umlaufVote = (res.body as any[]).find((v: any) => v.id === voteId);
    expect(umlaufVote).toBeDefined();
    // Kein Flip → invalidation_warning muss null oder nicht gesetzt sein
    expect(umlaufVote.invalidation_warning ?? null).toBeNull();
  });
});

describe('B) GET /api/weg/votes — invalidation_warning nach true→false Flip', () => {
  beforeAll(async () => { await cleanupAll(); await seedAll(); });
  afterAll(async  () => { await cleanupAll(); });
  afterEach(async () => { await clearVotes(); });

  test('Alle Ja → passed=true; dann Nein → invalidation_warning wird mitgeliefert', async () => {
    const stub = async () => {};
    const app = buildApp();

    // Schritt 1: Alle drei stimmen Ja → passed=true
    await seedOwnerVote(voteId, ownerA, 'ja');
    await seedOwnerVote(voteId, ownerB, 'ja');
    await seedOwnerVote(voteId, ownerC, 'ja');
    await calculateVoteResult(voteId, orgId, stub as any);

    // Bestätigen: noch kein invalidation_warning
    const res1 = await request(app).get(`/api/weg/votes?assemblyId=${assemblyId}`);
    expect(res1.status).toBe(200);
    const before = (res1.body as any[]).find((v: any) => v.id === voteId);
    expect(before.invalidation_warning ?? null).toBeNull();

    // Schritt 2: C ändert zu Nein → passed=false → Warning wird erzeugt
    await clearVotes();
    await seedOwnerVote(voteId, ownerA, 'ja');
    await seedOwnerVote(voteId, ownerB, 'ja');
    await seedOwnerVote(voteId, ownerC, 'nein');

    // Wir müssen weg_vote_results manuell auf passed=true setzen (simuliert Flip)
    await db.execute(sql`
      INSERT INTO weg_vote_results (vote_id, passed, quorum_reached, yes_shares, no_shares, abstain_shares,
        yes_count, no_count, abstain_count, result_text, kopf_majority_reached, kopf_result_text)
      VALUES (${voteId}::uuid, true, true, '1000', '0', '0', 3, 0, 0, 'Angenommen', true, 'Kopfmehrheit')
      ON CONFLICT (vote_id) DO UPDATE SET passed = true
    `);
    await calculateVoteResult(voteId, orgId, stub as any);

    const res2 = await request(app).get(`/api/weg/votes?assemblyId=${assemblyId}`);
    expect(res2.status).toBe(200);
    const after = (res2.body as any[]).find((v: any) => v.id === voteId);
    expect(after.invalidation_warning).not.toBeNull();
    expect(typeof after.invalidation_warning).toBe('string');
    expect(after.invalidation_warning).toContain('ACHTUNG');
    expect(after.invalidation_warning).toContain('§ 24 Abs. 1 WEG 2002');
  });
});

describe('C) GET /api/weg/votes — normale Versammlung hat nie invalidation_warning', () => {
  beforeAll(async () => { await cleanupAll(); await seedAll(); });
  afterAll(async  () => { await cleanupAll(); });
  afterEach(async () => { await clearVotes(); });

  test('Versammlungsabstimmung: invalidation_warning immer null', async () => {
    const app = buildApp();
    const res = await request(app).get(`/api/weg/votes?assemblyId=${assemblyId}`);
    expect(res.status).toBe(200);
    const normalVote = (res.body as any[]).find((v: any) => v.id === voteId2);
    expect(normalVote).toBeDefined();
    expect(normalVote.invalidation_warning ?? null).toBeNull();
  });
});
