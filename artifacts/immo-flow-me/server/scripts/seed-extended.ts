import { db } from "../db";
import { sql } from "drizzle-orm";
import crypto from "crypto";
import { encryptField } from "../lib/fieldEncryption";

const ORG_ID = "6f4bf3ce-03e3-4907-aa1b-7dc4145dd795";
const USER_ID = "e118c1df-eb5d-4939-960d-cdf61b56d6e4";

async function seedExtended() {
  console.log("=== Seeding Extended Demo Data ===");

  const properties = await db.execute(sql`
    SELECT id, name FROM properties WHERE deleted_at IS NULL AND organization_id = ${ORG_ID}
  `);

  for (const prop of properties.rows as any[]) {
    const existingBank = await db.execute(sql`
      SELECT id FROM bank_accounts WHERE property_id = ${prop.id} LIMIT 1
    `);
    if (existingBank.rows.length > 0) {
      console.log(`Bank account exists for ${prop.name}, skipping`);
      continue;
    }

    const bankNames = ["Erste Bank", "Raiffeisen", "BAWAG P.S.K.", "Sparkasse OÖ"];
    const bank = bankNames[Math.floor(Math.random() * bankNames.length)];
    const ibanNum = String(Math.floor(Math.random() * 9000000000000000) + 1000000000000000);
    const iban = encryptField(`AT${String(Math.floor(Math.random() * 90) + 10)}${ibanNum.substring(0, 16)}`);
    const bic = encryptField('GIBAATWWXXX');

    await db.execute(sql`
      INSERT INTO bank_accounts (organization_id, property_id, account_name, iban, bic, bank_name, opening_balance, opening_balance_date, current_balance)
      VALUES (${ORG_ID}, ${prop.id}, ${'Hausverwaltung ' + prop.name}, ${iban}, ${bic}, ${bank}, '15000.00', '2025-01-01', '23456.78')
    `);
    console.log(`Created bank account for ${prop.name}`);
  }

  const propWithUnits = await db.execute(sql`
    SELECT p.id, p.name, COUNT(u.id) as unit_count
    FROM properties p
    JOIN units u ON u.property_id = p.id AND u.deleted_at IS NULL
    WHERE p.deleted_at IS NULL AND p.organization_id = ${ORG_ID}
    GROUP BY p.id, p.name
    HAVING COUNT(u.id) >= 3
  `);

  for (const prop of propWithUnits.rows as any[]) {
    const existingAssembly = await db.execute(sql`
      SELECT id FROM weg_assemblies WHERE property_id = ${prop.id} LIMIT 1
    `);
    if (existingAssembly.rows.length > 0) continue;

    await db.execute(sql`
      INSERT INTO weg_assemblies (organization_id, property_id, title, assembly_date, location, status, assembly_type, protocol_number, quorum_reached, notes)
      VALUES (${ORG_ID}, ${prop.id}, ${'Ordentliche Eigentümerversammlung 2025 - ' + prop.name}, '2025-06-15', ${'Besprechungsraum, ' + prop.name}, 'abgeschlossen', 'ordentlich', 'WEG-2025-001', true, 'Jahresabrechnung 2024 genehmigt, Rücklage erhöht')
    `);
    await db.execute(sql`
      INSERT INTO weg_assemblies (organization_id, property_id, title, assembly_date, location, status, assembly_type, protocol_number, quorum_reached, notes)
      VALUES (${ORG_ID}, ${prop.id}, ${'Außerordentliche EV - Sanierung ' + prop.name}, '2025-11-20', ${'Besprechungsraum, ' + prop.name}, 'geplant', 'ausserordentlich', 'WEG-2025-002', false, 'Fassadensanierung und Dacharbeiten')
    `);
    console.log(`Created WEG assemblies for ${prop.name}`);
  }

  const ownerNames = [
    { first: "Karl", last: "Gruber", company: null },
    { first: "Maria", last: "Steiner", company: null },
    { first: "Wiener Wohnbau", last: "GmbH", company: "Wiener Wohnbau GmbH" },
    { first: "Herbert", last: "Maier", company: null },
    { first: "Alpenland Immobilien", last: "KG", company: "Alpenland Immobilien KG" },
    { first: "Ingrid", last: "Moser", company: null },
    { first: "Johann", last: "Berger", company: null },
    { first: "Gertrude", last: "Huber", company: null },
  ];

  const existingOwners = await db.execute(sql`SELECT COUNT(*) as cnt FROM owners WHERE organization_id = ${ORG_ID}`);
  if ((existingOwners.rows[0] as any).cnt < 3) {
    for (const o of ownerNames) {
      const ibanNum = String(Math.floor(Math.random() * 9000000000000000) + 1000000000000000);
      const ownerIban = encryptField(`AT${String(Math.floor(Math.random() * 90) + 10)}${ibanNum.substring(0, 16)}`);
      const ownerBic = encryptField('GIBAATWWXXX');
      await db.execute(sql`
        INSERT INTO owners (organization_id, first_name, last_name, company_name, email, phone, address, city, postal_code, country, iban, bic, bank_name)
        VALUES (${ORG_ID}, ${o.first || null}, ${o.last || null}, ${o.company || null},
          ${(o.company ? 'office@' + o.company.toLowerCase().replace(/[^a-z]/g, '') + '.at' : (o.first.toLowerCase() + '.' + o.last.toLowerCase() + '@gmail.com'))},
          ${'+43 1 ' + String(Math.floor(Math.random() * 9000000) + 1000000)},
          ${'Beispielgasse ' + Math.floor(Math.random() * 50 + 1)}, 'Wien', ${String(1010 + Math.floor(Math.random() * 23) * 10)}, 'AT',
          ${ownerIban}, ${ownerBic}, 'Erste Bank')
      `);
    }
    console.log(`Created ${ownerNames.length} owners`);
  }

  const owners = await db.execute(sql`SELECT id FROM owners WHERE organization_id = ${ORG_ID} LIMIT 8`);
  const ownerIds = (owners.rows as any[]).map(r => r.id);

  for (const prop of propWithUnits.rows as any[]) {
    const units = await db.execute(sql`
      SELECT id, nutzwert FROM units WHERE property_id = ${prop.id} AND deleted_at IS NULL LIMIT 20
    `);

    let assignedCount = 0;
    for (let i = 0; i < Math.min(units.rows.length, ownerIds.length); i++) {
      const unit = units.rows[i] as any;
      const ownerId = ownerIds[i % ownerIds.length];

      const existing = await db.execute(sql`
        SELECT id FROM weg_unit_owners WHERE unit_id = ${unit.id} AND property_id = ${prop.id} LIMIT 1
      `);
      if (existing.rows.length > 0) continue;

      const mea = unit.nutzwert ? parseFloat(unit.nutzwert) / 1000 : (Math.random() * 0.08 + 0.02);
      await db.execute(sql`
        INSERT INTO weg_unit_owners (organization_id, property_id, unit_id, owner_id, mea_share, nutzwert, valid_from)
        VALUES (${ORG_ID}, ${prop.id}, ${unit.id}, ${ownerId}, ${String(mea.toFixed(4))}, ${unit.nutzwert || '50.0000'}, '2020-01-01')
      `);
      assignedCount++;
    }
    if (assignedCount > 0) console.log(`Assigned ${assignedCount} unit owners for ${prop.name}`);
  }

  const existingAudit = await db.execute(sql`SELECT COUNT(*) as cnt FROM financial_audit_log`);
  if ((existingAudit.rows[0] as any).cnt === 0) {
    let previousHash = "GENESIS";
    const actions = [
      { action: "invoice_created", entity_type: "monthly_invoice", data: { description: "Monatsrechnung erstellt", amount: "850.00", period: "2025-01" } },
      { action: "payment_received", entity_type: "payment", data: { description: "Zahlung eingegangen", amount: "850.00", method: "SEPA" } },
      { action: "settlement_created", entity_type: "settlement", data: { description: "BK-Abrechnung 2024 erstellt", year: 2024 } },
      { action: "invoice_created", entity_type: "monthly_invoice", data: { description: "Monatsrechnung erstellt", amount: "1200.00", period: "2025-02" } },
      { action: "payment_received", entity_type: "payment", data: { description: "Zahlung eingegangen", amount: "1200.00", method: "Überweisung" } },
      { action: "invoice_created", entity_type: "monthly_invoice", data: { description: "Monatsrechnung erstellt", amount: "650.00", period: "2025-03" } },
      { action: "payment_received", entity_type: "payment", data: { description: "Zahlung eingegangen", amount: "650.00", method: "SEPA" } },
      { action: "settlement_updated", entity_type: "settlement", data: { description: "BK-Abrechnung 2024 finalisiert", year: 2024, status: "finalisiert" } },
    ];

    for (const a of actions) {
      const dataStr = JSON.stringify(a.data);
      const hash = crypto.createHash("sha256").update(`${previousHash}|${a.action}|${a.entity_type}|${dataStr}`).digest("hex");

      await db.execute(sql`
        INSERT INTO financial_audit_log (action, entity_type, entity_id, organization_id, user_id, data, previous_hash, hash)
        VALUES (${a.action}, ${a.entity_type}, ${crypto.randomUUID()}, ${ORG_ID}, ${USER_ID}, ${dataStr}::jsonb, ${previousHash}, ${hash})
      `);
      previousHash = hash;
    }
    console.log(`Created ${actions.length} audit log entries with hash chain`);
  }

  console.log("\n=== Final Statistics ===");
  const stats = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM bank_accounts WHERE organization_id = ${ORG_ID}) as bank_accounts,
      (SELECT COUNT(*) FROM weg_assemblies WHERE organization_id = ${ORG_ID}) as assemblies,
      (SELECT COUNT(*) FROM weg_unit_owners WHERE organization_id = ${ORG_ID}) as unit_owners,
      (SELECT COUNT(*) FROM owners WHERE organization_id = ${ORG_ID}) as owners,
      (SELECT COUNT(*) FROM financial_audit_log WHERE organization_id = ${ORG_ID}) as audit_entries,
      (SELECT COUNT(*) FROM leases) as leases,
      (SELECT COUNT(*) FROM payments) as payments
  `);
  const s = stats.rows[0] as any;
  console.log(`Bank accounts: ${s.bank_accounts}`);
  console.log(`WEG assemblies: ${s.assemblies}`);
  console.log(`WEG unit owners: ${s.unit_owners}`);
  console.log(`Owners: ${s.owners}`);
  console.log(`Audit entries: ${s.audit_entries}`);
  console.log(`Leases: ${s.leases}`);
  console.log(`Payments: ${s.payments}`);
}

seedExtended()
  .then(() => { console.log("=== Extended seed complete ==="); process.exit(0); })
  .catch((e) => { console.error("Seed failed:", e); process.exit(1); });
