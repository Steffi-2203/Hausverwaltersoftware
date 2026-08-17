import { v4 as uuidv4 } from 'uuid';
import { db } from "../db";
import { invoiceGenerator } from "./invoice.generator";
import { roundMoney } from "@shared/utils";
import { normalizeDescription } from "../lib/normalizeDescription";
import { sql, eq, inArray } from "drizzle-orm";
import {
  monthlyInvoices,
  invoiceLines,
  tenants,
  units,
  auditLogs,
  invoiceRuns
} from "@shared/schema";

type GenerateOpts = {
  userId: string;
  organizationId: string;
  propertyIds: string[];
  year: number;
  month: number;
  dryRun?: boolean;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Rundungsausgleich: Verteilt Cent-Differenzen auf Zeilen, damit die Summe
 * exakt expectedTotal ergibt. Toleranz: < 0.01 € wird ignoriert.
 * 
 * Sortierung: Primär nach |amount| desc, sekundär nach lineType + unitId
 * für deterministische Ergebnisse bei gleichen Beträgen.
 * 
 * Fail-fast: Wenn nach 2× lines.length Iterationen noch >= 0.01 € Differenz
 * verbleibt, wird ein Fehler geworfen — das darf bei korrekten Eingaben nie
 * passieren und deutet auf einen Logikfehler hin.
 */
export function reconcileRounding(lines: any[], expectedTotal: number): void {
  const roundedSum = lines.reduce((s, l) => s + roundMoney(l.amount || 0), 0);
  let diff = roundMoney(expectedTotal - roundedSum);
  if (Math.abs(diff) < 0.01) return;

  lines.sort((a, b) => {
    const amtDiff = Math.abs(b.amount || 0) - Math.abs(a.amount || 0);
    if (amtDiff !== 0) return amtDiff;
    const ltCmp = (a.lineType || '').localeCompare(b.lineType || '');
    if (ltCmp !== 0) return ltCmp;
    return (a.unitId || '').localeCompare(b.unitId || '');
  });
  let i = 0;
  const maxIterations = lines.length * 2;
  while (Math.abs(diff) >= 0.01 && i < maxIterations) {
    const adjust = diff > 0 ? 0.01 : -0.01;
    lines[i % lines.length].amount = roundMoney(lines[i % lines.length].amount + adjust);
    diff = roundMoney(diff - adjust);
    i++;
  }
  if (Math.abs(diff) >= 0.01) {
    console.error(`[reconcileRounding] FEHLER: Restdifferenz ${diff.toFixed(4)} € nach ${maxIterations} Iterationen. Expected=${expectedTotal}, Sum=${roundedSum}, Lines=${lines.length}`);
    throw new Error(`Rundungsausgleich gescheitert: Restdifferenz ${diff.toFixed(4)} € (Toleranz: < 0.01 €)`);
  }
}

function unitTypeFromTenant(unitId: string | null, unitTypeMap: Map<string, string>) {
  if (!unitId) return 'wohnung';
  return unitTypeMap.get(unitId) || 'wohnung';
}

export class BillingService {
  async generateMonthlyInvoices(opts: GenerateOpts) {
    if (!opts.organizationId) {
      throw new Error("organizationId ist ein Pflichtfeld für die Rechnungsgenerierung");
    }
    const { userId, organizationId, propertyIds, year, month, dryRun = true } = opts;
    const runId = uuidv4();
    const period = `${year}-${String(month).padStart(2, '0')}`;
    const isJanuary = month === 1;
    const dueDate = new Date(year, month - 1, 5).toISOString().split('T')[0];

    const unitsData = await db.select().from(units).where(inArray(units.propertyId, propertyIds));
    const unitIds = unitsData.map(u => u.id);
    const unitTypeMap = new Map(unitsData.map(u => [u.id, u.type || 'wohnung']));

    const tenantsData = await db.select().from(tenants).where(
      sql`${tenants.unitId} IN (${sql.join(unitIds.map(id => sql`${id}`), sql`, `)}) AND ${tenants.status} = 'aktiv'`
    );

    const vacancyTenants = await db.select().from(tenants).where(
      sql`${tenants.unitId} IN (${sql.join(unitIds.map(id => sql`${id}`), sql`, `)}) AND ${tenants.status} = 'leerstand'`
    );

    const carryForwardMap = new Map<string, any>();
    if (isJanuary) {
      for (const t of tenantsData) {
        carryForwardMap.set(t.id, { vortragMiete: 0, vortragBk: 0, vortragHk: 0, vortragSonstige: 0 });
      }
    }

    const invoicesToCreate = tenantsData.map(t => {
      const unitType = unitTypeMap.get(t.unitId || '') || 'wohnung';
      const carryForward = carryForwardMap.get(t.id) || { vortragMiete: 0, vortragBk: 0, vortragHk: 0, vortragSonstige: 0 };
      return invoiceGenerator.buildInvoiceData(t, unitType, year, month, dueDate, carryForward);
    });

    for (const vt of vacancyTenants) {
      const unit = unitsData.find(u => u.id === vt.unitId);
      const unitType = unitTypeMap.get(vt.unitId || '') || 'wohnung';
      const vatRates = invoiceGenerator.getVatRates(unitType);
      const bk = roundMoney(Number(unit?.leerstandBk ?? vt.betriebskostenVorschuss) || 0);
      const hk = roundMoney(Number(unit?.leerstandHk ?? vt.heizkostenVorschuss) || 0);
      const ust = roundMoney(
        invoiceGenerator.calculateVatFromGross(bk, vatRates.ustSatzBk) +
        invoiceGenerator.calculateVatFromGross(hk, vatRates.ustSatzHeizung)
      );
      const gesamtbetrag = roundMoney(bk + hk);
      invoicesToCreate.push({
        tenantId: vt.id,
        unitId: vt.unitId,
        year,
        month,
        grundmiete: 0,
        betriebskosten: bk,
        heizungskosten: hk,
        gesamtbetrag,
        ust,
        ustSatzMiete: vatRates.ustSatzMiete,
        ustSatzBk: vatRates.ustSatzBk,
        ustSatzHeizung: vatRates.ustSatzHeizung,
        status: "offen" as const,
        faelligAm: dueDate,
        vortragMiete: 0,
        vortragBk: 0,
        vortragHk: 0,
        vortragSonstige: 0,
        isVacancy: true,
      });
    }

    if (dryRun) {
      const preview = [];
      for (const inv of invoicesToCreate) {
        const id = `preview-${inv.tenantId}-${inv.year}-${inv.month}`;
        const vatRates = invoiceGenerator.getVatRates(unitTypeFromTenant(inv.unitId, unitTypeMap));
        const isVacancyPreview = (inv as any).isVacancy === true;
        let tenant = tenantsData.find(x => x.id === inv.tenantId);
        if (!tenant && isVacancyPreview) {
          const vt = vacancyTenants.find(x => x.id === inv.tenantId);
          if (vt) {
            const unit = unitsData.find(u => u.id === vt.unitId);
            tenant = {
              ...vt,
              grundmiete: '0',
              betriebskostenVorschuss: String(unit?.leerstandBk ?? vt.betriebskostenVorschuss ?? '0'),
              heizkostenVorschuss: String(unit?.leerstandHk ?? vt.heizkostenVorschuss ?? '0'),
              wasserkostenVorschuss: '0',
              sonstigeKosten: null,
            } as typeof tenants.$inferSelect;
          }
        }
        if (tenant) {
          const rawLines = invoiceGenerator.buildInvoiceLines(id, tenant, vatRates, month, year);
          const validLines = rawLines.filter(l => roundMoney(l.amount) > 0 && l.lineType && l.invoiceId);
          const expectedTotal = roundMoney(inv.gesamtbetrag || 0);
          reconcileRounding(validLines, expectedTotal);
          preview.push({ invoice: inv, lines: validLines });
        }
      }
      const summary = {
        count: preview.length,
        total: roundMoney(preview.reduce((s, p) => s + (p.invoice.gesamtbetrag || 0), 0)),
        linesCount: preview.reduce((s, p) => s + p.lines.length, 0)
      };
      return { runId, dryRun: true, period, count: preview.length, summary, preview };
    }

    const orgId = organizationId;
    const existingPeriodRun = await db.execute(sql`
      SELECT id, run_id, status, period FROM invoice_runs 
      WHERE period = ${period} AND organization_id = ${orgId}
      ORDER BY created_at DESC LIMIT 1
    `);

    if (existingPeriodRun.rows && existingPeriodRun.rows.length > 0) {
      const existing = existingPeriodRun.rows[0] as any;
      if (existing.status === 'completed') {
        return { runId, error: `Periode ${period} wurde bereits abgeschlossen (Run ${existing.run_id}). Vorschreibungen existieren bereits.` };
      }
      if (existing.status === 'started') {
        return { runId, error: `Periode ${period} wird gerade verarbeitet (Run ${existing.run_id}, Status: started). Bitte warten.` };
      }
      if (existing.status === 'failed') {
        await db.execute(sql`
          UPDATE invoice_runs SET status = 'started', error = NULL, updated_at = now(), run_id = ${runId}::uuid
          WHERE id = ${existing.id}
        `);
        await db.execute(sql`
          INSERT INTO audit_logs (user_id, run_id, table_name, record_id, action, new_data, created_at)
          VALUES (${userId}::uuid, ${runId}::uuid, 'invoice_runs', ${String(existing.id)}, 'retry_failed_run', ${JSON.stringify({
            period, previousRunId: existing.run_id, previousStatus: existing.status
          })}::jsonb, now())
        `);
      }
    } else {
      await db.execute(sql`
        INSERT INTO invoice_runs (run_id, period, initiated_by, status, organization_id)
        VALUES (${runId}::uuid, ${period}, ${userId}::uuid, 'started', ${organizationId})
      `);
    }

    try {
      const createdInvoices = await db.transaction(async (tx) => {
        const insertedInvoices: any[] = [];
        for (const inv of invoicesToCreate) {
          const isVacancy = (inv as any).isVacancy === true;
          const res = await tx.execute(sql`
            INSERT INTO monthly_invoices (id, tenant_id, unit_id, year, month, grundmiete, betriebskosten, heizungskosten, gesamtbetrag, ust, ust_satz_miete, ust_satz_bk, ust_satz_heizung, status, faellig_am, vortrag_miete, vortrag_bk, vortrag_hk, vortrag_sonstige, is_vacancy, run_id, created_at)
            VALUES (gen_random_uuid(), ${inv.tenantId}, ${inv.unitId}, ${inv.year}, ${inv.month}, ${inv.grundmiete}, ${inv.betriebskosten}, ${inv.heizungskosten}, ${inv.gesamtbetrag}, ${inv.ust}, ${inv.ustSatzMiete}, ${inv.ustSatzBk}, ${inv.ustSatzHeizung}, ${inv.status}, ${inv.faelligAm}, ${inv.vortragMiete}, ${inv.vortragBk}, ${inv.vortragHk}, ${inv.vortragSonstige}, ${isVacancy}, ${runId}::uuid, now())
            ON CONFLICT (tenant_id, year, month) DO NOTHING
            RETURNING *
          `);
          if (res.rows && res.rows.length) {
            insertedInvoices.push(res.rows[0]);
          }
        }

        const allLines: any[] = [];
        let skippedLines: { type: string; reason: string }[] = [];
        
        const vacancyTenantOverrides = new Map<string, typeof tenants.$inferSelect>();
        for (const vt of vacancyTenants) {
          const unit = unitsData.find(u => u.id === vt.unitId);
          vacancyTenantOverrides.set(vt.id, {
            ...vt,
            grundmiete: '0',
            betriebskostenVorschuss: String(unit?.leerstandBk ?? vt.betriebskostenVorschuss ?? '0'),
            heizkostenVorschuss: String(unit?.leerstandHk ?? vt.heizkostenVorschuss ?? '0'),
            wasserkostenVorschuss: '0',
            sonstigeKosten: null,
          } as typeof tenants.$inferSelect);
        }
        const allTenantsForLookup = [...tenantsData, ...vacancyTenants];
        for (const inv of insertedInvoices) {
          const isVacancyInv = inv.is_vacancy === true;
          const tenant = isVacancyInv
            ? vacancyTenantOverrides.get(inv.tenant_id)
            : tenantsData.find(t => t.id === inv.tenant_id);
          if (!tenant) continue;
          const unitType = unitTypeMap.get(inv.unit_id || '') || 'wohnung';
          const vatRates = invoiceGenerator.getVatRates(unitType);
          const rawLines = invoiceGenerator.buildInvoiceLines(inv.id, tenant, vatRates, inv.month, inv.year, inv.unit_id);
          
          const validLines = rawLines.filter(line => {
            const amt = roundMoney(line.amount);
            if (amt <= 0 || !line.lineType || !line.invoiceId) {
              skippedLines.push({ type: line.lineType || 'unknown', reason: `amount=${amt}` });
              return false;
            }
            return true;
          });
          
          const expectedTotal = roundMoney(inv.gesamtbetrag || 0);
          reconcileRounding(validLines, expectedTotal);
          
          allLines.push(...validLines);
        }

        // invoice_lines ist ein unveränderlicher Append-Only-Ledger.
        // ON CONFLICT DO NOTHING: bereits existierende Zeilen werden nicht überschrieben.
        // Nachträgliche Korrekturen müssen als Gegenbuchungen (Storno-Zeilen) erfasst werden.
        let insertedLinesCount = 0;
        let skippedDuplicatesCount = 0;
        
        const batches = chunk(allLines, 100);
        for (const batch of batches) {
          if (batch.length === 0) continue;
          
          const sortedBatch = [...batch].sort((a, b) => 
            `${a.invoiceId}|${a.lineType}|${a.unitId}|${normalizeDescription(a.description)}`.localeCompare(`${b.invoiceId}|${b.lineType}|${b.unitId}|${normalizeDescription(b.description)}`)
          );
          
          const values = sortedBatch.map(line => 
            sql`(${line.invoiceId}, ${line.unitId}, ${line.lineType}, ${line.description}, ${roundMoney(line.amount)}, ${line.taxRate}, ${JSON.stringify(line.meta || {})}::jsonb, now())`
          );
          
          const result = await tx.execute(sql`
            INSERT INTO invoice_lines (invoice_id, unit_id, line_type, description, amount, tax_rate, meta, created_at)
            VALUES ${sql.join(values, sql`, `)}
            ON CONFLICT (invoice_id, unit_id, line_type, normalized_description)
            DO NOTHING
            RETURNING id
          `);
          
          const inserted = (result.rows || []).length;
          insertedLinesCount += inserted;
          skippedDuplicatesCount += sortedBatch.length - inserted;
        }
        
        if (skippedDuplicatesCount > 0) {
          console.info(`Invoice lines: ${skippedDuplicatesCount} duplicate(s) skipped (DO NOTHING — Ledger ist append-only)`);
        }

        await tx.execute(sql`
          UPDATE invoice_runs SET status = 'completed', updated_at = now()
          WHERE run_id = ${runId}::uuid
        `);

        await tx.execute(sql`
          INSERT INTO audit_logs (user_id, table_name, record_id, action, new_data, created_at)
          VALUES (${userId}::uuid, 'monthly_invoices', ${runId}, 'generate_invoices', ${JSON.stringify({ 
            period, 
            invoicesCount: insertedInvoices.length, 
            linesCount: allLines.length,
            insertedLinesCount,
            skippedDuplicatesCount,
            skippedLinesCount: skippedLines.length,
            skippedDetails: skippedLines.slice(0, 10)
          })}::jsonb, now())
        `);

        return insertedInvoices;
      });

      return { runId, success: true, period, created: createdInvoices.length, invoices: createdInvoices };
    } catch (err: any) {
      await db.execute(sql`
        UPDATE invoice_runs SET status = 'failed', error = ${String(err.message || err)}, updated_at = now()
        WHERE run_id = ${runId}::uuid
      `);

      await db.execute(sql`
        INSERT INTO audit_logs (user_id, table_name, record_id, action, new_data, created_at)
        VALUES (${userId}::uuid, 'monthly_invoices', ${runId}, 'generate_invoices_failed', ${JSON.stringify({ error: String(err.message || err) })}::jsonb, now())
      `);

      throw err;
    }
  }
}

export const billingService = new BillingService();
