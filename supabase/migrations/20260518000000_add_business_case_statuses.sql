-- Add the five new business-facing status values to case_status enum.
-- ALTER TYPE ... ADD VALUE cannot run inside an explicit transaction block;
-- Supabase migrations run each statement individually so this is safe.
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'docs_received';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'on_hold';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'recommended_ic';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'conditionally_approved';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'queries_resubmission';
