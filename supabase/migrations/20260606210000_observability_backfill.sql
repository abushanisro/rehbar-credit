-- Backfill activity_log with all historical platform events

-- Existing document uploads
INSERT INTO activity_log (event_category, event_type, resource_type, resource_id, case_id, actor_role, status, title, metadata, created_at)
SELECT 'document', 'uploaded', 'financial_document', id, case_id, 'analyst', 'success',
    file_name || ' uploaded',
    jsonb_build_object('file_name', file_name, 'file_type', file_type, 'doc_class', doc_class),
    created_at
FROM financial_documents
ON CONFLICT DO NOTHING;

-- Extraction jobs (completed + failed)
INSERT INTO activity_log (event_category, event_type, resource_type, resource_id, case_id, actor_role, status, title, metadata, created_at)
SELECT 'extraction',
    CASE status WHEN 'completed' THEN 'job_completed' ELSE 'job_failed' END,
    'extraction_job', id, case_id, 'worker',
    CASE status WHEN 'completed' THEN 'success' ELSE 'failure' END,
    CASE status WHEN 'completed' THEN 'Extraction job completed (' || job_type || ')'
                ELSE 'Extraction job failed (' || job_type || ')' END,
    jsonb_build_object('job_type', job_type, 'retry_count', retry_count, 'error', error_message),
    updated_at
FROM extraction_jobs
WHERE status IN ('completed', 'failed')
ON CONFLICT DO NOTHING;

-- IC decisions already recorded
INSERT INTO activity_log (event_category, event_type, resource_type, resource_id, case_id, actor_role, status, title, metadata, created_at)
SELECT 'decision', 'ic_decision', 'credit_case', id, id, 'ic_member',
    CASE ic_decision::text WHEN 'declined' THEN 'failure' ELSE 'success' END,
    'IC Decision: ' || UPPER(REPLACE(ic_decision::text, '_', ' ')) || ' — ' || COALESCE(client_name, ''),
    jsonb_build_object('decision', ic_decision::text, 'client_name', client_name, 'deal_amount', deal_amount, 'case_code', case_code),
    updated_at
FROM credit_cases
WHERE ic_decision IS NOT NULL
ON CONFLICT DO NOTHING;

-- Current case stages as status events
INSERT INTO activity_log (event_category, event_type, resource_type, resource_id, case_id, actor_role, status, title, metadata, created_at)
SELECT 'case', 'status_changed', 'credit_case', id, id, 'system', 'success',
    COALESCE(client_name, id::text) || ' — moved to ' || REPLACE(status::text, '_', ' '),
    jsonb_build_object('new_status', status::text, 'client_name', client_name, 'case_code', case_code),
    updated_at
FROM credit_cases
ON CONFLICT DO NOTHING;
