import { Router, Request, Response } from "express";
import { isAuthenticated } from "./helpers";
import { metricsService } from "../services/metricsService";

const router = Router();

function getOrgId(req: Request): string | null {
  return (req as any).user?.organizationId || null;
}

function isAdmin(req: Request): boolean {
  const user = (req as any).user;
  return user?.role === "admin" || user?.role === "property_manager";
}

function requireAdmin(req: Request, res: Response): boolean {
  if (!isAdmin(req)) {
    res.status(403).json({ error: "Nur Administratoren haben Zugriff" });
    return false;
  }
  return true;
}

router.get("/api/admin/metrics", isAuthenticated, (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const orgId = getOrgId(req) || (req.query.orgId as string) || undefined;
  const summary = metricsService.getMetricsSummary(orgId);
  res.json(summary);
});

router.get("/api/admin/metrics/circuit-breaker", isAuthenticated, (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const metrics = metricsService.getCircuitBreakerMetrics();
  res.json(metrics);
});

router.get("/api/admin/metrics/ocr-costs", isAuthenticated, (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const orgId = (req.query.orgId as string) || getOrgId(req);
  if (!orgId) {
    return res.status(400).json({ error: "orgId erforderlich" });
  }
  const costs = metricsService.getOcrCostsByOrg(orgId);
  res.json(costs);
});

router.get("/api/admin/metrics/ocr-costs/tenants", isAuthenticated, (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const orgId = (req.query.orgId as string) || getOrgId(req);
  if (!orgId) {
    return res.status(400).json({ error: "orgId erforderlich" });
  }
  const costs = metricsService.getOcrCostsByTenant(orgId);
  res.json(costs);
});

router.get("/api/admin/metrics/reconciliation", isAuthenticated, (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const orgId = (req.query.orgId as string) || getOrgId(req) || undefined;
  const stats = metricsService.getReconciliationStats(orgId);
  res.json(stats);
});

router.get("/api/admin/metrics/alerts", isAuthenticated, (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const alerts = metricsService.getActiveAlerts();
  res.json(alerts);
});

router.post("/api/admin/metrics/alerts/evaluate", isAuthenticated, (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const alerts = metricsService.evaluateAlerts();
  res.json(alerts);
});

router.post("/api/admin/metrics/ocr-usage", isAuthenticated, (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const { orgId, tenantId, promptTokens, completionTokens, model } = req.body;

  if (!orgId || promptTokens == null || completionTokens == null) {
    return res.status(400).json({ error: "orgId, promptTokens und completionTokens sind erforderlich" });
  }

  metricsService.recordOcrUsage(
    orgId,
    tenantId || null,
    Number(promptTokens),
    Number(completionTokens),
    model || "gpt-4o"
  );

  res.json({ success: true });
});

export function registerMetricsRoutes(app: any) {
  app.use(router);
}
