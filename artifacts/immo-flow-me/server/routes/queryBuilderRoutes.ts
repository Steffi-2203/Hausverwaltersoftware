import type { Express } from "express";
import { db } from "../db";
import { savedReports } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { isAuthenticated, getProfileFromSession } from "./helpers";
import { getAvailableEntities, getFieldMetadata, executeQuery, type QueryConfig } from "../services/queryBuilderService";

export function registerQueryBuilderRoutes(app: Express) {
  app.get("/api/reports/entities", isAuthenticated, async (_req, res) => {
    try {
      const entities = getAvailableEntities();
      const metadata: Record<string, any> = {};
      for (const key of Object.keys(entities)) {
        metadata[key] = {
          ...entities[key],
          fieldMetadata: getFieldMetadata(key),
        };
      }
      res.json(metadata);
    } catch (error) {
      console.error("Error fetching entities:", error);
      res.status(500).json({ error: "Fehler beim Laden der Entitäten" });
    }
  });

  app.post("/api/reports/preview", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "Keine Organisation gefunden" });
      }

      const config: QueryConfig = req.body;
      if (!config.entity || !config.selectedFields || config.selectedFields.length === 0) {
        return res.status(400).json({ error: "Entität und Felder sind erforderlich" });
      }

      config.limit = Math.min(config.limit || 100, 100);

      const rows = await executeQuery(profile.organizationId, config);
      res.json({ rows, count: rows.length });
    } catch (error: any) {
      console.error("Error executing preview query:", error);
      res.status(500).json({ error: error.message || "Fehler bei der Abfrage" });
    }
  });

  app.post("/api/reports/export", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "Keine Organisation gefunden" });
      }

      const config: QueryConfig = req.body;
      if (!config.entity || !config.selectedFields || config.selectedFields.length === 0) {
        return res.status(400).json({ error: "Entität und Felder sind erforderlich" });
      }

      config.limit = Math.min(config.limit || 1000, 10000);

      const rows = await executeQuery(profile.organizationId, config);

      if (rows.length === 0) {
        return res.status(200).send('Keine Daten');
      }

      const headers = Object.keys(rows[0]);
      const csvLines = [headers.join(';')];
      for (const row of rows) {
        const vals = headers.map(h => {
          const v = row[h];
          if (v === null || v === undefined) return '';
          const str = String(v).replace(/"/g, '""');
          return `"${str}"`;
        });
        csvLines.push(vals.join(';'));
      }

      const csv = csvLines.join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=bericht_${Date.now()}.csv`);
      res.send('\uFEFF' + csv);
    } catch (error: any) {
      console.error("Error exporting report:", error);
      res.status(500).json({ error: error.message || "Fehler beim Export" });
    }
  });

  app.get("/api/reports/saved", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "Keine Organisation gefunden" });
      }

      const reports = await db.select().from(savedReports)
        .where(eq(savedReports.organizationId, profile.organizationId));

      res.json(reports);
    } catch (error) {
      console.error("Error fetching saved reports:", error);
      res.status(500).json({ error: "Fehler beim Laden der gespeicherten Berichte" });
    }
  });

  app.post("/api/reports/saved", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "Keine Organisation gefunden" });
      }

      const { name, description, reportConfig, isShared } = req.body;
      if (!name || !reportConfig) {
        return res.status(400).json({ error: "Name und Konfiguration sind erforderlich" });
      }

      const [report] = await db.insert(savedReports).values({
        organizationId: profile.organizationId,
        name,
        description: description || null,
        reportConfig,
        createdBy: profile.id,
        isShared: isShared || false,
      }).returning();

      res.json(report);
    } catch (error) {
      console.error("Error saving report:", error);
      res.status(500).json({ error: "Fehler beim Speichern des Berichts" });
    }
  });

  app.patch("/api/reports/saved/:id", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "Keine Organisation gefunden" });
      }

      const { name, description, reportConfig, isShared } = req.body;
      const updates: any = { updatedAt: new Date() };
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (reportConfig !== undefined) updates.reportConfig = reportConfig;
      if (isShared !== undefined) updates.isShared = isShared;

      const [report] = await db.update(savedReports)
        .set(updates)
        .where(and(
          eq(savedReports.id, req.params.id),
          eq(savedReports.organizationId, profile.organizationId)
        ))
        .returning();

      if (!report) {
        return res.status(404).json({ error: "Bericht nicht gefunden" });
      }

      res.json(report);
    } catch (error) {
      console.error("Error updating report:", error);
      res.status(500).json({ error: "Fehler beim Aktualisieren des Berichts" });
    }
  });

  app.delete("/api/reports/saved/:id", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "Keine Organisation gefunden" });
      }

      const [deleted] = await db.delete(savedReports)
        .where(and(
          eq(savedReports.id, req.params.id),
          eq(savedReports.organizationId, profile.organizationId)
        ))
        .returning();

      if (!deleted) {
        return res.status(404).json({ error: "Bericht nicht gefunden" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting report:", error);
      res.status(500).json({ error: "Fehler beim Löschen des Berichts" });
    }
  });

  app.post("/api/reports/saved/:id/run", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "Keine Organisation gefunden" });
      }

      const [report] = await db.select().from(savedReports)
        .where(and(
          eq(savedReports.id, req.params.id),
          eq(savedReports.organizationId, profile.organizationId)
        ))
        .limit(1);

      if (!report) {
        return res.status(404).json({ error: "Bericht nicht gefunden" });
      }

      const config = report.reportConfig as QueryConfig;
      const rows = await executeQuery(profile.organizationId, config);

      await db.update(savedReports)
        .set({ lastRun: new Date() })
        .where(and(
          eq(savedReports.id, report.id),
          eq(savedReports.organizationId, profile.organizationId)
        ));

      res.json({ rows, count: rows.length, reportName: report.name });
    } catch (error: any) {
      console.error("Error running saved report:", error);
      res.status(500).json({ error: error.message || "Fehler beim Ausführen des Berichts" });
    }
  });
}
