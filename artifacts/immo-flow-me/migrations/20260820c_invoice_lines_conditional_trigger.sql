-- Migration: invoice_lines-Trigger auf vollständig append-only zurücksetzen
--
-- Hintergrund:
--   billing.service.ts verwendet nicht länger INSERT ... ON CONFLICT ... DO UPDATE.
--   Seit dieser Migration gilt DO NOTHING — bereits existierende Zeilen werden
--   beibehalten, Duplikate lautlos übersprungen.
--   Korrekturen erfolgen als Gegenbuchungen (Storno-Zeilen), nicht durch Überschreiben.
--
--   Der Trigger ist damit wieder bedingungslos: jedes UPDATE und DELETE auf
--   invoice_lines wird geblockt, unabhängig vom Status der Parent-Vorschreibung.
--   Eine direkte SQL-Manipulation (Status auf 'offen' drehen, Zeilen ändern,
--   Status zurücksetzen) ist damit nicht mehr möglich.

CREATE OR REPLACE FUNCTION prevent_invoice_lines_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'invoice_lines-Einträge sind unveränderlich — UPDATE und DELETE sind nicht zulässig. '
    '(Ledger-Integrität / Mietbuchungen). '
    'Nur INSERT (Append) ist erlaubt.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
