/**
 * Umlaufbeschluss-Invalidierung bei nachträglichem Nein (Task #49)
 *
 * § 24 Abs. 1 WEG 2002: Ein Umlaufbeschluss erfordert die schriftliche
 * Zustimmung ALLER Miteigentümer. Sobald ein Eigentümer nachträglich
 * mit "nein" stimmt, muss das persistierte Ergebnis auf passed=false
 * gesetzt werden — auch wenn es zuvor als angenommen gespeichert war.
 *
 * Teststruktur:
 *   A) Reine Logik (computeUmlaufOutcome) — ohne DB
 *   B) calculateVoteResult() Persistenz — mit DB, direkter Service-Aufruf
 *   C) Endpoint-Level Regression — POST /api/weg/owner-votes mit Session-Injection
 *   D) Grenzfälle
 */

import { describe, it, test, before as beforeAll, after as afterAll, afterEach } from 'node:test';
import { expect } from '../helpers/expect';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { rootDb as db } from '../../server/db';
import { sql, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import {
  computeUmlaufOutcome,
  calculateVoteResult,
  type RawOwnerVote,
} from '../../server/services/wegVotingService';
import { wegVoteResults } from '@shared/schema';
import wegRouter from '../../server/routes/wegRoutes';
import { addOrgContext } from '../helpers/withOrgContext';

// ── Reine Logik-Tests (keine DB) ─────────────────────────────────────────────

function v(id: string, value: 'ja' | 'nein' | 'enthaltung'): RawOwnerVote {
  return { ownerId: id, meaShare: 100, voteValue: value };
}

describe('A) computeUmlaufOutcome — Late-Override-Szenarien (reine Logik)', () => {
  it('alle 3 stimmen Ja → passed=true', () => {
    const out = computeUmlaufOutcome([v('A', 'ja'), v('B', 'ja'), v('C', 'ja')], 3);
    expect(out.passed).toBe(true);
    expect(out.noCount).toBe(0);
  });

  it('2 Ja + 1 Nein → passed=false (§ 24 Abs. 1)', () => {
    const out = computeUmlaufOutcome([v('A', 'ja'), v('B', 'ja'), v('C', 'nein')], 3);
    expect(out.passed).toBe(false);
    expect(out.noCount).toBe(1);
  });

  it('Nein-Stimme wird nachträglich zu Ja überschrieben → passed=true', () => {
    const votes: RawOwnerVote[] = [
      v('A', 'ja'), v('B', 'ja'),
      v('C', 'nein'),
      v('C', 'ja'),    // Late-Override
    ];
    const out = computeUmlaufOutcome(votes, 3);
    expect(out.passed).toBe(true);
    expect(out.noCount).toBe(0);
    expect(out.yesCount).toBe(3);
  });

  it('Ja-Stimme wird nachträglich zu Nein → passed=false (Kernfall)', () => {
    const votes: RawOwnerVote[] = [
      v('A', 'ja'), v('B', 'ja'),
      v('C', 'ja'),    // alle Ja → wäre angenommen
      v('C', 'nein'),  // nachträgliches Nein → invalidiert
    ];
    const out = computeUmlaufOutcome(votes, 3);
    expect(out.passed).toBe(false);
    expect(out.noCount).toBe(1);
    expect(out.yesCount).toBe(2);
  });

  it('Enthaltung invalidiert Umlauf', () => {
    const out = computeUmlaufOutcome([v('A', 'ja'), v('B', 'ja'), v('C', 'enthaltung')], 3);
    expect(out.passed).toBe(false);
    expect(out.abstainCount).toBe(1);
  });

  it('2 von 3 stimmen Ja (1 fehlt) → passed=false, missingCount=1', () => {
    const out = computeUmlaufOutcome([v('A', 'ja'), v('B', 'ja')], 3);
    expect(out.passed).toBe(false);
    expect(out.missingCount).toBe(1);
  });

  it('Keine Stimmen → passed=false, missingCount=3', () => {
    const out = computeUmlaufOutcome([], 3);
    expect(out.passed).toBe(false);
    expect(out.missingCount).toBe(3);
  });
});

// ── Geteilte Seed-Daten für B + C + D ────────────────────────────────────────

const orgId      = uuidv4();
const propId     = uuidv4();
const assemblyId = uuidv4();
const voteId     = uuidv4();
const ownerA     = uuidv4();
const ownerB     = uuidv4();
const ownerC     = uuidv4();
const unitA      = uuidv4();
const unitB      = uuidv4();
const unitC      = uuidv4();
// Für Endpoint-Test: profile + user_role damit getAuthContext() funktioniert
const userId     = uuidv4();

async function getPersistedResult() {
  const rows = await db
    .select()
    .from(wegVoteResults)
    .where(eq(wegVoteResults.voteId, voteId))
    .limit(1);
  return rows[0] ?? null;
}

async function clearOwnerVotes() {
  await db.execute(sql`DELETE FROM weg_owner_votes WHERE vote_id = ${voteId}::uuid`);
  await db.execute(sql`DELETE FROM weg_vote_results WHERE vote_id = ${voteId}::uuid`);
}

async function seedOwnerVote(ownerId: string, voteValue: 'ja' | 'nein' | 'enthaltung') {
  await db.execute(sql`
    INSERT INTO weg_owner_votes (vote_id, owner_id, vote_value)
    VALUES (${voteId}::uuid, ${ownerId}::uuid, ${voteValue})
  `);
}

async function seedAll() {
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'Umlauf-Test-Org') ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'Umlaufhaus', 'Umlaufgasse 49', 'Wien', '1010', 'weg')
    ON CONFLICT DO NOTHING
  `);

  for (const [uid, top] of [[unitA,'Top A'],[unitB,'Top B'],[unitC,'Top C']] as const) {
    await db.execute(sql`
      INSERT INTO units (id, property_id, top_nummer, type, status)
      VALUES (${uid}::uuid, ${propId}::uuid, ${top}, 'wohnung', 'aktiv')
      ON CONFLICT DO NOTHING
    `);
  }

  for (const [oid, fn, ln] of [
    [ownerA,'Anna','Umlauf'],[ownerB,'Bruno','Umlauf'],[ownerC,'Clara','Nein']
  ] as const) {
    await db.execute(sql`
      INSERT INTO owners (id, organization_id, first_name, last_name)
      VALUES (${oid}::uuid, ${orgId}::uuid, ${fn}, ${ln})
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
    VALUES (${assemblyId}::uuid, ${orgId}::uuid, ${propId}::uuid, 'Umlaufbeschluss 49', NOW(), true, 'abgeschlossen')
    ON CONFLICT DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO weg_votes (id, assembly_id, topic, vote_type, required_majority)
    VALUES (${voteId}::uuid, ${assemblyId}::uuid, 'Dachsanierung beschließen', 'umlauf', 'einstimmig')
    ON CONFLICT DO NOTHING
  `);

  // Profile + Rolle für Endpoint-Auth (getAuthContext liest profiles + user_roles)
  await db.execute(sql`
    INSERT INTO profiles (id, email, organization_id)
    VALUES (${userId}::uuid, ${'umlauf-test-' + userId.slice(0,8) + '@test.at'}, ${orgId}::uuid)
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO user_roles (user_id, role)
    VALUES (${userId}::uuid, 'admin')
    ON CONFLICT DO NOTHING
  `);
}

async function cleanupAll() {
  await db.execute(sql`DELETE FROM weg_vote_results WHERE vote_id = ${voteId}::uuid`);
  await db.execute(sql`DELETE FROM weg_owner_votes  WHERE vote_id = ${voteId}::uuid`);
  await db.execute(sql`DELETE FROM weg_votes        WHERE id = ${voteId}::uuid`);
  await db.execute(sql`DELETE FROM weg_assemblies   WHERE id = ${assemblyId}::uuid`);
  await db.execute(sql`DELETE FROM weg_unit_owners  WHERE property_id = ${propId}::uuid`);
  await db.execute(sql`DELETE FROM units            WHERE property_id = ${propId}::uuid`);
  await db.execute(sql`DELETE FROM properties       WHERE id = ${propId}::uuid`);
  await db.execute(sql`DELETE FROM owners           WHERE id IN (${ownerA}::uuid,${ownerB}::uuid,${ownerC}::uuid)`);
  await db.execute(sql`DELETE FROM user_roles       WHERE user_id = ${userId}::uuid`);
  await db.execute(sql`DELETE FROM profiles         WHERE id = ${userId}::uuid`);
  await db.execute(sql`DELETE FROM organizations    WHERE id = ${orgId}::uuid`);
}

// ── B) calculateVoteResult() — Persistenz ─────────────────────────────────────

describe('B) calculateVoteResult() — Persistenz in wegVoteResults', () => {
  beforeAll(async () => { await cleanupAll(); await seedAll(); });
  afterAll(async  () => { await cleanupAll(); });
  afterEach(async () => { await clearOwnerVotes(); });

  test('Alle 3 Ja → persistiert passed=true', async () => {
    await seedOwnerVote(ownerA, 'ja');
    await seedOwnerVote(ownerB, 'ja');
    await seedOwnerVote(ownerC, 'ja');

    const result = await calculateVoteResult(voteId, orgId);
    expect(result.majorityReached).toBe(true);

    const stored = await getPersistedResult();
    expect(stored).not.toBeNull();
    expect(stored!.passed).toBe(true);
    expect(stored!.noCount).toBe(0);
    expect(stored!.yesCount).toBe(3);
  });

  test('2 Ja + 1 Nein → persistiert passed=false', async () => {
    await seedOwnerVote(ownerA, 'ja');
    await seedOwnerVote(ownerB, 'ja');
    await seedOwnerVote(ownerC, 'nein');

    const result = await calculateVoteResult(voteId, orgId);
    expect(result.majorityReached).toBe(false);

    const stored = await getPersistedResult();
    expect(stored!.passed).toBe(false);
    expect(stored!.noCount).toBe(1);
    expect(stored!.yesCount).toBe(2);
  });

  test('Alle Ja, dann Neuberechnung nach Nein: passed wechselt true→false', async () => {
    // Schritt 1: alle Ja → passed=true
    await seedOwnerVote(ownerA, 'ja');
    await seedOwnerVote(ownerB, 'ja');
    await seedOwnerVote(ownerC, 'ja');
    await calculateVoteResult(voteId, orgId);
    expect((await getPersistedResult())!.passed).toBe(true);

    // Schritt 2: C ändert zu Nein (neuer Row — letzte Stimme gilt per ORDER BY createdAt)
    await seedOwnerVote(ownerC, 'nein');
    await calculateVoteResult(voteId, orgId);

    const stored = await getPersistedResult();
    expect(stored!.passed).toBe(false);
    expect(stored!.noCount).toBe(1);
    expect(stored!.yesCount).toBe(2);
  });

  test('Resulttext nach Nein: § 24-Verweis + "Nein-Stimme" + "abgelehnt"', async () => {
    await seedOwnerVote(ownerA, 'ja');
    await seedOwnerVote(ownerB, 'ja');
    await seedOwnerVote(ownerC, 'nein');
    const result = await calculateVoteResult(voteId, orgId);
    expect(result.resultText).toMatch(/Nein-Stimme/i);
    expect(result.resultText).toMatch(/§ 24/);
    expect(result.resultText).toMatch(/abgelehnt/i);
  });

  test('Rücknahme Nein→Ja: passed=true wiederhergestellt', async () => {
    await seedOwnerVote(ownerA, 'ja');
    await seedOwnerVote(ownerB, 'ja');
    await seedOwnerVote(ownerC, 'nein');
    await calculateVoteResult(voteId, orgId);
    expect((await getPersistedResult())!.passed).toBe(false);

    // C korrigiert zu Ja
    await seedOwnerVote(ownerC, 'ja');
    await calculateVoteResult(voteId, orgId);
    const stored = await getPersistedResult();
    expect(stored!.passed).toBe(true);
    expect(stored!.noCount).toBe(0);
    expect(stored!.yesCount).toBe(3);
  });

  test('Org-Isolation: fremde orgId → Exception', async () => {
    await expect(calculateVoteResult(voteId, uuidv4())).rejects.toThrow();
  });
});

// ── C) Endpoint-Level Regression ─────────────────────────────────────────────
// Testet den kompletten Flow durch POST /api/weg/owner-votes:
// Stimme einfügen + sofortige Neuberechnung + Persistenz in einem Request.

function buildApp(uid: string) {
  const app = express();
  app.use(express.json());
  // Session-Injection: getAuthContext() liest (req.session as any).userId
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: uid, organizationId: orgId };
    next();
  });
  addOrgContext(app, orgId);
  app.use(wegRouter);
  return app;
}

describe('C) POST /api/weg/owner-votes — Endpoint-Level Regression', () => {
  beforeAll(async () => { await cleanupAll(); await seedAll(); });
  afterAll(async  () => { await cleanupAll(); });
  afterEach(async () => { await clearOwnerVotes(); });

  test('POST alle 3 Ja → wegVoteResults.passed=true', async () => {
    const app = buildApp(userId);

    for (const ownerId of [ownerA, ownerB, ownerC]) {
      const res = await request(app)
        .post('/api/weg/owner-votes')
        .send({ vote_id: voteId, owner_id: ownerId, vote_value: 'ja' });
      expect(res.status).toBe(200);
    }

    const stored = await getPersistedResult();
    expect(stored).not.toBeNull();
    expect(stored!.passed).toBe(true);
    expect(stored!.noCount).toBe(0);
  });

  test('POST Nein von C nach allen Ja → wegVoteResults.passed=false', async () => {
    const app = buildApp(userId);

    // Alle stimmen Ja
    for (const ownerId of [ownerA, ownerB, ownerC]) {
      await request(app)
        .post('/api/weg/owner-votes')
        .send({ vote_id: voteId, owner_id: ownerId, vote_value: 'ja' })
        .expect(200);
    }
    expect((await getPersistedResult())!.passed).toBe(true);

    // C ändert zu Nein — das ist der kritische Regression-Test
    const neinRes = await request(app)
      .post('/api/weg/owner-votes')
      .send({ vote_id: voteId, owner_id: ownerC, vote_value: 'nein' });
    expect(neinRes.status).toBe(200);

    // wegVoteResults muss jetzt passed=false zeigen
    const stored = await getPersistedResult();
    expect(stored!.passed).toBe(false);
    expect(stored!.noCount).toBe(1);
    expect(stored!.yesCount).toBe(2);
  });

  test('POST ohne Auth → 401', async () => {
    const app = buildApp(''); // leerer userId
    const res = await request(app)
      .post('/api/weg/owner-votes')
      .send({ vote_id: voteId, owner_id: ownerA, vote_value: 'ja' });
    expect(res.status).toBe(401);
  });

  test('POST mit unbekannter voteId → 404', async () => {
    const app = buildApp(userId);
    const res = await request(app)
      .post('/api/weg/owner-votes')
      .send({ vote_id: uuidv4(), owner_id: ownerA, vote_value: 'ja' });
    expect(res.status).toBe(404);
  });
});

// ── D) Grenzfälle ─────────────────────────────────────────────────────────────

describe('D) Grenzfälle — Umlauf-Invalidierung', () => {
  beforeAll(async () => { await cleanupAll(); await seedAll(); });
  afterAll(async  () => { await cleanupAll(); });
  afterEach(async () => { await clearOwnerVotes(); });

  test('Enthaltung → passed=false, resultText erwähnt Enthaltung', async () => {
    await seedOwnerVote(ownerA, 'ja');
    await seedOwnerVote(ownerB, 'ja');
    await seedOwnerVote(ownerC, 'enthaltung');

    const result = await calculateVoteResult(voteId, orgId);
    expect(result.majorityReached).toBe(false);
    expect((await getPersistedResult())!.passed).toBe(false);
    expect(result.resultText).toMatch(/Enthaltung/i);
  });

  test('Mehrfachstimmen: nur letzte zählt (ORDER BY createdAt determiniert Last-Override)', async () => {
    // A stimmt: Nein, Enthaltung, Ja (letzte gewinnt dank ORDER BY)
    await seedOwnerVote(ownerA, 'nein');
    await seedOwnerVote(ownerA, 'enthaltung');
    await seedOwnerVote(ownerA, 'ja');    // letzte → gilt
    await seedOwnerVote(ownerB, 'ja');
    await seedOwnerVote(ownerC, 'ja');

    const result = await calculateVoteResult(voteId, orgId);
    expect(result.majorityReached).toBe(true);
    expect(result.noCount).toBe(0);
    expect(result.yesCount).toBe(3);
  });

  test('Leere Abstimmung → passed=false, yesCount=0', async () => {
    const result = await calculateVoteResult(voteId, orgId);
    expect(result.majorityReached).toBe(false);
    expect(result.yesCount).toBe(0);
    expect(result.totalOwnerCount).toBe(3);
  });
});
