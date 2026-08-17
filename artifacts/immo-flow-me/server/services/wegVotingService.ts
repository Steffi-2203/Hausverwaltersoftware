import { rootDb as db } from "../db"; // direkt aufgerufene Service-Fns brauchen keinen RLS-Proxy
import { eq, and, asc, inArray } from "drizzle-orm";
import { wegVotes, wegOwnerVotes, wegUnitOwners, wegAssemblies, wegVoteResults, profiles, userRoles } from "@shared/schema";

// ─── Reine Berechnungshelfer — exportiert für Unit-Tests ──────────────────────

/** Einzelstimme mit MEA-Anteil für computeVoteOutcome(). */
export interface RawOwnerVote {
  ownerId: string;
  meaShare: number;
  voteValue: 'ja' | 'nein' | 'enthaltung';
}

/** Berechnetes Abstimmungsergebnis ohne Datenbank-Abhängigkeit. */
export interface VoteOutcome {
  yesShares: number;
  noShares: number;
  abstainShares: number;
  yesCount: number;
  noCount: number;
  abstainCount: number;
  votedMeaShares: number;
  quorumPercent: number;
  quorumReached: boolean;
  majorityReached: boolean;
  kopfMajorityReached: boolean;
}

/**
 * Ergebnis einer Umlaufbeschluss-Prüfung nach § 24 Abs. 1 WEG 2002.
 * Alle stimmberechtigten Eigentümer müssen schriftlich zugestimmt haben.
 */
export interface UmlaufOutcome {
  passed: boolean;
  yesCount: number;
  noCount: number;
  abstainCount: number;
  /** Eigentümer die noch nicht abgestimmt haben. */
  missingCount: number;
  totalOwnerCount: number;
}

/**
 * Prüft ob ein Umlaufbeschluss nach § 24 Abs. 1 WEG 2002 gültig ist.
 * Voraussetzung: ALLE Miteigentümer müssen mit 'ja' gestimmt haben.
 * Enthaltungen und Nein-Stimmen machen den Umlauf unwirksam.
 * Exportiert für Unit-Tests (keine Datenbankabhängigkeit).
 */
export function computeUmlaufOutcome(
  votes: RawOwnerVote[],
  totalOwnerCount: number,
): UmlaufOutcome {
  // De-Duplikation: letzte Stimme pro Eigentümer zählt
  const latest = new Map<string, RawOwnerVote>();
  for (const v of votes) latest.set(v.ownerId, v);

  let yesCount = 0, noCount = 0, abstainCount = 0;
  for (const [, v] of latest) {
    if (v.voteValue === 'ja') yesCount++;
    else if (v.voteValue === 'nein') noCount++;
    else abstainCount++;
  }

  const missingCount = Math.max(0, totalOwnerCount - (yesCount + noCount + abstainCount));
  // Gültig nur wenn ALLE Eigentümer mit 'ja' gestimmt haben
  const passed = yesCount === totalOwnerCount && noCount === 0 && abstainCount === 0 && totalOwnerCount > 0;

  return { passed, yesCount, noCount, abstainCount, missingCount, totalOwnerCount };
}

/**
 * Berechnet das Abstimmungsergebnis aus rohen Stimmdaten — ohne Datenbankzugriff.
 * Exportiert für Unit-Tests.
 *
 * Regeln (§ 24 WEG 2002):
 * - Quorum: stimmberechtigte MEA-Anteile > 50% der Gesamtanteile
 * - einfach: ja-Anteile > nein-Anteile
 * - zweidrittel: ja-Anteile ≥ 2/3 (ganzzahlig: 3 × yesShares ≥ 2 × votedMeaShares)
 * - einstimmig: keine Nein-Stimme, mind. 1 Ja
 * - Kopfmehrheit (§ 25 Abs. 1 WEG): mehr Ja-Personen als Nein-Personen
 *
 * De-Duplikation: Bei mehrfacher Stimmabgabe desselben Eigentümers
 * gilt die LETZTE Stimme (Late-Override-Prinzip).
 */
export function computeVoteOutcome(
  votes: RawOwnerVote[],
  totalMeaShares: number,
  requiredMajority: 'einfach' | 'zweidrittel' | 'einstimmig' = 'einfach',
): VoteOutcome {
  // De-Duplikation: Map überschreibt frühere Stimmen desselben Eigentümers
  const latest = new Map<string, RawOwnerVote>();
  for (const v of votes) latest.set(v.ownerId, v);

  let yesShares = 0, noShares = 0, abstainShares = 0;
  let yesCount = 0, noCount = 0, abstainCount = 0;

  for (const [, v] of latest) {
    if (v.voteValue === 'ja') {
      yesShares += v.meaShare; yesCount++;
    } else if (v.voteValue === 'nein') {
      noShares += v.meaShare; noCount++;
    } else {
      abstainShares += v.meaShare; abstainCount++;
    }
  }

  const votedMeaShares = yesShares + noShares + abstainShares;
  const quorumPercent = totalMeaShares > 0 ? (votedMeaShares / totalMeaShares) * 100 : 0;
  const quorumReached = quorumPercent > 50;

  const yesPercent = votedMeaShares > 0 ? (yesShares / votedMeaShares) * 100 : 0;
  let majorityReached = false;
  switch (requiredMajority) {
    case 'einfach':
      majorityReached = yesShares > noShares;
      break;
    case 'zweidrittel':
      // Ganzzahl-Vergleich: 3 × yesShares ≥ 2 × votedMeaShares entspricht ≥ ⅔ ohne Float-Drift.
      // votedMeaShares > 0 verhindert dass 0 ≥ 0 (true) bei Null-Beteiligung fälschlich true ergibt.
      majorityReached = votedMeaShares > 0 && 3 * yesShares >= 2 * votedMeaShares;
      break;
    case 'einstimmig':
      majorityReached = noShares === 0 && yesShares > 0;
      break;
  }

  const votedCount = yesCount + noCount + abstainCount;
  const kopfMajorityReached = yesCount > noCount && votedCount > 0;

  return {
    yesShares, noShares, abstainShares,
    yesCount, noCount, abstainCount,
    votedMeaShares, quorumPercent, quorumReached,
    majorityReached, kopfMajorityReached,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export interface VoteResult {
  voteId: string;
  // MEA-Anteilsmehrheit
  totalMeaShares: number;
  votedMeaShares: number;
  quorumReached: boolean;
  quorumPercent: number;
  yesShares: number;
  noShares: number;
  abstainShares: number;
  majorityReached: boolean;
  requiredMajority: string;
  resultText: string;
  // Kopfmehrheit (§ 25 Abs. 1 WEG 2002)
  totalOwnerCount: number;
  yesCount: number;
  noCount: number;
  abstainCount: number;
  kopfMajorityReached: boolean;
  kopfResultText: string;
  /** Gesetzt wenn ein Umlaufbeschluss von passed=true auf passed=false wechselt. */
  invalidationWarning?: string;
}

export type SendEmailFn = (opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}) => Promise<any>;

/**
 * Lädt die E-Mail-Adressen aller Admins und Verwalter der Organisation.
 * Gibt leere Liste zurück wenn keine gefunden werden — nie werfen.
 */
async function loadManagerEmails(organizationId: string): Promise<string[]> {
  try {
    // Alle Profile der Org laden, dann mit Rollen joinen
    const orgProfiles = await db
      .select({ id: profiles.id, email: profiles.email })
      .from(profiles)
      .where(eq(profiles.organizationId, organizationId));

    if (!orgProfiles.length) return [];

    const profileIds = orgProfiles.map(p => p.id);
    const roles = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(
        and(
          inArray(userRoles.userId, profileIds),
          inArray(userRoles.role, ['admin', 'property_manager'] as any[]),
        )
      );

    const managerIds = new Set(roles.map(r => r.userId));
    return orgProfiles
      .filter(p => managerIds.has(p.id))
      .map(p => p.email)
      .filter(Boolean) as string[];
  } catch (err) {
    console.error('[wegVotingService] Warnung: Manager-E-Mails konnten nicht geladen werden:', err);
    return [];
  }
}

/**
 * Sendet die Invalidierungs-Warnung an alle Verwalter der Organisation.
 * Fehler werden geloggt aber nicht propagiert — der Beschluss-Flip darf nie
 * durch einen E-Mail-Fehler blockiert werden.
 */
async function notifyManagersOfInvalidation(opts: {
  organizationId: string;
  voteId: string;
  voteTopic: string;
  invalidationWarning: string;
  sendEmailFn: SendEmailFn;
}): Promise<void> {
  const { organizationId, voteId, voteTopic, invalidationWarning, sendEmailFn } = opts;

  const recipients = await loadManagerEmails(organizationId);
  if (!recipients.length) {
    console.warn(`[wegVotingService] Invalidierungswarnung für Vote ${voteId}: keine Verwalter-E-Mails gefunden`);
    return;
  }

  const subject = '⚠️ Umlaufbeschluss ungültig — sofortige Überprüfung erforderlich';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #b91c1c;">⚠️ Umlaufbeschluss ungültig</h1>
      <p>Ein zuvor angenommener Umlaufbeschluss wurde nachträglich als <strong>ungültig</strong> eingestuft.</p>
      <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
        <tr>
          <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold; background: #f9fafb;">Beschluss-Thema</td>
          <td style="padding: 8px; border: 1px solid #e5e7eb;">${voteTopic}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold; background: #f9fafb;">Ergebnis</td>
          <td style="padding: 8px; border: 1px solid #e5e7eb; color: #b91c1c;">${invalidationWarning}</td>
        </tr>
      </table>
      <p style="color: #374151;">
        Gemäß <strong>§ 24 Abs. 1 WEG 2002</strong> erfordert ein Umlaufbeschluss die schriftliche
        Zustimmung <em>aller</em> Miteigentümer. Eine nachträgliche Nein-Stimme oder Enthaltung
        macht den Beschluss rückwirkend unwirksam.
      </p>
      <p style="color: #374151;">
        Bitte überprüfen Sie das Protokoll und informieren Sie alle Beteiligten umgehend.
      </p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="color: #9ca3af; font-size: 12px;">
        ImmoFlowMe — Automatische Benachrichtigung | Beschluss-ID: ${voteId}
      </p>
    </div>
  `;
  const text = `WARNUNG: Umlaufbeschluss ungültig\n\nBeschluss: ${voteTopic}\nErgebnis: ${invalidationWarning}\n\nGemäß § 24 Abs. 1 WEG 2002 erfordert ein Umlaufbeschluss die schriftliche Zustimmung ALLER Miteigentümer. Eine nachträgliche Nein-Stimme oder Enthaltung macht den Beschluss rückwirkend unwirksam.\n\nBitte überprüfen Sie das Protokoll und informieren Sie alle Beteiligten umgehend.\n\nBeschluss-ID: ${voteId}`;

  for (const to of recipients) {
    try {
      await sendEmailFn({ to, subject, html, text });
      console.log(`[wegVotingService] Invalidierungswarnung gesendet an ${to} für Vote ${voteId}`);
    } catch (err) {
      console.error(`[wegVotingService] Fehler beim Senden der Invalidierungswarnung an ${to}:`, err);
    }
  }
}

export async function calculateVoteResult(
  voteId: string,
  organizationId: string,
  sendEmailFn?: SendEmailFn,
): Promise<VoteResult> {
  // Collected outside the transaction so the email is sent AFTER the tx
  // commits — avoids holding the row lock during potentially slow SMTP I/O.
  let pendingInvalidationEmail: {
    organizationId: string;
    voteId: string;
    voteTopic: string;
    invalidationWarning: string;
    sendEmailFn: SendEmailFn;
  } | undefined;

  // ─── Serialisierung über SELECT FOR UPDATE ───────────────────────────────────
  // Bei gleichzeitigen Stimmabgaben können mehrere calculateVoteResult()-Aufrufe
  // parallel laufen. SELECT FOR UPDATE auf die wegVotes-Zeile stellt sicher,
  // dass jeweils nur eine Berechnung pro Abstimmung läuft — alle anderen warten
  // am Lock, bis die laufende Transaktion committed hat und das aktuelle
  // Stimmbild sichtbar wird. Dies verhindert inkonsistente UPSERT-Ergebnisse.
  const result = await db.transaction(async (tx) => {
    // Row-Lock auf die Abstimmungszeile — serialisiert alle gleichzeitigen
    // calculateVoteResult()-Aufrufe für dieselbe voteId.
    const [vote] = await tx
      .select()
      .from(wegVotes)
      .where(eq(wegVotes.id, voteId))
      .for('update');
    if (!vote) throw new Error("Abstimmung nicht gefunden");

    const assembly = await tx.select().from(wegAssemblies)
      .where(and(eq(wegAssemblies.id, vote.assemblyId), eq(wegAssemblies.organizationId, organizationId)))
      .limit(1);
    if (!assembly.length) throw new Error("Versammlung gehört nicht zu dieser Organisation");

    // Eigentümer auf die Liegenschaft der Versammlung eingrenzen, nicht alle Org-Eigentümer.
    // Deduplication nach ownerId: Ein Eigentümer mit mehreren Einheiten zählt nur einmal.
    const propertyId = assembly[0].propertyId;
    const ownerRows = await tx.select().from(wegUnitOwners)
      .where(and(
        eq(wegUnitOwners.organizationId, organizationId),
        eq(wegUnitOwners.propertyId, propertyId),
      ));
    const uniqueOwners = new Map<string, typeof ownerRows[0]>();
    for (const o of ownerRows) uniqueOwners.set(o.ownerId, o);
    const totalMeaShares = Array.from(uniqueOwners.values()).reduce((sum, o) => sum + Number(o.meaShare), 0);
    const totalOwnerCount = uniqueOwners.size;

    // ORDER BY createdAt ASC ist zwingend: ohne Sortierung ist die Reihenfolge in
    // PostgreSQL undefiniert. Die Map überschreibt frühere Einträge desselben
    // Eigentümers — letzte Stimme (chronologisch) gewinnt (Late-Override-Prinzip).
    const ownerVotes = await tx.select().from(wegOwnerVotes)
      .where(eq(wegOwnerVotes.voteId, voteId))
      .orderBy(asc(wegOwnerVotes.createdAt));

    // ─── MEA-Anteilsmehrheit ────────────────────────────────────────────────────
    let yesShares = 0, noShares = 0, abstainShares = 0;
    // ─── Kopfmehrheit ───────────────────────────────────────────────────────────
    let yesCount = 0, noCount = 0, abstainCount = 0;

    // De-duplicate: each owner votes once (take last recorded vote per owner).
    // Da die Abfrage ASC nach createdAt sortiert ist, überschreibt die Map
    // ältere Einträge — die LETZTE Stimme des Eigentümers bleibt stehen.
    const latestVoteByOwner = new Map<string, typeof ownerVotes[0]>();
    for (const ov of ownerVotes) {
      latestVoteByOwner.set(ov.ownerId, ov);
    }

    for (const [, ov] of latestVoteByOwner) {
      const owner = uniqueOwners.get(ov.ownerId);
      if (!owner) continue;
      const share = Number(owner.meaShare);

      if (ov.voteValue === 'ja') {
        yesShares += share;
        yesCount++;
      } else if (ov.voteValue === 'nein') {
        noShares += share;
        noCount++;
      } else {
        abstainShares += share;
        abstainCount++;
      }
    }

    // ─── Quorum (MEA > 50%) ─────────────────────────────────────────────────────
    const votedMeaShares = yesShares + noShares + abstainShares;
    const quorumPercent = totalMeaShares > 0 ? (votedMeaShares / totalMeaShares) * 100 : 0;
    const quorumReached = quorumPercent > 50;

    // ─── Umlaufbeschluss (§ 24 Abs. 1 WEG 2002): Einstimmigkeit ALLER Eigentümer ──
    // Auch legacy-Einträge mit isCircularVote=true werden als Umlauf gewertet.
    const isUmlauf = vote.voteType === 'umlauf' || vote.isCircularVote === true;

    // ─── Anteilsmehrheit ────────────────────────────────────────────────────────
    const requiredMajority = isUmlauf ? 'einstimmig' : (vote.requiredMajority || 'einfach');
    let majorityReached = false;
    const yesPercent = votedMeaShares > 0 ? (yesShares / votedMeaShares) * 100 : 0;

    if (isUmlauf) {
      // § 24 Abs. 1 WEG: Alle Miteigentümer müssen schriftlich zustimmen.
      // noCount = 0 UND abstainCount = 0 UND yesCount = alle Eigentümer.
      majorityReached = yesCount === totalOwnerCount && noCount === 0 && abstainCount === 0 && totalOwnerCount > 0;
    } else {
      switch (requiredMajority) {
        case 'einfach':
          majorityReached = yesShares > noShares;
          break;
        case 'zweidrittel':
          // Ganzzahl-Vergleich: 3 × yesShares ≥ 2 × votedMeaShares entspricht ≥ ⅔ ohne Float-Drift.
          // votedMeaShares > 0 verhindert dass 0 ≥ 0 (true) bei Null-Beteiligung fälschlich true ergibt.
          majorityReached = votedMeaShares > 0 && 3 * yesShares >= 2 * votedMeaShares;
          break;
        case 'einstimmig':
          majorityReached = noShares === 0 && yesShares > 0;
          break;
        default:
          majorityReached = yesShares > noShares;
      }
    }

    let resultText = '';
    if (isUmlauf) {
      const missingCount = Math.max(0, totalOwnerCount - yesCount - noCount - abstainCount);
      if (majorityReached) {
        resultText = `Umlaufbeschluss angenommen: Alle ${totalOwnerCount} Eigentümer haben zugestimmt (§ 24 Abs. 1 WEG 2002)`;
      } else if (noCount > 0) {
        resultText = `Umlaufbeschluss abgelehnt: ${noCount} Nein-Stimme(n) – Einstimmigkeit erforderlich (§ 24 Abs. 1 WEG 2002)`;
      } else if (abstainCount > 0) {
        resultText = `Umlaufbeschluss abgelehnt: ${abstainCount} Enthaltung(en) – Alle Eigentümer müssen aktiv zustimmen (§ 24 Abs. 1 WEG 2002)`;
      } else {
        resultText = `Umlaufbeschluss ausstehend: ${yesCount} von ${totalOwnerCount} Eigentümern haben zugestimmt${missingCount > 0 ? `, ${missingCount} fehlen noch` : ''}`;
      }
    } else if (!quorumReached) {
      resultText = `Beschlussunfähig: Quorum nicht erreicht (${quorumPercent.toFixed(1)}% der MEA-Anteile anwesend, >50% erforderlich)`;
    } else if (majorityReached) {
      resultText = `Angenommen: ${yesPercent.toFixed(1)}% Ja-Stimmen nach MEA-Anteil (${requiredMajority} Mehrheit erreicht)`;
    } else {
      resultText = `Abgelehnt: ${yesPercent.toFixed(1)}% Ja-Stimmen nach MEA-Anteil (${requiredMajority} Mehrheit nicht erreicht)`;
    }

    // ─── Kopfmehrheit (§ 25 Abs. 1 WEG 2002) ───────────────────────────────────
    // Einfache Personenmehrheit: mehr Ja- als Nein-Stimmen nach Kopfzahl
    const votedCount = yesCount + noCount + abstainCount;
    const kopfMajorityReached = yesCount > noCount && votedCount > 0;
    const kopfYesPercent = votedCount > 0 ? (yesCount / votedCount) * 100 : 0;

    let kopfResultText = '';
    if (votedCount === 0) {
      kopfResultText = 'Kopfmehrheit: Keine Stimmen abgegeben';
    } else if (kopfMajorityReached) {
      kopfResultText = `Kopfmehrheit: Angenommen — ${yesCount} von ${votedCount} Eigentümern (${kopfYesPercent.toFixed(1)}% Ja)`;
    } else {
      kopfResultText = `Kopfmehrheit: Abgelehnt — ${yesCount} von ${votedCount} Eigentümern (${kopfYesPercent.toFixed(1)}% Ja)`;
    }

    // ─── Invalidierungs-Erkennung ────────────────────────────────────────────────
    // Wenn ein Umlaufbeschluss von passed=true auf passed=false kippt, muss:
    //   1. Ein Hinweistext ins Protokoll (invalidationWarning)
    //   2. Eine E-Mail an alle Verwalter / Admins der Organisation
    const newPassed = isUmlauf ? majorityReached : (majorityReached && quorumReached);

    let invalidationWarning: string | undefined;

    if (isUmlauf && !newPassed) {
      // Vorherigen Zustand aus DB lesen (innerhalb der Transaktion — sieht den
      // gesperrten Zustand vor unserem UPSERT, also das letzte committed Ergebnis).
      const [prevResult] = await tx
        .select({ passed: wegVoteResults.passed })
        .from(wegVoteResults)
        .where(eq(wegVoteResults.voteId, voteId));

      if (prevResult?.passed === true) {
        // Flip von true → false: Protokoll-Fälschung erkannt
        const flipReason = noCount > 0
          ? `${noCount} nachträgliche(r) Nein-Stimme(n)`
          : `${abstainCount} nachträgliche(r) Enthaltung(en)`;
        invalidationWarning =
          `ACHTUNG: Dieser Umlaufbeschluss war zuvor als angenommen protokolliert und wurde ` +
          `durch ${flipReason} nachträglich ungültig (§ 24 Abs. 1 WEG 2002). ` +
          `Bitte das Protokoll berichtigen und alle Beteiligten informieren.`;

        // E-Mail wird nach dem Commit gesendet — nicht innerhalb der Transaktion,
        // damit SMTP-Latenz den Row-Lock nicht verlängert.
        const effectiveSendEmail = sendEmailFn ?? (await import("../lib/resend").then(m => m.sendEmail));
        pendingInvalidationEmail = {
          organizationId,
          voteId,
          voteTopic: vote.topic,
          invalidationWarning,
          sendEmailFn: effectiveSendEmail,
        };
      }
    }

    const txResult: VoteResult = {
      voteId,
      totalMeaShares,
      votedMeaShares,
      quorumReached,
      quorumPercent,
      yesShares,
      noShares,
      abstainShares,
      majorityReached,
      requiredMajority,
      resultText,
      totalOwnerCount,
      yesCount,
      noCount,
      abstainCount,
      kopfMajorityReached,
      kopfResultText,
      ...(invalidationWarning ? { invalidationWarning } : {}),
    };

    // ─── Ergebnis persistieren (UPSERT) ────────────────────────────────────────
    try {
      await tx.insert(wegVoteResults).values({
        voteId,
        passed: newPassed,
        quorumReached,
        yesShares: yesShares.toString() as any,
        noShares: noShares.toString() as any,
        abstainShares: abstainShares.toString() as any,
        yesCount,
        noCount,
        abstainCount,
        resultText,
        kopfMajorityReached,
        kopfResultText,
        ...(invalidationWarning ? { invalidationWarning } : {}),
      }).onConflictDoUpdate({
        target: wegVoteResults.voteId,
        set: {
          passed: newPassed,
          quorumReached,
          yesShares: yesShares.toString() as any,
          noShares: noShares.toString() as any,
          abstainShares: abstainShares.toString() as any,
          yesCount,
          noCount,
          abstainCount,
          resultText,
          kopfMajorityReached,
          kopfResultText,
          calculatedAt: new Date(),
          // Einmal gesetzt bleibt invalidationWarning erhalten, auch wenn später
          // alle zu Ja wechseln — es dokumentiert dass eine Invalidierung stattgefunden hat.
          ...(invalidationWarning ? { invalidationWarning } : {}),
        },
      });
    } catch (err) {
      // Non-fatal: Log but don't fail the calculation if persistence fails
      console.error("Warnung: Abstimmungsergebnis konnte nicht gespeichert werden:", err);
    }

    return txResult;
  }); // ← Transaktion committed hier; Row-Lock wird freigegeben

  // ─── E-Mail nach Commit ──────────────────────────────────────────────────────
  // Außerhalb der Transaktion: SMTP-Latenz verlängert den Row-Lock nicht.
  if (pendingInvalidationEmail) {
    await notifyManagersOfInvalidation(pendingInvalidationEmail);
  }

  return result;
}
