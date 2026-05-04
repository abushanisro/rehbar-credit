-- Allow any authenticated analyst to delete any case/document/financial row.
-- SELECT and UPDATE are already open to all authenticated users for collaboration;
-- DELETE was restricted to the row creator, which caused silent failures when
-- cases were deleted by a different analyst than the one who created them.

-- credit_cases
DROP POLICY IF EXISTS "Case creator can delete cases" ON credit_cases;
CREATE POLICY "Authenticated users can delete cases"
  ON credit_cases FOR DELETE TO authenticated USING (true);

-- financial_documents
DROP POLICY IF EXISTS "Document owner can delete documents" ON financial_documents;
CREATE POLICY "Authenticated users can delete documents"
  ON financial_documents FOR DELETE TO authenticated USING (true);

-- extracted_financials
DROP POLICY IF EXISTS "Row owner can delete financials" ON extracted_financials;
CREATE POLICY "Authenticated users can delete financials"
  ON extracted_financials FOR DELETE TO authenticated USING (true);

-- financial_ratios
DROP POLICY IF EXISTS "Row owner can delete ratios" ON financial_ratios;
CREATE POLICY "Authenticated users can delete ratios"
  ON financial_ratios FOR DELETE TO authenticated USING (true);

-- emi_payments
DROP POLICY IF EXISTS "Row owner can delete emi payments" ON emi_payments;
CREATE POLICY "Authenticated users can delete emi payments"
  ON emi_payments FOR DELETE TO authenticated USING (true);

-- bank_statement_data
DROP POLICY IF EXISTS "Row owner can delete bank data" ON bank_statement_data;
CREATE POLICY "Authenticated users can delete bank data"
  ON bank_statement_data FOR DELETE TO authenticated USING (true);

-- gst_return_data
DROP POLICY IF EXISTS "Row owner can delete gst data" ON gst_return_data;
CREATE POLICY "Authenticated users can delete gst data"
  ON gst_return_data FOR DELETE TO authenticated USING (true);
