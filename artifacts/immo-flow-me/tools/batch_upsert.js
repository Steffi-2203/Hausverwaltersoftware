import pg from 'pg';

const args = process.argv.slice(2);
const getArg = (name) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split("=").slice(1).join("=") : null;
};

const runId = getArg("run-id") || `run-${Date.now()}`;
const dbUrl = getArg("db") || process.env.DATABASE_URL;
const batchSize = parseInt(getArg("batch-size") || "100");
const trace = process.env.TRACE === "true";

if (!dbUrl) {
  console.error("ERROR: No database URL. Use --db=... or set DATABASE_URL");
  process.exit(1);
}

function log(msg) {
  if (trace) console.log(`[TRACE ${new Date().toISOString()}] ${msg}`);
}

function normalizeDescription(raw) {
  if (raw === undefined || raw === null) return null;
  let s = String(raw).trim();
  if (s.normalize) s = s.normalize('NFC');
  s = s.replace(/\s+/g, ' ');
  s = s.toLowerCase();
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
  return s;
}

function roundToCents(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();
log(`Connected to database`);

async function createReconcileRun() {
  await client.query(`
    INSERT INTO reconcile_runs (run_id, type, status, started_at)
    VALUES ($1, 'batch_upsert', 'started', now())
  `, [runId]);
  log(`Reconcile run created: ${runId}`);
}

async function updateReconcileRun(status, counts, error) {
  await client.query(`
    UPDATE reconcile_runs
    SET status = $1,
        inserted = $2,
        updated = $3,
        skipped = $4,
        errors = $5,
        total_rows = $6,
        error = $7,
        completed_at = now()
    WHERE run_id = $8
  `, [status, counts.inserted, counts.updated, counts.skipped, counts.errors, counts.total, error, runId]);
  log(`Reconcile run updated: status=${status}`);
}

async function writeAuditLog(action, recordId, details) {
  await client.query(`
    INSERT INTO audit_logs (run_id, table_name, record_id, action, details, created_at)
    VALUES ($1, $2, $3, $4, $5::jsonb, now())
  `, [
    runId,
    'invoice_lines',
    recordId,
    action,
    JSON.stringify(details)
  ]);
}

const monthNames = {
  'Jänner': 1, 'Februar': 2, 'März': 3, 'April': 4, 'Mai': 5, 'Juni': 6,
  'Juli': 7, 'August': 8, 'September': 9, 'Oktober': 10, 'November': 11, 'Dezember': 12
};

const lineTypes = ['grundmiete', 'betriebskosten', 'heizungskosten', 'wasserkosten'];
const taxRates = { grundmiete: 10, betriebskosten: 10, heizungskosten: 20, wasserkosten: 10 };

const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0, total: 0 };

try {
  await createReconcileRun();

  log("Loading tenants with active invoices...");
  const tenantResult = await client.query(`
    SELECT t.id AS tenant_id, t.unit_id, t.grundmiete, t.betriebskosten_vorschuss, 
           t.heizungskosten_vorschuss, t.wasserkosten_vorschuss
    FROM tenants t
    WHERE t.status = 'aktiv' AND t.deleted_at IS NULL
  `);
  const tenants = tenantResult.rows;
  log(`Found ${tenants.length} active tenants`);

  const invoiceResult = await client.query(`
    SELECT mi.id, mi.tenant_id, mi.unit_id, mi.year, mi.month
    FROM monthly_invoices mi
    WHERE mi.tenant_id IS NOT NULL
  `);
  const invoiceMap = new Map();
  for (const row of invoiceResult.rows) {
    const key = `${row.tenant_id}|${row.year}|${row.month}`;
    invoiceMap.set(key, { invoiceId: row.id, unitId: row.unit_id });
  }
  log(`Loaded ${invoiceMap.size} invoices`);

  const linesToUpsert = [];
  for (const tenant of tenants) {
    for (const [year, months] of [[2025, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]]]) {
      for (const month of months) {
        const key = `${tenant.tenant_id}|${year}|${month}`;
        const invoice = invoiceMap.get(key);
        if (!invoice) continue;

        const monthName = Object.keys(monthNames).find(k => monthNames[k] === month);
        const amounts = {
          grundmiete: roundToCents(Number(tenant.grundmiete) || 0),
          betriebskosten: roundToCents(Number(tenant.betriebskosten_vorschuss) || 0),
          heizungskosten: roundToCents(Number(tenant.heizungskosten_vorschuss) || 0),
          wasserkosten: roundToCents(Number(tenant.wasserkosten_vorschuss) || 0),
        };

        for (const lt of lineTypes) {
          const amount = amounts[lt];
          if (amount <= 0) continue;
          const description = `${lt === 'grundmiete' ? 'Grundmiete' : lt === 'betriebskosten' ? 'Betriebskosten' : lt === 'heizungskosten' ? 'Heizungskosten' : 'Wasserkosten'} ${monthName} ${year}`;
          linesToUpsert.push({
            invoiceId: invoice.invoiceId,
            unitId: invoice.unitId,
            lineType: lt,
            description,
            amount,
            taxRate: taxRates[lt],
          });
        }
      }
    }
  }

  counts.total = linesToUpsert.length;
  log(`Lines to upsert: ${counts.total}`);

  for (let i = 0; i < linesToUpsert.length; i += batchSize) {
    const batch = linesToUpsert.slice(i, i + batchSize);
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
      const keyValues = [];
      let kp = 1;
      for (const r of batch) {
        keyValues.push(`($${kp}::uuid, $${kp+1}::uuid, $${kp+2}::varchar, $${kp+3}::text)`);
        keyParams.push(r.invoiceId, r.unitId, r.lineType, normalizeDescription(r.description));
        kp += 4;
      }
      const oldResult = await client.query(`
        SELECT invoice_id, unit_id, line_type, normalized_description, amount AS old_amount, tax_rate AS old_tax_rate
        FROM invoice_lines
        WHERE (invoice_id, unit_id, line_type, normalized_description) IN (
          SELECT * FROM (VALUES ${keyValues.join(', ')}) AS t(inv_id, u_id, lt, norm_descr)
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

      let batchInserted = 0;
      let batchUpdated = 0;
      for (const row of result.rows) {
        const key = `${row.invoice_id}|${row.line_type}|${row.normalized_description}`;
        if (oldValuesMap.has(key)) {
          batchUpdated++;
        } else {
          batchInserted++;
        }
      }
      const batchSkipped = batch.length - batchInserted - batchUpdated;

      await writeAuditLog('batch_upsert', runId, {
        batchOffset: i,
        batchSize: batch.length,
        inserted: batchInserted,
        updated: batchUpdated,
        skipped: batchSkipped,
      });

      await client.query('COMMIT');
      counts.inserted += batchInserted;
      counts.updated += batchUpdated;
      counts.skipped += batchSkipped;

      log(`Batch ${Math.ceil((i + batchSize) / batchSize)}: +${batchInserted} ins, ${batchUpdated} upd, ${batchSkipped} skip`);
    } catch (err) {
      await client.query('ROLLBACK');
      counts.errors += batch.length;
      log(`Batch error: ${err.message}`);
    }

    const progress = Math.min(i + batchSize, linesToUpsert.length);
    process.stderr.write(`\r  Progress: ${progress}/${linesToUpsert.length}`);
  }
  process.stderr.write('\n');

  await updateReconcileRun('completed', counts, null);

} catch (err) {
  console.error(`FATAL: ${err.message}`);
  try {
    await updateReconcileRun('failed', counts, err.message);
  } catch (_) {}
  process.exitCode = 1;
} finally {
  await client.end();
}

console.log(`\n=== Batch Upsert Results ===`);
console.log(`Run ID: ${runId}`);
console.log(`Total rows: ${counts.total}`);
console.log(`Inserted: ${counts.inserted}`);
console.log(`Updated: ${counts.updated}`);
console.log(`Skipped (no change): ${counts.skipped}`);
console.log(`Errors: ${counts.errors}`);
console.log(`Status: ${counts.errors > 0 ? 'PARTIAL' : 'OK'}`);
