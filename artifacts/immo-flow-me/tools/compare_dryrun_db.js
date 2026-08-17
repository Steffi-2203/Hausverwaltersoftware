// tools/compare_dryrun_db.js
const fs = require('fs');

function normalize(lines) {
  return (lines || []).map(l => ({
    invoiceId: l.invoice_id || l.invoiceId || null,
    unitId: l.unit_id || l.unitId || l.unit || null,
    lineType: l.line_type || l.lineType || null,
    description: (l.description || '').trim(),
    amount: Number(l.amount || 0).toFixed(2)
  })).sort((a, b) => 
    (a.invoiceId || '').localeCompare(b.invoiceId || '') || 
    (a.unitId || '').localeCompare(b.unitId || '') ||
    (a.lineType || '').localeCompare(b.lineType || '')
  );
}

function compare(dryrunFile, dbFile) {
  if (!fs.existsSync(dryrunFile)) {
    console.error(`Dryrun file not found: ${dryrunFile}`);
    return;
  }
  if (!fs.existsSync(dbFile)) {
    console.error(`DB export file not found: ${dbFile}`);
    return;
  }

  const dry = JSON.parse(fs.readFileSync(dryrunFile));
  const db = JSON.parse(fs.readFileSync(dbFile));

  const dryLines = normalize(dry.invoiceLines || dry.lines || dry.invoice_lines || dry);
  const dbLines = normalize(db.invoiceLines || db.lines || db.invoice_lines || db);

  console.log(`Dry-run lines: ${dryLines.length}`);
  console.log(`DB lines: ${dbLines.length}`);

  const diffs = [];
  const max = Math.max(dryLines.length, dbLines.length);
  
  for (let i = 0; i < max; i++) {
    const a = dryLines[i];
    const b = dbLines[i];
    if (!a || !b || 
        a.amount !== b.amount || 
        a.unitId !== b.unitId || 
        a.description !== b.description || 
        a.lineType !== b.lineType) {
      diffs.push({ index: i, dry: a || null, db: b || null });
    }
  }

  console.log(`Diffs count: ${diffs.length}`);
  
  if (diffs.length) {
    fs.writeFileSync('dry_db_diffs.json', JSON.stringify(diffs, null, 2));
    console.log('Differences written to dry_db_diffs.json');
    
    console.log('\nFirst 5 differences:');
    diffs.slice(0, 5).forEach((d, i) => {
      console.log(`\n[${i}] Index ${d.index}:`);
      if (d.dry) console.log(`  DRY: ${d.dry.lineType} | ${d.dry.amount} | ${d.dry.description}`);
      if (d.db) console.log(`  DB:  ${d.db.lineType} | ${d.db.amount} | ${d.db.description}`);
    });
  } else {
    console.log('No differences found - dry-run matches DB!');
  }
}

const dryrunFile = process.argv[2] || 'dryrun.json';
const dbFile = process.argv[3] || 'invoice_lines_run.json';
compare(dryrunFile, dbFile);
