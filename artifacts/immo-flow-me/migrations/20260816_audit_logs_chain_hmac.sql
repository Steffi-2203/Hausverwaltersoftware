-- SECURITY PUNKT 6: HMAC-Integritätskette für audit_logs
-- Fügt chain_hmac und previous_hmac hinzu, damit populateAuditIntegrityQueue
-- korrekt arbeitet (Startup-Log: "Skipping audit_logs: column chain_hmac does not exist").
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS chain_hmac TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS previous_hmac TEXT;
