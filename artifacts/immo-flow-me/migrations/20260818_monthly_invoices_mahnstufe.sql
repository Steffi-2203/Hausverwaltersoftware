-- Audit-Befund: Mahnstufe wird im Code geschrieben, aber die Spalte fehlte in der
-- Datenbank. Der Wert wurde von Drizzle ORM still verworfen — Mieter begannen bei
-- jedem Mahnlauf wieder bei Stufe 0, Eskalationen (1. Mahnung → 2. Mahnung →
-- letzte Mahnung) bauten nicht aufeinander auf.
--
-- Gleichzeitig werden zahlungserinnerung_am und mahnung_am in functions.ts
-- gesetzt, waren aber ebenfalls nicht im Schema vorhanden.

ALTER TABLE monthly_invoices
  ADD COLUMN IF NOT EXISTS mahnstufe INTEGER NOT NULL DEFAULT 0;

ALTER TABLE monthly_invoices
  ADD COLUMN IF NOT EXISTS zahlungserinnerung_am TIMESTAMPTZ;

ALTER TABLE monthly_invoices
  ADD COLUMN IF NOT EXISTS mahnung_am TIMESTAMPTZ;

COMMENT ON COLUMN monthly_invoices.mahnstufe IS
  'Aktueller Mahnstatus: 0 = offen, 1 = Zahlungserinnerung, 2 = 1. Mahnung, 3 = 2. Mahnung/letzte Mahnung.';

COMMENT ON COLUMN monthly_invoices.zahlungserinnerung_am IS
  'Zeitpunkt des Versands der Zahlungserinnerung (Stufe 1).';

COMMENT ON COLUMN monthly_invoices.mahnung_am IS
  'Zeitpunkt des Versands der letzten formellen Mahnung (Stufe ≥ 2).';
