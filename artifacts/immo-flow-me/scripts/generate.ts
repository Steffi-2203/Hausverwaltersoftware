import { billingService } from "../server/services/billing.service";
import { db } from "../server/db";
import { properties, invoiceLines, monthlyInvoices } from "@shared/schema";
import { eq, isNull, inArray, and } from "drizzle-orm";
import * as fs from "fs";

const args = process.argv.slice(2);
const getArg = (name: string) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : null;
};

async function main() {
  const propertyId = getArg("property");
  const year = parseInt(getArg("year") || new Date().getFullYear().toString());
  const month = parseInt(getArg("month") || (new Date().getMonth() + 1).toString());

  let propertyIds: string[] = [];

  if (propertyId) {
    propertyIds = [propertyId];
  } else {
    const allProps = await db.select({ id: properties.id })
      .from(properties)
      .where(isNull(properties.deletedAt));
    propertyIds = allProps.map(p => p.id);
  }

  const output = getArg("output") || "generate.json";

  process.stderr.write(`Generate (PERSIST) für ${year}-${String(month).padStart(2, "0")}\n`);
  process.stderr.write(`Properties: ${propertyIds.length}\n`);

  const userId = getArg("user") || "e118c1df-eb5d-4939-960d-cdf61b56d6e4";
  
  const result = await billingService.generateMonthlyInvoices({
    userId,
    propertyIds,
    year,
    month,
    dryRun: false
  });

  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  process.stderr.write(`\nErgebnis gespeichert: ${output}\n`);

  if (result.success && result.runId) {
    process.stderr.write(`RunId: ${result.runId}\n`);
    process.stderr.write(`Rechnungen erstellt: ${result.count}\n`);
    
    const invoices = await db.select().from(monthlyInvoices)
      .where(and(
        eq(monthlyInvoices.year, year),
        eq(monthlyInvoices.month, month)
      ));
    
    const invoiceIds = invoices.map(inv => inv.id);
    
    if (invoiceIds.length > 0) {
      const lines = await db.select().from(invoiceLines)
        .where(inArray(invoiceLines.invoiceId, invoiceIds));
      
      const linesFile = output.replace(/\.json$/, '_lines.json');
      fs.writeFileSync(linesFile, JSON.stringify({
        runId: result.runId,
        period: `${year}-${String(month).padStart(2, "0")}`,
        invoiceCount: invoices.length,
        lineCount: lines.length,
        invoices,
        lines
      }, null, 2));
      process.stderr.write(`Invoice Lines gespeichert: ${linesFile} (${lines.length} Zeilen)\n`);
    }
  } else {
    process.stderr.write(`Fehler oder keine Rechnungen: ${JSON.stringify(result, null, 2)}\n`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Fehler:", err);
  process.exit(1);
});
