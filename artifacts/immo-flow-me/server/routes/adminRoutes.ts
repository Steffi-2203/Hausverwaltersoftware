import { Router, Request, Response } from "express";
import { db } from "../db";
import { eq, and, desc, gte, lte, sql, isNull, or, inArray } from "drizzle-orm";
import * as schema from "@shared/schema";
import { getAuthContext, checkMutationPermission, objectToSnakeCase, objectToCamelCase, requireAdminAccess } from "./helpers";
import rateLimit, { MemoryStore } from "express-rate-limit";

// Rate-Limiter fuer API-Key-Verwaltungsendpunkte: max 5 Anfragen/Minute pro Admin.
//
// Schluessel: session.userId (nicht req.ip).
//   req.ip liest mit trust proxy = 1 aus X-Forwarded-For — ein faelschbarer
//   Client-Header. session.userId ist serverseitig verifiziert und kann nicht
//   durch XFF-Manipulation beeinflusst werden.
//
// Reihenfolge: Limiter NACH requireAdminAccess() montiert (siehe Routen unten).
//   Nur authentifizierte Admins erreichen den Limiter — ein Nicht-Admin erhaelt
//   401/403 vor dem Limiter und kann das Kontingent anderer Admins nicht erschoepfen.
//
// Store + Limiter werden exportiert damit Tests sie direkt einsetzen koennen.
export const _apiKeyManagementStore = new MemoryStore();
export const _apiKeyManagementLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: "Zu viele Anfragen. Bitte versuche es in einer Minute erneut." },
  standardHeaders: true,
  legacyHeaders: false,
  store: _apiKeyManagementStore,
  keyGenerator: (req) => (req as any).session?.userId ?? "anonymous",
});

const router = Router();

// ====== INSURANCE POLICIES ======

router.get("/api/insurance/policies", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const propertyId = req.query.propertyId as string;
    let conditions: any[] = [eq(schema.insurancePolicies.organizationId, ctx.orgId)];
    if (propertyId) conditions.push(eq(schema.insurancePolicies.propertyId, propertyId));
    const where = conditions.length > 1 ? and(...conditions) : conditions[0];
    const data = await db.select().from(schema.insurancePolicies).where(where).orderBy(schema.insurancePolicies.endDate);
    res.json(objectToSnakeCase(data));
  } catch (error) {
    console.error("Error fetching policies:", error);
    res.status(500).json({ error: "Fehler beim Laden der Versicherungen" });
  }
});

router.post("/api/insurance/policies", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const body = objectToCamelCase(req.body);
    const [created] = await db.insert(schema.insurancePolicies).values({ ...body, organizationId: ctx.orgId }).returning();
    res.json(objectToSnakeCase(created));
  } catch (error) {
    console.error("Error creating policy:", error);
    res.status(500).json({ error: "Fehler beim Anlegen" });
  }
});

router.delete("/api/insurance/policies/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    await db.delete(schema.insurancePolicies).where(and(eq(schema.insurancePolicies.id, req.params.id), eq(schema.insurancePolicies.organizationId, ctx.orgId)));
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting policy:", error);
    res.status(500).json({ error: "Fehler beim Löschen" });
  }
});

// ====== INSURANCE CLAIMS ======

router.get("/api/insurance/claims", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const data = await db.select().from(schema.insuranceClaims).where(eq(schema.insuranceClaims.organizationId, ctx.orgId)).orderBy(desc(schema.insuranceClaims.claimDate));
    res.json(objectToSnakeCase(data));
  } catch (error) {
    console.error("Error fetching claims:", error);
    res.status(500).json({ error: "Fehler beim Laden der Schadensmeldungen" });
  }
});

router.post("/api/insurance/claims", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const body = objectToCamelCase(req.body);
    const [created] = await db.insert(schema.insuranceClaims).values({ ...body, organizationId: ctx.orgId }).returning();
    res.json(objectToSnakeCase(created));
  } catch (error) {
    console.error("Error creating claim:", error);
    res.status(500).json({ error: "Fehler beim Erstellen" });
  }
});

router.patch("/api/insurance/claims/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const body = objectToCamelCase(req.body);
    const [updated] = await db.update(schema.insuranceClaims).set({ ...body, updatedAt: new Date() }).where(and(eq(schema.insuranceClaims.id, req.params.id), eq(schema.insuranceClaims.organizationId, ctx.orgId))).returning();
    if (!updated) return res.status(404).json({ error: "Nicht gefunden" });
    res.json(objectToSnakeCase(updated));
  } catch (error) {
    console.error("Error updating claim:", error);
    res.status(500).json({ error: "Fehler beim Aktualisieren" });
  }
});

// ====== DEADLINES ======

router.get("/api/deadlines", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const propertyId = req.query.propertyId as string;
    const status = req.query.status as string;
    const category = req.query.category as string;
    let conditions: any[] = [eq(schema.deadlines.organizationId, ctx.orgId)];
    if (propertyId) conditions.push(eq(schema.deadlines.propertyId, propertyId));
    if (status) conditions.push(eq(schema.deadlines.status, status));
    if (category) conditions.push(eq(schema.deadlines.category, category));
    const where = conditions.length > 1 ? and(...conditions) : conditions[0];
    const data = await db.select().from(schema.deadlines).where(where).orderBy(schema.deadlines.deadlineDate);
    res.json(objectToSnakeCase(data));
  } catch (error) {
    console.error("Error fetching deadlines:", error);
    res.status(500).json({ error: "Fehler beim Laden der Fristen" });
  }
});

router.post("/api/deadlines", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const body = objectToCamelCase(req.body);
    const [created] = await db.insert(schema.deadlines).values({ ...body, organizationId: ctx.orgId }).returning();
    res.json(objectToSnakeCase(created));
  } catch (error) {
    console.error("Error creating deadline:", error);
    res.status(500).json({ error: "Fehler beim Erstellen" });
  }
});

router.patch("/api/deadlines/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const body = objectToCamelCase(req.body);
    const [updated] = await db.update(schema.deadlines).set({ ...body, updatedAt: new Date() }).where(and(eq(schema.deadlines.id, req.params.id), eq(schema.deadlines.organizationId, ctx.orgId))).returning();
    if (!updated) return res.status(404).json({ error: "Nicht gefunden" });
    res.json(objectToSnakeCase(updated));
  } catch (error) {
    console.error("Error updating deadline:", error);
    res.status(500).json({ error: "Fehler beim Aktualisieren" });
  }
});

router.delete("/api/deadlines/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    await db.delete(schema.deadlines).where(and(eq(schema.deadlines.id, req.params.id), eq(schema.deadlines.organizationId, ctx.orgId)));
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting deadline:", error);
    res.status(500).json({ error: "Fehler beim Löschen" });
  }
});

// ====== LETTER TEMPLATES ======

router.get("/api/letter-templates", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const data = await db.select().from(schema.letterTemplates).where(eq(schema.letterTemplates.organizationId, ctx.orgId)).orderBy(schema.letterTemplates.category);
    res.json(objectToSnakeCase(data));
  } catch (error) {
    console.error("Error fetching letter templates:", error);
    res.status(500).json({ error: "Fehler beim Laden" });
  }
});

router.post("/api/letter-templates", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const body = objectToCamelCase(req.body);
    const [created] = await db.insert(schema.letterTemplates).values({ ...body, organizationId: ctx.orgId }).returning();
    res.json(objectToSnakeCase(created));
  } catch (error) {
    console.error("Error creating letter template:", error);
    res.status(500).json({ error: "Fehler beim Erstellen" });
  }
});

router.patch("/api/letter-templates/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const body = objectToCamelCase(req.body);
    const [updated] = await db.update(schema.letterTemplates).set({ ...body, updatedAt: new Date() }).where(and(eq(schema.letterTemplates.id, req.params.id), eq(schema.letterTemplates.organizationId, ctx.orgId))).returning();
    if (!updated) return res.status(404).json({ error: "Nicht gefunden" });
    res.json(objectToSnakeCase(updated));
  } catch (error) {
    console.error("Error updating letter template:", error);
    res.status(500).json({ error: "Fehler beim Aktualisieren" });
  }
});

router.delete("/api/letter-templates/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    await db.delete(schema.letterTemplates).where(and(eq(schema.letterTemplates.id, req.params.id), eq(schema.letterTemplates.organizationId, ctx.orgId)));
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting letter template:", error);
    res.status(500).json({ error: "Fehler beim Löschen" });
  }
});

// ====== SERIAL LETTERS ======

router.get("/api/serial-letters", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const data = await db.select().from(schema.serialLetters).where(eq(schema.serialLetters.organizationId, ctx.orgId)).orderBy(desc(schema.serialLetters.createdAt));
    res.json(objectToSnakeCase(data));
  } catch (error) {
    console.error("Error fetching serial letters:", error);
    res.status(500).json({ error: "Fehler beim Laden" });
  }
});

router.post("/api/serial-letters", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const body = objectToCamelCase(req.body);
    const [created] = await db.insert(schema.serialLetters).values({ ...body, organizationId: ctx.orgId, createdBy: ctx.userId }).returning();
    res.json(objectToSnakeCase(created));
  } catch (error) {
    console.error("Error creating serial letter:", error);
    res.status(500).json({ error: "Fehler beim Erstellen" });
  }
});

// ====== MANAGEMENT CONTRACTS ======

router.get("/api/management-contracts", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const data = await db.select().from(schema.managementContracts).where(eq(schema.managementContracts.organizationId, ctx.orgId)).orderBy(desc(schema.managementContracts.createdAt));
    res.json(objectToSnakeCase(data));
  } catch (error) {
    console.error("Error fetching management contracts:", error);
    res.status(500).json({ error: "Fehler beim Laden der Verträge" });
  }
});

router.post("/api/management-contracts", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const body = objectToCamelCase(req.body);
    const [created] = await db.insert(schema.managementContracts).values({ ...body, organizationId: ctx.orgId }).returning();
    res.json(objectToSnakeCase(created));
  } catch (error) {
    console.error("Error creating management contract:", error);
    res.status(500).json({ error: "Fehler beim Erstellen" });
  }
});

router.patch("/api/management-contracts/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const body = objectToCamelCase(req.body);
    const [updated] = await db.update(schema.managementContracts).set({ ...body, updatedAt: new Date() }).where(and(eq(schema.managementContracts.id, req.params.id), eq(schema.managementContracts.organizationId, ctx.orgId))).returning();
    if (!updated) return res.status(404).json({ error: "Nicht gefunden" });
    res.json(objectToSnakeCase(updated));
  } catch (error) {
    console.error("Error updating management contract:", error);
    res.status(500).json({ error: "Fehler beim Aktualisieren" });
  }
});

router.delete("/api/management-contracts/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    await db.delete(schema.managementContracts).where(and(eq(schema.managementContracts.id, req.params.id), eq(schema.managementContracts.organizationId, ctx.orgId)));
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting management contract:", error);
    res.status(500).json({ error: "Fehler beim Löschen" });
  }
});

// ====== USER ORGANIZATIONS ======

router.get("/api/user-organizations", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    const data = await db.select().from(schema.userOrganizations).where(eq(schema.userOrganizations.userId, ctx.userId));
    res.json(objectToSnakeCase(data));
  } catch (error) {
    console.error("Error fetching user organizations:", error);
    res.status(500).json({ error: "Fehler beim Laden" });
  }
});

router.post("/api/user-organizations/switch", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    const body = objectToCamelCase(req.body);
    const { organizationId } = body;
    if (!organizationId) return res.status(400).json({ error: "organizationId erforderlich" });
    const membership = await db.select().from(schema.userOrganizations).where(and(eq(schema.userOrganizations.userId, ctx.userId), eq(schema.userOrganizations.organizationId, organizationId))).limit(1);
    if (!membership.length) return res.status(403).json({ error: "Keine Berechtigung für diese Organisation" });
    await db.update(schema.userOrganizations).set({ isDefault: false }).where(eq(schema.userOrganizations.userId, ctx.userId));
    await db.update(schema.userOrganizations).set({ isDefault: true }).where(and(eq(schema.userOrganizations.userId, ctx.userId), eq(schema.userOrganizations.organizationId, organizationId)));
    await db.update(schema.profiles).set({ organizationId }).where(eq(schema.profiles.id, ctx.userId));
    res.json({ success: true });
  } catch (error) {
    console.error("Error switching organization:", error);
    res.status(500).json({ error: "Fehler beim Wechseln" });
  }
});

// ====== AUDIT LOGS ======

router.get("/api/audit-logs", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    const tableName = req.query.table_name as string;
    const action = req.query.action as string;
    const startDate = req.query.start_date as string;
    const endDate = req.query.end_date as string;
    const limit = parseInt(req.query.limit as string) || 100;
    let conditions: any[] = [];
    if (tableName) conditions.push(eq(schema.auditLogs.tableName, tableName));
    if (action) conditions.push(eq(schema.auditLogs.action, action));
    if (startDate) conditions.push(gte(schema.auditLogs.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lte(schema.auditLogs.createdAt, new Date(endDate)));
    const where = conditions.length > 1 ? and(...conditions) : conditions.length === 1 ? conditions[0] : undefined;
    const data = await db.select().from(schema.auditLogs).where(where).orderBy(desc(schema.auditLogs.createdAt)).limit(limit);
    res.json(objectToSnakeCase(data));
  } catch (error) {
    console.error("Error fetching audit logs:", error);
    res.status(500).json({ error: "Fehler beim Laden der Audit-Logs" });
  }
});

// ====== TENANT PORTAL ACCESS ======

router.get("/api/tenant-portal-access", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const data = await db
      .select({ tenantPortalAccess: schema.tenantPortalAccess })
      .from(schema.tenantPortalAccess)
      .innerJoin(schema.tenants, eq(schema.tenantPortalAccess.tenantId, schema.tenants.id))
      .innerJoin(schema.units, eq(schema.tenants.unitId, schema.units.id))
      .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
      .where(eq(schema.properties.organizationId, ctx.orgId))
      .orderBy(desc(schema.tenantPortalAccess.createdAt));
    res.json(objectToSnakeCase(data.map(d => d.tenantPortalAccess)));
  } catch (error) {
    console.error("Error fetching tenant portal access:", error);
    res.status(500).json({ error: "Fehler beim Laden der Mieterportal-Zugänge" });
  }
});

router.post("/api/tenant-portal-access", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const body = objectToCamelCase(req.body);
    const parsed = schema.insertTenantPortalAccessSchema.parse(body);
    const tenant = await db
      .select()
      .from(schema.tenants)
      .innerJoin(schema.units, eq(schema.tenants.unitId, schema.units.id))
      .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
      .where(and(eq(schema.tenants.id, parsed.tenantId), eq(schema.properties.organizationId, ctx.orgId)))
      .limit(1);
    if (!tenant.length) return res.status(404).json({ error: "Mieter nicht gefunden" });
    // organizationId wird serverseitig aus ctx.orgId gesetzt — kein clientseitiger Wert wird akzeptiert.
    const [created] = await db.insert(schema.tenantPortalAccess).values({ ...parsed, organizationId: ctx.orgId }).returning();
    res.json(objectToSnakeCase(created));
  } catch (error) {
    console.error("Error creating tenant portal access:", error);
    res.status(500).json({ error: "Fehler beim Erstellen des Mieterportal-Zugangs" });
  }
});

router.patch("/api/tenant-portal-access/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const body = objectToCamelCase(req.body);
    const existing = await db
      .select({ tenantPortalAccess: schema.tenantPortalAccess })
      .from(schema.tenantPortalAccess)
      .innerJoin(schema.tenants, eq(schema.tenantPortalAccess.tenantId, schema.tenants.id))
      .innerJoin(schema.units, eq(schema.tenants.unitId, schema.units.id))
      .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
      .where(and(eq(schema.tenantPortalAccess.id, req.params.id), eq(schema.properties.organizationId, ctx.orgId)))
      .limit(1);
    if (!existing.length) return res.status(404).json({ error: "Nicht gefunden" });
    const [updated] = await db.update(schema.tenantPortalAccess).set({ isActive: body.isActive, updatedAt: new Date() }).where(and(
      eq(schema.tenantPortalAccess.id, req.params.id),
      inArray(schema.tenantPortalAccess.tenantId,
        db.select({ id: schema.tenants.id }).from(schema.tenants)
          .innerJoin(schema.units, eq(schema.tenants.unitId, schema.units.id))
          .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
          .where(eq(schema.properties.organizationId, ctx.orgId)))
    )).returning();
    res.json(objectToSnakeCase(updated));
  } catch (error) {
    console.error("Error updating tenant portal access:", error);
    res.status(500).json({ error: "Fehler beim Aktualisieren des Mieterportal-Zugangs" });
  }
});

// ====== OWNER PORTAL ACCESS ======

router.get("/api/owner-portal-access", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const data = await db
      .select({ ownerPortalAccess: schema.ownerPortalAccess })
      .from(schema.ownerPortalAccess)
      .innerJoin(schema.owners, eq(schema.ownerPortalAccess.ownerId, schema.owners.id))
      .where(eq(schema.owners.organizationId, ctx.orgId))
      .orderBy(desc(schema.ownerPortalAccess.createdAt));
    res.json(objectToSnakeCase(data.map(d => d.ownerPortalAccess)));
  } catch (error) {
    console.error("Error fetching owner portal access:", error);
    res.status(500).json({ error: "Fehler beim Laden der Eigentümerportal-Zugänge" });
  }
});

router.post("/api/owner-portal-access", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const body = objectToCamelCase(req.body);
    const parsed = schema.insertOwnerPortalAccessSchema.parse(body);
    const owner = await db
      .select()
      .from(schema.owners)
      .where(and(eq(schema.owners.id, parsed.ownerId), eq(schema.owners.organizationId, ctx.orgId)))
      .limit(1);
    if (!owner.length) return res.status(404).json({ error: "Eigentümer nicht gefunden" });
    // organizationId wird serverseitig aus ctx.orgId gesetzt — kein clientseitiger Wert wird akzeptiert.
    const [created] = await db.insert(schema.ownerPortalAccess).values({ ...parsed, organizationId: ctx.orgId }).returning();
    res.json(objectToSnakeCase(created));
  } catch (error) {
    console.error("Error creating owner portal access:", error);
    res.status(500).json({ error: "Fehler beim Erstellen des Eigentümerportal-Zugangs" });
  }
});

router.patch("/api/owner-portal-access/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const body = objectToCamelCase(req.body);
    const existing = await db
      .select({ ownerPortalAccess: schema.ownerPortalAccess })
      .from(schema.ownerPortalAccess)
      .innerJoin(schema.owners, eq(schema.ownerPortalAccess.ownerId, schema.owners.id))
      .where(and(eq(schema.ownerPortalAccess.id, req.params.id), eq(schema.owners.organizationId, ctx.orgId)))
      .limit(1);
    if (!existing.length) return res.status(404).json({ error: "Nicht gefunden" });
    const [updated] = await db.update(schema.ownerPortalAccess).set({ isActive: body.isActive, updatedAt: new Date() }).where(and(
      eq(schema.ownerPortalAccess.id, req.params.id),
      inArray(schema.ownerPortalAccess.ownerId,
        db.select({ id: schema.owners.id }).from(schema.owners)
          .where(eq(schema.owners.organizationId, ctx.orgId)))
    )).returning();
    res.json(objectToSnakeCase(updated));
  } catch (error) {
    console.error("Error updating owner portal access:", error);
    res.status(500).json({ error: "Fehler beim Aktualisieren des Eigentümerportal-Zugangs" });
  }
});

// ====== LEARNED MATCHES ======

router.get("/api/learned-matches", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const data = await db.select().from(schema.learnedMatches).where(eq(schema.learnedMatches.organizationId, ctx.orgId)).orderBy(desc(schema.learnedMatches.matchCount));
    res.json(objectToSnakeCase(data));
  } catch (error) {
    console.error("Error fetching learned matches:", error);
    res.status(500).json({ error: "Fehler beim Laden der gelernten Zuordnungen" });
  }
});

router.post("/api/learned-matches", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const body = objectToCamelCase(req.body);
    const [created] = await db.insert(schema.learnedMatches).values({ ...body, organizationId: ctx.orgId }).returning();
    res.json(objectToSnakeCase(created));
  } catch (error) {
    console.error("Error creating learned match:", error);
    res.status(500).json({ error: "Fehler beim Erstellen der Zuordnung" });
  }
});

router.post("/api/learned-matches/:id/increment", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const [updated] = await db.update(schema.learnedMatches).set({ matchCount: sql`${schema.learnedMatches.matchCount} + 1`, updatedAt: new Date() }).where(and(eq(schema.learnedMatches.id, req.params.id), eq(schema.learnedMatches.organizationId, ctx.orgId))).returning();
    if (!updated) return res.status(404).json({ error: "Nicht gefunden" });
    res.json(objectToSnakeCase(updated));
  } catch (error) {
    console.error("Error incrementing learned match:", error);
    res.status(500).json({ error: "Fehler beim Aktualisieren der Zuordnung" });
  }
});

router.delete("/api/learned-matches/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const [deleted] = await db.delete(schema.learnedMatches).where(and(eq(schema.learnedMatches.id, req.params.id), eq(schema.learnedMatches.organizationId, ctx.orgId))).returning();
    if (!deleted) return res.status(404).json({ error: "Nicht gefunden" });
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting learned match:", error);
    res.status(500).json({ error: "Fehler beim Löschen der Zuordnung" });
  }
});

// ====== PERIOD LOCKS ======

router.get("/api/period-locks", async (req: Request, res: Response) => {
  const ctx = await getAuthContext(req, res);
  if (!ctx) return;
  try {
    const { getLockedPeriods } = await import("../services/periodLockService");
    const locks = await getLockedPeriods(ctx.orgId);
    res.json(locks);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/period-locks", async (req: Request, res: Response) => {
  const ctx = await getAuthContext(req, res);
  if (!ctx) return;
  if (!(await checkMutationPermission(req, res))) return;
  try {
    const { year, month } = req.body;
    if (!year || !month) return res.status(400).json({ error: "Jahr und Monat erforderlich" });
    const { lockPeriod } = await import("../services/periodLockService");
    await lockPeriod(ctx.orgId, year, month, ctx.userId);
    res.json({ success: true, message: `Periode ${month}/${year} gesperrt` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/api/period-locks/:year/:month", async (req: Request, res: Response) => {
  const ctx = await getAuthContext(req, res);
  if (!ctx) return;
  if (!(await checkMutationPermission(req, res))) return;
  try {
    const { unlockPeriod } = await import("../services/periodLockService");
    await unlockPeriod(ctx.orgId, parseInt(req.params.year), parseInt(req.params.month));
    res.json({ success: true, message: `Periode ${req.params.month}/${req.params.year} entsperrt` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ====== SETTLEMENT DEADLINES ======

router.get("/api/settlement-deadlines", async (req: Request, res: Response) => {
  const ctx = await getAuthContext(req, res);
  if (!ctx) return;
  try {
    const { checkSettlementDeadlines } = await import("../services/settlementDeadlineService");
    const warnings = await checkSettlementDeadlines(ctx.orgId);
    res.json(warnings);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ====== COMPLIANCE CHECK ======

router.get("/api/compliance-check", async (req: Request, res: Response) => {
  const ctx = await getAuthContext(req, res);
  if (!ctx) return;
  try {
    const { runFullComplianceCheck } = await import("../services/legalComplianceService");
    const warnings = await runFullComplianceCheck(ctx.orgId);
    res.json({ warnings, checkedAt: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ====== READONLY API-KEY VERWALTUNG ======

/**
 * GET /api/organization/api-key/status
 * Gibt zurück ob ein Key gesetzt ist und einen maskierten Vorschau-String.
 * Der vollständige Key wird NIEMALS über diese Route zurückgegeben.
 */
router.get(
  "/api/organization/api-key/status",
  requireAdminAccess(),
  async (req: Request, res: Response) => {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: "Keine Organisation zugewiesen" });

    const rows = await db
      .select({ readonlyApiKey: schema.organizations.readonlyApiKey })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, ctx.orgId))
      .limit(1);

    const key = rows[0]?.readonlyApiKey ?? null;
    if (!key) {
      return res.json({ hasKey: false, maskedKey: null });
    }
    // Show first 8 chars + mask + last 4 chars
    const maskedKey = key.length > 12
      ? `${key.slice(0, 8)}••••••••${key.slice(-4)}`
      : '••••••••';
    return res.json({ hasKey: true, maskedKey });
  }
);

/**
 * POST /api/organization/api-key/generate
 * Erzeugt einen kryptographisch zufälligen UUID-Key, speichert ihn und gibt ihn
 * EINMALIG im Klartext zurück. Nachfolgende Anfragen erhalten nur die maskierte Version.
 *
 * Reihenfolge (audit-before-write):
 *   1. HMAC-Audit-Eintrag schreiben (createAuditLogStrict).
 *   2. Nur bei Erfolg: Org-Update in der DB.
 *   Wenn Schritt 1 fehlschlägt → kein Key gespeichert, 5xx an Client.
 *   Wenn Schritt 2 fehlschlägt → Audit-Eintrag existiert (Over-Audit), 5xx an Client.
 *   In beiden Fällen bleibt die vorherige Key-Situation konsistent oder über-protokolliert.
 */
router.post(
  "/api/organization/api-key/generate",
  requireAdminAccess(),
  _apiKeyManagementLimiter,
  async (req: Request, res: Response) => {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: "Keine Organisation zugewiesen" });

    const { randomUUID } = await import("crypto");
    const { createAuditLogStrict, getClientInfo } = await import("../lib/auditLog");

    const newKey = randomUUID();
    const { ipAddress, userAgent } = getClientInfo(req);

    // Schritt 1: Audit-Eintrag ZUERST — wirft bei Fehler, DB bleibt unverändert.
    await createAuditLogStrict({
      tableName: "organizations",
      recordId: ctx.orgId,
      action: "update",
      userId: ctx.userId,
      ipAddress,
      userAgent,
      oldData: { readonlyApiKey: "[REDACTED]" },
      newData: { readonlyApiKey: "[GENERATED — NOT LOGGED]" },
      details: { event: "api_key_generated", orgId: ctx.orgId },
    });

    // Schritt 2: Key erst nach erfolgreichem Audit speichern.
    await db
      .update(schema.organizations)
      .set({ readonlyApiKey: newKey })
      .where(eq(schema.organizations.id, ctx.orgId));

    return res.json({ apiKey: newKey });
  }
);

/**
 * DELETE /api/organization/api-key
 * Widerruft den Key sofort (setzt readonlyApiKey auf NULL).
 * Alle laufenden Anfragen mit dem alten Key werden ab sofort abgewiesen.
 *
 * Reihenfolge (audit-before-write): identisch zu generate.
 */
router.delete(
  "/api/organization/api-key",
  requireAdminAccess(),
  _apiKeyManagementLimiter,
  async (req: Request, res: Response) => {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: "Keine Organisation zugewiesen" });

    const { createAuditLogStrict, getClientInfo } = await import("../lib/auditLog");
    const { ipAddress, userAgent } = getClientInfo(req);

    // Schritt 1: Audit-Eintrag ZUERST.
    await createAuditLogStrict({
      tableName: "organizations",
      recordId: ctx.orgId,
      action: "update",
      userId: ctx.userId,
      ipAddress,
      userAgent,
      oldData: { readonlyApiKey: "[REDACTED]" },
      newData: { readonlyApiKey: null },
      details: { event: "api_key_revoked", orgId: ctx.orgId },
    });

    // Schritt 2: Key erst nach erfolgreichem Audit löschen.
    await db
      .update(schema.organizations)
      .set({ readonlyApiKey: null })
      .where(eq(schema.organizations.id, ctx.orgId));

    return res.json({ ok: true });
  }
);

// ====== AUDIT CHAIN VERIFY ======

router.get("/api/audit-chain/verify", async (req: Request, res: Response) => {
  const ctx = await getAuthContext(req, res);
  if (!ctx) return;
  try {
    const { verifyAuditChain } = await import("../services/auditHashService");
    const result = await verifyAuditChain(ctx.orgId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * SECURITY PUNKT 6b: HMAC-Integritätsprüfung für die zentrale audit_logs-Kette.
 *
 * Prüft alle Einträge die per advisory-Lock und HMAC v5 gesichert wurden
 * (OCR-Korrekturen, CRUD-Aktionen, …) auf Vollständigkeit und Korrektheit.
 * Erkennt via Anker-Tabelle auch gelöschte Zeilen am Anfang oder Ende der Kette.
 *
 * Zugriff: nur Benutzer mit der Rolle "admin" (requireAdminAccess).
 * Tenant-seitige Nutzer erhalten 403 — globale Diagnosedaten werden nicht
 * gegenüber normalen Org-Nutzern exponiert.
 *
 * GET /api/audit-chain/verify-hmac
 * Response: { ok: boolean, message: string, firstBadId?: string, details?: string }
 */
router.get("/api/audit-chain/verify-hmac",
  requireAdminAccess(),
  async (req: Request, res: Response) => {
    try {
      const { verifyAuditChain } = await import("../lib/auditLog");
      const result = await verifyAuditChain();
      if (result.ok) {
        res.json({ ok: true, message: "HMAC-Kette ist integer" });
      } else {
        // Return 200 (the check ran fine) but signal the integrity failure in the body.
        // This lets monitoring clients distinguish "server error" from "tamper detected".
        res.json({
          ok: false,
          message: "Integritätsprüfung fehlgeschlagen — Manipulation möglicherweise erkannt",
          firstBadId: result.firstBadId,
          details: result.details,
        });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
