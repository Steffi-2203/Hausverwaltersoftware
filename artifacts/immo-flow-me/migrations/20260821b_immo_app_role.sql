-- Create a limited application role used for all runtime DB queries.
-- immo_app has NOSUPERUSER and no BYPASSRLS, so Row Level Security policies
-- apply unconditionally. The postgres superuser retains ownership and is used
-- only for migrations and RLS setup.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'immo_app') THEN
    CREATE ROLE immo_app
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION;
  END IF;
END
$$;

-- Allow the role to see the public schema.
GRANT USAGE ON SCHEMA public TO immo_app;

-- Grant DML on all existing tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO immo_app;

-- Grant sequence usage (needed for serial/GENERATED columns).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO immo_app;

-- Ensure future tables created by migrations also get the grants automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO immo_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO immo_app;
