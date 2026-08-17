-- Audit-Befund W1: §31 WEG 2002 — Rücklage separat ausweisen
-- Das WEG 2002 verlangt in §31 Abs.1, dass der Rücklagenbeitrag in der
-- Vorschreibung als eigener Posten ausgewiesen wird und nicht im allgemeinen
-- Betriebskosten-Gesamtbetrag untergeht.
-- Die Spalte speichert den monatlichen Rücklagenbeitrag (Nettobetrag) separat;
-- gesamtbetrag bleibt unverändert (enthält die Rücklage weiterhin als Teil
-- der Gesamtvorschreibung — das ist korrekt).
ALTER TABLE monthly_invoices
  ADD COLUMN IF NOT EXISTS ruecklage NUMERIC(12, 2) DEFAULT 0;

COMMENT ON COLUMN monthly_invoices.ruecklage IS
  'WEG §31: Monatlicher Rücklagenbeitrag — separat ausgewiesen, nicht doppelt gezählt (gesamtbetrag enthält diesen Betrag bereits).';
