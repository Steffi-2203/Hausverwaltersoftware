import { Router, Request, Response } from "express";
import { db } from "../db";
import { heatBillingRuns, heatBillingLines, heatBillingAuditLog, units, tenants, properties, organizations } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { isAuthenticated, requireMutationAccess } from "./helpers";
import { heatBillingService, HeatBillingInput } from "../services/heatBillingService";

const router = Router();

function getOrgId(req: any): string | null {
  return req.session?.organizationId || null;
}

router.get("/api/heizkosten/runs", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(401).json({ error: "Nicht autorisiert" });

    const { propertyId } = req.query;
    const conditions: any[] = [eq(heatBillingRuns.organizationId, orgId)];
    if (propertyId) {
      conditions.push(eq(heatBillingRuns.propertyId, propertyId as string));
    }

    const runs = await db.select({
      run: heatBillingRuns,
      propertyName: properties.name,
    })
      .from(heatBillingRuns)
      .leftJoin(properties, eq(heatBillingRuns.propertyId, properties.id))
      .where(and(...conditions))
      .orderBy(desc(heatBillingRuns.createdAt));

    res.json(runs.map(r => ({ ...r.run, propertyName: r.propertyName })));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/heizkosten/runs", isAuthenticated, requireMutationAccess(), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(401).json({ error: "Nicht autorisiert" });

    const {
      propertyId, periodFrom, periodTo,
      heatingSupplyCost, hotWaterSupplyCost, maintenanceCost, meterReadingCost,
      heatingConsumptionSharePct, heatingAreaSharePct,
      hotWaterConsumptionSharePct, hotWaterAreaSharePct,
      roundingMethod, restCentRule, notes,
    } = req.body;

    const hcPct = Number(heatingConsumptionSharePct || 65);
    const haPct = Number(heatingAreaSharePct || 35);
    const hwcPct = Number(hotWaterConsumptionSharePct || 65);
    const hwaPct = Number(hotWaterAreaSharePct || 35);

    if (hcPct < 55 || hcPct > 65) {
      return res.status(400).json({ error: "Heizung Verbrauchsanteil muss zwischen 55% und 65% liegen (HeizKG §8)" });
    }
    if (haPct < 35 || haPct > 45) {
      return res.status(400).json({ error: "Heizung Flächenanteil muss zwischen 35% und 45% liegen (HeizKG §8)" });
    }
    if (Math.abs(hcPct + haPct - 100) > 0.01) {
      return res.status(400).json({ error: "Heizung: Verbrauchsanteil + Flächenanteil müssen 100% ergeben" });
    }
    if (hwcPct < 55 || hwcPct > 65) {
      return res.status(400).json({ error: "Warmwasser Verbrauchsanteil muss zwischen 55% und 65% liegen (HeizKG §8)" });
    }
    if (hwaPct < 35 || hwaPct > 45) {
      return res.status(400).json({ error: "Warmwasser Flächenanteil muss zwischen 35% und 45% liegen (HeizKG §8)" });
    }
    if (Math.abs(hwcPct + hwaPct - 100) > 0.01) {
      return res.status(400).json({ error: "Warmwasser: Verbrauchsanteil + Flächenanteil müssen 100% ergeben" });
    }

    if (!periodFrom || !periodTo) {
      return res.status(400).json({ error: "Abrechnungszeitraum (periodFrom, periodTo) ist erforderlich" });
    }
    const from = new Date(periodFrom);
    const to = new Date(periodTo);
    if (from >= to) {
      return res.status(400).json({ error: "periodFrom muss vor periodTo liegen" });
    }
    const diffMonths = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
    if (diffMonths > 12) {
      return res.status(400).json({ error: "Abrechnungszeitraum darf maximal 12 Monate betragen (HeizKG §9)" });
    }

    const [run] = await db.insert(heatBillingRuns).values({
      organizationId: orgId,
      propertyId,
      periodFrom,
      periodTo,
      heatingSupplyCost: String(heatingSupplyCost || 0),
      hotWaterSupplyCost: String(hotWaterSupplyCost || 0),
      maintenanceCost: String(maintenanceCost || 0),
      meterReadingCost: String(meterReadingCost || 0),
      heatingConsumptionSharePct: String(hcPct),
      heatingAreaSharePct: String(haPct),
      hotWaterConsumptionSharePct: String(hwcPct),
      hotWaterAreaSharePct: String(hwaPct),
      roundingMethod: roundingMethod || 'kaufmaennisch',
      restCentRule: restCentRule || 'assign_to_largest_share',
      notes: notes || null,
    }).returning();

    await db.insert(heatBillingAuditLog).values({
      runId: run.id,
      action: 'erstellt',
      userId: (req as any).session?.userId || null,
    });

    res.json(run);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/heizkosten/runs/:id", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(401).json({ error: "Nicht autorisiert" });

    const id = Number(req.params.id);
    const [result] = await db.select({
      run: heatBillingRuns,
      propertyName: properties.name,
    })
      .from(heatBillingRuns)
      .leftJoin(properties, eq(heatBillingRuns.propertyId, properties.id))
      .where(and(eq(heatBillingRuns.id, id), eq(heatBillingRuns.organizationId, orgId)));

    if (!result) {
      return res.status(404).json({ error: "Abrechnungslauf nicht gefunden" });
    }

    const lines = await db.select()
      .from(heatBillingLines)
      .where(eq(heatBillingLines.runId, id));

    res.json({ ...result.run, propertyName: result.propertyName, lines });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/heizkosten/compute", isAuthenticated, requireMutationAccess(), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(401).json({ error: "Nicht autorisiert" });

    const { runId, unitData } = req.body;
    if (!runId) return res.status(400).json({ error: "runId ist erforderlich" });
    if (!unitData || !Array.isArray(unitData) || unitData.length === 0) {
      return res.status(400).json({ error: "unitData ist erforderlich" });
    }

    const [run] = await db.select()
      .from(heatBillingRuns)
      .where(and(eq(heatBillingRuns.id, runId), eq(heatBillingRuns.organizationId, orgId)));

    if (!run) return res.status(404).json({ error: "Abrechnungslauf nicht gefunden" });

    const [prop] = await db.select().from(properties)
      .where(and(eq(properties.id, run.propertyId), eq(properties.organizationId, orgId)));
    if (!prop) return res.status(403).json({ error: "Kein Zugriff auf diese Liegenschaft" });

    const propertyUnits = await db.select()
      .from(units)
      .where(eq(units.propertyId, run.propertyId));

    const propertyUnitIds = new Set(propertyUnits.map(u => u.id));
    const invalidUnits = unitData.filter((ud: any) => ud.unitId && !propertyUnitIds.has(ud.unitId));
    if (invalidUnits.length > 0) {
      return res.status(400).json({
        error: "Einheiten gehören nicht zur Liegenschaft",
        invalidUnitIds: invalidUnits.map((u: any) => u.unitId),
      });
    }

    const activeTenants = await db.select()
      .from(tenants)
      .where(eq(tenants.status, 'aktiv'));

    const tenantByUnit = new Map<string, string>();
    for (const t of activeTenants) {
      tenantByUnit.set(t.unitId, `${t.firstName} ${t.lastName}`);
    }

    const unitDataMap = new Map<string, any>();
    for (const ud of unitData) {
      unitDataMap.set(ud.unitId, ud);
    }

    const inputUnits = propertyUnits.map(u => {
      const ud = unitDataMap.get(u.id);
      return {
        unitId: u.id,
        areaM2: Number(u.flaeche || 0),
        mea: u.nutzwert ? Number(u.nutzwert) : undefined,
        occupancy: ud?.occupancy ?? 1,
        heatingMeter: ud?.heatingMeter || null,
        hotWaterMeter: ud?.hotWaterMeter || null,
        prepayment: Number(ud?.prepayment || 0),
      };
    });

    const input: HeatBillingInput = {
      runId: run.id,
      propertyId: run.propertyId,
      periodFrom: run.periodFrom,
      periodTo: run.periodTo,
      totalCosts: {
        heatingSupply: Number(run.heatingSupplyCost),
        hotWaterSupply: Number(run.hotWaterSupplyCost || 0),
        maintenance: Number(run.maintenanceCost || 0),
        meterReadingCost: Number(run.meterReadingCost || 0),
      },
      config: {
        heatingConsumptionSharePct: Number(run.heatingConsumptionSharePct),
        heatingAreaSharePct: Number(run.heatingAreaSharePct),
        hotWaterConsumptionSharePct: Number(run.hotWaterConsumptionSharePct),
        hotWaterAreaSharePct: Number(run.hotWaterAreaSharePct),
        roundingMethod: 'kaufmaennisch',
        restCentRule: (run.restCentRule as any) || 'assign_to_largest_share',
      },
      units: inputUnits,
    };

    const result = heatBillingService.compute(input);

    await db.delete(heatBillingLines).where(eq(heatBillingLines.runId, runId));

    for (const line of result.lines) {
      await db.insert(heatBillingLines).values({
        runId,
        unitId: line.unitId,
        tenantName: tenantByUnit.get(line.unitId) || null,
        areaM2: String(line.areaM2),
        mea: line.mea != null ? String(line.mea) : null,
        occupancy: line.occupancy,
        heatingMeterType: line.heatingMeterType as any || null,
        heatingMeterValue: line.heatingMeterValue != null ? String(line.heatingMeterValue) : null,
        heatingMeterMissing: line.heatingMeterMissing,
        hotWaterMeterValue: line.hotWaterMeterValue != null ? String(line.hotWaterMeterValue) : null,
        hotWaterMeterMissing: line.hotWaterMeterMissing,
        heatingConsumptionShare: String(line.heatingConsumptionShare),
        heatingAreaShare: String(line.heatingAreaShare),
        heatingTotal: String(line.heatingTotal),
        hotWaterConsumptionShare: String(line.hotWaterConsumptionShare),
        hotWaterAreaShare: String(line.hotWaterAreaShare),
        hotWaterTotal: String(line.hotWaterTotal),
        maintenanceShare: String(line.maintenanceShare),
        meterReadingShare: String(line.meterReadingShare),
        totalCost: String(line.totalCost),
        prepayment: String(line.prepayment),
        balance: String(line.balance),
        isEstimated: line.isEstimated,
        estimationReason: line.estimationReason || null,
        plausibilityFlags: line.plausibilityFlags,
      });
    }

    await db.update(heatBillingRuns)
      .set({
        totalDistributed: String(result.summary.totalDistributed),
        trialBalanceDiff: String(result.summary.trialBalanceDiff),
        complianceCheckResult: result.complianceCheck,
        warnings: result.warnings,
        computedAt: new Date(),
        computedBy: (req as any).session?.userId || null,
        status: 'berechnet',
        updatedAt: new Date(),
      })
      .where(eq(heatBillingRuns.id, runId));

    await db.insert(heatBillingAuditLog).values({
      runId,
      action: 'berechnet',
      field: 'status',
      oldValue: run.status || 'entwurf',
      newValue: 'berechnet',
      userId: (req as any).session?.userId || null,
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/heizkosten/storno/:id", isAuthenticated, requireMutationAccess(), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(401).json({ error: "Nicht autorisiert" });

    const id = Number(req.params.id);
    const [run] = await db.select()
      .from(heatBillingRuns)
      .where(and(eq(heatBillingRuns.id, id), eq(heatBillingRuns.organizationId, orgId)));

    if (!run) return res.status(404).json({ error: "Abrechnungslauf nicht gefunden" });

    if (run.status !== 'berechnet' && run.status !== 'geprueft') {
      return res.status(400).json({ error: "Nur berechnete oder geprüfte Abrechnungen können storniert werden" });
    }

    const { stornoReason, createCorrectionRun } = req.body;
    if (!stornoReason) {
      return res.status(400).json({ error: "Storno-Begründung ist erforderlich" });
    }

    await db.update(heatBillingRuns)
      .set({
        status: 'storniert',
        stornoReason,
        stornoAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(heatBillingRuns.id, id));

    await db.insert(heatBillingAuditLog).values({
      runId: id,
      action: 'storniert',
      field: 'status',
      oldValue: run.status,
      newValue: 'storniert',
      userId: (req as any).session?.userId || null,
    });

    let correctionRun = null;
    if (createCorrectionRun) {
      const [newRun] = await db.insert(heatBillingRuns).values({
        organizationId: orgId,
        propertyId: run.propertyId,
        periodFrom: run.periodFrom,
        periodTo: run.periodTo,
        heatingSupplyCost: run.heatingSupplyCost,
        hotWaterSupplyCost: run.hotWaterSupplyCost,
        maintenanceCost: run.maintenanceCost,
        meterReadingCost: run.meterReadingCost,
        heatingConsumptionSharePct: run.heatingConsumptionSharePct,
        heatingAreaSharePct: run.heatingAreaSharePct,
        hotWaterConsumptionSharePct: run.hotWaterConsumptionSharePct,
        hotWaterAreaSharePct: run.hotWaterAreaSharePct,
        roundingMethod: run.roundingMethod,
        restCentRule: run.restCentRule,
        version: (run.version || 1) + 1,
        parentRunId: id,
        notes: `Korrektur zu Lauf #${id}`,
      }).returning();
      correctionRun = newRun;

      await db.insert(heatBillingAuditLog).values({
        runId: newRun.id,
        action: 'korrektur_erstellt',
        field: 'parentRunId',
        oldValue: null,
        newValue: String(id),
        userId: (req as any).session?.userId || null,
      });
    }

    res.json({ success: true, stornoRunId: id, correctionRun });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/heizkosten/export/:id", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(401).json({ error: "Nicht autorisiert" });

    const id = Number(req.params.id);
    const [result] = await db.select({
      run: heatBillingRuns,
      propertyName: properties.name,
      propertyAddress: properties.address,
      propertyCity: properties.city,
      propertyPostalCode: properties.postalCode,
    })
      .from(heatBillingRuns)
      .leftJoin(properties, eq(heatBillingRuns.propertyId, properties.id))
      .where(and(eq(heatBillingRuns.id, id), eq(heatBillingRuns.organizationId, orgId)));

    if (!result) return res.status(404).json({ error: "Abrechnungslauf nicht gefunden" });

    const lines = await db.select()
      .from(heatBillingLines)
      .where(eq(heatBillingLines.runId, id));

    const format = req.query.format as string;

    if (format === 'csv') {
      const csvHeaders = [
        'Top-Nr', 'Mieter', 'Fläche m²', 'Heizung Verbrauch', 'Heizung Fläche', 'Heizung Gesamt',
        'Warmwasser Verbrauch', 'Warmwasser Fläche', 'Warmwasser Gesamt',
        'Wartung', 'Messkosten', 'Gesamt', 'Vorauszahlung', 'Saldo', 'Geschätzt',
      ].join(';');

      const csvLines = lines.map(l => [
        l.unitId, l.tenantName || '', l.areaM2,
        l.heatingConsumptionShare, l.heatingAreaShare, l.heatingTotal,
        l.hotWaterConsumptionShare, l.hotWaterAreaShare, l.hotWaterTotal,
        l.maintenanceShare, l.meterReadingShare, l.totalCost,
        l.prepayment, l.balance, l.isEstimated ? 'Ja' : 'Nein',
      ].join(';'));

      const csv = [csvHeaders, ...csvLines].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=heizkosten_${id}.csv`);
      return res.send('\uFEFF' + csv);
    }

    const totalHeating = lines.reduce((s, l) => s + Number(l.heatingTotal || 0), 0);
    const totalHotWater = lines.reduce((s, l) => s + Number(l.hotWaterTotal || 0), 0);
    const totalMaintenance = lines.reduce((s, l) => s + Number(l.maintenanceShare || 0), 0);
    const totalMeterReading = lines.reduce((s, l) => s + Number(l.meterReadingShare || 0), 0);
    const totalDistributed = lines.reduce((s, l) => s + Number(l.totalCost || 0), 0);

    const exportData = {
      meta: {
        exportDate: new Date().toISOString(),
        format: 'DATEV-kompatibel',
        system: 'ImmoFlowMe HeizKG',
      },
      run: {
        id: result.run.id,
        propertyId: result.run.propertyId,
        propertyName: result.propertyName,
        propertyAddress: result.propertyAddress,
        propertyCity: result.propertyCity,
        periodFrom: result.run.periodFrom,
        periodTo: result.run.periodTo,
        status: result.run.status,
        version: result.run.version,
        heatingSupplyCost: result.run.heatingSupplyCost,
        hotWaterSupplyCost: result.run.hotWaterSupplyCost,
        maintenanceCost: result.run.maintenanceCost,
        meterReadingCost: result.run.meterReadingCost,
        heatingConsumptionSharePct: result.run.heatingConsumptionSharePct,
        heatingAreaSharePct: result.run.heatingAreaSharePct,
        hotWaterConsumptionSharePct: result.run.hotWaterConsumptionSharePct,
        hotWaterAreaSharePct: result.run.hotWaterAreaSharePct,
      },
      complianceCheck: result.run.complianceCheckResult,
      summary: {
        totalHeating: Math.round(totalHeating * 100) / 100,
        totalHotWater: Math.round(totalHotWater * 100) / 100,
        totalMaintenance: Math.round(totalMaintenance * 100) / 100,
        totalMeterReading: Math.round(totalMeterReading * 100) / 100,
        totalDistributed: Math.round(totalDistributed * 100) / 100,
        trialBalanceDiff: result.run.trialBalanceDiff,
      },
      lines: lines.map(l => ({
        unitId: l.unitId,
        tenantName: l.tenantName,
        areaM2: l.areaM2,
        heatingConsumptionShare: l.heatingConsumptionShare,
        heatingAreaShare: l.heatingAreaShare,
        heatingTotal: l.heatingTotal,
        hotWaterConsumptionShare: l.hotWaterConsumptionShare,
        hotWaterAreaShare: l.hotWaterAreaShare,
        hotWaterTotal: l.hotWaterTotal,
        maintenanceShare: l.maintenanceShare,
        meterReadingShare: l.meterReadingShare,
        totalCost: l.totalCost,
        prepayment: l.prepayment,
        balance: l.balance,
        isEstimated: l.isEstimated,
      })),
    };

    res.json(exportData);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/heizkosten/compliance-check/:id", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(401).json({ error: "Nicht autorisiert" });

    const id = Number(req.params.id);
    const [run] = await db.select()
      .from(heatBillingRuns)
      .where(and(eq(heatBillingRuns.id, id), eq(heatBillingRuns.organizationId, orgId)));

    if (!run) return res.status(404).json({ error: "Abrechnungslauf nicht gefunden" });

    const lines = await db.select()
      .from(heatBillingLines)
      .where(eq(heatBillingLines.runId, id));

    const propertyUnits = await db.select()
      .from(units)
      .where(eq(units.propertyId, run.propertyId));

    const inputUnits = propertyUnits.map(u => {
      const line = lines.find(l => l.unitId === u.id);
      return {
        unitId: u.id,
        areaM2: Number(u.flaeche || 0),
        mea: u.nutzwert ? Number(u.nutzwert) : undefined,
        heatingMeter: line?.heatingMeterValue ? {
          type: (line.heatingMeterType || 'hkv') as 'hkv' | 'waermemengenzaehler',
          value: Number(line.heatingMeterValue),
        } : null,
        hotWaterMeter: line?.hotWaterMeterValue ? { value: Number(line.hotWaterMeterValue) } : null,
        prepayment: Number(line?.prepayment || 0),
      };
    });

    const input: HeatBillingInput = {
      runId: run.id,
      propertyId: run.propertyId,
      periodFrom: run.periodFrom,
      periodTo: run.periodTo,
      totalCosts: {
        heatingSupply: Number(run.heatingSupplyCost),
        hotWaterSupply: Number(run.hotWaterSupplyCost || 0),
        maintenance: Number(run.maintenanceCost || 0),
        meterReadingCost: Number(run.meterReadingCost || 0),
      },
      config: {
        heatingConsumptionSharePct: Number(run.heatingConsumptionSharePct),
        heatingAreaSharePct: Number(run.heatingAreaSharePct),
        hotWaterConsumptionSharePct: Number(run.hotWaterConsumptionSharePct),
        hotWaterAreaSharePct: Number(run.hotWaterAreaSharePct),
        roundingMethod: 'kaufmaennisch',
        restCentRule: (run.restCentRule as any) || 'assign_to_largest_share',
      },
      units: inputUnits,
    };

    const result = heatBillingService.compute(input);
    res.json(result.complianceCheck);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/heizkosten/generatePdf", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(401).json({ error: "Nicht autorisiert" });

    const { runId } = req.body;
    if (!runId) return res.status(400).json({ error: "runId ist erforderlich" });

    const [result] = await db.select({
      run: heatBillingRuns,
      propertyName: properties.name,
      propertyAddress: properties.address,
      propertyCity: properties.city,
      propertyPostalCode: properties.postalCode,
    })
      .from(heatBillingRuns)
      .leftJoin(properties, eq(heatBillingRuns.propertyId, properties.id))
      .where(and(eq(heatBillingRuns.id, runId), eq(heatBillingRuns.organizationId, orgId)));

    if (!result) return res.status(404).json({ error: "Abrechnungslauf nicht gefunden" });

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));

    const lines = await db.select()
      .from(heatBillingLines)
      .where(eq(heatBillingLines.runId, runId));

    const run = result.run;
    const complianceCheck = run.complianceCheckResult as any;
    const warnings = (run.warnings as string[]) || [];

    const estimatedLines = lines.filter(l => l.isEstimated);
    const totalCosts = Number(run.heatingSupplyCost) + Number(run.hotWaterSupplyCost || 0) + Number(run.maintenanceCost || 0) + Number(run.meterReadingCost || 0);

    const formatEur = (v: any) => Number(v || 0).toFixed(2).replace('.', ',');
    const formatDate = (d: string) => {
      if (!d) return '';
      const parts = d.split('-');
      return `${parts[2]}.${parts[1]}.${parts[0]}`;
    };

    const linesHtml = lines.map(l => {
      const balance = Number(l.balance || 0);
      const balanceClass = balance > 0 ? 'nachzahlung' : balance < 0 ? 'guthaben' : '';
      const balanceLabel = balance > 0 ? 'Nachzahlung' : balance < 0 ? 'Guthaben' : '0,00';
      return `<tr>
        <td>${l.unitId.substring(0, 8)}</td>
        <td>${l.tenantName || '—'}</td>
        <td class="num">${formatEur(l.areaM2)}</td>
        <td class="num">${formatEur(l.heatingConsumptionShare)}</td>
        <td class="num">${formatEur(l.heatingAreaShare)}</td>
        <td class="num">${formatEur(l.heatingTotal)}</td>
        <td class="num">${formatEur(l.hotWaterConsumptionShare)}</td>
        <td class="num">${formatEur(l.hotWaterAreaShare)}</td>
        <td class="num">${formatEur(l.hotWaterTotal)}</td>
        <td class="num">${formatEur(l.maintenanceShare)}</td>
        <td class="num">${formatEur(l.meterReadingShare)}</td>
        <td class="num"><strong>${formatEur(l.totalCost)}</strong></td>
        <td class="num">${formatEur(l.prepayment)}</td>
        <td class="num ${balanceClass}"><strong>${formatEur(Math.abs(balance))} ${balance !== 0 ? (balance > 0 ? '(Nachzahlung)' : '(Guthaben)') : ''}</strong></td>
      </tr>`;
    }).join('');

    const complianceHtml = complianceCheck?.checks ? complianceCheck.checks.map((c: any) => {
      const icon = c.status === 'ok' ? '&#10004;' : c.status === 'warnung' ? '&#9888;' : '&#10008;';
      const color = c.status === 'ok' ? '#2e7d32' : c.status === 'warnung' ? '#f57c00' : '#c62828';
      return `<tr>
        <td style="color:${color}">${icon}</td>
        <td><strong>${c.paragraph}</strong></td>
        <td>${c.requirement}</td>
        <td>${c.details}</td>
      </tr>`;
    }).join('') : '';

    const warningsHtml = warnings.length > 0 || estimatedLines.length > 0
      ? `<div class="section">
          <h3>Hinweise</h3>
          <ul>
            ${estimatedLines.map(l => `<li>Einheit ${l.unitId.substring(0, 8)} (${l.tenantName || '—'}): ${l.estimationReason || 'Geschätzter Wert'}</li>`).join('')}
            ${warnings.map(w => `<li>${w}</li>`).join('')}
          </ul>
        </div>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>Heizkostenabrechnung gem&auml;&szlig; HeizKG</title>
<style>
  @media print { body { margin: 0; } @page { margin: 15mm; } }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #222; line-height: 1.4; max-width: 297mm; margin: 0 auto; padding: 15mm; }
  h1 { font-size: 18px; margin-bottom: 5px; color: #1a237e; }
  h2 { font-size: 14px; margin: 18px 0 8px; color: #1a237e; border-bottom: 2px solid #1a237e; padding-bottom: 3px; }
  h3 { font-size: 12px; margin: 12px 0 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; font-size: 10px; }
  th { background: #e8eaf6; font-weight: 600; }
  .num { text-align: right; }
  .nachzahlung { color: #c62828; font-weight: bold; }
  .guthaben { color: #2e7d32; font-weight: bold; }
  .section { margin-bottom: 16px; }
  .meta-table td { border: none; padding: 2px 10px 2px 0; }
  .meta-table { margin-bottom: 12px; }
  .footer { margin-top: 30px; font-size: 9px; color: #666; border-top: 1px solid #ccc; padding-top: 8px; text-align: center; }
  .signature { margin-top: 40px; display: flex; gap: 60px; }
  .signature div { flex: 1; }
  .signature .line { border-top: 1px solid #222; margin-top: 40px; padding-top: 4px; font-size: 10px; }
  ul { padding-left: 20px; }
  li { margin-bottom: 3px; }
</style>
</head>
<body>

<h1>Heizkostenabrechnung gem&auml;&szlig; HeizKG</h1>
<p style="font-size:13px; color:#555;">Heiz- und K&auml;ltekostenabrechnungsgesetz</p>

<div class="section">
  <table class="meta-table">
    <tr><td><strong>Objekt:</strong></td><td>${result.propertyName || ''}</td></tr>
    <tr><td><strong>Adresse:</strong></td><td>${result.propertyAddress || ''}, ${result.propertyPostalCode || ''} ${result.propertyCity || ''}</td></tr>
    <tr><td><strong>Abrechnungszeitraum:</strong></td><td>${formatDate(run.periodFrom)} bis ${formatDate(run.periodTo)}</td></tr>
    <tr><td><strong>Hausverwaltung:</strong></td><td>${org?.name || ''}</td></tr>
    ${org?.address ? `<tr><td></td><td>${org.address}, ${org.postalCode || ''} ${org.city || ''}</td></tr>` : ''}
    <tr><td><strong>Version:</strong></td><td>${run.version || 1}</td></tr>
    <tr><td><strong>Status:</strong></td><td>${run.status}</td></tr>
  </table>
</div>

<h2>Gesamtkosten-&Uuml;bersicht</h2>
<table>
  <tr><th>Kostenart</th><th class="num">Betrag (EUR)</th></tr>
  <tr><td>Heizung (Energiekosten)</td><td class="num">${formatEur(run.heatingSupplyCost)}</td></tr>
  <tr><td>Warmwasser (Energiekosten)</td><td class="num">${formatEur(run.hotWaterSupplyCost)}</td></tr>
  <tr><td>Wartung &amp; Instandhaltung</td><td class="num">${formatEur(run.maintenanceCost)}</td></tr>
  <tr><td>Messkosten (Ablesung)</td><td class="num">${formatEur(run.meterReadingCost)}</td></tr>
  <tr style="font-weight:bold;"><td>Gesamtkosten</td><td class="num">${formatEur(totalCosts)}</td></tr>
</table>

<h2>Verteilungsschl&uuml;ssel</h2>
<table>
  <tr><th>Kostenart</th><th class="num">Verbrauchsanteil</th><th class="num">Fl&auml;chenanteil</th></tr>
  <tr><td>Heizung</td><td class="num">${run.heatingConsumptionSharePct}%</td><td class="num">${run.heatingAreaSharePct}%</td></tr>
  <tr><td>Warmwasser</td><td class="num">${run.hotWaterConsumptionSharePct}%</td><td class="num">${run.hotWaterAreaSharePct}%</td></tr>
  <tr><td>Wartung</td><td class="num" colspan="2">nach Nutzfl&auml;che</td></tr>
  <tr><td>Messkosten</td><td class="num" colspan="2">pro Einheit (gleichm&auml;&szlig;ig)</td></tr>
</table>

<h2>Einzelabrechnung pro Einheit</h2>
<table>
  <tr>
    <th>Top-Nr</th><th>Mieter</th><th class="num">Fl&auml;che m&sup2;</th>
    <th class="num">Heizung Verbr.</th><th class="num">Heizung Fl.</th><th class="num">Heizung Ges.</th>
    <th class="num">WW Verbr.</th><th class="num">WW Fl.</th><th class="num">WW Ges.</th>
    <th class="num">Wartung</th><th class="num">Messk.</th><th class="num">Gesamt</th>
    <th class="num">Vorausz.</th><th class="num">Nachz./Guthaben</th>
  </tr>
  ${linesHtml}
</table>

${warningsHtml}

<h2>Pr&uuml;fprotokoll (HeizKG-Compliance)</h2>
<table>
  <tr><th style="width:30px"></th><th>Paragraph</th><th>Anforderung</th><th>Details</th></tr>
  ${complianceHtml}
</table>

<h2>Pflichtangaben</h2>
<table class="meta-table">
  <tr><td><strong>Abrechnungszeitraum:</strong></td><td>${formatDate(run.periodFrom)} bis ${formatDate(run.periodTo)}</td></tr>
  <tr><td><strong>Gesamtkosten:</strong></td><td>EUR ${formatEur(totalCosts)}</td></tr>
  <tr><td><strong>Verteilungsschl&uuml;ssel:</strong></td><td>Heizung: ${run.heatingConsumptionSharePct}% Verbrauch / ${run.heatingAreaSharePct}% Fl&auml;che | Warmwasser: ${run.hotWaterConsumptionSharePct}% / ${run.hotWaterAreaSharePct}%</td></tr>
  <tr><td><strong>Messverfahren:</strong></td><td>Heizkostenverteiler (HKV) bzw. W&auml;rmemengenz&auml;hler / Warmwasserz&auml;hler</td></tr>
  <tr><td><strong>Rechtsgrundlage:</strong></td><td>Heiz- und K&auml;ltekostenabrechnungsgesetz (HeizKG), BGBl. I Nr. 36/1992 idgF</td></tr>
</table>

<h2>Unterschrift</h2>
<div class="signature">
  <div>
    <p><strong>Erstellt durch:</strong> ${org?.name || ''}</p>
    <p><strong>Datum:</strong> ${new Date().toLocaleDateString('de-AT')}</p>
    <div class="line">Unterschrift / Stempel</div>
  </div>
  <div>
    <p><strong>Best&auml;tigung:</strong></p>
    <p>&nbsp;</p>
    <div class="line">Zur Kenntnis genommen</div>
  </div>
</div>

<h2>Anlagenverzeichnis</h2>
<ul>
  <li>Einzelabrechnungen pro Nutzeinheit</li>
  <li>Ableseprotokolle der Messger&auml;te</li>
  <li>Energielieferantenrechnungen</li>
  <li>Wartungsnachweise Heizanlage</li>
  <li>Pr&uuml;fprotokoll HeizKG-Konformit&auml;t</li>
</ul>

<div class="footer">
  Diese Abrechnung wurde gem&auml;&szlig; dem Heiz- und K&auml;ltekostenabrechnungsgesetz (HeizKG) erstellt.<br>
  Generiert am ${new Date().toLocaleDateString('de-AT')} um ${new Date().toLocaleTimeString('de-AT')} | ImmoFlowMe Hausverwaltungssoftware
</div>

</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
