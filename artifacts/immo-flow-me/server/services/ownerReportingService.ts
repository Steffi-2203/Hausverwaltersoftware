import { db } from "../db";
import { properties, units, tenants, monthlyInvoices, payments, expenses, owners, propertyOwners } from "@shared/schema";
import { eq, and, gte, lte, isNull, sum, count, sql, inArray } from "drizzle-orm";
import { format, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear, subMonths } from "date-fns";
import { de } from "date-fns/locale";

interface OwnerReportSummary {
  ownerId: string;
  ownerName: string;
  properties: Array<{
    propertyId: string;
    propertyName: string;
    totalUnits: number;
    occupiedUnits: number;
    vacancyRate: number;
    income: {
      rent: number;
      operatingCosts: number;
      total: number;
    };
    expenses: {
      maintenance: number;
      operatingCosts: number;
      other: number;
      total: number;
    };
    netIncome: number;
    receivables: {
      total: number;
      overdue: number;
    };
  }>;
  totals: {
    totalIncome: number;
    totalExpenses: number;
    netIncome: number;
    totalReceivables: number;
    overdueReceivables: number;
    vacancyRate: number;
  };
}

type ReportPeriod = 'month' | 'quarter' | 'year';

export class OwnerReportingService {
  private getPeriodDates(period: ReportPeriod, referenceDate: Date = new Date()): { start: Date; end: Date } {
    switch (period) {
      case 'month':
        return { start: startOfMonth(referenceDate), end: endOfMonth(referenceDate) };
      case 'quarter':
        return { start: startOfQuarter(referenceDate), end: endOfQuarter(referenceDate) };
      case 'year':
        return { start: startOfYear(referenceDate), end: endOfYear(referenceDate) };
    }
  }

  async generateOwnerReport(
    organizationId: string,
    ownerId: string,
    period: ReportPeriod = 'month',
    referenceDate: Date = new Date()
  ): Promise<OwnerReportSummary | null> {
    const owner = await db.select().from(owners)
      .where(and(
        eq(owners.id, ownerId),
        eq(owners.organizationId, organizationId)
      ))
      .limit(1);

    if (!owner[0]) return null;

    const ownerProperties = await db.select({
      property: properties,
    })
      .from(propertyOwners)
      .innerJoin(properties, eq(propertyOwners.propertyId, properties.id))
      .where(and(
        eq(propertyOwners.ownerId, ownerId),
        eq(properties.organizationId, organizationId),
        isNull(properties.deletedAt)
      ));

    const { start, end } = this.getPeriodDates(period, referenceDate);
    const propertyReports: OwnerReportSummary['properties'] = [];

    for (const { property } of ownerProperties) {
      const propertyUnits = await db.select().from(units)
        .where(and(
          eq(units.propertyId, property.id),
          isNull(units.deletedAt)
        ));

      const unitIds = propertyUnits.map(u => u.id);
      const occupiedUnits = propertyUnits.filter(u => u.status === 'aktiv').length;
      const totalUnits = propertyUnits.length;
      const vacancyRate = totalUnits > 0 ? ((totalUnits - occupiedUnits) / totalUnits) * 100 : 0;

      let rentIncome = 0;
      let operatingCostsIncome = 0;
      let totalReceivables = 0;
      let overdueReceivables = 0;

      if (unitIds.length > 0) {
        const propertyTenants = await db.select().from(tenants)
          .where(inArray(tenants.unitId, unitIds));
        const tenantIds = propertyTenants.map(t => t.id);

        if (tenantIds.length > 0) {
          const invoices = await db.select().from(monthlyInvoices)
            .where(and(
              inArray(monthlyInvoices.tenantId, tenantIds),
              gte(monthlyInvoices.createdAt, start),
              lte(monthlyInvoices.createdAt, end)
            ));

          for (const inv of invoices) {
            rentIncome += Number(inv.grundmiete) || 0;
            operatingCostsIncome += (Number(inv.betriebskosten) || 0) + (Number(inv.heizungskosten) || 0);
            
            if (inv.status !== 'bezahlt') {
              totalReceivables += Number(inv.gesamtbetrag) || 0;
              if (inv.status === 'ueberfaellig') {
                overdueReceivables += Number(inv.gesamtbetrag) || 0;
              }
            }
          }
        }
      }

      const propertyExpenses = await db.select().from(expenses)
        .where(and(
          eq(expenses.propertyId, property.id),
          gte(expenses.datum, start.toISOString()),
          lte(expenses.datum, end.toISOString())
        ));

      let maintenanceExpenses = 0;
      let operatingExpenses = 0;
      let otherExpenses = 0;

      for (const exp of propertyExpenses) {
        const amount = Number(exp.betrag) || 0;
        if (exp.category?.includes('Reparatur') || exp.category?.includes('Instandhaltung')) {
          maintenanceExpenses += amount;
        } else if (exp.isOperatingCost) {
          operatingExpenses += amount;
        } else {
          otherExpenses += amount;
        }
      }

      const totalIncome = rentIncome + operatingCostsIncome;
      const totalExpensesAmount = maintenanceExpenses + operatingExpenses + otherExpenses;

      propertyReports.push({
        propertyId: property.id,
        propertyName: property.name || 'Unbenannt',
        totalUnits,
        occupiedUnits,
        vacancyRate,
        income: {
          rent: rentIncome,
          operatingCosts: operatingCostsIncome,
          total: totalIncome,
        },
        expenses: {
          maintenance: maintenanceExpenses,
          operatingCosts: operatingExpenses,
          other: otherExpenses,
          total: totalExpensesAmount,
        },
        netIncome: totalIncome - totalExpensesAmount,
        receivables: {
          total: totalReceivables,
          overdue: overdueReceivables,
        },
      });
    }

    const totals = propertyReports.reduce((acc, p) => ({
      totalIncome: acc.totalIncome + p.income.total,
      totalExpenses: acc.totalExpenses + p.expenses.total,
      netIncome: acc.netIncome + p.netIncome,
      totalReceivables: acc.totalReceivables + p.receivables.total,
      overdueReceivables: acc.overdueReceivables + p.receivables.overdue,
      totalUnits: acc.totalUnits + p.totalUnits,
      occupiedUnits: acc.occupiedUnits + p.occupiedUnits,
    }), {
      totalIncome: 0,
      totalExpenses: 0,
      netIncome: 0,
      totalReceivables: 0,
      overdueReceivables: 0,
      totalUnits: 0,
      occupiedUnits: 0,
    });

    return {
      ownerId,
      ownerName: owner[0].name || 'Unbekannt',
      properties: propertyReports,
      totals: {
        ...totals,
        vacancyRate: totals.totalUnits > 0 
          ? ((totals.totalUnits - totals.occupiedUnits) / totals.totalUnits) * 100 
          : 0,
      },
    };
  }

  generateReportHtml(report: OwnerReportSummary, period: string): string {
    const formatCurrency = (amount: number) => 
      new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(amount);

    return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>Eigentümerbericht - ${report.ownerName}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 12px; margin: 40px; }
    h1 { font-size: 18px; margin-bottom: 5px; }
    h2 { font-size: 14px; margin-top: 20px; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f5f5f5; }
    .text-right { text-align: right; }
    .text-green { color: #16a34a; }
    .text-red { color: #dc2626; }
    .summary-box { background: #f9f9f9; padding: 15px; margin: 20px 0; border-radius: 5px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin: 20px 0; }
    .kpi-card { background: #fff; border: 1px solid #ddd; padding: 15px; border-radius: 5px; }
    .kpi-value { font-size: 24px; font-weight: bold; }
    .kpi-label { font-size: 11px; color: #666; }
  </style>
</head>
<body>
  <h1>Eigentümerbericht</h1>
  <p><strong>${report.ownerName}</strong> | Zeitraum: ${period} | Erstellt: ${format(new Date(), 'dd.MM.yyyy HH:mm', { locale: de })}</p>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-value ${report.totals.netIncome >= 0 ? 'text-green' : 'text-red'}">${formatCurrency(report.totals.netIncome)}</div>
      <div class="kpi-label">Netto-Ertrag</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value">${formatCurrency(report.totals.totalIncome)}</div>
      <div class="kpi-label">Gesamteinnahmen</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value">${formatCurrency(report.totals.totalExpenses)}</div>
      <div class="kpi-label">Gesamtausgaben</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value">${report.totals.vacancyRate.toFixed(1)}%</div>
      <div class="kpi-label">Leerstandsquote</div>
    </div>
  </div>

  <h2>Immobilienübersicht</h2>
  <table>
    <thead>
      <tr>
        <th>Immobilie</th>
        <th class="text-right">Einheiten</th>
        <th class="text-right">Belegt</th>
        <th class="text-right">Einnahmen</th>
        <th class="text-right">Ausgaben</th>
        <th class="text-right">Netto</th>
        <th class="text-right">Offene Posten</th>
      </tr>
    </thead>
    <tbody>
      ${report.properties.map(p => `
      <tr>
        <td>${p.propertyName}</td>
        <td class="text-right">${p.totalUnits}</td>
        <td class="text-right">${p.occupiedUnits}</td>
        <td class="text-right">${formatCurrency(p.income.total)}</td>
        <td class="text-right">${formatCurrency(p.expenses.total)}</td>
        <td class="text-right ${p.netIncome >= 0 ? 'text-green' : 'text-red'}">${formatCurrency(p.netIncome)}</td>
        <td class="text-right ${p.receivables.overdue > 0 ? 'text-red' : ''}">${formatCurrency(p.receivables.total)}</td>
      </tr>
      `).join('')}
    </tbody>
    <tfoot>
      <tr style="font-weight: bold; background: #f5f5f5;">
        <td>Gesamt</td>
        <td class="text-right">${report.properties.reduce((s, p) => s + p.totalUnits, 0)}</td>
        <td class="text-right">${report.properties.reduce((s, p) => s + p.occupiedUnits, 0)}</td>
        <td class="text-right">${formatCurrency(report.totals.totalIncome)}</td>
        <td class="text-right">${formatCurrency(report.totals.totalExpenses)}</td>
        <td class="text-right ${report.totals.netIncome >= 0 ? 'text-green' : 'text-red'}">${formatCurrency(report.totals.netIncome)}</td>
        <td class="text-right">${formatCurrency(report.totals.totalReceivables)}</td>
      </tr>
    </tfoot>
  </table>

  ${report.totals.overdueReceivables > 0 ? `
  <div class="summary-box" style="border-left: 4px solid #dc2626;">
    <strong>Achtung:</strong> Es gibt überfällige Forderungen in Höhe von ${formatCurrency(report.totals.overdueReceivables)}.
  </div>
  ` : ''}

  <div style="margin-top: 40px; font-size: 10px; color: #666;">
    <p>Dieser Bericht wurde automatisch erstellt und dient nur zu Informationszwecken.</p>
  </div>
</body>
</html>`;
  }
}

export const ownerReportingService = new OwnerReportingService();
