import { Request, Response, NextFunction } from "express";
import type { Pool } from "pg";
import { TokenLookupDbError } from "../auth";

/**
 * Hydratisiert die Session aus einem Bearer-Token (auth_tokens), wenn kein
 * Cookie-Session mit userId existiert. Setzt userId, email UND organizationId
 * (Audit-Befund K2: ohne organizationId lief die Anfrage ohne Mandantenkontext
 * und Routen mit `if (orgId) filter` lieferten Daten aller Organisationen).
 * Der Token-Pfad setzt den Kontext genauso wie der Web-Login.
 *
 * Aus server/index.ts extrahiert, damit End-to-End-Tests exakt dieselbe
 * Middleware verwenden wie die Produktion.
 *
 * Sicherheits-Invariante (Task #195):
 *   Wenn ein Authorization-Header mit Bearer-Token vorhanden ist, MUSS der
 *   Token gültig sein. Eine vorhandene Session-Cookie darf keinen abgelaufenen
 *   oder gefälschten Token "silently" akzeptieren. Bei ungültigem Token wird
 *   (req as any)._bearerTokenRejected = true gesetzt; isAuthenticated und
 *   enforcePrivileged2FA prüfen dieses Flag und liefern 401.
 */
export function bearerSessionHydration(pool: Pool, logError: (msg: string, meta?: any) => void = console.error) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    // Kein Bearer-Header → normaler Web-Session-Pfad (Cookie-Session gültig).
    if (!authHeader?.startsWith("Bearer ")) return next();

    const token = authHeader.slice(7);
    if (!token) return next();

    // Bearer-Token vorhanden → er MUSS gültig sein.
    // Wir fallen NICHT auf eine vorhandene Session-Cookie zurück, wenn der Token
    // ungültig oder abgelaufen ist (verhindert "silent acceptance", Task #195).
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
      } else {
        // Token vorhanden, aber abgelaufen oder nicht in der DB (gefälscht).
        // Flag setzen → isAuthenticated / enforcePrivileged2FA geben 401 zurück,
        // auch wenn eine Session-Cookie mit userId existiert.
        (req as any)._bearerTokenRejected = true;
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
