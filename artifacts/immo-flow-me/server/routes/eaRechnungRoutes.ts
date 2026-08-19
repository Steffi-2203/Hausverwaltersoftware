import { Router, Request, Response } from "express";
import { db } from "../db";
import { eaBookings, properties } from "@shared/schema";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { isAuthenticated, requireMutationAccess } from "./helpers";
import { parseMoneyInput } from "../lib/money";

const router = Router();

function getOrgId(req: any): string | null {
  return req.session?.organizationId || null;
}

async function validatePropertyOwnership(propertyId: string, orgId: string): Promise<boolean> {
  const result = await db.select({ id: properties.id }).from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)))
    .limit(1);
  return result.length > 0;
}

router.get("/api/ea-rechnung/bookings", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation" });

    const { year, propertyId } = req.query;

    if (propertyId && !(await validatePropertyOwnership(propertyId as string, orgId))) {
      return res.status(403).json({ error: "Kein Zugriff auf diese Liegenschaft" });
    }

    const conditions: any[] = [eq(eaBookings.organizationId, orgId)];

    if (year) {
      const y = Number(year);
      conditions.push(gte(eaBookings.date, `${y}-01-01`));
      conditions.push(lte(eaBookings.date, `${y}-12-31`));
    }

    if (propertyId) {
      conditions.push(eq(eaBookings.propertyId, propertyId as string));
    }

    const bookings = await db.select().from(eaBookings)
      .where(and(...conditions))
      .orderBy(desc(eaBookings.date));

    res.json(bookings);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/ea-rechnung/bookings", isAuthenticated, requireMutationAccess(), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation" });

    const body = req.body;

    if (body.propertyId && !(await validatePropertyOwnership(body.propertyId, orgId))) {
      return res.status(403).json({ error: "Kein Zugriff auf diese Liegenschaft" });
    }

    // ea_bookings.amount/net_amount/tax_amount sind numeric(10,2) → max. 8
    // Vorkommastellen. Auch die abgeleiteten Werte werden vor dem Insert
    // normalisiert, damit kein Postgres-Range-Fehler als 500 durchkommt.
    const parsedAmount = parseMoneyInput(body.amount, "amount", 8);
    if ("error" in parsedAmount) return res.status(400).json({ error: parsedAmount.error });

    const parsedTaxRate = parseMoneyInput(body.taxRate ?? 20, "taxRate", 3);
    if ("error" in parsedTaxRate) return res.status(400).json({ error: parsedTaxRate.error });

    const grossAmount = Number(parsedAmount.value);
    const taxRate = Number(parsedTaxRate.value);
    if (taxRate < 0 || taxRate > 100) {
      return res.status(400).json({ error: "taxRate muss zwischen 0 und 100 liegen" });
    }

    const netAmount = grossAmount / (1 + taxRate / 100);
    const taxAmount = grossAmount - netAmount;
    const parsedNetAmount = parseMoneyInput(netAmount, "netAmount", 8);
    if ("error" in parsedNetAmount) return res.status(400).json({ error: parsedNetAmount.error });
    const parsedTaxAmount = parseMoneyInput(taxAmount, "taxAmount", 8);
    if ("error" in parsedTaxAmount) return res.status(400).json({ error: parsedTaxAmount.error });

    const [booking] = await db.insert(eaBookings).values({
      organizationId: orgId,
      propertyId: body.propertyId || null,
      type: body.type,
      date: body.date,
      amount: parsedAmount.value,
      description: body.description,
      category: body.category,
      taxRate: parsedTaxRate.value,
      netAmount: parsedNetAmount.value,
      taxAmount: parsedTaxAmount.value,
      documentRef: body.documentRef || null,
      belegNummer: body.belegNummer || null,
    }).returning();

    res.json(booking);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/api/ea-rechnung/bookings/:id", isAuthenticated, requireMutationAccess(), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation" });

    const [deleted] = await db.delete(eaBookings)
      .where(and(
        eq(eaBookings.id, Number(req.params.id)),
        eq(eaBookings.organizationId, orgId)
      ))
      .returning();

    if (!deleted) return res.status(404).json({ error: "Buchung nicht gefunden" });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/ea-rechnung/summary", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation" });

    const { year, propertyId } = req.query;

    if (propertyId && !(await validatePropertyOwnership(propertyId as string, orgId))) {
      return res.status(403).json({ error: "Kein Zugriff auf diese Liegenschaft" });
    }

    const y = Number(year) || new Date().getFullYear();
    const conditions: any[] = [
      eq(eaBookings.organizationId, orgId),
      gte(eaBookings.date, `${y}-01-01`),
      lte(eaBookings.date, `${y}-12-31`),
    ];

    if (propertyId) {
      conditions.push(eq(eaBookings.propertyId, propertyId as string));
    }

    const result = await db.select({
      type: eaBookings.type,
      total: sql<string>`COALESCE(SUM(${eaBookings.amount}::numeric), 0)`,
      totalNet: sql<string>`COALESCE(SUM(${eaBookings.netAmount}::numeric), 0)`,
      totalTax: sql<string>`COALESCE(SUM(${eaBookings.taxAmount}::numeric), 0)`,
      count: sql<number>`COUNT(*)`,
    }).from(eaBookings)
      .where(and(...conditions))
      .groupBy(eaBookings.type);

    const einnahmen = result.find(r => r.type === 'einnahme');
    const ausgaben = result.find(r => r.type === 'ausgabe');

    const totalEinnahmen = Number(einnahmen?.total || 0);
    const totalAusgaben = Number(ausgaben?.total || 0);

    res.json({
      year: y,
      totalEinnahmen,
      totalAusgaben,
      ergebnis: totalEinnahmen - totalAusgaben,
      totalEinnahmenNet: Number(einnahmen?.totalNet || 0),
      totalAusgabenNet: Number(ausgaben?.totalNet || 0),
      totalEinnahmenTax: Number(einnahmen?.totalTax || 0),
      totalAusgabenTax: Number(ausgaben?.totalTax || 0),
      countEinnahmen: Number(einnahmen?.count || 0),
      countAusgaben: Number(ausgaben?.count || 0),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
