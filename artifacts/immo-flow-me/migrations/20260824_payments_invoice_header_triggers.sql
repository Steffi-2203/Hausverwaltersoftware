-- Migration: Header-Tabellen payments und monthly_invoices vor nachträglichen
-- Änderungen schützen (Task-Kontext: Erweiterung von 20260820b_ledger_immutable_triggers.sql)
--
-- Hintergrund:
--   Die Zeilen-Tabellen (invoice_lines, payment_allocations, ...) sind bereits
--   append-only. Die Header-Tabellen blieben aber manipulierbar: ein direkter
--   SQL-Zugriff könnte payments.betrag oder monthly_invoices.gesamtbetrag still
--   ändern, ohne dass die Anwendung es bemerkt.
--
--   Anders als bei den Zeilen-Tabellen ist hier KEIN Voll-Schutz möglich:
--     * payments: invoice_id/notizen werden legitim aktualisiert (Zuordnung,
--       Überzahlungs-Vermerk). Nur betrag und buchungs_datum sind unveränderlich.
--     * monthly_invoices: status/paid_amount/version werden bei Zahlungseingang
--       legitim aktualisiert. Nur year, month und gesamtbetrag sind nach dem
--       Anlegen unveränderlich.
--
--   Die WHEN-Klausel sorgt dafür, dass legitime Updates die Trigger-Funktion
--   gar nicht erst ausführen.
--
-- Alle Trigger-Funktionen sind idempotent (CREATE OR REPLACE),
-- DROP TRIGGER IF EXISTS macht Re-Runs sicher.

-- ── 1. payments: betrag + buchungs_datum unveränderlich ─────────────────────

CREATE OR REPLACE FUNCTION prevent_payments_core_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'payments: betrag und buchungs_datum sind nach dem Anlegen unveränderlich '
    '(Ledger-Integrität). Korrekturen bitte per Storno/Gegenbuchung erfassen.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payments_core_immutable ON payments;

CREATE TRIGGER trg_payments_core_immutable
BEFORE UPDATE ON payments
FOR EACH ROW
WHEN (
  OLD.betrag IS DISTINCT FROM NEW.betrag
  OR OLD.buchungs_datum IS DISTINCT FROM NEW.buchungs_datum
)
EXECUTE FUNCTION prevent_payments_core_modification();

-- ── 2. monthly_invoices: year, month, gesamtbetrag unveränderlich ───────────

CREATE OR REPLACE FUNCTION prevent_monthly_invoices_core_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'monthly_invoices: year, month und gesamtbetrag sind nach dem Anlegen '
    'unveränderlich (Ledger-Integrität). Status-/Zahlungs-Updates bleiben erlaubt; '
    'Betragskorrekturen bitte per Storno/Neuvorschreibung erfassen.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_monthly_invoices_core_immutable ON monthly_invoices;

CREATE TRIGGER trg_monthly_invoices_core_immutable
BEFORE UPDATE ON monthly_invoices
FOR EACH ROW
WHEN (
  OLD.year IS DISTINCT FROM NEW.year
  OR OLD.month IS DISTINCT FROM NEW.month
  OR OLD.gesamtbetrag IS DISTINCT FROM NEW.gesamtbetrag
)
EXECUTE FUNCTION prevent_monthly_invoices_core_modification();
