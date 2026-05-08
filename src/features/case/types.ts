import type { Tables } from "@/integrations/supabase/types";
import type { StatementType, DocClass, ProductType } from "@/features/credit/domain";

export type CaseRow = Tables<"credit_cases">;
export type DocRow = Tables<"financial_documents">;
export type ExtractedRow = Tables<"extracted_financials">;
export type RatioRow = Tables<"financial_ratios">;

export interface LineItem {
  label: string; value: number | null; confidence: number;
  reviewed: boolean; override_value?: number | null; note?: string;
}

export type { StatementType, DocClass, ProductType };

export type QueueStatus = "pending" | "processing" | "done" | "error" | "duplicate";

export type UploadQueueItem = {
  id: string; file: File; name: string; size: string;
  status: QueueStatus;
};

export type FinQueueItem = UploadQueueItem & { stmtType: DocClass; fy: string };

export type EditScanResult = {
  client_name?: string;
  product_type?: ProductType;
  product_type_custom?: string;
  legal_constitution?: string;
  industry?: string;
  year_established?: number;
  promoter_details?: string;
  deal_amount?: number;
  tenure_months?: number;
  expected_irr?: number;
  end_use?: string;
  collateral_summary?: string;
  strategic_rationale?: string;
  website?: string;
  summary?: string;
  confidence?: number;
};

export type EditFileQueueItem = {
  id: string;
  name: string;
  size: string;
  fileType: "pdf" | "image" | "excel";
  status: "pending" | "uploading" | "done" | "error" | "duplicate";
  uploadPct: number;
  storagePath?: string;
};

// ── Accumn GST Analytical Report types ────────────────────────────────────────
export interface AccumnFlag { flag_name: string; severity: "HIGH" | "MEDIUM" | "LOW"; description: string }
export interface AccumnSalesSummary { period: string; adjusted_revenue?: number|null; net_revenue?: number|null; sales_return_pct?: number|null; advance_pct?: number|null; gross_margin_pct?: number|null; ebitda_pct?: number|null; pat_pct?: number|null }
export interface AccumnConcentration { period: string; rank: number; name: string; gstin?: string; amount: number; pct: number }
export interface AccumnGeography { period: string; state: string; amount: number; pct: number }
export interface AccumnProduct { period: string; chapter?: string; hsn?: string; description: string; amount: number; pct: number }
export interface AccumnTaxDetail { period: string; wc_investment?: number|null; output_tax?: number|null; igst?: number|null; cgst?: number|null; sgst?: number|null; itc_availed?: number|null; net_tax?: number|null }
export interface AccumnGstrRow { period: string; gstr1_turnover?: number|null; gstr3b_turnover?: number|null; gstr9_turnover?: number|null; gstr1_tax?: number|null; gstr3b_tax?: number|null; difference?: number|null }
export interface AccumnCircular { entity: string; gstin?: string; sale_amount?: number|null; purchase_amount?: number|null; note?: string }
export interface AccumnCategoryRow { period: string; b2b?: number|null; b2c_small?: number|null; b2c_large?: number|null; export?: number|null; nil_rated?: number|null; total?: number|null }
export interface AccumnReport {
  is_accumn: boolean;
  flags?: AccumnFlag[];
  company_profile?: { name?: string; gstin?: string; pan?: string; constitution?: string; state?: string; business_type?: string; registration_date?: string; report_date?: string };
  sales_summary?: AccumnSalesSummary[];
  customer_categories?: AccumnCategoryRow[];
  geography?: AccumnGeography[];
  customer_concentration?: AccumnConcentration[];
  supplier_concentration?: AccumnConcentration[];
  product_concentration?: AccumnProduct[];
  tax_details?: AccumnTaxDetail[];
  gstr_comparison?: AccumnGstrRow[];
  circular_transactions?: AccumnCircular[];
}
