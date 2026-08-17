-- Backfill: paid_amount für historische WEG-Vorschreibungen setzen.
-- Diese Migration läuft nach 20260817_weg_fixes.sql (welche die Spalte anlegt).
--
-- Strategie:
--   status = 'bezahlt' + paid_amount IS NULL → paid_amount = gesamtbetrag (eindeutig: vollständige Zahlung)
--   status = 'teilbezahlt' + paid_amount IS NULL → KEINE Schätzung.
--     Diese Einträge bleiben mit paid_amount = NULL und werden im Eigentümer-Saldo
--     mit 0 € angerechnet (sicherer als ein frei erfundener Wert).
--     Der Verwalter kann den Betrag über das UI nachpflegen (Status erneut auf
--     'teilbezahlt' setzen → Dialog öffnet sich zur Betragseingabe).
--
-- Idempotent: WHERE paid_amount IS NULL verhindert doppelte Ausführung.

UPDATE weg_vorschreibungen
SET
  paid_amount = gesamtbetrag,
  updated_at  = NOW()
WHERE
  status      = 'bezahlt'
  AND paid_amount IS NULL;
