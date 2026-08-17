import { db } from "../db";
import { eq, and, gte, lte, isNull, inArray } from "drizzle-orm";
import {
  properties, units, tenants, monthlyInvoices, payments, expenses,
  chartOfAccounts, journalEntries, journalEntryLines,
} from "@shared/schema";
import { sendEmail } from "../lib/resend";

const REPORT_TYPES = ['saldenliste', 'bilanz', 'guv', 'op_liste', 'vacancy'] as const;
export type ReportType = typeof REPORT_TYPES[number];

const REPORT_LABELS: Record<string, string> = {
  saldenliste: 'Saldenliste',
  bilanz: 'Bilanz',
  guv: 'Gewinn- und Verlustrechnung',
  op_liste: 'Offene Posten',
  vacancy: 'Leerstandsbericht',
};

function escapeCsv(value: any): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes(';')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsvRow(values: any[]): string {
  return values.map(escapeCsv).join(';') + '\n';
}

async function generateSaldenliste(orgId: string, propertyId?: string): Promise<Buffer> {
  const accounts = await db.select().from(chartOfAccounts)
    .where(eq(chartOfAccounts.organizationId, orgId));

  let csv = '\uFEFF';
  csv += toCsvRow(['Kontonummer', 'Kontobezeichnung', 'Kontotyp', 'Soll', 'Haben', 'Saldo']);

  for (const account of accounts) {
    const lines = await db.select().from(journalEntryLines)
      .where(eq(journalEntryLines.accountId, account.id));

    let debit = 0;
    let credit = 0;
    for (const line of lines) {
      debit += Number(line.debit || 0);
      credit += Number(line.credit || 0);
    }
    const saldo = debit - credit;
    csv += toCsvRow([account.accountNumber, account.name, account.accountType, debit.toFixed(2), credit.toFixed(2), saldo.toFixed(2)]);
  }

  return Buffer.from(csv, 'utf-8');
}

async function generateBilanz(orgId: string): Promise<Buffer> {
  const accounts = await db.select().from(chartOfAccounts)
    .where(and(
      eq(chartOfAccounts.organizationId, orgId),
    ));

  const balanceAccounts = accounts.filter(a => ['asset', 'liability', 'equity', 'aktiva', 'passiva'].includes(a.accountType || ''));

  let csv = '\uFEFF';
  csv += toCsvRow(['Kontonummer', 'Kontobezeichnung', 'Kontotyp', 'Saldo']);

  for (const account of balanceAccounts) {
    const lines = await db.select().from(journalEntryLines)
      .where(eq(journalEntryLines.accountId, account.id));

    let saldo = 0;
    for (const line of lines) {
      saldo += Number(line.debit || 0) - Number(line.credit || 0);
    }
    csv += toCsvRow([account.accountNumber, account.name, account.accountType, saldo.toFixed(2)]);
  }

  return Buffer.from(csv, 'utf-8');
}

async function generateGuV(orgId: string): Promise<Buffer> {
  const accounts = await db.select().from(chartOfAccounts)
    .where(eq(chartOfAccounts.organizationId, orgId));

  const pnlAccounts = accounts.filter(a => ['revenue', 'expense', 'ertrag', 'aufwand'].includes(a.accountType || ''));

  let csv = '\uFEFF';
  csv += toCsvRow(['Kontonummer', 'Kontobezeichnung', 'Kontotyp', 'Betrag']);

  let totalRevenue = 0;
  let totalExpense = 0;

  for (const account of pnlAccounts) {
    const lines = await db.select().from(journalEntryLines)
      .where(eq(journalEntryLines.accountId, account.id));

    let amount = 0;
    for (const line of lines) {
      amount += Number(line.credit || 0) - Number(line.debit || 0);
    }

    if (['revenue', 'ertrag'].includes(account.accountType || '')) {
      totalRevenue += amount;
    } else {
      totalExpense += Math.abs(amount);
    }

    csv += toCsvRow([account.accountNumber, account.name, account.accountType, amount.toFixed(2)]);
  }

  csv += toCsvRow([]);
  csv += toCsvRow(['', 'Gesamtertrag', '', totalRevenue.toFixed(2)]);
  csv += toCsvRow(['', 'Gesamtaufwand', '', totalExpense.toFixed(2)]);
  csv += toCsvRow(['', 'Ergebnis', '', (totalRevenue - totalExpense).toFixed(2)]);

  return Buffer.from(csv, 'utf-8');
}

async function generateOpListe(orgId: string, propertyId?: string): Promise<Buffer> {
  const propertyFilter = propertyId
    ? and(eq(properties.organizationId, orgId), eq(properties.id, propertyId))
    : eq(properties.organizationId, orgId);

  const propertiesData = await db.select().from(properties).where(propertyFilter);
  const propertyIds = propertiesData.map(p => p.id);

  if (propertyIds.length === 0) {
    return Buffer.from('\uFEFFKeine Daten vorhanden\n', 'utf-8');
  }

  const unitsData = await db.select().from(units).where(inArray(units.propertyId, propertyIds));
  const unitIds = unitsData.map(u => u.id);

  const invoices = unitIds.length > 0
    ? await db.select().from(monthlyInvoices).where(and(
        inArray(monthlyInvoices.unitId, unitIds),
        eq(monthlyInvoices.status, 'offen'),
      ))
    : [];

  let csv = '\uFEFF';
  csv += toCsvRow(['Einheit', 'Mieter', 'Monat', 'Jahr', 'Gesamtbetrag', 'Status', 'Fällig am']);

  for (const inv of invoices) {
    const unit = unitsData.find(u => u.id === inv.unitId);
    let tenantName = 'Leerstand';
    if (inv.tenantId) {
      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, inv.tenantId)).limit(1);
      if (tenant) tenantName = `${tenant.firstName} ${tenant.lastName}`;
    }
    csv += toCsvRow([
      unit?.topNummer || '',
      tenantName,
      inv.month,
      inv.year,
      Number(inv.gesamtbetrag || 0).toFixed(2),
      inv.status,
      inv.faelligAm || '',
    ]);
  }

  return Buffer.from(csv, 'utf-8');
}

async function generateVacancy(orgId: string, propertyId?: string): Promise<Buffer> {
  const propertyFilter = propertyId
    ? and(eq(properties.organizationId, orgId), eq(properties.id, propertyId))
    : eq(properties.organizationId, orgId);

  const propertiesData = await db.select().from(properties).where(propertyFilter);
  const propertyIds = propertiesData.map(p => p.id);

  if (propertyIds.length === 0) {
    return Buffer.from('\uFEFFKeine Daten vorhanden\n', 'utf-8');
  }

  const unitsData = await db.select().from(units).where(and(
    inArray(units.propertyId, propertyIds),
    eq(units.status, 'leerstand'),
  ));

  let csv = '\uFEFF';
  csv += toCsvRow(['Liegenschaft', 'Top-Nummer', 'Typ', 'Fläche (m²)', 'Leerstand BK', 'Leerstand HK']);

  for (const unit of unitsData) {
    const prop = propertiesData.find(p => p.id === unit.propertyId);
    csv += toCsvRow([
      prop?.name || '',
      unit.topNummer,
      unit.type || '',
      unit.flaeche || '',
      Number(unit.leerstandBk || 0).toFixed(2),
      Number(unit.leerstandHk || 0).toFixed(2),
    ]);
  }

  return Buffer.from(csv, 'utf-8');
}

export async function generateScheduledReport(orgId: string, reportType: string, propertyId?: string): Promise<Buffer> {
  switch (reportType) {
    case 'saldenliste': return generateSaldenliste(orgId, propertyId);
    case 'bilanz': return generateBilanz(orgId);
    case 'guv': return generateGuV(orgId);
    case 'op_liste': return generateOpListe(orgId, propertyId);
    case 'vacancy': return generateVacancy(orgId, propertyId);
    default: throw new Error(`Unbekannter Berichtstyp: ${reportType}`);
  }
}

export async function sendScheduledReport(
  orgId: string,
  reportType: string,
  recipients: string[],
  propertyId?: string
): Promise<void> {
  const csvBuffer = await generateScheduledReport(orgId, reportType, propertyId);
  const label = REPORT_LABELS[reportType] || reportType;
  const now = new Date();
  const dateStr = now.toLocaleDateString('de-AT');
  const filename = `${reportType}_${now.toISOString().slice(0, 10)}.csv`;

  // sendEmail wirft bei Resend-{error}-Antworten — der Scheduler aktualisiert
  // lastRun/nextRun dadurch nur nach tatsächlich erfolgreichem Versand.
  await sendEmail({
    to: recipients,
    subject: `Geplanter Bericht: ${label} - ${dateStr}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 20px;">ImmoFlowMe - Geplanter Bericht</h1>
        </div>
        <div style="background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <h2 style="color: #1f2937; margin-top: 0;">${label}</h2>
          <p>Ihr geplanter Bericht <strong>${label}</strong> vom ${dateStr} ist als CSV-Datei angehängt.</p>
          <p style="color: #6b7280; font-size: 13px;">Dieser Bericht wurde automatisch generiert.</p>
        </div>
      </div>
    `,
    attachments: [
      {
        filename,
        content: csvBuffer.toString('base64'),
        content_type: 'text/csv',
      },
    ],
  });

  console.log(`[ScheduledReports] Report ${reportType} sent to ${recipients.join(', ')} for org ${orgId}`);
}

export function parseNextRun(cronExpression: string, fromDate: Date = new Date()): Date {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) {
    const next = new Date(fromDate);
    next.setDate(next.getDate() + 1);
    next.setHours(8, 0, 0, 0);
    return next;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const min = minute === '*' ? 0 : parseInt(minute);
  const hr = hour === '*' ? 8 : parseInt(hour);

  const next = new Date(fromDate);
  next.setSeconds(0, 0);
  next.setMinutes(min);
  next.setHours(hr);

  if (dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') {
    const dom = parseInt(dayOfMonth);
    if (next <= fromDate || next.getDate() !== dom) {
      next.setDate(dom);
      if (next <= fromDate) {
        next.setMonth(next.getMonth() + 1);
        next.setDate(dom);
      }
    }
    return next;
  }

  if (dayOfWeek !== '*' && dayOfMonth === '*') {
    const targetDow = parseInt(dayOfWeek);
    const currentDow = next.getDay();
    let daysUntil = targetDow - currentDow;
    if (daysUntil < 0) daysUntil += 7;
    if (daysUntil === 0 && next <= fromDate) daysUntil = 7;
    next.setDate(next.getDate() + daysUntil);
    return next;
  }

  if (next <= fromDate) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}
