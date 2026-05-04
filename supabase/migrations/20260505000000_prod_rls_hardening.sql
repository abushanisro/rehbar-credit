-- Production RLS hardening
-- SELECT and UPDATE stay open for full collaboration (all analysts share all cases).
-- INSERT: user_id must match auth.uid() — prevents one user spoofing another's identity.
-- DELETE: restricted to the row creator — prevents accidental or malicious data loss.
-- Edge functions use service_role and bypass RLS entirely — these policies only apply
-- to direct client calls (frontend supabase-js with user JWT).

-- ── credit_cases ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can insert cases" ON credit_cases;
DROP POLICY IF EXISTS "Authenticated users can delete cases" ON credit_cases;
CREATE POLICY "Authenticated users can insert cases"
  ON credit_cases FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Case creator can delete cases"
  ON credit_cases FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ── financial_documents ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can insert documents" ON financial_documents;
DROP POLICY IF EXISTS "Authenticated users can delete documents" ON financial_documents;
CREATE POLICY "Authenticated users can insert documents"
  ON financial_documents FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Document owner can delete documents"
  ON financial_documents FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ── extracted_financials ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can insert financials" ON extracted_financials;
DROP POLICY IF EXISTS "Authenticated users can delete financials" ON extracted_financials;
CREATE POLICY "Authenticated users can insert financials"
  ON extracted_financials FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Row owner can delete financials"
  ON extracted_financials FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ── financial_ratios ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can insert ratios" ON financial_ratios;
DROP POLICY IF EXISTS "Authenticated users can delete ratios" ON financial_ratios;
CREATE POLICY "Authenticated users can insert ratios"
  ON financial_ratios FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Row owner can delete ratios"
  ON financial_ratios FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ── emi_payments ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can insert emi payments" ON emi_payments;
DROP POLICY IF EXISTS "Authenticated users can delete emi payments" ON emi_payments;
CREATE POLICY "Authenticated users can insert emi payments"
  ON emi_payments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Row owner can delete emi payments"
  ON emi_payments FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ── bank_statement_data ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can insert bank data" ON bank_statement_data;
DROP POLICY IF EXISTS "Authenticated users can delete bank data" ON bank_statement_data;
CREATE POLICY "Authenticated users can insert bank data"
  ON bank_statement_data FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Row owner can delete bank data"
  ON bank_statement_data FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ── gst_return_data ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can insert gst data" ON gst_return_data;
DROP POLICY IF EXISTS "Authenticated users can delete gst data" ON gst_return_data;
CREATE POLICY "Authenticated users can insert gst data"
  ON gst_return_data FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Row owner can delete gst data"
  ON gst_return_data FOR DELETE TO authenticated
  USING (user_id = auth.uid());
