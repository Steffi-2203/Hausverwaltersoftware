#!/usr/bin/env node
// tools/test_harness.js
// End-to-end integration harness: dryrun → generate → export → compare → (optional) upsert
//
// Usage:
//   node tools/test_harness.js --year=2026 --month=9 [--run-id=RUN_ID] [--database-url=postgres://...] [--do-upsert]

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const getArg = (name) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
};

const YEAR = getArg('year') || '2026';
const MONTH = getArg('month') || '9';
const RUN_ID = getArg('run-id') || process.env.RUN_ID || '';
const DATABASE_URL = getArg('database-url') || process.env.DATABASE_URL;
const DO_UPSERT = args.includes('--do-upsert');

if (!DATABASE_URL) {
  console.error('DATABASE_URL not provided. Use --database-url=... or set env DATABASE_URL.');
  process.exit(1);
}

const TMP = path.resolve(process.cwd(), 'tmp');
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', env: { ...process.env, DATABASE_URL }, ...opts });
}

function runCapture(cmd) {
  console.log(`\n> ${cmd}`);
  return execSync(cmd, { encoding: 'utf8', env: { ...process.env, DATABASE_URL } });
}

try {
  console.log(`\n========== Test Harness: ${YEAR}/${MONTH} ==========\n`);

  const dryOut = path.join(TMP, `dryrun_${YEAR}_${MONTH}.json`);
  const genOut = path.join(TMP, `generate_${YEAR}_${MONTH}.json`);
  const dbOut = path.join(TMP, `db_lines_${YEAR}_${MONTH}.json`);
  const missingOut = path.join(TMP, `missing_lines_${YEAR}_${MONTH}.csv`);

  console.log('--- Step 1: Dry-run ---');
  run(`npx tsx scripts/dryrun.ts --year=${YEAR} --month=${MONTH} > ${dryOut}`);

  console.log('--- Step 2: Generate (persist) ---');
  run(`npx tsx scripts/generate.ts --year=${YEAR} --month=${MONTH} > ${genOut}`);

  console.log('--- Step 3: Export DB lines ---');
  if (fs.existsSync(path.join(process.cwd(), 'tools', 'export_db_lines.js'))) {
    run(`node tools/export_db_lines.js --run-file=${genOut} --out=${dbOut}`);
  } else {
    const runId = RUN_ID || JSON.parse(fs.readFileSync(genOut, 'utf8')).runId;
    if (!runId) {
      console.error('Could not determine run_id from generate output.');
      process.exit(1);
    }
    const csvOut = path.join(TMP, `db_lines_${YEAR}_${MONTH}.csv`);
    run(`psql "${DATABASE_URL}" -c "\\copy (SELECT invoice_id, unit_id, line_type, description, amount, tax_rate FROM invoice_lines WHERE invoice_id IN (SELECT id FROM monthly_invoices WHERE run_id='${runId}') ORDER BY invoice_id, line_type) TO '${csvOut}' WITH CSV HEADER"`);
    const csv = fs.readFileSync(csvOut, 'utf8').trim().split('\n');
    const headers = csv.shift().split(',');
    const rows = csv.map(line => {
      const cols = line.split(',');
      const obj = {};
      headers.forEach((h, i) => obj[h] = cols[i]);
      return obj;
    });
    fs.writeFileSync(dbOut, JSON.stringify(rows, null, 2));
  }

  console.log('--- Step 4: Compare dry-run vs DB ---');
  const effectiveRunId = RUN_ID || JSON.parse(fs.readFileSync(genOut, 'utf8')).runId || 'unknown';
  const auditDir = path.resolve('reconciliations', effectiveRunId);
  run(`node tools/find_missing_lines.js --dryrun-file=${dryOut} --db-file=${dbOut} --run-id=${effectiveRunId}`);

  const auditMissing = path.join(auditDir, 'missing_lines.csv');
  const missingExists = fs.existsSync(auditMissing) && fs.readFileSync(auditMissing, 'utf8').trim().length > 0;

  if (!missingExists) {
    console.log('\nKeine fehlenden Zeilen erkannt. Dry-Run und Persist sind in Parität.');
  } else {
    const missingContent = fs.readFileSync(auditMissing, 'utf8').trim();
    const missingCount = missingContent.split('\n').length - 1;
    console.warn(`\n${missingCount} fehlende Zeilen erkannt. Audit: ${auditDir}`);

    if (DO_UPSERT) {
      console.log('\n--- Step 5a: Upsert dry-run ---');
      run(`node tools/upsert_missing_lines.js --csv=${auditMissing} --run-id=${effectiveRunId} --database-url="${DATABASE_URL}" --dry-run`);

      console.log('\n--- Step 5b: Upsert real ---');
      run(`node tools/upsert_missing_lines.js --csv=${auditMissing} --run-id=${effectiveRunId} --database-url="${DATABASE_URL}"`);

      console.log('\n--- Step 5c: Recompute gesamtbetrag ---');
      const recomputeSql = `
        UPDATE monthly_invoices mi
        SET gesamtbetrag = sub.netto
        FROM (
          SELECT invoice_id,
                 ROUND(CAST(SUM(amount) AS numeric), 2) AS netto
          FROM invoice_lines
          GROUP BY invoice_id
        ) sub
        WHERE mi.id = sub.invoice_id
          AND ROUND(CAST(mi.gesamtbetrag AS numeric), 2) != sub.netto
      `;
      run(`psql "${DATABASE_URL}" -c "${recomputeSql.replace(/\n/g, ' ')}"`);
      console.log('Gesamtbeträge neu berechnet.');
    } else {
      console.log('Upsert nicht ausgeführt. Mit --do-upsert erneut starten um Korrekturen anzuwenden.');
    }
  }

  console.log('\n========== Test Harness abgeschlossen ==========\n');
} catch (err) {
  console.error('Harness fehlgeschlagen:', err.message || err);
  process.exit(1);
}
