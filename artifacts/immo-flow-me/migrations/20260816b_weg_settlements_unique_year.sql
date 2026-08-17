-- Doppel-Abrechnung auf DB-Ebene verhindern (zweite Schutzschicht hinter der API-Prüfung)
--
-- SICHERHEITS-PREFLIGHT: Wenn bereits Duplikate in der DB existieren,
-- wird hier ein expliziter Fehler (P0001) ausgelöst — kein IGNORABLE_PG_CODE.
-- Die Migration schlägt dann LAUT fehl und wird NICHT als applied markiert.
-- Der Operator muss die Duplikate manuell bereinigen bevor die Migration laufen kann.

DO $$
DECLARE
  dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT property_id, year, organization_id
    FROM weg_settlements
    GROUP BY property_id, year, organization_id
    HAVING COUNT(*) > 1
  ) sub;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'Migration abgebrochen: % doppelte (property_id, year, organization_id)-Kombination(en) in weg_settlements gefunden. Bitte zuerst Duplikate manuell bereinigen.',
      dup_count
    USING ERRCODE = 'P0001';
  END IF;
END $$;

ALTER TABLE weg_settlements
  ADD CONSTRAINT uq_weg_settlements_property_year
  UNIQUE (property_id, year, organization_id);
