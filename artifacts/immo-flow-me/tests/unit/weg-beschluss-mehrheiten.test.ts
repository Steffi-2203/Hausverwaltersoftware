/**
 * WEG-Beschluss-Mehrheiten — Produktionsfunktion computeVoteOutcome
 *
 * Testet die reine Berechnungslogik aus wegVotingService.ts:
 *   computeVoteOutcome() — keine DB, reine Logik
 *
 * Kernprüfungen:
 * 1. Quorum > 50% MEA erforderlich (§ 24 Abs. 1 WEG 2002)
 * 2. Einfache Mehrheit: ja-Anteile > nein-Anteile
 * 3. Zweidrittelmehrheit: ja-Prozent ≥ 66,67%
 * 4. Einstimmigkeit: kein einziges Nein, mindestens 1 Ja
 * 5. Kopfmehrheit (§ 25 Abs. 1 WEG 2002): yesCount > noCount
 * 6. Doppelte Stimmen: letzte Stimme des Eigentümers zählt
 */
import { describe, it } from 'node:test';
import { expect } from '../helpers/expect';
import { computeVoteOutcome, computeUmlaufOutcome, type RawOwnerVote } from '../../server/services/wegVotingService';

// Hilfsfunktion: Eigentümerliste mit MEA-Anteilen
function owner(id: string, meaShare: number, vote: 'ja' | 'nein' | 'enthaltung'): RawOwnerVote {
  return { ownerId: id, meaShare, voteValue: vote };
}

describe('computeVoteOutcome — Quorum (§ 24 WEG)', () => {
  it('Quorum > 50% MEA erforderlich: 3 von 4 Eigentümern anwesend (75%) → quorumReached', () => {
    // Gesamt MEA: 100+100+100+100 = 400; Anwesend: 3 (300) → 75% > 50% ✓
    const votes = [
      owner('A', 100, 'ja'),
      owner('B', 100, 'ja'),
      owner('C', 100, 'nein'),
      // D stimmt nicht ab
    ];
    const result = computeVoteOutcome(votes, 400, 'einfach');
    expect(result.quorumPercent).toBeCloseTo(75, 1);
    expect(result.quorumReached).toBe(true);
  });

  it('Quorum genau 50% → NICHT erreicht (> 50% erforderlich, nicht ≥)', () => {
    // Gesamt 200 MEA, 100 anwesend = genau 50% → nicht ausreichend
    const votes = [owner('A', 100, 'ja')];
    const result = computeVoteOutcome(votes, 200, 'einfach');
    expect(result.quorumPercent).toBeCloseTo(50, 1);
    expect(result.quorumReached).toBe(false);
  });
});

describe('computeVoteOutcome — Einfache Mehrheit', () => {
  it('2:1 für Ja → angenommen', () => {
    const votes = [owner('A', 100, 'ja'), owner('B', 100, 'ja'), owner('C', 100, 'nein')];
    const result = computeVoteOutcome(votes, 300, 'einfach');
    expect(result.majorityReached).toBe(true);
    expect(result.yesShares).toBe(200);
    expect(result.noShares).toBe(100);
  });

  it('Stimmengleichheit (50/50): einfache Mehrheit NICHT erreicht (ja > nein erforderlich)', () => {
    const votes = [owner('A', 100, 'ja'), owner('B', 100, 'nein')];
    const result = computeVoteOutcome(votes, 200, 'einfach');
    expect(result.majorityReached).toBe(false);
  });
});

describe('computeVoteOutcome — Zweidrittelmehrheit', () => {
  it('200 Ja von 300 (66,67%) → Zweidrittelmehrheit erreicht', () => {
    const votes = [owner('A', 200, 'ja'), owner('B', 100, 'nein')];
    const result = computeVoteOutcome(votes, 300, 'zweidrittel');
    expect(result.majorityReached).toBe(true);
  });

  it('150 Ja von 300 (50%) → Zweidrittelmehrheit NICHT erreicht', () => {
    const votes = [owner('A', 150, 'ja'), owner('B', 150, 'nein')];
    const result = computeVoteOutcome(votes, 300, 'zweidrittel');
    expect(result.majorityReached).toBe(false);
  });

  it('Null Beteiligung (0 Stimmen abgegeben) → Zweidrittelmehrheit NICHT erreicht (0 ≥ 0 darf nicht true sein)', () => {
    // Kritischer Grenzfall: ohne Vorbedingung votedMeaShares > 0 wäre 3*0 >= 2*0 → true (Fehler!)
    const result = computeVoteOutcome([], 300, 'zweidrittel');
    expect(result.majorityReached).toBe(false);
    expect(result.votedMeaShares).toBe(0);
  });

  it('Nur Enthaltungen (kein Ja, kein Nein) → Zweidrittelmehrheit NICHT erreicht', () => {
    const votes = [owner('A', 100, 'enthaltung'), owner('B', 100, 'enthaltung')];
    const result = computeVoteOutcome(votes, 300, 'zweidrittel');
    expect(result.majorityReached).toBe(false);
    expect(result.yesShares).toBe(0);
  });
});

describe('computeVoteOutcome — Einstimmigkeit', () => {
  it('alle stimmen Ja → einstimmig angenommen', () => {
    const votes = [owner('A', 100, 'ja'), owner('B', 100, 'ja'), owner('C', 100, 'ja')];
    const result = computeVoteOutcome(votes, 300, 'einstimmig');
    expect(result.majorityReached).toBe(true);
    expect(result.noShares).toBe(0);
  });

  it('1 Nein-Stimme → einstimmig NICHT angenommen', () => {
    const votes = [owner('A', 100, 'ja'), owner('B', 100, 'ja'), owner('C', 100, 'nein')];
    const result = computeVoteOutcome(votes, 300, 'einstimmig');
    expect(result.majorityReached).toBe(false);
  });

  it('nur Enthaltungen (kein Ja) → einstimmig NICHT angenommen', () => {
    const votes = [owner('A', 100, 'enthaltung'), owner('B', 100, 'enthaltung')];
    const result = computeVoteOutcome(votes, 200, 'einstimmig');
    expect(result.majorityReached).toBe(false);
  });
});

describe('computeVoteOutcome — Kopfmehrheit (§ 25 Abs. 1 WEG 2002)', () => {
  it('2 Ja-Personen, 1 Nein-Person → Kopfmehrheit erreicht', () => {
    const votes = [
      owner('A', 100, 'ja'),  // große Einheit
      owner('B', 50, 'ja'),   // kleine Einheit
      owner('C', 200, 'nein'), // sehr große Einheit
    ];
    const result = computeVoteOutcome(votes, 350, 'einfach');
    // MEA-Mehrheit: Nein hat 200 > 150 Ja → nicht angenommen
    expect(result.majorityReached).toBe(false);
    // Kopfmehrheit: 2 Ja-Personen > 1 Nein-Person → Kopfmehrheit erreicht
    expect(result.kopfMajorityReached).toBe(true);
    expect(result.yesCount).toBe(2);
    expect(result.noCount).toBe(1);
  });
});

describe('computeVoteOutcome — Doppelte Stimmen', () => {
  it('selber Eigentümer stimmt zweimal: letzte Stimme gilt', () => {
    // A stimmt erst Nein, dann Ja → soll als Ja zählen
    const votes: RawOwnerVote[] = [
      { ownerId: 'A', meaShare: 100, voteValue: 'nein' },
      { ownerId: 'A', meaShare: 100, voteValue: 'ja' },
      { ownerId: 'B', meaShare: 100, voteValue: 'nein' },
    ];
    const result = computeVoteOutcome(votes, 200, 'einfach');
    // A's letzte Stimme ist Ja → 100 Ja, 100 Nein → unentschieden → Mehrheit NICHT erreicht
    expect(result.yesShares).toBe(100);
    expect(result.noShares).toBe(100);
    expect(result.majorityReached).toBe(false); // Gleichstand = nicht angenommen
  });
});

// ── Umlaufbeschluss (§ 24 Abs. 1 WEG 2002) ───────────────────────────────────
describe('computeUmlaufOutcome — § 24 Abs. 1 WEG 2002: Einstimmigkeit ALLER Eigentümer', () => {
  it('3 von 3 Eigentümern stimmen Ja → Umlauf angenommen', () => {
    const votes: RawOwnerVote[] = [
      { ownerId: 'A', meaShare: 100, voteValue: 'ja' },
      { ownerId: 'B', meaShare: 100, voteValue: 'ja' },
      { ownerId: 'C', meaShare: 100, voteValue: 'ja' },
    ];
    const result = computeUmlaufOutcome(votes, 3);
    expect(result.passed).toBe(true);
    expect(result.yesCount).toBe(3);
    expect(result.noCount).toBe(0);
    expect(result.abstainCount).toBe(0);
    expect(result.missingCount).toBe(0);
  });

  it('1 Nein-Stimme unter 3 Eigentümern → Umlauf ABGELEHNT (§ 24 Abs. 1 WEG 2002)', () => {
    // Kernfall der Aufgabe: 1 Nein macht den Umlauf unwirksam
    const votes: RawOwnerVote[] = [
      { ownerId: 'A', meaShare: 100, voteValue: 'ja' },
      { ownerId: 'B', meaShare: 100, voteValue: 'ja' },
      { ownerId: 'C', meaShare: 100, voteValue: 'nein' }, // 1 Nein → unwirksam
    ];
    const result = computeUmlaufOutcome(votes, 3);
    expect(result.passed).toBe(false);
    expect(result.noCount).toBe(1);
    expect(result.yesCount).toBe(2);
  });

  it('1 Enthaltung → Umlauf ABGELEHNT (Enthaltung = keine Zustimmung)', () => {
    const votes: RawOwnerVote[] = [
      { ownerId: 'A', meaShare: 100, voteValue: 'ja' },
      { ownerId: 'B', meaShare: 100, voteValue: 'ja' },
      { ownerId: 'C', meaShare: 100, voteValue: 'enthaltung' },
    ];
    const result = computeUmlaufOutcome(votes, 3);
    expect(result.passed).toBe(false);
    expect(result.abstainCount).toBe(1);
  });

  it('1 Eigentümer hat noch nicht abgestimmt → Umlauf ABGELEHNT, missingCount = 1', () => {
    // Nur 2 von 3 haben abgestimmt (beide Ja) → trotzdem nicht angenommen
    const votes: RawOwnerVote[] = [
      { ownerId: 'A', meaShare: 100, voteValue: 'ja' },
      { ownerId: 'B', meaShare: 100, voteValue: 'ja' },
      // C hat noch nicht abgestimmt
    ];
    const result = computeUmlaufOutcome(votes, 3);
    expect(result.passed).toBe(false);
    expect(result.missingCount).toBe(1);
    expect(result.yesCount).toBe(2);
  });

  it('Keine Stimmen abgegeben (0 von 3) → Umlauf ABGELEHNT', () => {
    const result = computeUmlaufOutcome([], 3);
    expect(result.passed).toBe(false);
    expect(result.missingCount).toBe(3);
    expect(result.yesCount).toBe(0);
  });

  it('totalOwnerCount = 0 → Umlauf ABGELEHNT (keine stimmberechtigten Eigentümer)', () => {
    const result = computeUmlaufOutcome([], 0);
    expect(result.passed).toBe(false);
  });

  it('Doppelte Stimme: Eigentümer ändert Nein zu Ja, alle anderen Ja → Umlauf angenommen', () => {
    // C stimmt erst Nein, dann Ja → Late-Override → soll als Ja zählen
    const votes: RawOwnerVote[] = [
      { ownerId: 'A', meaShare: 100, voteValue: 'ja' },
      { ownerId: 'B', meaShare: 100, voteValue: 'ja' },
      { ownerId: 'C', meaShare: 100, voteValue: 'nein' },
      { ownerId: 'C', meaShare: 100, voteValue: 'ja' }, // überschreibt Nein
    ];
    const result = computeUmlaufOutcome(votes, 3);
    expect(result.passed).toBe(true);
    expect(result.noCount).toBe(0);
    expect(result.yesCount).toBe(3);
  });

  it('Einfache Mehrheit (2 von 3 Ja) reicht für Umlauf NICHT aus', () => {
    // Dieser Test demonstriert den Unterschied zu computeVoteOutcome('einfach'):
    // einfache Mehrheit würde 'angenommen' liefern, Umlauf aber NICHT.
    const votes: RawOwnerVote[] = [
      { ownerId: 'A', meaShare: 100, voteValue: 'ja' },
      { ownerId: 'B', meaShare: 100, voteValue: 'ja' },
      { ownerId: 'C', meaShare: 100, voteValue: 'nein' },
    ];
    const umlaufResult = computeUmlaufOutcome(votes, 3);
    const majorityResult = computeVoteOutcome(votes, 300, 'einfach');

    // Einfache Mehrheit wäre angenommen (2 > 1)
    expect(majorityResult.majorityReached).toBe(true);
    // Umlauf ist ABGELEHNT (1 Nein reicht)
    expect(umlaufResult.passed).toBe(false);
  });
});
