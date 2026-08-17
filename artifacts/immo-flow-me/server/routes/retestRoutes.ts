import { Router, Request, Response } from "express";
import { isAuthenticated } from "./helpers";
import { retestService } from "../services/retestService";

const router = Router();

function getOrgId(req: Request): string | null {
  return (req as any).user?.organizationId || null;
}

function isAdmin(req: Request): boolean {
  const user = (req as any).user;
  return user?.role === 'admin' || user?.role === 'property_manager';
}

function requireAdmin(req: Request, res: Response): boolean {
  if (!isAdmin(req)) {
    res.status(403).json({ error: "Nur Administratoren haben Zugriff" });
    return false;
  }
  return true;
}

router.get("/api/admin/security-findings", isAuthenticated, (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const { status, severity, category } = req.query;
  const filters: { status?: string; severity?: string; category?: string } = {};
  if (status) filters.status = status as string;
  if (severity) filters.severity = severity as string;
  if (category) filters.category = category as string;
  const findings = retestService.getAllFindings(filters);
  res.json(findings);
});

router.get("/api/admin/security-findings/:id", isAuthenticated, (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const id = req.params.id as string;
  const finding = retestService.getFinding(id);
  if (!finding) {
    return res.status(404).json({ error: "Finding nicht gefunden" });
  }
  const history = retestService.getRetestHistory(id);
  res.json({ ...finding, retestHistory: history });
});

router.post("/api/admin/security-findings", isAuthenticated, (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const { title, severity, category, description, testFunction, ticketRef, status } = req.body;
  if (!title || !severity || !category || !description || !testFunction) {
    return res.status(400).json({ error: "title, severity, category, description und testFunction sind erforderlich" });
  }
  const finding = retestService.registerFinding({
    title,
    severity,
    category,
    description,
    testFunction,
    status: status || 'open',
    ticketRef: ticketRef || null,
  });
  res.status(201).json(finding);
});

router.patch("/api/admin/security-findings/:id", isAuthenticated, (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const id = req.params.id as string;
  const existing = retestService.getFinding(id);
  if (!existing) {
    return res.status(404).json({ error: "Finding nicht gefunden" });
  }
  const updated = retestService.updateFinding(id, req.body);
  res.json(updated);
});

router.post("/api/admin/security-findings/:id/retest", isAuthenticated, async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const id = req.params.id as string;
  const finding = retestService.getFinding(id);
  if (!finding) {
    return res.status(404).json({ error: "Finding nicht gefunden" });
  }
  try {
    const result = await retestService.runRetestBatch([id]);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/admin/retests/batch", isAuthenticated, async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { findingIds } = req.body || {};
    const result = await retestService.runRetestBatch(findingIds);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/admin/retests/summary", isAuthenticated, (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const summary = retestService.getRetestSummary();
  res.json(summary);
});

export function registerRetestRoutes(app: any) {
  app.use(router);
}
