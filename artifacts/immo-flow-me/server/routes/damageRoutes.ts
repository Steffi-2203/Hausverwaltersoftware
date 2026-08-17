import type { Express, Request, Response } from "express";
import { db } from "../db";
import { parseMoneyInput } from "../lib/money";
import { eq, and, desc, count } from "drizzle-orm";
import * as schema from "@shared/schema";

async function getAuthContext(req: Request, res: Response) {
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

  return { userId, orgId, profile: profile[0] };
}

function generateReportNumber(): string {
  const year = new Date().getFullYear();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `SM-${year}-${random}`;
}

export function registerDamageRoutes(app: Express) {

  app.get("/api/damage-reports", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res);
      if (!ctx) return;

      const { status, propertyId } = req.query;
      const conditions: any[] = [eq(schema.damageReports.organizationId, ctx.orgId)];
      if (status && status !== 'alle') conditions.push(eq(schema.damageReports.status, status as string));
      if (propertyId) conditions.push(eq(schema.damageReports.propertyId, propertyId as string));

      const reports = await db
        .select()
        .from(schema.damageReports)
        .where(conditions.length > 1 ? and(...conditions) : conditions[0])
        .orderBy(desc(schema.damageReports.createdAt));

      res.json(reports);
    } catch (error) {
      console.error("Damage reports list error:", error);
      res.status(500).json({ error: "Fehler beim Laden der Schadensmeldungen" });
    }
  });

  app.post("/api/damage-reports", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res);
      if (!ctx) return;

      const { propertyId, unitId, tenantId, category, urgency, title, description, location, photoUrls } = req.body;

      if (!title || !description || !category) {
        return res.status(400).json({ error: "Titel, Beschreibung und Kategorie sind erforderlich" });
      }

      const [report] = await db
        .insert(schema.damageReports)
        .values({
          organizationId: ctx.orgId,
          propertyId: propertyId ?? null,
          unitId: unitId ?? null,
          tenantId: tenantId ?? null,
          reportedById: ctx.userId,
          reportNumber: generateReportNumber(),
          category,
          urgency: urgency ?? 'normal',
          title,
          description,
          location: location ?? null,
          photoUrls: photoUrls ?? null,
        })
        .returning();

      res.status(201).json(report);
    } catch (error) {
      console.error("Damage report create error:", error);
      res.status(500).json({ error: "Fehler beim Erstellen der Schadensmeldung" });
    }
  });

  app.patch("/api/damage-reports/:id", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res);
      if (!ctx) return;

      const { status, assignedToId, resolution, costEstimate, actualCost, urgency } = req.body;

      const updateData: any = { updatedAt: new Date() };
      if (status) updateData.status = status;
      if (assignedToId !== undefined) updateData.assignedToId = assignedToId;
      if (resolution !== undefined) updateData.resolution = resolution;
      if (costEstimate !== undefined) {
        if (costEstimate === null) {
          updateData.costEstimate = null;
        } else {
          const parsed = parseMoneyInput(costEstimate, "Kostenschätzung");
          if ("error" in parsed) return res.status(400).json({ error: parsed.error });
          updateData.costEstimate = parsed.value;
        }
      }
      if (actualCost !== undefined) {
        if (actualCost === null) {
          updateData.actualCost = null;
        } else {
          const parsed = parseMoneyInput(actualCost, "Tatsächliche Kosten");
          if ("error" in parsed) return res.status(400).json({ error: parsed.error });
          updateData.actualCost = parsed.value;
        }
      }
      if (urgency) updateData.urgency = urgency;
      if (status === 'behoben') updateData.resolvedAt = new Date();

      const [updated] = await db
        .update(schema.damageReports)
        .set(updateData)
        .where(and(
          eq(schema.damageReports.id, req.params.id),
          eq(schema.damageReports.organizationId, ctx.orgId)
        ))
        .returning();

      if (!updated) {
        return res.status(404).json({ error: "Schadensmeldung nicht gefunden" });
      }

      res.json(updated);
    } catch (error) {
      console.error("Damage report update error:", error);
      res.status(500).json({ error: "Fehler beim Aktualisieren" });
    }
  });

  app.get("/api/damage-reports/stats", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res);
      if (!ctx) return;

      const orgCondition = eq(schema.damageReports.organizationId, ctx.orgId);

      const stats = await db
        .select({
          status: schema.damageReports.status,
          count: count(),
        })
        .from(schema.damageReports)
        .where(orgCondition)
        .groupBy(schema.damageReports.status);

      const urgencyStats = await db
        .select({
          urgency: schema.damageReports.urgency,
          count: count(),
        })
        .from(schema.damageReports)
        .where(orgCondition)
        .groupBy(schema.damageReports.urgency);

      const total = stats.reduce((s, r) => s + Number(r.count), 0);
      const open = stats.filter(s => ['gemeldet', 'in_bearbeitung'].includes(s.status)).reduce((s, r) => s + Number(r.count), 0);
      const resolved = stats.filter(s => s.status === 'behoben').reduce((s, r) => s + Number(r.count), 0);

      res.json({ total, open, resolved, byStatus: stats, byUrgency: urgencyStats });
    } catch (error) {
      console.error("Damage reports stats error:", error);
      res.status(500).json({ error: "Fehler beim Laden der Statistiken" });
    }
  });
}
