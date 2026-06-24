-- MCA / Corpository structured data
-- Directors stored as proper rows; MCA company-level fields added to companies table

-- MCA profile columns on companies (CIN, PAN, etc.)
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS mca_cin                TEXT,
  ADD COLUMN IF NOT EXISTS mca_pan                TEXT,
  ADD COLUMN IF NOT EXISTS mca_lei                TEXT,
  ADD COLUMN IF NOT EXISTS mca_category           TEXT,
  ADD COLUMN IF NOT EXISTS mca_sub_category       TEXT,
  ADD COLUMN IF NOT EXISTS mca_type               TEXT,
  ADD COLUMN IF NOT EXISTS mca_authorized_capital TEXT,
  ADD COLUMN IF NOT EXISTS mca_paid_up_capital    TEXT,
  ADD COLUMN IF NOT EXISTS mca_status             TEXT,
  ADD COLUMN IF NOT EXISTS mca_nse_sector         TEXT,
  ADD COLUMN IF NOT EXISTS mca_sector             TEXT,
  ADD COLUMN IF NOT EXISTS mca_products_services  TEXT,
  ADD COLUMN IF NOT EXISTS mca_email              TEXT,
  ADD COLUMN IF NOT EXISTS mca_telephone          TEXT,
  ADD COLUMN IF NOT EXISTS mca_date_of_incorp     TEXT,
  ADD COLUMN IF NOT EXISTS mca_date_last_bs       TEXT,
  ADD COLUMN IF NOT EXISTS mca_date_last_agm      TEXT,
  ADD COLUMN IF NOT EXISTS mca_about              TEXT;

-- Directors as individual rows
CREATE TABLE IF NOT EXISTS company_directors (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  din                  TEXT,
  pan                  TEXT,
  dob                  TEXT,
  age                  TEXT,
  gender               TEXT,
  nationality          TEXT,
  address              TEXT,
  designation          TEXT,
  din_status           TEXT,
  dsc_status           TEXT,
  appointed_current    TEXT,
  originally_appointed TEXT,
  cessation_date       TEXT,
  shareholding         TEXT,
  email                TEXT,
  phone                TEXT,
  remarks              TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS directors_company_id_idx ON company_directors (company_id);

ALTER TABLE company_directors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read directors"   ON company_directors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Insert directors" ON company_directors FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Update directors" ON company_directors FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Delete directors" ON company_directors FOR DELETE TO authenticated USING (true);



