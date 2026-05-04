-- Allow all authenticated users to read all case data (internal collaboration tool)
-- Previously only the case owner (user_id = auth.uid()) could read their own rows.
-- This migration opens SELECT to any signed-in analyst so shared case links work.

-- ── credit_cases ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own cases" ON credit_cases;
DROP POLICY IF EXISTS "Authenticated users can read cases" ON credit_cases;
CREATE POLICY "Authenticated users can read cases"
  ON credit_cases FOR SELECT
  TO authenticated
  USING (true);

-- ── financial_documents ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own documents" ON financial_documents;
DROP POLICY IF EXISTS "Authenticated users can read documents" ON financial_documents;
CREATE POLICY "Authenticated users can read documents"
  ON financial_documents FOR SELECT
  TO authenticated
  USING (true);

-- ── extracted_financials ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own financials" ON extracted_financials;
DROP POLICY IF EXISTS "Authenticated users can read financials" ON extracted_financials;
CREATE POLICY "Authenticated users can read financials"
  ON extracted_financials FOR SELECT
  TO authenticated
  USING (true);

-- ── financial_ratios ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own ratios" ON financial_ratios;
DROP POLICY IF EXISTS "Authenticated users can read ratios" ON financial_ratios;
CREATE POLICY "Authenticated users can read ratios"
  ON financial_ratios FOR SELECT
  TO authenticated
  USING (true);

-- ── emi_payments ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own emi payments" ON emi_payments;
DROP POLICY IF EXISTS "Authenticated users can read emi payments" ON emi_payments;
CREATE POLICY "Authenticated users can read emi payments"
  ON emi_payments FOR SELECT
  TO authenticated
  USING (true);

-- ── bank_statement_data ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own bank data" ON bank_statement_data;
DROP POLICY IF EXISTS "Authenticated users can read bank data" ON bank_statement_data;
CREATE POLICY "Authenticated users can read bank data"
  ON bank_statement_data FOR SELECT
  TO authenticated
  USING (true);

-- ── gst_return_data ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own gst data" ON gst_return_data;
DROP POLICY IF EXISTS "Authenticated users can read gst data" ON gst_return_data;
CREATE POLICY "Authenticated users can read gst data"
  ON gst_return_data FOR SELECT
  TO authenticated
  USING (true);
