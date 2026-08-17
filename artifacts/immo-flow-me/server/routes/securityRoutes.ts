import type { Express, Request, Response, NextFunction } from "express";
import { db } from "../db";
import { eq, and, desc, sql, count, ne } from "drizzle-orm";
import * as schema from "@shared/schema";
import { storage } from "../storage";

const ADMIN_ROLES = ['admin', 'property_manager'];

function parseUserAgent(ua: string): { browser: string; os: string; deviceType: string } {
  let browser = "Unbekannt";
  let os = "Unbekannt";
  let deviceType = "desktop";

  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) browser = "Opera";
  else if (/Chrome\//i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";

  if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS X/i.test(ua) || /Macintosh/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";

  if (/Mobile|Android.*Mobile|iPhone|iPod/i.test(ua)) deviceType = "mobile";
  else if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) deviceType = "tablet";

  return { browser, os, deviceType };
}

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

  return { userId, orgId, profile: profile[0] };
}

export function trackSession(req: Request, _res: Response, next: NextFunction) {
  const userId = (req.session as any)?.userId;
  const sessionId = req.sessionID;
  if (!userId || !sessionId) return next();

  const ua = req.headers["user-agent"] || "";
  const ipAddress = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.ip || "unknown";

  (async () => {
    try {
      const existing = await db
        .select()
        .from(schema.securitySessions)
        .where(and(eq(schema.securitySessions.sessionId, sessionId), eq(schema.securitySessions.userId, userId)))
        .limit(1);

      if (existing.length) {
        await db
          .update(schema.securitySessions)
          .set({ lastActivityAt: new Date() })
          .where(eq(schema.securitySessions.id, existing[0].id));
      } else {
        const { browser, os, deviceType } = parseUserAgent(ua);
        await db.insert(schema.securitySessions).values({
          userId,
          sessionId,
          ipAddress,
          userAgent: ua,
          deviceType,
          browser,
          os,
          isActive: true,
          lastActivityAt: new Date(),
        });
      }
    } catch (err) {
      console.error("Session tracking error:", err);
    }
  })();

  next();
}

export function registerSecurityRoutes(app: Express) {

  app.get("/api/security/sessions", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res, true);
      if (!ctx) return;

      const sessions = await db
        .select()
        .from(schema.securitySessions)
        .where(and(eq(schema.securitySessions.userId, ctx.userId), eq(schema.securitySessions.isActive, true)))
        .orderBy(desc(schema.securitySessions.lastActivityAt));

      const currentSessionId = req.sessionID;
      const result = sessions.map((s) => ({
        ...s,
        isCurrent: s.sessionId === currentSessionId,
      }));

      res.json(result);
    } catch (error) {
      console.error("Security sessions list error:", error);
      res.status(500).json({ error: "Fehler beim Laden der Sitzungen" });
    }
  });

  app.delete("/api/security/sessions/:id", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res, true);
      if (!ctx) return;

      const { id } = req.params;

      const session = await db
        .select()
        .from(schema.securitySessions)
        .where(and(eq(schema.securitySessions.id, id), eq(schema.securitySessions.userId, ctx.userId)))
        .limit(1);

      if (!session.length) {
        return res.status(404).json({ error: "Sitzung nicht gefunden" });
      }

      await db
        .update(schema.securitySessions)
        .set({ isActive: false })
        .where(eq(schema.securitySessions.id, id));

      try {
        await db
          .delete(schema.userSessions)
          .where(eq(schema.userSessions.sid, session[0].sessionId));
      } catch {}

      res.json({ success: true });
    } catch (error) {
      console.error("Security session delete error:", error);
      res.status(500).json({ error: "Fehler beim Beenden der Sitzung" });
    }
  });

  app.delete("/api/security/sessions", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res, true);
      if (!ctx) return;

      const currentSessionId = req.sessionID;

      const otherSessions = await db
        .select()
        .from(schema.securitySessions)
        .where(
          and(
            eq(schema.securitySessions.userId, ctx.userId),
            eq(schema.securitySessions.isActive, true),
            ne(schema.securitySessions.sessionId, currentSessionId)
          )
        );

      for (const s of otherSessions) {
        await db
          .update(schema.securitySessions)
          .set({ isActive: false })
          .where(eq(schema.securitySessions.id, s.id));

        try {
          await db
            .delete(schema.userSessions)
            .where(eq(schema.userSessions.sid, s.sessionId));
        } catch {}
      }

      res.json({ success: true, terminatedCount: otherSessions.length });
    } catch (error) {
      console.error("Security sessions bulk delete error:", error);
      res.status(500).json({ error: "Fehler beim Beenden der Sitzungen" });
    }
  });

  app.get("/api/security/dashboard", async (req: Request, res: Response) => {
    try {
      const ctx = await getAuthContext(req, res, true);
      if (!ctx) return;

      const [activeSessionsResult, lastSession, securityEvents] = await Promise.all([
        db
          .select({ count: count() })
          .from(schema.securitySessions)
          .where(and(eq(schema.securitySessions.userId, ctx.userId), eq(schema.securitySessions.isActive, true))),

        db
          .select()
          .from(schema.securitySessions)
          .where(eq(schema.securitySessions.userId, ctx.userId))
          .orderBy(desc(schema.securitySessions.createdAt))
          .limit(1),

        db
          .select()
          .from(schema.auditLogs)
          .where(eq(schema.auditLogs.userId, ctx.userId))
          .orderBy(desc(schema.auditLogs.createdAt))
          .limit(20),
      ]);

      const activeSessions = activeSessionsResult[0]?.count ?? 0;
      const lastLoginAt = lastSession[0]?.createdAt ?? null;

      const passwordLastChanged = ctx.profile.updatedAt ?? null;

      let securityScore = 40;
      if (ctx.profile.passwordHash) securityScore += 20;
      if (Number(activeSessions) <= 3) securityScore += 20;
      if (Number(activeSessions) === 1) securityScore += 10;
      if (ctx.profile.email) securityScore += 10;
      securityScore = Math.min(100, securityScore);

      res.json({
        activeSessions,
        lastLoginAt,
        securityEvents,
        passwordLastChanged,
        twoFactorEnabled: false,
        securityScore,
      });
    } catch (error) {
      console.error("Security dashboard error:", error);
      res.status(500).json({ error: "Fehler beim Laden des Sicherheits-Dashboards" });
    }
  });
}
