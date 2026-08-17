-- Migration: numeric-Spalten ohne Skalenangabe auf numeric(12,2)
-- Geldspalten mit unbeschränkter Genauigkeit führen zu Rundungsdifferenzen
-- in Abrechnungen (HeizKG, Instandhaltung). Bestehende Werte werden auf
-- 2 Nachkommastellen gerundet.

ALTER TABLE energy_consumption
  ALTER COLUMN cost_eur TYPE numeric(12,2) USING ROUND(cost_eur, 2);

ALTER TABLE damage_reports
  ALTER COLUMN cost_estimate TYPE numeric(12,2) USING ROUND(cost_estimate, 2);

ALTER TABLE damage_reports
  ALTER COLUMN actual_cost TYPE numeric(12,2) USING ROUND(actual_cost, 2);
