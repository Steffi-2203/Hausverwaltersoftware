import type { Express, Request, Response } from "express";
import { db } from "../db";
import { eq, and, desc, sql, count } from "drizzle-orm";
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

  return { userId, orgId };
}

async function generateTicketNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const [result] = await db
    .select({ count: count() })
    .from(schema.supportTickets)
    .where(sql`EXTRACT(YEAR FROM ${schema.supportTickets.createdAt}) = ${year}`);

  const nextNum = (result?.count ?? 0) + 1;
  return `TK-${year}-${String(nextNum).padStart(4, "0")}`;
}

export function registerTicketRoutes(app: Express) {

  app.get("/api/tickets", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res);
      if (!ctx) return;

      if (!ctx.orgId) {
        return res.json([]);
      }

      const conditions: any[] = [eq(schema.supportTickets.organizationId, ctx.orgId)];

      const { status, category } = req.query;
      if (status && typeof status === "string") {
        conditions.push(eq(schema.supportTickets.status, status));
      }
      if (category && typeof category === "string") {
        conditions.push(eq(schema.supportTickets.category, category));
      }

      const tickets = await db
        .select()
        .from(schema.supportTickets)
        .where(and(...conditions))
        .orderBy(desc(schema.supportTickets.createdAt));

      res.json(tickets);
    } catch (error) {
      console.error("Tickets list error:", error);
      res.status(500).json({ error: "Fehler beim Laden der Tickets" });
    }
  });

  app.get("/api/tickets/:id", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res);
      if (!ctx) return;

      const { id } = req.params;

      const ticket = await db
        .select()
        .from(schema.supportTickets)
        .where(eq(schema.supportTickets.id, id))
        .limit(1);

      if (!ticket.length) {
        return res.status(404).json({ error: "Ticket nicht gefunden" });
      }

      if (ctx.orgId && ticket[0].organizationId !== ctx.orgId) {
        return res.status(403).json({ error: "Zugriff verweigert" });
      }

      const comments = await db
        .select()
        .from(schema.ticketComments)
        .where(eq(schema.ticketComments.ticketId, id))
        .orderBy(desc(schema.ticketComments.createdAt));

      res.json({ ...ticket[0], comments });
    } catch (error) {
      console.error("Ticket detail error:", error);
      res.status(500).json({ error: "Fehler beim Laden des Tickets" });
    }
  });

  app.post("/api/tickets", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res);
      if (!ctx) return;

      const { category, priority, subject, description, tenantId, unitId, propertyId, dueDate } = req.body;

      if (!category || !subject || !description) {
        return res.status(400).json({ error: "Kategorie, Betreff und Beschreibung sind erforderlich" });
      }

      const ticketNumber = await generateTicketNumber();

      const [ticket] = await db
        .insert(schema.supportTickets)
        .values({
          organizationId: ctx.orgId,
          createdById: ctx.userId,
          ticketNumber,
          category,
          priority: priority ?? "normal",
          status: "offen",
          subject,
          description,
          tenantId: tenantId ?? null,
          unitId: unitId ?? null,
          propertyId: propertyId ?? null,
          dueDate: dueDate ?? null,
        })
        .returning();

      res.status(201).json(ticket);
    } catch (error) {
      console.error("Ticket create error:", error);
      res.status(500).json({ error: "Fehler beim Erstellen des Tickets" });
    }
  });

  app.put("/api/tickets/:id", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res);
      if (!ctx) return;

      const { id } = req.params;

      const existing = await db
        .select()
        .from(schema.supportTickets)
        .where(eq(schema.supportTickets.id, id))
        .limit(1);

      if (!existing.length) {
        return res.status(404).json({ error: "Ticket nicht gefunden" });
      }

      if (ctx.orgId && existing[0].organizationId !== ctx.orgId) {
        return res.status(403).json({ error: "Zugriff verweigert" });
      }

      const { status, priority, assignedToId, resolution, dueDate } = req.body;

      const updateData: any = { updatedAt: new Date() };
      if (status !== undefined) updateData.status = status;
      if (priority !== undefined) updateData.priority = priority;
      if (assignedToId !== undefined) updateData.assignedToId = assignedToId;
      if (resolution !== undefined) updateData.resolution = resolution;
      if (dueDate !== undefined) updateData.dueDate = dueDate;

      if (status === "erledigt" || status === "geschlossen") {
        updateData.resolvedAt = new Date();
      }

      const [updated] = await db
        .update(schema.supportTickets)
        .set(updateData)
        .where(eq(schema.supportTickets.id, id))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Ticket update error:", error);
      res.status(500).json({ error: "Fehler beim Aktualisieren des Tickets" });
    }
  });

  app.post("/api/tickets/:id/comments", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res);
      if (!ctx) return;

      const { id } = req.params;

      const ticket = await db
        .select()
        .from(schema.supportTickets)
        .where(eq(schema.supportTickets.id, id))
        .limit(1);

      if (!ticket.length) {
        return res.status(404).json({ error: "Ticket nicht gefunden" });
      }

      if (ctx.orgId && ticket[0].organizationId !== ctx.orgId) {
        return res.status(403).json({ error: "Zugriff verweigert" });
      }

      const { content, isInternal } = req.body;

      if (!content) {
        return res.status(400).json({ error: "Kommentarinhalt ist erforderlich" });
      }

      const [comment] = await db
        .insert(schema.ticketComments)
        .values({
          ticketId: id,
          authorId: ctx.userId,
          content,
          isInternal: isInternal ?? false,
        })
        .returning();

      await db
        .update(schema.supportTickets)
        .set({ updatedAt: new Date() })
        .where(eq(schema.supportTickets.id, id));

      res.status(201).json(comment);
    } catch (error) {
      console.error("Ticket comment create error:", error);
      res.status(500).json({ error: "Fehler beim Erstellen des Kommentars" });
    }
  });
}
