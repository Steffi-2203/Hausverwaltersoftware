-- Migration: BEFORE DELETE auf payments blockieren (Task #174)
--
-- Hintergrund:
--   Task #88 hat betrag/buchungs_datum per BEFORE UPDATE Trigger unveränderlich
--   gemacht. Die DELETE-Möglichkeit blieb aber offen: ein Löschen ist
--   gleichwertig mit einer stillen Manipulation des Buchungssatzes und
--   untergräbt die Ledger-Integrität.
--
--   Die Route DELETE /api/payments/:id gibt jetzt 405 zurück (kein Aufruf
--   mehr von deletePayment), aber ein Trigger auf DB-Ebene ist die
--   belastbare Schicht: er greift auch bei direktem SQL-Zugriff, Admin-Tools
--   und zukünftigen Routen-Erweiterungen.
--
-- Bypass-Strategie:
--   Der Trigger prüft app.current_org — dasselbe GUC, das rlsMiddleware für
--   jede App-Anfrage setzt. Systemoperationen (Migrationen, Test-Cleanup,
--   rootDb-Administrationsaufrufe) laufen ohne app.current_org und bleiben
--   unberührt. Das ist konsistent mit dem RLS-Modell des Projekts.
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION prevent_payment_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Nur blockieren wenn eine App-Anfrage läuft (app.current_org ist gesetzt).
  -- System-Operationen ohne Org-Kontext (Migrationen, Test-Cleanup, rootDb)
  -- dürfen weiterhin löschen.
  IF current_setting('app.current_org', TRUE) <> '' THEN
    RAISE EXCEPTION
      'payments: Löschen ist nicht zulässig (Ledger-Integrität). '
      'Korrekturen bitte per Storno/Gegenbuchung erfassen.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payments_delete_blocked ON payments;

CREATE TRIGGER trg_payments_delete_blocked
BEFORE DELETE ON payments
FOR EACH ROW
EXECUTE FUNCTION prevent_payment_delete();

COMMENT ON FUNCTION prevent_payment_delete() IS
  'Blockiert DELETE auf payments aus App-Kontext (app.current_org gesetzt). '
  'Ergänzt trg_payments_core_immutable (BEFORE UPDATE). '
  'System-Operationen ohne Org-Kontext sind ausgenommen.';
