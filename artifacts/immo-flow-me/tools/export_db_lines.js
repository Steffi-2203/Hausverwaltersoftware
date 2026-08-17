import pg from 'pg';
import fs from 'fs';

const args = process.argv.slice(2);
const getArg = (name) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : null;
};

const runFileArg = getArg("run-file");
let runId = getArg("run-id") || args.find(a => !a.startsWith("--"));
const outputFile = getArg("out") || getArg("output") || "db_lines.json";
const yearArg = getArg("year");
const monthArg = getArg("month");

if (runFileArg) {
  try {
    const fileData = JSON.parse(fs.readFileSync(runFileArg, 'utf8'));
    runId = fileData.runId;
    if (!runId) {
      console.error(`FEHLER: Kein runId in ${runFileArg} gefunden.`);
      process.exit(1);
    }
    console.error(`RunId aus ${runFileArg}: ${runId}`);
  } catch (e) {
    console.error(`FEHLER: Kann ${runFileArg} nicht lesen: ${e.message}`);
    process.exit(1);
  }
}

if (!runId && !yearArg) {
  console.error('Usage: node tools/export_db_lines.js <run_id> [--out=output.json]');
  console.error('   or: node tools/export_db_lines.js --run-file=generate.json [--out=output.json]');
  console.error('   or: node tools/export_db_lines.js --year=2026 --month=9 [--out=output.json]');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

let result;
if (runId) {
  result = await client.query(`
    SELECT il.unit_id, il.line_type, il.description, il.amount, il.tax_rate
    FROM invoice_lines il
    JOIN monthly_invoices mi ON mi.id = il.invoice_id
    WHERE mi.run_id = $1
    ORDER BY il.unit_id, il.line_type, il.description
  `, [runId]);
} else {
  const year = parseInt(yearArg);
  const month = monthArg ? parseInt(monthArg) : null;
  const params = [year];
  let whereClause = 'WHERE mi.year = $1';
  if (month) {
    whereClause += ' AND mi.month = $2';
    params.push(month);
  }
  result = await client.query(`
    SELECT il.unit_id, il.line_type, il.description, il.amount, il.tax_rate
    FROM invoice_lines il
    JOIN monthly_invoices mi ON mi.id = il.invoice_id
    ${whereClause}
    ORDER BY il.unit_id, il.line_type, il.description
  `, params);
}

await client.end();

fs.writeFileSync(outputFile, JSON.stringify(result.rows, null, 2));
console.log(`Exportiert: ${result.rows.length} Zeilen nach ${outputFile}`);
