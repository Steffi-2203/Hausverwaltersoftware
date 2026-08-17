-- Audit-Befund T1: Assistenz-Rolle ergänzen
-- Eine Hauverwaltung beschäftigt oft Assistenzkräfte, die Daten einsehen
-- und eintragen, aber keine sicherheitskritischen Aktionen auslösen dürfen.
-- Die Rolle 'assistant' liegt zwischen 'viewer' (nur lesen) und
-- 'property_manager' (volle Schreibrechte).
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'assistant';
