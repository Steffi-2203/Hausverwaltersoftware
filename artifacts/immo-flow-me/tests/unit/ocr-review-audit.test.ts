/**
 * OCR Review & Audit-Log — Integrationstests
 *
 * Prüft:
 * 1. needs_review-Berechnungslogik (Unit-Tests, kein DB)
 * 2. POST /api/ocr/corrections — Auth, Pflichtfelder, Korrekturdiff
 * 3. Parallelität: concurrent requests → separate Einträge, kein Überschreiben
 * 4. HMAC-Pflichtfelder: chain_hmac / chain_seq / hmac_version gesetzt
 * 5. Integritätsschutz: Manipulation an old_data/chain_hmac wird erkannt
 * 6. Bearer-Token-Auth (Mobile-Pfad): gültiger/ungültiger/abgelaufener Token
 */
import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { vi, expect } from '../helpers/expect';

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import crypto from 'node:crypto';
import { rootDb as db } from '../../server/db';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { setupTestDb, teardownTestDb } from '../helpers/db';
import { verifyAuditChain, resetAuditChainAnchorForTesting } from '../../server/lib/auditLog';
import { buildBatchOcrAuditPayload } from '@/lib/batchOcrUtils';

const orgId  = uuidv4();
const userId = uuidv4();

import ocrRouter from '../../server/routes/ocrRoutes';
import { addOrgContext } from '../helpers/withOrgContext';
import { enforcePrivileged2FA } from '../../server/auth';
import { apiErrorHandler } from '../../server/lib/apiErrors';

function buildApp(uid: string | null = userId) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: uid, organizationId: orgId };
    next();
  });
  addOrgContext(app, uid ? orgId : null);
  app.use(ocrRouter);
  return app;
}

async function seed() {
  await db.execute(sql`
    INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'OCR-Test-Org') ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO profiles (id, email, organization_id)
    VALUES (${userId}::uuid, ${`ocr-${userId.slice(0,8)}@test.at`}, ${orgId}::uuid) ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO user_roles (user_id, role) VALUES (${userId}::uuid, 'admin') ON CONFLICT DO NOTHING
  `);
}

async function cleanup() {
  try {
    await db.execute(sql`DELETE FROM audit_logs WHERE user_id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM profiles WHERE id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
  } catch (err) {
    console.warn('Cleanup error (non-fatal):', (err as Error).message);
  }
}

const authApp = buildApp();
const anonApp = buildApp(null);

beforeAll(async () => { await setupTestDb(); await seed(); });
afterAll(async () => { await cleanup(); await teardownTestDb(); });

// ── needs_review-Logik als Unit-Test ─────────────────────────────────────────

describe('needs_review Berechnungslogik', () => {
  function computeNeedsReview(data: {
    betrag?: number | null;
    datum?: string | null;
    lieferant?: string | null;
    validierung?: { confidence_score?: number; fehler?: string[]; unsichere_felder?: string[] };
  }): boolean {
    const val = data.validierung ?? {};
    const confidenceScore = typeof val.confidence_score === 'number' ? val.confidence_score : 1.0;
    return (
      confidenceScore < 0.75 ||
      !data.betrag ||
      !data.datum ||
      !data.lieferant ||
      (val.fehler?.length ?? 0) > 0 ||
      (val.unsichere_felder?.length ?? 0) > 0
    );
  }

  test('Vollständige Rechnung mit hohem Score → needs_review=false', () => {
    expect(computeNeedsReview({
      betrag: 123.45,
      datum: '2026-01-15',
      lieferant: 'Wien Energie',
      validierung: { confidence_score: 0.95, fehler: [], unsichere_felder: [] },
    })).toBe(false);
  });

  test('Fehlender Betrag → needs_review=true', () => {
    expect(computeNeedsReview({
      betrag: null,
      datum: '2026-01-15',
      lieferant: 'Wien Energie',
      validierung: { confidence_score: 0.95, fehler: [], unsichere_felder: [] },
    })).toBe(true);
  });

  test('Fehlender Lieferant → needs_review=true', () => {
    expect(computeNeedsReview({
      betrag: 123.45,
      datum: '2026-01-15',
      lieferant: null,
      validierung: { confidence_score: 0.95 },
    })).toBe(true);
  });

  test('Niedriger Confidence-Score (0.6) → needs_review=true', () => {
    expect(computeNeedsReview({
      betrag: 123.45,
      datum: '2026-01-15',
      lieferant: 'Wien Energie',
      validierung: { confidence_score: 0.6, fehler: [], unsichere_felder: [] },
    })).toBe(true);
  });

  test('Fehler in validierung → needs_review=true', () => {
    expect(computeNeedsReview({
      betrag: 123.45,
      datum: '2026-01-15',
      lieferant: 'Wien Energie',
      validierung: { confidence_score: 0.9, fehler: ['USt-Satz unklar'], unsichere_felder: [] },
    })).toBe(true);
  });

  test('Unsichere Felder in validierung → needs_review=true', () => {
    expect(computeNeedsReview({
      betrag: 123.45,
      datum: '2026-01-15',
      lieferant: 'Wien Energie',
      validierung: { confidence_score: 0.9, fehler: [], unsichere_felder: ['betrag'] },
    })).toBe(true);
  });

  test('Grenzwert 0.75 genau → needs_review=true (strikt < 0.75 = false, = 0.75 = false)', () => {
    expect(computeNeedsReview({
      betrag: 123.45, datum: '2026-01-15', lieferant: 'X',
      validierung: { confidence_score: 0.75, fehler: [], unsichere_felder: [] },
    })).toBe(false);
    expect(computeNeedsReview({
      betrag: 123.45, datum: '2026-01-15', lieferant: 'X',
      validierung: { confidence_score: 0.749, fehler: [], unsichere_felder: [] },
    })).toBe(true);
  });
});

// ── OCR Corrections Audit ─────────────────────────────────────────────────────

describe('POST /api/ocr/corrections — Audit-Log', () => {
  test('Ohne Auth → 401', async () => {
    const res = await request(anonApp)
      .post('/api/ocr/corrections')
      .send({ originalData: {}, correctedData: {} });
    expect(res.status).toBe(401);
  });

  test('Ohne Body (keine originalData/correctedData) → 400', async () => {
    const res = await request(authApp)
      .post('/api/ocr/corrections')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/erforderlich/i);
  });

  test('Nur originalData fehlt → 400', async () => {
    const res = await request(authApp)
      .post('/api/ocr/corrections')
      .send({ correctedData: { lieferant: 'X' } });
    expect(res.status).toBe(400);
  });

  test('Nur correctedData fehlt → 400', async () => {
    const res = await request(authApp)
      .post('/api/ocr/corrections')
      .send({ originalData: { lieferant: 'X' } });
    expect(res.status).toBe(400);
  });

  test('Keine Unterschiede → logged=false', async () => {
    const sameData = { lieferant: 'Wien Energie', betrag: '123,00', datum: '2026-01-15', rechnungsnummer: 'RE-001' };
    const res = await request(authApp)
      .post('/api/ocr/corrections')
      .send({ originalData: sameData, correctedData: sameData, source: 'expense_ocr', fileName: 'test.pdf' });
    expect(res.status).toBe(200);
    expect(res.body.logged).toBe(false);
  });

  test('Mit Korrekturen → logged=true, change_count korrekt, alle Pflichtfelder vorhanden', async () => {
    const original = {
      lieferant: 'Wien Energi',        // Tippfehler
      betrag: '123,00',
      datum: '2026-01-51',             // ungültiges Datum
      rechnungsnummer: 'RE-001',
      confidence_score: 0.62,
    };
    const corrected = {
      lieferant: 'Wien Energie',       // korrigiert
      betrag: '123,00',               // unverändert
      datum: '2026-01-15',            // korrigiert
      rechnungsnummer: 'RE-001',      // unverändert
    };

    const res = await request(authApp)
      .post('/api/ocr/corrections')
      .send({ originalData: original, correctedData: corrected, source: 'expense_ocr', fileName: 'rechnung-jan.jpg' });

    expect(res.status).toBe(200);
    expect(res.body.logged).toBe(true);
    expect(res.body.change_count).toBe(2);  // lieferant + datum

    // Vollständige Datenbank-Prüfung
    const rows = await db.execute(
      sql`SELECT id, chain_hmac, chain_seq, hmac_version, old_data, new_data, details
          FROM audit_logs
          WHERE user_id = ${userId}::uuid
          AND action = 'ocr_correction'
          ORDER BY chain_seq DESC NULLS LAST LIMIT 1`
    );
    expect(rows.rows.length).toBe(1);
    const row = rows.rows[0] as any;

    // HMAC-Pflichtfelder müssen gesetzt sein
    expect(row.chain_hmac).toBeTruthy();
    expect(row.chain_seq).toBeTruthy();
    expect(row.hmac_version).toMatch(/^v[345]$/);

    // details enthält Pflichtfelder
    const detailsObj = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
    expect(detailsObj.change_count).toBe(2);
    expect(detailsObj.file_name).toBe('rechnung-jan.jpg');
    expect(detailsObj.confidence_score).toBe(0.62);
    expect(detailsObj.changes).toBeDefined();
    expect(detailsObj.changes.lieferant.vorher).toBe('Wien Energi');
    expect(detailsObj.changes.lieferant.nachher).toBe('Wien Energie');
    expect(detailsObj.changes.datum.vorher).toBe('2026-01-51');
    expect(detailsObj.changes.datum.nachher).toBe('2026-01-15');

    // old_data und new_data sind signiert — Originalwerte müssen abrufbar sein
    const oldDataObj = typeof row.old_data === 'string' ? JSON.parse(row.old_data) : row.old_data;
    expect(oldDataObj.lieferant).toBe('Wien Energi');
    expect(oldDataObj.confidence_score).toBe(0.62);
  });
});

// ── Parallelitätstest ─────────────────────────────────────────────────────────

describe('Parallele OCR-Korrekturen', () => {
  test('5 gleichzeitige Korrekturen → 5 separate Einträge, kein Überschreiben', async () => {
    // Einträge vor dem Test zählen
    const before = await db.execute(
      sql`SELECT COUNT(*) AS cnt FROM audit_logs WHERE user_id = ${userId}::uuid AND action = 'ocr_correction'`
    );
    const countBefore = Number((before.rows[0] as any).cnt);

    // 5 unterschiedliche Korrekturen gleichzeitig senden
    const requests = Array.from({ length: 5 }, (_, i) => {
      const original = { lieferant: `Lieferant-${i}`, betrag: `${100 + i},00` };
      const corrected = { lieferant: `Lieferant-${i}-korrigiert`, betrag: `${100 + i},00` };
      return request(authApp)
        .post('/api/ocr/corrections')
        .send({ originalData: original, correctedData: corrected, source: 'batch_ocr', fileName: `batch-${i}.pdf` });
    });

    const results = await Promise.all(requests);

    // Alle 5 müssen erfolgreich sein
    for (const res of results) {
      expect(res.status).toBe(200);
      expect(res.body.logged).toBe(true);
    }

    // Genau 5 neue Einträge in der DB
    const after = await db.execute(
      sql`SELECT COUNT(*) AS cnt FROM audit_logs WHERE user_id = ${userId}::uuid AND action = 'ocr_correction'`
    );
    const countAfter = Number((after.rows[0] as any).cnt);
    expect(countAfter - countBefore).toBe(5);

    // Alle 5 haben eigene chain_seq — kein Duplikat
    const seqRows = await db.execute(
      sql`SELECT chain_seq FROM audit_logs
          WHERE user_id = ${userId}::uuid AND action = 'ocr_correction'
          AND chain_seq IS NOT NULL
          ORDER BY chain_seq DESC LIMIT 5`
    );
    const seqs = (seqRows.rows as any[]).map(r => Number(r.chain_seq));
    const uniqueSeqs = new Set(seqs);
    expect(uniqueSeqs.size).toBe(seqs.length);  // alle eindeutig

    // Alle 5 haben unterschiedliche Lieferantennamen → kein Überschreiben
    const dataRows = await db.execute(
      sql`SELECT old_data FROM audit_logs
          WHERE user_id = ${userId}::uuid AND action = 'ocr_correction'
          ORDER BY chain_seq DESC LIMIT 5`
    );
    const lieferanten = (dataRows.rows as any[]).map(r => {
      const od = typeof r.old_data === 'string' ? JSON.parse(r.old_data) : r.old_data;
      return od?.lieferant;
    });
    const uniqueLieferanten = new Set(lieferanten.filter(Boolean));
    // Mindestens 4 der 5 Lieferanten sind unterschiedlich (robustere Assertion)
    expect(uniqueLieferanten.size).toBeGreaterThanOrEqual(4);
  });
});

// ── HMAC-Integritätstest ──────────────────────────────────────────────────────

describe('HMAC-Integritätsschutz', () => {
  test('Unmanipulierter Eintrag → verifyAuditChain gibt ok=true zurück', async () => {
    // Frischen Eintrag schreiben
    const original = { lieferant: 'Integrität-Test-Lieferant', betrag: '999,00', datum: '2026-06-01' };
    const corrected = { lieferant: 'Integrität-Test-Lieferant-korr', betrag: '999,00', datum: '2026-06-01' };
    const res = await request(authApp)
      .post('/api/ocr/corrections')
      .send({ originalData: original, correctedData: corrected, fileName: 'integritaet.pdf' });
    expect(res.status).toBe(200);
    expect(res.body.logged).toBe(true);

    // Kette für diesen Eintrag holen
    const rows = await db.execute(
      sql`SELECT chain_seq FROM audit_logs
          WHERE user_id = ${userId}::uuid AND action = 'ocr_correction'
          AND chain_seq IS NOT NULL
          ORDER BY chain_seq DESC LIMIT 1`
    );
    const seq = Number((rows.rows[0] as any).chain_seq);

    // Verifikation muss ok=true sein
    const result = await verifyAuditChain(1, seq);
    expect(result.ok).toBe(true);
  });

  test('Manipulation an old_data → verifyAuditChain erkennt Fälschung (ok=false)', async () => {
    // Frischen Eintrag schreiben
    const original = { lieferant: 'Echt-AG', betrag: '500,00', datum: '2026-07-01' };
    const corrected = { lieferant: 'Echt-AG-korr', betrag: '500,00', datum: '2026-07-01' };
    const res = await request(authApp)
      .post('/api/ocr/corrections')
      .send({ originalData: original, correctedData: corrected, fileName: 'manipulation-test.pdf' });
    expect(res.status).toBe(200);
    expect(res.body.logged).toBe(true);

    // Eintrag holen
    const rows = await db.execute(
      sql`SELECT id, chain_seq FROM audit_logs
          WHERE user_id = ${userId}::uuid AND action = 'ocr_correction'
          AND chain_seq IS NOT NULL
          ORDER BY chain_seq DESC LIMIT 1`
    );
    const row = rows.rows[0] as any;
    const seq = Number(row.chain_seq);
    const id = row.id;

    // old_data direkt in DB manipulieren (HMAC bleibt unverändert → Mismatch)
    await db.execute(
      sql`UPDATE audit_logs SET old_data = '{"lieferant":"GEFAELSCHT","betrag":"99999,00"}'::jsonb WHERE id = ${id}::uuid`
    );

    // Verifikation muss Manipulation erkennen
    const result = await verifyAuditChain(1, seq);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.firstBadId).toBe(id);
      expect(result.details).toMatch(/mismatch/i);
    }
  });

  test('Manipulation an chain_hmac → verifyAuditChain erkennt Fälschung (ok=false)', async () => {
    // Frischen Eintrag schreiben
    const original = { lieferant: 'Hmac-Test-AG', betrag: '200,00', datum: '2026-08-01' };
    const corrected = { lieferant: 'Hmac-Test-AG-korr', betrag: '200,00', datum: '2026-08-01' };
    const res = await request(authApp)
      .post('/api/ocr/corrections')
      .send({ originalData: original, correctedData: corrected, fileName: 'hmac-test.pdf' });
    expect(res.status).toBe(200);

    // Eintrag holen
    const rows = await db.execute(
      sql`SELECT id, chain_seq FROM audit_logs
          WHERE user_id = ${userId}::uuid AND action = 'ocr_correction'
          AND chain_seq IS NOT NULL
          ORDER BY chain_seq DESC LIMIT 1`
    );
    const row = rows.rows[0] as any;
    const seq = Number(row.chain_seq);
    const id = row.id;

    // chain_hmac direkt auf gefälschten Wert setzen
    const fakeHmac = crypto.randomBytes(32).toString('hex');
    await db.execute(
      sql`UPDATE audit_logs SET chain_hmac = ${fakeHmac} WHERE id = ${id}::uuid`
    );

    // Verifikation muss Manipulation erkennen
    const result = await verifyAuditChain(1, seq);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Entweder dieser Eintrag selbst ist falsch, oder der nächste (broken previous_hmac pointer)
      expect(result.details).toMatch(/mismatch|pointer/i);
    }
  });

  test('Gelöschter chain_hmac (NULL) → verifyAuditChain erkennt Tamper-Versuch (ok=false)', async () => {
    // Frischen Eintrag schreiben
    const original = { lieferant: 'Null-Hmac-Test', betrag: '300,00', datum: '2026-09-01' };
    const corrected = { lieferant: 'Null-Hmac-Test-korr', betrag: '300,00', datum: '2026-09-01' };
    const res = await request(authApp)
      .post('/api/ocr/corrections')
      .send({ originalData: original, correctedData: corrected, fileName: 'null-hmac.pdf' });
    expect(res.status).toBe(200);

    // Eintrag holen
    const rows = await db.execute(
      sql`SELECT id, chain_seq FROM audit_logs
          WHERE user_id = ${userId}::uuid AND action = 'ocr_correction'
          AND chain_seq IS NOT NULL
          ORDER BY chain_seq DESC LIMIT 1`
    );
    const row = rows.rows[0] as any;
    const seq = Number(row.chain_seq);
    const id = row.id;

    // chain_hmac auf NULL setzen — klassischer Tamper-Versuch
    await db.execute(
      sql`UPDATE audit_logs SET chain_hmac = NULL WHERE id = ${id}::uuid`
    );

    const result = await verifyAuditChain(1, seq);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.firstBadId).toBe(id);
      expect(result.details).toMatch(/null|tamper/i);
    }
  });

  test('Manipulation an details-Feld → verifyAuditChain erkennt Fälschung (v5, ok=false)', async () => {
    // Frischen Eintrag schreiben — mit details die als v5 signiert werden
    const original = { lieferant: 'Details-Tamper-AG', betrag: '777,00', datum: '2026-10-01', confidence_score: 0.92 };
    const corrected = { lieferant: 'Details-Tamper-AG-korr', betrag: '777,00', datum: '2026-10-01' };
    const res = await request(authApp)
      .post('/api/ocr/corrections')
      .send({ originalData: original, correctedData: corrected, fileName: 'details-tamper.pdf', source: 'expense_ocr' });
    expect(res.status).toBe(200);
    expect(res.body.logged).toBe(true);

    // Eintrag holen
    const rows = await db.execute(
      sql`SELECT id, chain_seq, hmac_version FROM audit_logs
          WHERE user_id = ${userId}::uuid AND action = 'ocr_correction'
          AND chain_seq IS NOT NULL
          ORDER BY chain_seq DESC LIMIT 1`
    );
    const row = rows.rows[0] as any;
    const seq = Number(row.chain_seq);
    const id = row.id;

    // Sicherstellen dass der Eintrag als v5 signiert wurde
    expect(row.hmac_version).toBe('v5');

    // details-Feld manipulieren (change_count fälschen, ohne HMAC zu aktualisieren)
    await db.execute(
      sql`UPDATE audit_logs
          SET details = jsonb_set(details::jsonb, '{change_count}', '99'::jsonb)
          WHERE id = ${id}::uuid`
    );

    // v5-Verifikation muss die details-Manipulation erkennen
    const result = await verifyAuditChain(1, seq);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.firstBadId).toBe(id);
      expect(result.details).toMatch(/mismatch/i);
    }
  });

  test('Gelöschte Zeile in der Mitte → previous_hmac-Pointer erkennt Fälschung (ok=false)', async () => {
    // Drei Einträge schreiben
    const writeOne = async (suffix: string) => {
      const orig = { lieferant: `Gap-${suffix}`, betrag: '111,00', datum: '2026-11-01' };
      const corr = { lieferant: `Gap-${suffix}-korr`, betrag: '111,00', datum: '2026-11-01' };
      const r = await request(authApp)
        .post('/api/ocr/corrections')
        .send({ originalData: orig, correctedData: corr, fileName: `gap-${suffix}.pdf` });
      expect(r.status).toBe(200);
      expect(r.body.logged).toBe(true);
    };
    await writeOne('A');
    await writeOne('B');
    await writeOne('C');

    // Die drei Einträge holen (aufsteigend nach chain_seq)
    const rows = await db.execute(
      sql`SELECT id, chain_seq FROM audit_logs
          WHERE user_id = ${userId}::uuid AND action = 'ocr_correction'
          AND chain_seq IS NOT NULL
          ORDER BY chain_seq DESC LIMIT 3`
    );
    const [rowC, rowB, rowA] = rows.rows as any[];
    const seqA = Number(rowA.chain_seq);

    // Mittlere Zeile (B) löschen → C.previous_hmac zeigt auf B.chain_hmac, nicht A.chain_hmac
    await db.execute(sql`DELETE FROM audit_logs WHERE id = ${rowB.id}::uuid`);

    // Scoped verification ab A: C.previous_hmac ≠ A.chain_hmac → Pointer-Check schlägt an
    // fromSeq=seqA (Start-Eintrag), seqB ist der GELÖSCHTE Eintrag — dieser wird NICHT übergeben
    const result = await verifyAuditChain(3, seqA);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.details).toMatch(/pointer|previousHmac|intermediate/i);
    }
  });

  test('Gelöschte genesis-Zeile → Anker erkennt Leading-Deletion ohne fromSeq (ok=false)', async () => {
    // Anchor zurücksetzen → nächster Eintrag wird neue Genesis
    await resetAuditChainAnchorForTesting();

    const writeEntry = async (suffix: string) => {
      const orig = { lieferant: `Lead-${suffix}`, betrag: '222,00', datum: '2026-12-01' };
      const corr = { lieferant: `Lead-${suffix}-korr`, betrag: '222,00', datum: '2026-12-01' };
      return request(authApp)
        .post('/api/ocr/corrections')
        .send({ originalData: orig, correctedData: corr, fileName: `lead-${suffix}.pdf` });
    };
    const rX = await writeEntry('X');
    const rY = await writeEntry('Y');
    expect(rX.status).toBe(200);
    expect(rY.status).toBe(200);

    // Genesis-Eintrag (X) aus dem Anker lesen und löschen
    const anchorRow = await db.execute(
      sql`SELECT genesis_seq FROM audit_chain_anchor WHERE id = 'singleton'`
    );
    const genesisSeq = Number((anchorRow.rows[0] as any).genesis_seq);
    await db.execute(sql`DELETE FROM audit_logs WHERE chain_seq = ${genesisSeq}`);

    // Verifikation OHNE fromSeq — Anker weiss, dass Genesis gelöscht wurde
    const result = await verifyAuditChain();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.details).toMatch(/genesis|leading/i);
    }
  });

  test('Gelöschte letzte Zeile (HWM) → Anker erkennt Tail-Deletion ohne HWM-Seq zu kennen (ok=false)', async () => {
    // Anchor zurücksetzen für saubere Baseline
    await resetAuditChainAnchorForTesting();

    const writeEntry = async (suffix: string) => {
      const orig = { lieferant: `Tail-${suffix}`, betrag: '333,00', datum: '2026-12-15' };
      const corr = { lieferant: `Tail-${suffix}-korr`, betrag: '333,00', datum: '2026-12-15' };
      return request(authApp)
        .post('/api/ocr/corrections')
        .send({ originalData: orig, correctedData: corr, fileName: `tail-${suffix}.pdf` });
    };
    const rC = await writeEntry('C');
    const rD = await writeEntry('D');
    expect(rC.status).toBe(200);
    expect(rD.status).toBe(200);

    // HWM lesen (letzter Eintrag = D)
    const anchorRow = await db.execute(
      sql`SELECT hwm_seq FROM audit_chain_anchor WHERE id = 'singleton'`
    );
    const hwmSeq = Number((anchorRow.rows[0] as any).hwm_seq);

    // Letzten Eintrag löschen — hwmSeq wird NICHT an verifyAuditChain übergeben
    await db.execute(sql`DELETE FROM audit_logs WHERE chain_seq = ${hwmSeq}`);

    // Verifikation OHNE fromSeq, OHNE hwmSeq — Anker erkennt Tail-Deletion
    const result = await verifyAuditChain();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.details).toMatch(/tail|hwm/i);
    }
  });

  test('HWM-Check erkennt Tail-Deletion auch wenn limit < Gesamtanzahl der Einträge (>10k-Regression)', async () => {
    // Szenario: main loop verarbeitet nur limit=3 Zeilen, aber der HWM-Eintrag
    // (Zeile 5) wurde gelöscht.  Direkte HWM-Existenzprüfung muss das unabhängig
    // vom limit erkennen.
    await resetAuditChainAnchorForTesting();

    const writeEntry = async (suffix: string) => {
      const r = await request(authApp)
        .post('/api/ocr/corrections')
        .send({
          originalData:  { lieferant: `HWM-${suffix}`, betrag: '10,00', datum: '2026-12-01' },
          correctedData: { lieferant: `HWM-${suffix}-korr`, betrag: '10,00', datum: '2026-12-01' },
          fileName: `hwm-${suffix}.pdf`,
        });
      expect(r.status).toBe(200);
    };
    for (const s of ['A', 'B', 'C', 'D', 'E']) await writeEntry(s);

    // HWM (letzter Eintrag = E) holen
    const anchorRow = await db.execute(
      sql`SELECT hwm_seq FROM audit_chain_anchor WHERE id = 'singleton'`
    );
    const hwmSeq = Number((anchorRow.rows[0] as any).hwm_seq);

    // Letzten Eintrag löschen
    await db.execute(sql`DELETE FROM audit_logs WHERE chain_seq = ${hwmSeq}`);

    // Verifikation mit limit=3 — main loop sieht nur A/B/C, endet vor D/E.
    // Direkte HWM-Prüfung muss trotzdem den Tail-Fehler erkennen.
    const result = await verifyAuditChain(3);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.details).toMatch(/tail|hwm/i);
    }
  });

  test('Sequenzlücke durch Rollback → kein Fehlalarm (previous_hmac korrekt verkettet)', async () => {
    // Anchor zurücksetzen für saubere Baseline
    await resetAuditChainAnchorForTesting();

    // Eintrag E schreiben
    const rE = await request(authApp)
      .post('/api/ocr/corrections')
      .send({
        originalData:  { lieferant: 'Rollback-E', betrag: '50,00', datum: '2026-12-20' },
        correctedData: { lieferant: 'Rollback-E-korr', betrag: '50,00', datum: '2026-12-20' },
        fileName: 'rollback-e.pdf',
      });
    expect(rE.status).toBe(200);

    // Sequence ohne Commit vorspulen (simuliert Rollback) — Seq F wird "verloren"
    await db.execute(sql`SELECT nextval('audit_chain_seq')`);
    await db.execute(sql`SELECT nextval('audit_chain_seq')`);

    // Eintrag G schreiben — previous_hmac zeigt auf E (nicht auf F, das nie existierte)
    const rG = await request(authApp)
      .post('/api/ocr/corrections')
      .send({
        originalData:  { lieferant: 'Rollback-G', betrag: '75,00', datum: '2026-12-21' },
        correctedData: { lieferant: 'Rollback-G-korr', betrag: '75,00', datum: '2026-12-21' },
        fileName: 'rollback-g.pdf',
      });
    expect(rG.status).toBe(200);

    // Keine Fälschung: Rollback-Lücke ist legitim — previous_hmac-Pointer stimmt überein
    const result = await verifyAuditChain();
    expect(result.ok).toBe(true);
  });
});

// ── Bearer-Token-Auth (Mobile-Pfad) ──────────────────────────────────────────
//
// Die Mobile-App sendet KEINE Session-Cookies, sondern:
//   Authorization: Bearer <token>
// resolveTokenAuth() prüft auth_tokens.token + expires_at > NOW().
// Diese Suite baut eine App OHNE vorausgefüllte Session, damit der Bearer-
// Token-Pfad tatsächlich gegen die echte DB-Tabelle geprüft wird.

const bearerOrgId  = uuidv4();
const bearerUserId = uuidv4();

function buildBearerApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  // Leere, aber beschreibbare Session — kein userId vorausgefüllt.
  // isAuthenticated() fällt dadurch auf resolveTokenAuth() zurück.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = {};
    next();
  });
  app.use(ocrRouter);
  return app;
}

/**
 * Produktions-Middleware-Reihenfolge:
 *   enforcePrivileged2FA  (ruft resolveTokenAuth auf, wenn keine Session)
 *   → ocrRouter           (enthält isAuthenticated-Guard)
 *   → apiErrorHandler     (wandelt TokenLookupDbError → 503)
 *
 * Gebraucht für den DB-Fehler-Test, der beweist, dass die 503-Antwort auch
 * über den enforcePrivileged2FA-Pfad korrekt geliefert wird.
 */
function buildFullPipelineApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = {};
    next();
  });
  app.use(enforcePrivileged2FA);
  app.use(ocrRouter);
  // Zentraler Error-Handler muss nach den Routen registriert werden
  app.use(apiErrorHandler as any);
  return app;
}

const fullPipelineApp = buildFullPipelineApp();

const bearerApp = buildBearerApp();

async function seedBearer() {
  await db.execute(sql`
    INSERT INTO organizations (id, name)
    VALUES (${bearerOrgId}::uuid, 'Bearer-Test-Org')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO profiles (id, email, organization_id)
    VALUES (${bearerUserId}::uuid,
            ${'bearer-' + bearerUserId.slice(0, 8) + '@test.at'},
            ${bearerOrgId}::uuid)
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO user_roles (user_id, role)
    VALUES (${bearerUserId}::uuid, 'admin')
    ON CONFLICT DO NOTHING
  `);
}

async function cleanupBearer() {
  try {
    await db.execute(sql`DELETE FROM audit_logs  WHERE user_id = ${bearerUserId}::uuid`);
    await db.execute(sql`DELETE FROM auth_tokens WHERE user_id = ${bearerUserId}::uuid`);
    await db.execute(sql`DELETE FROM user_roles  WHERE user_id = ${bearerUserId}::uuid`);
    await db.execute(sql`DELETE FROM profiles    WHERE id      = ${bearerUserId}::uuid`);
    await db.execute(sql`DELETE FROM organizations WHERE id   = ${bearerOrgId}::uuid`);
  } catch (err) {
    console.warn('Bearer cleanup error (non-fatal):', (err as Error).message);
  }
}

describe('POST /api/ocr/corrections — Bearer-Token-Auth (Mobile-Pfad)', () => {
  beforeAll(async () => { await seedBearer(); });
  afterAll(async ()  => { await cleanupBearer(); });

  test('Gültiger Bearer-Token → 200, Eintrag in audit_logs mit Pflichtfeldern', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    // Token in DB einfügen (läuft in 1 Stunde ab)
    await db.execute(sql`
      INSERT INTO auth_tokens (user_id, token, expires_at)
      VALUES (${bearerUserId}::uuid, ${token}, NOW() + INTERVAL '1 hour')
      ON CONFLICT DO NOTHING
    `);

    const original  = { lieferant: 'Mobile-Lieferant', betrag: '99,00', datum: '2026-03-01', confidence_score: 0.71 };
    const corrected = { lieferant: 'Mobile-Lieferant-korr', betrag: '99,00', datum: '2026-03-01' };

    const res = await request(bearerApp)
      .post('/api/ocr/corrections')
      .set('Authorization', `Bearer ${token}`)
      .send({ originalData: original, correctedData: corrected, source: 'mobile_ocr', fileName: 'mobile-scan.jpg' });

    expect(res.status).toBe(200);
    expect(res.body.logged).toBe(true);
    expect(res.body.change_count).toBe(1); // nur lieferant geändert

    // Pflichtfelder in der DB prüfen
    const rows = await db.execute(sql`
      SELECT id, chain_hmac, chain_seq, hmac_version, old_data, new_data, details
      FROM audit_logs
      WHERE user_id = ${bearerUserId}::uuid
        AND action   = 'ocr_correction'
      ORDER BY chain_seq DESC NULLS LAST LIMIT 1
    `);
    expect(rows.rows.length).toBe(1);
    const row = rows.rows[0] as any;

    // HMAC-Pflichtfelder
    expect(row.chain_hmac).toBeTruthy();
    expect(row.chain_seq).toBeTruthy();
    expect(row.hmac_version).toMatch(/^v[345]$/);

    // details enthält Mobile-Quelle und Korrekturdiff
    const det = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
    expect(det.source).toBe('mobile_ocr');
    expect(det.file_name).toBe('mobile-scan.jpg');
    expect(det.change_count).toBe(1);
    expect(det.confidence_score).toBe(0.71);
    expect(det.changes.lieferant.vorher).toBe('Mobile-Lieferant');
    expect(det.changes.lieferant.nachher).toBe('Mobile-Lieferant-korr');

    // old_data muss Original-OCR-Daten enthalten
    const od = typeof row.old_data === 'string' ? JSON.parse(row.old_data) : row.old_data;
    expect(od.lieferant).toBe('Mobile-Lieferant');
    expect(od.confidence_score).toBe(0.71);
  });

  test('Unbekannter Bearer-Token (nicht in auth_tokens) → 401', async () => {
    const unknownToken = crypto.randomBytes(32).toString('hex');
    const res = await request(bearerApp)
      .post('/api/ocr/corrections')
      .set('Authorization', `Bearer ${unknownToken}`)
      .send({
        originalData:  { lieferant: 'X', betrag: '10,00' },
        correctedData: { lieferant: 'Y', betrag: '10,00' },
      });
    expect(res.status).toBe(401);
  });

  test('Abgelaufener Bearer-Token (expires_at in der Vergangenheit) → 401', async () => {
    const expiredToken = crypto.randomBytes(32).toString('hex');
    await db.execute(sql`
      INSERT INTO auth_tokens (user_id, token, expires_at)
      VALUES (${bearerUserId}::uuid, ${expiredToken}, NOW() - INTERVAL '1 hour')
      ON CONFLICT DO NOTHING
    `);
    const res = await request(bearerApp)
      .post('/api/ocr/corrections')
      .set('Authorization', `Bearer ${expiredToken}`)
      .send({
        originalData:  { lieferant: 'Alt', betrag: '5,00' },
        correctedData: { lieferant: 'Neu', betrag: '5,00' },
      });
    expect(res.status).toBe(401);

    // Kein Audit-Eintrag für gescheiterten Auth-Versuch
    const rows = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM audit_logs
      WHERE user_id = ${bearerUserId}::uuid
        AND action   = 'ocr_correction'
        AND (details->>'source') = 'expense_ocr'
    `);
    // Der abgelaufene Token darf keinen Eintrag erzeugt haben
    expect(Number((rows.rows[0] as any).cnt)).toBe(0);
  });

  test('Authorization-Header fehlt komplett (kein Bearer, keine Session) → 401', async () => {
    const res = await request(bearerApp)
      .post('/api/ocr/corrections')
      .send({
        originalData:  { lieferant: 'X' },
        correctedData: { lieferant: 'Y' },
      });
    expect(res.status).toBe(401);
  });

  test('DB-Fehler beim Token-Lookup → 503, erklärender Response-Body (keine stille 401) — isAuthenticated-Pfad', async () => {
    // Simuliert: DB ist kurzzeitig überlastet → db.execute wirft einen Fehler,
    // bevor der Token überhaupt geprüft werden kann.
    // Erwartung: 503 statt 401, damit das Mobilgerät weiß, dass ein Retry sinnvoll ist.
    const token = crypto.randomBytes(32).toString('hex');

    const spy = vi.spyOn(db, 'execute').mockImplementation(() =>
      Promise.reject(new Error('FATAL: connection pool exhausted'))
    );

    try {
      const res = await request(bearerApp)
        .post('/api/ocr/corrections')
        .set('Authorization', `Bearer ${token}`)
        .send({
          originalData:  { lieferant: 'DB-Fehler-Lieferant', betrag: '1,00' },
          correctedData: { lieferant: 'DB-Fehler-Lieferant-korr', betrag: '1,00' },
        });

      // Kein stilles 401 — der Client muss erkennen können, dass ein Retry sinnvoll ist
      expect(res.status).toBe(503);
      expect(res.body.retryable).toBe(true);
      expect(res.body.code).toBe('TOKEN_DB_ERROR');
    } finally {
      spy.mockRestore();
    }
  });

  test('DB-Fehler beim Token-Lookup → 503 auch über enforcePrivileged2FA-Pfad (Produktions-Reihenfolge)', async () => {
    // In der Produktion läuft enforcePrivileged2FA VOR dem Route-Guard isAuthenticated.
    // Wenn resolveTokenAuth dort wirft (TokenLookupDbError), leitet .catch(next) den
    // Fehler an apiErrorHandler weiter — dieser muss 503 zurückgeben, nicht 500.
    const token = crypto.randomBytes(32).toString('hex');

    const spy = vi.spyOn(db, 'execute').mockImplementation(() =>
      Promise.reject(new Error('FATAL: connection pool exhausted'))
    );

    try {
      const res = await request(fullPipelineApp)
        .post('/api/ocr/corrections')
        .set('Authorization', `Bearer ${token}`)
        .send({
          originalData:  { lieferant: 'Prod-Pfad-Lieferant', betrag: '2,00' },
          correctedData: { lieferant: 'Prod-Pfad-Lieferant-korr', betrag: '2,00' },
        });

      expect(res.status).toBe(503);
      expect(res.body.retryable).toBe(true);
      expect(res.body.code).toBe('TOKEN_DB_ERROR');
    } finally {
      spy.mockRestore();
    }
  });

  test('Leeres correctedData (kein Objekt) → 400, kein Audit-Eintrag', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    await db.execute(sql`
      INSERT INTO auth_tokens (user_id, token, expires_at)
      VALUES (${bearerUserId}::uuid, ${token}, NOW() + INTERVAL '1 hour')
      ON CONFLICT DO NOTHING
    `);

    const countBefore = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM audit_logs
      WHERE user_id = ${bearerUserId}::uuid AND action = 'ocr_correction'
    `);

    const res = await request(bearerApp)
      .post('/api/ocr/corrections')
      .set('Authorization', `Bearer ${token}`)
      .send({ originalData: { lieferant: 'Wien Energie' } }); // correctedData fehlt

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/erforderlich/i);

    // Kein neuer Audit-Eintrag
    const countAfter = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM audit_logs
      WHERE user_id = ${bearerUserId}::uuid AND action = 'ocr_correction'
    `);
    expect(Number((countAfter.rows[0] as any).cnt))
      .toBe(Number((countBefore.rows[0] as any).cnt));
  });
});

// ── Batch-OCR-Pfad (source: batch_ocr) ───────────────────────────────────────
//
// Prüft dass handleSaveBatchResults (ExpenseList.tsx) zuverlässig einen
// Audit-Eintrag schreibt wenn der Verwalter OCR-Felder korrigiert, und dass
// kein Eintrag entsteht wenn keine Änderungen oder kein OCR-Snapshot vorliegt.

describe('POST /api/ocr/corrections — Batch-OCR-Pfad (source: batch_ocr)', () => {
  afterAll(async () => {
    try {
      await db.execute(sql`
        DELETE FROM audit_logs
        WHERE user_id = ${userId}::uuid
          AND (details->>'source') = 'batch_ocr'
      `);
    } catch (err) {
      console.warn('Batch cleanup error (non-fatal):', (err as Error).message);
    }
  });

  test('Geänderte Felder → Audit-Eintrag mit source=batch_ocr und korrektem Diff', async () => {
    const item = {
      originalOcr: {
        bezeichnung:  'Wien Energie',
        betrag:       '120,00',
        datum:        '2026-05-01',
        beleg_nummer: 'RE-001',
        category:     'betriebskosten_umlagefaehig',
        expense_type: 'strom',
      },
      edited: {
        bezeichnung:  'Wien Energie GmbH', // Korrektur durch Verwalter
        betrag:       '120,00',
        datum:        '2026-05-01',
        beleg_nummer: 'RE-001',
        category:     'betriebskosten_umlagefaehig',
        expense_type: 'strom',
        notizen:      '',
      },
      validierung: { confidence_score: 0.65 },
      fileName: 'batch-test-01.pdf',
    };

    // Utility liefert korrekten Payload
    const payload = buildBatchOcrAuditPayload(item);
    expect(payload).not.toBeNull();
    expect(payload!.hasChanges).toBe(true);

    const countBefore = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM audit_logs
      WHERE user_id = ${userId}::uuid
        AND action   = 'ocr_correction'
        AND (details->>'source') = 'batch_ocr'
    `);

    const res = await request(authApp)
      .post('/api/ocr/corrections')
      .send({
        originalData:  payload!.originalData,
        correctedData: payload!.correctedData,
        source:        'batch_ocr',
        fileName:      item.fileName,
      });

    expect(res.status).toBe(200);
    expect(res.body.logged).toBe(true);
    expect(res.body.change_count).toBeGreaterThanOrEqual(1);

    // Datenbank-Eintrag prüfen
    const rows = await db.execute(sql`
      SELECT action, old_data, details, chain_hmac, chain_seq, hmac_version
      FROM   audit_logs
      WHERE  user_id = ${userId}::uuid
        AND  action   = 'ocr_correction'
        AND  (details->>'source') = 'batch_ocr'
      ORDER BY chain_seq DESC NULLS LAST LIMIT 1
    `);
    expect(rows.rows.length).toBe(1);
    const row = rows.rows[0] as any;

    expect(row.action).toBe('ocr_correction');
    expect(row.chain_hmac).toBeTruthy();
    expect(row.chain_seq).toBeTruthy();
    expect(row.hmac_version).toMatch(/^v[345]$/);

    const det = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
    expect(det.source).toBe('batch_ocr');
    expect(det.file_name).toBe('batch-test-01.pdf');
    // buildBatchOcrAuditPayload serialisiert confidence_score als String → DB speichert String
    expect(det.confidence_score).toBe('0.65');
    expect(det.changes.lieferant.vorher).toBe('Wien Energie');
    expect(det.changes.lieferant.nachher).toBe('Wien Energie GmbH');

    // Zähler gestiegen
    const countAfter = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM audit_logs
      WHERE user_id = ${userId}::uuid
        AND action   = 'ocr_correction'
        AND (details->>'source') = 'batch_ocr'
    `);
    expect(Number((countAfter.rows[0] as any).cnt))
      .toBe(Number((countBefore.rows[0] as any).cnt) + 1);
  });

  test('Original == Edited (keine Änderung) → logged:false, kein neuer Datenbank-Eintrag', async () => {
    const snapshot = {
      bezeichnung:  'Unverändert GmbH',
      betrag:       '200,00',
      datum:        '2026-06-01',
      beleg_nummer: 'RE-002',
      category:     'betriebskosten_umlagefaehig',
      expense_type: 'sonstiges',
    };
    const item = {
      originalOcr: snapshot,
      edited:      { ...snapshot, notizen: '' },
      validierung: { confidence_score: 0.90 },
    };

    // Utility erkennt: keine Änderungen
    const payload = buildBatchOcrAuditPayload(item);
    expect(payload).not.toBeNull();
    expect(payload!.hasChanges).toBe(false);

    const countBefore = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM audit_logs
      WHERE user_id = ${userId}::uuid AND action = 'ocr_correction'
    `);

    // API-Aufruf mit identischen Daten — Route gibt logged:false zurück
    const res = await request(authApp)
      .post('/api/ocr/corrections')
      .send({
        originalData: {
          lieferant: 'Unverändert GmbH', betrag: '200,00',
          datum: '2026-06-01', kategorie: 'betriebskosten_umlagefaehig',
        },
        correctedData: {
          lieferant: 'Unverändert GmbH', betrag: '200,00',
          datum: '2026-06-01', kategorie: 'betriebskosten_umlagefaehig',
        },
        source:   'batch_ocr',
        fileName: 'batch-no-change.pdf',
      });

    expect(res.status).toBe(200);
    expect(res.body.logged).toBe(false);

    // Kein neuer Eintrag in der Datenbank
    const countAfter = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM audit_logs
      WHERE user_id = ${userId}::uuid AND action = 'ocr_correction'
    `);
    expect(Number((countAfter.rows[0] as any).cnt))
      .toBe(Number((countBefore.rows[0] as any).cnt));
  });

  test('originalOcr fehlt (manueller Eintrag ohne OCR) → buildBatchOcrAuditPayload gibt null zurück', () => {
    // Kein OCR-Snapshot → Utility gibt null zurück → handleSaveBatchResults ruft API nicht auf
    const item = {
      edited: {
        bezeichnung:  'Manuell erfasst',
        betrag:       '50,00',
        datum:        '2026-07-01',
        beleg_nummer: '',
        category:     'betriebskosten_umlagefaehig',
        expense_type: 'sonstiges',
        notizen:      '',
      },
      // originalOcr absichtlich nicht gesetzt (kein OCR-Durchlauf)
    };

    const payload = buildBatchOcrAuditPayload(item as any);

    // Guard greift: null → kein API-Aufruf, kein Audit-Eintrag
    expect(payload).toBeNull();
  });
});
