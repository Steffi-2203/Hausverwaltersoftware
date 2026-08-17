-- Audit-Befund P1: Periodensperre auf Datenbankebene durchsetzen
-- Die bisherige app-level Prüfung in periodLockService.ts ist nötig aber nicht
-- ausreichend: Ein Aufruf, der die Middleware umgeht (direkter DB-Zugriff,
-- zukünftige Route ohne Guard), kann trotzdem in eine gesperrte Periode buchen.
-- Dieser Trigger fängt ALLE INSERT-Versuche auf journal_entries ab.

CREATE OR REPLACE FUNCTION check_journal_entry_period_lock()
RETURNS TRIGGER AS $$
DECLARE
  v_year  INT;
  v_month INT;
BEGIN
  v_year  := EXTRACT(YEAR  FROM NEW.entry_date::DATE)::INT;
  v_month := EXTRACT(MONTH FROM NEW.entry_date::DATE)::INT;

  IF EXISTS (
    SELECT 1 FROM period_locks
    WHERE organization_id = NEW.organization_id
      AND year  = v_year
      AND month = v_month
  ) THEN
    RAISE EXCEPTION
      'Buchungsperiode %/% ist gesperrt (BAO §132). Entsperrung durch Admin erforderlich.',
      v_month, v_year
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger existiert evtl. aus früheren Versuchen — sauber ersetzen.
DROP TRIGGER IF EXISTS trg_journal_entries_period_lock ON journal_entries;

CREATE TRIGGER trg_journal_entries_period_lock
  BEFORE INSERT ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION check_journal_entry_period_lock();

-- Kommentar für Datenbankdokumentation
COMMENT ON FUNCTION check_journal_entry_period_lock() IS
  'Verhindert Buchungen in gesperrte Perioden (BAO §132). Ergänzt app-level periodLockService.ts.';
