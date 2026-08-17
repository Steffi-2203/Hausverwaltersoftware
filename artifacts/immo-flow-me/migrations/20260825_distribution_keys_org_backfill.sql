-- Task #138: Verteilerschlüssel ohne organization_id wieder nutzbar machen.
-- Legacy-Zeilen mit organization_id = NULL sind durch RLS (org_isolation)
-- für ALLE Organisationen unsichtbar und damit weder les- noch bearbeitbar.
--
-- Ist-Zustand bei Erstellung: 6 globale System-Standardschlüssel
-- (is_system = true, property_id IS NULL), keine Referenzen.
--
-- Strategie:
--   1) Zeilen mit property: organization_id aus der Liegenschaft ableiten.
--   2) Globale Systemschlüssel: pro Organisation eine eigene Kopie anlegen
--      (dadurch pro Org sicht- und bearbeitbar).
--   3) Nicht mehr referenzierte NULL-org-Zeilen entfernen.
--   4) NOT NULL setzen, sofern keine NULL-Zeilen übrig sind (referenzierte
--      Alt-Zeilen werden geloggt statt gelöscht).

-- 1) Backfill aus der Liegenschaft
UPDATE distribution_keys dk
SET organization_id = p.organization_id, updated_at = NOW()
FROM properties p
WHERE dk.organization_id IS NULL
  AND dk.property_id = p.id
  AND p.organization_id IS NOT NULL;

-- 2) Globale Schlüssel (org & property NULL) pro Organisation kopieren
INSERT INTO distribution_keys
  (organization_id, property_id, key_code, name, description, formula, unit,
   input_type, included_unit_types, is_system, is_active, mrg_konform,
   mrg_paragraph, sort_order)
SELECT o.id, NULL, dk.key_code, dk.name, dk.description, dk.formula, dk.unit,
       dk.input_type, dk.included_unit_types, dk.is_system, dk.is_active,
       dk.mrg_konform, dk.mrg_paragraph, dk.sort_order
FROM distribution_keys dk
CROSS JOIN organizations o
WHERE dk.organization_id IS NULL
  AND dk.property_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM distribution_keys d2
    WHERE d2.organization_id = o.id AND d2.key_code = dk.key_code
  );

-- 3) Unreferenzierte NULL-org-Zeilen entfernen
DELETE FROM distribution_keys dk
WHERE dk.organization_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.distribution_key_id = dk.id)
  AND NOT EXISTS (SELECT 1 FROM unit_distribution_values u WHERE u.key_id = dk.id)
  AND NOT EXISTS (SELECT 1 FROM account_categories a WHERE a.default_distribution_key_id = dk.id);

-- 4) NOT NULL nur wenn nichts übrig bleibt; sonst Warnung mit den IDs
DO $mig$
DECLARE
  remaining int;
  ids text;
BEGIN
  SELECT count(*), string_agg(id::text, ', ')
    INTO remaining, ids
  FROM distribution_keys
  WHERE organization_id IS NULL;

  IF remaining = 0 THEN
    ALTER TABLE distribution_keys ALTER COLUMN organization_id SET NOT NULL;
  ELSE
    RAISE WARNING 'distribution_keys: % referenzierte Zeile(n) ohne organization_id (IDs: %) — NOT NULL nicht gesetzt, manuelle Bereinigung nötig', remaining, ids;
  END IF;
END
$mig$;
