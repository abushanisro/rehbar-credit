-- Add 'cibil' to extraction_jobs.job_type CHECK constraint
ALTER TABLE extraction_jobs DROP CONSTRAINT IF EXISTS extraction_jobs_job_type_check;
ALTER TABLE extraction_jobs ADD CONSTRAINT extraction_jobs_job_type_check
    CHECK (job_type IN ('financials', 'bank_statement', 'gst', 'cibil'));
