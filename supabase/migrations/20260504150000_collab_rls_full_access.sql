-- Grant all authenticated users full read + write access to all case tables.
-- This is an internal tool — any signed-in analyst can create, edit, and delete.

-- ── credit_cases ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert own cases" ON credit_cases;
DROP POLICY IF EXISTS "Users can update own cases" ON credit_cases;
DROP POLICY IF EXISTS "Users can delete own cases" ON credit_cases;
CREATE POLICY "Authenticated users can insert cases"
  ON credit_cases FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update cases"
  ON credit_cases FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete cases"
  ON credit_cases FOR DELETE TO authenticated USING (true);

-- ── financial_documents ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert own documents" ON financial_documents;
DROP POLICY IF EXISTS "Users can update own documents" ON financial_documents;
DROP POLICY IF EXISTS "Users can delete own documents" ON financial_documents;
CREATE POLICY "Authenticated users can insert documents"
  ON financial_documents FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update documents"
  ON financial_documents FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete documents"
  ON financial_documents FOR DELETE TO authenticated USING (true);

-- ── extracted_financials ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert own financials" ON extracted_financials;
DROP POLICY IF EXISTS "Users can update own financials" ON extracted_financials;
DROP POLICY IF EXISTS "Users can delete own financials" ON extracted_financials;
CREATE POLICY "Authenticated users can insert financials"
  ON extracted_financials FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update financials"
  ON extracted_financials FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete financials"
  ON extracted_financials FOR DELETE TO authenticated USING (true);

-- ── financial_ratios ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert own ratios" ON financial_ratios;
DROP POLICY IF EXISTS "Users can update own ratios" ON financial_ratios;
DROP POLICY IF EXISTS "Users can delete own ratios" ON financial_ratios;
CREATE POLICY "Authenticated users can insert ratios"
  ON financial_ratios FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update ratios"
  ON financial_ratios FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete ratios"
  ON financial_ratios FOR DELETE TO authenticated USING (true);

-- ── emi_payments ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert own emi payments" ON emi_payments;
DROP POLICY IF EXISTS "Users can update own emi payments" ON emi_payments;
DROP POLICY IF EXISTS "Users can delete own emi payments" ON emi_payments;
CREATE POLICY "Authenticated users can insert emi payments"
  ON emi_payments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update emi payments"
  ON emi_payments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete emi payments"
  ON emi_payments FOR DELETE TO authenticated USING (true);

-- ── bank_statement_data ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert own bank data" ON bank_statement_data;
DROP POLICY IF EXISTS "Users can update own bank data" ON bank_statement_data;
DROP POLICY IF EXISTS "Users can delete own bank data" ON bank_statement_data;
CREATE POLICY "Authenticated users can insert bank data"
  ON bank_statement_data FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update bank data"
  ON bank_statement_data FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete bank data"
  ON bank_statement_data FOR DELETE TO authenticated USING (true);

-- ── gst_return_data ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert own gst data" ON gst_return_data;
DROP POLICY IF EXISTS "Users can update own gst data" ON gst_return_data;
DROP POLICY IF EXISTS "Users can delete own gst data" ON gst_return_data;
CREATE POLICY "Authenticated users can insert gst data"
  ON gst_return_data FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update gst data"
  ON gst_return_data FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete gst data"
  ON gst_return_data FOR DELETE TO authenticated USING (true);
