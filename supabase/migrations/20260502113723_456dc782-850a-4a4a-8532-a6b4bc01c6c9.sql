
-- Drop the old analyses table
DROP TABLE IF EXISTS public.analyses CASCADE;
DROP TYPE IF EXISTS public.analysis_status CASCADE;

-- Enums
CREATE TYPE public.product_type AS ENUM (
  'operating_lease', 'finance_lease', 'project_finance', 'trade_finance',
  'pls', 'home_loan', 'employee_car_lease'
);

CREATE TYPE public.case_status AS ENUM (
  'draft', 'uploading', 'extracting', 'extracted',
  'analysis', 'narrative', 'ic_review', 'approved', 'declined'
);

CREATE TYPE public.doc_class AS ENUM (
  'profit_loss', 'balance_sheet', 'cash_flow', 'projections',
  'bank_statement', 'gst_return', 'other'
);

CREATE TYPE public.statement_type AS ENUM (
  'profit_loss', 'balance_sheet', 'cash_flow', 'projections'
);

CREATE TYPE public.threshold_status AS ENUM ('green', 'amber', 'red', 'na');

CREATE TYPE public.app_role AS ENUM (
  'analyst', 'credit_committee', 'operations', 'admin'
);

-- USER ROLES
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "user_roles_select_own" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "user_roles_admin_all" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.assign_default_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'analyst') ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_role ON auth.users;
CREATE TRIGGER on_auth_user_created_role
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.assign_default_role();

-- Backfill role for any existing users
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'analyst'::public.app_role FROM auth.users
ON CONFLICT DO NOTHING;

-- CREDIT CASES
CREATE TABLE public.credit_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  case_code text NOT NULL,
  client_name text NOT NULL,
  legal_constitution text,
  registered_address text,
  industry text,
  year_established integer,
  principal_borrower text,
  group_summary text,
  product_type public.product_type NOT NULL,
  deal_amount numeric(18,2),
  tenure_months integer,
  expected_irr numeric(6,3),
  residual_value numeric(18,2),
  security_deposit numeric(18,2),
  processing_fees numeric(18,2),
  collateral_summary text,
  end_use text,
  strategic_rationale text,
  policy_exceptions text,
  status public.case_status NOT NULL DEFAULT 'draft',
  delivery_email text,
  analyst_notes text,
  ic_note jsonb,
  recommendation_text text,
  ic_decision text,
  ic_decision_notes text,
  conditions_precedent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, case_code)
);
ALTER TABLE public.credit_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cc_select_own" ON public.credit_cases FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "cc_insert_own" ON public.credit_cases FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cc_update_own" ON public.credit_cases FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "cc_delete_own" ON public.credit_cases FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX idx_cc_user_status ON public.credit_cases(user_id, status);
CREATE INDEX idx_cc_user_created ON public.credit_cases(user_id, created_at DESC);
CREATE TRIGGER trg_cc_updated BEFORE UPDATE ON public.credit_cases
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- FINANCIAL DOCUMENTS
CREATE TABLE public.financial_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.credit_cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_name text NOT NULL,
  file_type text NOT NULL,
  doc_class public.doc_class NOT NULL DEFAULT 'other',
  fiscal_year integer,
  upload_status text NOT NULL DEFAULT 'uploaded',
  extraction_status text NOT NULL DEFAULT 'pending',
  extraction_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.financial_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fd_select_own" ON public.financial_documents FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "fd_insert_own" ON public.financial_documents FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "fd_update_own" ON public.financial_documents FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "fd_delete_own" ON public.financial_documents FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX idx_fd_case ON public.financial_documents(case_id);

-- EXTRACTED FINANCIALS
CREATE TABLE public.extracted_financials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.credit_cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.financial_documents(id) ON DELETE SET NULL,
  fiscal_year integer NOT NULL,
  statement_type public.statement_type NOT NULL,
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  confirmed boolean NOT NULL DEFAULT false,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, fiscal_year, statement_type)
);
ALTER TABLE public.extracted_financials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ef_select_own" ON public.extracted_financials FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "ef_insert_own" ON public.extracted_financials FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ef_update_own" ON public.extracted_financials FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "ef_delete_own" ON public.extracted_financials FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX idx_ef_case ON public.extracted_financials(case_id);
CREATE TRIGGER trg_ef_updated BEFORE UPDATE ON public.extracted_financials
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- FINANCIAL RATIOS
CREATE TABLE public.financial_ratios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.credit_cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fiscal_year integer NOT NULL,
  category text NOT NULL,
  ratio_name text NOT NULL,
  ratio_value numeric,
  benchmark numeric,
  threshold_status public.threshold_status NOT NULL DEFAULT 'na',
  formula_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, fiscal_year, ratio_name)
);
ALTER TABLE public.financial_ratios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fr_select_own" ON public.financial_ratios FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "fr_insert_own" ON public.financial_ratios FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "fr_update_own" ON public.financial_ratios FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "fr_delete_own" ON public.financial_ratios FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX idx_fr_case ON public.financial_ratios(case_id);

-- RATIO THRESHOLDS
CREATE TABLE public.ratio_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  industry text NOT NULL DEFAULT 'default',
  category text NOT NULL,
  ratio_name text NOT NULL,
  green_min numeric,
  amber_min numeric,
  peer_median numeric,
  higher_is_better boolean NOT NULL DEFAULT true,
  formula_note text,
  UNIQUE (industry, ratio_name)
);
ALTER TABLE public.ratio_thresholds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rt_select_all_auth" ON public.ratio_thresholds FOR SELECT TO authenticated USING (true);
CREATE POLICY "rt_admin_write" ON public.ratio_thresholds FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.ratio_thresholds (category, ratio_name, green_min, amber_min, peer_median, higher_is_better, formula_note) VALUES
  ('liquidity', 'current_ratio', 1.5, 1.0, 1.6, true, 'Current Assets / Current Liabilities'),
  ('liquidity', 'quick_ratio', 1.0, 0.7, 1.1, true, '(Current Assets - Inventory) / Current Liabilities'),
  ('liquidity', 'cash_ratio', 0.3, 0.15, 0.35, true, 'Cash / Current Liabilities'),
  ('liquidity', 'working_capital', 0, NULL, NULL, true, 'Current Assets - Current Liabilities'),
  ('leverage', 'debt_to_equity', 1.0, 2.0, 1.2, false, 'Total Debt / Net Worth (lower better)'),
  ('leverage', 'total_liab_to_networth', 1.5, 3.0, 1.8, false, 'Total Liabilities / Net Worth'),
  ('leverage', 'interest_coverage', 3.0, 1.5, 4.0, true, 'EBIT / Interest Expense'),
  ('coverage', 'dscr', 1.5, 1.25, 1.6, true, 'STANDARDISED by Finance: (PAT + Depreciation + Interest) / (Interest + Principal). Not analyst-overridable.'),
  ('efficiency', 'asset_turnover', 1.0, 0.5, 1.1, true, 'Turnover / Total Assets'),
  ('efficiency', 'capital_employed_turnover', 1.5, 0.8, 1.6, true, 'Turnover / Capital Employed'),
  ('efficiency', 'debtor_days', 60, 90, 55, false, '(Debtors / Turnover) * 365 (lower better)'),
  ('efficiency', 'creditor_days', 45, 75, 50, true, '(Creditors / Purchases) * 365'),
  ('efficiency', 'inventory_turnover', 6, 3, 7, true, 'COGS / Avg Inventory'),
  ('profitability', 'gross_margin', 0.25, 0.15, 0.28, true, 'Gross Profit / Turnover'),
  ('profitability', 'ebitda_margin', 0.15, 0.08, 0.18, true, 'EBITDA / Turnover'),
  ('profitability', 'pat_margin', 0.08, 0.04, 0.10, true, 'PAT / Turnover'),
  ('profitability', 'roe', 0.15, 0.08, 0.18, true, 'PAT / Net Worth'),
  ('profitability', 'roce', 0.15, 0.08, 0.18, true, 'EBIT / Capital Employed');

-- STORAGE: create case-files bucket alongside existing pdfs
INSERT INTO storage.buckets (id, name, public)
  VALUES ('case-files', 'case-files', false)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY "case_files_select_own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'case-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "case_files_insert_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'case-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "case_files_update_own" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'case-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "case_files_delete_own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'case-files' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.credit_cases;
ALTER PUBLICATION supabase_realtime ADD TABLE public.extracted_financials;
ALTER PUBLICATION supabase_realtime ADD TABLE public.financial_ratios;
ALTER TABLE public.credit_cases REPLICA IDENTITY FULL;
ALTER TABLE public.extracted_financials REPLICA IDENTITY FULL;
