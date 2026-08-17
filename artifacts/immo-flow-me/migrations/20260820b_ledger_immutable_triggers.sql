-- Migration: Append-Only-Schutz auf kritische Ledger-Tabellen ausweiten
--
-- Hintergrund:
--   Der Unveränderlichkeits-Trigger schützt bisher nur kautions_bewegungen.
--   Die folgenden Tabellen sind ebenfalls rein append-only und dürfen nach dem
--   Anlegen (INSERT) nie mehr verändert werden — sie bilden das Buchführungs-
--   Fundament (Fremdgeld, Mietbuchungen, WEG-Abrechnungen, Doppik):
--
--     invoice_lines        — Einzelposten einer Mietzinsvorschreibung
--     payment_allocations  — Zuordnung einer Zahlung zu einer Vorschreibung
--     weg_settlement_details — Eigentümer-Anteile der WEG-Jahresabrechnung
--     journal_entry_lines  — Zeilen eines Buchungssatzes (Doppik, § 190 UGB)
--
--   Ohne Trigger-Schutz auf DB-Ebene könnten direkte SQL-Zugriffe (Admin-Tool,
--   pg-Client, fehlerhafte Migration) Buchungsdaten stille verändern, ohne dass
--   die Anwendungslogik davon erfährt.
--
-- Alle Trigger-Funktionen sind idempotent (CREATE OR REPLACE).
-- DROP TRIGGER IF EXISTS stellt sicher dass Re-Runs sicher sind.

-- ── 1. invoice_lines ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION prevent_invoice_lines_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'invoice_lines-Einträge sind unveränderlich — UPDATE und DELETE sind nicht zulässig. '
    '(Ledger-Integrität / Mietbuchungen). '
    'Nur INSERT (Append) ist erlaubt.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_lines_immutable ON invoice_lines;

CREATE TRIGGER trg_invoice_lines_immutable
BEFORE UPDATE OR DELETE ON invoice_lines
FOR EACH ROW
EXECUTE FUNCTION prevent_invoice_lines_modification();

-- ── 2. payment_allocations ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION prevent_payment_allocations_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'payment_allocations-Einträge sind unveränderlich — UPDATE und DELETE sind nicht zulässig. '
    '(Ledger-Integrität / Zahlungszuordnungen). '
    'Nur INSERT (Append) ist erlaubt.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_allocations_immutable ON payment_allocations;

CREATE TRIGGER trg_payment_allocations_immutable
BEFORE UPDATE OR DELETE ON payment_allocations
FOR EACH ROW
EXECUTE FUNCTION prevent_payment_allocations_modification();

-- ── 3. weg_settlement_details ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION prevent_weg_settlement_details_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'weg_settlement_details-Einträge sind unveränderlich — UPDATE und DELETE sind nicht zulässig. '
    '(Ledger-Integrität / WEG-Jahresabrechnung). '
    'Nur INSERT (Append) ist erlaubt.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_weg_settlement_details_immutable ON weg_settlement_details;

CREATE TRIGGER trg_weg_settlement_details_immutable
BEFORE UPDATE OR DELETE ON weg_settlement_details
FOR EACH ROW
EXECUTE FUNCTION prevent_weg_settlement_details_modification();

-- ── 4. journal_entry_lines ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION prevent_journal_entry_lines_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'journal_entry_lines-Einträge sind unveränderlich — UPDATE und DELETE sind nicht zulässig. '
    '(Ledger-Integrität / Doppik § 190 UGB). '
    'Nur INSERT (Append) ist erlaubt.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_entry_lines_immutable ON journal_entry_lines;

CREATE TRIGGER trg_journal_entry_lines_immutable
BEFORE UPDATE OR DELETE ON journal_entry_lines
FOR EACH ROW
EXECUTE FUNCTION prevent_journal_entry_lines_modification();
