-- Company master data table
-- Single source of truth for client identity across multiple deals.
-- credit_cases links to companies; financial data flows through cases.

CREATE TABLE IF NOT EXISTS companies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  name                TEXT NOT NULL,
  legal_constitution  TEXT,
  industry            TEXT,
  year_established    INTEGER,
  gstin               TEXT,
  website             TEXT,
  promoter_details    TEXT,
  registered_address  TEXT,
  notes               TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Link cases to a company (nullable — existing cases remain unlinked)
ALTER TABLE credit_cases
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS companies_name_idx       ON companies (lower(name));
CREATE INDEX IF NOT EXISTS cases_company_id_idx     ON credit_cases (company_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_companies_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS companies_updated_at ON companies;
CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_companies_updated_at();

-- RLS: all analysts can read + update; only creator can insert/delete
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read companies"   ON companies FOR SELECT TO authenticated USING (true);
CREATE POLICY "Insert companies" ON companies FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "Update companies" ON companies FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Delete companies" ON companies FOR DELETE TO authenticated USING (created_by = auth.uid());
