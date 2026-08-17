import { Router } from "express";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import * as schema from "@shared/schema";
import { isAuthenticated, requireAdminAccess, getProfileFromSession } from "./helpers";
import webPush from "web-push";

const vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY || '',
  privateKey: process.env.VAPID_PRIVATE_KEY || '',
};

if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
  const generated = webPush.generateVAPIDKeys();
  vapidKeys.publicKey = generated.publicKey;
  vapidKeys.privateKey = generated.privateKey;
  console.log('Generated development VAPID keys (set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY env vars for production)');
}

webPush.setVapidDetails(
  'mailto:support@immoflowme.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

export function registerPushRoutes(app: Router) {
  app.get("/api/push/vapid-public-key", (_req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
  });

  app.post("/api/push/subscribe", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { endpoint, p256dh, auth } = req.body;
      if (!endpoint || !p256dh || !auth) {
        return res.status(400).json({ error: "Missing subscription data" });
      }

      const existing = await db.select()
        .from(schema.pushSubscriptions)
        .where(and(
          eq(schema.pushSubscriptions.userId, profile.id),
          eq(schema.pushSubscriptions.endpoint, endpoint)
        ))
        .limit(1);

      if (existing.length > 0) {
        await db.update(schema.pushSubscriptions)
          .set({ p256dh, auth })
          .where(eq(schema.pushSubscriptions.id, existing[0].id));
        return res.json({ success: true, updated: true });
      }

      await db.insert(schema.pushSubscriptions).values({
        userId: profile.id,
        organizationId: profile.organizationId || undefined,
        endpoint,
        p256dh,
        auth,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Push subscribe error:", error);
      res.status(500).json({ error: "Failed to save subscription" });
    }
  });

  app.delete("/api/push/unsubscribe", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { endpoint } = req.body;
      if (!endpoint) {
        return res.status(400).json({ error: "Missing endpoint" });
      }

      await db.delete(schema.pushSubscriptions)
        .where(and(
          eq(schema.pushSubscriptions.userId, profile.id),
          eq(schema.pushSubscriptions.endpoint, endpoint)
        ));

      res.json({ success: true });
    } catch (error) {
      console.error("Push unsubscribe error:", error);
      res.status(500).json({ error: "Failed to remove subscription" });
    }
  });

  app.post("/api/push/send", isAuthenticated, requireAdminAccess(), async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { userId, title, body, url, tag, urgent } = req.body;

      // Audit-Befund K2: Push geht ausschließlich an die eigene Organisation —
      // eine vom Client gesendete organizationId wird ignoriert.
      const callerOrgId = (profile as any).organizationId || (req.session as any)?.organizationId;
      if (!callerOrgId) {
        return res.status(403).json({ error: "Kein Organisationskontext — Zugriff verweigert" });
      }

      let subscriptions;
      if (userId) {
        subscriptions = await db.select()
          .from(schema.pushSubscriptions)
          .where(and(
            eq(schema.pushSubscriptions.userId, userId),
            eq(schema.pushSubscriptions.organizationId, callerOrgId),
          ));
      } else {
        subscriptions = await db.select()
          .from(schema.pushSubscriptions)
          .where(eq(schema.pushSubscriptions.organizationId, callerOrgId));
      }

      const payload = JSON.stringify({
        title: title || 'ImmoFlowMe',
        body: body || 'Neue Benachrichtigung',
        icon: '/icons/icon-192.png',
        url: url || '/dashboard',
        tag: tag || 'immoflow-notification',
        urgent: urgent || false,
      });

      const results = await Promise.allSettled(
        subscriptions.map(async (sub) => {
          try {
            await webPush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
              },
              payload
            );
            return { success: true, endpoint: sub.endpoint };
          } catch (error: any) {
            if (error.statusCode === 410 || error.statusCode === 404) {
              await db.delete(schema.pushSubscriptions)
                .where(eq(schema.pushSubscriptions.id, sub.id));
            }
            return { success: false, endpoint: sub.endpoint, error: error.message };
          }
        })
      );

      const sent = results.filter(r => r.status === 'fulfilled' && (r.value as any).success).length;
      const failed = results.length - sent;

      res.json({ success: true, sent, failed, total: results.length });
    } catch (error) {
      console.error("Push send error:", error);
      res.status(500).json({ error: "Failed to send notifications" });
    }
  });
}
