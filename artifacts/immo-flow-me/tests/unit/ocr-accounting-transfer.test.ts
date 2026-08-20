/**
 * OCR-Buchhaltungsübergabe: echter HTTP-/DB-Nachweis.
 *
 * Start:
 *   pnpm --filter @workspace/immo-flow-me run test:ocr-accounting-transfer
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { sql } from "drizzle-orm";

import { rootDb as db } from "../../server/db";
import ocrRoutes from "../../server/routes/ocrRoutes";
import incomingInvoiceRoutes from "../../server/routes/incomingInvoiceRoutes";
import { addOrgContext } from "../helpers/withOrgContext";
import { acquireAuditLogTestLock, releaseAuditLogTestLock } from "../helpers/auditLogTestLock";

const orgId = randomUUID();
const profileId = randomUUID();
const propertyId = randomUUID();
const expenseAccountId = randomUUID();
const vatAccountId = randomUUID();
const liabilityAccountId = randomUUID();
const documentId = `ocr-transfer-${randomUUID()}`;
const email = `ocr-transfer-${profileId.slice(0, 8)}@test.local`;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: profileId, organizationId: orgId };
    next();
  });
  addOrgContext(app, orgId);
  app.use(ocrRoutes);
  app.use(incomingInvoiceRoutes);
  return app;
}

const app = buildApp();

const validPayload = {
  ocrDocumentId: documentId,
  propertyId,
  lieferant: "OCR Energie GmbH",
  rechnungsnummer: "OCR-2026-0001",
  rechnungsdatum: "2026-08-20",
  bruttobetrag: 120,
  nettobetrag: 100,
  ustBetrag: 20,
  ustSatz: 20,
  beschreibung: "Stromrechnung August 2026",
  kategorie: "betriebskosten_umlagefaehig",
  expense_type: "strom",
  source: "web_ocr",
  originalData: { lieferant: "OCR Energie GmbH", betrag: 120, datum: "2026-08-20" },
};

describe("POST /api/ocr/invoice-transfer", () => {
  before(async () => {
    await acquireAuditLogTestLock();
    await db.execute(sql`
      INSERT INTO organizations (id, name)
      VALUES (${orgId}::uuid, 'OCR Accounting Transfer Org')
    `);
    await db.execute(sql`
      INSERT INTO profiles (id, email, organization_id)
      VALUES (${profileId}::uuid, ${email}, ${orgId}::uuid)
    `);
    await db.execute(sql`
      INSERT INTO user_roles (user_id, role)
      VALUES (${profileId}::uuid, 'admin')
    `);
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, address, city, postal_code)
      VALUES (${propertyId}::uuid, ${orgId}::uuid, 'OCR-Haus', 'Testgasse 20', 'Wien', '1010')
    `);
    await db.execute(sql`
      INSERT INTO chart_of_accounts (id, organization_id, account_number, name, account_type, is_active)
      VALUES
        (${expenseAccountId}::uuid, ${orgId}::uuid, '5000', 'Betriebskosten Aufwand', 'expense', true),
        (${vatAccountId}::uuid, ${orgId}::uuid, '2500', 'Vorsteuer', 'asset', true),
        (${liabilityAccountId}::uuid, ${orgId}::uuid, '3300', 'Verbindlichkeit Lieferanten', 'liability', true)
    `);
  });

  after(async () => {
    try {
      await db.execute(sql`
        DELETE FROM expenses e
        USING incoming_invoices ii
        WHERE e.incoming_invoice_id = ii.id
          AND ii.organization_id = ${orgId}::uuid
      `);
      await db.execute(sql`DELETE FROM incoming_invoices WHERE organization_id = ${orgId}::uuid`);
      await db.execute(sql`ALTER TABLE journal_entry_lines DISABLE TRIGGER ALL`);
      try {
        await db.execute(sql`
          DELETE FROM journal_entry_lines jel
          USING journal_entries je
          WHERE jel.journal_entry_id = je.id
            AND je.organization_id = ${orgId}::uuid
        `);
      } finally {
        await db.execute(sql`ALTER TABLE journal_entry_lines ENABLE TRIGGER ALL`);
      }
      await db.execute(sql`DELETE FROM journal_entries WHERE organization_id = ${orgId}::uuid`);
      await db.execute(sql`DELETE FROM booking_number_sequences WHERE organization_id = ${orgId}::uuid`);
      await db.execute(sql`DELETE FROM chart_of_accounts WHERE organization_id = ${orgId}::uuid`);
      await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}::uuid`);
      await db.execute(sql`DELETE FROM audit_logs WHERE user_id = ${profileId}::uuid`);
      await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${profileId}::uuid`);
      await db.execute(sql`DELETE FROM profiles WHERE id = ${profileId}::uuid`);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
    } catch (error) {
      console.warn("OCR accounting transfer cleanup (non-fatal):", error);
    } finally {
      await releaseAuditLogTestLock();
    }
  });

  test("übernimmt die geprüfte OCR-Rechnung als Eingangsrechnung, Journal und BK-Kosten", async () => {
    const response = await request(app)
      .post("/api/ocr/invoice-transfer")
      .send(validPayload);

    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.created, true);
    assert.ok(response.body.incomingInvoiceId);
    assert.ok(response.body.journalEntryId);
    assert.ok(response.body.expenseId);

    const incoming = await request(app).get("/api/incoming-invoices");
    assert.equal(incoming.status, 200);
    const invoice = incoming.body.find((row: any) => row.id === response.body.incomingInvoiceId);
    assert.ok(invoice, "Die OCR-Rechnung muss in Eingangsrechnungen sichtbar sein");
    assert.equal(invoice.ocr_document_id, documentId);
    assert.equal(invoice.journal_entry_id, response.body.journalEntryId);
    assert.equal(Number(invoice.amount_gross), 120);

    const costs = await db.execute(sql`
      SELECT id, betrag, ist_umlagefaehig, incoming_invoice_id
      FROM expenses
      WHERE id = ${response.body.expenseId}::uuid
    `);
    assert.equal(costs.rows.length, 1, "Die abrechnungsrelevante Kostenposition fehlt");
    assert.equal(Number((costs.rows[0] as any).betrag), 120);
    assert.equal((costs.rows[0] as any).ist_umlagefaehig, true);
    assert.equal((costs.rows[0] as any).incoming_invoice_id, response.body.incomingInvoiceId);

    const journalLines = await db.execute(sql`
      SELECT debit, credit FROM journal_entry_lines
      WHERE journal_entry_id = ${response.body.journalEntryId}::uuid
    `);
    assert.equal(journalLines.rows.length, 3, "Netto, Vorsteuer und Verbindlichkeit müssen gebucht sein");
    const debit = (journalLines.rows as any[]).reduce((sum, row) => sum + Number(row.debit), 0);
    const credit = (journalLines.rows as any[]).reduce((sum, row) => sum + Number(row.credit), 0);
    assert.equal(debit, 120);
    assert.equal(credit, 120);

    const audit = await db.execute(sql`
      SELECT details FROM audit_logs
      WHERE table_name = 'ocr_invoice_transfers'
        AND record_id = ${response.body.incomingInvoiceId}
        AND action = 'ocr_invoice_transfer'
      LIMIT 1
    `);
    assert.equal(audit.rows.length, 1, "Der Transfer muss mit dem OCR-Protokoll nachweisbar sein");
    const details = typeof (audit.rows[0] as any).details === "string"
      ? JSON.parse((audit.rows[0] as any).details)
      : (audit.rows[0] as any).details;
    assert.equal(details.expense_id, response.body.expenseId);
    assert.equal(details.journal_entry_id, response.body.journalEntryId);
  });

  test("lehnt fehlende Liegenschaft und widersprüchliche Beträge verständlich ab", async () => {
    const missingProperty = await request(app)
      .post("/api/ocr/invoice-transfer")
      .send({ ...validPayload, ocrDocumentId: `missing-${randomUUID()}`, propertyId: "" });
    assert.equal(missingProperty.status, 400);
    assert.match(missingProperty.body.error, /Liegenschaft/i);

    const inconsistentAmount = await request(app)
      .post("/api/ocr/invoice-transfer")
      .send({ ...validPayload, ocrDocumentId: `amount-${randomUUID()}`, nettobetrag: 80 });
    assert.equal(inconsistentAmount.status, 400);
    assert.match(inconsistentAmount.body.error, /widersprechen/i);

    const inconsistentVat = await request(app)
      .post("/api/ocr/invoice-transfer")
      .send({ ...validPayload, ocrDocumentId: `vat-${randomUUID()}`, ustBetrag: 19 });
    assert.equal(inconsistentVat.status, 400);
    assert.match(inconsistentVat.body.error, /widersprechen/i);
  });

  test("wiederholte Bestätigung liefert den vorhandenen Transfer ohne Duplikate", async () => {
    const response = await request(app)
      .post("/api/ocr/invoice-transfer")
      .send(validPayload);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.created, false);
    assert.equal(response.body.alreadyTransferred, true);

    const counts = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM incoming_invoices WHERE organization_id = ${orgId}::uuid AND ocr_document_id = ${documentId}) AS invoices,
        (SELECT COUNT(*) FROM expenses e JOIN incoming_invoices ii ON ii.id = e.incoming_invoice_id
          WHERE ii.organization_id = ${orgId}::uuid AND ii.ocr_document_id = ${documentId}) AS expenses,
        (SELECT COUNT(*) FROM journal_entries je JOIN incoming_invoices ii ON ii.journal_entry_id = je.id
          WHERE ii.organization_id = ${orgId}::uuid AND ii.ocr_document_id = ${documentId}) AS journals
    `);
    const row = counts.rows[0] as any;
    assert.equal(Number(row.invoices), 1);
    assert.equal(Number(row.expenses), 1);
    assert.equal(Number(row.journals), 1);
  });
});