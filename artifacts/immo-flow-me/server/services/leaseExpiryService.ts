/**
 * leaseExpiryService.ts
 *
 * Sends a daily summary e-mail to each organisation whose lease-expiry
 * notifications are enabled.  For every threshold (e.g. 90 / 60 / 30 days)
 * the service finds leases whose end_date is exactly <threshold> calendar
 * days from today and delivers at most one e-mail per (lease, threshold) pair,
 * even under concurrent execution and transient Resend failures.
 *
 * Outbox lifecycle (lease_expiry_notifications.status):
 *   'pending' — atomically claimed by this worker, e-mail not yet confirmed
 *   'sent'    — Resend accepted the delivery; permanent dedup marker
 *
 * Concurrency / crash safety:
 *   • Claim uses an INSERT … ON CONFLICT DO UPDATE that only updates rows
 *     whose status is still 'pending' AND whose sent_at is older than 2 h
 *     (stale/crashed worker).  Fresh pending rows are not touched, so a
 *     concurrent scheduler run cannot steal an active claim.
 *   • If sendEmail throws, the worker keeps its pending rows (incl. send_key)
 *     but back-dates sent_at so the next scheduler run can reclaim them.
 *   • Only after Resend accepts the e-mail does the worker UPDATE status='sent'.
 *   • Delivery idempotency: each send carries a stable Idempotency-Key
 *     (persisted in send_key). A retry/reclaim of the SAME claim set reuses
 *     the key, so Resend suppresses duplicate delivery even if a worker
 *     crashed after provider accept but before status='sent' (24h window).
 *     Existing key groups are NEVER mixed or re-keyed with new claims:
 *     each stored key is retried as its own batch with the exact original
 *     lease set; new claims go in a separate batch with a fresh key.
 *     Keys older than the provider window (23h guard < Resend's 24h) are
 *     suppressed (marked 'sent' + warning) instead of risking a duplicate.
 */

import { rootDb as db, withOrgContext } from '../db'; // background-job: kein Request-Kontext
import { organizations, leaseExpiryNotifications } from '@shared/schema';
import { eq, inArray, and, sql as drizzleSql } from 'drizzle-orm';
import { sendEmail } from '../lib/resend';
import { createHash } from 'node:crypto';
import { getPublicBaseUrl } from '../lib/publicBaseUrl';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExpiringLease {
  leaseId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  endDate: string;          // leases.end_date — canonical expiry field
  daysUntilExpiry: number;
  unitTopNummer: string | null;
  propertyName: string;
  tenantId: string;
}

// Stale-pending TTL: claims older than this are eligible for re-claim.
const STALE_PENDING_HOURS = 2;

// ---------------------------------------------------------------------------
// Public entry point — called by the scheduler
// ---------------------------------------------------------------------------

export async function sendLeaseExpiryNotifications(): Promise<void> {
  const orgs = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      email: organizations.email,
      leaseExpiryThresholds: organizations.leaseExpiryThresholds,
    })
    .from(organizations)
    .where(eq(organizations.leaseExpiryNotificationsEnabled, true));

  for (const org of orgs) {
    if (!org.email) continue;
    const thresholds: number[] = (org.leaseExpiryThresholds as number[]) ?? [90, 60, 30];

    for (const threshold of thresholds) {
      try {
        // withOrgContext setzt app.current_org für den RLS-geschützten Datenbank-
        // Zugriff in processOrgThreshold (leases, tenants, units, properties,
        // lease_expiry_notifications). Ohne diesen Kontext liefern alle Tabellen
        // 0 Zeilen (fail-closed RLS).
        await withOrgContext(org.id, () =>
          processOrgThreshold(org.id, org.name, org.email, threshold)
        );
      } catch (err) {
        console.error(`[LeaseExpiry] org=${org.id} threshold=${threshold}: failed`, err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Per-organisation, per-threshold processing
// ---------------------------------------------------------------------------

// exported für Tests; sendEmailFn injizierbar damit Tests keinen echten
// Resend-Versand auslösen (RESEND_API_KEY ist in der Umgebung vorhanden).
export async function processOrgThreshold(
  orgId: string,
  orgName: string,
  recipientEmail: string,
  threshold: number,
  sendEmailFn: typeof sendEmail = sendEmail,
): Promise<void> {
  // ── 1. Find candidates ──────────────────────────────────────────────────
  // Skip leases that already have a 'sent' record (permanent dedup).
  // Also skip leases with a fresh 'pending' record (<2 h) — another worker
  // is actively processing them.  Stale 'pending' records (>2 h) are eligible
  // for re-claim; they appear in the result set.
  //
  // leases.status enum values: 'aktiv' | 'beendet' | 'gekuendigt'
  // leases.end_date is the canonical expiry date for all befristete Verträge.
  const result = await db.execute(drizzleSql`
    SELECT
      l.id                                     AS "leaseId",
      t.first_name                             AS "firstName",
      t.last_name                              AS "lastName",
      t.email                                  AS "email",
      to_char(l.end_date, 'YYYY-MM-DD')        AS "endDate",
      (l.end_date::date - CURRENT_DATE)::int   AS "daysUntilExpiry",
      u.top_nummer                             AS "unitTopNummer",
      p.name                                   AS "propertyName",
      t.id                                     AS "tenantId"
    FROM   leases      l
    JOIN   tenants     t ON t.id = l.tenant_id
    JOIN   units       u ON u.id = l.unit_id
    JOIN   properties  p ON p.id = u.property_id
    WHERE  p.organization_id = ${orgId}
      AND  l.status          = 'aktiv'
      AND  l.end_date        IS NOT NULL
      AND  (l.end_date::date - CURRENT_DATE)::int = ${threshold}
      AND  NOT EXISTS (
             SELECT 1
             FROM   lease_expiry_notifications eln
             WHERE  eln.lease_id       = l.id
               AND  eln.days_threshold = ${threshold}
               AND  (
                     eln.status = 'sent'
                     OR (eln.status = 'pending'
                         AND eln.sent_at > NOW() - (${STALE_PENDING_HOURS} || ' hours')::interval)
                   )
           )
    ORDER BY l.end_date
  `);

  const candidates = (result.rows ?? []) as ExpiringLease[];

  const idSql = (ids: string[]) =>
    drizzleSql.join(ids.map((id) => drizzleSql`${id}::uuid`), drizzleSql`, `);

  // ── 2a. Atomic GROUP reclaim (rows with a persisted send_key) ───────────
  // Zeilen mit send_key gehören zu einem früheren Versandversuch. Sie werden
  // NUR als komplette Key-Gruppe reclaimed — atomar in einer Transaktion mit
  // FOR UPDATE: der Gewinner setzt sent_at=NOW() auf ALLE pending-Zeilen des
  // Keys; ein konkurrierender Worker sieht danach keine stale Zeilen mehr und
  // überspringt die ganze Gruppe. Damit kann eine Key-Gruppe nie gesplittet
  // oder mit anderem Payload erneut versendet werden.
  //
  // Keys älter als das Resend-Idempotenz-Fenster (23h-Guard < 24h) können
  // provider-seitig nicht mehr dedupliziert werden → Policy: die Gruppe wird
  // konservativ unterdrückt (status='sent' + Warn-Log) statt Doppelversand
  // zu riskieren.
  type KeyGroup = { key: string; leaseIds: string[] };
  const reclaimedGroups: KeyGroup[] = [];

  const staleKeysRes = await db.execute(drizzleSql`
    SELECT DISTINCT send_key AS key
    FROM lease_expiry_notifications
    WHERE organization_id = ${orgId}
      AND days_threshold  = ${threshold}
      AND status          = 'pending'
      AND send_key IS NOT NULL
      AND sent_at < NOW() - (${STALE_PENDING_HOURS} || ' hours')::interval
  `);

  for (const { key } of (staleKeysRes.rows ?? []) as Array<{ key: string }>) {
    const group = await db.transaction(async (tx) => {
      // Alle pending-Zeilen des Keys sperren (blockiert konkurrierende
      // Reclaims; nach deren Commit schlägt unser stale-Filter fehl).
      const locked = await tx.execute(drizzleSql`
        SELECT lease_id AS "leaseId",
               (sent_at < NOW() - (${STALE_PENDING_HOURS} || ' hours')::interval) AS "isStale",
               (send_key_at IS NOT NULL AND send_key_at < NOW() - interval '23 hours') AS "keyExpired"
        FROM lease_expiry_notifications
        WHERE send_key = ${key} AND days_threshold = ${threshold}
          AND status = 'pending'
        FOR UPDATE
      `);
      const rows = (locked.rows ?? []) as Array<{ leaseId: string; isStale: boolean; keyExpired: boolean }>;
      // Gruppe nur übernehmen, wenn ALLE Zeilen stale sind (keine Zeile in
      // Bearbeitung durch einen anderen Worker) und mindestens eine existiert.
      if (rows.length === 0 || rows.some((r) => !r.isStale)) return null;

      if (rows.some((r) => r.keyExpired)) {
        // Provider-Fenster abgelaufen: Zustellstatus unbekannt → unterdrücken.
        await tx.execute(drizzleSql`
          UPDATE lease_expiry_notifications SET status = 'sent'
          WHERE send_key = ${key} AND days_threshold = ${threshold} AND status = 'pending'
        `);
        console.warn(
          `[LeaseExpiry] key group (${rows.length} row(s)) org=${orgId} threshold=${threshold}d ` +
          `suppressed: send_key older than provider idempotency window (delivery state unknown)`,
        );
        return null;
      }

      await tx.execute(drizzleSql`
        UPDATE lease_expiry_notifications SET sent_at = NOW()
        WHERE send_key = ${key} AND days_threshold = ${threshold} AND status = 'pending'
      `);
      return { key, leaseIds: rows.map((r) => r.leaseId) } as KeyGroup;
    });
    if (group) reclaimedGroups.push(group);
  }

  // ── 2b. Per-row claim for NEW leases (rows without send_key) ────────────
  // INSERT with status='pending'.  On conflict: nur key-lose stale pending-
  // Zeilen werden row-weise übernommen (Zeilen MIT send_key gehören einer
  // Key-Gruppe und werden ausschließlich in 2a als Ganzes reclaimed).
  const reclaimedLeaseIds = new Set(reclaimedGroups.flatMap((g) => g.leaseIds));
  const claimed: ExpiringLease[] = [];
  for (const lease of candidates) {
    if (reclaimedLeaseIds.has(lease.leaseId)) continue;
    const ins = await db.execute(drizzleSql`
      INSERT INTO lease_expiry_notifications
             (id, organization_id, lease_id, days_threshold, status, sent_at)
      VALUES (gen_random_uuid(), ${orgId}, ${lease.leaseId}, ${threshold}, 'pending', NOW())
      ON CONFLICT (lease_id, days_threshold) DO UPDATE
        SET status  = 'pending',
            sent_at = NOW()
        WHERE lease_expiry_notifications.status = 'pending'
          AND lease_expiry_notifications.send_key IS NULL
          AND lease_expiry_notifications.sent_at
              < NOW() - (${STALE_PENDING_HOURS} || ' hours')::interval
      RETURNING id
    `);

    if ((ins.rows ?? []).length > 0) {
      claimed.push(lease);
    }
  }

  if (claimed.length === 0 && reclaimedGroups.length === 0) return;

  // ── 3. Batches: eine je reclaimter Key-Gruppe + eine für neue Claims ────
  const baseUrl = getPublicBaseUrl();

  // Anzeigedaten für reclaimte Gruppen unabhängig vom Kandidaten-Filter laden
  // (Payload soll die ursprüngliche Lease-Menge exakt abbilden).
  const batches: Array<{ key: string; leases: ExpiringLease[]; isNew: boolean }> = [];
  for (const group of reclaimedGroups) {
    const dataRes = await db.execute(drizzleSql`
      SELECT
        l.id AS "leaseId", t.first_name AS "firstName", t.last_name AS "lastName",
        t.email AS "email", to_char(l.end_date, 'YYYY-MM-DD') AS "endDate",
        (l.end_date::date - CURRENT_DATE)::int AS "daysUntilExpiry",
        u.top_nummer AS "unitTopNummer", p.name AS "propertyName", t.id AS "tenantId"
      FROM leases l
      JOIN tenants t ON t.id = l.tenant_id
      JOIN units u ON u.id = l.unit_id
      JOIN properties p ON p.id = u.property_id
      WHERE l.id IN (${idSql(group.leaseIds)})
      ORDER BY l.end_date
    `);
    batches.push({ key: group.key, leases: (dataRes.rows ?? []) as ExpiringLease[], isNew: false });
  }

  if (claimed.length > 0) {
    const newKey = 'lease-expiry/' + createHash('sha256')
      .update(`${orgId}:${threshold}:${claimed.map((l) => l.leaseId).sort().join(',')}:${Date.now()}`)
      .digest('hex').slice(0, 40);
    batches.push({ key: newKey, leases: claimed, isNew: true });
  }

  let sentCount = 0;
  let firstErr: unknown = null;
  for (const { key: idempotencyKey, leases: batch, isNew } of batches) {
    if (batch.length === 0) continue;
    const batchIds = batch.map((l) => l.leaseId);

    if (isNew) {
      await db.execute(drizzleSql`
        UPDATE lease_expiry_notifications
        SET send_key = ${idempotencyKey}, send_key_at = NOW()
        WHERE lease_id IN (${idSql(batchIds)})
          AND days_threshold = ${threshold} AND status = 'pending'
      `);
    }

    try {
      await sendEmailFn({
        idempotencyKey,
        to: recipientEmail,
        subject:
          `ImmoFlowMe: ${batch.length} Mietvertrag` +
          (batch.length > 1 ? 'e laufen' : ' laeuft') +
          ` in ${threshold} Tagen aus`,
        html: buildEmailHtml(orgName, threshold, batch, baseUrl),
        text: buildEmailText(orgName, threshold, batch, baseUrl),
      });
    } catch (sendErr) {
      // Claim freigeben, aber Zeile + send_key/send_key_at BEHALTEN:
      // der Retry verwendet denselben Key → Resend unterdrückt Doppel-
      // zustellung, falls der Provider bereits angenommen hatte.
      // sent_at künstlich "stale" ⇒ nächster Lauf darf sofort reclaimen.
      await db.execute(drizzleSql`
        UPDATE lease_expiry_notifications
        SET sent_at = NOW() - ((${STALE_PENDING_HOURS} + 1) || ' hours')::interval
        WHERE lease_id IN (${idSql(batchIds)})
          AND days_threshold = ${threshold}
          AND status = 'pending'
      `);
      console.error(
        `[LeaseExpiry] sendEmail failed for org=${orgId} threshold=${threshold}d; claims released`,
        sendErr,
      );
      firstErr = firstErr ?? sendErr;
      continue;
    }

    // ── 4. Mark batch as sent (permanent dedup) ─────────────────────────
    await db
      .update(leaseExpiryNotifications)
      .set({ status: 'sent' })
      .where(
        and(
          inArray(leaseExpiryNotifications.leaseId, batchIds),
          eq(leaseExpiryNotifications.daysThreshold, threshold),
          eq(leaseExpiryNotifications.status, 'pending'),
        ),
      );
    sentCount += batch.length;
  }

  if (firstErr) throw firstErr;

  if (sentCount > 0) {
    console.log(
      `[LeaseExpiry] Sent ${sentCount} reminder(s) ` +
      `for org=${orgId} threshold=${threshold}d → ${recipientEmail}`,
    );
  }
}

// ---------------------------------------------------------------------------
// E-mail templates
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('de-AT', {
    day:   '2-digit',
    month: '2-digit',
    year:  'numeric',
    timeZone: 'Europe/Vienna',
  });
}

function buildEmailHtml(
  orgName: string,
  threshold: number,
  leases: ExpiringLease[],
  baseUrl: string,
): string {
  const rows = leases.map((l) => {
    const name   = `${l.firstName} ${l.lastName}`;
    const unit   = l.unitTopNummer ? `Top ${l.unitTopNummer}` : 'Einheit';
    const expiry = l.endDate ? formatDate(l.endDate) : '&mdash;';
    const link   = `${baseUrl}/tenants/${l.tenantId}`;
    return `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;">${name}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;">${unit} &mdash; ${l.propertyName}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;">${expiry}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;">
          <a href="${link}" style="color:#2563eb;text-decoration:none;">Zum Mieter</a>
        </td>
      </tr>`;
  }).join('');

  return `
<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#1a1a1a;">
  <h1 style="color:#1a365d;font-size:20px;margin-bottom:4px;">
    Auslaufende Mietvertr&auml;ge
  </h1>
  <p style="color:#666;margin-top:0;font-size:14px;">${orgName}</p>

  <p>
    Die folgenden <strong>${leases.length}</strong>
    befristeten Mietvertrag${leases.length > 1 ? 'e laufen' : ' l&auml;uft'}
    in <strong>${threshold}&nbsp;Tagen</strong> aus.
    Bitte rechtzeitig K&uuml;ndigung oder Verl&auml;ngerung veranlassen
    (Frist gem&auml;&szlig; &sect;&nbsp;29 MRG).
  </p>

  <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
    <thead>
      <tr style="background:#f1f5f9;">
        <th style="padding:10px 8px;text-align:left;color:#555;font-weight:600;">Mieter</th>
        <th style="padding:10px 8px;text-align:left;color:#555;font-weight:600;">Einheit</th>
        <th style="padding:10px 8px;text-align:left;color:#555;font-weight:600;">Vertragsende</th>
        <th style="padding:10px 8px;"></th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <hr style="border:none;border-top:1px solid #eee;margin:30px 0;" />
  <p style="color:#999;font-size:12px;">
    ImmoFlow&shy;Me &mdash; Automatische Erinnerung bei auslaufenden Mietvertr&auml;gen.<br/>
    Um Benachrichtigungen zu konfigurieren, besuchen Sie die
    <a href="${baseUrl}/settings?tab=notifications" style="color:#2563eb;">Einstellungen</a>.
  </p>
</div>`;
}

function buildEmailText(
  orgName: string,
  threshold: number,
  leases: ExpiringLease[],
  baseUrl: string,
): string {
  const lines = leases
    .map((l) => {
      const name   = `${l.firstName} ${l.lastName}`;
      const unit   = l.unitTopNummer ? `Top ${l.unitTopNummer}` : 'Einheit';
      const expiry = l.endDate ? formatDate(l.endDate) : '—';
      return `- ${name} | ${unit} — ${l.propertyName} | Ende: ${expiry}\n  ${baseUrl}/tenants/${l.tenantId}`;
    })
    .join('\n');

  return (
    `Auslaufende Mietvertraege — ${orgName}\n\n` +
    `${leases.length} Mietvertrag${leases.length > 1 ? 'e laufen' : ' laeuft'} in ${threshold} Tagen aus:\n\n` +
    `${lines}\n\n` +
    `Bitte rechtzeitig Kuendigung oder Verlaengerung veranlassen (Frist gemaess §29 MRG).\n\n` +
    `ImmoFlowMe — Automatische Erinnerung\n` +
    `Einstellungen: ${baseUrl}/settings?tab=notifications`
  );
}
