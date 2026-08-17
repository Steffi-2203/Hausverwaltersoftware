import { Router, Request, Response } from "express";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { getAuthContext, checkMutationPermission, objectToSnakeCase, objectToCamelCase } from "./helpers";
import * as kautionService from "../services/kautionService";
import { encryptField, decryptField } from "../lib/fieldEncryption";
import { parseMoneyInput } from "../lib/money";

const router = Router();

router.get("/api/kautionen/uebersicht", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });

    const overview = await kautionService.getKautionOverview(ctx.orgId);
    res.json(objectToSnakeCase(overview));
  } catch (error) {
    console.error("Error fetching kaution overview:", error);
    res.status(500).json({ error: "Fehler beim Laden der Kautionsübersicht" });
  }
});

router.post("/api/kautionen/zinsen-batch", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });

    const result = await kautionService.calculateAllInterest(ctx.orgId);
    res.json(objectToSnakeCase(result));
  } catch (error) {
    console.error("Error batch calculating interest:", error);
    res.status(500).json({ error: "Fehler bei der Batch-Zinsberechnung" });
  }
});

router.get("/api/kautionen", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });

    const tenantId = req.query.tenantId as string;
    const unitId = req.query.unitId as string;
    const status = req.query.status as string;

    let conditions: any[] = [eq(schema.kautionen.organizationId, ctx.orgId)];
    if (tenantId) conditions.push(eq(schema.kautionen.tenantId, tenantId));
    if (unitId) conditions.push(eq(schema.kautionen.unitId, unitId));
    if (status) conditions.push(eq(schema.kautionen.status, status));

    const where = conditions.length > 1 ? and(...conditions) : conditions[0];
    const rawData = await db.select().from(schema.kautionen).where(where).orderBy(desc(schema.kautionen.createdAt));
    const data = rawData.map(k => ({ ...k, treuhandkontoIban: decryptField(k.treuhandkontoIban) }));
    res.json(objectToSnakeCase(data));
  } catch (error) {
    console.error("Error fetching kautionen:", error);
    res.status(500).json({ error: "Fehler beim Laden der Kautionen" });
  }
});

router.post("/api/kautionen", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });

    const body = objectToCamelCase(req.body);
    const kaution = await kautionService.createKaution({
      ...body,
      organizationId: ctx.orgId,
    });
    res.json(objectToSnakeCase({ ...kaution, treuhandkontoIban: decryptField(kaution.treuhandkontoIban) }));
  } catch (error: any) {
    console.error("Error creating kaution:", error);
    res.status(400).json({ error: error.message || "Fehler beim Erstellen der Kaution" });
  }
});

router.get("/api/kautionen/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });

    const [rawKaution] = await db.select().from(schema.kautionen)
      .where(and(eq(schema.kautionen.id, req.params.id), eq(schema.kautionen.organizationId, ctx.orgId)));

    if (!rawKaution) return res.status(404).json({ error: "Kaution nicht gefunden" });

    const kaution = { ...rawKaution, treuhandkontoIban: decryptField(rawKaution.treuhandkontoIban) };
    const bewegungen = await kautionService.getKautionHistory(kaution.id);
    res.json(objectToSnakeCase({ ...kaution, bewegungen }));
  } catch (error) {
    console.error("Error fetching kaution:", error);
    res.status(500).json({ error: "Fehler beim Laden der Kaution" });
  }
});

// PATCH /api/kautionen/:id
// Nur redaktionelle Felder dürfen geändert werden.
// Alle Lebenszyklus- und Finanzfelder (status, betrag, rueckzahlungsbetrag,
// einbehaltenBetrag, einbehaltenGrund, zahlungsreferenz, rueckzahlungsdatum,
// aufgelaufeneZinsen, letzteZinsberechnung, zinssatz) sind gesperrt —
// sie werden ausschließlich durch dedizierte Endpunkte mit Validierung,
// Transaktion und Ledger-Buchung geändert.
router.patch("/api/kautionen/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });

    const body = objectToCamelCase(req.body);

    // Whitelist: nur redaktionelle/nicht-finanzielle Felder.
    // `eingangsdatum` ist GESPERRT — es bestimmt die Zinsbasis;
    // nachträgliche Änderung würde den Ledger inkonsistent machen.
    const allowed: Record<string, unknown> = {};
    if (body.treuhandkontoIban !== undefined) allowed.treuhandkontoIban = encryptField(body.treuhandkontoIban);
    if (body.treuhandkontoBank !== undefined) allowed.treuhandkontoBank = body.treuhandkontoBank;
    if (body.notes             !== undefined) allowed.notes             = body.notes;

    if (Object.keys(allowed).length === 0) {
      return res.status(400).json({
        error: 'Keine änderbaren Felder angegeben. Erlaubt: treuhandkontoIban, treuhandkontoBank, notes. Lebenszyklus-, Finanz- und Datumsfelder (inkl. eingangsdatum) werden ausschließlich durch dedizierte Endpunkte geändert.',
      });
    }

    const [updated] = await db.update(schema.kautionen)
      .set({ ...allowed, updatedAt: new Date() })
      .where(and(eq(schema.kautionen.id, req.params.id), eq(schema.kautionen.organizationId, ctx.orgId)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Kaution nicht gefunden" });
    res.json(objectToSnakeCase({ ...updated, treuhandkontoIban: decryptField(updated.treuhandkontoIban) }));
  } catch (error) {
    console.error("Error updating kaution:", error);
    res.status(500).json({ error: "Fehler beim Aktualisieren der Kaution" });
  }
});

router.post("/api/kautionen/:id/zinsen", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });

    const [kaution] = await db.select().from(schema.kautionen)
      .where(and(eq(schema.kautionen.id, req.params.id), eq(schema.kautionen.organizationId, ctx.orgId)));
    if (!kaution) return res.status(404).json({ error: "Kaution nicht gefunden" });

    const interest = await kautionService.calculateInterest(req.params.id, ctx.orgId);
    res.json({ interest, message: `Zinsen berechnet: € ${interest.toFixed(2)}` });
  } catch (error: any) {
    console.error("Error calculating interest:", error);
    res.status(400).json({ error: error.message || "Fehler bei der Zinsberechnung" });
  }
});

router.post("/api/kautionen/:id/rueckzahlung", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });

    const [kaution] = await db.select().from(schema.kautionen)
      .where(and(eq(schema.kautionen.id, req.params.id), eq(schema.kautionen.organizationId, ctx.orgId)));
    if (!kaution) return res.status(404).json({ error: "Kaution nicht gefunden" });

    const body = objectToCamelCase(req.body);
    let einbehaltenBetrag: number | undefined;
    if (body.einbehaltenBetrag !== undefined && body.einbehaltenBetrag !== null && body.einbehaltenBetrag !== "") {
      const parsed = parseMoneyInput(body.einbehaltenBetrag, "einbehalten_betrag");
      if ("error" in parsed) return res.status(400).json({ error: parsed.error });
      einbehaltenBetrag = Number(parsed.value);
    }
    const result = await kautionService.initiateReturn(req.params.id, {
      rueckzahlungsdatum: body.rueckzahlungsdatum,
      einbehaltenBetrag,
      einbehaltenGrund: body.einbehaltenGrund,
    }, ctx.orgId);
    res.json(objectToSnakeCase(result));
  } catch (error: any) {
    console.error("Error initiating return:", error);
    res.status(400).json({ error: error.message || "Fehler bei der Rückzahlung" });
  }
});

router.post("/api/kautionen/:id/abschluss", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });

    const [kaution] = await db.select().from(schema.kautionen)
      .where(and(eq(schema.kautionen.id, req.params.id), eq(schema.kautionen.organizationId, ctx.orgId)));
    if (!kaution) return res.status(404).json({ error: "Kaution nicht gefunden" });

    const body = objectToCamelCase(req.body);
    if (!body.zahlungsreferenz) {
      return res.status(400).json({ error: "zahlungsreferenz ist ein Pflichtfeld" });
    }
    const result = await kautionService.completeReturn(req.params.id, body.zahlungsreferenz, ctx.orgId);
    res.json(objectToSnakeCase(result));
  } catch (error: any) {
    console.error("Error completing return:", error);
    res.status(400).json({ error: error.message || "Fehler beim Abschluss" });
  }
});

router.get("/api/kautionen/:id/bewegungen", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });

    const [kaution] = await db.select().from(schema.kautionen)
      .where(and(eq(schema.kautionen.id, req.params.id), eq(schema.kautionen.organizationId, ctx.orgId)));
    if (!kaution) return res.status(404).json({ error: "Kaution nicht gefunden" });

    const bewegungen = await kautionService.getKautionHistory(req.params.id);
    res.json(objectToSnakeCase(bewegungen));
  } catch (error) {
    console.error("Error fetching bewegungen:", error);
    res.status(500).json({ error: "Fehler beim Laden der Bewegungen" });
  }
});

export default router;
