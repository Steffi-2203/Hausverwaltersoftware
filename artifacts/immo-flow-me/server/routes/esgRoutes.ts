import type { Express, Request, Response } from "express";
import { db } from "../db";
import { parseMoneyInput } from "../lib/money";
import { eq, and, desc, sum } from "drizzle-orm";
import * as schema from "@shared/schema";
import { storage } from "../storage";

const ADMIN_ROLES = ['admin', 'property_manager'];

async function getAuthContext(req: Request, res: Response, requireAdmin = false) {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    res.status(401).json({ error: "Nicht authentifiziert" });
    return null;
  }
  const profile = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.id, userId))
    .limit(1);
  if (!profile.length) {
    res.status(403).json({ error: "Profil nicht gefunden" });
    return null;
  }

  if (requireAdmin) {
    try {
      const roles = await storage.getUserRoles(userId);
      const userRoles = roles.map((r: any) => r.role);
      if (!userRoles.some((r: string) => ADMIN_ROLES.includes(r))) {
        res.status(403).json({ error: "Keine Berechtigung für diese Aktion" });
        return null;
      }
    } catch {
      res.status(403).json({ error: "Rollenprüfung fehlgeschlagen" });
      return null;
    }
  }

  let orgId = profile[0].organizationId;
  if (!orgId) {
    const userOrg = await db
      .select()
      .from(schema.userOrganizations)
      .where(and(eq(schema.userOrganizations.userId, userId), eq(schema.userOrganizations.isDefault, true)))
      .limit(1);
    if (userOrg.length) {
      orgId = userOrg[0].organizationId;
    }
  }

  if (!orgId) {
    res.status(403).json({ error: "Keine Organisation zugewiesen" });
    return null;
  }

  return { userId, orgId };
}

export function registerEsgRoutes(app: Express) {

  // ====== ENERGY CERTIFICATES ======

  app.get("/api/esg/certificates", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res);
      if (!ctx) return;

      const { propertyId } = req.query;
      const orgCondition = eq(schema.energyCertificates.organizationId, ctx.orgId);
      const whereClause = propertyId
        ? and(orgCondition, eq(schema.energyCertificates.propertyId, propertyId as string))
        : orgCondition;

      const certificates = await db
        .select()
        .from(schema.energyCertificates)
        .where(whereClause)
        .orderBy(desc(schema.energyCertificates.validUntil));

      res.json(certificates);
    } catch (error) {
      console.error("ESG certificates list error:", error);
      res.status(500).json({ error: "Fehler beim Laden der Energieausweise" });
    }
  });

  app.post("/api/esg/certificates", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res, true);
      if (!ctx) return;

      const { propertyId, certificateType, energyClass, heatingDemand, primaryEnergyDemand, co2Emissions, validFrom, validUntil, issuer, certificateNumber, notes } = req.body;

      if (!propertyId || !certificateType) {
        return res.status(400).json({ error: "Liegenschaft und Ausweistyp sind erforderlich" });
      }

      const [record] = await db
        .insert(schema.energyCertificates)
        .values({
          organizationId: ctx.orgId,
          propertyId,
          certificateType,
          energyClass: energyClass ?? null,
          heatingDemand: heatingDemand ?? null,
          primaryEnergyDemand: primaryEnergyDemand ?? null,
          co2Emissions: co2Emissions ?? null,
          validFrom: validFrom ?? null,
          validUntil: validUntil ?? null,
          issuer: issuer ?? null,
          certificateNumber: certificateNumber ?? null,
          notes: notes ?? null,
        })
        .returning();

      res.status(201).json(record);
    } catch (error) {
      console.error("ESG certificate create error:", error);
      res.status(500).json({ error: "Fehler beim Erstellen des Energieausweises" });
    }
  });

  app.delete("/api/esg/certificates/:id", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res, true);
      if (!ctx) return;

      await db
        .delete(schema.energyCertificates)
        .where(and(
          eq(schema.energyCertificates.id, req.params.id),
          eq(schema.energyCertificates.organizationId, ctx.orgId)
        ));

      res.json({ success: true });
    } catch (error) {
      console.error("ESG certificate delete error:", error);
      res.status(500).json({ error: "Fehler beim Löschen" });
    }
  });

  // ====== ENERGY CONSUMPTION ======

  app.get("/api/esg/consumption", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res);
      if (!ctx) return;

      const { propertyId, year } = req.query;
      const conditions: any[] = [eq(schema.energyConsumption.organizationId, ctx.orgId)];
      if (propertyId) conditions.push(eq(schema.energyConsumption.propertyId, propertyId as string));
      if (year) conditions.push(eq(schema.energyConsumption.year, parseInt(year as string)));

      const records = await db
        .select()
        .from(schema.energyConsumption)
        .where(conditions.length > 1 ? and(...conditions) : conditions[0])
        .orderBy(desc(schema.energyConsumption.year), desc(schema.energyConsumption.month));

      res.json(records);
    } catch (error) {
      console.error("ESG consumption list error:", error);
      res.status(500).json({ error: "Fehler beim Laden der Verbrauchsdaten" });
    }
  });

  app.post("/api/esg/consumption", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res, true);
      if (!ctx) return;

      const { propertyId, unitId, year, month, energyType, consumption, unit, costEur, co2Kg, source } = req.body;

      if (!propertyId || !year || !energyType || !consumption || !unit) {
        return res.status(400).json({ error: "Pflichtfelder: Liegenschaft, Jahr, Energieart, Verbrauch, Einheit" });
      }

      let validatedCostEur: string | null = null;
      if (costEur !== undefined && costEur !== null && costEur !== "") {
        const parsed = parseMoneyInput(costEur, "Kosten (EUR)");
        if ("error" in parsed) return res.status(400).json({ error: parsed.error });
        validatedCostEur = parsed.value;
      }

      const [record] = await db
        .insert(schema.energyConsumption)
        .values({
          organizationId: ctx.orgId,
          propertyId,
          unitId: unitId ?? null,
          year: parseInt(year),
          month: month ? parseInt(month) : null,
          energyType,
          consumption: consumption.toString(),
          unit,
          costEur: validatedCostEur,
          co2Kg: co2Kg ? co2Kg.toString() : null,
          source: source ?? null,
        })
        .returning();

      res.status(201).json(record);
    } catch (error) {
      console.error("ESG consumption create error:", error);
      res.status(500).json({ error: "Fehler beim Speichern der Verbrauchsdaten" });
    }
  });

  app.delete("/api/esg/consumption/:id", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res, true);
      if (!ctx) return;

      await db
        .delete(schema.energyConsumption)
        .where(and(
          eq(schema.energyConsumption.id, req.params.id),
          eq(schema.energyConsumption.organizationId, ctx.orgId)
        ));

      res.json({ success: true });
    } catch (error) {
      console.error("ESG consumption delete error:", error);
      res.status(500).json({ error: "Fehler beim Löschen" });
    }
  });

  // ====== ESG DASHBOARD ======

  app.get("/api/esg/dashboard", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res);
      if (!ctx) return;

      const currentYear = new Date().getFullYear();

      const certificates = await db
        .select()
        .from(schema.energyCertificates)
        .where(eq(schema.energyCertificates.organizationId, ctx.orgId));

      const consumptionCurrent = await db
        .select({
          energyType: schema.energyConsumption.energyType,
          totalConsumption: sum(schema.energyConsumption.consumption),
          totalCost: sum(schema.energyConsumption.costEur),
          totalCo2: sum(schema.energyConsumption.co2Kg),
        })
        .from(schema.energyConsumption)
        .where(and(
          eq(schema.energyConsumption.organizationId, ctx.orgId),
          eq(schema.energyConsumption.year, currentYear)
        ))
        .groupBy(schema.energyConsumption.energyType);

      const consumptionPrevious = await db
        .select({
          energyType: schema.energyConsumption.energyType,
          totalConsumption: sum(schema.energyConsumption.consumption),
          totalCost: sum(schema.energyConsumption.costEur),
          totalCo2: sum(schema.energyConsumption.co2Kg),
        })
        .from(schema.energyConsumption)
        .where(and(
          eq(schema.energyConsumption.organizationId, ctx.orgId),
          eq(schema.energyConsumption.year, currentYear - 1)
        ))
        .groupBy(schema.energyConsumption.energyType);

      const properties = await db
        .select({ id: schema.properties.id, name: schema.properties.name })
        .from(schema.properties)
        .where(eq(schema.properties.organizationId, ctx.orgId));

      const expiredCerts = certificates.filter(c => c.validUntil && new Date(c.validUntil) < new Date()).length;
      const activeCerts = certificates.filter(c => !c.validUntil || new Date(c.validUntil) >= new Date()).length;

      let esgScore = 50;
      if (activeCerts > 0) esgScore += 15;
      if (consumptionCurrent.length > 0) esgScore += 15;
      const goodClasses = certificates.filter(c => ['A++', 'A+', 'A', 'B'].includes(c.energyClass || '')).length;
      if (goodClasses > certificates.length / 2) esgScore += 20;
      if (expiredCerts === 0 && certificates.length > 0) esgScore += 10;
      esgScore = Math.min(100, esgScore);

      res.json({
        esgScore,
        certificates: {
          total: certificates.length,
          active: activeCerts,
          expired: expiredCerts,
        },
        consumptionCurrent,
        consumptionPrevious,
        propertiesCount: properties.length,
        properties,
      });
    } catch (error) {
      console.error("ESG dashboard error:", error);
      res.status(500).json({ error: "Fehler beim Laden des ESG-Dashboards" });
    }
  });
}
