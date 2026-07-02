CREATE TABLE IF NOT EXISTS ic_ai_errors (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         uuid NOT NULL REFERENCES credit_cases(id) ON DELETE CASCADE,
  generation_run  text NOT NULL,
  section_id      text NOT NULL,
  error_type      text NOT NULL CHECK (error_type IN (
                    'hallucination','unit_error','cross_section_mismatch',
                    'missing_data','illogical_narrative','template_gap')),
  severity        text NOT NULL CHECK (severity IN ('hard','warn')),
  title           text NOT NULL,
  detail          text NOT NULL,
  suggested_fix   text,
  analyst_verdict text CHECK (analyst_verdict IN ('confirmed','dismissed')),
  analyst_note    text,
  supermemory_id  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ic_ai_errors_case_idx ON ic_ai_errors (case_id);
CREATE INDEX IF NOT EXISTS ic_ai_errors_open_idx ON ic_ai_errors (analyst_verdict) WHERE analyst_verdict IS NULL;

ALTER TABLE ic_ai_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_ic_errors"   ON ic_ai_errors FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_ic_errors" ON ic_ai_errors FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_ic_errors" ON ic_ai_errors FOR UPDATE TO authenticated USING (true);
CREATE POLICY "service_all_ic_errors" ON ic_ai_errors USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION update_ic_ai_errors_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER ic_ai_errors_updated_at
  BEFORE UPDATE ON ic_ai_errors
  FOR EACH ROW EXECUTE FUNCTION update_ic_ai_errors_updated_at();
