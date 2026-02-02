-- Local auth: users table for email + password login
-- Run after customers.sql (depends on customers table)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'staff', 'customer');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role user_role NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  auth_provider text NOT NULL DEFAULT 'local',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_customer_role_check CHECK (
    (role = 'customer' AND customer_id IS NOT NULL) OR
    (role IN ('admin', 'staff') AND customer_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);
CREATE INDEX IF NOT EXISTS users_auth_provider_idx ON users(auth_provider);
