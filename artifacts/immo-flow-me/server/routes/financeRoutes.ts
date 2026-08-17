import { Router, Request, Response } from "express";
import { db } from "../db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import * as schema from "@shared/schema";
import { getAuthContext, checkMutationPermission, objectToSnakeCase, objectToCamelCase } from "./helpers";
import { validateMoneyFields } from "../lib/money";

const OWNER_PAYOUT_MONEY_FIELDS = {
  totalIncome: "total_income",
  totalExpenses: "total_expenses",
  managementFee: "management_fee",
  netPayout: "net_payout",
} as const;
import { VPI_ADVISORY_LOCK_ID } from "./vpiRoutes";

const router = Router();

// ====== HEATING COST READINGS ======

router.get("/api/heating-cost-readings", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const propertyId = req.query.propertyId as string;
    let conditions: any[] = [eq(schema.heatingCostReadings.organizationId, ctx.orgId)];
    if (propertyId) conditions.push(eq(schema.heatingCostReadings.propertyId, propertyId));
    const where = conditions.length > 1 ? and(...conditions) : conditions[0];
    const data = await db.select().from(schema.heatingCostReadings).where(where).orderBy(desc(schema.heatingCostReadings.periodFrom));
    res.json(objectToSnakeCase(data));
  } catch (error) {
    console.error("Error fetching heating cost readings:", error);
    res.status(500).json({ error: "Fehler beim Laden" });
  }
});

router.post("/api/heating-cost-readings", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    if (Array.isArray(req.body)) {
      const values = req.body.map((r: any) => ({ ...objectToCamelCase(r), organizationId: ctx.orgId }));
      const created = await db.insert(schema.heatingCostReadings).values(values).returning();
      return res.json(objectToSnakeCase(created));
    }
    const body = objectToCamelCase(req.body);
    const [created] = await db.insert(schema.heatingCostReadings).values({ ...body, organizationId: ctx.orgId }).returning();
    res.json(objectToSnakeCase(created));
  } catch (error) {
    console.error("Error creating heating cost reading:", error);
    res.status(500).json({ error: "Fehler beim Erstellen" });
  }
});

router.patch("/api/heating-cost-readings/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const body = objectToCamelCase(req.body);
    const [updated] = await db.update(schema.heatingCostReadings).set({ ...body, updatedAt: new Date() }).where(and(eq(schema.heatingCostReadings.id, req.params.id), eq(schema.heatingCostReadings.organizationId, ctx.orgId))).returning();
    if (!updated) return res.status(404).json({ error: "Nicht gefunden" });
    res.json(objectToSnakeCase(updated));
  } catch (error) {
    console.error("Error updating heating cost reading:", error);
    res.status(500).json({ error: "Fehler beim Aktualisieren" });
  }
});

router.delete("/api/heating-cost-readings/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    await db.delete(schema.heatingCostReadings).where(and(eq(schema.heatingCostReadings.id, req.params.id), eq(schema.heatingCostReadings.organizationId, ctx.orgId)));
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting heating cost reading:", error);
    res.status(500).json({ error: "Fehler beim Löschen" });
  }
});

// ====== OWNER PAYOUTS ======

router.get("/api/owner-payouts", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const propertyId = req.query.propertyId as string;
    let conditions: any[] = [eq(schema.ownerPayouts.organizationId, ctx.orgId)];
    if (propertyId) conditions.push(eq(schema.ownerPayouts.propertyId, propertyId));
    const where = conditions.length > 1 ? and(...conditions) : conditions[0];
    const data = await db.select().from(schema.ownerPayouts).where(where).orderBy(desc(schema.ownerPayouts.createdAt));
    res.json(objectToSnakeCase(data));
  } catch (error) {
    console.error("Error fetching owner payouts:", error);
    res.status(500).json({ error: "Fehler beim Laden" });
  }
});

router.post("/api/owner-payouts", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const body = objectToCamelCase(req.body);
    const moneyError = validateMoneyFields(body, OWNER_PAYOUT_MONEY_FIELDS);
    if (moneyError) return res.status(400).json({ error: moneyError });
    const [created] = await db.insert(schema.ownerPayouts).values({ ...body, organizationId: ctx.orgId }).returning();
    res.json(objectToSnakeCase(created));
  } catch (error) {
    console.error("Error creating owner payout:", error);
    res.status(500).json({ error: "Fehler beim Erstellen" });
  }
});

router.patch("/api/owner-payouts/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const body = objectToCamelCase(req.body);
    const moneyError = validateMoneyFields(body, OWNER_PAYOUT_MONEY_FIELDS);
    if (moneyError) return res.status(400).json({ error: moneyError });
    const [updated] = await db.update(schema.ownerPayouts).set({ ...body, updatedAt: new Date() }).where(and(eq(schema.ownerPayouts.id, req.params.id), eq(schema.ownerPayouts.organizationId, ctx.orgId))).returning();
    if (!updated) return res.status(404).json({ error: "Nicht gefunden" });
    res.json(objectToSnakeCase(updated));
  } catch (error) {
    console.error("Error updating owner payout:", error);
    res.status(500).json({ error: "Fehler beim Aktualisieren" });
  }
});

router.delete("/api/owner-payouts/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    await db.delete(schema.ownerPayouts).where(and(eq(schema.ownerPayouts.id, req.params.id), eq(schema.ownerPayouts.organizationId, ctx.orgId)));
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting owner payout:", error);
    res.status(500).json({ error: "Fehler beim Löschen" });
  }
});

// ====== SEPA COLLECTIONS ======

router.get("/api/sepa-collections", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const data = await db.select().from(schema.sepaCollections).where(eq(schema.sepaCollections.organizationId, ctx.orgId)).orderBy(desc(schema.sepaCollections.createdAt));
    res.json(objectToSnakeCase(data));
  } catch (error) {
    console.error("Error fetching SEPA collections:", error);
    res.status(500).json({ error: "Fehler beim Laden der SEPA-Einzüge" });
  }
});

router.get("/api/sepa-collections/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const data = await db.select().from(schema.sepaCollections).where(and(eq(schema.sepaCollections.id, req.params.id), eq(schema.sepaCollections.organizationId, ctx.orgId))).limit(1);
    if (!data.length) return res.status(404).json({ error: "Nicht gefunden" });
    res.json(objectToSnakeCase(data[0]));
  } catch (error) {
    console.error("Error fetching SEPA collection:", error);
    res.status(500).json({ error: "Fehler beim Laden des SEPA-Einzugs" });
  }
});

router.post("/api/sepa-collections", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const body = objectToCamelCase(req.body);
    // sepa_collections.total_amount ist numeric(10,2) → max. 8 Vorkommastellen
    const moneyError = validateMoneyFields(body, { totalAmount: "total_amount" }, 8);
    if (moneyError) return res.status(400).json({ error: moneyError });
    const [created] = await db.insert(schema.sepaCollections).values({ ...body, organizationId: ctx.orgId, createdBy: ctx.userId }).returning();
    res.json(objectToSnakeCase(created));
  } catch (error) {
    console.error("Error creating SEPA collection:", error);
    res.status(500).json({ error: "Fehler beim Erstellen des SEPA-Einzugs" });
  }
});

router.patch("/api/sepa-collections/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const body = objectToCamelCase(req.body);
    const [updated] = await db.update(schema.sepaCollections).set({ status: body.status }).where(and(eq(schema.sepaCollections.id, req.params.id), eq(schema.sepaCollections.organizationId, ctx.orgId))).returning();
    if (!updated) return res.status(404).json({ error: "Nicht gefunden" });
    res.json(objectToSnakeCase(updated));
  } catch (error) {
    console.error("Error updating SEPA collection:", error);
    res.status(500).json({ error: "Fehler beim Aktualisieren des SEPA-Einzugs" });
  }
});

router.post("/api/sepa-collections/:id/mark-all-successful", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const [updated] = await db.update(schema.sepaCollections).set({ status: 'completed' }).where(and(eq(schema.sepaCollections.id, req.params.id), eq(schema.sepaCollections.organizationId, ctx.orgId))).returning();
    if (!updated) return res.status(404).json({ error: "Nicht gefunden" });
    res.json(objectToSnakeCase(updated));
  } catch (error) {
    console.error("Error marking SEPA collection as successful:", error);
    res.status(500).json({ error: "Fehler beim Markieren des SEPA-Einzugs als erfolgreich" });
  }
});

router.delete("/api/sepa-collections/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const [deleted] = await db.delete(schema.sepaCollections).where(and(eq(schema.sepaCollections.id, req.params.id), eq(schema.sepaCollections.organizationId, ctx.orgId))).returning();
    if (!deleted) return res.status(404).json({ error: "Nicht gefunden" });
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting SEPA collection:", error);
    res.status(500).json({ error: "Fehler beim Löschen des SEPA-Einzugs" });
  }
});

// ====== PROPERTY OWNERS ======

router.get("/api/property-owners", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const propertyId = req.query.property_id as string;
    let conditions: any[] = [eq(schema.properties.organizationId, ctx.orgId)];
    if (propertyId) conditions.push(eq(schema.propertyOwners.propertyId, propertyId));
    const where = conditions.length > 1 ? and(...conditions) : conditions[0];
    const data = await db
      .select({ propertyOwners: schema.propertyOwners })
      .from(schema.propertyOwners)
      .innerJoin(schema.properties, eq(schema.propertyOwners.propertyId, schema.properties.id))
      .where(where)
      .orderBy(desc(schema.propertyOwners.createdAt));
    res.json(objectToSnakeCase(data.map(d => d.propertyOwners)));
  } catch (error) {
    console.error("Error fetching property owners:", error);
    res.status(500).json({ error: "Fehler beim Laden der Eigentümerzuordnungen" });
  }
});

router.get("/api/property-owners/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const data = await db
      .select({ propertyOwners: schema.propertyOwners })
      .from(schema.propertyOwners)
      .innerJoin(schema.properties, eq(schema.propertyOwners.propertyId, schema.properties.id))
      .where(and(eq(schema.propertyOwners.id, req.params.id), eq(schema.properties.organizationId, ctx.orgId)))
      .limit(1);
    if (!data.length) return res.status(404).json({ error: "Nicht gefunden" });
    res.json(objectToSnakeCase(data[0].propertyOwners));
  } catch (error) {
    console.error("Error fetching property owner:", error);
    res.status(500).json({ error: "Fehler beim Laden der Eigentümerzuordnung" });
  }
});

router.post("/api/property-owners", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const body = objectToCamelCase(req.body);
    const parsed = schema.insertPropertyOwnerSchema.parse(body);
    const property = await db.select().from(schema.properties).where(and(eq(schema.properties.id, parsed.propertyId), eq(schema.properties.organizationId, ctx.orgId))).limit(1);
    if (!property.length) return res.status(404).json({ error: "Liegenschaft nicht gefunden" });
    const [created] = await db.insert(schema.propertyOwners).values(parsed).returning();
    res.json(objectToSnakeCase(created));
  } catch (error) {
    console.error("Error creating property owner:", error);
    res.status(500).json({ error: "Fehler beim Erstellen der Eigentümerzuordnung" });
  }
});

router.patch("/api/property-owners/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const body = objectToCamelCase(req.body);
    const existing = await db
      .select({ propertyOwners: schema.propertyOwners })
      .from(schema.propertyOwners)
      .innerJoin(schema.properties, eq(schema.propertyOwners.propertyId, schema.properties.id))
      .where(and(eq(schema.propertyOwners.id, req.params.id), eq(schema.properties.organizationId, ctx.orgId)))
      .limit(1);
    if (!existing.length) return res.status(404).json({ error: "Nicht gefunden" });
    const updateData: any = {};
    if (body.ownershipShare !== undefined) updateData.ownershipShare = body.ownershipShare;
    if (body.validFrom !== undefined) updateData.validFrom = body.validFrom;
    if (body.validTo !== undefined) updateData.validTo = body.validTo;
    if (body.notes !== undefined) updateData.notes = body.notes;
    const [updated] = await db.update(schema.propertyOwners).set(updateData).where(and(
      eq(schema.propertyOwners.id, req.params.id),
      inArray(schema.propertyOwners.propertyId,
        db.select({ id: schema.properties.id }).from(schema.properties)
          .where(eq(schema.properties.organizationId, ctx.orgId)))
    )).returning();
    res.json(objectToSnakeCase(updated));
  } catch (error) {
    console.error("Error updating property owner:", error);
    res.status(500).json({ error: "Fehler beim Aktualisieren der Eigentümerzuordnung" });
  }
});

router.delete("/api/property-owners/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const existing = await db
      .select({ propertyOwners: schema.propertyOwners })
      .from(schema.propertyOwners)
      .innerJoin(schema.properties, eq(schema.propertyOwners.propertyId, schema.properties.id))
      .where(and(eq(schema.propertyOwners.id, req.params.id), eq(schema.properties.organizationId, ctx.orgId)))
      .limit(1);
    if (!existing.length) return res.status(404).json({ error: "Nicht gefunden" });
    await db.delete(schema.propertyOwners).where(and(
      eq(schema.propertyOwners.id, req.params.id),
      inArray(schema.propertyOwners.propertyId,
        db.select({ id: schema.properties.id }).from(schema.properties)
          .where(eq(schema.properties.organizationId, ctx.orgId)))
    ));
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting property owner:", error);
    res.status(500).json({ error: "Fehler beim Löschen der Eigentümerzuordnung" });
  }
});

// ====== VPI ADJUSTMENTS ======

router.get("/api/vpi-adjustments", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const data = await db
      .select({ vpiAdjustments: schema.vpiAdjustments })
      .from(schema.vpiAdjustments)
      .innerJoin(schema.tenants, eq(schema.vpiAdjustments.tenantId, schema.tenants.id))
      .innerJoin(schema.units, eq(schema.tenants.unitId, schema.units.id))
      .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
      .where(eq(schema.properties.organizationId, ctx.orgId))
      .orderBy(desc(schema.vpiAdjustments.adjustmentDate));
    res.json(objectToSnakeCase(data.map(d => d.vpiAdjustments)));
  } catch (error) {
    console.error("Error fetching VPI adjustments:", error);
    res.status(500).json({ error: "Fehler beim Laden der VPI-Anpassungen" });
  }
});

router.get("/api/vpi-adjustments/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const data = await db
      .select({ vpiAdjustments: schema.vpiAdjustments })
      .from(schema.vpiAdjustments)
      .innerJoin(schema.tenants, eq(schema.vpiAdjustments.tenantId, schema.tenants.id))
      .innerJoin(schema.units, eq(schema.tenants.unitId, schema.units.id))
      .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
      .where(and(eq(schema.vpiAdjustments.id, req.params.id), eq(schema.properties.organizationId, ctx.orgId)))
      .limit(1);
    if (!data.length) return res.status(404).json({ error: "Nicht gefunden" });
    res.json(objectToSnakeCase(data[0].vpiAdjustments));
  } catch (error) {
    console.error("Error fetching VPI adjustment:", error);
    res.status(500).json({ error: "Fehler beim Laden der VPI-Anpassung" });
  }
});

// POST /api/vpi-adjustments
// Erstellt einen VPI-Anpassungsdatensatz MIT server-seitig berechneten Werten.
// Der Client darf nur tenantId und effectiveDate übermitteln; alle Rechenwerte
// (previousRent, newRent, vpiOld, vpiNew, percentageChange) werden server-seitig
// ermittelt — Client-Werte für diese Felder werden ignoriert.
router.post("/api/vpi-adjustments", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });

    const body = objectToCamelCase(req.body);
    const tenantId = body.tenantId as string | undefined;
    const effectiveDate = (body.effectiveDate as string | undefined) || new Date(new Date().setDate(1)).toISOString().split('T')[0];

    if (!tenantId) return res.status(400).json({ error: 'tenantId ist erforderlich' });

    // Mieter muss zur Organisation gehören
    const tenantRows = await db
      .select({ tenant: schema.tenants })
      .from(schema.tenants)
      .innerJoin(schema.units, eq(schema.tenants.unitId, schema.units.id))
      .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
      .where(and(eq(schema.tenants.id, tenantId), eq(schema.properties.organizationId, ctx.orgId)))
      .limit(1);
    if (!tenantRows.length) return res.status(404).json({ error: "Mieter nicht gefunden" });

    const tenant = tenantRows[0]!.tenant;
    const { vpiAutomationService } = await import('../services/vpiAutomationService');

    // VPI lesen und Anpassung einfuegen innerhalb einer Transaktion mit SHARED
    // Advisory Lock (gleiche ID wie DELETE /api/vpi/values/:id nutzt exklusiv).
    // Dadurch kann kein DELETE den Wert zwischen Lesen und INSERT entfernen.
    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${VPI_ADVISORY_LOCK_ID})`);

      // VPI NACH dem Lock lesen — der Wert kann nicht mehr durch ein
      // gleichzeitiges DELETE geloescht werden waehrend diese Tx laeuft.
      const currentVpi = await vpiAutomationService.getCurrentVpi();

      const DEFAULT_VPI_BASE = 100;
      const SCHWELLENWERT = 0.05;
      const baseVpi = Number(tenant.vpiBase) || DEFAULT_VPI_BASE;
      const currentRent = Number(tenant.grundmiete) || 0;
      const tenantSchwellenwert = tenant.vpiSchwellenwert != null ? Number(tenant.vpiSchwellenwert) : SCHWELLENWERT;
      const percentageIncrease = (currentVpi.value - baseVpi) / baseVpi;

      if (percentageIncrease < tenantSchwellenwert) {
        throw Object.assign(
          new Error(`VPI-Schwellenwert nicht erreicht: ${(percentageIncrease * 100).toFixed(2)}% < ${(tenantSchwellenwert * 100).toFixed(2)}%`),
          { status: 422 },
        );
      }

      const serverNewRent = Math.round(currentRent * (1 + percentageIncrease) * 100) / 100;
      const percentageChange = currentRent > 0 ? ((serverNewRent - currentRent) / currentRent) * 100 : 0;

      const [row] = await tx.insert(schema.vpiAdjustments).values({
        tenantId,
        adjustmentDate: effectiveDate!,
        previousRent: currentRent.toString(),
        newRent: serverNewRent.toString(),
        vpiOld: baseVpi.toString(),
        vpiNew: currentVpi.value.toString(),
        percentageChange: percentageChange.toFixed(2),
        effectiveDate: effectiveDate,
        notes: body.notes || null,
      }).returning();
      return row;
    });

    res.json(objectToSnakeCase(created));
  } catch (error: any) {
    if (error?.status === 422) {
      return res.status(422).json({ error: error.message });
    }
    console.error("Error creating VPI adjustment:", error);
    res.status(500).json({ error: "Fehler beim Erstellen der VPI-Anpassung" });
  }
});

// PATCH /api/vpi-adjustments/:id
// Erlaubt nur nicht-rechenkritische Felder: effectiveDate, notes, notificationSent, notificationDate.
// Felder wie previousRent, newRent, vpiOld, vpiNew, percentageChange sind unveränderlich
// (server-seitig beim Erstellen berechnet).
router.patch("/api/vpi-adjustments/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });

    const body = objectToCamelCase(req.body);
    const existing = await db
      .select({ vpiAdjustments: schema.vpiAdjustments })
      .from(schema.vpiAdjustments)
      .innerJoin(schema.tenants, eq(schema.vpiAdjustments.tenantId, schema.tenants.id))
      .innerJoin(schema.units, eq(schema.tenants.unitId, schema.units.id))
      .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
      .where(and(eq(schema.vpiAdjustments.id, req.params.id), eq(schema.properties.organizationId, ctx.orgId)))
      .limit(1);
    if (!existing.length) return res.status(404).json({ error: "Nicht gefunden" });

    // Whitelist: nur redaktionelle Felder, keine Rechenwerte
    const allowedPatch: Record<string, unknown> = {};
    if (body.effectiveDate !== undefined)    allowedPatch.effectiveDate    = body.effectiveDate;
    if (body.notes !== undefined)            allowedPatch.notes            = body.notes;
    if (body.notificationSent !== undefined) allowedPatch.notificationSent = body.notificationSent;
    if (body.notificationDate !== undefined) allowedPatch.notificationDate  = body.notificationDate;

    if (Object.keys(allowedPatch).length === 0) {
      return res.status(400).json({ error: 'Keine änderbaren Felder angegeben (erlaubt: effectiveDate, notes, notificationSent, notificationDate)' });
    }

    const [updated] = await db.update(schema.vpiAdjustments)
      .set(allowedPatch)
      .where(eq(schema.vpiAdjustments.id, req.params.id))
      .returning();
    res.json(objectToSnakeCase(updated));
  } catch (error) {
    console.error("Error updating VPI adjustment:", error);
    res.status(500).json({ error: "Fehler beim Aktualisieren der VPI-Anpassung" });
  }
});

// POST /api/vpi-adjustments/:id/apply
// Wendet eine berechnete VPI-Anpassung auf den Mieter an:
// - Miete (grundmiete) auf newRent setzen
// - vpiBase / lastVpiAdjustment aktualisieren
// - Mietzins-Historie schreiben
// - Benachrichtigungsstatus setzen
// Alles in einer Transaktion; nutzt die im Datensatz gespeicherten server-seitig
// berechneten Werte — keine Client-Eingaben werden für Rechenwerte herangezogen.
router.post("/api/vpi-adjustments/:id/apply", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });

    const result = await db.transaction(async (tx) => {
      // Datensatz mit Org-Prüfung + pessimistischem Lock laden
      const rows = await tx
        .select({
          adj: schema.vpiAdjustments,
          tenant: schema.tenants,
        })
        .from(schema.vpiAdjustments)
        .innerJoin(schema.tenants, eq(schema.vpiAdjustments.tenantId, schema.tenants.id))
        .innerJoin(schema.units, eq(schema.tenants.unitId, schema.units.id))
        .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
        .where(and(eq(schema.vpiAdjustments.id, req.params.id), eq(schema.properties.organizationId, ctx.orgId)))
        .for('update')
        .limit(1);

      if (!rows.length) return { status: 404, error: "Nicht gefunden" };

      const { adj, tenant } = rows[0]!;

      // Idempotenz-Guard: bereits angewendete Anpassungen ablehnen
      if (adj.appliedAt) {
        return {
          status: 409,
          error: `Diese VPI-Anpassung wurde bereits am ${adj.appliedAt.toISOString()} angewendet`,
        };
      }

      // Tenant-Zeile zusätzlich sperren damit parallele Anpassungen desselben
      // Mieters den Versionscheck nicht gleichzeitig bestehen können
      await tx.select().from(schema.tenants)
        .where(eq(schema.tenants.id, adj.tenantId))
        .for('update')
        .limit(1);

      // Versionscheck: vpiOld des Datensatzes muss mit aktuellem vpiBase des Mieters übereinstimmen
      // (nach Lock frisch aus der Transaktion lesen)
      const [lockedTenant] = await tx.select().from(schema.tenants)
        .where(eq(schema.tenants.id, adj.tenantId))
        .limit(1);
      const tenantVpiBase = Number(lockedTenant?.vpiBase) || 100;
      const adjVpiOld = Number(adj.vpiOld) || 0;
      if (Math.abs(tenantVpiBase - adjVpiOld) > 0.01) {
        return {
          status: 409,
          error: `VPI-Basis stimmt nicht überein: Anpassung basiert auf ${adjVpiOld}, Mieter hat aktuell ${tenantVpiBase}. Möglicherweise wurde bereits eine neuere Anpassung angewendet.`,
        };
      }

      const now = new Date();
      const today = now.toISOString().split('T')[0]!;
      const effectiveDate = adj.effectiveDate || adj.adjustmentDate;

      // Mietzins-Historie (Werte aus dem server-seitig berechneten Datensatz)
      await tx.insert(schema.rentHistory).values({
        tenantId: adj.tenantId,
        grundmiete: adj.newRent,
        betriebskostenVorschuss: tenant.betriebskostenVorschuss || '0',
        heizkostenVorschuss: tenant.heizkostenVorschuss || '0',
        wasserkostenVorschuss: tenant.wasserkostenVorschuss || '0',
        validFrom: effectiveDate,
        changeReason: `VPI-Anpassung: ${adj.percentageChange}%`,
      });

      // Mieter aktualisieren (server-seitig berechnete Werte aus dem Adj-Datensatz)
      await tx.update(schema.tenants)
        .set({
          grundmiete: adj.newRent,
          vpiBase: adj.vpiNew,
          lastVpiAdjustment: effectiveDate,
          updatedAt: now,
        })
        .where(eq(schema.tenants.id, adj.tenantId));

      // appliedAt setzen (Idempotenz) + Benachrichtigungsstatus
      const [updated] = await tx.update(schema.vpiAdjustments)
        .set({ appliedAt: now, notificationSent: true, notificationDate: today })
        .where(eq(schema.vpiAdjustments.id, req.params.id))
        .returning();

      return { status: 200, data: updated };
    });

    if (!result) return res.status(404).json({ error: "Nicht gefunden" });
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    res.json(objectToSnakeCase(result.data));
  } catch (error) {
    console.error("Error applying VPI adjustment:", error);
    res.status(500).json({ error: "Fehler beim Anwenden der VPI-Anpassung" });
  }
});

router.delete("/api/vpi-adjustments/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!(await checkMutationPermission(req, res))) return;
    if (!ctx.orgId) return res.status(403).json({ error: 'Keine Organisation zugewiesen' });
    const existing = await db
      .select({ vpiAdjustments: schema.vpiAdjustments })
      .from(schema.vpiAdjustments)
      .innerJoin(schema.tenants, eq(schema.vpiAdjustments.tenantId, schema.tenants.id))
      .innerJoin(schema.units, eq(schema.tenants.unitId, schema.units.id))
      .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
      .where(and(eq(schema.vpiAdjustments.id, req.params.id), eq(schema.properties.organizationId, ctx.orgId)))
      .limit(1);
    if (!existing.length) return res.status(404).json({ error: "Nicht gefunden" });
    await db.delete(schema.vpiAdjustments).where(eq(schema.vpiAdjustments.id, req.params.id));
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting VPI adjustment:", error);
    res.status(500).json({ error: "Fehler beim Löschen der VPI-Anpassung" });
  }
});

export default router;
