/**
 * Task #81: Protokoll-Fälschungserkennung bei Umlaufbeschluss
 *
 * Wenn ein Umlaufbeschluss von passed=true auf passed=false kippt,
 * muss:
 *   1. invalidation_warning in weg_vote_results gesetzt werden
 *   2. Eine E-Mail an alle Verwalter / Admins der Organisation gesendet werden
 *
 * Teststruktur:
 *   A) Kein Warning bei erstmaligem passed=false (nie angenommen gewesen)
 *   B) Warning + E-Mail bei true→false Flip (Kernfall)
 *   C) Kein doppeltes Warning wenn bereits false (false→false)
 *   D) Kein Warning bei normaler Versammlungsabstimmung (isUmlauf=false)
 *   E) invalidationWarning bleibt erhalten wenn Beschluss danach wieder Ja geht
 */

import { describe, test, it, before as beforeAll, after as afterAll, afterEach } from 'node:test';
import { expect } from '../helpers/expect';
import { rootDb as db } from '../../server/db';
import { sql, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { calculateVoteResult } from '../../server/services/wegVotingService';
import { wegVoteResults } from '@shared/schema';

// ── Seed-Konstanten ───────────────────────────────────────────────────────────

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
const userId1    = uuidv4(); // admin
const userId2    = uuidv4(); // property_manager

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

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
  await db.execute(sql`
    INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'WarnTest-Org')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'Warnhaus', 'Warngasse 1', 'Wien', '1010', 'weg')
    ON CONFLICT DO NOTHING
  `);
  for (const [uid, top] of [[unitA, 'Top A'], [unitB, 'Top B'], [unitC, 'Top C']] as const) {
    await db.execute(sql`
      INSERT INTO units (id, property_id, top_nummer, type, status)
      VALUES (${uid}::uuid, ${propId}::uuid, ${top}, 'wohnung', 'aktiv')
      ON CONFLICT DO NOTHING
    `);
  }
  for (const [oid, fn, ln] of [
    [ownerA, 'Anna', 'Warn'], [ownerB, 'Bruno', 'Warn'], [ownerC, 'Clara', 'Nein'],
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
    VALUES (${assemblyId}::uuid, ${orgId}::uuid, ${propId}::uuid, 'Umlauf Warntest', NOW(), true, 'abgeschlossen')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO weg_votes (id, assembly_id, topic, vote_type, required_majority)
    VALUES (${voteId}::uuid, ${assemblyId}::uuid, 'Dachsanierung beschließen', 'umlauf', 'einstimmig')
    ON CONFLICT DO NOTHING
  `);
  // Zwei Manager-Profile (admin + property_manager) anlegen
  for (const [uid, email, role] of [
    [userId1, 'admin-warn@test.at', 'admin'],
    [userId2, 'verwalt-warn@test.at', 'property_manager'],
  ] as const) {
    await db.execute(sql`
      INSERT INTO profiles (id, email, organization_id)
      VALUES (${uid}::uuid, ${email}, ${orgId}::uuid)
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO user_roles (user_id, role)
      VALUES (${uid}::uuid, ${role})
      ON CONFLICT DO NOTHING
    `);
  }
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
  await db.execute(sql`DELETE FROM user_roles       WHERE user_id IN (${userId1}::uuid,${userId2}::uuid)`);
  await db.execute(sql`DELETE FROM profiles         WHERE id IN (${userId1}::uuid,${userId2}::uuid)`);
  await db.execute(sql`DELETE FROM organizations    WHERE id = ${orgId}::uuid`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('A) Kein Warning wenn Umlauf erstmalig false (war nie angenommen)', () => {
  beforeAll(async () => { await cleanupAll(); await seedAll(); });
  afterAll(async  () => { await cleanupAll(); });
  afterEach(async () => { await clearOwnerVotes(); });

  test('2 Ja + 1 Nein ohne vorherigen DB-Eintrag → kein invalidationWarning', async () => {
    const sent: string[] = [];
    const stub = async (opts: { to: string }) => { sent.push(opts.to); };

    await seedOwnerVote(ownerA, 'ja');
    await seedOwnerVote(ownerB, 'ja');
    await seedOwnerVote(ownerC, 'nein');

    const result = await calculateVoteResult(voteId, orgId, stub as any);
    expect(result.invalidationWarning).toBeUndefined();
    expect(sent).toHaveLength(0);

    const stored = await getPersistedResult();
    expect(stored!.passed).toBe(false);
    expect(stored!.invalidationWarning).toBeNull();
  });
});

describe('B) Warning + E-Mail bei true→false Flip (Kernfall)', () => {
  beforeAll(async () => { await cleanupAll(); await seedAll(); });
  afterAll(async  () => { await cleanupAll(); });
  afterEach(async () => { await clearOwnerVotes(); });

  test('Alle Ja → passed=true, dann Nein → Warning + E-Mail an beide Manager', async () => {
    // Schritt 1: Alle stimmen Ja → passed=true, kein Warning
    await seedOwnerVote(ownerA, 'ja');
    await seedOwnerVote(ownerB, 'ja');
    await seedOwnerVote(ownerC, 'ja');

    const sent1: string[] = [];
    await calculateVoteResult(voteId, orgId, async (o) => { sent1.push(o.to); });
    expect((await getPersistedResult())!.passed).toBe(true);
    expect(sent1).toHaveLength(0); // Kein Flip → keine E-Mail

    // Schritt 2: C ändert zu Nein → passed=false, Warning + E-Mail
    await seedOwnerVote(ownerC, 'nein');

    const sent2: string[] = [];
    const result = await calculateVoteResult(voteId, orgId, async (o) => { sent2.push(o.to); });

    expect(result.majorityReached).toBe(false);
    expect(result.invalidationWarning).toBeDefined();
    expect(result.invalidationWarning).toMatch(/nachträglich/i);
    expect(result.invalidationWarning).toMatch(/§ 24/);
    expect(result.invalidationWarning).toMatch(/Nein/i);

    // E-Mail an beide Manager
    expect(sent2).toHaveLength(2);
    expect(sent2).toContain('admin-warn@test.at');
    expect(sent2).toContain('verwalt-warn@test.at');

    // DB-Feld gesetzt
    const stored = await getPersistedResult();
    expect(stored!.passed).toBe(false);
    expect(stored!.invalidationWarning).toMatch(/nachträglich/i);
  });

  test('Flip durch Enthaltung → Warning erwähnt Enthaltung', async () => {
    // Alle Ja → passed=true
    await seedOwnerVote(ownerA, 'ja');
    await seedOwnerVote(ownerB, 'ja');
    await seedOwnerVote(ownerC, 'ja');
    await calculateVoteResult(voteId, orgId, async () => {});

    // C wechselt zu Enthaltung
    await seedOwnerVote(ownerC, 'enthaltung');
    const sent: string[] = [];
    const result = await calculateVoteResult(voteId, orgId, async (o) => { sent.push(o.to); });

    expect(result.majorityReached).toBe(false);
    expect(result.invalidationWarning).toBeDefined();
    expect(result.invalidationWarning).toMatch(/Enthaltung/i);
    expect(sent).toHaveLength(2);
  });
});

describe('C) Kein doppeltes Warning bei false→false (bereits ungültig)', () => {
  beforeAll(async () => { await cleanupAll(); await seedAll(); });
  afterAll(async  () => { await cleanupAll(); });
  afterEach(async () => { await clearOwnerVotes(); });

  test('Erster Nein → Warning. Zweiter Nein erneut → kein weiterer Warning', async () => {
    // Schritt 1: Alle Ja → passed=true
    await seedOwnerVote(ownerA, 'ja');
    await seedOwnerVote(ownerB, 'ja');
    await seedOwnerVote(ownerC, 'ja');
    await calculateVoteResult(voteId, orgId, async () => {});

    // Schritt 2: C → Nein → Flip, Warning
    await seedOwnerVote(ownerC, 'nein');
    const sent1: string[] = [];
    await calculateVoteResult(voteId, orgId, async (o) => { sent1.push(o.to); });
    expect(sent1).toHaveLength(2); // Warning gesendet

    // Schritt 3: B → Nein ebenfalls (jetzt schon false→false)
    await seedOwnerVote(ownerB, 'nein');
    const sent2: string[] = [];
    const result = await calculateVoteResult(voteId, orgId, async (o) => { sent2.push(o.to); });
    // Kein zweiter Warning weil Vorzustand schon false war
    expect(sent2).toHaveLength(0);
    // invalidationWarning im Return-Wert nicht neu gesetzt
    expect(result.invalidationWarning).toBeUndefined();
  });
});

describe('D) Kein Warning bei regulärer Versammlungsabstimmung', () => {
  const regVoteId   = uuidv4();
  const regAssembly = uuidv4();

  beforeAll(async () => {
    await cleanupAll();
    await seedAll();
    // Zusätzliche reguläre Abstimmung (voteType=versammlung)
    await db.execute(sql`
      INSERT INTO weg_assemblies (id, organization_id, property_id, title, assembly_date, is_circular_resolution, status)
      VALUES (${regAssembly}::uuid, ${orgId}::uuid, ${propId}::uuid, 'Versammlung D', NOW(), false, 'abgeschlossen')
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO weg_votes (id, assembly_id, topic, vote_type, required_majority)
      VALUES (${regVoteId}::uuid, ${regAssembly}::uuid, 'Jahresabrechnung', 'versammlung', 'einfach')
      ON CONFLICT DO NOTHING
    `);
  });
  afterAll(async () => {
    await db.execute(sql`DELETE FROM weg_vote_results WHERE vote_id = ${regVoteId}::uuid`);
    await db.execute(sql`DELETE FROM weg_owner_votes  WHERE vote_id = ${regVoteId}::uuid`);
    await db.execute(sql`DELETE FROM weg_votes        WHERE id = ${regVoteId}::uuid`);
    await db.execute(sql`DELETE FROM weg_assemblies   WHERE id = ${regAssembly}::uuid`);
    await cleanupAll();
  });

  test('Reguläre Versammlung: passed=false erzeugt kein Warning', async () => {
    await db.execute(sql`
      INSERT INTO weg_owner_votes (vote_id, owner_id, vote_value)
      VALUES (${regVoteId}::uuid, ${ownerA}::uuid, 'nein')
    `);

    const sent: string[] = [];
    const result = await calculateVoteResult(regVoteId, orgId, async (o) => { sent.push(o.to); });
    expect(result.invalidationWarning).toBeUndefined();
    expect(sent).toHaveLength(0);
  });
});

describe('E) invalidationWarning bleibt erhalten wenn Beschluss danach wieder Ja geht', () => {
  beforeAll(async () => { await cleanupAll(); await seedAll(); });
  afterAll(async  () => { await cleanupAll(); });
  afterEach(async () => { await clearOwnerVotes(); });

  test('true→false→true: DB-Feld invalidationWarning bleibt als historischer Nachweis', async () => {
    // Alle Ja → passed=true
    await seedOwnerVote(ownerA, 'ja');
    await seedOwnerVote(ownerB, 'ja');
    await seedOwnerVote(ownerC, 'ja');
    await calculateVoteResult(voteId, orgId, async () => {});

    // C → Nein → Warning geschrieben
    await seedOwnerVote(ownerC, 'nein');
    await calculateVoteResult(voteId, orgId, async () => {});
    const storedAfterFlip = await getPersistedResult();
    expect(storedAfterFlip!.invalidationWarning).toBeDefined();

    // C korrigiert zu Ja → passed=true, aber DB-Warning bleibt
    await seedOwnerVote(ownerC, 'ja');
    const result = await calculateVoteResult(voteId, orgId, async () => {});
    expect(result.majorityReached).toBe(true);

    const storedAfterRecovery = await getPersistedResult();
    expect(storedAfterRecovery!.passed).toBe(true);
    // Das Warning muss als historischer Nachweis erhalten bleiben
    expect(storedAfterRecovery!.invalidationWarning).not.toBeNull();
    expect(storedAfterRecovery!.invalidationWarning).toMatch(/nachträglich/i);
  });
});
