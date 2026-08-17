import { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { appPool, orgContext, type Db } from "../db";

declare global {
  namespace Express {
    interface Request {
      dbClient?: import("pg").PoolClient;
      orgDb?: Db;
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Setzt die Organisations-ID als Postgres-Session-Variable (app.current_org)
 * für Row-Level-Security — und führt die gesamte Anfrage in einem
 * AsyncLocalStorage-Kontext aus, damit der `db`-Export aus ../db auf genau
 * diese Verbindung zeigt. Ohne diesen Kontext griffe RLS nicht, weil alle
 * Services über den globalen Pool laufen (Audit-Befund K1).
 *
 * Sicherheitsrelevant:
 * - organizationId wird strikt als UUID validiert (Defense in Depth)
 * - set_config() wird parametrisiert aufgerufen — keine String-Interpolation in SQL
 * - Bei Response-Fehlern wird ROLLBACK statt COMMIT ausgeführt
 */
export function rlsMiddleware(req: Request, res: Response, next: NextFunction) {
  const organizationId = (req.session as any)?.organizationId;

  if (!organizationId) {
    return next();
  }

  if (typeof organizationId !== "string" || !UUID_RE.test(organizationId)) {
    return next(new Error("Ungültige Organisations-ID in der Session"));
  }

  appPool
    .connect()
    .then((client) => {
      client
        .query("BEGIN")
        .then(() =>
          // Parametrisiert statt `SET LOCAL ... '${...}'` — verhindert SQL-Injection strukturell
          client.query("SELECT set_config('app.current_org', $1, true)", [organizationId]),
        )
        .then(() => {
          const orgDb = drizzle(client as any, { schema });
          req.dbClient = client;
          req.orgDb = orgDb;

          let finished = false;
          const cleanup = () => {
            if (finished) return;
            finished = true;
            const statusOk = res.statusCode < 500;
            client
              .query(statusOk ? "COMMIT" : "ROLLBACK")
              .catch(() => {})
              .finally(() => {
                client.release();
              });
          };

          res.on("finish", cleanup);
          res.on("close", cleanup);

          // Ab hier läuft die komplette Anfrage — inkl. aller await-Ketten —
          // im Organisationskontext.
          orgContext.run({ organizationId, db: orgDb, client }, () => next());
        })
        .catch((err) => {
          client
            .query("ROLLBACK")
            .catch(() => {})
            .finally(() => {
              client.release();
            });
          next(err);
        });
    })
    .catch((err) => {
      next(err);
    });
}
