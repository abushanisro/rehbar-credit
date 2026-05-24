-- Enable pgvector for semantic search on document chunks
CREATE EXTENSION IF NOT EXISTS vector;

-- Stores extracted page-level text chunks with embeddings for RAG / analyst-chat
CREATE TABLE IF NOT EXISTS document_chunks (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id      uuid        NOT NULL REFERENCES credit_cases(id) ON DELETE CASCADE,
  document_id  uuid        NOT NULL REFERENCES financial_documents(id) ON DELETE CASCADE,
  chunk_index  integer     NOT NULL,
  page_number  integer,
  content      text        NOT NULL,
  embedding    vector(768),           -- Google Gemini text-embedding-004 dimensions
  created_at   timestamptz DEFAULT now()
);

-- ivfflat index for fast approximate cosine similarity search
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
  ON document_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Regular indexes for filtering
CREATE INDEX IF NOT EXISTS document_chunks_case_id_idx     ON document_chunks (case_id);
CREATE INDEX IF NOT EXISTS document_chunks_document_id_idx ON document_chunks (document_id);

-- RLS: users can only access chunks for cases they have access to
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read own case chunks"
  ON document_chunks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM credit_cases cc
      WHERE cc.id = document_chunks.case_id
        AND cc.user_id = auth.uid()
    )
  );

CREATE POLICY "service role full access"
  ON document_chunks FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
