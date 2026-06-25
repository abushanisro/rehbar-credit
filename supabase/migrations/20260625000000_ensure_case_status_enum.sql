-- Ensure all case_status enum values exist.
-- ALTER TYPE ... ADD VALUE is idempotent with IF NOT EXISTS.
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'draft';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'docs_received';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'on_hold';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'uploading';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'extracting';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'extracted';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'analysis';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'narrative';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'recommended_ic';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'ic_review';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'approved';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'conditionally_approved';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'declined';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'queries_resubmission';
