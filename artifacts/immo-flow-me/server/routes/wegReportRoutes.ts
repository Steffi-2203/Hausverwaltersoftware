import { Router, Request, Response } from "express";
import * as XLSX from "xlsx";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { roundMoney } from "@shared/utils";
import { getAuthContext, checkMutationPermission, objectToSnakeCase, objectToCamelCase } from "./helpers";
import { calculateOwnerSettlement, getReserveFundBalance } from "../services/wegSettlementService";
import { getReserveFundOverview } from "../services/wegAccountingService";
import { getKautionOverview } from "../services/kautionService";
import { validateTrialBalance, getAccountBalances } from "../services/trialBalanceService";

const router = Router();

router.get("/api/weg/reports/jahresabrechnung/xlsx", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: "Keine Organisation zugewiesen" });

    const propertyId = req.query.propertyId as string;
    const year = parseInt(req.query.year as string, 10);
    if (!propertyId || !year) return res.status(400).json({ error: "propertyId und year erforderlich" });

    const [prop] = await db.select({ id: schema.properties.id }).from(schema.properties).where(and(eq(schema.properties.id, propertyId), eq(schema.properties.organizationId, ctx.orgId)));
    if (!prop) return res.status(403).json({ error: "Zugriff verweigert" });

    const { ownerResults, summary } = await calculateOwnerSettlement(propertyId, year, ctx.orgId);

    const wb = XLSX.utils.book_new();

    const summaryData: any[][] = [
      ["WEG Jahresabrechnung"],
      [],
      ["Liegenschaft", summary.propertyName],
      ["Jahr", summary.year],
      ["Gesamtkosten", roundMoney(summary.totalExpenses)],
      ["Vorauszahlungen gesamt", roundMoney(summary.totalPrepayments)],
      ["Differenz gesamt", roundMoney(summary.totalDifference)],
      ["Anzahl Eigentümer", summary.ownerCount],
      ["Gesamt-MEA", roundMoney(summary.totalMea)],
      ["Rücklagenstand", roundMoney(summary.reserveFundBalance)],
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    wsSummary["!cols"] = [{ wch: 25 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, "Zusammenfassung");

    const ownerHeader = ["Eigentümer", "Top", "MEA-Anteil", "Soll", "Ist (Vorauszahlungen)", "Saldo (Nachzahlung/Guthaben)", "Rücklage"];
    const ownerRows = ownerResults.map((r) => [
      r.ownerName,
      r.unitTop,
      roundMoney(r.meaShare),
      roundMoney(r.totalSoll),
      roundMoney(r.totalIst),
      roundMoney(r.saldo),
      roundMoney(r.ruecklageAnteil),
    ]);
    const wsOwners = XLSX.utils.aoa_to_sheet([ownerHeader, ...ownerRows]);
    wsOwners["!cols"] = [{ wch: 25 }, { wch: 10 }, { wch: 12 }, { wch: 15 }, { wch: 20 }, { wch: 28 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, wsOwners, "Eigentümer-Details");

    const catHeader = ["Eigentümer", "Top", "Kategorie", "Gesamtkosten", "Anteil Eigentümer", "Verteilerschlüssel"];
    const catRows: any[][] = [];
    for (const r of ownerResults) {
      for (const c of r.categories) {
        catRows.push([
          r.ownerName,
          r.unitTop,
          c.label,
          roundMoney(c.totalCost),
          roundMoney(c.ownerShare),
          c.allocationKey,
        ]);
      }
    }
    const wsCats = XLSX.utils.aoa_to_sheet([catHeader, ...catRows]);
    wsCats["!cols"] = [{ wch: 25 }, { wch: 10 }, { wch: 25 }, { wch: 15 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsCats, "Kostenverteilung");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="WEG_Jahresabrechnung_${year}.xlsx"`);
    res.send(buffer);
  } catch (error: any) {
    console.error("Error exporting Jahresabrechnung XLSX:", error);
    res.status(500).json({ error: error.message || "Fehler beim Exportieren der Jahresabrechnung" });
  }
});

router.get("/api/weg/reports/ruecklagen/xlsx", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: "Keine Organisation zugewiesen" });

    const propertyId = req.query.propertyId as string;
    if (!propertyId) return res.status(400).json({ error: "propertyId erforderlich" });

    const [prop] = await db.select({ id: schema.properties.id }).from(schema.properties).where(and(eq(schema.properties.id, propertyId), eq(schema.properties.organizationId, ctx.orgId)));
    if (!prop) return res.status(403).json({ error: "Zugriff verweigert" });

    const overview = await getReserveFundOverview(propertyId, ctx.orgId);

    const totalContributions = roundMoney(
      Object.values(overview.entriesByYear)
        .flat()
        .filter((e) => Number(e.amount) > 0 && e.entryType !== "zinsen")
        .reduce((sum, e) => sum + Number(e.amount), 0)
    );

    const wb = XLSX.utils.book_new();

    const overviewData: any[][] = [
      ["WEG Rücklagenübersicht"],
      [],
      ["Aktueller Saldo", roundMoney(overview.currentBalance)],
      ["Einzahlungen gesamt", totalContributions],
      ["Entnahmen gesamt", roundMoney(overview.totalWithdrawals)],
      ["Zinserträge", roundMoney(overview.interestEarned)],
      ["Sonderumlagen gesamt", roundMoney(overview.sonderumlagenTotal)],
    ];
    const wsOverview = XLSX.utils.aoa_to_sheet(overviewData);
    wsOverview["!cols"] = [{ wch: 25 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsOverview, "Übersicht");

    const allEntries = Object.values(overview.entriesByYear)
      .flat()
      .sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateA - dateB;
      });

    const movHeader = ["Datum", "Typ", "Betrag", "Beschreibung", "Saldo"];
    const movRows: any[][] = [];
    let runningBalance = 0;
    for (const entry of allEntries) {
      const amount = Number(entry.amount) || 0;
      runningBalance = roundMoney(runningBalance + amount);
      const dateStr = entry.createdAt
        ? new Date(entry.createdAt).toLocaleDateString("de-AT")
        : `${entry.year}/${String(entry.month).padStart(2, "0")}`;
      movRows.push([
        dateStr,
        entry.entryType || "",
        roundMoney(amount),
        entry.description || "",
        runningBalance,
      ]);
    }
    const wsMov = XLSX.utils.aoa_to_sheet([movHeader, ...movRows]);
    wsMov["!cols"] = [{ wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 40 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, wsMov, "Bewegungen");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="WEG_Ruecklage_${propertyId}.xlsx"`);
    res.send(buffer);
  } catch (error: any) {
    console.error("Error exporting Rücklagen XLSX:", error);
    res.status(500).json({ error: error.message || "Fehler beim Exportieren der Rücklagenübersicht" });
  }
});

router.get("/api/weg/reports/kautionen/xlsx", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: "Keine Organisation zugewiesen" });

    const overview = await getKautionOverview(ctx.orgId);

    const allKautionen = await db
      .select({
        kaution: schema.kautionen,
        tenant: schema.tenants,
        unit: schema.units,
      })
      .from(schema.kautionen)
      .innerJoin(schema.tenants, eq(schema.kautionen.tenantId, schema.tenants.id))
      .innerJoin(schema.units, eq(schema.kautionen.unitId, schema.units.id))
      .where(eq(schema.kautionen.organizationId, ctx.orgId))
      .orderBy(desc(schema.kautionen.createdAt));

    const wb = XLSX.utils.book_new();

    const overviewData: any[][] = [
      ["Kautionsübersicht"],
      [],
      ["Aktive Kautionen", overview.totalActive],
      ["Gesamtbetrag aktiv", roundMoney(overview.totalActiveAmount)],
      ["Aufgelaufene Zinsen", roundMoney(overview.totalAccruedInterest)],
      ["Gesamtbetrag verwahrt", roundMoney(overview.totalAmountHeld)],
      ["Rückzahlungen ausstehend", overview.pendingReturnCount],
      ["Betrag ausstehende Rückzahlungen", roundMoney(overview.totalPendingReturn)],
      ["Bereits zurückgezahlt", overview.totalReturned],
    ];
    const wsOverview = XLSX.utils.aoa_to_sheet(overviewData);
    wsOverview["!cols"] = [{ wch: 30 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsOverview, "Übersicht");

    const detHeader = ["Mieter", "Einheit", "Betrag", "Zinssatz", "Aufgelaufene Zinsen", "Status", "Eingangsdatum", "Treuhandkonto"];
    const detRows = allKautionen.map((row) => {
      const k = row.kaution;
      const tenantName = `${row.tenant.firstName || ""} ${row.tenant.lastName || ""}`.trim();
      const unitLabel = row.unit.topNummer || row.unit.name || "";
      return [
        tenantName,
        unitLabel,
        roundMoney(parseFloat(String(k.betrag || "0"))),
        parseFloat(String(k.zinssatz || "0")),
        roundMoney(parseFloat(String(k.aufgelaufeneZinsen || "0"))),
        k.status || "",
        k.eingangsdatum || "",
        k.treuhandkontoBank || "",
      ];
    });
    const wsDetails = XLSX.utils.aoa_to_sheet([detHeader, ...detRows]);
    wsDetails["!cols"] = [{ wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 15 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(wb, wsDetails, "Details");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Kautionsuebersicht.xlsx"`);
    res.send(buffer);
  } catch (error: any) {
    console.error("Error exporting Kautionen XLSX:", error);
    res.status(500).json({ error: error.message || "Fehler beim Exportieren der Kautionsübersicht" });
  }
});

router.get("/api/weg/reports/saldenliste/xlsx", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: "Keine Organisation zugewiesen" });

    const propertyId = req.query.propertyId as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    if (propertyId) {
      const [prop] = await db.select({ id: schema.properties.id }).from(schema.properties).where(and(eq(schema.properties.id, propertyId), eq(schema.properties.organizationId, ctx.orgId)));
      if (!prop) return res.status(403).json({ error: "Zugriff verweigert" });
    }

    const balances = await getAccountBalances(ctx.orgId, propertyId, from, to);

    const wb = XLSX.utils.book_new();

    const header = ["Konto-Nr", "Kontoname", "Soll", "Haben", "Saldo"];
    const rows = balances.map((b) => [
      b.kontoNummer,
      b.kontoName,
      roundMoney(b.totalSoll),
      roundMoney(b.totalHaben),
      roundMoney(b.saldo),
    ]);

    const totalSoll = roundMoney(balances.reduce((s, b) => s + b.totalSoll, 0));
    const totalHaben = roundMoney(balances.reduce((s, b) => s + b.totalHaben, 0));
    const totalSaldo = roundMoney(balances.reduce((s, b) => s + b.saldo, 0));
    rows.push(["", "Summen", totalSoll, totalHaben, totalSaldo]);

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws["!cols"] = [{ wch: 12 }, { wch: 30 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, ws, "Saldenliste");

    const fromLabel = from || "Beginn";
    const toLabel = to || "Ende";
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Saldenliste_${fromLabel}_${toLabel}.xlsx"`);
    res.send(buffer);
  } catch (error: any) {
    console.error("Error exporting Saldenliste XLSX:", error);
    res.status(500).json({ error: error.message || "Fehler beim Exportieren der Saldenliste" });
  }
});

router.get("/api/weg/reports/trial-balance", async (req: Request, res: Response) => {
  try {
    const ctx = await getAuthContext(req, res);
    if (!ctx) return;
    if (!ctx.orgId) return res.status(403).json({ error: "Keine Organisation zugewiesen" });

    const propertyId = req.query.propertyId as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    if (propertyId) {
      const [prop] = await db.select({ id: schema.properties.id }).from(schema.properties).where(and(eq(schema.properties.id, propertyId), eq(schema.properties.organizationId, ctx.orgId)));
      if (!prop) return res.status(403).json({ error: "Zugriff verweigert" });
    }

    const result = await validateTrialBalance(ctx.orgId, propertyId, from, to, true);
    res.json(objectToSnakeCase(result));
  } catch (error: any) {
    console.error("Error validating trial balance:", error);
    res.status(500).json({ error: error.message || "Fehler bei der Saldenprüfung" });
  }
});

export default router;
