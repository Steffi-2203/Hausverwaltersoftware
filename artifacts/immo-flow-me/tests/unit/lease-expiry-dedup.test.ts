/**
 * lease-expiry-dedup.test.ts — Task #101
 *
 * Dedup-Schutz der Vertragsablauf-Erinnerungen:
 *  1. processOrgThreshold sendet beim zweiten Lauf für dieselbe
 *     (lease_id, days_threshold)-Kombination KEINE zweite E-Mail.
 *  2. Eine bestehende DB-Zeile (status='sent') verhindert Doppelversand
 *     auch nach Server-Neustart (frische Service-Instanz/Aufruf).
 *  3. UNIQUE-Konflikt beim Claim wird still ignoriert (kein Fehler),
 *     auch bei parallelen Läufen: insgesamt genau ein Versand.
 *  4. Fehlgeschlagener Versand gibt den Claim frei → nächster Lauf
 *     versendet (Retry statt Verlust), aber ohne Doppelversand danach.
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';

import { v4 as uuidv4 } from 'uuid';
import { sql } from 'drizzle-orm';
import { rootDb } from '../../server/db';
import { processOrgThreshold } from '../../server/services/leaseExpiryService';

const orgId    = uuidv4();
const propId   = uuidv4();
const unitId   = uuidv4();
const tenantId = uuidv4();
let   leaseId: string;

const THRESHOLD = 60;

async function seed() {
  await rootDb.execute(sql`
    INSERT INTO organizations (id, name, email, lease_expiry_notifications_enabled, created_at)
    VALUES (${orgId}::uuid, 'LeaseExpiry-Dedup-Org', 'verwalter@dedup.test', true, NOW())
  `);
  await rootDb.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, created_at)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'Dedup-Haus', 'Teststr. 1', 'Wien', '1010', NOW())
  `);
  await rootDb.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status, flaeche, created_at)
    VALUES (${unitId}::uuid, ${propId}::uuid, 'T1', 'wohnung', 'aktiv', 60, NOW())
  `);
  await rootDb.execute(sql`
    INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, mietbeginn, grundmiete, created_at)
    VALUES (${tenantId}::uuid, ${unitId}::uuid, 'Dora', 'Dedup',
            ${'dedup-' + uuidv4().slice(0, 8) + '@t.test'}, 'aktiv', '2024-01-01', 500, NOW())
  `);
  const res = await rootDb.execute(sql`
    INSERT INTO leases (id, tenant_id, unit_id, start_date, end_date, grundmiete, status, befristet, created_at)
    VALUES (gen_random_uuid(), ${tenantId}::uuid, ${unitId}::uuid,
            '2024-01-01', CURRENT_DATE + ${THRESHOLD}::int, 500, 'aktiv', true, NOW())
    RETURNING id
  `);
  leaseId = (res.rows[0] as any).id as string;
}

async function cleanup() {
  await rootDb.execute(sql`DELETE FROM lease_expiry_notifications WHERE organization_id = ${orgId}::uuid`);
  await rootDb.execute(sql`DELETE FROM leases WHERE tenant_id = ${tenantId}::uuid`);
  await rootDb.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`);
  await rootDb.execute(sql`DELETE FROM units WHERE id = ${unitId}::uuid`);
  await rootDb.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
  await rootDb.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
}

async function notifRow(): Promise<{ n: number; status: string | null }> {
  const res = await rootDb.execute(sql`
    SELECT COUNT(*)::int AS n, MIN(status) AS status
    FROM lease_expiry_notifications
    WHERE lease_id = ${leaseId}::uuid AND days_threshold = ${THRESHOLD}
  `);
  const r = res.rows[0] as any;
  return { n: r.n, status: r.status };
}

function mockSender() {
  const calls: any[] = [];
  const fn = async (opts: any) => { calls.push(opts); return { id: 'mock' } as any; };
  return { calls, fn: fn as any };
}

describe('Lease-Expiry Dedup (lease_expiry_notifications UNIQUE)', () => {
  beforeAll(async () => { await seed(); });
  afterAll(async () => { await cleanup(); });

  test('erster Lauf sendet genau eine E-Mail und markiert status=sent', async () => {
    const m = mockSender();
    await processOrgThreshold(orgId, 'Dedup-Org', 'verwalter@dedup.test', THRESHOLD, m.fn);
    expect(m.calls.length).toBe(1);
    expect(m.calls[0].subject).toContain(`${THRESHOLD} Tagen`);
    const row = await notifRow();
    expect(row.n).toBe(1);
    expect(row.status).toBe('sent');
  });

  test('zweiter Lauf für dieselbe (lease, threshold)-Kombination sendet NICHT erneut', async () => {
    const m = mockSender();
    await processOrgThreshold(orgId, 'Dedup-Org', 'verwalter@dedup.test', THRESHOLD, m.fn);
    expect(m.calls.length).toBe(0);
    const row = await notifRow();
    expect(row.n).toBe(1); // weiterhin genau eine Zeile
  });

  test('DB-Zeile verhindert Doppelversand auch nach "Server-Neustart" (frischer Aufruf, nur DB-Zustand)', async () => {
    // Neustart-Simulation: keinerlei In-Memory-Zustand — nur die persistierte
    // Dedup-Zeile aus dem ersten Lauf existiert. Ein komplett neuer Aufruf
    // (neue Mock-Instanz) darf nichts versenden.
    const m = mockSender();
    await processOrgThreshold(orgId, 'Dedup-Org', 'verwalter@dedup.test', THRESHOLD, m.fn);
    expect(m.calls.length).toBe(0);
  });

  test('UNIQUE-Konflikt beim parallelen Claim wird still ignoriert: genau ein Versand, kein Fehler', async () => {
    // Frische Kombination (anderer Threshold) für den Parallel-Fall
    const t2 = 30;
    await rootDb.execute(sql`
      UPDATE leases SET end_date = CURRENT_DATE + ${t2}::int WHERE id = ${leaseId}::uuid
    `);
    const m1 = mockSender();
    const m2 = mockSender();
    // Beide Läufe parallel — der UNIQUE-Constraint entscheidet, wer sendet.
    await Promise.all([
      processOrgThreshold(orgId, 'Dedup-Org', 'verwalter@dedup.test', t2, m1.fn),
      processOrgThreshold(orgId, 'Dedup-Org', 'verwalter@dedup.test', t2, m2.fn),
    ]); // darf nicht werfen (ON CONFLICT … WHERE → RETURNING leer → skip)
    expect(m1.calls.length + m2.calls.length).toBe(1);
    const res = await rootDb.execute(sql`
      SELECT COUNT(*)::int AS n, MIN(status) AS status
      FROM lease_expiry_notifications
      WHERE lease_id = ${leaseId}::uuid AND days_threshold = ${t2}
    `);
    const r = res.rows[0] as any;
    expect(r.n).toBe(1);
    expect(r.status).toBe('sent');
  });

  test('fehlgeschlagener Versand gibt den Claim frei; nächster Lauf sendet genau einmal', async () => {
    const t3 = 90;
    await rootDb.execute(sql`
      UPDATE leases SET end_date = CURRENT_DATE + ${t3}::int WHERE id = ${leaseId}::uuid
    `);
    const failing = async () => { throw new Error('Resend down'); };
    await expect(
      processOrgThreshold(orgId, 'Dedup-Org', 'verwalter@dedup.test', t3, failing as any),
    ).rejects.toThrow('Resend down');
    // Claim bleibt als STALE pending erhalten (send_key wird für den
    // idempotenten Retry aufbewahrt)
    const after = await rootDb.execute(sql`
      SELECT COUNT(*)::int AS n, MIN(status) AS status, MIN(send_key) AS send_key
      FROM lease_expiry_notifications
      WHERE lease_id = ${leaseId}::uuid AND days_threshold = ${t3}
    `);
    const a = after.rows[0] as any;
    expect(a.n).toBe(1);
    expect(a.status).toBe('pending');
    expect(a.send_key).toBeTruthy();
    const failedKey = a.send_key as string;

    // Retry-Lauf sendet mit DEMSELBEN Idempotency-Key (ambivalenter Fehler:
    // hätte der Provider schon angenommen, unterdrückt er den Doppelversand)
    const m = mockSender();
    await processOrgThreshold(orgId, 'Dedup-Org', 'verwalter@dedup.test', t3, m.fn);
    expect(m.calls.length).toBe(1);
    expect(m.calls[0].idempotencyKey).toBe(failedKey);
    const m2 = mockSender();
    await processOrgThreshold(orgId, 'Dedup-Org', 'verwalter@dedup.test', t3, m2.fn);
    expect(m2.calls.length).toBe(0);
  });

  test('Crash nach Provider-Accept (pending bleibt): Reclaim nach TTL verwendet denselben Idempotency-Key', async () => {
    const t4 = 45;
    await rootDb.execute(sql`
      UPDATE leases SET end_date = CURRENT_DATE + ${t4}::int WHERE id = ${leaseId}::uuid
    `);
    // Erster Lauf: erfolgreicher Versand, Key festhalten
    const m1 = mockSender();
    await processOrgThreshold(orgId, 'Dedup-Org', 'verwalter@dedup.test', t4, m1.fn);
    expect(m1.calls.length).toBe(1);
    const firstKey = m1.calls[0].idempotencyKey as string;
    expect(firstKey).toBeTruthy();

    // Crash-Simulation: Worker starb NACH Provider-Accept, BEVOR status='sent'
    // geschrieben wurde → Zeile steht auf pending, sent_at ist >2h alt,
    // send_key ist persistiert.
    await rootDb.execute(sql`
      UPDATE lease_expiry_notifications
      SET status = 'pending', sent_at = NOW() - interval '3 hours'
      WHERE lease_id = ${leaseId}::uuid AND days_threshold = ${t4}
    `);

    // Reclaim-Lauf (Neustart): sendet erneut, aber mit IDENTISCHEM Key —
    // der Provider (Resend) unterdrückt damit die doppelte Zustellung.
    const m2 = mockSender();
    await processOrgThreshold(orgId, 'Dedup-Org', 'verwalter@dedup.test', t4, m2.fn);
    expect(m2.calls.length).toBe(1);
    expect(m2.calls[0].idempotencyKey).toBe(firstKey);

    // Danach permanent dedupliziert
    const row = await rootDb.execute(sql`
      SELECT status, send_key FROM lease_expiry_notifications
      WHERE lease_id = ${leaseId}::uuid AND days_threshold = ${t4}
    `);
    expect((row.rows[0] as any).status).toBe('sent');
    expect((row.rows[0] as any).send_key).toBe(firstKey);
    const m3 = mockSender();
    await processOrgThreshold(orgId, 'Dedup-Org', 'verwalter@dedup.test', t4, m3.fn);
    expect(m3.calls.length).toBe(0);
  });

  test('Stale-Claim + neue Lease: bestehender Key wird nie mit neuen Claims vermischt oder überschrieben', async () => {
    const t6 = 75;
    await rootDb.execute(sql`
      UPDATE leases SET end_date = CURRENT_DATE + ${t6}::int WHERE id = ${leaseId}::uuid
    `);
    // Erster Versand für Lease A, dann Crash-nach-Accept simulieren
    const mA = mockSender();
    await processOrgThreshold(orgId, 'Dedup-Org', 'verwalter@dedup.test', t6, mA.fn);
    expect(mA.calls.length).toBe(1);
    const keyA = mA.calls[0].idempotencyKey as string;
    await rootDb.execute(sql`
      UPDATE lease_expiry_notifications
      SET status = 'pending', sent_at = NOW() - interval '3 hours'
      WHERE lease_id = ${leaseId}::uuid AND days_threshold = ${t6}
    `);

    // Neue Lease B wird für denselben Threshold fällig
    const tenantB = uuidv4();
    await rootDb.execute(sql`
      INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, mietbeginn, grundmiete, created_at)
      VALUES (${tenantB}::uuid, ${unitId}::uuid, 'Bernd', 'Neu',
              ${'neu-' + uuidv4().slice(0, 8) + '@t.test'}, 'aktiv', '2024-01-01', 600, NOW())
    `);
    const resB = await rootDb.execute(sql`
      INSERT INTO leases (id, tenant_id, unit_id, start_date, end_date, grundmiete, status, befristet, created_at)
      VALUES (gen_random_uuid(), ${tenantB}::uuid, ${unitId}::uuid,
              '2024-01-01', CURRENT_DATE + ${t6}::int, 600, 'aktiv', true, NOW())
      RETURNING id
    `);
    const leaseB = (resB.rows[0] as any).id as string;

    try {
      // Reclaim-Lauf: zwei getrennte Batches — A mit ALTEM Key (gleicher
      // Payload → Provider dedupliziert), B mit NEUEM Key.
      const m = mockSender();
      await processOrgThreshold(orgId, 'Dedup-Org', 'verwalter@dedup.test', t6, m.fn);
      expect(m.calls.length).toBe(2);
      const keys = m.calls.map((c: any) => c.idempotencyKey as string);
      expect(keys).toContain(keyA);
      const callA = m.calls.find((c: any) => c.idempotencyKey === keyA);
      const callB = m.calls.find((c: any) => c.idempotencyKey !== keyA);
      expect(callA.text).toContain('Dora Dedup');
      expect(callA.text).not.toContain('Bernd Neu');   // exakt originale Menge
      expect(callB.text).toContain('Bernd Neu');
      expect(callB.text).not.toContain('Dora Dedup');
      expect(callB.idempotencyKey).not.toBe(keyA);
      // Key von A in der DB unverändert
      const rowA = await rootDb.execute(sql`
        SELECT send_key, status FROM lease_expiry_notifications
        WHERE lease_id = ${leaseId}::uuid AND days_threshold = ${t6}
      `);
      expect((rowA.rows[0] as any).send_key).toBe(keyA);
      expect((rowA.rows[0] as any).status).toBe('sent');
    } finally {
      await rootDb.execute(sql`DELETE FROM lease_expiry_notifications WHERE lease_id = ${leaseB}::uuid`);
      await rootDb.execute(sql`DELETE FROM leases WHERE id = ${leaseB}::uuid`);
      await rootDb.execute(sql`DELETE FROM tenants WHERE id = ${tenantB}::uuid`);
    }
  });

  test('Key älter als Provider-Idempotenz-Fenster: kein erneuter Versand, Claim wird unterdrückt', async () => {
    const t7 = 21;
    await rootDb.execute(sql`
      UPDATE leases SET end_date = CURRENT_DATE + ${t7}::int WHERE id = ${leaseId}::uuid
    `);
    // Pending-Claim dessen Key vor >23h erzeugt wurde (Recovery nach langem Ausfall)
    await rootDb.execute(sql`
      INSERT INTO lease_expiry_notifications
             (id, organization_id, lease_id, days_threshold, status, sent_at, send_key, send_key_at)
      VALUES (gen_random_uuid(), ${orgId}::uuid, ${leaseId}::uuid, ${t7}, 'pending',
              NOW() - interval '30 hours', 'lease-expiry/expired-test-key', NOW() - interval '30 hours')
    `);
    const m = mockSender();
    await processOrgThreshold(orgId, 'Dedup-Org', 'verwalter@dedup.test', t7, m.fn);
    // Provider kann nicht mehr deduplizieren → konservativ KEIN Versand
    expect(m.calls.length).toBe(0);
    const row = await rootDb.execute(sql`
      SELECT status FROM lease_expiry_notifications
      WHERE lease_id = ${leaseId}::uuid AND days_threshold = ${t7}
    `);
    expect((row.rows[0] as any).status).toBe('sent'); // unterdrückt, dauerhaft dedupliziert
  });

  test('Konkurrierender Reclaim einer 2-Lease-Key-Gruppe: genau EIN Versand mit vollständiger Gruppe, kein Split', async () => {
    const t8 = 50;
    await rootDb.execute(sql`
      UPDATE leases SET end_date = CURRENT_DATE + ${t8}::int WHERE id = ${leaseId}::uuid
    `);
    // Zweite Lease im selben Batch
    const tenantC = uuidv4();
    await rootDb.execute(sql`
      INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, mietbeginn, grundmiete, created_at)
      VALUES (${tenantC}::uuid, ${unitId}::uuid, 'Clara', 'Gruppe',
              ${'grp-' + uuidv4().slice(0, 8) + '@t.test'}, 'aktiv', '2024-01-01', 700, NOW())
    `);
    const resC = await rootDb.execute(sql`
      INSERT INTO leases (id, tenant_id, unit_id, start_date, end_date, grundmiete, status, befristet, created_at)
      VALUES (gen_random_uuid(), ${tenantC}::uuid, ${unitId}::uuid,
              '2024-01-01', CURRENT_DATE + ${t8}::int, 700, 'aktiv', true, NOW())
      RETURNING id
    `);
    const leaseC = (resC.rows[0] as any).id as string;

    try {
      // Fehlversuch VOR Provider-Accept: beide Leases geclaimt, Send wirft.
      const failing = async () => { throw new Error('network blip'); };
      await expect(
        processOrgThreshold(orgId, 'Dedup-Org', 'verwalter@dedup.test', t8, failing as any),
      ).rejects.toThrow('network blip');
      // Beide Zeilen pending + gemeinsamer Key
      const st = await rootDb.execute(sql`
        SELECT COUNT(*)::int AS n, COUNT(DISTINCT send_key)::int AS keys, MIN(status) AS status
        FROM lease_expiry_notifications
        WHERE days_threshold = ${t8}
          AND lease_id IN (${leaseId}::uuid, ${leaseC}::uuid)
      `);
      const s = st.rows[0] as any;
      expect(s.n).toBe(2);
      expect(s.keys).toBe(1);
      expect(s.status).toBe('pending');
      const keyRes = await rootDb.execute(sql`
        SELECT DISTINCT send_key AS key FROM lease_expiry_notifications WHERE days_threshold = ${t8}
      `);
      const groupKey = (keyRes.rows[0] as any).key as string;

      // Zwei Recovery-Worker gleichzeitig: die Key-Gruppe darf nicht gesplittet
      // werden — genau EIN Send, mit BEIDEN Leases und dem ORIGINAL-Key.
      const m1 = mockSender();
      const m2 = mockSender();
      await Promise.all([
        processOrgThreshold(orgId, 'Dedup-Org', 'verwalter@dedup.test', t8, m1.fn),
        processOrgThreshold(orgId, 'Dedup-Org', 'verwalter@dedup.test', t8, m2.fn),
      ]);
      const all = [...m1.calls, ...m2.calls];
      expect(all.length).toBe(1);
      expect(all[0].idempotencyKey).toBe(groupKey);
      expect(all[0].text).toContain('Dora Dedup');
      expect(all[0].text).toContain('Clara Gruppe'); // vollständige Gruppe, kein Subset
      // Beide Zeilen sent, Key unverändert
      const fin = await rootDb.execute(sql`
        SELECT COUNT(*)::int AS n FROM lease_expiry_notifications
        WHERE days_threshold = ${t8} AND status = 'sent' AND send_key = ${groupKey}
      `);
      expect((fin.rows[0] as any).n).toBe(2);
      // Kein weiterer Versand danach
      const m3 = mockSender();
      await processOrgThreshold(orgId, 'Dedup-Org', 'verwalter@dedup.test', t8, m3.fn);
      expect(m3.calls.length).toBe(0);
    } finally {
      await rootDb.execute(sql`DELETE FROM lease_expiry_notifications WHERE lease_id = ${leaseC}::uuid`);
      await rootDb.execute(sql`DELETE FROM leases WHERE id = ${leaseC}::uuid`);
      await rootDb.execute(sql`DELETE FROM tenants WHERE id = ${tenantC}::uuid`);
    }
  });

  test('Frischer pending-Claim (<TTL) wird von einem zweiten Lauf NICHT übernommen', async () => {
    const t5 = 14;
    await rootDb.execute(sql`
      UPDATE leases SET end_date = CURRENT_DATE + ${t5}::int WHERE id = ${leaseId}::uuid
    `);
    // Simulierter in-flight Claim eines anderen Workers (frisch, <2h)
    await rootDb.execute(sql`
      INSERT INTO lease_expiry_notifications (id, organization_id, lease_id, days_threshold, status, sent_at)
      VALUES (gen_random_uuid(), ${orgId}::uuid, ${leaseId}::uuid, ${t5}, 'pending', NOW())
    `);
    const m = mockSender();
    await processOrgThreshold(orgId, 'Dedup-Org', 'verwalter@dedup.test', t5, m.fn);
    expect(m.calls.length).toBe(0); // kein Steal eines aktiven Claims
  });
});
