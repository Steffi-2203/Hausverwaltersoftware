-- Befristungsfelder für Mietverträge (§ 16 Abs. 7 MRG)
ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS befristet boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS befristung_ende date;

-- Bundesland für Liegenschaften (für MRG-Richtwertberechnung)
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS bundesland text;

COMMENT ON COLUMN leases.befristet IS '§ 16 Abs. 7 MRG — Befristeter Mietvertrag; Befristungsabschlag 25% gilt für ALLE befristeten MRG-Mietverhältnisse (Mindestlaufzeit 3 Jahre nach § 29 MRG, aber der Abschlag ist nicht auf ≤3 Jahre begrenzt)';
COMMENT ON COLUMN leases.befristung_ende IS 'Vertragsende bei befristetem Mietvertrag';
COMMENT ON COLUMN properties.bundesland IS 'Österreichisches Bundesland für MRG-Richtwertberechnung';
ALTER TABLE invoice_runs ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

-- Mietrechtstyp für Liegenschaften: explizit gesetzt, nie aus Bundesland abgeleitet
-- Gültige Werte: 'richtwert', 'kategorie', 'frei' (NULL = unbekannt, MRG-Warnung unterdrückt)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS mietrecht_typ text
  CHECK (mietrecht_typ IN ('richtwert', 'kategorie', 'frei'));
COMMENT ON COLUMN properties.mietrecht_typ IS 'Mietrechtstyp: richtwert | kategorie | frei. NULL = unbekannt (MRG-Höchstmietzins-Warnung unterdrückt)';

-- Backfill: Bestehende Verträge mit end_date als befristet markieren (idempotent)
-- Laufzeiten ohne Enddatum bleiben unbefristet (befristet=false).
UPDATE leases SET befristet = true WHERE end_date IS NOT NULL AND befristet = false;
