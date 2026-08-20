-- Abschluss der Bereinigung aus 20260825_distribution_keys_org_backfill.sql.
-- Die erste Migration ließ referenzierte Legacy-Schlüssel ohne organization_id
-- bewusst stehen. Dieser Nachtrag löst diese drei verbleibenden FK-Ketten auf,
-- damit der Publish-Workflow organization_id anschließend sicher auf NOT NULL
-- setzen kann.

-- Die ursprünglichen NULL-Zeilen merken: Nach dem Backfill lässt sich nur so
-- sicher unterscheiden, ob eine abweichende FK-Organisation ein Altbestand
-- oder ein neuerer, fachlich unabhängiger Datenfehler ist.
CREATE TEMP TABLE IF NOT EXISTS distribution_keys_null_org_legacy (
  id uuid PRIMARY KEY
);
TRUNCATE distribution_keys_null_org_legacy;
INSERT INTO distribution_keys_null_org_legacy (id)
SELECT id
FROM distribution_keys
WHERE organization_id IS NULL;

-- Bevor irgendwelche Legacy-Daten verändert werden, muss jede Referenz aus
-- allen drei FK-Ketten auflösbar sein. Optionalität eines FKs ist keine
-- Erlaubnis, eine bestehende fachliche Zuordnung stillschweigend zu löschen.
-- Die Migration bricht atomar ab, damit ein Betreiber einen passenden
-- org-spezifischen Schlüssel anlegen oder die Daten bewusst bereinigen kann.
DO $preflight$
DECLARE
  invalid_reference_count int;
BEGIN
  WITH legacy_references AS (
    SELECT dk.id AS key_id, 'expense'::text AS reference_type, e.id AS reference_id,
           p.organization_id, e.property_id
    FROM expenses e
    JOIN distribution_keys dk ON dk.id = e.distribution_key_id
    JOIN distribution_keys_null_org_legacy legacy ON legacy.id = dk.id
    LEFT JOIN properties p ON p.id = e.property_id

    UNION ALL

    SELECT dk.id, 'unit_value', udv.id, p.organization_id, u.property_id
    FROM unit_distribution_values udv
    JOIN distribution_keys dk ON dk.id = udv.key_id
    JOIN distribution_keys_null_org_legacy legacy ON legacy.id = dk.id
    JOIN units u ON u.id = udv.unit_id
    LEFT JOIN properties p ON p.id = u.property_id

    UNION ALL

    SELECT dk.id, 'account_category', ac.id, ac.organization_id, NULL::uuid
    FROM account_categories ac
    JOIN distribution_keys dk ON dk.id = ac.default_distribution_key_id
    JOIN distribution_keys_null_org_legacy legacy ON legacy.id = dk.id
  ),
  invalid_references AS (
    SELECT reference.reference_id
    FROM legacy_references reference
    JOIN distribution_keys dk ON dk.id = reference.key_id
    LEFT JOIN properties key_property ON key_property.id = dk.property_id
    WHERE reference.organization_id IS NULL
       OR (
         (
           (
             dk.property_id IS NOT NULL
             AND key_property.organization_id IS DISTINCT FROM reference.organization_id
           )
           OR EXISTS (
             SELECT 1
             FROM legacy_references other_reference
             WHERE other_reference.key_id = reference.key_id
               AND other_reference.organization_id IS DISTINCT FROM reference.organization_id
           )
         )
         AND NOT EXISTS (
           SELECT 1
           FROM distribution_keys candidate
           WHERE candidate.organization_id = reference.organization_id
             AND candidate.key_code = dk.key_code
             AND (
               (
                 reference.reference_type = 'account_category'
                 AND candidate.property_id IS NULL
               )
               OR (
                 reference.reference_type <> 'account_category'
                 AND (
                   candidate.property_id = reference.property_id
                   OR candidate.property_id IS NULL
                 )
               )
             )
         )
       )
  )
  SELECT COUNT(*) INTO invalid_reference_count
  FROM invalid_references;

  IF invalid_reference_count <> 0 THEN
    RAISE EXCEPTION
      'distribution_keys migration cannot safely resolve % legacy reference(s); repair matching org-specific keys before retrying',
      invalid_reference_count;
  END IF;
END
$preflight$;

-- 1) Schlüssel mit eigener Liegenschaft direkt deren Organisation zuordnen.
UPDATE distribution_keys dk
SET organization_id = p.organization_id,
    updated_at = NOW()
FROM properties p
WHERE dk.organization_id IS NULL
  AND dk.property_id = p.id
  AND p.organization_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM distribution_keys conflicting_key
    WHERE conflicting_key.id <> dk.id
      AND conflicting_key.organization_id = p.organization_id
      AND conflicting_key.key_code = dk.key_code
      AND conflicting_key.property_id IS NULL
      AND dk.property_id IS NULL
  );

-- 2) Referenzen von Ausgaben über deren Pflicht-Liegenschaft auflösen.
-- expenses.property_id ist im Schema NOT NULL; einen Tenant-/Lease-Fallback
-- gibt es in dieser Tabelle daher nicht und wäre kein belastbarer Datenpfad.
UPDATE distribution_keys dk
SET organization_id = resolved.organization_id,
    updated_at = NOW()
FROM (
  SELECT e.distribution_key_id AS key_id, MIN(p.organization_id::text)::uuid AS organization_id
  FROM expenses e
  JOIN properties p ON p.id = e.property_id
  WHERE e.distribution_key_id IS NOT NULL
    AND p.organization_id IS NOT NULL
  GROUP BY e.distribution_key_id
) resolved
WHERE dk.id = resolved.key_id
  AND dk.organization_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM distribution_keys conflicting_key
    WHERE conflicting_key.id <> dk.id
      AND conflicting_key.organization_id = resolved.organization_id
      AND conflicting_key.key_code = dk.key_code
      AND conflicting_key.property_id IS NULL
      AND dk.property_id IS NULL
  );

-- 3) Referenzen von Einheitswerten über Einheit → Liegenschaft auflösen.
UPDATE distribution_keys dk
SET organization_id = resolved.organization_id,
    updated_at = NOW()
FROM (
  SELECT udv.key_id, MIN(p.organization_id::text)::uuid AS organization_id
  FROM unit_distribution_values udv
  JOIN units u ON u.id = udv.unit_id
  JOIN properties p ON p.id = u.property_id
  WHERE p.organization_id IS NOT NULL
  GROUP BY udv.key_id
) resolved
WHERE dk.id = resolved.key_id
  AND dk.organization_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM distribution_keys conflicting_key
    WHERE conflicting_key.id <> dk.id
      AND conflicting_key.organization_id = resolved.organization_id
      AND conflicting_key.key_code = dk.key_code
      AND conflicting_key.property_id IS NULL
      AND dk.property_id IS NULL
  );

-- 4) Konten-Kategorien führen die Organisation selbst.
UPDATE distribution_keys dk
SET organization_id = resolved.organization_id,
    updated_at = NOW()
FROM (
  SELECT ac.default_distribution_key_id AS key_id, MIN(ac.organization_id::text)::uuid AS organization_id
  FROM account_categories ac
  WHERE ac.default_distribution_key_id IS NOT NULL
    AND ac.organization_id IS NOT NULL
  GROUP BY ac.default_distribution_key_id
) resolved
WHERE dk.id = resolved.key_id
  AND dk.organization_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM distribution_keys conflicting_key
    WHERE conflicting_key.id <> dk.id
      AND conflicting_key.organization_id = resolved.organization_id
      AND conflicting_key.key_code = dk.key_code
      AND conflicting_key.property_id IS NULL
      AND dk.property_id IS NULL
  );

-- 5) Für noch nicht ableitbare Legacy-Schlüssel vorhandene gleichartige
-- org-spezifische Schlüssel bevorzugen. So bleiben referenzierte Daten
-- erhalten, falls die Besitzorganisation nur am FK erkennbar ist.
WITH unresolved_expenses AS (
  SELECT e.id AS expense_id, e.property_id, dk.key_code, p.organization_id
  FROM expenses e
  JOIN distribution_keys dk ON dk.id = e.distribution_key_id
  JOIN distribution_keys_null_org_legacy legacy ON legacy.id = dk.id
  JOIN properties p ON p.id = e.property_id
  WHERE p.organization_id IS NOT NULL
    AND dk.organization_id IS DISTINCT FROM p.organization_id
)
UPDATE expenses e
SET distribution_key_id = replacement.id
FROM unresolved_expenses source
CROSS JOIN LATERAL (
  SELECT candidate.id
  FROM distribution_keys candidate
  WHERE candidate.organization_id = source.organization_id
    AND candidate.key_code = source.key_code
    AND (
      candidate.property_id = source.property_id
      OR candidate.property_id IS NULL
    )
  ORDER BY
    CASE
      WHEN candidate.property_id = source.property_id THEN 0
      WHEN candidate.property_id IS NULL THEN 1
    END,
    candidate.created_at,
    candidate.id
  LIMIT 1
) replacement
WHERE e.id = source.expense_id;

WITH unresolved_unit_values AS (
  SELECT udv.id AS unit_value_id, u.property_id, dk.key_code, p.organization_id
  FROM unit_distribution_values udv
  JOIN distribution_keys dk ON dk.id = udv.key_id
  JOIN distribution_keys_null_org_legacy legacy ON legacy.id = dk.id
  JOIN units u ON u.id = udv.unit_id
  JOIN properties p ON p.id = u.property_id
  WHERE p.organization_id IS NOT NULL
    AND dk.organization_id IS DISTINCT FROM p.organization_id
)
UPDATE unit_distribution_values udv
SET key_id = replacement.id,
    updated_at = NOW()
FROM unresolved_unit_values source
CROSS JOIN LATERAL (
  SELECT candidate.id
  FROM distribution_keys candidate
  WHERE candidate.organization_id = source.organization_id
    AND candidate.key_code = source.key_code
    AND (
      candidate.property_id = source.property_id
      OR candidate.property_id IS NULL
    )
  ORDER BY
    CASE
      WHEN candidate.property_id = source.property_id THEN 0
      WHEN candidate.property_id IS NULL THEN 1
    END,
    candidate.created_at,
    candidate.id
  LIMIT 1
) replacement
WHERE udv.id = source.unit_value_id;

WITH unresolved_categories AS (
  SELECT ac.id AS category_id, dk.key_code, ac.organization_id
  FROM account_categories ac
  JOIN distribution_keys dk ON dk.id = ac.default_distribution_key_id
  JOIN distribution_keys_null_org_legacy legacy ON legacy.id = dk.id
  WHERE ac.organization_id IS NOT NULL
    AND dk.organization_id IS DISTINCT FROM ac.organization_id
)
UPDATE account_categories ac
SET default_distribution_key_id = replacement.id
FROM unresolved_categories source
CROSS JOIN LATERAL (
  SELECT candidate.id
  FROM distribution_keys candidate
  WHERE candidate.organization_id = source.organization_id
    AND candidate.key_code = source.key_code
    AND candidate.property_id IS NULL
  ORDER BY
    candidate.created_at,
    candidate.id
  LIMIT 1
) replacement
WHERE ac.id = source.category_id;

-- 6) Nach dem Umhängen müssen alle drei FK-Ketten organisationskonsistent
-- sein. Dieser Check ist absichtlich breiter als der NOT-NULL-Check unten.
DO $references_postcondition$
DECLARE
  remaining int;
BEGIN
  WITH legacy_references AS (
    SELECT dk.id AS key_id, p.organization_id
    FROM expenses e
    JOIN distribution_keys dk ON dk.id = e.distribution_key_id
    JOIN distribution_keys_null_org_legacy legacy ON legacy.id = dk.id
    LEFT JOIN properties p ON p.id = e.property_id

    UNION ALL

    SELECT dk.id, p.organization_id
    FROM unit_distribution_values udv
    JOIN distribution_keys dk ON dk.id = udv.key_id
    JOIN distribution_keys_null_org_legacy legacy ON legacy.id = dk.id
    JOIN units u ON u.id = udv.unit_id
    LEFT JOIN properties p ON p.id = u.property_id

    UNION ALL

    SELECT dk.id, ac.organization_id
    FROM account_categories ac
    JOIN distribution_keys dk ON dk.id = ac.default_distribution_key_id
    JOIN distribution_keys_null_org_legacy legacy ON legacy.id = dk.id
  )
  SELECT COUNT(*) INTO remaining
  FROM legacy_references reference
  JOIN distribution_keys dk ON dk.id = reference.key_id
  WHERE reference.organization_id IS NULL
     OR dk.organization_id IS DISTINCT FROM reference.organization_id;

  IF remaining <> 0 THEN
    RAISE EXCEPTION
      'distribution_keys migration incomplete: % legacy reference(s) are not org-consistent',
      remaining;
  END IF;
END
$references_postcondition$;

-- 7) Danach sind alle verbliebenen Legacy-Schlüssel unreferenziert.
DELETE FROM distribution_keys dk
USING distribution_keys_null_org_legacy legacy
WHERE dk.id = legacy.id
  AND dk.organization_id IS NULL;

DROP TABLE distribution_keys_null_org_legacy;

-- 20260826 could be recorded despite a pre-existing duplicate, because the
-- older runner treated SQLSTATE 23505 as ignorable. Verify the data and ensure
-- that the index this migration relies on really exists.
DO $unique_precondition$
DECLARE
  duplicate_groups int;
BEGIN
  SELECT COUNT(*) INTO duplicate_groups
  FROM (
    SELECT organization_id, key_code
    FROM distribution_keys
    WHERE property_id IS NULL
    GROUP BY organization_id, key_code
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_groups <> 0 THEN
    RAISE EXCEPTION
      'distribution_keys migration cannot create org/key uniqueness: % duplicate group(s) remain',
      duplicate_groups;
  END IF;
END
$unique_precondition$;

CREATE UNIQUE INDEX IF NOT EXISTS distribution_keys_org_key_code_uniq
  ON distribution_keys (organization_id, key_code)
  WHERE property_id IS NULL;

-- Nicht stillschweigend fortfahren: Der Publish darf nur mit tatsächlich
-- vollständiger Mandantenzuordnung starten.
DO $mig$
DECLARE
  remaining int;
BEGIN
  SELECT COUNT(*) INTO remaining
  FROM distribution_keys
  WHERE organization_id IS NULL;

  IF remaining <> 0 THEN
    RAISE EXCEPTION
      'distribution_keys migration incomplete: % row(s) still have NULL organization_id',
      remaining;
  END IF;
END
$mig$;

ALTER TABLE distribution_keys
  ALTER COLUMN organization_id SET NOT NULL;