-- Fix: document_class → doc_class in upload trigger

CREATE OR REPLACE FUNCTION trg_fn_doc_uploaded() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM log_activity_event(
        'document', 'uploaded', 'financial_document', NEW.id, NEW.case_id, 'analyst', 'success',
        COALESCE(NEW.file_name, 'Document') || ' uploaded',
        jsonb_build_object('file_name', NEW.file_name, 'file_type', NEW.file_type,
                           'doc_class', NEW.doc_class, 'document_id', NEW.id)
    );
    RETURN NEW;
END;
$$;
