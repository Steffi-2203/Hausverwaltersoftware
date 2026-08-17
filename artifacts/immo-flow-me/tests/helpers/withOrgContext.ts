/**
 * Test-Hilfsfunktion: setzt Org-Kontext (app.current_org + AsyncLocalStorage)
 * für Express-Test-Apps — analog zu rlsMiddleware im Production-Code.
 *
 * WICHTIG: Kein BEGIN/COMMIT in diesem Helper. Die Route-Handler committen ihre
 * eigenen Transaktionen. set_config(..., false) setzt die Session-Variable ohne
 * Transaktion, sodass Auto-Commits im Route-Handler sofort für rootDb sichtbar sind.
 */
import { type Application, Request, Response, NextFunction } from 'express';
import { drizzle } from 'drizzle-orm/node-postgres';
import { appPool, orgContext } from '../../server/db';
import * as schema from '@shared/schema';

/**
 * Fügt der Express-App ein Middleware hinzu, das einen Org-Kontext
 * (PostgreSQL-Session-Variable + AsyncLocalStorage) für jeden Request setzt.
 *
 * @param app - Die Express-Testapp
 * @param orgId - Die Organisations-UUID (darf null/'' sein → kein Kontext gesetzt)
 */
export function addOrgContext(app: Application, orgId: string | null | undefined): void {
  if (!orgId) return; // Kein Org-Kontext für anonyme/system Requests

  app.use((req: Request, res: Response, next: NextFunction) => {
    appPool.connect().then(client => {
      // set_config mit is_local=false: Variable gilt für die gesamte Session-Verbindung.
      // Kein BEGIN/COMMIT — Route-Handler verwalten ihre eigenen Transaktionen;
      // Auto-Commits sind sofort für andere Verbindungen (rootDb) sichtbar.
      client.query('SELECT set_config(\'app.current_org\', $1, false)', [orgId])
        .then(() => {
          const orgDb = drizzle(client as any, { schema });
          (req as any).dbClient = client;
          const release = () => {
            if ((req as any)._orgClientReleased) return;
            (req as any)._orgClientReleased = true;
            // Variable zurücksetzen damit die Verbindung sauber in den Pool zurückkehrt
            client.query("SELECT set_config('app.current_org', '', false)")
              .catch(() => {})
              .finally(() => client.release());
          };
          res.on('finish', release);
          res.on('close', release);
          orgContext.run({ organizationId: orgId, db: orgDb, client }, () => next());
        })
        .catch(err => { client.release(); next(err); });
    }).catch(next);
  });
}
