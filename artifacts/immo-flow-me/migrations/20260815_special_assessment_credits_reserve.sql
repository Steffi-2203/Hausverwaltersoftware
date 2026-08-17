-- Migration: Durable credits_reserve_fund Flag für Sonderumlagen
--
-- Hintergrund: createSpecialAssessmentInvoices prüfte bisher ob Titel/Beschreibung
-- das Wort "Rücklage" enthält — fragile Text-Matching-Logik, die bei anderssprachigen
-- Titeln oder Schreibvarianten still versagt.
--
-- Diese Migration fügt ein explizites boolean-Feld hinzu:
--   credits_reserve_fund = TRUE  → Sonderumlage schreibt in die Instandhaltungsrücklage
--   credits_reserve_fund = FALSE → Normale Sonderumlage (kein Rücklage-Eintrag)
--
-- DEFAULT false = kein rückwirkender Einfluss auf bestehende Einträge.
-- Bestehende "Rücklage"-Sonderumlagen können manuell auf TRUE gesetzt werden.

ALTER TABLE weg_special_assessments
  ADD COLUMN IF NOT EXISTS credits_reserve_fund boolean DEFAULT false;
