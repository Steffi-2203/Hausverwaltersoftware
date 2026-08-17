-- Race-Condition-Schutz für WEG-Vorschreibungen auf DB-Ebene (zweite
-- Schutzschicht hinter der API-Prüfung, analog uq_weg_settlements_property_year).
--
-- POST /api/weg/vorschreibungen/generate und POST /api/weg/budget-plans/:id/activate
-- prüfen per SELECT auf bestehende Zeilen bevor sie einfügen. Zwei gleichzeitige
-- Requests können beide die Prüfung passieren — die Unique-Indexe lassen dann
-- nur einen INSERT durch (23505 → 409 im Handler).
--
-- FAIL-CLOSED-STRATEGIE (wie 20260816c/d): Alles in EINEM DO-Block mit
-- LOCK TABLE, damit zwischen Duplikat-Preflight und Index-Erstellung kein
-- konkurrierender INSERT möglich ist. Ein unique_violation beim CREATE INDEX
-- wird als P0001 re-raised — der Migrations-Runner darf 23505 hier NICHT als
-- ignorierbar behandeln. Idempotent: existiert der Index bereits mit korrektem
-- Prädikat, passiert nichts; ein gleichnamiger Index mit falscher Definition
-- wird ersetzt.

DO $$
DECLARE
  idx_def   TEXT;
  dup_count INT;
BEGIN
  -- ── Index 1: weg_vorschreibungen (Plan-Vorschreibungen) ──────────────────
  SELECT indexdef INTO idx_def FROM pg_indexes
  WHERE indexname = 'uq_weg_vorschreibungen_owner_month';

  IF idx_def IS NULL
     OR idx_def NOT ILIKE '%UNIQUE%'
     OR idx_def NOT ILIKE '%(property_id, unit_id, owner_id, year, month)%'
     OR idx_def NOT ILIKE '%budget_plan_id IS NOT NULL%'
  THEN
    LOCK TABLE weg_vorschreibungen IN SHARE ROW EXCLUSIVE MODE;

    -- Partiell auf budget_plan_id IS NOT NULL: Sonderumlage-Fakturierungen
    -- (budget_plan_id NULL) dürfen zusätzliche Zeilen im selben Monat erzeugen.
    SELECT COUNT(*) INTO dup_count FROM (
      SELECT property_id, unit_id, owner_id, year, month
      FROM weg_vorschreibungen
      WHERE budget_plan_id IS NOT NULL
      GROUP BY property_id, unit_id, owner_id, year, month
      HAVING COUNT(*) > 1
    ) sub;

    IF dup_count > 0 THEN
      RAISE EXCEPTION
        'Migration abgebrochen: % doppelte Plan-Vorschreibung(en) (property_id, unit_id, owner_id, year, month) in weg_vorschreibungen. Bitte zuerst bereinigen.',
        dup_count
      USING ERRCODE = 'P0001';
    END IF;

    DROP INDEX IF EXISTS uq_weg_vorschreibungen_owner_month;

    BEGIN
      CREATE UNIQUE INDEX uq_weg_vorschreibungen_owner_month
        ON weg_vorschreibungen (property_id, unit_id, owner_id, year, month)
        WHERE budget_plan_id IS NOT NULL;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION
        'CREATE UNIQUE INDEX uq_weg_vorschreibungen_owner_month schlug mit unique_violation fehl — Migration neu starten.'
      USING ERRCODE = 'P0001';
    END;
  END IF;

  -- ── Index 2: monthly_invoices (Wirtschaftsplan-Aktivierung) ──────────────
  SELECT indexdef INTO idx_def FROM pg_indexes
  WHERE indexname = 'uq_monthly_invoices_weg_plan_month';

  IF idx_def IS NULL
     OR idx_def NOT ILIKE '%UNIQUE%'
     OR idx_def NOT ILIKE '%(weg_budget_plan_id, unit_id, owner_id, year, month)%'
     OR idx_def NOT ILIKE '%weg_budget_plan_id IS NOT NULL%'
  THEN
    LOCK TABLE monthly_invoices IN SHARE ROW EXCLUSIVE MODE;

    SELECT COUNT(*) INTO dup_count FROM (
      SELECT weg_budget_plan_id, unit_id, owner_id, year, month
      FROM monthly_invoices
      WHERE weg_budget_plan_id IS NOT NULL
      GROUP BY weg_budget_plan_id, unit_id, owner_id, year, month
      HAVING COUNT(*) > 1
    ) sub;

    IF dup_count > 0 THEN
      RAISE EXCEPTION
        'Migration abgebrochen: % doppelte WEG-Vorschreibungs-Rechnung(en) (weg_budget_plan_id, unit_id, owner_id, year, month) in monthly_invoices. Bitte zuerst bereinigen.',
        dup_count
      USING ERRCODE = 'P0001';
    END IF;

    DROP INDEX IF EXISTS uq_monthly_invoices_weg_plan_month;

    BEGIN
      CREATE UNIQUE INDEX uq_monthly_invoices_weg_plan_month
        ON monthly_invoices (weg_budget_plan_id, unit_id, owner_id, year, month)
        WHERE weg_budget_plan_id IS NOT NULL;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION
        'CREATE UNIQUE INDEX uq_monthly_invoices_weg_plan_month schlug mit unique_violation fehl — Migration neu starten.'
      USING ERRCODE = 'P0001';
    END;
  END IF;
END $$;
