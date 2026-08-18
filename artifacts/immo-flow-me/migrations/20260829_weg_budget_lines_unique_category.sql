-- Migration: Unique-Constraint (budget_plan_id, lower(category)) auf weg_budget_lines
--
-- Hintergrund (Task #169):
--   Die Abrechnung ist kategorie-basiert (Verteilungsschlüssel je Kategorie).
--   Doppelte Kategorien im selben Plan führen zu Warn-Einblendungen und
--   inkonsistenten Abrechnungen. Der Constraint verhindert das Problem an der Quelle.
--
-- Vorgehen:
--   1. Bestandsduplikate konsolidieren: Beträge summieren in die jeweils älteste Zeile,
--      neuere Duplikate löschen — kein Datenverlust.
--   2. Unique-Index anlegen (idempotent via IF NOT EXISTS).
--
-- Idempotent: kann mehrfach ausgeführt werden ohne Fehler.

-- ── 1. Bestandsduplikate konsolidieren ──────────────────────────────────────

-- Beträge aller Duplikate in die älteste Zeile (kleinste created_at, tiebreaker id) summieren
WITH groups AS (
  SELECT
    budget_plan_id,
    lower(category) AS cat_lower,
    sum(amount)     AS total_amount
  FROM weg_budget_lines
  GROUP BY budget_plan_id, lower(category)
  HAVING count(*) > 1
),
keep_ids AS (
  SELECT DISTINCT ON (bl.budget_plan_id, lower(bl.category))
    bl.id AS keep_id,
    bl.budget_plan_id,
    lower(bl.category) AS cat_lower
  FROM weg_budget_lines bl
  JOIN groups g ON g.budget_plan_id = bl.budget_plan_id AND g.cat_lower = lower(bl.category)
  ORDER BY bl.budget_plan_id, lower(bl.category), bl.created_at, bl.id
)
UPDATE weg_budget_lines AS bl
SET amount = g.total_amount
FROM keep_ids k
JOIN groups g ON g.budget_plan_id = k.budget_plan_id AND g.cat_lower = k.cat_lower
WHERE bl.id = k.keep_id;

-- Neuere Duplikate (alle außer der ältesten Zeile je Gruppe) entfernen
DELETE FROM weg_budget_lines
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY budget_plan_id, lower(category)
        ORDER BY created_at, id
      ) AS rn
    FROM weg_budget_lines
  ) ranked
  WHERE rn > 1
);

-- ── 2. Unique-Index anlegen ──────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS weg_budget_lines_plan_category_unique
  ON weg_budget_lines (budget_plan_id, lower(category));
