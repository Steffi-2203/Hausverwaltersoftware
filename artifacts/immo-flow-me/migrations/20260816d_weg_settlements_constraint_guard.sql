-- Guard-Migration: Stellt sicher dass uq_weg_settlements_property_year
-- als 2-Spalten-Constraint (property_id, year) in der DB existiert.
--
-- Hintergrund: Falls Migration 20260816c wegen eines (ignorierten) 23505-Fehlers
-- zwar als applied markiert wurde, der Constraint aber tatsächlich fehlt oder
-- noch als 3-Spalten-Version vorliegt, korrigiert diese Migration das.
-- Idempotent: existiert der korrekte Constraint bereits, passiert nichts.
--
-- Verwendet dieselbe LOCK + P0001-Re-raise-Strategie wie 20260816c.

DO $$
DECLARE
  constraint_columns TEXT;
  dup_count          INT;
BEGIN
  -- Prüfen ob Constraint existiert und ob er auf (property_id, year) liegt
  SELECT string_agg(a.attname, ',' ORDER BY array_position(c.conkey, a.attnum))
    INTO constraint_columns
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conname  = 'uq_weg_settlements_property_year'
    AND c.contype  = 'u'
    AND c.conrelid = 'weg_settlements'::regclass;

  -- Constraint ist korrekt → nichts zu tun
  IF constraint_columns = 'property_id,year' THEN
    RETURN;
  END IF;

  -- Constraint fehlt oder hat falsche Spalten → neu anlegen (mit Lock)
  LOCK TABLE weg_settlements IN SHARE ROW EXCLUSIVE MODE;

  SELECT COUNT(*) INTO dup_count FROM (
    SELECT property_id, year FROM weg_settlements
    GROUP BY property_id, year HAVING COUNT(*) > 1
  ) sub;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'Guard-Migration abgebrochen: % doppelte (property_id, year)-Kombination(en). Bitte bereinigen.',
      dup_count
    USING ERRCODE = 'P0001';
  END IF;

  -- Alten (evtl. falschen) Constraint entfernen
  ALTER TABLE weg_settlements
    DROP CONSTRAINT IF EXISTS uq_weg_settlements_property_year;

  -- Korrekten Constraint neu anlegen; 23505 → P0001 (nicht ignorierbar)
  BEGIN
    ALTER TABLE weg_settlements
      ADD CONSTRAINT uq_weg_settlements_property_year
      UNIQUE (property_id, year);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION
      'ADD CONSTRAINT schlug mit unique_violation fehl. Constraint fehlt — Migration neu starten.'
    USING ERRCODE = 'P0001';
  END;

END $$;
