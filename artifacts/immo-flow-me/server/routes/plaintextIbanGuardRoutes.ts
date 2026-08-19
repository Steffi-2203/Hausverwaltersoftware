import { Router, type NextFunction, type Request, type Response } from "express";
import { rootDb } from "../db";
import { scanPlaintextIbanBic } from "../lib/plaintextIbanGuard";
import { logger } from "../lib/logger";
import { isAuthenticated } from "./helpers";

const router = Router();

/**
 * Der Scan läuft absichtlich organisationsübergreifend über rootDb. Deshalb
 * reicht eine beliebige Organisations-Adminrolle nicht aus: nur die per
 * Deployment konfigurierte Plattform-Administration darf ihn aufrufen.
 */
export function requireProductionIbanScanAccess(req: Request, res: Response, next: NextFunction) {
  const configuredAdminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const sessionEmail = (req.session as any)?.email;
  const isConfiguredAdmin =
    typeof sessionEmail === "string" &&
    !!configuredAdminEmail &&
    sessionEmail.trim().toLowerCase() === configuredAdminEmail;

  if (!isConfiguredAdmin) {
    res.status(403).json({ error: "Keine Berechtigung für diese Sicherheitsprüfung" });
    return;
  }
  next();
}

/**
 * Read-only production guard.
 *
 * rootDb is intentional here: the scan must cover every organization and is
 * protected by requireProductionIbanScanAccess before it can run. The shared scan itself
 * only issues SELECT statements and never selects the sensitive field value.
 */
router.get(
  // /api gehört im Workspace zum separaten API-Artefakt. Dieser interne
  // Diagnosepfad bleibt deshalb beim IMMO-FLOW-ME-Root-Service erreichbar.
  "/admin/security/plaintext-iban-scan",
  isAuthenticated,
  requireProductionIbanScanAccess,
  async (_req: Request, res: Response) => {
    try {
      const result = await scanPlaintextIbanBic(rootDb);
      res.json({
        status: result.totalViolations === 0 ? "clean" : "violations_found",
        discovered: {
          ibanColumns: result.ibanColumns,
          bicColumns: result.bicColumns,
        },
        violations: result.violations,
        totalViolations: result.totalViolations,
      });
    } catch (error) {
      logger.error("[plaintext-iban-scan] Read-only scan failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: "Klartext-Prüfung konnte nicht durchgeführt werden" });
    }
  },
);

export function registerPlaintextIbanGuardRoutes(app: any) {
  app.use(router);
}