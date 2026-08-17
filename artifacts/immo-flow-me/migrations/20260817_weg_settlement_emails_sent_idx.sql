-- Task: Versandspalte (last_sent_at) auch bei vielen Abrechnungen schnell laden.
--
-- GET /api/weg/settlements ermittelt pro Abrechnung MAX(sent_at) der
-- erfolgreich versendeten E-Mails (korrelierte Unterabfrage). Damit das bei
-- 100+ Abrechnungen als reiner Index-Scan läuft: partieller Composite-Index
-- auf (settlement_id, sent_at DESC), eingeschränkt auf status = 'sent'.
-- MAX(sent_at) pro settlement_id wird so zu einem Index-Only-Lookup.
CREATE INDEX IF NOT EXISTS idx_weg_settlement_emails_sent_lookup
  ON weg_settlement_emails (settlement_id, sent_at DESC)
  WHERE status = 'sent';
