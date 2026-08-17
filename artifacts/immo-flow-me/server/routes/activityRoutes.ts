import { Router, Request, Response } from "express";
import { db } from "../db";
import { eq, and, desc, sql, count } from "drizzle-orm";
import * as schema from "@shared/schema";
import { insertActivitySchema } from "@shared/schema";
import { isAuthenticated, getProfileFromSession, snakeToCamel, parsePagination } from "./helpers";

const router = Router();

router.get("/api/activities/stats", isAuthenticated, async (req: any, res: Response) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });

    const stats = await db
      .select({
        type: schema.activities.type,
        count: count(),
      })
      .from(schema.activities)
      .where(eq(schema.activities.organizationId, profile.organizationId))
      .groupBy(schema.activities.type);

    const openTasks = await db
      .select({ count: count() })
      .from(schema.activities)
      .where(
        and(
          eq(schema.activities.organizationId, profile.organizationId),
          eq(schema.activities.completed, false),
          sql`${schema.activities.dueDate} IS NOT NULL`
        )
      );

    const total = await db
      .select({ count: count() })
      .from(schema.activities)
      .where(eq(schema.activities.organizationId, profile.organizationId));

    res.json({
      total: total[0]?.count ?? 0,
      openTasks: openTasks[0]?.count ?? 0,
      byType: stats.reduce((acc: Record<string, number>, row) => {
        acc[row.type] = row.count;
        return acc;
      }, {}),
    });
  } catch (error) {
    console.error("Activity stats error:", error);
    res.status(500).json({ error: "Fehler beim Laden der Statistiken" });
  }
});

router.get("/api/activities", isAuthenticated, async (req: any, res: Response) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });

    const { limit, offset } = parsePagination(req);
    const conditions: any[] = [eq(schema.activities.organizationId, profile.organizationId)];

    if (req.query.propertyId) {
      conditions.push(eq(schema.activities.propertyId, req.query.propertyId));
    }
    if (req.query.unitId) {
      conditions.push(eq(schema.activities.unitId, req.query.unitId));
    }
    if (req.query.tenantId) {
      conditions.push(eq(schema.activities.tenantId, req.query.tenantId));
    }
    if (req.query.type) {
      conditions.push(eq(schema.activities.type, req.query.type));
    }

    const items = await db
      .select()
      .from(schema.activities)
      .where(and(...conditions))
      .orderBy(desc(schema.activities.createdAt))
      .limit(limit)
      .offset(offset);

    const totalResult = await db
      .select({ count: count() })
      .from(schema.activities)
      .where(and(...conditions));

    res.json({
      data: items,
      pagination: {
        page: Math.floor(offset / limit) + 1,
        limit,
        total: totalResult[0]?.count ?? 0,
        totalPages: Math.ceil((totalResult[0]?.count ?? 0) / limit),
      },
    });
  } catch (error) {
    console.error("Activity list error:", error);
    res.status(500).json({ error: "Fehler beim Laden der Aktivitäten" });
  }
});

router.post("/api/activities", isAuthenticated, async (req: any, res: Response) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });

    const body = snakeToCamel(req.body);
    const data = {
      ...body,
      organizationId: profile.organizationId,
      createdBy: profile.fullName || profile.email,
    };

    const parsed = insertActivitySchema.parse(data);
    const [activity] = await db.insert(schema.activities).values(parsed).returning();
    res.status(201).json(activity);
  } catch (error: any) {
    console.error("Activity create error:", error);
    if (error.name === "ZodError") {
      return res.status(400).json({ error: "Ungültige Daten", details: error.errors });
    }
    res.status(500).json({ error: "Fehler beim Erstellen der Aktivität" });
  }
});

router.patch("/api/activities/:id", isAuthenticated, async (req: any, res: Response) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });

    const activityId = parseInt(req.params.id);
    const existing = await db
      .select()
      .from(schema.activities)
      .where(and(eq(schema.activities.id, activityId), eq(schema.activities.organizationId, profile.organizationId)))
      .limit(1);

    if (!existing.length) return res.status(404).json({ error: "Aktivität nicht gefunden" });

    const body = snakeToCamel(req.body);
    const updates: any = {};
    if (body.completed !== undefined) updates.completed = body.completed;
    if (body.subject !== undefined) updates.subject = body.subject;
    if (body.description !== undefined) updates.description = body.description;

    const [updated] = await db
      .update(schema.activities)
      .set(updates)
      .where(eq(schema.activities.id, activityId))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Activity update error:", error);
    res.status(500).json({ error: "Fehler beim Aktualisieren der Aktivität" });
  }
});

router.delete("/api/activities/:id", isAuthenticated, async (req: any, res: Response) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) return res.status(403).json({ error: "Keine Organisation zugeordnet" });

    const activityId = parseInt(req.params.id);
    const existing = await db
      .select()
      .from(schema.activities)
      .where(and(eq(schema.activities.id, activityId), eq(schema.activities.organizationId, profile.organizationId)))
      .limit(1);

    if (!existing.length) return res.status(404).json({ error: "Aktivität nicht gefunden" });

    await db.delete(schema.activities).where(eq(schema.activities.id, activityId));
    res.json({ success: true });
  } catch (error) {
    console.error("Activity delete error:", error);
    res.status(500).json({ error: "Fehler beim Löschen der Aktivität" });
  }
});

export default router;
