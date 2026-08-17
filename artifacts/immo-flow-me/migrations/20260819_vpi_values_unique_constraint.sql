-- Sichert eindeutige (year, month)-Paare in vpi_values.
-- Nötig damit ON CONFLICT (year, month) im Upsert funktioniert.
--
-- Schritt 1: Duplikate entfernen (behalte die neueste Zeile je Paar)
DELETE FROM vpi_values
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY year, month ORDER BY updated_at DESC, id DESC) AS rn
    FROM vpi_values
  ) ranked
  WHERE rn > 1
);

-- Schritt 2: Constraint hinzufügen (schlägt sauber fehl wenn noch Duplikate vorhanden sind)
ALTER TABLE vpi_values
  ADD CONSTRAINT vpi_values_year_month_unique UNIQUE (year, month);
