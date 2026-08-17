-- Task #100: MRG-Richtwert-Check — Lagezuschlag und Ausstattungsabschläge
-- am Mietvertrag speichern, damit der HMZ-Check (§ 16 Abs. 2 MRG) sie
-- berücksichtigen kann. Prozentwerte; NULL = nicht erfasst (Check nutzt 0).

ALTER TABLE leases ADD COLUMN IF NOT EXISTS lagezuschlag NUMERIC(5,2);
ALTER TABLE leases ADD COLUMN IF NOT EXISTS abschlaege NUMERIC(5,2);

-- Vorzeichen/Wertebereich auf DB-Ebene erzwingen (auch generische PATCH-Pfade
-- können damit keine unsinnigen Werte speichern): Lagezuschlag 0..100 %,
-- Abschläge -100..0 %.
ALTER TABLE leases DROP CONSTRAINT IF EXISTS leases_lagezuschlag_range;
ALTER TABLE leases ADD CONSTRAINT leases_lagezuschlag_range
  CHECK (lagezuschlag IS NULL OR (lagezuschlag >= 0 AND lagezuschlag <= 100));
ALTER TABLE leases DROP CONSTRAINT IF EXISTS leases_abschlaege_range;
ALTER TABLE leases ADD CONSTRAINT leases_abschlaege_range
  CHECK (abschlaege IS NULL OR (abschlaege >= -100 AND abschlaege <= 0));

COMMENT ON COLUMN leases.lagezuschlag IS 'MRG § 16 Abs. 2: Lagezuschlag in Prozent (z. B. 10 = +10 %)';
COMMENT ON COLUMN leases.abschlaege IS 'MRG § 16 Abs. 2: Ausstattungs-/sonstige Abschläge in Prozent (negativ, z. B. -5)';
