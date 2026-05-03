-- Add unit column to extracted_financials (stores AI-detected unit: Lakhs / Crores / INR / USD)
ALTER TABLE public.extracted_financials ADD COLUMN IF NOT EXISTS unit text;
