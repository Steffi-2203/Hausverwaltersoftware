-- Migration: Outbox-Status für lease_expiry_notifications
-- Fügt eine status-Spalte hinzu, die den Zustellungslebenszyklus abbildet:
--   'pending' — vom Scheduler beansprucht, E-Mail noch nicht bestätigt
--   'sent'    — Resend hat die E-Mail akzeptiert; permanenter Deduplizierungsmarker
-- Bestehende Zeilen erhalten 'sent' (sie wurden bereits erfolgreich versendet).

ALTER TABLE lease_expiry_notifications
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'sent';

-- Neu beanspruchte Zeilen werden explizit mit 'pending' eingefügt;
-- der Default 'sent' gilt nur für bestehende/migrierte Zeilen.

-- Status-Werte: pending (beansprucht noch nicht versendet), sent (Resend akzeptiert), stale (pending ueber 2h, kann wiederholt werden)
