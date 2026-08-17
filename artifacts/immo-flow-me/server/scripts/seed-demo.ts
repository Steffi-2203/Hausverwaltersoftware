import { db } from "../db";
import { sql } from "drizzle-orm";
import crypto from "crypto";
import { encryptField } from "../lib/fieldEncryption";

if (process.env.NODE_ENV === 'production') {
  console.error("WARNUNG: Seed-Script darf nicht in Produktion ausgeführt werden!");
  process.exit(1);
}

const ORG_ID = process.env.DEMO_ORG_ID || "6f4bf3ce-03e3-4907-aa1b-7dc4145dd795";
const USER_ID = process.env.DEMO_USER_ID || "e118c1df-eb5d-4939-960d-cdf61b56d6e4";

async function seedLeases() {
  const activeTenants = await db.execute(sql`
    SELECT id, unit_id, grundmiete, betriebskosten_vorschuss, heizungskosten_vorschuss,
           wasserkosten_vorschuss, kaution, kaution_bezahlt, mietbeginn
    FROM tenants
    WHERE deleted_at IS NULL AND status = 'aktiv' AND unit_id IS NOT NULL AND mietbeginn IS NOT NULL
  `);

  let created = 0;
  for (const t of activeTenants.rows as any[]) {
    const existing = await db.execute(sql`SELECT id FROM leases WHERE tenant_id = ${t.id} AND unit_id = ${t.unit_id} LIMIT 1`);
    if (existing.rows.length > 0) continue;

    try {
      await db.execute(sql`
        INSERT INTO leases (tenant_id, unit_id, start_date, grundmiete, betriebskosten_vorschuss,
          heizungskosten_vorschuss, wasserkosten_vorschuss, kaution, kaution_bezahlt, status)
        VALUES (${t.id}, ${t.unit_id}, ${t.mietbeginn}, ${t.grundmiete || '0'}, ${t.betriebskosten_vorschuss || '0'},
          ${t.heizungskosten_vorschuss || '0'}, ${t.wasserkosten_vorschuss || '0'}, ${t.kaution || null}, ${t.kaution_bezahlt || false}, 'aktiv')
      `);
      created++;
    } catch (e: any) {
      if (!e.message?.includes('duplicate')) console.error(`Lease error: ${e.message}`);
    }
  }
  return created;
}

async function seedPayments() {
  const openInvoices = await db.execute(sql`
    SELECT mi.id, mi.tenant_id, mi.gesamtbetrag, mi.year, mi.month, t.first_name, t.last_name, t.iban
    FROM monthly_invoices mi
    JOIN tenants t ON t.id = mi.tenant_id
    WHERE mi.status = 'offen' AND mi.gesamtbetrag > 0
    ORDER BY mi.year, mi.month
  `);

  let paymentsMade = 0;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 1);

  for (const inv of openInvoices.rows as any[]) {
    const invDate = new Date(inv.year, inv.month - 1, 5);
    if (invDate >= cutoff) continue;
    if (Math.random() > 0.85) continue;

    const payDate = new Date(inv.year, inv.month - 1, Math.floor(Math.random() * 5) + 1);
    try {
      await db.execute(sql`
        INSERT INTO payments (tenant_id, invoice_id, betrag, buchungs_datum, payment_type, verwendungszweck)
        VALUES (${inv.tenant_id}, ${inv.id}, ${inv.gesamtbetrag}, ${payDate.toISOString().split('T')[0]},
          ${inv.iban ? 'ueberweisung' : 'bar'}, ${'Miete ' + inv.month + '/' + inv.year + ' ' + inv.first_name + ' ' + inv.last_name})
      `);
      await db.execute(sql`UPDATE monthly_invoices SET status = 'bezahlt', paid_amount = ${inv.gesamtbetrag} WHERE id = ${inv.id}`);
      paymentsMade++;
    } catch (e: any) {
      if (!e.message?.includes('duplicate')) console.error(`Payment error: ${e.message}`);
    }
  }
  return paymentsMade;
}

async function seedBankAccounts() {
  const properties = await db.execute(sql`SELECT id, name FROM properties WHERE deleted_at IS NULL AND organization_id = ${ORG_ID}`);
  let created = 0;

  for (const prop of properties.rows as any[]) {
    const existing = await db.execute(sql`SELECT id FROM bank_accounts WHERE property_id = ${prop.id} LIMIT 1`);
    if (existing.rows.length > 0) continue;

    const banks = ["Erste Bank", "Raiffeisen", "BAWAG P.S.K.", "Sparkasse OOe"];
    const bank = banks[Math.floor(Math.random() * banks.length)];
    const iban = encryptField(`AT${String(Math.floor(Math.random() * 90) + 10)}${String(Math.floor(Math.random() * 9e15) + 1e15).substring(0, 16)}`);
    const bic = encryptField('GIBAATWWXXX');

    await db.execute(sql`
      INSERT INTO bank_accounts (organization_id, property_id, account_name, iban, bic, bank_name, opening_balance, opening_balance_date, current_balance)
      VALUES (${ORG_ID}, ${prop.id}, ${'Hausverwaltung ' + prop.name}, ${iban}, ${bic}, ${bank}, '15000.00', '2025-01-01', '23456.78')
    `);
    created++;
  }
  return created;
}

async function seedWEGData() {
  const properties = await db.execute(sql`
    SELECT p.id, p.name FROM properties p
    JOIN units u ON u.property_id = p.id AND u.deleted_at IS NULL
    WHERE p.deleted_at IS NULL AND p.organization_id = ${ORG_ID}
    GROUP BY p.id, p.name HAVING COUNT(u.id) >= 3
  `);

  let assemblies = 0;
  for (const prop of properties.rows as any[]) {
    const existing = await db.execute(sql`SELECT id FROM weg_assemblies WHERE property_id = ${prop.id} LIMIT 1`);
    if (existing.rows.length > 0) continue;

    await db.execute(sql`
      INSERT INTO weg_assemblies (organization_id, property_id, title, assembly_date, location, status, assembly_type, protocol_number, quorum_reached, notes)
      VALUES (${ORG_ID}, ${prop.id}, ${'Ordentliche EV 2025 - ' + prop.name}, '2025-06-15', ${'Besprechungsraum, ' + prop.name}, 'abgeschlossen', 'ordentlich', 'WEG-2025-001', true, 'Jahresabrechnung 2024 genehmigt')
    `);
    assemblies++;
  }
  return assemblies;
}

async function seedAuditLog() {
  const existing = await db.execute(sql`SELECT COUNT(*) as cnt FROM financial_audit_log`);
  if ((existing.rows[0] as any).cnt > 0) return 0;

  const actions = [
    { action: "invoice_created", type: "monthly_invoice", data: { description: "Monatsrechnung erstellt", amount: "850.00", period: "2025-01" } },
    { action: "payment_received", type: "payment", data: { description: "Zahlung eingegangen", amount: "850.00", method: "SEPA" } },
    { action: "settlement_created", type: "settlement", data: { description: "BK-Abrechnung 2024", year: 2024 } },
    { action: "invoice_created", type: "monthly_invoice", data: { description: "Monatsrechnung erstellt", amount: "1200.00", period: "2025-02" } },
    { action: "payment_received", type: "payment", data: { description: "Zahlung eingegangen", amount: "1200.00", method: "Ueberweisung" } },
    { action: "settlement_updated", type: "settlement", data: { description: "BK-Abrechnung finalisiert", year: 2024, status: "finalisiert" } },
  ];

  let previousHash = "GENESIS";
  for (const a of actions) {
    const dataStr = JSON.stringify(a.data);
    const id = crypto.randomUUID();
    const hash = crypto.createHash("sha256").update(`${previousHash}|${a.action}|${a.type}|${dataStr}`).digest("hex");

    await db.execute(sql`
      INSERT INTO financial_audit_log (id, action, entity_type, entity_id, organization_id, user_id, data, previous_hash, hash)
      VALUES (${id}, ${a.action}, ${a.type}, ${crypto.randomUUID()}, ${ORG_ID}, ${USER_ID}, ${dataStr}::jsonb, ${previousHash}, ${hash})
    `);
    previousHash = hash;
  }
  return actions.length;
}

async function main() {
  console.log("=== ImmoFlowMe Demo Data Seed ===\n");

  const leases = await seedLeases();
  console.log(`Leases created: ${leases}`);

  const payments = await seedPayments();
  console.log(`Payments created: ${payments}`);

  const banks = await seedBankAccounts();
  console.log(`Bank accounts created: ${banks}`);

  const assemblies = await seedWEGData();
  console.log(`WEG assemblies created: ${assemblies}`);

  const audit = await seedAuditLog();
  console.log(`Audit entries created: ${audit}`);

  const stats = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM leases) as leases,
      (SELECT COUNT(*) FROM payments) as payments,
      (SELECT COUNT(*) FROM bank_accounts WHERE organization_id = ${ORG_ID}) as bank_accounts,
      (SELECT COUNT(*) FROM weg_assemblies WHERE organization_id = ${ORG_ID}) as assemblies,
      (SELECT COUNT(*) FROM financial_audit_log) as audit_entries,
      (SELECT COUNT(*) FROM monthly_invoices WHERE status='bezahlt') as paid_invoices,
      (SELECT COUNT(*) FROM monthly_invoices WHERE status='offen') as open_invoices
  `);
  console.log("\n=== Final Statistics ===");
  const s = stats.rows[0] as any;
  console.log(`Leases: ${s.leases} | Payments: ${s.payments} | Banks: ${s.bank_accounts}`);
  console.log(`WEG Assemblies: ${s.assemblies} | Audit: ${s.audit_entries}`);
  console.log(`Invoices: ${s.paid_invoices} bezahlt, ${s.open_invoices} offen`);
}

main().then(() => { console.log("\nDone."); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
