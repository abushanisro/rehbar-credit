-- Fix trg_fn_case_status: cast case_status enum to text before calling REPLACE()
CREATE OR REPLACE FUNCTION trg_fn_case_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        PERFORM log_activity_event(
            'case', 'status_changed', 'credit_case', NEW.id, NEW.id, 'system', 'success',
            format('%s — moved to %s', COALESCE(NEW.client_name, NEW.id::text), REPLACE(NEW.status::text, '_', ' ')),
            jsonb_build_object('old_status', OLD.status::text, 'new_status', NEW.status::text,
                               'client_name', NEW.client_name, 'case_code', NEW.case_code)
        );
    END IF;
    RETURN NEW;
END;
$$;
