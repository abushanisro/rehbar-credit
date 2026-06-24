-- Perfios triangulation report data (multi-source: GST, BSA, ITR cross-reference)
CREATE TABLE IF NOT EXISTS triangulation_data (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         uuid NOT NULL REFERENCES credit_cases(id) ON DELETE CASCADE,
  document_id     uuid REFERENCES financial_documents(id) ON DELETE SET NULL,
  user_id         uuid NOT NULL,
  report_data     jsonb NOT NULL DEFAULT '{}',
  period_covered  text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (case_id)
);

ALTER TABLE triangulation_data ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "triangulation_owner" ON triangulation_data FOR ALL USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS triangulation_data_case_idx ON triangulation_data (case_id);
