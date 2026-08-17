-- Migration: Create dedicated "extensions" schema
-- Date: 2026-02-13
-- Description: Legt ein eigenes Schema für PostgreSQL-Extensions an.
--              Alle zukünftigen Extensions sollen hier installiert werden,
--              um das public-Schema sauber zu halten.
-- Reversible: DROP SCHEMA IF EXISTS extensions CASCADE;

BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;

COMMENT ON SCHEMA extensions IS 'Dediziertes Schema für PostgreSQL-Extensions. Neue Extensions mit CREATE EXTENSION ... SCHEMA extensions installieren.';

GRANT USAGE ON SCHEMA extensions TO PUBLIC;

COMMIT;
