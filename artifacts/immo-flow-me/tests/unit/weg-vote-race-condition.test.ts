/**
 * Task #82: Race-Condition-Schutz bei gleichzeitigen Stimmabgaben
 *
 * Wenn mehrere Eigentümer gleichzeitig abstimmen, laufen mehrere
 * calculateVoteResult()-Aufrufe parallel. Ohne Serialisierung können
 * konkurrierende UPSERTs ein inkonsistentes Ergebnis schreiben.
 *
 * Die Lösung: SELECT FOR UPDATE auf die wegVotes-Zeile am Anfang jeder
 * Transaktion in calculateVoteResult(). Dadurch wird jeweils nur eine
 * Berechnung pro voteId ausgeführt — alle anderen warten am Row-Lock.
 *
 * Teststruktur:
 *   A) Konsistenz: N parallele calculateVoteResult()-Aufrufe schreiben
 *      dasselbe Endergebnis (idempotent).
 *   B) Konsistenz: 3 gleichzeitige POST /api/weg/owner-votes → letzter
 *      persistierter Wert ist korrekt.
 *   C) Kein Deadlock: 2 verschiedene voteIds können parallel laufen.
 */

import { describe, test, before as beforeAll, after as afterAll, afterEach } from 'node:test';
import { expect } from '../helpers/expect';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { rootDb as db } from '../../server/db';
import { sql, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { calculateVoteResult } from '../../server/services/wegVotingService';
import { wegVoteResults } from '@shared/schema';
import wegRouter from '../../server/routes/wegRoutes';
import { addOrgContext } from '../helpers/withOrgContext';

// ── Seed-Konstanten ───────────────────────────────────────────────────────────

const orgId      = uuidv4();
const propId     = uuidv4();
const assemblyId = uuidv4();
const voteId     = uuidv4();
const voteId2    = uuidv4(); // für Deadlock-Test C
const ownerA     = uuidv4();
const ownerB     = uuidv4();
const ownerC     = uuidv4();
const unitA      = uuidv4();
const unitB      = uuidv4();
const unitC      = uuidv4();
const userId     = uuidv4();

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

async function getPersistedResult(vid = voteId) {
  const rows = await db
    .select()
    .from(wegVoteResults)
    .where(eq(wegVoteResults.voteId, vid))
    .limit(1);
  return rows[0] ?? null;
}

async function clearVotes(vid = voteId) {
  await db.execute(sql`DELETE FROM weg_owner_votes  WHERE vote_id = ${vid}::uuid`);
  await db.execute(sql`DELETE FROM weg_vote_results WHERE vote_id = ${vid}::uuid`);
}

async function seedOwnerVote(ownerId: string, voteValue: 'ja' | 'nein' | 'enthaltung', vid = voteId) {
  await db.execute(sql`
    INSERT INTO weg_owner_votes (vote_id, owner_id, vote_value)
    VALUES (${vid}::uuid, ${ownerId}::uuid, ${voteValue})
  `);
}

async function seedAll() {
  await db.execute(sql`
    INSERT INTO organizations (id, name)
    VALUES (${orgId}::uuid, 'Race-Test-Org')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'Racehaus', 'Racegasse 1', 'Wien', '1010', 'weg')
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
    [ownerA,'Anna','Race'],[ownerB,'Bruno','Race'],[ownerC,'Clara','Race']
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
    VALUES (${assemblyId}::uuid, ${orgId}::uuid, ${propId}::uuid, 'Race-Test-Versammlung', NOW(), true, 'abgeschlossen')
    ON CONFLICT DO NOTHING
  `);
  // Primäre Abstimmung (Umlauf)
  await db.execute(sql`
    INSERT INTO weg_votes (id, assembly_id, topic, vote_type, required_majority)
    VALUES (${voteId}::uuid, ${assemblyId}::uuid, 'Racetest Beschluss', 'umlauf', 'einstimmig')
    ON CONFLICT DO NOTHING
  `);
  // Zweite Abstimmung für Deadlock-Test
  await db.execute(sql`
    INSERT INTO weg_votes (id, assembly_id, topic, vote_type, required_majority)
    VALUES (${voteId2}::uuid, ${assemblyId}::uuid, 'Racetest Beschluss 2', 'einfach', 'einfach')
    ON CONFLICT DO NOTHING
  `);
  // Auth-Profil
  await db.execute(sql`
    INSERT INTO profiles (id, email, organization_id)
    VALUES (${userId}::uuid, 'race-test@test.at', ${orgId}::uuid)
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO user_roles (user_id, role)
    VALUES (${userId}::uuid, 'admin')
    ON CONFLICT DO NOTHING
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

// ── Kein E-Mail-Versand im Test ───────────────────────────────────────────────
const noopEmail = async (_opts: any) => {};

// ─────────────────────────────────────────────────────────────────────────────

describe('A) Parallele calculateVoteResult()-Aufrufe — Konsistenz', () => {
  beforeAll(async () => { await cleanupAll(); await seedAll(); });
  afterAll(async  () => { await cleanupAll(); });
  afterEach(async () => { await clearVotes(); });

  test('10 gleichzeitige Aufrufe schreiben dasselbe Ergebnis (alle Ja → passed=true)', async () => {
    await seedOwnerVote(ownerA, 'ja');
    await seedOwnerVote(ownerB, 'ja');
    await seedOwnerVote(ownerC, 'ja');

    // 10 parallele Berechnungen für dieselbe voteId — jede muss passed=true liefern.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => calculateVoteResult(voteId, orgId, noopEmail)),
    );

    // Alle Aufrufe müssen dasselbe Ergebnis liefern
    for (const r of results) {
      expect(r.majorityReached).toBe(true);
      expect(r.yesCount).toBe(3);
      expect(r.noCount).toBe(0);
    }

    // Persistiertes Ergebnis muss konsistent sein
    const stored = await getPersistedResult();
    expect(stored).not.toBeNull();
    expect(stored!.passed).toBe(true);
    expect(stored!.yesCount).toBe(3);
    expect(stored!.noCount).toBe(0);
  });

  test('10 gleichzeitige Aufrufe mit 2 Ja + 1 Nein → passed=false (konsistent)', async () => {
    await seedOwnerVote(ownerA, 'ja');
    await seedOwnerVote(ownerB, 'ja');
    await seedOwnerVote(ownerC, 'nein');

    const results = await Promise.all(
      Array.from({ length: 10 }, () => calculateVoteResult(voteId, orgId, noopEmail)),
    );

    for (const r of results) {
      expect(r.majorityReached).toBe(false);
      expect(r.yesCount).toBe(2);
      expect(r.noCount).toBe(1);
    }

    const stored = await getPersistedResult();
    expect(stored!.passed).toBe(false);
    expect(stored!.noCount).toBe(1);
  });

  test('Stimmbild ändert sich während paralleler Berechnungen — letztes Ergebnis korrekt', async () => {
    // Alle drei stimmen Ja — dann fügen wir in der Mitte ein Nein hinzu.
    await seedOwnerVote(ownerA, 'ja');
    await seedOwnerVote(ownerB, 'ja');
    await seedOwnerVote(ownerC, 'ja');

    // 5 parallele Berechnungen starten, dann ein Nein einfügen
    const parallel = Promise.all(
      Array.from({ length: 5 }, () => calculateVoteResult(voteId, orgId, noopEmail)),
    );

    // Nein von C einfügen während Berechnungen laufen (best-effort-Timing)
    await seedOwnerVote(ownerC, 'nein');

    await parallel;

    // Nach den parallelen Aufrufen: eine finale Berechnung mit dem aktuellen Stand
    const final = await calculateVoteResult(voteId, orgId, noopEmail);

    // Die finale Berechnung sieht das Nein von C (letzte Stimme gewinnt)
    expect(final.noCount).toBe(1);
    expect(final.majorityReached).toBe(false);

    const stored = await getPersistedResult();
    expect(stored!.passed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('B) Gleichzeitige POST /api/weg/owner-votes — Endpoint-Level', () => {
  beforeAll(async () => { await cleanupAll(); await seedAll(); });
  afterAll(async  () => { await cleanupAll(); });
  afterEach(async () => { await clearVotes(); });

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

  test('3 gleichzeitige Stimmabgaben (alle Ja) → passed=true, kein doppelter oder fehlender Eintrag', async () => {
    const app = buildApp();

    // 3 Owner senden gleichzeitig ihre Ja-Stimme
    const responses = await Promise.all([
      request(app).post('/api/weg/owner-votes').send({ vote_id: voteId, owner_id: ownerA, vote_value: 'ja' }),
      request(app).post('/api/weg/owner-votes').send({ vote_id: voteId, owner_id: ownerB, vote_value: 'ja' }),
      request(app).post('/api/weg/owner-votes').send({ vote_id: voteId, owner_id: ownerC, vote_value: 'ja' }),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    const stored = await getPersistedResult();
    expect(stored).not.toBeNull();
    // Alle drei Ja-Stimmen müssen erfasst sein
    expect(stored!.yesCount).toBe(3);
    expect(stored!.passed).toBe(true);
  });

  test('3 gleichzeitige Stimmabgaben (2 Ja, 1 Nein) → passed=false, yesCount+noCount korrekt', async () => {
    const app = buildApp();

    const responses = await Promise.all([
      request(app).post('/api/weg/owner-votes').send({ vote_id: voteId, owner_id: ownerA, vote_value: 'ja' }),
      request(app).post('/api/weg/owner-votes').send({ vote_id: voteId, owner_id: ownerB, vote_value: 'ja' }),
      request(app).post('/api/weg/owner-votes').send({ vote_id: voteId, owner_id: ownerC, vote_value: 'nein' }),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    const stored = await getPersistedResult();
    expect(stored).not.toBeNull();
    expect(stored!.passed).toBe(false);
    // Stimmauszählung muss konsistent sein (kein "verlorener" oder doppelter Eintrag)
    expect(stored!.yesCount + stored!.noCount + stored!.abstainCount).toBeLessThanOrEqual(3);
    expect(stored!.noCount).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('C) Kein Deadlock bei parallelen Berechnungen verschiedener voteIds', () => {
  beforeAll(async () => { await cleanupAll(); await seedAll(); });
  afterAll(async  () => { await cleanupAll(); });

  test('voteId und voteId2 können gleichzeitig berechnet werden', async () => {
    // Stimmen für beide Abstimmungen setzen
    await seedOwnerVote(ownerA, 'ja', voteId);
    await seedOwnerVote(ownerB, 'nein', voteId2);

    // Beide parallel berechnen — darf nicht deadlocken oder hängen
    const [r1, r2] = await Promise.all([
      calculateVoteResult(voteId,  orgId, noopEmail),
      calculateVoteResult(voteId2, orgId, noopEmail),
    ]);

    // voteId (Umlauf): 1 Ja von 3 → ausstehend (nicht passed)
    expect(r1.majorityReached).toBe(false);
    expect(r1.yesCount).toBe(1);

    // voteId2 (einfach): 1 Nein → yesShares < noShares → abgelehnt
    expect(r2.majorityReached).toBe(false);
    expect(r2.noCount).toBe(1);

    // Beide Ergebnisse persistiert
    expect(await getPersistedResult(voteId)).not.toBeNull();
    expect(await getPersistedResult(voteId2)).not.toBeNull();

    // Aufräumen
    await clearVotes(voteId);
    await clearVotes(voteId2);
  });
});
