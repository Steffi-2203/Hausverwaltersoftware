import { Router, Request, Response } from "express";
import { isAuthenticated } from "./helpers";
import { db } from "../db";
import { fiscalPeriods, depreciationAssets, chartOfAccounts, journalEntries, journalEntryLines, bookingNumberSequences } from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";

const router = Router();

function getOrgId(req: any): string | null {
  return req.user?.organizationId || req.session?.organizationId || null;
}

router.get("/api/fiscal-year/periods", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation gefunden" });
    const { propertyId } = req.query;

    const conditions: any[] = [eq(fiscalPeriods.organizationId, orgId)];
    if (propertyId) {
      conditions.push(eq(fiscalPeriods.propertyId, propertyId as string));
    }

    const periods = await db.select().from(fiscalPeriods)
      .where(and(...conditions))
      .orderBy(desc(fiscalPeriods.year));

    res.json(periods);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/fiscal-year/periods", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation gefunden" });

    const { year, notes, propertyId } = req.body;
    if (!year) return res.status(400).json({ error: "Jahr ist erforderlich" });

    const existingConditions: any[] = [eq(fiscalPeriods.organizationId, orgId), eq(fiscalPeriods.year, year)];
    if (propertyId) {
      existingConditions.push(eq(fiscalPeriods.propertyId, propertyId));
    }
    const existing = await db.select().from(fiscalPeriods)
      .where(and(...existingConditions));

    if (existing.length > 0) {
      return res.status(409).json({ error: `Periode für Jahr ${year} existiert bereits` });
    }

    const [period] = await db.insert(fiscalPeriods).values({
      organizationId: orgId,
      propertyId: propertyId || null,
      year,
      status: 'open',
      notes: notes || null,
    }).returning();

    res.json(period);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/fiscal-year/depreciation-assets", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation gefunden" });

    const { propertyId } = req.query;
    const assetConditions: any[] = [eq(depreciationAssets.organizationId, orgId)];
    if (propertyId) {
      assetConditions.push(eq(depreciationAssets.propertyId, propertyId as string));
    }

    const assets = await db.select().from(depreciationAssets)
      .where(and(...assetConditions));

    const year = req.query.year ? Number(req.query.year) : null;

    const result = assets.map(asset => {
      const yearlyDepreciation = year
        ? Number(asset.acquisitionCost) * (Number(asset.depreciationRate) / 100)
        : null;
      return {
        ...asset,
        currentYearDepreciation: yearlyDepreciation,
      };
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/fiscal-year/depreciation-assets", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation gefunden" });

    const { name, description, propertyId, acquisitionDate, acquisitionCost, usefulLifeYears, accountId } = req.body;

    if (!name || !acquisitionDate || !acquisitionCost || !usefulLifeYears) {
      return res.status(400).json({ error: "Name, Anschaffungsdatum, Anschaffungskosten und Nutzungsdauer sind erforderlich" });
    }

    const depreciationRate = (100 / Number(usefulLifeYears)).toFixed(2);

    const [asset] = await db.insert(depreciationAssets).values({
      organizationId: orgId,
      name,
      description: description || null,
      propertyId: propertyId || null,
      acquisitionDate,
      acquisitionCost: String(acquisitionCost),
      usefulLifeYears: Number(usefulLifeYears),
      depreciationRate,
      accumulatedDepreciation: '0',
      bookValue: String(acquisitionCost),
      accountId: accountId || null,
    }).returning();

    res.json(asset);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/fiscal-year/book-depreciation", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation gefunden" });

    const { periodId } = req.body;
    if (!periodId) return res.status(400).json({ error: "periodId ist erforderlich" });

    const [period] = await db.select().from(fiscalPeriods)
      .where(and(eq(fiscalPeriods.id, periodId), eq(fiscalPeriods.organizationId, orgId)));

    if (!period) return res.status(404).json({ error: "Periode nicht gefunden" });
    if (period.depreciationBooked) return res.status(400).json({ error: "AfA wurde bereits gebucht" });

    const assets = await db.select().from(depreciationAssets)
      .where(and(eq(depreciationAssets.organizationId, orgId), eq(depreciationAssets.isActive, true)));

    const afaAccountRows = await db.select().from(chartOfAccounts)
      .where(eq(chartOfAccounts.accountNumber, '7010'));
    const afaAccount = afaAccountRows[0];

    const defaultAssetAccountRows = await db.select().from(chartOfAccounts)
      .where(eq(chartOfAccounts.accountNumber, '0200'));
    const defaultAssetAccount = defaultAssetAccountRows[0];

    if (!afaAccount) return res.status(400).json({ error: "AfA-Konto 7010 nicht gefunden" });

    const year = period.year;
    const seqConditions = [eq(bookingNumberSequences.currentYear, year)];
    seqConditions.push(eq(bookingNumberSequences.organizationId, orgId));
    let [seq] = await db.select().from(bookingNumberSequences).where(and(...seqConditions));

    const bookedItems: any[] = [];

    for (const asset of assets) {
      const yearlyAmount = Number(asset.acquisitionCost) * (Number(asset.depreciationRate) / 100);
      if (yearlyAmount <= 0) continue;

      let bookingNumber: string;
      if (seq) {
        const next = seq.currentNumber + 1;
        bookingNumber = `BU-${year}-${String(next).padStart(6, '0')}`;
        await db.update(bookingNumberSequences)
          .set({ currentNumber: next })
          .where(eq(bookingNumberSequences.id, seq.id));
        seq = { ...seq, currentNumber: next };
      } else {
        bookingNumber = `BU-${year}-000001`;
        const [newSeq] = await db.insert(bookingNumberSequences).values({
          organizationId: orgId,
          currentYear: year,
          currentNumber: 1,
        }).returning();
        seq = newSeq;
      }

      const [entry] = await db.insert(journalEntries).values({
        organizationId: orgId,
        bookingNumber,
        entryDate: `${year}-12-31`,
        description: `AfA ${year}: ${asset.name}`,
        sourceType: 'depreciation',
        sourceId: asset.id,
      }).returning();

      const creditAccountId = asset.accountId || defaultAssetAccount?.id;
      if (!creditAccountId) {
        console.warn(`Skipping asset ${asset.name}: no account assigned and no default 0200 account found`);
        continue;
      }

      const lines = [
        {
          journalEntryId: entry.id,
          accountId: afaAccount.id,
          debit: String(yearlyAmount.toFixed(2)),
          credit: '0',
          description: `AfA-Aufwand ${asset.name}`,
        },
        {
          journalEntryId: entry.id,
          accountId: creditAccountId,
          debit: '0',
          credit: String(yearlyAmount.toFixed(2)),
          description: `Wertminderung ${asset.name}`,
        },
      ];

      await db.insert(journalEntryLines).values(lines);

      const newAccumulated = Number(asset.accumulatedDepreciation) + yearlyAmount;
      const newBookValue = Number(asset.bookValue) - yearlyAmount;

      await db.update(depreciationAssets)
        .set({
          accumulatedDepreciation: String(newAccumulated.toFixed(2)),
          bookValue: String(Math.max(0, newBookValue).toFixed(2)),
          updatedAt: new Date(),
        })
        .where(eq(depreciationAssets.id, asset.id));

      bookedItems.push({
        assetId: asset.id,
        assetName: asset.name,
        yearlyAmount: yearlyAmount.toFixed(2),
        journalEntryId: entry.id,
      });
    }

    await db.update(fiscalPeriods)
      .set({ depreciationBooked: true, updatedAt: new Date() })
      .where(eq(fiscalPeriods.id, periodId));

    res.json({
      success: true,
      periodId,
      totalBooked: bookedItems.reduce((sum, item) => sum + Number(item.yearlyAmount), 0).toFixed(2),
      items: bookedItems,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/fiscal-year/accruals", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation gefunden" });

    const year = Number(req.query.year);
    if (!year) return res.status(400).json({ error: "Jahr ist erforderlich" });

    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    const result = await db.execute(sql`
      SELECT je.*
      FROM journal_entries je
      WHERE je.organization_id = ${orgId}
        AND je.entry_date BETWEEN ${startDate} AND ${endDate}
        AND (
          je.source_type ILIKE '%abgrenzung%'
          OR je.description ILIKE '%Rückstellung%'
          OR je.description ILIKE '%Vorauszahlung%'
        )
      ORDER BY je.entry_date DESC
    `);

    const entries: any[] = result.rows || result;

    res.json({
      year,
      entries,
      summary: {
        totalEntries: entries.length,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/fiscal-year/review-accruals", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation gefunden" });

    const { periodId } = req.body;
    if (!periodId) return res.status(400).json({ error: "periodId ist erforderlich" });

    const [period] = await db.update(fiscalPeriods)
      .set({ accrualsReviewed: true, updatedAt: new Date() })
      .where(and(eq(fiscalPeriods.id, periodId), eq(fiscalPeriods.organizationId, orgId)))
      .returning();

    if (!period) return res.status(404).json({ error: "Periode nicht gefunden" });

    res.json(period);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/fiscal-year/review-balance", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation gefunden" });

    const { periodId } = req.body;
    if (!periodId) return res.status(400).json({ error: "periodId ist erforderlich" });

    const [period] = await db.update(fiscalPeriods)
      .set({ balanceReviewed: true, updatedAt: new Date() })
      .where(and(eq(fiscalPeriods.id, periodId), eq(fiscalPeriods.organizationId, orgId)))
      .returning();

    if (!period) return res.status(404).json({ error: "Periode nicht gefunden" });

    res.json(period);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/fiscal-year/close", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation gefunden" });

    const { periodId } = req.body;
    if (!periodId) return res.status(400).json({ error: "periodId ist erforderlich" });

    const [period] = await db.select().from(fiscalPeriods)
      .where(and(eq(fiscalPeriods.id, periodId), eq(fiscalPeriods.organizationId, orgId)));

    if (!period) return res.status(404).json({ error: "Periode nicht gefunden" });

    if (!period.depreciationBooked) {
      return res.status(400).json({ error: "AfA muss zuerst gebucht werden" });
    }
    if (!period.accrualsReviewed) {
      return res.status(400).json({ error: "Abgrenzungen müssen zuerst geprüft werden" });
    }
    if (!period.balanceReviewed) {
      return res.status(400).json({ error: "Bilanz muss zuerst geprüft werden" });
    }

    const closedBy = (req as any).user?.email || (req as any).user?.fullName || (req as any).session?.email || 'system';

    const [updated] = await db.update(fiscalPeriods)
      .set({
        status: 'closed',
        closedAt: new Date(),
        closedBy,
        updatedAt: new Date(),
      })
      .where(eq(fiscalPeriods.id, periodId))
      .returning();

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/fiscal-year/report", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Keine Organisation gefunden" });

    const periodId = req.query.periodId as string;
    if (!periodId) return res.status(400).json({ error: "periodId ist erforderlich" });

    const [period] = await db.select().from(fiscalPeriods)
      .where(and(eq(fiscalPeriods.id, periodId), eq(fiscalPeriods.organizationId, orgId)));

    if (!period) return res.status(404).json({ error: "Periode nicht gefunden" });

    const year = period.year;
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    const balanceResult = await db.execute(sql`
      SELECT
        coa.account_type,
        COALESCE(SUM(jel.debit::numeric), 0) - COALESCE(SUM(jel.credit::numeric), 0) as balance
      FROM chart_of_accounts coa
      JOIN journal_entry_lines jel ON jel.account_id = coa.id
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      WHERE je.organization_id = ${orgId}
        AND je.entry_date BETWEEN ${startDate} AND ${endDate}
        AND coa.account_type IN ('asset', 'liability', 'equity')
      GROUP BY coa.account_type
    `);

    const balanceRows: any[] = balanceResult.rows || balanceResult;
    const totalAssets = balanceRows.filter(r => r.account_type === 'asset')
      .reduce((s, r) => s + Number(r.balance), 0);
    const totalLiabilities = balanceRows.filter(r => r.account_type === 'liability')
      .reduce((s, r) => s + Math.abs(Number(r.balance)), 0);

    const plResult = await db.execute(sql`
      SELECT
        coa.account_type,
        COALESCE(SUM(jel.credit::numeric), 0) - COALESCE(SUM(jel.debit::numeric), 0) as balance
      FROM chart_of_accounts coa
      JOIN journal_entry_lines jel ON jel.account_id = coa.id
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      WHERE je.organization_id = ${orgId}
        AND je.entry_date BETWEEN ${startDate} AND ${endDate}
        AND coa.account_type IN ('revenue', 'expense')
      GROUP BY coa.account_type
    `);

    const plRows: any[] = plResult.rows || plResult;
    const totalRevenue = plRows.filter(r => r.account_type === 'revenue')
      .reduce((s, r) => s + Number(r.balance), 0);
    const totalExpenses = plRows.filter(r => r.account_type === 'expense')
      .reduce((s, r) => s + Math.abs(Number(r.balance)), 0);

    const assets = await db.select().from(depreciationAssets)
      .where(eq(depreciationAssets.organizationId, orgId));

    const assetSchedule = assets.map(asset => ({
      id: asset.id,
      name: asset.name,
      acquisitionDate: asset.acquisitionDate,
      acquisitionCost: asset.acquisitionCost,
      usefulLifeYears: asset.usefulLifeYears,
      depreciationRate: asset.depreciationRate,
      yearlyDepreciation: (Number(asset.acquisitionCost) * (Number(asset.depreciationRate) / 100)).toFixed(2),
      accumulatedDepreciation: asset.accumulatedDepreciation,
      bookValue: asset.bookValue,
      isActive: asset.isActive,
    }));

    res.json({
      period,
      balanceSheet: {
        totalAssets,
        totalLiabilities,
      },
      profitAndLoss: {
        totalRevenue,
        totalExpenses,
        netIncome: totalRevenue - totalExpenses,
      },
      assetSchedule,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
