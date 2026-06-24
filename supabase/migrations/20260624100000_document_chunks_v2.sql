-- document_chunks v2 — structured data indexing + vector search RPC
-- Extends document_chunks to store structured case data as embedded text chunks
-- alongside existing PDF page chunks. Adds match_document_chunks RPC for RAG.

-- Make document_id nullable so structured data chunks (no source document) can be stored
ALTER TABLE document_chunks ALTER COLUMN document_id DROP NOT NULL;

-- chunk_type: 'pdf' (default, existing chunks) | 'financials' | 'ratios' | 'bank' |
--             'gst' | 'cibil' | 'triangulation' | 'accumn' | 'mca'
ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS chunk_type TEXT NOT NULL DEFAULT 'pdf';

-- metadata: arbitrary JSON context (fiscal_year, bank_name, borrower_name, etc.)
ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

-- Indexes for filtering by chunk_type
CREATE INDEX IF NOT EXISTS document_chunks_chunk_type_idx
  ON document_chunks (chunk_type);

CREATE INDEX IF NOT EXISTS document_chunks_case_chunk_type_idx
  ON document_chunks (case_id, chunk_type);

-- ── Vector similarity search RPC ─────────────────────────────────────────────
-- Returns top-N chunks for a case ordered by cosine similarity to a query embedding.
-- filter_types: optional array to restrict to specific chunk_types (NULL = all types).

CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding  vector(768),
  filter_case_id   uuid,
  match_count      int     DEFAULT 8,
  match_threshold  float   DEFAULT 0.40,
  filter_types     text[]  DEFAULT NULL
)
RETURNS TABLE (
  id          uuid,
  content     text,
  chunk_type  text,
  metadata    jsonb,
  similarity  float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.content,
    dc.chunk_type,
    dc.metadata,
    (1 - (dc.embedding <=> query_embedding))::float AS similarity
  FROM document_chunks dc
  WHERE
    dc.case_id  = filter_case_id
    AND dc.embedding IS NOT NULL
    AND (filter_types IS NULL OR dc.chunk_type = ANY(filter_types))
    AND (1 - (dc.embedding <=> query_embedding)) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Grant execute to authenticated users and service role
GRANT EXECUTE ON FUNCTION match_document_chunks TO authenticated;
GRANT EXECUTE ON FUNCTION match_document_chunks TO service_role;
