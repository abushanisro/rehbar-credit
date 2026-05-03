-- Bank statement monthly data
CREATE TABLE IF NOT EXISTS bank_statement_data (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id          uuid NOT NULL REFERENCES credit_cases(id) ON DELETE CASCADE,
  document_id      uuid REFERENCES financial_documents(id) ON DELETE SET NULL,
  user_id          uuid NOT NULL,
  month            text NOT NULL,          -- "YYYY-MM"
  bank_name        text,
  account_number   text,
  opening_balance  numeric(15,2),
  closing_balance  numeric(15,2),
  total_credits    numeric(15,2),
  total_debits     numeric(15,2),
  credit_count     integer,
  debit_count      integer,
  avg_balance      numeric(15,2),
  min_balance      numeric(15,2),
  max_balance      numeric(15,2),
  bounce_inward    integer DEFAULT 0,
  bounce_outward   integer DEFAULT 0,
  emi_outflows     numeric(15,2),
  remarks          text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  UNIQUE (case_id, month, bank_name)
);

ALTER TABLE bank_statement_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bank_stmt_owner" ON bank_statement_data FOR ALL USING (user_id = auth.uid());
CREATE INDEX bank_statement_data_case_idx ON bank_statement_data (case_id);

-- GST return period data
CREATE TABLE IF NOT EXISTS gst_return_data (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id          uuid NOT NULL REFERENCES credit_cases(id) ON DELETE CASCADE,
  document_id      uuid REFERENCES financial_documents(id) ON DELETE SET NULL,
  user_id          uuid NOT NULL,
  period           text NOT NULL,          -- "YYYY-MM" or "Q1 FY2025"
  return_type      text,                   -- GSTR-1 | GSTR-3B | GSTR-9
  gstin            text,
  taxable_turnover numeric(15,2),
  exempt_turnover  numeric(15,2),
  total_turnover   numeric(15,2),
  output_tax       numeric(15,2),
  itc_claimed      numeric(15,2),
  net_tax_paid     numeric(15,2),
  filing_date      text,
  filing_status    text DEFAULT 'filed',   -- filed | not_filed | late
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  UNIQUE (case_id, period, return_type)
);

ALTER TABLE gst_return_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gst_owner" ON gst_return_data FOR ALL USING (user_id = auth.uid());
CREATE INDEX gst_return_data_case_idx ON gst_return_data (case_id);
