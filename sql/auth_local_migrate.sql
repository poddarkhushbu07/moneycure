-- Add local auth columns to existing users table (e.g. from OAuth schema).
-- Run if users table has oauth_provider but no password_hash.

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider text DEFAULT 'local';
