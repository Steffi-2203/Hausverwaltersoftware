/**
 * WEG-Jahresabrechnung — Prüfung auf fehlende Vorschreibungen
 *
 * Sicherstellt dass sowohl die Vorschau- als auch die Erstellen-Route
 * mit einer klaren deutschen Fehlermeldung ablehnen wenn für die
 * gewählte Liegenschaft + Jahr noch keine Vorschreibungen vorhanden sind.
 *
 * Szenarien:
 *  1. GET /api/weg/settlement/preview — 0 Vorschreibungen → 400 + Hinweis auf Liegenschaft/Jahr
 *  2. POST /api/weg/settlement/create — 0 Vorschreibungen → 400 + Hinweis
 *  3. GET /api/weg/settlement/preview — Vorschreibungen vorhanden → kein 400 (Prüfung passiert)
 *  4. Fehlerantwort enthält error_code='NO_VORSCHREIBUNGEN'
 */

import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { rootDb as db } from '../../server/db';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { setupTestDb, teardownTestDb } from '../helpers/db';
import { addOrgContext } from '../helpers/withOrgContext';

// ── Testdaten ────────────────────────────────────────────────────────────────
const orgId   = uuidv4();
const userId  = uuidv4();
const propId  = uuidv4();
const unitId  = uuidv4();
const ownerId = uuidv4();

const YEAR_EMPTY = 2020;   // kein Vorschreibungs-Datensatz für dieses Jahr
const YEAR_WITH  = 2021;   // 1 Vorschreibungs-Datensatz für dieses Jahr

// ── Express-Testapp ───────────────────────────────────────────────────────────
async function buildTestApp() {
  const { default: wegRoutes } = await import('../../server/routes/wegRoutes');
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organizationId: orgId };
    next();
  });
  addOrgContext(app, orgId);
  app.use(wegRoutes);
  return app;
}

let app: express.Express;

// ── Seed & Cleanup ───────────────────────────────────────────────────────────
async function seed() {
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgId}::uuid,'NVorschr-Org') ON CONFLICT DO NOTHING`);
  // E-Mail pro Lauf eindeutig machen — fixe E-Mail würde bei abgebrochenen Läufen
  // einen ON-CONFLICT-Skip auslösen, sodass userId nicht in profiles landet und
  // der nachfolgende user_roles-Insert mit FK-Fehler scheitert (siehe memory: test-seed-unique-emails).
  const uniqueEmail = `nvp-${userId.slice(0, 8)}@test.at`;
  await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${userId}::uuid,${uniqueEmail},${orgId}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${userId}::uuid,'admin') ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid,${orgId}::uuid,'Testliegenschaft NVP','Musterstr 1','Wien','1010','weg')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status)
    VALUES (${unitId}::uuid,${propId}::uuid,'Top 1','wohnung','aktiv')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name)
    VALUES (${ownerId}::uuid,${orgId}::uuid,'Test','Eigentümer')
    ON CONFLICT DO NOTHING
  `);

  // Vorschreibung NUR für YEAR_WITH (nicht für YEAR_EMPTY)
  await db.execute(sql`
    INSERT INTO weg_vorschreibungen
      (id, organization_id, property_id, unit_id, owner_id, year, month,
       mea_share, betriebskosten, ruecklage, gesamtbetrag, status)
    VALUES
      (gen_random_uuid(),${orgId}::uuid,${propId}::uuid,${unitId}::uuid,${ownerId}::uuid,
       ${YEAR_WITH},1,'1000.0000','100.00','50.00','150.00','offen')
    ON CONFLICT DO NOTHING
  `);
}

async function cleanup() {
  await db.execute(sql`DELETE FROM weg_vorschreibungen WHERE property_id=${propId}::uuid`);
  await db.execute(sql`DELETE FROM owners WHERE id=${ownerId}::uuid`);
  await db.execute(sql`DELETE FROM units WHERE id=${unitId}::uuid`);
  await db.execute(sql`DELETE FROM properties WHERE id=${propId}::uuid`);
  await db.execute(sql`DELETE FROM user_roles WHERE user_id=${userId}::uuid`);
  await db.execute(sql`DELETE FROM profiles WHERE id=${userId}::uuid`);
  await db.execute(sql`DELETE FROM organizations WHERE id=${orgId}::uuid`);
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe('WEG-Abrechnung — keine Vorschreibungen', () => {
  beforeAll(async () => {
    await setupTestDb();
    await seed();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await cleanup();
    await teardownTestDb();
  });

  // 1. Preview — kein Datenmaterial → 400 mit sprechender Meldung
  test('Preview ohne Vorschreibungen → 400 + Liegenschaft + Jahr in Meldung', async () => {
    const res = await request(app)
      .get(`/api/weg/settlement/preview?propertyId=${propId}&year=${YEAR_EMPTY}`)
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Testliegenschaft NVP/);
    expect(res.body.error).toMatch(String(YEAR_EMPTY));
    expect(res.body.error).toMatch(/Vorschreibungen/i);
    expect(res.body.error_code).toBe('NO_VORSCHREIBUNGEN');
  });

  // 2. Create — kein Datenmaterial → 400 mit sprechender Meldung
  test('Create ohne Vorschreibungen → 400 + Liegenschaft + Jahr in Meldung', async () => {
    const res = await request(app)
      .post('/api/weg/settlement/create')
      .send({ property_id: propId, year: YEAR_EMPTY });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Testliegenschaft NVP/);
    expect(res.body.error).toMatch(String(YEAR_EMPTY));
    expect(res.body.error).toMatch(/Vorschreibungen/i);
    expect(res.body.error_code).toBe('NO_VORSCHREIBUNGEN');
  });

  // 3. Preview mit Vorschreibungen → KEIN 400 wegen fehlender Vorschreibungen
  // (kann weiter scheitern wegen fehlender MEA-Daten, aber nicht mit NO_VORSCHREIBUNGEN)
  test('Preview MIT Vorschreibungen → kein error_code NO_VORSCHREIBUNGEN', async () => {
    const res = await request(app)
      .get(`/api/weg/settlement/preview?propertyId=${propId}&year=${YEAR_WITH}`)
      .send();

    // Darf kein NO_VORSCHREIBUNGEN zurückgeben
    expect(res.body.error_code).not.toBe('NO_VORSCHREIBUNGEN');
    // Falls 400, dann wegen MEA/Eigentümer-Fehlen — nicht wegen Vorschreibungen
    if (res.status === 400) {
      expect(res.body.error).not.toMatch(/noch keine Vorschreibungen/);
    }
  });

  // 4. Fehlermeldung enthält Hinweis auf Lösungsweg
  test('Fehlermeldung enthält Handlungsanweisung', async () => {
    const res = await request(app)
      .get(`/api/weg/settlement/preview?propertyId=${propId}&year=${YEAR_EMPTY}`)
      .send();

    expect(res.body.error).toMatch(/generieren/i);
  });
});
