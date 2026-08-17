import fs from 'fs';
import pg from 'pg';

/**
 * Zentrale Rundung auf ganze Cent — identisch mit shared/utils.ts roundMoney/roundToCents.
 * Direkt hier definiert, da dieses Tool als standalone JS ohne TS-Transpile läuft.
 */
function roundToCents(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

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
  return arg ? arg.split("=").slice(1).join("=") : null;
};
const positional = args.filter(a => !a.startsWith("--"));
const dryRun = args.includes('--dry-run');

const csvFile = getArg("csv");
const jsonFile = getArg("json") || positional[0];
const runIdOverride = getArg("run-id");
const dbUrl = getArg("database-url") || process.env.DATABASE_URL;
const batchSize = parseInt(getArg("batch-size") || "50");
const missingFile = csvFile || jsonFile || 'missing_lines.json';

if (!fs.existsSync(missingFile)) {
  console.error(`Datei nicht gefunden: ${missingFile}`);
  console.error('Usage: node tools/upsert_missing_lines.js [missing_lines.json] [--dry-run]');
  console.error('   or: node tools/upsert_missing_lines.js --csv=missing_lines.csv [--run-id=RUN_ID] [--dry-run]');
  console.error('   or: node tools/upsert_missing_lines.js --json=missing_lines.json [--database-url=...] [--dry-run]');
  process.exit(1);
}

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCsv(content) {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] || ''; });
    return obj;
  });
}

let missingLines;
if (csvFile || missingFile.endsWith('.csv')) {
  const csvContent = fs.readFileSync(missingFile, 'utf8');
  missingLines = parseCsv(csvContent).map(row => ({
    tenantId: row.tenantId || row.tenant_id,
    unitId: row.unitId || row.unit_id,
    lineType: row.lineType || row.line_type,
    description: row.description,
    amount: roundToCents(parseFloat(row.amount)),
    taxRate: roundToCents(parseFloat(row.taxRate || row.tax_rate || 0))
  }));
} else {
  missingLines = JSON.parse(fs.readFileSync(missingFile, 'utf8'));
}

if (missingLines.length === 0) {
  console.log('Keine fehlenden Zeilen - nichts zu tun.');
  process.exit(0);
}

console.log(`${dryRun ? '[DRY-RUN] ' : ''}Fehlende Zeilen: ${missingLines.length}`);

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();

const affectedTenants = [...new Set(missingLines.map(l => l.tenantId))];
console.log(`Betroffene Mieter: ${affectedTenants.length}`);

const invoiceMap = new Map();
for (const tenantId of affectedTenants) {
  const result = await client.query(`
    SELECT id, tenant_id, unit_id, year, month 
    FROM monthly_invoices 
    WHERE tenant_id = $1
  `, [tenantId]);
  
  for (const row of result.rows) {
    const key = `${row.tenant_id}|${row.year}|${row.month}`;
    invoiceMap.set(key, { invoiceId: row.id, unitId: row.unit_id });
  }
}

console.log(`Invoices gemappt: ${invoiceMap.size}`);

let inserted = 0;
let updated = 0;
let skipped = 0;
let errors = [];

const monthNames = {
  'Jänner': 1, 'Februar': 2, 'März': 3, 'April': 4, 'Mai': 5, 'Juni': 6,
  'Juli': 7, 'August': 8, 'September': 9, 'Oktober': 10, 'November': 11, 'Dezember': 12
};

const resolved = [];
for (const line of missingLines) {
  const period = line.description.match(/(\w+)\s+(\d{4})$/);
  if (!period) { errors.push({ line, reason: 'Periode nicht erkannt' }); continue; }
  const month = monthNames[period[1]];
  const year = parseInt(period[2]);
  if (!month) { errors.push({ line, reason: `Unbekannter Monat: ${period[1]}` }); continue; }
  const key = `${line.tenantId}|${year}|${month}`;
  const invoice = invoiceMap.get(key);
  if (!invoice) { errors.push({ line, reason: `Invoice nicht gefunden: ${key}` }); continue; }
  resolved.push({ ...line, invoiceId: invoice.invoiceId, unitId: invoice.unitId });
}

resolved.sort((a, b) =>
  `${a.invoiceId}|${a.lineType}|${a.unitId}|${normalizeDescription(a.description)}`.localeCompare(`${b.invoiceId}|${b.lineType}|${b.unitId}|${normalizeDescription(b.description)}`)
);

const mergedKeys = [];

if (dryRun) {
  for (const r of resolved) {
    console.log(`  [DRY] UPSERT: ${r.lineType} ${r.description} €${r.amount}`);
    inserted++;
  }
} else {
  for (let i = 0; i < resolved.length; i += batchSize) {
    const batch = resolved.slice(i, i + batchSize);
    const values = [];
    const params = [];
    let p = 1;
    for (const r of batch) {
      values.push(`($${p}, $${p+1}, $${p+2}, $${p+3}, $${p+4}, $${p+5})`);
      params.push(r.invoiceId, r.unitId, r.lineType, r.description, r.amount, r.taxRate);
      p += 6;
    }
    try {
      await client.query('BEGIN');
      
      const keyParams = [];
      const keyValues2 = [];
      let kp = 1;
      for (const r of batch) {
        keyValues2.push(`($${kp}::uuid, $${kp+1}::uuid, $${kp+2}::varchar, $${kp+3}::text)`);
        keyParams.push(r.invoiceId, r.unitId, r.lineType, normalizeDescription(r.description));
        kp += 4;
      }
      const oldResult = await client.query(`
        SELECT invoice_id, unit_id, line_type, normalized_description, amount AS old_amount, tax_rate AS old_tax_rate
        FROM invoice_lines
        WHERE (invoice_id, unit_id, line_type, normalized_description) IN (
          SELECT * FROM (VALUES ${keyValues2.join(', ')}) AS t(inv_id, u_id, lt, norm_descr)
        )
      `, keyParams);
      
      const oldValuesMap = new Map();
      for (const row of (oldResult?.rows || [])) {
        oldValuesMap.set(`${row.invoice_id}|${row.line_type}|${row.normalized_description}`, { 
          amount: Number(row.old_amount), taxRate: Number(row.old_tax_rate) 
        });
      }
      
      const result = await client.query(`
        INSERT INTO invoice_lines (invoice_id, unit_id, line_type, description, amount, tax_rate)
        VALUES ${values.join(', ')}
        ON CONFLICT (invoice_id, unit_id, line_type, normalized_description)
        DO UPDATE SET
          amount = EXCLUDED.amount,
          tax_rate = EXCLUDED.tax_rate,
          description = EXCLUDED.description
        WHERE (invoice_lines.amount, invoice_lines.tax_rate) IS DISTINCT FROM (EXCLUDED.amount, EXCLUDED.tax_rate)
        RETURNING id, invoice_id, line_type, description, normalized_description, amount
      `, params);

      const returnedKeys = new Set();
      let batchInserted = 0;
      let batchUpdated = 0;
      for (const row of result.rows) {
        const key = `${row.invoice_id}|${row.line_type}|${row.normalized_description}`;
        returnedKeys.add(key);
        const oldValues = oldValuesMap.get(key);
        if (oldValues !== undefined) {
          batchUpdated++;
          if (mergedKeys.length < 50) {
            mergedKeys.push({
              invoiceId: row.invoice_id,
              lineType: row.line_type,
              description: row.description,
              oldAmount: oldValues.amount,
              oldTaxRate: oldValues.taxRate,
              newAmount: Number(row.amount)
            });
          }
        } else {
          batchInserted++;
        }
      }

      if (batchUpdated > 0 || batchInserted > 0) {
        await client.query(`
          INSERT INTO audit_logs (table_name, record_id, action, new_data, created_at)
          VALUES ('invoice_lines', $1, 'upsert_missing_lines', $2::jsonb, now())
        `, [
          runIdOverride || 'tool_upsert',
          JSON.stringify({
            batchOffset: i,
            batchSize: batch.length,
            inserted: batchInserted,
            updated: batchUpdated,
            mergedKeys: mergedKeys.slice(-batchUpdated).slice(0, 10)
          })
        ]);
      }

      await client.query('COMMIT');
      inserted += batchInserted;
      updated += batchUpdated;
    } catch (err) {
      await client.query('ROLLBACK');
      errors.push({ batch: batch.map(r => r.description), reason: err.message });
      skipped += batch.length;
    }
    const progress = Math.min(i + batchSize, resolved.length);
    process.stderr.write(`\r  Batch ${Math.ceil((i + batchSize) / batchSize)}/${Math.ceil(resolved.length / batchSize)} — ${progress}/${resolved.length} Zeilen`);
  }
  process.stderr.write('\n');
}

await client.end();

console.log(`\n=== Ergebnis ===`);
console.log(`Eingefügt: ${inserted}`);
console.log(`Aktualisiert (Merge): ${updated}`);
console.log(`Übersprungen (Fehler): ${skipped}`);
console.log(`Fehler: ${errors.length}`);

if (mergedKeys.length > 0) {
  console.log(`\nMerge-Details (erste ${Math.min(mergedKeys.length, 10)}):`);
  mergedKeys.slice(0, 10).forEach(m => {
    console.log(`  ${m.lineType}: ${m.description} → €${m.newAmount}`);
  });
}

if (errors.length > 0) {
  console.log('\nFehler-Details:');
  errors.slice(0, 10).forEach(e => {
    if (e.line) {
      console.log(`  ${e.line.lineType}: ${e.line.description} - ${e.reason}`);
    } else {
      console.log(`  Batch: ${e.reason}`);
    }
  });
  fs.writeFileSync('upsert_errors.json', JSON.stringify(errors, null, 2));
  console.log('\nAlle Fehler gespeichert: upsert_errors.json');
}

if (dryRun) {
  console.log('\n[DRY-RUN] Keine Änderungen geschrieben. Entferne --dry-run für echtes Upsert.');
}
