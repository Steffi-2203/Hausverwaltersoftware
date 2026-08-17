import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_HEADER_NAME = "x-csrf-token";

const EXEMPT_PATHS = [
  "/api/stripe/webhook",
  "/api/health",
  "/api/ready",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/csrf-token",
  "/api/auth/logout",
  "/api/2fa/verify",
  "/api/2fa/backup-verify",
  "/api/demo/request",
  "/api/demo/validate",
  "/api/demo/activate",
  "/api/invites/",
  "/api/white-label/inquiry",
  "/api/auth/magic-login",
];

function isExempt(path: string): boolean {
  return EXEMPT_PATHS.some(p => path.startsWith(p));
}

function buildAllowedOrigins(): Set<string> {
  const origins = new Set<string>();
  const replitDomain = process.env.REPLIT_DEV_DOMAIN;
  if (replitDomain) {
    origins.add(`https://${replitDomain}`);
  }
  const replitSlug = process.env.REPL_SLUG;
  const replitOwner = process.env.REPL_OWNER;
  if (replitSlug && replitOwner) {
    origins.add(`https://${replitSlug}.${replitOwner}.repl.co`);
  }
  origins.add('https://www.immoflowme.at');
  origins.add('https://immoflowme.at');
  return origins;
}

function isStrictSameOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;

  const host = req.headers.host;
  if (host) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host === host) return true;
    } catch {}
  }

  const allowed = buildAllowedOrigins();
  return allowed.has(origin);
}

export function csrfTokenMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.cookies?.[CSRF_COOKIE_NAME]) {
    const token = crypto.randomBytes(32).toString("hex");
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      secure: true,
      sameSite: "none" as const,
      path: "/",
      maxAge: 24 * 60 * 60 * 1000,
    });
  }
  next();
}

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }

  if (isExempt(req.path)) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return next();
  }

  if (isStrictSameOrigin(req)) {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME] as string;

  if (!cookieToken || !headerToken) {
    console.warn(`[CSRF] Token missing for ${req.method} ${req.path} - origin: ${req.headers.origin}`);
    return res.status(403).json({ error: "CSRF-Token fehlt" });
  }

  try {
    if (!crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) {
      return res.status(403).json({ error: "CSRF-Token ungültig" });
    }
  } catch {
    return res.status(403).json({ error: "CSRF-Token ungültig" });
  }

  next();
}

export function getCsrfToken(req: Request, res: Response) {
  const token = req.cookies?.[CSRF_COOKIE_NAME] || crypto.randomBytes(32).toString("hex");
  if (!req.cookies?.[CSRF_COOKIE_NAME]) {
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      secure: true,
      sameSite: "none" as const,
      path: "/",
      maxAge: 24 * 60 * 60 * 1000,
    });
  }
  res.json({ csrfToken: token });
}
