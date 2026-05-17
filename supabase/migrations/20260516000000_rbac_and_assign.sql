-- ── Roles: add Business Development and IC Member ────────────────────────────
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'business_development';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'ic_member';

-- ── credit_cases: assignment tracking ────────────────────────────────────────
ALTER TABLE credit_cases
  ADD COLUMN IF NOT EXISTS assigned_to_email TEXT,
  ADD COLUMN IF NOT EXISTS assigned_to_name  TEXT;

-- ── user_profiles: display names ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Policies — guard with DO block so re-running the migration is safe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_profiles' AND policyname = 'profiles_select'
  ) THEN
    CREATE POLICY "profiles_select" ON user_profiles
      FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_profiles' AND policyname = 'profiles_upsert'
  ) THEN
    CREATE POLICY "profiles_upsert" ON user_profiles
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_profiles' AND policyname = 'profiles_update'
  ) THEN
    CREATE POLICY "profiles_update" ON user_profiles
      FOR UPDATE TO authenticated USING (auth.uid() = id);
  END IF;
END $$;
