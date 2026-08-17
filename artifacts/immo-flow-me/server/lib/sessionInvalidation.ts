import { sql } from "drizzle-orm";
import { rootDb } from "../db";

/**
 * Invalidiert serverseitig ALLE Sitzungen und Bearer-Tokens eines Nutzers.
 *
 * Sicherheitsrelevante Änderungen (2FA deaktiviert, Rolle entzogen/vergeben)
 * dürfen nicht bis zu 60s (2FA-Konformitäts-Cache) weiterwirken — der Nutzer
 * wird überall abgemeldet und muss sich neu anmelden.
 *
 * @param userId Betroffener Nutzer
 * @param opts.keepSessionId Optionale sid, die erhalten bleibt (z.B. die
 *   Session, aus der die Änderung selbst ausgelöst wurde)
 */
export async function invalidateUserSessions(
  userId: string,
  opts: { keepSessionId?: string } = {},
): Promise<{ sessionsDeleted: number; tokensDeleted: number }> {
  const keep = opts.keepSessionId ?? null;

  const sessions = await rootDb.execute(sql`
    DELETE FROM user_sessions
    WHERE sess->>'userId' = ${userId}
      AND (${keep}::text IS NULL OR sid <> ${keep})
  `);

  const tokens = await rootDb.execute(sql`
    DELETE FROM auth_tokens WHERE user_id = ${userId}
  `);

  // Geräte-/Sitzungs-Tracking (securityRoutes) mit aufräumen
  await rootDb.execute(sql`
    DELETE FROM security_sessions
    WHERE user_id = ${userId}
      AND (${keep}::text IS NULL OR session_id <> ${keep})
  `).catch(() => {});

  return {
    sessionsDeleted: (sessions as any).rowCount ?? 0,
    tokensDeleted: (tokens as any).rowCount ?? 0,
  };
}
