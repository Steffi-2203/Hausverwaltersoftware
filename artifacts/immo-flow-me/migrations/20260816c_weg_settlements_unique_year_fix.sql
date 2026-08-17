-- Korrektur des Unique-Constraints auf weg_settlements.
--
-- ATOMIZITÄT-GARANTIE:
--   Preflight + DROP + ADD CONSTRAINT laufen in EINEM DO-Block mit LOCK TABLE.
--   Kein konkurrierender INSERT kann zwischen Preflight und ADD CONSTRAINT eindringen.
--   Falls ADD CONSTRAINT trotzdem mit 23505 (unique_violation) fehlschlägt,
--   wird der Fehler als P0001 neu geworfen — P0001 ist NICHT im IGNORABLE_PG_CODES-Set
--   des Migration-Runners, daher wird die Migration NICHT als applied markiert.
--
-- WARUM (property_id, year) statt (property_id, year, organization_id):
--   organization_id ist nullable; PostgreSQL behandelt NULL in UNIQUE als distinct.
--   property_id identifiziert die Org eindeutig → (property_id, year) reicht.

DO $$
DECLARE
  dup_count INT;
BEGIN
  -- Tabelle sperren, damit keine konkurrierenden INSERTs während der Migration möglich sind.
  LOCK TABLE weg_settlements IN SHARE ROW EXCLUSIVE MODE;

  -- Preflight: Duplikate auf (property_id, year) prüfen, inkl. organization_id IS NULL
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT property_id, year
    FROM weg_settlements
    GROUP BY property_id, year
    HAVING COUNT(*) > 1
  ) sub;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'Migration abgebrochen: % doppelte (property_id, year)-Kombination(en) gefunden. Bitte vor dieser Migration bereinigen.',
      dup_count
    USING ERRCODE = 'P0001';
  END IF;

  -- Alten 3-Spalten-Constraint entfernen (aus Migration 20260816b, falls vorhanden)
  ALTER TABLE weg_settlements
    DROP CONSTRAINT IF EXISTS uq_weg_settlements_property_year;

  -- Neuen Constraint atomisch hinzufügen (innerhalb des Table-Locks).
  -- Falls dies trotz Preflight + Lock mit 23505 fehlschlägt (z. B. durch einen
  -- anderen gleichzeitigen Constraint), wird 23505 als P0001 neu geworfen —
  -- P0001 liegt NICHT in IGNORABLE_PG_CODES → Migration wird NICHT als applied markiert.
  BEGIN
    ALTER TABLE weg_settlements
      ADD CONSTRAINT uq_weg_settlements_property_year
      UNIQUE (property_id, year);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION
      'ADD CONSTRAINT schlug mit unique_violation fehl. Migration nicht als applied markieren — Constraint fehlt. Ursache prüfen und Migration neu starten.'
    USING ERRCODE = 'P0001';
  END;

END $$;
