/**
 * WEG-Jahresabrechnung — Integration-Tests für calculateOwnerSettlement()
 *
 * Szenario 1 — 3 Eigentümer, gemischte Kategorien, 1 Sonderumlage:
 *   • Verteilung nach MEA (500 / 300 / 200 = 1000 Gesamtanteile)
 *   • Aufwand 'versicherung' 1.200 € + Aufwand 'ruecklage' 600 €
 *   • 1 Sonderumlage 300 € (beschlossen, kein Jahresabschlussposten)
 *   • Keine Vorschreibungen bezahlt → saldo = totalSoll
 *   • Prüft: Summe der Einzelsalden = summary.totalDifference
 *   • Prüft: ruecklageAnteil getrennt und korrekt ausgewiesen
 *   • Prüft: Sonderumlage in totalSoll enthalten
 *
 * Szenario 2 — Nutzwert-Fallback:
 *   • 2 Eigentümer: D (nutzwert = 80, MEA 400), E (nutzwert = null, MEA 200)
 *   • Budget-Plan + Budget-Linie: category='lift', allocation_key='nutzwert'
 *   • Aufwand 'lift' 600 €
 *   • Prüft: E bekommt Warnung über Nutzwert-Fallback auf MEA
 *   • Prüft: D erhält nutzwertbasierten Anteil, E MEA-basierten Anteil
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';
import { rootDb as db } from '../../server/db';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { setupTestDb, teardownTestDb } from '../helpers/db';
import { calculateOwnerSettlement } from '../../server/services/wegSettlementService';

// ── Gemeinsame Konstanten ───────────────────────────────────────────────────
const YEAR = 2024;
const orgId = uuidv4();

// ── Szenario 1: IDs ─────────────────────────────────────────────────────────
const prop1  = uuidv4();
const unitA  = uuidv4();   // MEA 500
const unitB  = uuidv4();   // MEA 300
const unitC  = uuidv4();   // MEA 200
const ownerA = uuidv4();   // Anteil 50 %
const ownerB = uuidv4();   // Anteil 30 %
const ownerC = uuidv4();   // Anteil 20 %

// ── Szenario 2: IDs ─────────────────────────────────────────────────────────
const prop2   = uuidv4();
const unitD   = uuidv4();   // nutzwert 80, MEA 400
const unitE   = uuidv4();   // nutzwert null, MEA 200
const ownerD  = uuidv4();
const ownerE  = uuidv4();
const budgetPlan2 = uuidv4();

// ── Szenario 3: IDs (rundungskritisch, Drittel-MEA) ─────────────────────────
const prop3   = uuidv4();
const unitF   = uuidv4();
const unitG   = uuidv4();
const unitH   = uuidv4();
const ownerF  = uuidv4();
const ownerG  = uuidv4();
const ownerH  = uuidv4();

// ── Setup ───────────────────────────────────────────────────────────────────
async function seed() {
  // Organisation
  await db.execute(sql`
    INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'WEG-Berechnungs-Test')
    ON CONFLICT DO NOTHING
  `);

  // ── Szenario 1 ───────────────────────────────────────────────────────────
  // Liegenschaft
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${prop1}::uuid, ${orgId}::uuid, 'Testhaus S1', 'Testgasse 1', 'Wien', '1010', 'weg')
    ON CONFLICT DO NOTHING
  `);

  // Einheiten
  for (const [uid, top] of [[unitA,'Top A'],[unitB,'Top B'],[unitC,'Top C']] as const) {
    await db.execute(sql`
      INSERT INTO units (id, property_id, top_nummer, type, status)
      VALUES (${uid}::uuid, ${prop1}::uuid, ${top}, 'wohnung', 'aktiv')
      ON CONFLICT DO NOTHING
    `);
  }

  // Eigentümer
  for (const [oid, fn, ln] of [
    [ownerA,'Anna','Mayer'],[ownerB,'Bruno','Kraus'],[ownerC,'Clara','Weber']
  ] as const) {
    await db.execute(sql`
      INSERT INTO owners (id, organization_id, first_name, last_name)
      VALUES (${oid}::uuid, ${orgId}::uuid, ${fn}, ${ln})
      ON CONFLICT DO NOTHING
    `);
  }

  // WEG-Einheitenanteile (MEA)
  await db.execute(sql`
    INSERT INTO weg_unit_owners (property_id, organization_id, unit_id, owner_id, mea_share)
    VALUES
      (${prop1}::uuid, ${orgId}::uuid, ${unitA}::uuid, ${ownerA}::uuid, '500'),
      (${prop1}::uuid, ${orgId}::uuid, ${unitB}::uuid, ${ownerB}::uuid, '300'),
      (${prop1}::uuid, ${orgId}::uuid, ${unitC}::uuid, ${ownerC}::uuid, '200')
    ON CONFLICT DO NOTHING
  `);

  // Aufwände (umlagefähig, YEAR)
  // versicherung: 1200 €  →  wird über MEA verteilt (kein Budgetplan → default)
  // ruecklage:     600 €  →  wie versicherung verteilt, aber als Rücklage erkannt
  await db.execute(sql`
    INSERT INTO expenses (property_id, category, expense_type, bezeichnung, betrag, datum, year, month, ist_umlagefaehig)
    VALUES
      (${prop1}::uuid, 'betriebskosten_umlagefaehig', 'versicherung', 'Gebäudeversicherung', '1200.00', ${YEAR + '-06-01'}, ${YEAR}, 6, true),
      (${prop1}::uuid, 'betriebskosten_umlagefaehig', 'ruecklage',    'Rücklagendotierung',  '600.00',  ${YEAR + '-06-01'}, ${YEAR}, 6, true)
    ON CONFLICT DO NOTHING
  `);

  // Sonderumlage 300 € (beschlossen, im Testjahr angelegt)
  await db.execute(sql`
    INSERT INTO weg_special_assessments (property_id, organization_id, title, total_amount, status, created_at)
    VALUES (${prop1}::uuid, ${orgId}::uuid, 'Dachsanierung',
            '300.00', 'beschlossen', ${YEAR + '-03-15T10:00:00Z'})
    ON CONFLICT DO NOTHING
  `);

  // ── Szenario 2 ───────────────────────────────────────────────────────────
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${prop2}::uuid, ${orgId}::uuid, 'Testhaus S2', 'Nutzwertgasse 2', 'Wien', '1020', 'weg')
    ON CONFLICT DO NOTHING
  `);

  for (const [uid, top] of [[unitD,'Top D'],[unitE,'Top E']] as const) {
    await db.execute(sql`
      INSERT INTO units (id, property_id, top_nummer, type, status)
      VALUES (${uid}::uuid, ${prop2}::uuid, ${top}, 'wohnung', 'aktiv')
      ON CONFLICT DO NOTHING
    `);
  }

  for (const [oid, fn, ln] of [
    [ownerD,'Dieter','Nutzwert'],[ownerE,'Eva','Kein-NW']
  ] as const) {
    await db.execute(sql`
      INSERT INTO owners (id, organization_id, first_name, last_name)
      VALUES (${oid}::uuid, ${orgId}::uuid, ${fn}, ${ln})
      ON CONFLICT DO NOTHING
    `);
  }

  // D: nutzwert=80, E: nutzwert=NULL (Fallback auf MEA)
  await db.execute(sql`
    INSERT INTO weg_unit_owners (property_id, organization_id, unit_id, owner_id, mea_share, nutzwert)
    VALUES
      (${prop2}::uuid, ${orgId}::uuid, ${unitD}::uuid, ${ownerD}::uuid, '400', '80'),
      (${prop2}::uuid, ${orgId}::uuid, ${unitE}::uuid, ${ownerE}::uuid, '200', NULL)
    ON CONFLICT DO NOTHING
  `);

  // Budget-Plan + Budget-Linie: lift → nutzwert-Schlüssel
  await db.execute(sql`
    INSERT INTO weg_budget_plans (id, property_id, organization_id, year)
    VALUES (${budgetPlan2}::uuid, ${prop2}::uuid, ${orgId}::uuid, ${YEAR})
    ON CONFLICT DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO weg_budget_lines (budget_plan_id, category, allocation_key, amount)
    VALUES (${budgetPlan2}::uuid, 'lift', 'nutzwert', '0')
    ON CONFLICT DO NOTHING
  `);

  // Aufwand 'lift' 600 €
  await db.execute(sql`
    INSERT INTO expenses (property_id, category, expense_type, bezeichnung, betrag, datum, year, month, ist_umlagefaehig)
    VALUES (${prop2}::uuid, 'betriebskosten_umlagefaehig', 'lift', 'Liftwartung', '600.00', ${YEAR + '-07-01'}, ${YEAR}, 7, true)
    ON CONFLICT DO NOTHING
  `);

  // ── Szenario 3: rundungskritisch — 3 gleiche MEA-Anteile, cent-krumme Beträge ──
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${prop3}::uuid, ${orgId}::uuid, 'Testhaus S3', 'Centgasse 3', 'Wien', '1030', 'weg')
    ON CONFLICT DO NOTHING
  `);
  for (const [uid, top] of [[unitF,'Top F'],[unitG,'Top G'],[unitH,'Top H']] as const) {
    await db.execute(sql`
      INSERT INTO units (id, property_id, top_nummer, type, status)
      VALUES (${uid}::uuid, ${prop3}::uuid, ${top}, 'wohnung', 'aktiv')
      ON CONFLICT DO NOTHING
    `);
  }
  for (const [oid, fn, ln] of [
    [ownerF,'Franz','Drittel'],[ownerG,'Greta','Drittel'],[ownerH,'Hugo','Drittel']
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
      (${prop3}::uuid, ${orgId}::uuid, ${unitF}::uuid, ${ownerF}::uuid, '100'),
      (${prop3}::uuid, ${orgId}::uuid, ${unitG}::uuid, ${ownerG}::uuid, '100'),
      (${prop3}::uuid, ${orgId}::uuid, ${unitH}::uuid, ${ownerH}::uuid, '100')
    ON CONFLICT DO NOTHING
  `);
  // Viele cent-krumme, nicht durch 3 teilbare Beträge über 2 Kategorien
  await db.execute(sql`
    INSERT INTO expenses (property_id, category, expense_type, bezeichnung, betrag, datum, year, month, ist_umlagefaehig)
    VALUES
      (${prop3}::uuid, 'betriebskosten_umlagefaehig', 'versicherung', 'V1', '100.01', ${YEAR + '-01-01'}, ${YEAR}, 1, true),
      (${prop3}::uuid, 'betriebskosten_umlagefaehig', 'versicherung', 'V2', '0.01',   ${YEAR + '-02-01'}, ${YEAR}, 2, true),
      (${prop3}::uuid, 'betriebskosten_umlagefaehig', 'versicherung', 'V3', '33.34',  ${YEAR + '-03-01'}, ${YEAR}, 3, true),
      (${prop3}::uuid, 'betriebskosten_umlagefaehig', 'ruecklage',    'R1', '0.02',   ${YEAR + '-04-01'}, ${YEAR}, 4, true),
      (${prop3}::uuid, 'betriebskosten_umlagefaehig', 'ruecklage',    'R2', '99.99',  ${YEAR + '-05-01'}, ${YEAR}, 5, true)
    ON CONFLICT DO NOTHING
  `);
  // Zwei Sonderumlagen mit nicht durch 3 teilbaren Cent-Beträgen
  await db.execute(sql`
    INSERT INTO weg_special_assessments (property_id, organization_id, title, total_amount, status, created_at)
    VALUES
      (${prop3}::uuid, ${orgId}::uuid, 'SU 1', '100.01', 'beschlossen', ${YEAR + '-02-15T10:00:00Z'}),
      (${prop3}::uuid, ${orgId}::uuid, 'SU 2', '0.05',   'beschlossen', ${YEAR + '-05-15T10:00:00Z'})
    ON CONFLICT DO NOTHING
  `);
}

async function cleanup() {
  // Szenario 1
  await db.execute(sql`DELETE FROM weg_special_assessments WHERE property_id IN (${prop1}::uuid, ${prop3}::uuid)`);
  await db.execute(sql`DELETE FROM expenses WHERE property_id IN (${prop1}::uuid, ${prop2}::uuid, ${prop3}::uuid)`);
  await db.execute(sql`DELETE FROM weg_unit_owners WHERE property_id IN (${prop1}::uuid, ${prop2}::uuid, ${prop3}::uuid)`);
  await db.execute(sql`DELETE FROM weg_vorschreibungen WHERE property_id IN (${prop1}::uuid, ${prop2}::uuid, ${prop3}::uuid)`);
  await db.execute(sql`DELETE FROM weg_budget_lines WHERE budget_plan_id=${budgetPlan2}::uuid`);
  await db.execute(sql`DELETE FROM weg_budget_plans WHERE id=${budgetPlan2}::uuid`);
  await db.execute(sql`DELETE FROM units WHERE id IN (${unitA}::uuid,${unitB}::uuid,${unitC}::uuid,${unitD}::uuid,${unitE}::uuid,${unitF}::uuid,${unitG}::uuid,${unitH}::uuid)`);
  await db.execute(sql`DELETE FROM properties WHERE id IN (${prop1}::uuid, ${prop2}::uuid, ${prop3}::uuid)`);
  await db.execute(sql`DELETE FROM owners WHERE id IN (${ownerA}::uuid,${ownerB}::uuid,${ownerC}::uuid,${ownerD}::uuid,${ownerE}::uuid,${ownerF}::uuid,${ownerG}::uuid,${ownerH}::uuid)`);
  await db.execute(sql`DELETE FROM organizations WHERE id=${orgId}::uuid`);
}

// ── Tests ───────────────────────────────────────────────────────────────────
describe('WEG-Jahresabrechnung calculateOwnerSettlement() — Integration', () => {
  beforeAll(async () => {
    await setupTestDb();
    await seed();
  });

  afterAll(async () => {
    await cleanup();
    await teardownTestDb();
  });

  // ── Szenario 1 ────────────────────────────────────────────────────────────
  describe('Szenario 1: 3 Eigentümer · gemischte Kategorien · 1 Sonderumlage', () => {
    let result: Awaited<ReturnType<typeof calculateOwnerSettlement>>;

    beforeAll(async () => {
      result = await calculateOwnerSettlement(prop1, YEAR, orgId);
    });

    test('Ergebnis enthält Daten für alle 3 Eigentümer', () => {
      expect(result.ownerResults).toHaveLength(3);
    });

    test('Summe der Einzelsalden = summary.totalDifference', () => {
      const sumSaldo = result.ownerResults.reduce((s, r) => s + r.saldo, 0);
      // Wir runden auf 2 Nachkommastellen (gleiche Methode wie die Service-Funktion)
      const rounded = Math.round(sumSaldo * 100) / 100;
      expect(rounded).toBe(result.summary.totalDifference);
    });

    test('Rücklage ist getrennt ausgewiesen (ruecklageAnteil > 0)', () => {
      for (const owner of result.ownerResults) {
        expect(owner.ruecklageAnteil).toBeGreaterThan(0);
      }
    });

    test('Summe aller ruecklageAnteil = gesamt Rücklage-Aufwand (600 €)', () => {
      const totalRuecklage = result.ownerResults.reduce((s, r) => s + r.ruecklageAnteil, 0);
      expect(Math.round(totalRuecklage * 100) / 100).toBe(600);
    });

    test('Eigentümer A (MEA 500, 50 %) hat ruecklageAnteil = 300 €', () => {
      const ownerAResult = result.ownerResults.find(r => r.ownerId === ownerA);
      expect(ownerAResult?.ruecklageAnteil).toBe(300);
    });

    test('Eigentümer B (MEA 300, 30 %) hat ruecklageAnteil = 180 €', () => {
      const ownerBResult = result.ownerResults.find(r => r.ownerId === ownerB);
      expect(ownerBResult?.ruecklageAnteil).toBe(180);
    });

    test('Eigentümer C (MEA 200, 20 %) hat ruecklageAnteil = 120 €', () => {
      const ownerCResult = result.ownerResults.find(r => r.ownerId === ownerC);
      expect(ownerCResult?.ruecklageAnteil).toBe(120);
    });

    test('Sonderumlage ist in totalSoll eingerechnet (sonderumlagen > 0)', () => {
      for (const owner of result.ownerResults) {
        expect(owner.sonderumlagen).toBeGreaterThan(0);
      }
    });

    test('Summe aller sonderumlagen = 300 €', () => {
      const total = result.ownerResults.reduce((s, r) => s + r.sonderumlagen, 0);
      expect(Math.round(total * 100) / 100).toBe(300);
    });

    test('Eigentümer A (50 %): totalSoll = 1050 €, saldo = 1050 € (keine Vorschreibungen bezahlt)', () => {
      const r = result.ownerResults.find(r => r.ownerId === ownerA)!;
      // 600 versicherung + 300 ruecklage + 150 sonderumlage = 1050
      expect(r.totalSoll).toBe(1050);
      expect(r.saldo).toBe(1050);   // keine Vorschreibungen → saldo = totalSoll
    });

    test('Eigentümer B (30 %): totalSoll = 630 €', () => {
      const r = result.ownerResults.find(r => r.ownerId === ownerB)!;
      // 360 versicherung + 180 ruecklage + 90 sonderumlage = 630
      expect(r.totalSoll).toBe(630);
    });

    test('Eigentümer C (20 %): totalSoll = 420 €', () => {
      const r = result.ownerResults.find(r => r.ownerId === ownerC)!;
      // 240 versicherung + 120 ruecklage + 60 sonderumlage = 420
      expect(r.totalSoll).toBe(420);
    });

    test('summary.totalExpenses = 1800 € (Aufwände ohne Sonderumlage)', () => {
      expect(result.summary.totalExpenses).toBe(1800);
    });
  });

  // ── Szenario 2 ────────────────────────────────────────────────────────────
  describe('Szenario 2: Fehlender Nutzwert → Fallback auf MEA + Warnung', () => {
    let result: Awaited<ReturnType<typeof calculateOwnerSettlement>>;

    beforeAll(async () => {
      result = await calculateOwnerSettlement(prop2, YEAR, orgId);
    });

    test('Ergebnis enthält Daten für beide Eigentümer', () => {
      expect(result.ownerResults).toHaveLength(2);
    });

    test('Eigentümer E (kein Nutzwert) hat Warnung über Fallback auf MEA', () => {
      const ownerEResult = result.ownerResults.find(r => r.ownerId === ownerE)!;
      expect(ownerEResult.warnings.length).toBeGreaterThan(0);
      const hasNutzwertWarning = ownerEResult.warnings.some(w =>
        w.toLowerCase().includes('nutzwert') && w.toLowerCase().includes('fallback')
      );
      expect(hasNutzwertWarning).toBe(true);
    });

    test('Eigentümer D (Nutzwert = 80) hat KEINE Nutzwert-Fallback-Warnung', () => {
      const ownerDResult = result.ownerResults.find(r => r.ownerId === ownerD)!;
      const hasNutzwertFallbackWarning = ownerDResult.warnings.some(w =>
        w.toLowerCase().includes('nutzwert') && w.toLowerCase().includes('fallback')
      );
      expect(hasNutzwertFallbackWarning).toBe(false);
    });

    test('Summe aller lift-Anteile = 600 € (gesamter Aufwand)', () => {
      // D erhält Nutzwert-Anteil (80/80 * 600 normalisiert gegen E-MEA-Anteil),
      // E erhält MEA-Fallback-Anteil; zusammen = 600 €
      const total = result.ownerResults.reduce((s, r) => {
        const lift = r.categories.find(c => c.category === 'lift');
        return s + (lift?.ownerShare ?? 0);
      }, 0);
      expect(Math.round(total * 100) / 100).toBe(600);
    });

    test('Eigentümer D hat höheren Lift-Anteil als E (Nutzwert vs. MEA-Fallback)', () => {
      const dLift = result.ownerResults.find(r => r.ownerId === ownerD)
        ?.categories.find(c => c.category === 'lift')?.ownerShare ?? 0;
      const eLift = result.ownerResults.find(r => r.ownerId === ownerE)
        ?.categories.find(c => c.category === 'lift')?.ownerShare ?? 0;
      // D: Nutzwert 80/80=100% normiert gegen E-MEA (200/600=33%), D → ~75%, E → ~25%
      // 600 * 0.75 = 450, 600 * 0.25 = 150
      expect(dLift).toBe(450);
      expect(eLift).toBe(150);
    });
  });

  // ── Szenario 3 ────────────────────────────────────────────────────────────
  describe('Szenario 3: Rundungskritische Cent-Beträge · Drittel-MEA · exakte Cent-Abstimmung', () => {
    let result: Awaited<ReturnType<typeof calculateOwnerSettlement>>;
    const cents = (v: number) => Math.round(v * 100);

    beforeAll(async () => {
      result = await calculateOwnerSettlement(prop3, YEAR, orgId);
    });

    test('Kategorie-Anteile summieren exakt auf das Kategorie-Total (kein Cent verloren)', () => {
      const byCategory = new Map<string, { shareCents: number; totalCents: number }>();
      for (const r of result.ownerResults) {
        for (const c of r.categories) {
          const e = byCategory.get(c.category) || { shareCents: 0, totalCents: cents(c.totalCost) };
          e.shareCents += cents(c.ownerShare);
          byCategory.set(c.category, e);
        }
      }
      // versicherung: 100.01 + 0.01 + 33.34 = 133.36 · ruecklage: 0.02 + 99.99 = 100.01
      expect(byCategory.get('versicherung')!.totalCents).toBe(13336);
      expect(byCategory.get('ruecklage')!.totalCents).toBe(10001);
      for (const [, e] of byCategory) {
        expect(e.shareCents).toBe(e.totalCents);
      }
    });

    test('Summe aller Sonderumlagen-Anteile = 100.06 € exakt in Cents', () => {
      const suCents = result.ownerResults.reduce((s, r) => s + cents(r.sonderumlagen), 0);
      expect(suCents).toBe(10006);
    });

    test('Eigentümer-Solls summieren exakt auf Aufwände + Sonderumlagen (233.37 + 100.06)', () => {
      const sollCents = result.ownerResults.reduce((s, r) => s + cents(r.totalSoll), 0);
      expect(sollCents).toBe(23337 + 10006);
    });

    test('summary.totalExpenses = 233.37 € und totalDifference = Summe der Salden (cent-exakt)', () => {
      expect(cents(result.summary.totalExpenses)).toBe(23337);
      const saldoCents = result.ownerResults.reduce((s, r) => s + cents(r.saldo), 0);
      expect(cents(result.summary.totalDifference)).toBe(saldoCents);
      // keine Vorschreibungen bezahlt → Differenz = Gesamtsoll
      expect(saldoCents).toBe(23337 + 10006);
    });

    test('Restcents pro Verteilungsvorgang max. 1 Cent Abweichung (4 Vorgänge → Spread ≤ 4)', () => {
      // 2 Kategorien + 2 Sonderumlagen = 4 Hare/Niemeyer-Verteilungen; bei
      // Gleichstand kann derselbe Eigentümer jeweils den Restcent bekommen.
      const solls = result.ownerResults.map((r) => cents(r.totalSoll));
      expect(Math.max(...solls) - Math.min(...solls)).toBeLessThanOrEqual(4);
    });

    test('ruecklageAnteile summieren exakt auf 100.01 €', () => {
      const rCents = result.ownerResults.reduce((s, r) => s + cents(r.ruecklageAnteil), 0);
      expect(rCents).toBe(10001);
    });
  });
});
