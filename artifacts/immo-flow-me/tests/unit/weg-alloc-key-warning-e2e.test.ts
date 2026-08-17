/**
 * Task #83: Verteilungsschlüssel-Warnung verschwindet nach explizitem PATCH.
 *
 * End-to-end: Plan mit Budgetzeile OHNE expliziten Verteilungsschlüssel
 * (allocation_key = NULL) → Abrechnungs-Preview warnt "kein Verteilungsschlüssel
 * konfiguriert → MEA-Anteil als Standard verwendet". Nach PATCH auf die Zeile
 * (allocation_key = 'nutzflaeche') ist die Warnung weg und
 * calculateOwnerSettlement wendet tatsächlich den Nutzflächen-Schlüssel an
 * (Anteile nach m², nicht nach MEA).
 *
 * node:test-Variante (läuft bei jedem Build), Muster wie
 * tests/unit/payments-cross-org.test.ts.
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";

import { rootDb as db } from "../../server/db";
import wegRouter from "../../server/routes/wegRoutes";
import { addOrgContext } from "../helpers/withOrgContext";

const YEAR = 2086;
const CATEGORY = "hausbetreuung"; // muss zu expenses.expense_type passen

const orgId   = randomUUID();
const userId  = randomUUID();
const propId  = randomUUID();
const unit1   = randomUUID(); // 50 m², MEA 700
const unit2   = randomUUID(); // 150 m², MEA 300
const owner1  = randomUUID();
const owner2  = randomUUID();
const planId  = randomUUID();
const lineId  = randomUUID();
const expId   = randomUUID();

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, email: "alloc83@test.at", organizationId: orgId };
    next();
  });
  addOrgContext(app, orgId);
  app.use(wegRouter);
  return app;
}
const app = buildApp();

async function seed() {
  await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${orgId}::uuid, 'Alloc83-Org') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO profiles (id, email, organization_id) VALUES (${userId}::uuid, 'alloc83@test.at', ${orgId}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${userId}::uuid, 'admin') ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, address, city, postal_code, management_type)
    VALUES (${propId}::uuid, ${orgId}::uuid, 'Alloc83-Haus', 'Testweg 83', 'Wien', '1010', 'weg')
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO units (id, property_id, top_nummer, type, status, flaeche)
    VALUES (${unit1}::uuid, ${propId}::uuid, 'Top 1', 'wohnung', 'aktiv', '50'),
           (${unit2}::uuid, ${propId}::uuid, 'Top 2', 'wohnung', 'aktiv', '150')
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO owners (id, organization_id, first_name, last_name)
    VALUES (${owner1}::uuid, ${orgId}::uuid, 'Anna', 'Eins'),
           (${owner2}::uuid, ${orgId}::uuid, 'Bernd', 'Zwei')
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO weg_unit_owners (property_id, organization_id, unit_id, owner_id, mea_share)
    VALUES (${propId}::uuid, ${orgId}::uuid, ${unit1}::uuid, ${owner1}::uuid, '700'),
           (${propId}::uuid, ${orgId}::uuid, ${unit2}::uuid, ${owner2}::uuid, '300')
    ON CONFLICT DO NOTHING`);

  // Plan im Status 'entwurf' + Zeile OHNE expliziten Schlüssel (NULL!)
  await db.execute(sql`
    INSERT INTO weg_budget_plans (id, organization_id, property_id, year, status, total_amount)
    VALUES (${planId}::uuid, ${orgId}::uuid, ${propId}::uuid, ${YEAR}, 'entwurf', '0')
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO weg_budget_lines (id, budget_plan_id, category, amount, allocation_key)
    VALUES (${lineId}::uuid, ${planId}::uuid, ${CATEGORY}, '1200.00', NULL)
    ON CONFLICT DO NOTHING`);

  // Umlagefähige Ausgabe in derselben Kategorie
  await db.execute(sql`
    INSERT INTO expenses (id, property_id, category, expense_type, bezeichnung, betrag, datum, year, month, ist_umlagefaehig)
    VALUES (${expId}::uuid, ${propId}::uuid, 'betriebskosten_umlagefaehig', ${CATEGORY}, 'Hausbetreuung Task83', '1200.00', '2086-06-01', ${YEAR}, 6, true)
    ON CONFLICT DO NOTHING`);

  // Mindestens eine Vorschreibung, sonst blockt der Preview-Endpoint (NO_VORSCHREIBUNGEN)
  await db.execute(sql`
    INSERT INTO weg_vorschreibungen (organization_id, property_id, unit_id, owner_id, budget_plan_id, year, month, mea_share, gesamtbetrag)
    VALUES (${orgId}::uuid, ${propId}::uuid, ${unit1}::uuid, ${owner1}::uuid, ${planId}::uuid, ${YEAR}, 1, '700', '100.00')
    ON CONFLICT DO NOTHING`);
}

async function cleanup() {
  try {
    await db.execute(sql`DELETE FROM weg_vorschreibungen WHERE property_id = ${propId}::uuid`);
    await db.execute(sql`DELETE FROM expenses WHERE id = ${expId}::uuid`);
    await db.execute(sql`DELETE FROM weg_budget_lines WHERE budget_plan_id = ${planId}::uuid`);
    await db.execute(sql`DELETE FROM weg_budget_plans WHERE id = ${planId}::uuid`);
    await db.execute(sql`DELETE FROM weg_unit_owners WHERE property_id = ${propId}::uuid`);
    await db.execute(sql`DELETE FROM owners WHERE id IN (${owner1}::uuid, ${owner2}::uuid)`);
    await db.execute(sql`DELETE FROM units WHERE property_id = ${propId}::uuid`);
    await db.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM profiles WHERE id = ${userId}::uuid`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
  } catch (e) {
    console.error("[alloc83] cleanup error:", e);
  }
}

before(async () => { await cleanup(); await seed(); });
after(async () => { await cleanup(); });

const WARN_FRAGMENT = "kein Verteilungsschlüssel konfiguriert";

async function fetchPreview() {
  const res = await request(app)
    .get(`/api/weg/settlement/preview?propertyId=${propId}&year=${YEAR}`);
  assert.equal(res.status, 200, `Preview fehlgeschlagen: ${JSON.stringify(res.body)}`);
  return res.body;
}

function allWarnings(body: any): string[] {
  return (body.owner_results as any[]).flatMap((o) => o.warnings ?? []);
}

function categoryFor(body: any, ownerId: string) {
  const owner = (body.owner_results as any[]).find((o) => o.owner_id === ownerId);
  assert.ok(owner, `Owner ${ownerId} fehlt im Preview`);
  const cat = (owner.categories as any[]).find((c) => (c.category || "").toLowerCase() === CATEGORY);
  assert.ok(cat, `Kategorie ${CATEGORY} fehlt bei Owner ${ownerId}`);
  return cat;
}

describe("Task #83: Warnung 'kein Verteilungsschlüssel' verschwindet nach PATCH", () => {
  test("1) Zeile ohne Key → Preview warnt und rechnet mit MEA", async () => {
    const body = await fetchPreview();

    const warnings = allWarnings(body);
    assert.ok(
      warnings.some((w) => w.includes(WARN_FRAGMENT) && w.includes(CATEGORY)),
      `Erwartete Warnung fehlt. Warnings: ${JSON.stringify(warnings)}`
    );

    // MEA-Verteilung: 1200 → 840 (MEA 700) / 360 (MEA 300)
    const c1 = categoryFor(body, owner1);
    const c2 = categoryFor(body, owner2);
    assert.equal(c1.allocation_key, "MEA");
    assert.equal(Number(c1.owner_share), 840);
    assert.equal(Number(c2.owner_share), 360);
  });

  test("2) PATCH allocation_key='nutzflaeche' auf die Zeile → 200 + persistiert", async () => {
    const res = await request(app)
      .patch(`/api/weg/budget-lines/${lineId}`)
      .send({ allocation_key: "nutzflaeche" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.allocation_key, "nutzflaeche");

    const check = await db.execute(sql`SELECT allocation_key FROM weg_budget_lines WHERE id = ${lineId}::uuid`);
    assert.equal((check.rows[0] as any).allocation_key, "nutzflaeche");
  });

  test("3) Preview nach PATCH: Warnung weg, Nutzflächen-Schlüssel angewendet", async () => {
    const body = await fetchPreview();

    const warnings = allWarnings(body);
    assert.ok(
      !warnings.some((w) => w.includes(WARN_FRAGMENT) && w.includes(CATEGORY)),
      `Warnung dürfte nicht mehr erscheinen. Warnings: ${JSON.stringify(warnings)}`
    );

    // Nutzflächen-Verteilung: 1200 → 300 (50 m² von 200) / 900 (150 m² von 200).
    // Wäre fälschlich weiter MEA aktiv, käme 840/360 heraus.
    const c1 = categoryFor(body, owner1);
    const c2 = categoryFor(body, owner2);
    assert.equal(c1.allocation_key, "Nutzfläche");
    assert.equal(Number(c1.owner_share), 300);
    assert.equal(Number(c2.owner_share), 900);
  });

  test("4) gemischte Zeilen (explizit + NULL) derselben Kategorie → Hinweis-Warnung, expliziter Key bleibt angewendet", async () => {
    const extraLine = randomUUID();
    await db.execute(sql`
      INSERT INTO weg_budget_lines (id, budget_plan_id, category, amount, allocation_key)
      VALUES (${extraLine}::uuid, ${planId}::uuid, ${CATEGORY}, '100.00', NULL)`);
    try {
      const body = await fetchPreview();
      const warnings = allWarnings(body);
      // Nicht die "kein Schlüssel"-Warnung (ein expliziter Key existiert ja) …
      assert.ok(!warnings.some((w) => w.includes(WARN_FRAGMENT) && w.includes(CATEGORY)));
      // … aber die Unvollständigkeits-Warnung muss erscheinen
      assert.ok(
        warnings.some((w) => w.includes("ohne expliziten Verteilungsschlüssel") && w.includes(CATEGORY)),
        `Hinweis-Warnung fehlt. Warnings: ${JSON.stringify(warnings)}`
      );
      // Der explizite Schlüssel bleibt angewendet
      assert.equal(categoryFor(body, owner1).allocation_key, "Nutzfläche");
    } finally {
      await db.execute(sql`DELETE FROM weg_budget_lines WHERE id = ${extraLine}::uuid`);
    }
  });

  test("5) widersprüchliche explizite Schlüssel derselben Kategorie → Konflikt-Warnung", async () => {
    const extraLine = randomUUID();
    await db.execute(sql`
      INSERT INTO weg_budget_lines (id, budget_plan_id, category, amount, allocation_key)
      VALUES (${extraLine}::uuid, ${planId}::uuid, ${CATEGORY}, '100.00', 'einheiten')`);
    try {
      const body = await fetchPreview();
      const warnings = allWarnings(body);
      assert.ok(
        warnings.some((w) => w.includes("widersprüchliche Verteilungsschlüssel") && w.includes(CATEGORY)),
        `Konflikt-Warnung fehlt. Warnings: ${JSON.stringify(warnings)}`
      );
    } finally {
      await db.execute(sql`DELETE FROM weg_budget_lines WHERE id = ${extraLine}::uuid`);
    }
  });

  test("6) explizit gespeichertes 'mea' gilt als konfiguriert → keine Warnung", async () => {
    const meaLine = randomUUID();
    const meaCat = "verwaltung";
    const meaExp = randomUUID();
    await db.execute(sql`
      INSERT INTO weg_budget_lines (id, budget_plan_id, category, amount, allocation_key)
      VALUES (${meaLine}::uuid, ${planId}::uuid, ${meaCat}, '200.00', 'mea')`);
    await db.execute(sql`
      INSERT INTO expenses (id, property_id, category, expense_type, bezeichnung, betrag, datum, year, month, ist_umlagefaehig)
      VALUES (${meaExp}::uuid, ${propId}::uuid, 'betriebskosten_umlagefaehig', 'verwaltung', 'Verwaltung Task83', '200.00', '2086-06-01', ${YEAR}, 6, true)`);
    try {
      const body = await fetchPreview();
      const warnings = allWarnings(body);
      assert.ok(
        !warnings.some((w) => w.includes(meaCat)),
        `Explizites 'mea' darf keine Warnung auslösen. Warnings: ${JSON.stringify(warnings)}`
      );
      assert.equal(categoryFor2(body, owner1, meaCat).allocation_key, "MEA");
    } finally {
      await db.execute(sql`DELETE FROM expenses WHERE id = ${meaExp}::uuid`);
      await db.execute(sql`DELETE FROM weg_budget_lines WHERE id = ${meaLine}::uuid`);
    }
  });
});

function categoryFor2(body: any, ownerId: string, cat: string) {
  const owner = (body.owner_results as any[]).find((o) => o.owner_id === ownerId);
  assert.ok(owner, `Owner ${ownerId} fehlt im Preview`);
  const c = (owner.categories as any[]).find((x) => (x.category || "").toLowerCase() === cat);
  assert.ok(c, `Kategorie ${cat} fehlt bei Owner ${ownerId}`);
  return c;
}
