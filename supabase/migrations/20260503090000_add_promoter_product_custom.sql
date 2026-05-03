ALTER TYPE product_type ADD VALUE IF NOT EXISTS 'other';

ALTER TABLE credit_cases
  ADD COLUMN IF NOT EXISTS promoter_details TEXT,
  ADD COLUMN IF NOT EXISTS product_type_custom TEXT;
