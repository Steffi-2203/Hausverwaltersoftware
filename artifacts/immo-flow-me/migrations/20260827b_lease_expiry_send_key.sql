-- Task #101: Idempotenter E-Mail-Versand der Vertragsablauf-Erinnerungen.
-- send_key hält den an Resend übergebenen Idempotency-Key fest, damit ein
-- Retry nach Crash (pending-Reclaim) denselben Key wiederverwendet und der
-- Provider den Doppelversand unterdrückt (24h-Fenster).

ALTER TABLE lease_expiry_notifications
  ADD COLUMN IF NOT EXISTS send_key text;

-- Zeitpunkt der Key-Erstellung: nach Ablauf des Resend-Idempotenz-Fensters
-- (24h) kann Doppelzustellung nicht mehr provider-seitig verhindert werden;
-- solche Claims werden konservativ unterdrückt statt erneut versendet.
ALTER TABLE lease_expiry_notifications
  ADD COLUMN IF NOT EXISTS send_key_at timestamptz;
