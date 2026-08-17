import { Router, Request, Response } from "express";
import { db } from "../db";
import { eq, and, isNull, desc, sql, inArray } from "drizzle-orm";
import * as schema from "@shared/schema";
import { apiKeyAuth } from "../middleware/apiKey";
import { rlsMiddleware } from "../middleware/rlsMiddleware";
import { decryptIbanRows, decryptIbanFields } from "../lib/fieldEncryption";

const router = Router();

// apiKeyAuth liest den API-Key, ermittelt die Organisation und setzt
// req.authorizedOrgId. (Kein Session-Cookie für API-Key-Clients.)
router.use(apiKeyAuth);

// Bridge: req.authorizedOrgId → req.session.organizationId, damit
// rlsMiddleware (das session-basiert liest) den org-Kontext setzen kann.
router.use((req, _res, next) => {
  const orgId = (req as any).authorizedOrgId as string | undefined;
  if (orgId) {
    if (!req.session) (req as any).session = {};
    (req.session as any).organizationId = orgId;
  }
  next();
});

// rlsMiddleware liest req.session.organizationId und baut den orgContext
// auf (SET ROLE immo_app + app.current_org), damit alle route-Handler
// den `db`-Proxy verwenden können ohne den Superuser-Pool anzugreifen.
router.use(rlsMiddleware);

function parsePagination(req: Request) {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function requireOrgId(req: Request, res: Response): string | null {
  const orgId = req.query.organization_id as string;
  if (!orgId) {
    res.status(400).json({ error: "organization_id query parameter is required" });
    return null;
  }
  // Sicherheits-Check: Die Middleware hat die autorisierte Org gesetzt.
  // Wenn sie gesetzt ist, muss die angefragte org_id übereinstimmen.
  const authorizedOrgId = (req as any).authorizedOrgId as string | undefined;
  if (authorizedOrgId && authorizedOrgId !== orgId) {
    res.status(403).json({ error: "Zugriff verweigert: organization_id stimmt nicht mit dem API-Key überein" });
    return null;
  }
  return orgId;
}

async function getPropertyIdsForOrg(orgId: string): Promise<string[]> {
  const props = await db.select({ id: schema.properties.id })
    .from(schema.properties)
    .where(and(eq(schema.properties.organizationId, orgId), isNull(schema.properties.deletedAt)));
  return props.map(p => p.id);
}

async function getUnitIdsForOrg(orgId: string): Promise<string[]> {
  const propertyIds = await getPropertyIdsForOrg(orgId);
  if (!propertyIds.length) return [];
  const unitRows = await db.select({ id: schema.units.id })
    .from(schema.units)
    .where(and(inArray(schema.units.propertyId, propertyIds), isNull(schema.units.deletedAt)));
  return unitRows.map(u => u.id);
}

router.get("/properties", async (req: Request, res: Response) => {
  try {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;
    const { limit, offset, page } = parsePagination(req);

    const whereClause = and(eq(schema.properties.organizationId, orgId), isNull(schema.properties.deletedAt));

    const properties = await db.select().from(schema.properties)
      .where(whereClause)
      .limit(limit).offset(offset);
    const countResult = await db.select({ count: sql<number>`count(*)` })
      .from(schema.properties).where(whereClause);
    
    res.json({
      data: properties,
      pagination: { page, limit, total: Number(countResult[0]?.count || 0) }
    });
  } catch (error) {
    console.error("Readonly properties error:", error);
    res.status(500).json({ error: "Failed to fetch properties" });
  }
});

router.get("/properties/:id", async (req: Request, res: Response) => {
  try {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;

    const property = await db.select().from(schema.properties)
      .where(and(
        eq(schema.properties.id, req.params.id),
        eq(schema.properties.organizationId, orgId),
        isNull(schema.properties.deletedAt)
      ))
      .limit(1);
    
    if (!property.length) {
      return res.status(404).json({ error: "Property not found" });
    }
    res.json({ data: property[0] });
  } catch (error) {
    console.error("Readonly property error:", error);
    res.status(500).json({ error: "Failed to fetch property" });
  }
});

router.get("/units", async (req: Request, res: Response) => {
  try {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;
    const { limit, offset, page } = parsePagination(req);
    const propertyId = req.query.property_id as string;

    // Sicherheits-Fix: property_id muss zur authorisierten Org gehören.
    // Fremde property_ids werden stillschweigend als leere Liste behandelt.
    const orgPropertyIds = await getPropertyIdsForOrg(orgId);
    const propertyIds = propertyId
      ? (orgPropertyIds.includes(propertyId) ? [propertyId] : [])
      : orgPropertyIds;
    if (!propertyIds.length) {
      return res.json({ data: [], pagination: { page, limit, total: 0 } });
    }

    const whereClause = and(inArray(schema.units.propertyId, propertyIds), isNull(schema.units.deletedAt));

    const units = await db.select().from(schema.units).where(whereClause).limit(limit).offset(offset);
    const countResult = await db.select({ count: sql<number>`count(*)` }).from(schema.units).where(whereClause);
    
    res.json({
      data: units,
      pagination: { page, limit, total: Number(countResult[0]?.count || 0) }
    });
  } catch (error) {
    console.error("Readonly units error:", error);
    res.status(500).json({ error: "Failed to fetch units" });
  }
});

router.get("/units/:id", async (req: Request, res: Response) => {
  try {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;

    const propertyIds = await getPropertyIdsForOrg(orgId);
    if (!propertyIds.length) {
      return res.status(404).json({ error: "Unit not found" });
    }

    const unit = await db.select().from(schema.units)
      .where(and(
        eq(schema.units.id, req.params.id),
        inArray(schema.units.propertyId, propertyIds),
        isNull(schema.units.deletedAt)
      ))
      .limit(1);
    
    if (!unit.length) {
      return res.status(404).json({ error: "Unit not found" });
    }
    res.json({ data: unit[0] });
  } catch (error) {
    console.error("Readonly unit error:", error);
    res.status(500).json({ error: "Failed to fetch unit" });
  }
});

router.get("/tenants", async (req: Request, res: Response) => {
  try {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;
    const { limit, offset, page } = parsePagination(req);

    const unitIds = await getUnitIdsForOrg(orgId);
    if (!unitIds.length) {
      return res.json({ data: [], pagination: { page, limit, total: 0 } });
    }

    const unitId = req.query.unit_id as string;
    const filteredUnitIds = unitId ? (unitIds.includes(unitId) ? [unitId] : []) : unitIds;
    if (!filteredUnitIds.length) {
      return res.json({ data: [], pagination: { page, limit, total: 0 } });
    }

    const whereClause = and(inArray(schema.tenants.unitId, filteredUnitIds), isNull(schema.tenants.deletedAt));

    const tenants = await db.select().from(schema.tenants).where(whereClause).limit(limit).offset(offset);
    const countResult = await db.select({ count: sql<number>`count(*)` }).from(schema.tenants).where(whereClause);
    
    res.json({
      data: decryptIbanRows(tenants),
      pagination: { page, limit, total: Number(countResult[0]?.count || 0) }
    });
  } catch (error) {
    console.error("Readonly tenants error:", error);
    res.status(500).json({ error: "Failed to fetch tenants" });
  }
});

router.get("/tenants/:id", async (req: Request, res: Response) => {
  try {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;

    const unitIds = await getUnitIdsForOrg(orgId);
    if (!unitIds.length) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const tenant = await db.select().from(schema.tenants)
      .where(and(
        eq(schema.tenants.id, req.params.id),
        inArray(schema.tenants.unitId, unitIds),
        isNull(schema.tenants.deletedAt)
      ))
      .limit(1);
    
    if (!tenant.length) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    res.json({ data: decryptIbanFields(tenant[0]) });
  } catch (error) {
    console.error("Readonly tenant error:", error);
    res.status(500).json({ error: "Failed to fetch tenant" });
  }
});

router.get("/invoices", async (req: Request, res: Response) => {
  try {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;
    const { limit, offset, page } = parsePagination(req);

    const unitIds = await getUnitIdsForOrg(orgId);
    if (!unitIds.length) {
      return res.json({ data: [], pagination: { page, limit, total: 0 } });
    }

    const tenantId = req.query.tenant_id as string;
    const year = req.query.year as string;
    const month = req.query.month as string;

    const conditions: any[] = [inArray(schema.monthlyInvoices.unitId, unitIds)];
    if (tenantId) {
      // Whitelist-Guard analog zu /payments: tenant_id muss zur autorisierten
      // Org gehören. Fremde tenant_ids → leere Liste (kein Datenleck-Pfad,
      // auch falls der unitId-Filter oben je entfernt würde).
      const tenantRows = await db.select({ id: schema.tenants.id })
        .from(schema.tenants)
        .where(and(eq(schema.tenants.id, tenantId), inArray(schema.tenants.unitId, unitIds)));
      if (!tenantRows.length) {
        return res.json({ data: [], pagination: { page, limit, total: 0 } });
      }
      conditions.push(eq(schema.monthlyInvoices.tenantId, tenantId));
    }
    if (year) conditions.push(eq(schema.monthlyInvoices.year, parseInt(year)));
    if (month) conditions.push(eq(schema.monthlyInvoices.month, parseInt(month)));

    const whereClause = and(...conditions);

    const invoices = await db.select().from(schema.monthlyInvoices)
      .where(whereClause)
      .orderBy(desc(schema.monthlyInvoices.year), desc(schema.monthlyInvoices.month))
      .limit(limit).offset(offset);

    const countResult = await db.select({ count: sql<number>`count(*)` })
      .from(schema.monthlyInvoices).where(whereClause);
    
    res.json({
      data: invoices,
      pagination: { page, limit, total: Number(countResult[0]?.count || 0) }
    });
  } catch (error) {
    console.error("Readonly invoices error:", error);
    res.status(500).json({ error: "Failed to fetch invoices" });
  }
});

router.get("/invoices/:id", async (req: Request, res: Response) => {
  try {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;

    const unitIds = await getUnitIdsForOrg(orgId);
    if (!unitIds.length) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const invoice = await db.select().from(schema.monthlyInvoices)
      .where(and(
        eq(schema.monthlyInvoices.id, req.params.id),
        inArray(schema.monthlyInvoices.unitId, unitIds)
      ))
      .limit(1);
    
    if (!invoice.length) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const lines = await db.select().from(schema.invoiceLines)
      .where(eq(schema.invoiceLines.invoiceId, req.params.id));

    res.json({ data: { ...invoice[0], lines } });
  } catch (error) {
    console.error("Readonly invoice error:", error);
    res.status(500).json({ error: "Failed to fetch invoice" });
  }
});

router.get("/payments", async (req: Request, res: Response) => {
  try {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;
    const { limit, offset, page } = parsePagination(req);

    const unitIds = await getUnitIdsForOrg(orgId);
    if (!unitIds.length) {
      return res.json({ data: [], pagination: { page, limit, total: 0 } });
    }

    const tenantRows = await db.select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(inArray(schema.tenants.unitId, unitIds));
    const tenantIds = tenantRows.map(t => t.id);
    if (!tenantIds.length) {
      return res.json({ data: [], pagination: { page, limit, total: 0 } });
    }

    const tenantId = req.query.tenant_id as string;
    const filteredTenantIds = tenantId ? (tenantIds.includes(tenantId) ? [tenantId] : []) : tenantIds;
    if (!filteredTenantIds.length) {
      return res.json({ data: [], pagination: { page, limit, total: 0 } });
    }

    const whereClause = inArray(schema.payments.tenantId, filteredTenantIds);

    const payments = await db.select().from(schema.payments)
      .where(whereClause)
      .orderBy(desc(schema.payments.buchungsDatum))
      .limit(limit).offset(offset);

    const countResult = await db.select({ count: sql<number>`count(*)` })
      .from(schema.payments).where(whereClause);
    
    res.json({
      data: payments,
      pagination: { page, limit, total: Number(countResult[0]?.count || 0) }
    });
  } catch (error) {
    console.error("Readonly payments error:", error);
    res.status(500).json({ error: "Failed to fetch payments" });
  }
});

router.get("/expenses", async (req: Request, res: Response) => {
  try {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;
    const { limit, offset, page } = parsePagination(req);

    const propertyIds = await getPropertyIdsForOrg(orgId);
    if (!propertyIds.length) {
      return res.json({ data: [], pagination: { page, limit, total: 0 } });
    }

    const propertyId = req.query.property_id as string;
    const filteredIds = propertyId ? (propertyIds.includes(propertyId) ? [propertyId] : []) : propertyIds;
    if (!filteredIds.length) {
      return res.json({ data: [], pagination: { page, limit, total: 0 } });
    }

    const whereClause = inArray(schema.expenses.propertyId, filteredIds);

    const expenses = await db.select().from(schema.expenses)
      .where(whereClause)
      .orderBy(desc(schema.expenses.datum))
      .limit(limit).offset(offset);

    const countResult = await db.select({ count: sql<number>`count(*)` })
      .from(schema.expenses).where(whereClause);
    
    res.json({
      data: expenses,
      pagination: { page, limit, total: Number(countResult[0]?.count || 0) }
    });
  } catch (error) {
    console.error("Readonly expenses error:", error);
    res.status(500).json({ error: "Failed to fetch expenses" });
  }
});

router.get("/bank-accounts", async (req: Request, res: Response) => {
  try {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;
    const { limit, offset, page } = parsePagination(req);

    const propertyIds = await getPropertyIdsForOrg(orgId);
    if (!propertyIds.length) {
      return res.json({ data: [], pagination: { page, limit, total: 0 } });
    }

    const propertyId = req.query.property_id as string;
    const filteredIds = propertyId ? (propertyIds.includes(propertyId) ? [propertyId] : []) : propertyIds;
    if (!filteredIds.length) {
      return res.json({ data: [], pagination: { page, limit, total: 0 } });
    }

    const whereClause = inArray(schema.bankAccounts.propertyId, filteredIds);

    const rawAccounts = await db.select().from(schema.bankAccounts)
      .where(whereClause)
      .limit(limit).offset(offset);
    const accounts = decryptIbanRows(rawAccounts);

    const countResult = await db.select({ count: sql<number>`count(*)` })
      .from(schema.bankAccounts).where(whereClause);
    
    res.json({
      data: accounts,
      pagination: { page, limit, total: Number(countResult[0]?.count || 0) }
    });
  } catch (error) {
    console.error("Readonly bank-accounts error:", error);
    res.status(500).json({ error: "Failed to fetch bank accounts" });
  }
});

export default router;
