-- Kaution, VPI & HeizKG Fixes

-- 1. Zahlungsreferenz für Kautionsabschluss (Pflichtfeld bei completeReturn)
ALTER TABLE kautions_bewegungen ADD COLUMN IF NOT EXISTS zahlungsreferenz text;
ALTER TABLE kautionen ADD COLUMN IF NOT EXISTS zahlungsreferenz text;

-- 2. Vertragsindividueller VPI-Schwellenwert pro Mieter (NULL = globaler Wert 5%)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS vpi_schwellenwert numeric(5,4);

-- 3. VPI-Tracking auf Mieterebene (fehlende Spalten)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS vpi_base numeric(8,2);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_vpi_adjustment date;

-- 4. VPI-Anpassung: Anwendungszeitpunkt für Idempotenz-Schutz
ALTER TABLE vpi_adjustments ADD COLUMN IF NOT EXISTS applied_at timestamptz;
