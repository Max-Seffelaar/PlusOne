-- Initialize database — Fase 0 placeholder
-- Full schema (venues, users, events, guests, quotas, audit, etc.)
-- will be added in Fase 1: Databaseschema (migratie 1)

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Function for UUIDv7 support (fallback)
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid AS $$
BEGIN
  -- Generate a UUIDv7 (time-based)
  -- For now, return a v4 UUID; upgrade to true v7 when Postgres adds native support
  RETURN gen_random_uuid();
END;
$$ LANGUAGE plpgsql;

-- Initial marker
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
