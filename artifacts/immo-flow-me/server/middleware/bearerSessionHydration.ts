import { Request, Response, NextFunction } from "express";
import type { Pool } from "pg";
import { TokenLookupDbError } from "../auth";

/**
 * Hydratisiert die Session aus einem Bearer-Token (auth_tokens), wenn keine
 * Cookie-Session mit userId existiert. Setzt userId, email UND organizationId
 * (Audit-Befund K2: ohne organizationId lief die Anfrage ohne Mandantenkontext
 * und Routen mit `if (orgId) filter` lieferten Daten aller Organisationen).
 * Der Token-Pfad setzt den Kontext genauso wie der Web-Login.
 *
 * Aus server/index.ts extrahiert, damit End-to-End-Tests exakt dieselbe
 * Middleware verwenden wie die Produktion.
 */
export function bearerSessionHydration(pool: Pool, logError: (msg: string, meta?: any) => void = console.error) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (req.session?.userId) return next();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return next();
    const token = authHeader.slice(7);
    if (!token) return next();
    try {
      const result = await pool.query(
        "SELECT user_id FROM auth_tokens WHERE token = $1 AND expires_at > NOW() LIMIT 1",
        [token],
      );
      if (result.rows.length > 0) {
        (req.session as any).userId = result.rows[0].user_id;
        const profileResult = await pool.query(
          "SELECT email, organization_id FROM profiles WHERE id = $1 LIMIT 1",
          [result.rows[0].user_id],
        );
        if (profileResult.rows.length > 0) {
          (req.session as any).email = profileResult.rows[0].email;
          (req.session as any).organizationId = profileResult.rows[0].organization_id ?? undefined;
        }

        pool
          .query("UPDATE auth_tokens SET expires_at = NOW() + INTERVAL '24 hours' WHERE token = $1", [token])
          .catch(() => {});
      }
    } catch (e) {
      logError("DB-Fehler beim globalen Token-Lookup", {
        error: e instanceof Error ? e.message : String(e),
      });
      return next(new TokenLookupDbError(e));
    }
    next();
  };
}
