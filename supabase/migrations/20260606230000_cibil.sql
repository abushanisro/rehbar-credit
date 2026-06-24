-- Extend doc_class enum with cibil_report and provisional
ALTER TYPE doc_class ADD VALUE IF NOT EXISTS 'cibil_report';
ALTER TYPE doc_class ADD VALUE IF NOT EXISTS 'provisional';

-- CIBIL Report Data: stores parsed TransUnion CIBIL Commercial Credit Information Reports

CREATE TABLE IF NOT EXISTS cibil_report_data (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id          uuid NOT NULL REFERENCES credit_cases(id) ON DELETE CASCADE,
    document_id      uuid REFERENCES financial_documents(id) ON DELETE SET NULL,
    user_id          uuid NOT NULL,
    report_data      jsonb NOT NULL DEFAULT '{}',
    report_order_no  text,
    report_date      date,
    borrower_name    text,
    cibil_rank       text,
    total_outstanding numeric(15,2),
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (case_id, document_id)
);

CREATE INDEX IF NOT EXISTS cibil_report_data_case_idx ON cibil_report_data (case_id);

ALTER TABLE cibil_report_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read_cibil"   ON cibil_report_data;
DROP POLICY IF EXISTS "auth_insert_cibil" ON cibil_report_data;
DROP POLICY IF EXISTS "auth_update_cibil" ON cibil_report_data;

CREATE POLICY "auth_read_cibil"   ON cibil_report_data FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_cibil" ON cibil_report_data FOR INSERT WITH CHECK (true);
CREATE POLICY "auth_update_cibil" ON cibil_report_data FOR UPDATE USING (true);
