import fs from 'fs';
import path from 'path';

/**
 * Deterministische Beschreibungs-Normalisierung — identisch mit server/lib/normalizeDescription.ts.
 * Direkt hier definiert, da dieses Tool als standalone JS ohne TS-Transpile läuft.
 */
function normalizeDescription(raw) {
  if (raw === undefined || raw === null) return null;
  let s = String(raw).trim();
  if (s.normalize) s = s.normalize('NFC');
  s = s.replace(/\s+/g, ' ');
  s = s.toLowerCase();
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
  return s;
}

const args = process.argv.slice(2);
const getArg = (name) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : null;
};
const positional = args.filter(a => !a.startsWith("--"));

const dryrunFile = getArg("dryrun-file") || getArg("dryrun") || positional[0] || 'dryrun.json';
const dbLinesFile = getArg("db-file") || getArg("db") || positional[1] || 'db_lines.json';
const outputFile = getArg("out") || getArg("output") || null;
const runId = getArg("run-id") || null;

if (!fs.existsSync(dryrunFile)) {
  console.error(`Dry-run Datei nicht gefunden: ${dryrunFile}`);
  console.error('Erstelle mit: npx tsx scripts/dryrun.ts --year=2026 --month=9');
  process.exit(1);
}

if (!fs.existsSync(dbLinesFile)) {
  console.error(`DB Lines Datei nicht gefunden: ${dbLinesFile}`);
  console.error('Erstelle mit: psql -c "SELECT ... FROM invoice_lines ..." -o db_lines.json');
  console.error('Oder nutze: node tools/export_db_lines.js <run_id>');
  process.exit(1);
}

const dryrun = JSON.parse(fs.readFileSync(dryrunFile, 'utf8'));
let dbData = JSON.parse(fs.readFileSync(dbLinesFile, 'utf8'));

let dbLines = Array.isArray(dbData) ? dbData : (dbData.lines || dbData.invoices || []);

const expectedLines = [];
dryrun.preview.forEach(p => {
  const unitId = p.invoice.unitId;
  p.lines.forEach(line => {
    expectedLines.push({
      tenantId: p.invoice.tenantId,
      unitId: unitId,
      lineType: line.lineType,
      description: line.description,
      amount: line.amount,
      taxRate: line.taxRate
    });
  });
});

const dbLineSet = new Set(
  dbLines.map(l => `${l.unit_id || l.unitId}|${l.line_type || l.lineType}|${normalizeDescription(l.description)}`)
);

const missingLines = expectedLines.filter(l => 
  !dbLineSet.has(`${l.unitId}|${l.lineType}|${normalizeDescription(l.description)}`)
);

console.log(`Expected lines (dry-run): ${expectedLines.length}`);
console.log(`DB lines: ${dbLines.length}`);
console.log(`Missing lines: ${missingLines.length}`);

if (missingLines.length > 0) {
  const effectiveRunId = runId || dryrun.runId || 'unknown';
  const auditDir = path.resolve('reconciliations', effectiveRunId);
  fs.mkdirSync(auditDir, { recursive: true });

  const jsonOut = outputFile || path.join(auditDir, 'missing_lines.json');
  const csvOut = jsonOut.replace(/\.json$/, '.csv');
  fs.writeFileSync(jsonOut, JSON.stringify(missingLines, null, 2));

  const csvHeader = 'tenantId,unitId,lineType,description,amount,taxRate';
  const csvRows = missingLines.map(l => 
    `${l.tenantId},${l.unitId},${l.lineType},"${l.description}",${l.amount},${l.taxRate}`
  );
  fs.writeFileSync(csvOut, [csvHeader, ...csvRows].join('\n'));

  const summary = {
    runId: effectiveRunId,
    period: dryrun.period || null,
    timestamp: new Date().toISOString(),
    expectedLines: expectedLines.length,
    dbLines: dbLines.length,
    missingCount: missingLines.length,
    missingByType: {}
  };
  missingLines.forEach(l => {
    summary.missingByType[l.lineType] = (summary.missingByType[l.lineType] || 0) + 1;
  });
  fs.writeFileSync(path.join(auditDir, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log(`\nAudit-Verzeichnis: ${auditDir}`);
  console.log('Dateien erstellt:');
  console.log(`  - ${jsonOut}`);
  console.log(`  - ${csvOut}`);
  console.log(`  - ${path.join(auditDir, 'summary.json')}`);

  console.log('\nBeispiel fehlende Zeilen:');
  missingLines.slice(0, 5).forEach(l => {
    console.log(`  ${l.lineType}: ${l.description} = €${l.amount}`);
  });
} else {
  console.log('\nKeine fehlenden Zeilen - Daten sind vollständig!');
}
