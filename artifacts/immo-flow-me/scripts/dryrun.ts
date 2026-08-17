import { billingService } from "../server/services/billing.service";
import { db } from "../server/db";
import { properties } from "../shared/schema";
import { eq, isNull } from "drizzle-orm";
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
  const output = getArg("output") || "dryrun.json";

  let propertyIds: string[] = [];

  if (propertyId) {
    propertyIds = [propertyId];
  } else {
    const allProps = await db.select({ id: properties.id })
      .from(properties)
      .where(isNull(properties.deletedAt));
    propertyIds = allProps.map(p => p.id);
  }

  process.stderr.write(`Dry-run für ${year}-${String(month).padStart(2, "0")}\n`);
  process.stderr.write(`Properties: ${propertyIds.length}\n`);

  const userId = getArg("user") || "e118c1df-eb5d-4939-960d-cdf61b56d6e4";
  
  const result = await billingService.generateMonthlyInvoices({
    userId,
    propertyIds,
    year,
    month,
    dryRun: true
  });

  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  process.stderr.write(`\nErgebnis gespeichert: ${output}\n`);
  
  if (result.success && result.invoices) {
    const total = result.invoices.reduce((s: number, inv: any) => s + Number(inv.totalAmount || 0), 0);
    process.stderr.write(`Rechnungen: ${result.invoices.length}\n`);
    process.stderr.write(`Gesamtsumme: €${total.toFixed(2)}\n`);
  } else {
    process.stderr.write(`Status: ${JSON.stringify(result, null, 2)}\n`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Fehler:", err);
  process.exit(1);
});
