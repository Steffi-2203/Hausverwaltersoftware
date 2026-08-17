-- Task #138 (Nachtrag): Eindeutigkeit der org-weiten Verteilerschlüssel erzwingen.
-- Das Check-then-Insert der Seed-Pfade war nicht nebenläufigkeitssicher —
-- ohne Unique-Constraint konnten parallele Seeds (Boot + Org-Anlage)
-- Duplikate pro (organization_id, key_code) erzeugen.
--
-- Partial Unique Index nur für org-weite Schlüssel (property_id IS NULL):
-- liegenschaftsspezifische Schlüssel dürfen denselben key_code über mehrere
-- Liegenschaften derselben Org verwenden.

-- 1) Bestehende Duplikate bereinigen (älteste Zeile gewinnt; nur unreferenzierte Duplikate löschen)
DELETE FROM distribution_keys dk
USING distribution_keys keeper
WHERE dk.property_id IS NULL
  AND keeper.property_id IS NULL
  AND dk.organization_id = keeper.organization_id
  AND dk.key_code = keeper.key_code
  AND dk.id <> keeper.id
  AND (keeper.created_at, keeper.id) < (dk.created_at, dk.id)
  AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.distribution_key_id = dk.id)
  AND NOT EXISTS (SELECT 1 FROM unit_distribution_values u WHERE u.key_id = dk.id)
  AND NOT EXISTS (SELECT 1 FROM account_categories a WHERE a.default_distribution_key_id = dk.id);

-- 2) Unique-Index für org-weite Schlüssel
CREATE UNIQUE INDEX IF NOT EXISTS distribution_keys_org_key_code_uniq
  ON distribution_keys (organization_id, key_code)
  WHERE property_id IS NULL;
