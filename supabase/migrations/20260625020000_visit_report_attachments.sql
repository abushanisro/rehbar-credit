-- Visit report attachments: photos and documents uploaded during site visits
CREATE TABLE IF NOT EXISTS visit_report_attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES credit_cases(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  file_name   text NOT NULL,
  file_path   text NOT NULL,          -- storage path in case-files bucket
  mime_type   text NOT NULL DEFAULT 'application/octet-stream',
  category    text NOT NULL DEFAULT 'photo' CHECK (category IN ('photo', 'document')),
  caption     text,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE visit_report_attachments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "visit_attachments_owner" ON visit_report_attachments
    FOR ALL USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "visit_attachments_team_select" ON visit_report_attachments
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS visit_attachments_case_idx ON visit_report_attachments (case_id);
CREATE INDEX IF NOT EXISTS visit_attachments_user_idx ON visit_report_attachments (user_id);
