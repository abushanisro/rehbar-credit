-- Extraction infrastructure: job queue, cache, raw rows, metadata column

-- Job queue for async PDF extraction
CREATE TABLE IF NOT EXISTS extraction_jobs (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id          uuid REFERENCES credit_cases(id) ON DELETE CASCADE,
    document_id      uuid REFERENCES financial_documents(id) ON DELETE CASCADE,
    user_id          uuid REFERENCES auth.users(id),
    job_type         text NOT NULL CHECK (job_type IN ('financials', 'bank_statement', 'gst')),
    status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    payload          jsonb NOT NULL DEFAULT '{}',
    result_summary   jsonb,
    error_message    text,
    retry_count      integer NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS extraction_jobs_pending_idx
    ON extraction_jobs (created_at)
    WHERE status = 'pending';

-- PDF dedup cache (version-keyed — stale cache auto-ignored on rule changes)
CREATE TABLE IF NOT EXISTS extraction_cache (
    pdf_hash          text NOT NULL,
    job_type          text NOT NULL,
    parser_version    text NOT NULL,
    alias_version     text NOT NULL,
    validator_version text NOT NULL,
    result            jsonb NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (pdf_hash, job_type, parser_version, alias_version, validator_version)
);

-- Raw table rows for audit trail ("where did Turnover come from?")
CREATE TABLE IF NOT EXISTS extraction_raw_rows (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     uuid REFERENCES financial_documents(id) ON DELETE CASCADE,
    case_id         uuid REFERENCES credit_cases(id) ON DELETE CASCADE,
    page_number     integer,
    table_index     integer,
    row_index       integer,
    raw_cells       text[],
    mapped_label    text,
    mapped_value    numeric,
    fiscal_year     integer,
    statement_type  text,
    match_method    text,
    confidence      integer,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS extraction_raw_rows_doc_idx ON extraction_raw_rows (document_id);
CREATE INDEX IF NOT EXISTS extraction_raw_rows_case_idx ON extraction_raw_rows (case_id);

-- Add extraction metadata to extracted_financials
ALTER TABLE extracted_financials
    ADD COLUMN IF NOT EXISTS extraction_meta jsonb;

-- RLS: service role bypasses; authenticated users can read their own jobs
ALTER TABLE extraction_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own jobs" ON extraction_jobs;
DROP POLICY IF EXISTS "Service role full access on jobs" ON extraction_jobs;
CREATE POLICY "Users can read own jobs" ON extraction_jobs
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access on jobs" ON extraction_jobs
    USING (true) WITH CHECK (true);

ALTER TABLE extraction_raw_rows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access on raw rows" ON extraction_raw_rows;
DROP POLICY IF EXISTS "Auth users can read raw rows" ON extraction_raw_rows;
CREATE POLICY "Service role full access on raw rows" ON extraction_raw_rows
    USING (true) WITH CHECK (true);
CREATE POLICY "Auth users can read raw rows" ON extraction_raw_rows
    FOR SELECT TO authenticated USING (true);

ALTER TABLE extraction_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access on cache" ON extraction_cache;
CREATE POLICY "Service role full access on cache" ON extraction_cache
    USING (true) WITH CHECK (true);
