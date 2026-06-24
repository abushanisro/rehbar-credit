-- Rehbar Observability: activity_log + observability_alerts + system_metrics + triggers

-- ── 1. activity_log ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_log (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      uuid,
    event_category  text NOT NULL,
    event_type      text NOT NULL,
    resource_type   text,
    resource_id     uuid,
    case_id         uuid REFERENCES credit_cases(id) ON DELETE SET NULL,
    actor_id        uuid,
    actor_name      text,
    actor_role      text DEFAULT 'system',
    status          text NOT NULL DEFAULT 'success',
    title           text NOT NULL,
    metadata        jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_log_created_idx   ON activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_case_idx      ON activity_log (case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_category_idx  ON activity_log (event_category, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_status_idx    ON activity_log (status) WHERE status IN ('failure', 'warning');
CREATE INDEX IF NOT EXISTS activity_log_type_idx      ON activity_log (event_type, created_at DESC);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_activity_log"  ON activity_log;
DROP POLICY IF EXISTS "service_insert_activity" ON activity_log;
CREATE POLICY "auth_read_activity_log"    ON activity_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_insert_activity"   ON activity_log FOR INSERT WITH CHECK (true);

-- ── 2. observability_alerts ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS observability_alerts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_type   text NOT NULL,
    severity     text NOT NULL DEFAULT 'warning',
    title        text NOT NULL,
    message      text,
    resolved     boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now(),
    resolved_at  timestamptz
);

CREATE INDEX IF NOT EXISTS obs_alerts_active_idx ON observability_alerts (created_at DESC) WHERE resolved = false;

ALTER TABLE observability_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_alerts"     ON observability_alerts;
DROP POLICY IF EXISTS "service_write_alerts" ON observability_alerts;
CREATE POLICY "auth_read_alerts"    ON observability_alerts FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_write_alerts" ON observability_alerts USING (true) WITH CHECK (true);

-- ── 3. system_metrics ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_metrics (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_name  text NOT NULL,
    metric_value numeric NOT NULL,
    metadata     jsonb,
    recorded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sys_metrics_name_idx ON system_metrics (metric_name, recorded_at DESC);

ALTER TABLE system_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_metrics"     ON system_metrics;
DROP POLICY IF EXISTS "service_write_metrics" ON system_metrics;
CREATE POLICY "auth_read_metrics"    ON system_metrics FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_write_metrics" ON system_metrics USING (true) WITH CHECK (true);

-- ── 4. Trigger function ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION log_activity_event(
    p_event_category  text,
    p_event_type      text,
    p_resource_type   text,
    p_resource_id     uuid,
    p_case_id         uuid,
    p_actor_role      text,
    p_status          text,
    p_title           text,
    p_metadata        jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO activity_log (
        event_category, event_type, resource_type, resource_id,
        case_id, actor_role, status, title, metadata
    ) VALUES (
        p_event_category, p_event_type, p_resource_type, p_resource_id,
        p_case_id, p_actor_role, p_status, p_title, p_metadata
    );
EXCEPTION WHEN OTHERS THEN
    -- Never let a log failure break the main transaction
    NULL;
END;
$$;

-- ── 5. Trigger: case status changed ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fn_case_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        PERFORM log_activity_event(
            'case', 'status_changed', 'credit_case', NEW.id, NEW.id, 'system', 'success',
            format('%s — moved to %s', COALESCE(NEW.client_name, NEW.id::text), REPLACE(NEW.status, '_', ' ')),
            jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status,
                               'client_name', NEW.client_name, 'case_code', NEW.case_code)
        );
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_case_status ON credit_cases;
CREATE TRIGGER trg_case_status AFTER UPDATE ON credit_cases
    FOR EACH ROW EXECUTE FUNCTION trg_fn_case_status();

-- ── 6. Trigger: case assignment ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fn_case_assigned() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.assigned_to_email IS DISTINCT FROM NEW.assigned_to_email AND NEW.assigned_to_email IS NOT NULL THEN
        PERFORM log_activity_event(
            'case', 'assigned', 'credit_case', NEW.id, NEW.id, 'system', 'success',
            format('%s assigned to %s', COALESCE(NEW.client_name, NEW.id::text), NEW.assigned_to_email),
            jsonb_build_object('assigned_to', NEW.assigned_to_email, 'assigned_name', NEW.assigned_to_name,
                               'client_name', NEW.client_name)
        );
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_case_assigned ON credit_cases;
CREATE TRIGGER trg_case_assigned AFTER UPDATE ON credit_cases
    FOR EACH ROW EXECUTE FUNCTION trg_fn_case_assigned();

-- ── 7. Trigger: IC decision ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fn_ic_decision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
    IF OLD.ic_decision IS DISTINCT FROM NEW.ic_decision AND NEW.ic_decision IS NOT NULL THEN
        v_status := CASE NEW.ic_decision WHEN 'declined' THEN 'failure' ELSE 'success' END;
        PERFORM log_activity_event(
            'decision', 'ic_decision', 'credit_case', NEW.id, NEW.id, 'ic_member', v_status,
            format('IC Decision: %s — %s', UPPER(REPLACE(NEW.ic_decision, '_', ' ')), COALESCE(NEW.client_name, '')),
            jsonb_build_object('decision', NEW.ic_decision, 'client_name', NEW.client_name,
                               'deal_amount', NEW.deal_amount, 'notes', NEW.ic_decision_notes,
                               'case_code', NEW.case_code)
        );
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ic_decision ON credit_cases;
CREATE TRIGGER trg_ic_decision AFTER UPDATE ON credit_cases
    FOR EACH ROW EXECUTE FUNCTION trg_fn_ic_decision();

-- ── 8. Trigger: document uploaded ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fn_doc_uploaded() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM log_activity_event(
        'document', 'uploaded', 'financial_document', NEW.id, NEW.case_id, 'analyst', 'success',
        format('%s uploaded', COALESCE(NEW.file_name, 'Document')),
        jsonb_build_object('file_name', NEW.file_name, 'file_type', NEW.file_type,
                           'doc_class', NEW.document_class, 'document_id', NEW.id)
    );
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_doc_uploaded ON financial_documents;
CREATE TRIGGER trg_doc_uploaded AFTER INSERT ON financial_documents
    FOR EACH ROW EXECUTE FUNCTION trg_fn_doc_uploaded();

-- ── 9. Trigger: extraction status change ─────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fn_doc_extraction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text; v_title text;
BEGIN
    IF OLD.extraction_status IS DISTINCT FROM NEW.extraction_status THEN
        v_status := CASE NEW.extraction_status WHEN 'failed' THEN 'failure' ELSE 'success' END;
        v_title  := format('%s — extraction %s', COALESCE(NEW.file_name, 'Document'), COALESCE(NEW.extraction_status, 'updated'));
        PERFORM log_activity_event(
            'extraction', 'extraction_status_changed', 'financial_document', NEW.id, NEW.case_id,
            'worker', v_status, v_title,
            jsonb_build_object('file_name', NEW.file_name, 'old_status', OLD.extraction_status,
                               'new_status', NEW.extraction_status, 'error', NEW.extraction_error)
        );
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_doc_extraction ON financial_documents;
CREATE TRIGGER trg_doc_extraction AFTER UPDATE ON financial_documents
    FOR EACH ROW EXECUTE FUNCTION trg_fn_doc_extraction();

-- ── 10. Trigger: extraction job status ───────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fn_extraction_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text; v_title text;
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('completed', 'failed') THEN
        v_status := CASE NEW.status WHEN 'failed' THEN 'failure' ELSE 'success' END;
        v_title  := CASE NEW.status
            WHEN 'completed' THEN format('Extraction job completed (%s)', NEW.job_type)
            ELSE format('Extraction job failed after %s retries (%s)', NEW.retry_count, NEW.job_type)
        END;
        PERFORM log_activity_event(
            'extraction', CASE NEW.status WHEN 'completed' THEN 'job_completed' ELSE 'job_failed' END,
            'extraction_job', NEW.id, NEW.case_id, 'worker', v_status, v_title,
            jsonb_build_object('job_type', NEW.job_type, 'retry_count', NEW.retry_count,
                               'error', NEW.error_message, 'result_summary', NEW.result_summary)
        );
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_extraction_job ON extraction_jobs;
CREATE TRIGGER trg_extraction_job AFTER UPDATE ON extraction_jobs
    FOR EACH ROW EXECUTE FUNCTION trg_fn_extraction_job();
