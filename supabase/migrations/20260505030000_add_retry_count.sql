-- Add retry_count to financial_documents so UI can show how many times a doc was retried
ALTER TABLE financial_documents
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;

-- Helper called by the Trigger.dev task before each extraction attempt
CREATE OR REPLACE FUNCTION increment_retry_count(doc_ids uuid[])
RETURNS void LANGUAGE sql AS $$
  UPDATE financial_documents
  SET retry_count = retry_count + 1
  WHERE id = ANY(doc_ids);
$$;

