import type { Express, Request, Response } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
// Auth-Bootstrap: diese Routen laufen VOR dem Aufbau eines orgContext
// (Login, Invite-Token-Prüfung, Passwort-Setzen). tenant_portal_access ist
// in ORG_POLICY_EXCLUDES — kein org-gebundener Kontext verfügbar oder nötig.
import { rootDb as db } from "../db";
import * as schema from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { sendEmail } from "../lib/resend";

const SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;

export function registerTenantAuthRoutes(app: Express) {

  app.post("/api/tenant-auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "E-Mail und Passwort sind erforderlich" });
      }

      const access = await db
        .select()
        .from(schema.tenantPortalAccess)
        .where(and(
          eq(schema.tenantPortalAccess.email, email.toLowerCase()),
          eq(schema.tenantPortalAccess.isActive, true)
        ))
        .limit(1);

      if (!access.length || !access[0].passwordHash) {
        return res.status(401).json({ error: "Ungültige E-Mail oder Passwort" });
      }

      const isValid = await bcrypt.compare(password, access[0].passwordHash);
      if (!isValid) {
        return res.status(401).json({ error: "Ungültige E-Mail oder Passwort" });
      }

      (req.session as any).tenantPortalId = access[0].id;
      (req.session as any).tenantId = access[0].tenantId;

      await db
        .update(schema.tenantPortalAccess)
        .set({ lastLoginAt: new Date() })
        .where(eq(schema.tenantPortalAccess.id, access[0].id));

      req.session.save((err) => {
        if (err) {
          console.error("Tenant session save error:", err);
          return res.status(500).json({ error: "Sitzung konnte nicht gespeichert werden" });
        }
        res.json({ success: true, tenantId: access[0].tenantId });
      });
    } catch (error) {
      console.error("Tenant login error:", error);
      res.status(500).json({ error: "Anmeldung fehlgeschlagen" });
    }
  });

  app.get("/api/tenant-auth/session", async (req: Request, res: Response) => {
    try {
      const tenantPortalId = (req.session as any)?.tenantPortalId;
      if (tenantPortalId) {
        const tenantId = (req.session as any)?.tenantId;
        return res.json({ authenticated: true, tenantId });
      }
      res.json({ authenticated: false });
    } catch (error) {
      console.error("Tenant session check error:", error);
      res.json({ authenticated: false });
    }
  });

  app.post("/api/tenant-auth/logout", async (req: Request, res: Response) => {
    try {
      const isProduction = process.env.NODE_ENV === 'production';
      const cookieName = isProduction ? '__Secure-immo_sid' : 'immo_sid';
      req.session.destroy((err) => {
        if (err) {
          return res.status(500).json({ error: "Abmeldung fehlgeschlagen" });
        }
        res.clearCookie(cookieName, {
          path: '/',
          httpOnly: true,
          secure: isProduction,
          sameSite: isProduction ? 'none' : 'lax',
        });
        res.json({ success: true });
      });
    } catch (error) {
      console.error("Tenant logout error:", error);
      res.status(500).json({ error: "Abmeldung fehlgeschlagen" });
    }
  });

  app.get("/api/tenant-auth/invite/:token", async (req: Request, res: Response) => {
    try {
      const { token } = req.params;

      if (!token) {
        return res.json({ valid: false });
      }

      const access = await db
        .select()
        .from(schema.tenantPortalAccess)
        .where(eq(schema.tenantPortalAccess.inviteToken, token))
        .limit(1);

      if (!access.length) {
        return res.json({ valid: false });
      }

      if (!access[0].inviteExpiresAt || new Date(access[0].inviteExpiresAt) < new Date()) {
        return res.json({ valid: false, reason: "Einladung abgelaufen" });
      }

      res.json({ valid: true, email: access[0].email });
    } catch (error) {
      console.error("Tenant invite check error:", error);
      res.json({ valid: false });
    }
  });

  app.post("/api/tenant-auth/set-password", async (req: Request, res: Response) => {
    try {
      const { token, password } = req.body;

      if (!token || !password) {
        return res.status(400).json({ error: "Token und Passwort sind erforderlich" });
      }

      if (password.length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ error: `Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein` });
      }

      const access = await db
        .select()
        .from(schema.tenantPortalAccess)
        .where(eq(schema.tenantPortalAccess.inviteToken, token))
        .limit(1);

      if (!access.length) {
        return res.status(400).json({ error: "Ungültiger oder abgelaufener Einladungstoken" });
      }

      if (!access[0].inviteExpiresAt || new Date(access[0].inviteExpiresAt) < new Date()) {
        return res.status(400).json({ error: "Einladungstoken ist abgelaufen" });
      }

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

      await db
        .update(schema.tenantPortalAccess)
        .set({
          passwordHash,
          inviteToken: null,
          inviteExpiresAt: null,
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.tenantPortalAccess.id, access[0].id));

      (req.session as any).tenantPortalId = access[0].id;
      (req.session as any).tenantId = access[0].tenantId;

      req.session.save((err) => {
        if (err) {
          console.error("Tenant session save error:", err);
          return res.status(500).json({ error: "Sitzung konnte nicht gespeichert werden" });
        }
        res.json({ success: true, tenantId: access[0].tenantId });
      });
    } catch (error) {
      console.error("Tenant set-password error:", error);
      res.status(500).json({ error: "Passwort konnte nicht gesetzt werden" });
    }
  });

  app.post("/api/tenant-portal/send-invite", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Nicht authentifiziert" });
      }

      const { tenantPortalAccessId } = req.body;
      if (!tenantPortalAccessId) {
        return res.status(400).json({ error: "tenantPortalAccessId ist erforderlich" });
      }

      const userOrgs = await db
        .select()
        .from(schema.userOrganizations)
        .where(eq(schema.userOrganizations.userId, userId));
      const orgIds = userOrgs.map(uo => uo.organizationId);
      if (!orgIds.length) {
        return res.status(403).json({ error: "Keine Organisation zugewiesen" });
      }

      const accessResult = await db
        .select({ tenantPortalAccess: schema.tenantPortalAccess })
        .from(schema.tenantPortalAccess)
        .innerJoin(schema.tenants, eq(schema.tenantPortalAccess.tenantId, schema.tenants.id))
        .innerJoin(schema.units, eq(schema.tenants.unitId, schema.units.id))
        .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
        .where(and(
          eq(schema.tenantPortalAccess.id, tenantPortalAccessId),
          eq(schema.properties.organizationId, orgIds[0])
        ))
        .limit(1);

      if (!accessResult.length) {
        return res.status(404).json({ error: "Mieterportal-Zugang nicht gefunden" });
      }

      const access = [accessResult[0].tenantPortalAccess];

      const inviteToken = crypto.randomBytes(32).toString("hex");
      const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await db
        .update(schema.tenantPortalAccess)
        .set({
          inviteToken,
          inviteExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.tenantPortalAccess.id, tenantPortalAccessId));

      const domain = process.env.REPLIT_DOMAINS?.split(',')[0] || 'localhost:5000';
      const inviteUrl = `https://${domain}/mieter-login?invite=${inviteToken}`;

      const tenant = await db
        .select()
        .from(schema.tenants)
        .where(eq(schema.tenants.id, access[0].tenantId))
        .limit(1);

      const tenantName = tenant.length
        ? `${tenant[0].firstName} ${tenant[0].lastName}`
        : 'Mieter';

      await sendEmail({
        to: access[0].email,
        subject: "Einladung zum Mieterportal - ImmoFlowMe",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #1a365d; margin-bottom: 5px;">ImmoFlowMe</h1>
              <p style="color: #666; font-size: 14px;">Professionelle Hausverwaltung</p>
            </div>
            
            <h2 style="color: #1a365d;">Einladung zum Mieterportal</h2>
            
            <p>Sehr geehrte(r) ${tenantName},</p>
            
            <p>Sie wurden zum <strong>ImmoFlowMe Mieterportal</strong> eingeladen. 
            Über das Mieterportal haben Sie jederzeit Zugriff auf:</p>
            
            <ul style="color: #333; line-height: 1.8;">
              <li>Ihre Vorschreibungen und Zahlungsübersicht</li>
              <li>Ihren Mietvertrag und Mieterdaten</li>
              <li>Wichtige Dokumente</li>
              <li>Kontoinformationen</li>
            </ul>
            
            <p>Klicken Sie auf den folgenden Link, um Ihr Passwort festzulegen und sich anzumelden:</p>
            
            <p style="margin: 30px 0; text-align: center;">
              <a href="${inviteUrl}" 
                 style="background-color: #2563eb; color: white; padding: 14px 28px; 
                        text-decoration: none; border-radius: 6px; display: inline-block;
                        font-weight: bold; font-size: 16px;">
                Passwort festlegen &amp; anmelden
              </a>
            </p>
            
            <p style="color: #666; font-size: 14px;">
              Dieser Link ist <strong>7 Tage</strong> gültig. Falls der Link abgelaufen ist, 
              wenden Sie sich bitte an Ihre Hausverwaltung.
            </p>
            
            <p style="color: #666; font-size: 14px;">
              Falls Sie diese E-Mail nicht erwartet haben, können Sie sie ignorieren.
            </p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
            
            <p style="color: #999; font-size: 12px; text-align: center;">
              ImmoFlowMe - Professionelle Hausverwaltung<br/>
              Diese E-Mail wurde automatisch generiert.
            </p>
          </div>
        `,
        text: `Sehr geehrte(r) ${tenantName},

Sie wurden zum ImmoFlowMe Mieterportal eingeladen.

Klicken Sie auf den folgenden Link, um Ihr Passwort festzulegen und sich anzumelden:
${inviteUrl}

Dieser Link ist 7 Tage gültig.

Mit freundlichen Grüßen,
Ihre Hausverwaltung`,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Tenant invite send error:", error);
      res.status(500).json({ error: "Einladung konnte nicht gesendet werden" });
    }
  });
}
