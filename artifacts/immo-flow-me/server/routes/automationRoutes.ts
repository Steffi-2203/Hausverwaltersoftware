import { Router, Request, Response } from "express";
import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  automationRules,
  automationRuleLogs,
  insertAutomationRuleSchema,
} from "@shared/schema";
import { isAuthenticated, getAuthContext } from "./helpers";
import { evaluateRule } from "../services/rulesEngineService";

const router = Router();

router.get("/api/automation/rules", isAuthenticated, async (req: Request, res: Response) => {
  const ctx = await getAuthContext(req, res);
  if (!ctx) return;

  const rules = await db
    .select()
    .from(automationRules)
    .where(eq(automationRules.organizationId, ctx.orgId!))
    .orderBy(desc(automationRules.createdAt));

  res.json(rules);
});

router.post("/api/automation/rules", isAuthenticated, async (req: Request, res: Response) => {
  const ctx = await getAuthContext(req, res);
  if (!ctx) return;

  const body = { ...req.body, organizationId: ctx.orgId };
  const parsed = insertAutomationRuleSchema.safeParse(body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Ungültige Daten", details: parsed.error.flatten() });
  }

  const [rule] = await db.insert(automationRules).values(parsed.data).returning();
  res.status(201).json(rule);
});

router.patch("/api/automation/rules/:id", isAuthenticated, async (req: Request, res: Response) => {
  const ctx = await getAuthContext(req, res);
  if (!ctx) return;

  const existing = await db
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.id, req.params.id), eq(automationRules.organizationId, ctx.orgId!)))
    .limit(1);

  if (!existing.length) {
    return res.status(404).json({ error: "Regel nicht gefunden" });
  }

  const { name, description, triggerType, conditions, actions, isActive } = req.body;
  const updateData: Record<string, any> = { updatedAt: new Date() };
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (triggerType !== undefined) updateData.triggerType = triggerType;
  if (conditions !== undefined) updateData.conditions = conditions;
  if (actions !== undefined) updateData.actions = actions;
  if (isActive !== undefined) updateData.isActive = isActive;

  const [updated] = await db
    .update(automationRules)
    .set(updateData)
    .where(eq(automationRules.id, req.params.id))
    .returning();

  res.json(updated);
});

router.delete("/api/automation/rules/:id", isAuthenticated, async (req: Request, res: Response) => {
  const ctx = await getAuthContext(req, res);
  if (!ctx) return;

  const existing = await db
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.id, req.params.id), eq(automationRules.organizationId, ctx.orgId!)))
    .limit(1);

  if (!existing.length) {
    return res.status(404).json({ error: "Regel nicht gefunden" });
  }

  await db.delete(automationRuleLogs).where(eq(automationRuleLogs.ruleId, req.params.id));
  await db.delete(automationRules).where(eq(automationRules.id, req.params.id));

  res.json({ success: true });
});

router.post("/api/automation/rules/:id/dry-run", isAuthenticated, async (req: Request, res: Response) => {
  const ctx = await getAuthContext(req, res);
  if (!ctx) return;

  const [rule] = await db
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.id, req.params.id), eq(automationRules.organizationId, ctx.orgId!)))
    .limit(1);

  if (!rule) {
    return res.status(404).json({ error: "Regel nicht gefunden" });
  }

  const result = await evaluateRule(rule, ctx.orgId!, true);

  await db.insert(automationRuleLogs).values({
    ruleId: rule.id,
    organizationId: ctx.orgId,
    isDryRun: true,
    triggerData: { triggerType: rule.triggerType, conditions: rule.conditions },
    matchedItems: result.matchedItems,
    actionsPreview: result.actions,
    status: result.status,
    errorMessage: result.errorMessage || null,
  });

  res.json(result);
});

router.post("/api/automation/rules/:id/execute", isAuthenticated, async (req: Request, res: Response) => {
  const ctx = await getAuthContext(req, res);
  if (!ctx) return;

  const [rule] = await db
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.id, req.params.id), eq(automationRules.organizationId, ctx.orgId!)))
    .limit(1);

  if (!rule) {
    return res.status(404).json({ error: "Regel nicht gefunden" });
  }

  const result = await evaluateRule(rule, ctx.orgId!, false);

  await db.insert(automationRuleLogs).values({
    ruleId: rule.id,
    organizationId: ctx.orgId,
    isDryRun: false,
    triggerData: { triggerType: rule.triggerType, conditions: rule.conditions },
    matchedItems: result.matchedItems,
    actionsExecuted: result.actions,
    status: result.status,
    errorMessage: result.errorMessage || null,
  });

  await db
    .update(automationRules)
    .set({
      lastRun: new Date(),
      runCount: (rule.runCount || 0) + 1,
      updatedAt: new Date(),
    })
    .where(eq(automationRules.id, rule.id));

  res.json(result);
});

router.get("/api/automation/rules/:id/logs", isAuthenticated, async (req: Request, res: Response) => {
  const ctx = await getAuthContext(req, res);
  if (!ctx) return;

  const [rule] = await db
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.id, req.params.id), eq(automationRules.organizationId, ctx.orgId!)))
    .limit(1);

  if (!rule) {
    return res.status(404).json({ error: "Regel nicht gefunden" });
  }

  const logs = await db
    .select()
    .from(automationRuleLogs)
    .where(eq(automationRuleLogs.ruleId, req.params.id))
    .orderBy(desc(automationRuleLogs.createdAt))
    .limit(50);

  res.json(logs);
});

export function registerAutomationRoutes(app: any) {
  app.use(router);
}
