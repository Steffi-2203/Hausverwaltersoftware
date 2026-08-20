-- OCR-Übernahmen müssen wiederholsicher mit Eingangsrechnung, Journal und
-- abrechnungsrelevanter Kostenposition verknüpft bleiben.
ALTER TABLE incoming_invoices
  ADD COLUMN IF NOT EXISTS ocr_document_id TEXT,
  ADD COLUMN IF NOT EXISTS ocr_payload_hash TEXT;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS incoming_invoice_id UUID REFERENCES incoming_invoices(id);

CREATE UNIQUE INDEX IF NOT EXISTS incoming_invoices_org_ocr_document_key
  ON incoming_invoices (organization_id, ocr_document_id)
  WHERE ocr_document_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS expenses_incoming_invoice_key
  ON expenses (incoming_invoice_id)
  WHERE incoming_invoice_id IS NOT NULL;

COMMENT ON COLUMN incoming_invoices.ocr_document_id IS
  'Stabile OCR-Vorgangs-ID. Wiederholte Übernahmen derselben Prüfung erzeugen keine zweite Buchung.';
COMMENT ON COLUMN expenses.incoming_invoice_id IS
  'Nachweisbare Herkunft der abrechnungsrelevanten Kostenposition aus einer Eingangsrechnung.';