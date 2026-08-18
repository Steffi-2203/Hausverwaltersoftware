-- Task #194: Lagezuschlag / Abschläge von Prozentwerten auf €/m² umstellen.
--
-- Nach § 16 Abs. 2 MRG ist der Lagezuschlag ein objektivierter Betrag in €/m²
-- (üblicherweise aus dem Lagezuschlags-Rechner der Gemeinde ermittelt), keine
-- Prozent-Pauschale auf die Basismiete.  Die Formel ändert sich von
--
--   HMZ = Richtwert × m² × (1 + Lagezuschlag% / 100)
--
-- auf die gesetzeskonforme Form:
--
--   HMZ = (Richtwert_€/m² + Lagezuschlag_€/m² + Abschläge_€/m²) × m²
--
-- Bestehende Prozentwerte werden auf NULL gesetzt: eine Umrechnung ohne
-- Bundesland-Kontext jedes einzelnen Mietvertrags wäre fehleranfällig,
-- und die Spalten wurden erst kürzlich ergänzt (keine Produktionsdaten erwartet).

-- 1. Bestehende Prozentwerte nullen
UPDATE leases
SET lagezuschlag = NULL, abschlaege = NULL
WHERE lagezuschlag IS NOT NULL OR abschlaege IS NOT NULL;

-- 2. Alte %-Constraints entfernen
ALTER TABLE leases DROP CONSTRAINT IF EXISTS leases_lagezuschlag_range;
ALTER TABLE leases DROP CONSTRAINT IF EXISTS leases_abschlaege_range;

-- 3. Precision erhöhen: NUMERIC(8,2) statt NUMERIC(5,2)
--    (Richtwert Wien ≈ 6,67 €/m²; Zuschläge können mehrere €/m² betragen)
ALTER TABLE leases ALTER COLUMN lagezuschlag TYPE NUMERIC(8,2);
ALTER TABLE leases ALTER COLUMN abschlaege TYPE NUMERIC(8,2);

-- 4. Neue €/m²-Constraints
ALTER TABLE leases ADD CONSTRAINT leases_lagezuschlag_range
  CHECK (lagezuschlag IS NULL OR lagezuschlag >= 0);
ALTER TABLE leases ADD CONSTRAINT leases_abschlaege_range
  CHECK (abschlaege IS NULL OR abschlaege <= 0);

-- 5. Spaltenkommentare aktualisieren
COMMENT ON COLUMN leases.lagezuschlag IS
  'MRG § 16 Abs. 2: Lagezuschlag in €/m² (≥ 0; z. B. 0.50 = 50 Ct/m²). NULL = nicht erfasst.';
COMMENT ON COLUMN leases.abschlaege IS
  'MRG § 16 Abs. 2: Ausstattungs-/sonstige Abschläge in €/m² (≤ 0; z. B. -0.25). NULL = nicht erfasst.';
