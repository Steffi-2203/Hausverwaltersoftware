import { Express, Request, Response } from "express";
import crypto from "crypto";
// Auth-Pfad: 2FA-Setup/Enrollment läuft auf Sessions OHNE Org-Kontext
// (Magic-Login, staged Enrollment). Wie in server/auth.ts wird deshalb rootDb
// verwendet — alle Zugriffe sind über die Session-userId selbst-beschränkt
// (user_2fa, profiles, auth_tokens sind Auth-Tabellen, keine Mandantendaten).
import { rootDb as db } from "../db";
import { invalidateUserSessions } from "../lib/sessionInvalidation";
import { eq, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { isAuthenticated } from "./helpers";
import {
  generateSecret,
  verifyToken,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
} from "../services/twoFactorService";
import bcrypt from "bcrypt";

async function createAuthToken(userId: string): Promise<string> {
  const authToken = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.execute(sql`
    INSERT INTO auth_tokens (user_id, token, expires_at)
    VALUES (${userId}, ${authToken}, ${expiresAt})
  `);
  return authToken;
}

function is2FASessionValid(req: Request): boolean {
  return !!(req.session as any)?.pending2FAUserId;
}

export function registerTwoFactorRoutes(app: Express) {
  app.get("/api/2fa/status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ error: "Nicht authentifiziert" });

      const result = await db
        .select()
        .from(schema.user2fa)
        .where(eq(schema.user2fa.userId, userId))
        .limit(1);

      const record = result[0];
      res.json({
        isEnabled: record?.isEnabled ?? false,
        hasBackupCodes: (record?.backupCodes?.length ?? 0) > 0,
      });
    } catch (error) {
      console.error("2FA status error:", error);
      res.status(500).json({ error: "Fehler beim Laden des 2FA-Status" });
    }
  });

  app.post("/api/2fa/setup", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ error: "Nicht authentifiziert" });

      const profile = await db
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.id, userId))
        .limit(1);
      if (!profile[0]) return res.status(404).json({ error: "Profil nicht gefunden" });

      const existing = await db
        .select()
        .from(schema.user2fa)
        .where(eq(schema.user2fa.userId, userId))
        .limit(1);

      if (existing[0]?.isEnabled) {
        return res.status(400).json({ error: "2FA ist bereits aktiviert" });
      }

      const { secret, otpauthUrl, qrCodeDataUrl } = await generateSecret(
        userId,
        profile[0].email
      );

      if (existing[0]) {
        await db
          .update(schema.user2fa)
          .set({ secret, isEnabled: false, backupCodes: null })
          .where(eq(schema.user2fa.userId, userId));
      } else {
        await db.insert(schema.user2fa).values({
          userId,
          secret,
          isEnabled: false,
        });
      }

      res.json({ qrCodeDataUrl, secret, otpauthUrl });
    } catch (error) {
      console.error("2FA setup error:", error);
      res.status(500).json({ error: "Fehler beim Einrichten von 2FA" });
    }
  });

  app.post("/api/2fa/verify-setup", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ error: "Nicht authentifiziert" });

      const { token } = req.body;
      if (!token) return res.status(400).json({ error: "Code ist erforderlich" });

      const record = await db
        .select()
        .from(schema.user2fa)
        .where(eq(schema.user2fa.userId, userId))
        .limit(1);

      if (!record[0]) return res.status(404).json({ error: "2FA wurde noch nicht eingerichtet" });
      if (record[0].isEnabled) return res.status(400).json({ error: "2FA ist bereits aktiviert" });

      const isValid = verifyToken(record[0].secret, token);
      if (!isValid) return res.status(400).json({ error: "Ungültiger Code. Bitte versuchen Sie es erneut." });

      const backupCodes = generateBackupCodes();
      const hashedCodes = backupCodes.map(hashBackupCode);

      await db
        .update(schema.user2fa)
        .set({
          isEnabled: true,
          backupCodes: hashedCodes,
          lastUsed: new Date(),
        })
        .where(eq(schema.user2fa.userId, userId));

      res.json({ success: true, backupCodes });
    } catch (error) {
      console.error("2FA verify-setup error:", error);
      res.status(500).json({ error: "Fehler beim Verifizieren des 2FA-Codes" });
    }
  });

  app.post("/api/2fa/verify", async (req: Request, res: Response) => {
    try {
      const pendingUserId = (req.session as any).pending2FAUserId;
      if (!pendingUserId) {
        return res.status(401).json({ error: "Keine ausstehende 2FA-Verifizierung" });
      }

      const { token } = req.body;
      if (!token) return res.status(400).json({ error: "Code ist erforderlich" });

      const record = await db
        .select()
        .from(schema.user2fa)
        .where(eq(schema.user2fa.userId, pendingUserId))
        .limit(1);

      if (!record[0]?.isEnabled) {
        return res.status(400).json({ error: "2FA ist nicht aktiviert" });
      }

      const isValid = verifyToken(record[0].secret, token);
      if (!isValid) {
        return res.status(400).json({ error: "Ungültiger Code. Bitte versuchen Sie es erneut." });
      }

      await db
        .update(schema.user2fa)
        .set({ lastUsed: new Date() })
        .where(eq(schema.user2fa.userId, pendingUserId));

      const profile = await db
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.id, pendingUserId))
        .limit(1);

      const roles = await db
        .select()
        .from(schema.userRoles)
        .where(eq(schema.userRoles.userId, pendingUserId));

      req.session.userId = pendingUserId;
      req.session.email = profile[0]?.email || "";
      (req.session as any).organizationId = profile[0]?.organizationId ?? undefined;
      (req.session as any).twoFactorVerified = true; // SECURITY PUNKT 5
      delete (req.session as any).pending2FAUserId;

      const authToken = await createAuthToken(pendingUserId);

      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
        }
        res.json({
          id: profile[0]?.id,
          email: profile[0]?.email,
          fullName: profile[0]?.fullName,
          organizationId: profile[0]?.organizationId,
          roles: roles.map((r) => r.role),
          token: authToken,
        });
      });
    } catch (error) {
      console.error("2FA verify error:", error);
      res.status(500).json({ error: "Fehler bei der 2FA-Verifizierung" });
    }
  });

  app.post("/api/2fa/backup-verify", async (req: Request, res: Response) => {
    try {
      const pendingUserId = (req.session as any).pending2FAUserId;
      if (!pendingUserId) {
        return res.status(401).json({ error: "Keine ausstehende 2FA-Verifizierung" });
      }

      const { code } = req.body;
      if (!code) return res.status(400).json({ error: "Backup-Code ist erforderlich" });

      const record = await db
        .select()
        .from(schema.user2fa)
        .where(eq(schema.user2fa.userId, pendingUserId))
        .limit(1);

      if (!record[0]?.isEnabled || !record[0].backupCodes) {
        return res.status(400).json({ error: "Keine Backup-Codes verfügbar" });
      }

      const { valid, remainingCodes } = verifyBackupCode(record[0].backupCodes, code);
      if (!valid) {
        return res.status(400).json({ error: "Ungültiger Backup-Code" });
      }

      await db
        .update(schema.user2fa)
        .set({ backupCodes: remainingCodes, lastUsed: new Date() })
        .where(eq(schema.user2fa.userId, pendingUserId));

      const profile = await db
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.id, pendingUserId))
        .limit(1);

      const roles = await db
        .select()
        .from(schema.userRoles)
        .where(eq(schema.userRoles.userId, pendingUserId));

      req.session.userId = pendingUserId;
      req.session.email = profile[0]?.email || "";
      (req.session as any).organizationId = profile[0]?.organizationId ?? undefined;
      (req.session as any).twoFactorVerified = true; // SECURITY PUNKT 5
      delete (req.session as any).pending2FAUserId;

      const authToken = await createAuthToken(pendingUserId);

      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
        }
        res.json({
          id: profile[0]?.id,
          email: profile[0]?.email,
          fullName: profile[0]?.fullName,
          organizationId: profile[0]?.organizationId,
          roles: roles.map((r) => r.role),
          token: authToken,
          backupCodesRemaining: remainingCodes.length,
        });
      });
    } catch (error) {
      console.error("2FA backup-verify error:", error);
      res.status(500).json({ error: "Fehler bei der Backup-Code-Verifizierung" });
    }
  });

  // ─── Staged 2FA Enrollment flow ─────────────────────────────────────────────
  // When a privileged user (admin / property_manager) logs in without 2FA, the
  // login endpoint returns 403 + code "2FA_SETUP_REQUIRED" AND stores
  // pending2FASetupUserId in the session.  These two endpoints let the user
  // enroll 2FA and then receive a full auth session – without ever granting
  // access to any protected route before enrollment is complete.

  /** Step 1 – generate TOTP secret for enrollment (no full session required) */
  app.post("/api/2fa/enrollment-setup", async (req: Request, res: Response) => {
    try {
      const enrollUserId = (req.session as any).pending2FASetupUserId as string | undefined;
      if (!enrollUserId) {
        return res.status(403).json({ error: "Kein ausstehender Enrollment-Vorgang" });
      }

      const profile = await db
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.id, enrollUserId))
        .limit(1);
      if (!profile[0]) return res.status(404).json({ error: "Profil nicht gefunden" });

      const existing = await db
        .select()
        .from(schema.user2fa)
        .where(eq(schema.user2fa.userId, enrollUserId))
        .limit(1);

      if (existing[0]?.isEnabled) {
        // Already enrolled – shouldn't happen during enrollment flow, but handle it gracefully.
        return res.status(400).json({ error: "2FA ist bereits aktiviert" });
      }

      const { secret, otpauthUrl, qrCodeDataUrl } = await generateSecret(
        enrollUserId,
        profile[0].email,
      );

      if (existing[0]) {
        await db
          .update(schema.user2fa)
          .set({ secret, isEnabled: false, backupCodes: null })
          .where(eq(schema.user2fa.userId, enrollUserId));
      } else {
        await db.insert(schema.user2fa).values({ userId: enrollUserId, secret, isEnabled: false });
      }

      res.json({ qrCodeDataUrl, secret, otpauthUrl });
    } catch (error) {
      console.error("2FA enrollment-setup error:", error);
      res.status(500).json({ error: "Fehler beim Einrichten der 2FA" });
    }
  });

  /** Step 2 – verify the first TOTP code, complete enrollment, return full session */
  app.post("/api/2fa/enrollment-verify", async (req: Request, res: Response) => {
    try {
      const enrollUserId = (req.session as any).pending2FASetupUserId as string | undefined;
      if (!enrollUserId) {
        return res.status(403).json({ error: "Kein ausstehender Enrollment-Vorgang" });
      }

      const { token } = req.body;
      if (!token) return res.status(400).json({ error: "Code ist erforderlich" });

      const record = await db
        .select()
        .from(schema.user2fa)
        .where(eq(schema.user2fa.userId, enrollUserId))
        .limit(1);

      if (!record[0]) return res.status(404).json({ error: "2FA wurde noch nicht eingerichtet" });
      if (record[0].isEnabled) return res.status(400).json({ error: "2FA ist bereits aktiviert" });

      const isValid = verifyToken(record[0].secret, token);
      if (!isValid) {
        return res.status(400).json({ error: "Ungültiger Code. Bitte versuchen Sie es erneut." });
      }

      const backupCodes = generateBackupCodes();
      const hashedCodes = backupCodes.map(hashBackupCode);

      await db
        .update(schema.user2fa)
        .set({ isEnabled: true, backupCodes: hashedCodes, lastUsed: new Date() })
        .where(eq(schema.user2fa.userId, enrollUserId));

      const profile = await db
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.id, enrollUserId))
        .limit(1);

      const roles = await db
        .select()
        .from(schema.userRoles)
        .where(eq(schema.userRoles.userId, enrollUserId));

      // Upgrade to full authenticated session.
      req.session.userId = enrollUserId;
      req.session.email = profile[0]?.email || "";
      (req.session as any).organizationId = profile[0]?.organizationId ?? undefined;
      (req.session as any).twoFactorVerified = true;
      delete (req.session as any).pending2FASetupUserId;

      const authToken = await createAuthToken(enrollUserId);

      req.session.save((err) => {
        if (err) console.error("Session save error:", err);
        res.json({
          id: profile[0]?.id,
          email: profile[0]?.email,
          fullName: profile[0]?.fullName,
          organizationId: profile[0]?.organizationId,
          roles: roles.map((r) => r.role),
          token: authToken,
          backupCodes, // show once – user must save these
        });
      });
    } catch (error) {
      console.error("2FA enrollment-verify error:", error);
      res.status(500).json({ error: "Fehler bei der Enrollment-Verifizierung" });
    }
  });
  // ─────────────────────────────────────────────────────────────────────────────

  app.post("/api/2fa/disable", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ error: "Nicht authentifiziert" });

      const { password, token } = req.body;
      if (!password) return res.status(400).json({ error: "Passwort ist erforderlich" });
      if (!token) return res.status(400).json({ error: "2FA-Code ist erforderlich" });

      const profile = await db
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.id, userId))
        .limit(1);

      if (!profile[0]?.passwordHash) {
        return res.status(400).json({ error: "Passwort nicht gefunden" });
      }

      const isPasswordValid = await bcrypt.compare(password, profile[0].passwordHash);
      if (!isPasswordValid) {
        return res.status(400).json({ error: "Ungültiges Passwort" });
      }

      const record = await db
        .select()
        .from(schema.user2fa)
        .where(eq(schema.user2fa.userId, userId))
        .limit(1);

      if (!record[0]?.isEnabled) {
        return res.status(400).json({ error: "2FA ist nicht aktiviert" });
      }

      const isValid = verifyToken(record[0].secret, token);
      if (!isValid) {
        return res.status(400).json({ error: "Ungültiger 2FA-Code" });
      }

      // Fail-closed-Reihenfolge: ZUERST alle fremden Sitzungen und sämtliche
      // Bearer-Tokens invalidieren (sonst wirkt der 60s-2FA-Konformitäts-Cache
      // in anderen Sessions weiter). Schlägt das fehl, bleibt 2FA aktiviert.
      await invalidateUserSessions(userId);

      await db
        .update(schema.user2fa)
        .set({ isEnabled: false, secret: "", backupCodes: null })
        .where(eq(schema.user2fa.userId, userId));

      // Auch die auslösende Sitzung beenden — der Nutzer meldet sich überall neu an.
      await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
      res.clearCookie("connect.sid");

      res.json({ success: true, loggedOut: true });
    } catch (error) {
      console.error("2FA disable error:", error);
      res.status(500).json({ error: "Fehler beim Deaktivieren von 2FA" });
    }
  });
}
