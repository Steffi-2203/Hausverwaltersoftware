-- Task #182: Fälschungssicherer Abschluss-Marker für Job-Handler
-- Ersetzt die Nutzung der gemeinsamen idempotency_keys-Tabelle für interne
-- Abschluss-Erkennung (Sicherheitsproblem: Client konnte via Idempotency-Key-
-- Header einen Marker fälschen).
ALTER TABLE job_queue
  ADD COLUMN IF NOT EXISTS handler_completed_at TIMESTAMP WITH TIME ZONE;
