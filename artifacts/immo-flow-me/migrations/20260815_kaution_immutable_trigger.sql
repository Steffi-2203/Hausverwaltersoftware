-- Migration: Kaution-Bewegungen unveränderlich machen (DB-Trigger)
--
-- Hintergrund: kautionsBewegungen ist ein append-only Ledger (Fremdgeld).
-- Die Anwendungslogik garantiert Unveränderlichkeit, aber ohne DB-Trigger
-- kann ein direkter DB-Zugriff (SQL-Client, Admin-Tool) UPDATE/DELETE ausführen
-- und die Buchungsintegrität zerstören.
--
-- Echter PostgreSQL-Tabellenname: kautions_bewegungen (snake_case, ohne Anführungszeichen)
-- (Drizzle-ORM-Typname im Code: kautionsBewegungen — das ist nur der TypeScript-Name)
--
-- Dieser Trigger verhindert UPDATE und DELETE auf DB-Ebene.
-- INSERT (Append) bleibt erlaubt.

-- 1. Trigger-Funktion anlegen (idempotent via CREATE OR REPLACE)
CREATE OR REPLACE FUNCTION prevent_kautionsbewegungen_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'kautions_bewegungen-Einträge sind unveränderlich — UPDATE und DELETE sind nicht zulässig. '
    '(Ledger-Integrität / Fremdgeld-Buchführung). '
    'Nur INSERT (Append) ist erlaubt.';
  RETURN NULL; -- Wird nie erreicht; Pflicht bei BEFORE-Triggern
END;
$$ LANGUAGE plpgsql;

-- 2. Trigger anlegen (DROP IF EXISTS für Idempotenz bei Re-Run)
--    Tabellenname: kautions_bewegungen (physischer DB-Name, kein Quoting nötig)
DROP TRIGGER IF EXISTS trg_kautionsbewegungen_immutable ON kautions_bewegungen;

CREATE TRIGGER trg_kautionsbewegungen_immutable
BEFORE UPDATE OR DELETE ON kautions_bewegungen
FOR EACH ROW
EXECUTE FUNCTION prevent_kautionsbewegungen_modification();
