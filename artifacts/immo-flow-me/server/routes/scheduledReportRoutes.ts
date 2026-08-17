import { Router, Request, Response } from "express";
import type { Express } from "express";
import { db } from "../db";
import { reportSchedules, properties } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { isAuthenticated, getProfileFromSession } from "./helpers";
import { generateScheduledReport, sendScheduledReport, parseNextRun } from "../services/scheduledReportsService";

const router = Router();

function getOrgId(req: any): string | null {
  return req.session?.organizationId || null;
}

async function getOrgIdFromProfile(req: any): Promise<string | null> {
  const profile = await getProfileFromSession(req);
  return profile?.organizationId || null;
}

router.get("/api/report-schedules", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const orgId = await getOrgIdFromProfile(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation gefunden" });

    const schedules = await db.select().from(reportSchedules)
      .where(eq(reportSchedules.organizationId, orgId));

    res.json(schedules);
  } catch (error) {
    console.error("Error fetching report schedules:", error);
    res.status(500).json({ error: "Fehler beim Laden der Zeitpläne" });
  }
});

router.post("/api/report-schedules", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const orgId = await getOrgIdFromProfile(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation gefunden" });

    const { reportType, schedule, propertyId, recipients } = req.body;

    if (!reportType || !schedule || !recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: "reportType, schedule und recipients sind erforderlich" });
    }

    const validTypes = ['saldenliste', 'bilanz', 'guv', 'op_liste', 'vacancy'];
    if (!validTypes.includes(reportType)) {
      return res.status(400).json({ error: `Ungültiger Berichtstyp. Erlaubt: ${validTypes.join(', ')}` });
    }

    if (propertyId) {
      const [prop] = await db.select().from(properties)
        .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)))
        .limit(1);
      if (!prop) return res.status(400).json({ error: "Liegenschaft nicht gefunden" });
    }

    const nextRun = parseNextRun(schedule);

    const [created] = await db.insert(reportSchedules).values({
      organizationId: orgId,
      reportType,
      schedule,
      propertyId: propertyId || null,
      recipients,
      isActive: true,
      nextRun,
    }).returning();

    res.status(201).json(created);
  } catch (error) {
    console.error("Error creating report schedule:", error);
    res.status(500).json({ error: "Fehler beim Erstellen des Zeitplans" });
  }
});

router.patch("/api/report-schedules/:id", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const orgId = await getOrgIdFromProfile(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation gefunden" });

    const { id } = req.params;
    const [existing] = await db.select().from(reportSchedules)
      .where(and(eq(reportSchedules.id, id), eq(reportSchedules.organizationId, orgId)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Zeitplan nicht gefunden" });

    const updateData: Record<string, any> = {};
    if (req.body.reportType !== undefined) updateData.reportType = req.body.reportType;
    if (req.body.schedule !== undefined) {
      updateData.schedule = req.body.schedule;
      updateData.nextRun = parseNextRun(req.body.schedule);
    }
    if (req.body.propertyId !== undefined) updateData.propertyId = req.body.propertyId || null;
    if (req.body.recipients !== undefined) updateData.recipients = req.body.recipients;
    if (req.body.isActive !== undefined) updateData.isActive = req.body.isActive;

    const [updated] = await db.update(reportSchedules)
      .set(updateData)
      .where(eq(reportSchedules.id, id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Error updating report schedule:", error);
    res.status(500).json({ error: "Fehler beim Aktualisieren des Zeitplans" });
  }
});

router.delete("/api/report-schedules/:id", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const orgId = await getOrgIdFromProfile(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation gefunden" });

    const { id } = req.params;
    const [existing] = await db.select().from(reportSchedules)
      .where(and(eq(reportSchedules.id, id), eq(reportSchedules.organizationId, orgId)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Zeitplan nicht gefunden" });

    await db.delete(reportSchedules).where(eq(reportSchedules.id, id));
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting report schedule:", error);
    res.status(500).json({ error: "Fehler beim Löschen des Zeitplans" });
  }
});

router.post("/api/report-schedules/:id/run-now", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const orgId = await getOrgIdFromProfile(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation gefunden" });

    const { id } = req.params;
    const [schedule] = await db.select().from(reportSchedules)
      .where(and(eq(reportSchedules.id, id), eq(reportSchedules.organizationId, orgId)))
      .limit(1);

    if (!schedule) return res.status(404).json({ error: "Zeitplan nicht gefunden" });

    await sendScheduledReport(orgId, schedule.reportType, schedule.recipients, schedule.propertyId || undefined);

    const now = new Date();
    const nextRun = parseNextRun(schedule.schedule, now);

    await db.update(reportSchedules)
      .set({ lastRun: now, nextRun })
      .where(eq(reportSchedules.id, id));

    res.json({ success: true, message: "Bericht wurde generiert und versendet" });
  } catch (error) {
    console.error("Error running report now:", error);
    res.status(500).json({ error: "Fehler beim Ausführen des Berichts" });
  }
});

export function registerScheduledReportRoutes(app: Express) {
  app.use(router);
}

export default router;
