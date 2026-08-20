import { Express, Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import zxcvbn from "zxcvbn";
// Auth-Operationen verwenden rootDb (Superuser), weil sie vor dem Org-Kontext
// laufen: Beim Login ist die Organisation noch nicht bekannt, der Eintrag in
// profiles wird per E-Mail gesucht, bevor die Session gesetzt werden kann.
// Dieser rootDb-Import ist der einzige absichtliche RLS-Bypass im Request-Pfad.
import { rootDb as db } from "./db";
import * as schema from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { sendEmail } from "./lib/resend";
import { createAuditLog, getClientInfo } from "./lib/auditLog";
import { logger } from "./lib/logger";
import {
  type AuthBruteForceProtection,
  authBruteForce,
} from "./middleware/authBruteForce";
import { invalidateUserSessions } from "./lib/sessionInvalidation";

/** Wird geworfen wenn ein DB-Fehler während des Token-Lookups auftritt.
 *  Ermöglicht es dem Aufrufer, zwischen "Token unbekannt" (401) und
 *  "DB temporär nicht erreichbar" (503) zu unterscheiden. */
export class TokenLookupDbError extends Error {
  constructor(cause: unknown) {
    super("DB-Fehler beim Token-Lookup");
    this.name = "TokenLookupDbError";
    this.cause = cause;
  }
}

const SALT_ROUNDS = 12;
// Kein Hardcoding von PII: Admin-E-Mail kommt aus der Umgebung (öffentliches Backup-Repo!)
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const PASSWORD_RESET_EXPIRY_HOURS = 24;
const MIN_PASSWORD_LENGTH = 12;
const ZXCVBN_MIN_SCORE = 3;
const PASSWORD_HISTORY_COUNT = 5;
const LOCKOUT_DURATION_MINUTES = 15;

async function validatePasswordStrength(password: string): Promise<string | null> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein`;
  }

  const result = zxcvbn(password);
  if (result.score < ZXCVBN_MIN_SCORE) {
    const feedback = result.feedback.warning || result.feedback.suggestions?.[0] || "";
    return `Passwort ist zu schwach (Stärke ${result.score}/4, mindestens ${ZXCVBN_MIN_SCORE} erforderlich). ${feedback}`;
  }

  const isLeaked = await checkLeakedPassword(password);
  if (isLeaked) {
    return "Dieses Passwort wurde in einem Datenleck gefunden. Bitte wählen Sie ein anderes Passwort.";
  }

  return null;
}

async function checkLeakedPassword(password: string): Promise<boolean> {
  try {
    const sha1Hash = crypto.createHash("sha1").update(password).digest("hex").toUpperCase();
    const prefix = sha1Hash.substring(0, 5);
    const suffix = sha1Hash.substring(5);

    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "User-Agent": "ImmoFlowMe-PasswordCheck" },
    });

    if (!response.ok) {
      console.warn("HIBP API unavailable, skipping leak check");
      return false;
    }

    const text = await response.text();
    const lines = text.split("\n");
    for (const line of lines) {
      const [hashSuffix] = line.split(":");
      if (hashSuffix.trim() === suffix) {
        return true;
      }
    }
    return false;
  } catch (error) {
    console.warn("HIBP check failed, skipping:", error);
    return false;
  }
}

async function checkPasswordHistory(userId: string, newPassword: string): Promise<boolean> {
  const history = await db.select()
    .from(schema.passwordHistory)
    .where(eq(schema.passwordHistory.userId, userId))
    .orderBy(desc(schema.passwordHistory.createdAt))
    .limit(PASSWORD_HISTORY_COUNT);

  for (const entry of history) {
    const isReused = await bcrypt.compare(newPassword, entry.passwordHash);
    if (isReused) return true;
  }
  return false;
}

async function savePasswordToHistory(userId: string, passwordHash: string): Promise<void> {
  await db.insert(schema.passwordHistory).values({
    userId,
    passwordHash,
  });

  const allHistory = await db.select({ id: schema.passwordHistory.id })
    .from(schema.passwordHistory)
    .where(eq(schema.passwordHistory.userId, userId))
    .orderBy(desc(schema.passwordHistory.createdAt));

  if (allHistory.length > PASSWORD_HISTORY_COUNT) {
    const idsToDelete = allHistory.slice(PASSWORD_HISTORY_COUNT).map(h => h.id);
    for (const id of idsToDelete) {
      await db.delete(schema.passwordHistory).where(eq(schema.passwordHistory.id, id));
    }
  }
}

async function recordLoginAttempt(email: string, ipAddress: string | null, success: boolean): Promise<void> {
  await db.insert(schema.loginAttempts).values({
    email: email.toLowerCase(),
    ipAddress,
    success,
  });

  if (success) {
    await db.delete(schema.loginAttempts).where(and(
      eq(schema.loginAttempts.email, email.toLowerCase()),
      eq(schema.loginAttempts.success, false)
    ));
  }
}

async function logAuthEvent(req: Request, action: string, email: string, userId: string | null, success: boolean, details?: Record<string, any>) {
  const { ipAddress, userAgent } = getClientInfo(req);
  await createAuditLog({
    userId: userId || undefined,
    tableName: 'auth',
    recordId: userId || email,
    action: action as any,
    newData: { email, success, ...details },
    ipAddress,
    userAgent,
  });
}

declare module "express-session" {
  interface SessionData {
    userId: string;
    email: string;
    pending2FAUserId?: string;
  }
}

async function resolveTokenAuth(req: Request): Promise<boolean> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  if (!token) return false;
  try {
    const result = await db.execute(sql`
      SELECT user_id FROM auth_tokens 
      WHERE token = ${token} AND expires_at > NOW()
      LIMIT 1
    `);
    const rows = result.rows as any[];
    if (rows.length > 0) {
      const profile = await getProfileById(rows[0].user_id);
      if (!profile) {
        // Token gültig, aber Profil fehlt (FK-Cascade-Lücke oder Race Condition).
        // Fail-closed: kein Zugang ohne vollständiges Profil.
        return false;
      }
      req.session.userId = rows[0].user_id;
      req.session.email = profile.email;
      (req.session as any).organizationId = profile.organizationId ?? undefined;
      return true;
    }
  } catch (e) {
    logger.error("DB-Fehler beim Token-Lookup", {
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    });
    throw new TokenLookupDbError(e);
  }
  return false;
}

// ─── SECURITY: Durchgehende 2FA-Erzwingung für privilegierte Rollen ──────────
// Der Login-Endpunkt erzwingt 2FA bereits beim Passwort-Login (staged
// Enrollment). Diese Middleware schließt die verbleibenden Wege in eine
// Session OHNE 2FA: Bearer-Token, Magic-Login, Registrierung sowie Rollen,
// die erst nach dem Login vergeben wurden.
export const PRIVILEGED_2FA_ROLES = new Set(["admin", "property_manager"]);

// Pfade, die auch ohne abgeschlossene 2FA-Einrichtung erreichbar sein müssen:
// - /api/2fa/*   → Setup/Enrollment selbst
// - /api/auth/*  → Logout, /api/auth/user (Frontend braucht Rollen/Identität)
const TWO_FA_EXEMPT_PREFIXES = ["/api/2fa/", "/api/auth/"];

// Konformitäts-Cache: kurze TTL, damit Rollenvergabe nach Login oder
// 2FA-Deaktivierung in einer anderen Session zeitnah wirksam wird.
const TWO_FA_CACHE_TTL_MS = 60_000;

/** true = Nutzer ist konform (keine privilegierte Rolle ODER 2FA aktiv). */
export async function isPrivileged2FACompliant(userId: string): Promise<boolean> {
  const roles = await getUserRoles(userId);
  if (!roles.some((r) => PRIVILEGED_2FA_ROLES.has(r.role))) return true;
  const rec = await db
    .select({ id: schema.user2fa.id })
    .from(schema.user2fa)
    .where(and(eq(schema.user2fa.userId, userId), eq(schema.user2fa.isEnabled, true)))
    .limit(1);
  return !!rec[0];
}

/**
 * Factory für enforcePrivileged2FA — ermöglicht Dependency Injection des
 * Token-Resolvers in Tests, ohne globalen Zustand zu mutieren.
 * Produktionscode verwendet enforcePrivileged2FA (Default-Export unterhalb).
 */
export function createEnforcePrivileged2FA(
  tokenResolver: (req: Request) => Promise<boolean> = resolveTokenAuth,
): (req: Request, res: Response, next: NextFunction) => void {
  return function enforcePrivileged2FA(req, res, next) {
    (async () => {
        const path = req.path;
        // Der organisationsübergreifende IBAN-Scan liegt bewusst außerhalb von
        // /api, weil dieses Präfix im Artifact-Router dem separaten API-Service
        // gehört. Er bleibt dennoch wie jede privilegierte API-Route 2FA-pflichtig.
        const isProtectedAdminDiagnostic = path === "/admin/security/plaintext-iban-scan";
        if (!path.startsWith("/api/") && !isProtectedAdminDiagnostic) return next();
      if (TWO_FA_EXEMPT_PREFIXES.some((p) => path.startsWith(p))) return next();

      // Task #195: Abgelaufener/gefälschter Bearer-Token darf privilegierte Routen
      // nicht über eine vorhandene Session-Cookie umgehen.
      if ((req as any)._bearerTokenRejected) {
        return res.status(401).json({ message: "Unauthorized", code: "TOKEN_INVALID_OR_EXPIRED" });
      }

      const s = req.session as any;
      if (!s?.userId) {
        // Bearer-Token-Clients (Mobile) hier auflösen, damit auch sie geprüft
        // werden — sonst wäre der Token-Pfad ein 2FA-Bypass.
        const ok = await tokenResolver(req);
        if (!ok) return next(); // unauthentifiziert → Route-Guards liefern 401
      }

      // Session-Cache mit kurzer TTL: begrenzt DB-Last, ohne Rollen-/2FA-Änderungen
      // dauerhaft zu ignorieren (nachträgliche Admin-Rolle oder 2FA-Deaktivierung
      // in einer anderen Session greift spätestens nach Ablauf der TTL).
      // Bei /api/2fa/disable wird der Cache zusätzlich sofort gelöscht.
      if (
        s.twoFactorEnforcedFor === s.userId &&
        typeof s.twoFactorEnforcedAt === "number" &&
        Date.now() - s.twoFactorEnforcedAt < TWO_FA_CACHE_TTL_MS
      ) {
        return next();
      }

      const compliant = await isPrivileged2FACompliant(s.userId);
      if (!compliant) {
        delete s.twoFactorEnforcedFor;
        delete s.twoFactorEnforcedAt;
        return res.status(403).json({
          error: "Zwei-Faktor-Authentifizierung muss eingerichtet werden",
          code: "2FA_SETUP_REQUIRED",
          redirectTo: "/2fa-einrichten",
        });
      }
      s.twoFactorEnforcedFor = s.userId;
      s.twoFactorEnforcedAt = Date.now();
      return next();
    })().catch((err: unknown) => {
      // DB-Fehler beim Token-Lookup → 503 retryable (konsistent mit isAuthenticated).
      // Unerwartete Fehler → zentraler Error-Handler (fail-closed, kein Durchlass).
      if (err instanceof TokenLookupDbError) {
        return res.status(503).json({
          message: "Dienst vorübergehend nicht verfügbar — bitte kurz warten und erneut versuchen",
          retryable: true,
          code: "TOKEN_DB_ERROR",
        });
      }
      return next(err);
    });
  };
}

/** Produktions-Middleware (verwendet echten Token-Resolver). */
export const enforcePrivileged2FA = createEnforcePrivileged2FA();

export function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  // Task #195: Abgelaufene/gefälschte Bearer-Tokens dürfen NICHT "still" durch
  // eine vorhandene Session-Cookie akzeptiert werden. Das Flag wird von
  // bearerSessionHydration gesetzt, wenn der Bearer-Token vorhanden aber ungültig ist.
  if ((req as any)._bearerTokenRejected) {
    return res.status(401).json({ message: "Unauthorized", code: "TOKEN_INVALID_OR_EXPIRED" });
  }
  if (req.session?.userId) {
    return next();
  }
  resolveTokenAuth(req).then(ok => {
    if (ok) return next();
    return res.status(401).json({ message: "Unauthorized" });
  }).catch((err: unknown) => {
    if (err instanceof TokenLookupDbError) {
      return res.status(503).json({
        message: "Dienst vorübergehend nicht verfügbar — bitte kurz warten und erneut versuchen",
        retryable: true,
        code: "TOKEN_DB_ERROR",
      });
    }
    return res.status(401).json({ message: "Unauthorized" });
  });
}

async function getProfileByEmail(email: string) {
  const result = await db.select().from(schema.profiles)
    .where(eq(schema.profiles.email, email.toLowerCase())).limit(1);
  return result[0];
}

async function getProfileById(id: string) {
  const result = await db.select().from(schema.profiles)
    .where(eq(schema.profiles.id, id)).limit(1);
  return result[0];
}

async function getUserRoles(userId: string) {
  return db.select().from(schema.userRoles)
    .where(eq(schema.userRoles.userId, userId));
}

async function getPendingInviteByEmail(email: string) {
  const result = await db.select().from(schema.organizationInvites)
    .where(and(
      eq(schema.organizationInvites.email, email.toLowerCase()),
      eq(schema.organizationInvites.status, 'pending')
    )).limit(1);
  return result[0];
}

export function setupAuth(
  app: Express,
  bruteForceProtection: AuthBruteForceProtection = authBruteForce,
) {
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password, fullName, token } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ error: "E-Mail und Passwort sind erforderlich" });
      }

      const passwordError = await validatePasswordStrength(password);
      if (passwordError) {
        await logAuthEvent(req, 'register_failed', email, null, false, { reason: 'weak_password' });
        return res.status(400).json({ error: passwordError });
      }

      const emailLower = email.toLowerCase();
      
      const existingProfile = await getProfileByEmail(emailLower);
      if (existingProfile?.passwordHash) {
        return res.status(400).json({ error: "Ein Konto mit dieser E-Mail existiert bereits" });
      }

      const isAdmin = !!ADMIN_EMAIL && emailLower === ADMIN_EMAIL.toLowerCase();
      let invite = null;
      
      if (!isAdmin) {
        if (token) {
          const result = await db.select().from(schema.organizationInvites)
            .where(and(
              eq(schema.organizationInvites.token, token),
              eq(schema.organizationInvites.status, 'pending')
            )).limit(1);
          invite = result[0];
          
          if (!invite) {
            return res.status(400).json({ error: "Ungültiger oder abgelaufener Einladungstoken" });
          }
          
          if (invite.email.toLowerCase() !== emailLower) {
            return res.status(400).json({ error: "Diese Einladung ist für eine andere E-Mail-Adresse" });
          }
          
          if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
            return res.status(400).json({ error: "Diese Einladung ist abgelaufen" });
          }
        } else {
          const pendingInvite = await getPendingInviteByEmail(emailLower);
          if (!pendingInvite) {
            return res.status(403).json({ 
              error: "Zugriff verweigert. Nur eingeladene Benutzer können sich registrieren.",
              code: "NOT_AUTHORIZED"
            });
          }
          invite = pendingInvite;
        }
      }

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      
      let profile = existingProfile;
      
      if (profile) {
        const updated = await db.update(schema.profiles)
          .set({ passwordHash, fullName: fullName || profile.fullName, updatedAt: new Date() })
          .where(eq(schema.profiles.id, profile.id))
          .returning();
        profile = updated[0];
      } else {
        const created = await db.insert(schema.profiles).values({
          email: emailLower,
          passwordHash,
          fullName: fullName || emailLower,
        }).returning();
        profile = created[0];
      }

      await savePasswordToHistory(profile.id, passwordHash);

      if (isAdmin) {
        let adminOrg = await db.select().from(schema.organizations)
          .where(eq(schema.organizations.name, "ImmoFlowMe Admin")).limit(1);
        
        if (!adminOrg[0]) {
          const newOrg = await db.insert(schema.organizations).values({
            name: "ImmoFlowMe Admin",
            subscriptionStatus: 'active',
            subscriptionTier: 'enterprise',
          }).returning();
          adminOrg = newOrg;
          // Standard-Verteilerschlüssel sind org-gebunden — für neue Orgs sofort anlegen
          const { seedDistributionKeysForOrg } = await import("./seedDistributionKeys");
          await seedDistributionKeysForOrg(adminOrg[0].id);
        }
        
        await db.update(schema.profiles)
          .set({ organizationId: adminOrg[0].id })
          .where(eq(schema.profiles.id, profile.id));
        
        const existingRole = await db.select().from(schema.userRoles)
          .where(eq(schema.userRoles.userId, profile.id)).limit(1);
        
        if (!existingRole[0]) {
          await db.insert(schema.userRoles).values({
            userId: profile.id,
            role: 'admin',
          });
        }

        const existingMembership = await db.select().from(schema.userOrganizations)
          .where(and(eq(schema.userOrganizations.userId, profile.id), eq(schema.userOrganizations.organizationId, adminOrg[0].id))).limit(1);
        if (!existingMembership[0]) {
          await db.insert(schema.userOrganizations).values({
            userId: profile.id,
            organizationId: adminOrg[0].id,
            role: 'admin',
            isDefault: true,
          });
        }
      } else if (invite) {
        await db.update(schema.profiles)
          .set({ organizationId: invite.organizationId })
          .where(eq(schema.profiles.id, profile.id));
        
        const existingRole = await db.select().from(schema.userRoles)
          .where(eq(schema.userRoles.userId, profile.id)).limit(1);
        
        if (!existingRole[0]) {
          await db.insert(schema.userRoles).values({
            userId: profile.id,
            role: invite.role,
          });
        }

        const existingMembership = await db.select().from(schema.userOrganizations)
          .where(and(eq(schema.userOrganizations.userId, profile.id), eq(schema.userOrganizations.organizationId, invite.organizationId))).limit(1);
        if (!existingMembership[0]) {
          await db.insert(schema.userOrganizations).values({
            userId: profile.id,
            organizationId: invite.organizationId,
            role: invite.role,
            isDefault: true,
          });
        }
        
        await db.update(schema.organizationInvites)
          .set({ status: 'accepted', acceptedAt: new Date() })
          .where(eq(schema.organizationInvites.id, invite.id));
      }

      const roles = await getUserRoles(profile.id);

      await logAuthEvent(req, 'register', emailLower, profile.id, true);

      // SECURITY PUNKT 5 (wie beim Login): Privilegierte Konten (Admin,
      // Verwalter) erhalten bei der Registrierung KEINE Vollsession und
      // KEIN Bearer-Token, sondern werden in den staged-Enrollment-Fluss
      // geleitet (nur /api/2fa/enrollment-* erreichbar).
      const PRIVILEGED_ROLES = new Set(['admin', 'property_manager']);
      if (roles.some((r: any) => PRIVILEGED_ROLES.has(r.role))) {
        (req.session as any).pending2FASetupUserId = profile.id;
        delete req.session.userId;
        delete req.session.email;
        delete (req.session as any).organizationId;
        req.session.save((err) => {
          if (err) console.error("Session save error:", err);
          res.status(403).json({
            error: "Zwei-Faktor-Authentifizierung muss eingerichtet werden",
            code: "2FA_SETUP_REQUIRED",
            message: "Bitte richten Sie die 2FA über den QR-Code ein, bevor Sie fortfahren.",
          });
        });
        return;
      }

      req.session.userId = profile.id;
      req.session.email = profile.email;
      (req.session as any).organizationId = profile.organizationId ?? undefined;

      const authToken = crypto.randomBytes(48).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await db.execute(sql`
        INSERT INTO auth_tokens (user_id, token, expires_at)
        VALUES (${profile.id}, ${authToken}, ${expiresAt})
      `);

      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
        }
        
        res.json({
          id: profile.id,
          email: profile.email,
          fullName: profile.fullName,
          organizationId: profile.organizationId,
          roles: roles.map(r => r.role),
          token: authToken,
        });
      });
    } catch (error) {
      console.error("Register error:", error);
      res.status(500).json({ error: "Registrierung fehlgeschlagen" });
    }
  });

  // Lightweight token validation endpoint for mobile clients.
  // Returns 200 { valid: true } when the Bearer token is valid.
  // isAuthenticated returns 401 automatically when the token is expired or forged.
  app.get("/api/auth/validate", isAuthenticated, (_req: Request, res: Response) => {
    res.status(200).json({ valid: true });
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      const { ipAddress } = getClientInfo(req);
      
      console.log(`[AUTH] Login attempt for: ${email ? email.substring(0, 3) + '***' : 'EMPTY'}, password length: ${password ? password.length : 0}, IP: ${ipAddress}`);
      
      if (!email || !password) {
        console.log('[AUTH] Login rejected: missing email or password');
        return res.status(400).json({ error: "E-Mail und Passwort sind erforderlich" });
      }

      if (await bruteForceProtection.isLoginBlocked(email)) {
        await logAuthEvent(req, 'login_failed', email.toLowerCase(), null, false, { reason: 'account_locked' });
        return res.status(429).json({ 
          error: `Konto vorübergehend gesperrt. Bitte versuchen Sie es in ${LOCKOUT_DURATION_MINUTES} Minute(n) erneut.`,
          lockedUntilMinutes: LOCKOUT_DURATION_MINUTES,
        });
      }

      const profile = await getProfileByEmail(email.toLowerCase());
      
      if (!profile || !profile.passwordHash) {
        console.log(`[AUTH] Login failed: profile not found or no password for ${email.toLowerCase()}`);
        await bruteForceProtection.recordLoginFailure(email);
        await recordLoginAttempt(email, ipAddress, false);
        await logAuthEvent(req, 'login_failed', email.toLowerCase(), null, false, { reason: 'unknown_email' });
        return res.status(401).json({ error: "Ungültige E-Mail oder Passwort" });
      }

      const isValid = await bcrypt.compare(password, profile.passwordHash);
      
      if (!isValid) {
        console.log(`[AUTH] Login failed: wrong password for ${email.toLowerCase()}, hash prefix: ${profile.passwordHash.substring(0, 7)}`);
        await bruteForceProtection.recordLoginFailure(email);
        await recordLoginAttempt(email, ipAddress, false);
        await logAuthEvent(req, 'login_failed', email.toLowerCase(), profile.id, false, { reason: 'wrong_password' });

        if (await bruteForceProtection.isLoginBlocked(email)) {
          return res.status(429).json({
            error: `Konto vorübergehend gesperrt. Bitte versuchen Sie es in ${LOCKOUT_DURATION_MINUTES} Minute(n) erneut.`,
            lockedUntilMinutes: LOCKOUT_DURATION_MINUTES,
          });
        }
        const remainingAttempts = await bruteForceProtection.remainingLoginAttempts(email);

        return res.status(401).json({ 
          error: "Ungültige E-Mail oder Passwort",
          ...(remainingAttempts <= 2 && remainingAttempts > 0 ? { remainingAttempts } : {}),
        });
      }

      if (!await bruteForceProtection.completeLoginSuccess(email)) {
        await logAuthEvent(req, 'login_failed', email.toLowerCase(), profile.id, false, { reason: 'account_locked' });
        return res.status(429).json({
          error: `Konto vorübergehend gesperrt. Bitte versuchen Sie es in ${LOCKOUT_DURATION_MINUTES} Minute(n) erneut.`,
          lockedUntilMinutes: LOCKOUT_DURATION_MINUTES,
        });
      }
      await recordLoginAttempt(email, ipAddress, true);

      const twoFaRecord = await db.select().from(schema.user2fa)
        .where(and(eq(schema.user2fa.userId, profile.id), eq(schema.user2fa.isEnabled, true)))
        .limit(1);

      if (twoFaRecord[0]) {
        (req.session as any).pending2FAUserId = profile.id;
        delete req.session.userId;
        delete req.session.email;

        req.session.save((err) => {
          if (err) {
            console.error("Session save error:", err);
            return res.status(500).json({ error: "Session konnte nicht gespeichert werden" });
          }
          res.json({ requires2FA: true });
        });
        return;
      }

      // SECURITY PUNKT 5: Admins und Verwalter MÜSSEN 2FA aktiviert haben.
      // Ohne 2FA-Konfiguration → staged Enrollment-Session (kein Vollzugang, nur /api/2fa/enrollment-*).
      const userRoles = await getUserRoles(profile.id);
      const PRIVILEGED_ROLES = new Set(['admin', 'property_manager']);
      if (userRoles.some((r: any) => PRIVILEGED_ROLES.has(r.role)) && !twoFaRecord[0]) {
        (req.session as any).pending2FASetupUserId = profile.id;
        delete req.session.userId;
        delete req.session.email;
        req.session.save((err) => {
          if (err) console.error("Session save error:", err);
          res.status(403).json({
            error: "Zwei-Faktor-Authentifizierung muss eingerichtet werden",
            code: "2FA_SETUP_REQUIRED",
            message: "Bitte richten Sie die 2FA über den QR-Code ein, bevor Sie fortfahren.",
          });
        });
        return;
      }

      req.session.userId = profile.id;
      req.session.email = profile.email;
      (req.session as any).organizationId = profile.organizationId ?? undefined;

      const roles = userRoles;
      
      await logAuthEvent(req, 'login', profile.email, profile.id, true);

      const authToken = crypto.randomBytes(48).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await db.execute(sql`
        INSERT INTO auth_tokens (user_id, token, expires_at)
        VALUES (${profile.id}, ${authToken}, ${expiresAt})
      `);

      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
        }
        
        res.json({
          id: profile.id,
          email: profile.email,
          fullName: profile.fullName,
          organizationId: profile.organizationId,
          roles: roles.map(r => r.role),
          token: authToken,
        });
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Anmeldung fehlgeschlagen" });
    }
  });

  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    let userId = req.session?.userId || null;
    const email = req.session?.email || 'unknown';

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        if (!userId) {
          const result = await db.execute(sql`SELECT user_id FROM auth_tokens WHERE token = ${token} LIMIT 1`);
          const rows = result.rows as any[];
          if (rows.length > 0) userId = rows[0].user_id;
        }
        await db.execute(sql`DELETE FROM auth_tokens WHERE token = ${token}`);
      } catch (e) {
        console.error("Token cleanup error:", e);
      }
    }
    if (userId) {
      try {
        await db.execute(sql`DELETE FROM auth_tokens WHERE user_id = ${userId}`);
      } catch (e) {
        console.error("Token cleanup error:", e);
      }
    }
    
    await logAuthEvent(req, 'logout', email, userId, true);
    
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieName = isProduction ? '__Secure-immo_sid' : 'immo_sid';
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Abmeldung fehlgeschlagen" });
      }
      res.clearCookie(cookieName, {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'none' as const,
      });
      res.json({ message: "Erfolgreich abgemeldet" });
    });
  });

  app.get("/api/auth/user", async (req: Request, res: Response) => {
    if (!req.session?.userId) {
      const resolved = await resolveTokenAuth(req);
      if (!resolved) {
        return res.status(401).json({ message: "Unauthorized" });
      }
    }

    try {
      const profile = await getProfileById(req.session.userId);
      
      if (!profile) {
        req.session.destroy(() => {});
        return res.status(401).json({ message: "Unauthorized" });
      }

      const roles = await getUserRoles(profile.id);
      
      res.json({
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        organizationId: profile.organizationId,
        roles: roles.map(r => r.role),
        subscriptionTier: (profile as any).subscriptionTier,
        paymentStatus: (profile as any).paymentStatus,
        paymentFailedAt: (profile as any).paymentFailedAt,
        canceledAt: (profile as any).canceledAt,
      });
    } catch (error) {
      console.error("Get user error:", error);
      res.status(500).json({ error: "Failed to get user" });
    }
  });

  app.post("/api/auth/magic-login-api", async (req: Request, res: Response) => {
    try {
      const { token } = req.body;
      
      if (!token) {
        return res.status(400).json({ error: "Token fehlt" });
      }

      const resetTokenResult = await db.select().from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.token, token)).limit(1);
      
      const resetToken = resetTokenResult[0];
      
      if (!resetToken || resetToken.usedAt || new Date(resetToken.expiresAt) < new Date()) {
        return res.status(400).json({ error: "Token ungueltig oder abgelaufen" });
      }

      await db.update(schema.passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(schema.passwordResetTokens.id, resetToken.id));

      const profile = await getProfileById(resetToken.userId);
      if (!profile) {
        return res.status(400).json({ error: "Benutzer nicht gefunden" });
      }

      const roles = await getUserRoles(profile.id);
      const authToken = crypto.randomBytes(48).toString('hex');
      const tokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await db.execute(sql`
        INSERT INTO auth_tokens (user_id, token, expires_at)
        VALUES (${profile.id}, ${authToken}, ${tokenExpiresAt})
      `);

      req.session.userId = profile.id;
      req.session.email = profile.email;
      (req.session as any).organizationId = profile.organizationId ?? undefined;
      
      res.json({
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        organizationId: profile.organizationId,
        roles: roles.map((r: any) => r.role),
        token: authToken,
      });
    } catch (error) {
      console.error("Magic login API error:", error);
      res.status(500).json({ error: "Server-Fehler" });
    }
  });

  app.get("/api/auth/magic-login", async (req: Request, res: Response) => {
    try {
      const { token } = req.query;
      
      if (!token || typeof token !== 'string') {
        return res.redirect('/login?error=invalid_token');
      }

      const resetTokenResult = await db.select().from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.token, token)).limit(1);
      
      const resetToken = resetTokenResult[0];
      
      if (!resetToken || resetToken.usedAt || new Date(resetToken.expiresAt) < new Date()) {
        return res.redirect('/login?error=expired_token');
      }

      await db.update(schema.passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(schema.passwordResetTokens.id, resetToken.id));

      const profile = await getProfileById(resetToken.userId);
      
      if (!profile) {
        return res.redirect('/login?error=user_not_found');
      }

      const authToken = crypto.randomBytes(48).toString('hex');
      const tokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await db.execute(sql`
        INSERT INTO auth_tokens (user_id, token, expires_at)
        VALUES (${profile.id}, ${authToken}, ${tokenExpiresAt})
      `);

      req.session.userId = profile.id;
      req.session.email = profile.email;
      (req.session as any).organizationId = profile.organizationId ?? undefined;
      req.session.save(() => {
        res.send(`<!DOCTYPE html>
<html><head><title>Anmeldung...</title></head>
<body><script>
localStorage.setItem('auth_token', '${authToken}');
window.location.href = '/dashboard';
</script><p>Anmeldung laeuft... Falls nichts passiert, <a href="/dashboard">hier klicken</a>.</p>
</body></html>`);
      });
    } catch (error) {
      console.error("Magic login error:", error);
      res.redirect('/login?error=server_error');
    }
  });

  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ error: "E-Mail ist erforderlich" });
      }

      const profile = await getProfileByEmail(email.toLowerCase());
      
      if (profile) {
        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_HOURS * 60 * 60 * 1000);
        
        await db.insert(schema.passwordResetTokens).values({
          userId: profile.id,
          token,
          expiresAt,
        });

        const baseUrl = process.env.NODE_ENV === 'production' 
          ? 'https://www.immoflowme.at'
          : process.env.REPLIT_DEV_DOMAIN 
            ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
            : 'http://localhost:5000';
        const resetUrl = `${baseUrl}/reset-password?token=${token}`;
        
        await sendEmail({
          to: profile.email,
          subject: "Passwort zurücksetzen - ImmoFlowMe",
          html: `
            <h2>Passwort zurücksetzen</h2>
            <p>Hallo ${profile.fullName || 'Nutzer'},</p>
            <p>Sie haben eine Anfrage zum Zurücksetzen Ihres Passworts gestellt.</p>
            <p>Klicken Sie auf den folgenden Link, um Ihr Passwort zurückzusetzen:</p>
            <p><a href="${resetUrl}">Passwort zurücksetzen</a></p>
            <p>Dieser Link ist ${PASSWORD_RESET_EXPIRY_HOURS} Stunden gültig.</p>
            <p>Falls Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese E-Mail.</p>
            <p>Mit freundlichen Grüßen,<br>Ihr ImmoFlowMe Team</p>
          `,
        });
      }

      res.json({ message: "Falls ein Konto mit dieser E-Mail existiert, wurde eine E-Mail zum Zurücksetzen des Passworts gesendet." });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ error: "Fehler beim Senden der E-Mail" });
    }
  });

  app.post("/api/auth/reset-password", async (req: Request, res: Response) => {
    try {
      const { token, password } = req.body;
      
      if (!token || !password) {
        return res.status(400).json({ error: "Token und Passwort sind erforderlich" });
      }

      const passwordError = await validatePasswordStrength(password);
      if (passwordError) {
        return res.status(400).json({ error: passwordError });
      }

      const resetTokenResult = await db.select().from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.token, token)).limit(1);
      
      const resetToken = resetTokenResult[0];
      
      if (!resetToken) {
        return res.status(400).json({ error: "Ungültiger Token" });
      }

      if (resetToken.usedAt) {
        return res.status(400).json({ error: "Dieser Token wurde bereits verwendet" });
      }

      if (new Date(resetToken.expiresAt) < new Date()) {
        return res.status(400).json({ error: "Dieser Token ist abgelaufen" });
      }

      const isReused = await checkPasswordHistory(resetToken.userId, password);
      if (isReused) {
        return res.status(400).json({ 
          error: `Dieses Passwort wurde kürzlich verwendet. Bitte wählen Sie ein Passwort, das nicht unter den letzten ${PASSWORD_HISTORY_COUNT} Passwörtern ist.` 
        });
      }

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

      // Passwortänderungen sind sicherheitsrelevant: zuerst alle anderen
      // Geräte und Bearer-Tokens abmelden. Die auslösende Sitzung darf bleiben,
      // falls der Reset aus einer bereits authentifizierten Sitzung erfolgt.
      // Schlägt die Invalidierung fehl, wird das Passwort nicht geändert.
      const keepSessionId =
        req.session?.userId === resetToken.userId ? req.sessionID : undefined;
      await invalidateUserSessions(resetToken.userId, { keepSessionId });

      await db.update(schema.profiles)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(schema.profiles.id, resetToken.userId));

      await savePasswordToHistory(resetToken.userId, passwordHash);

      await db.update(schema.passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(schema.passwordResetTokens.id, resetToken.id));

      res.json({ message: "Passwort wurde erfolgreich zurückgesetzt" });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({ error: "Passwort zurücksetzen fehlgeschlagen" });
    }
  });
}

