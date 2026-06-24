-- BSA (Bank Statement Analysis) report data from Perfios/external BSA Excel import
CREATE TABLE IF NOT EXISTS bsa_report_data (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id          uuid NOT NULL REFERENCES credit_cases(id) ON DELETE CASCADE,
  document_id      uuid REFERENCES financial_documents(id) ON DELETE SET NULL,
  user_id          uuid NOT NULL,
  report_data      jsonb NOT NULL DEFAULT '{}',
  company_name     text,
  period_covered   text,
  bank_names       text[],
  abb              numeric(15,2),
  total_net_credits numeric(15,2),
  total_net_debits  numeric(15,2),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  UNIQUE (case_id, document_id)
);


ALTER TABLE bsa_report_data ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "bsa_owner" ON bsa_report_data FOR ALL USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS bsa_report_data_case_idx ON bsa_report_data (case_id);

