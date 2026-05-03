/**
 * Rehbar Credit Analysis Software — Domain configuration
 * Sourced from BRD v1.0 + IC Note SOP (16 Apr 2026).
 */

export type ProductType =
  | "operating_lease"
  | "finance_lease"
  | "project_finance"
  | "trade_finance"
  | "pls"
  | "home_loan"
  | "employee_car_lease"
  | "other";

export type CaseStatus =
  | "draft"
  | "uploading"
  | "extracting"
  | "extracted"
  | "analysis"
  | "narrative"
  | "ic_review"
  | "approved"
  | "declined";

export type StatementType = "profit_loss" | "balance_sheet" | "cash_flow" | "projections" | "all_in_one";
export type DocClass = StatementType | "bank_statement" | "gst_return" | "other";
export type ThresholdStatus = "green" | "amber" | "red" | "na";

export interface ProductMeta {
  id: ProductType;
  label: string;
  short: string;
  legalNature: string;
  returnMechanism: string;
  isCore?: boolean;
  rules: string[]; // Product-specific rules from SOP §XII
  requiredFields: Array<keyof CaseFieldRequirement>;
}

export interface CaseFieldRequirement {
  deal_amount: boolean;
  tenure_months: boolean;
  expected_irr: boolean;
  residual_value: boolean;
  security_deposit: boolean;
  collateral_summary: boolean;
  end_use: boolean;
}

export const PRODUCTS: Record<ProductType, ProductMeta> = {
  operating_lease: {
    id: "operating_lease",
    label: "OPERATING LEASE",
    short: "OL",
    legalNature: "Asset rental; RERL retains ownership.",
    returnMechanism: "Fixed Rental",
    isCore: true,
    rules: [
      "Projections NOT mandatory if cumulative deal exposure < INR 100L",
      "Projections OPTIONAL if current year DSCR covers proposed deal",
      "Monthly rentals attract GST; RERL claims depreciation",
      "Proforma D1-D2 → NACH 10th/15th → e-invoice post-payment",
    ],
    requiredFields: ["deal_amount", "tenure_months", "expected_irr", "residual_value", "security_deposit", "collateral_summary", "end_use"],
  },
  finance_lease: {
    id: "finance_lease",
    label: "FINANCE LEASE",
    short: "FL",
    legalNature: "Structured legally as a Term Loan / Inter-Corporate Loan.",
    returnMechanism: "Milestone Basis (Monthly EMI)",
    rules: [
      "Projections NOT mandatory if cumulative deal exposure < INR 100L",
      "Projections OPTIONAL if current year DSCR covers proposed deal",
      "Interest-based accounting; no GST on EMI principal/interest",
    ],
    requiredFields: ["deal_amount", "tenure_months", "expected_irr", "collateral_summary", "end_use"],
  },
  project_finance: {
    id: "project_finance",
    label: "PROJECT FINANCE",
    short: "PF",
    legalNature: "Inter-Corporate Loan",
    returnMechanism: "Milestone-based",
    rules: [
      "Projections NOT required for PF",
      "Project working sheets and detailed timelines are MANDATORY",
      "Short-term stress analysis required for credit-servicing at maturity",
    ],
    requiredFields: ["deal_amount", "tenure_months", "expected_irr", "collateral_summary", "end_use"],
  },
  trade_finance: {
    id: "trade_finance",
    label: "TRADE FINANCE",
    short: "TF",
    legalNature: "Inter-Corporate Loan",
    returnMechanism: "Fixed return",
    rules: [
      "Projections NOT required for TF",
      "Specific repayment justification (source of liquidity) MUST be stated",
    ],
    requiredFields: ["deal_amount", "tenure_months", "expected_irr", "end_use"],
  },
  pls: {
    id: "pls",
    label: "PROFIT & LOSS SHARING",
    short: "PLS",
    legalNature: "Loan with variable return based on performance.",
    returnMechanism: "X% of Gross / Adjusted Net Profit",
    rules: [
      "Client must submit MONTHLY P&L for interest/principal bifurcation per EMI",
      "Profit share % agreed up-front",
      "Fixed EMI; NACH 10th/15th",
    ],
    requiredFields: ["deal_amount", "tenure_months", "expected_irr", "collateral_summary", "end_use"],
  },
  home_loan: {
    id: "home_loan",
    label: "HOME LOAN",
    short: "HL",
    legalNature: "Housing finance — rental as interest, balance as principal.",
    returnMechanism: "Rental-linked EMI",
    rules: [
      "MAX 60% of property value funded (LTV ≤ 60%)",
      "FOIR maximum 50%",
      "Rental decided in advance with yearly increment",
    ],
    requiredFields: ["deal_amount", "tenure_months", "expected_irr", "collateral_summary", "end_use"],
  },
  employee_car_lease: {
    id: "employee_car_lease",
    label: "EMPLOYEE CAR LEASE",
    short: "ECL",
    legalNature: "Operating Lease subcategory; lease to company linked to employee.",
    returnMechanism: "Fixed Rental (deducted from employee salary)",
    rules: [
      "Same legal/agreement structure as Operating Lease",
      "Employee salary verification REQUIRED",
      "Verify timely payment of Salary, PF, ESI by company",
      "No additional expense burden on company",
    ],
    requiredFields: ["deal_amount", "tenure_months", "expected_irr", "residual_value", "security_deposit"],
  },
  other: {
    id: "other",
    label: "OTHER",
    short: "OTH",
    legalNature: "Custom / specify manually",
    returnMechanism: "As specified",
    rules: [
      "Specify product type in the custom field",
      "Ensure applicable SOP rules are manually reviewed",
    ],
    requiredFields: ["deal_amount", "tenure_months", "expected_irr"],
  },
};

export const CASE_STATUS_META: Record<CaseStatus, { label: string; color: string; pipeline: number }> = {
  draft: { label: "DRAFT", color: "muted", pipeline: 0 },
  uploading: { label: "UPLOADING", color: "warning", pipeline: 1 },
  extracting: { label: "EXTRACTING", color: "warning", pipeline: 2 },
  extracted: { label: "REVIEW EXTRACTION", color: "warning", pipeline: 3 },
  analysis: { label: "RATIO ANALYSIS", color: "accent", pipeline: 4 },
  narrative: { label: "NARRATIVE DRAFT", color: "accent", pipeline: 5 },
  ic_review: { label: "IC REVIEW", color: "primary", pipeline: 6 },
  approved: { label: "APPROVED", color: "success", pipeline: 7 },
  declined: { label: "DECLINED", color: "destructive", pipeline: 7 },
};

/**
 * 12 IC Note sections per SOP §4.
 * Each section is rendered as its own panel in the IC Note editor.
 */
export const IC_SECTIONS = [
  { id: "executive_summary", roman: "I", title: "EXECUTIVE SUMMARY", desc: "Overview, fund amount, reason, key ratios, strategic rationale, policy exceptions, conditions precedent" },
  { id: "client_promoter", roman: "II", title: "CLIENT & PROMOTER PROFILE", desc: "Legal name, constitution, year established, principal borrower, group summary, promoter CIBIL" },
  { id: "investment_structure", roman: "III", title: "PROPOSED INVESTMENT STRUCTURE", desc: "End use, facility details, IRR, collateral, short-term stress" },
  { id: "rehbar_funding_history", roman: "IV", title: "REHBAR FUNDING HISTORY", desc: "Historical funding to client / Non-Rehbar history for new clients" },
  { id: "historical_financial", roman: "V", title: "HISTORICAL FINANCIAL ANALYSIS (3Y)", desc: "P&L YoY, BS YoY (reconstructed if needed), qualitative observations" },
  { id: "projections", roman: "VI", title: "PROJECTIONS & ESTIMATES", desc: "P&L and BS projections (3Y), assumption justification" },
  { id: "key_ratios", roman: "VII", title: "KEY FINANCIAL RATIOS", desc: "Liquidity, Leverage, Efficiency, Profitability, Coverage — historical & projected" },
  { id: "cash_flow", roman: "VIII", title: "CASH FLOW STATEMENT", desc: "Operating, investing, financing analysis for repayment capacity" },
  { id: "due_diligence", roman: "IX", title: "DUE DILIGENCE EXCERPTS", desc: "External DD findings (mandatory for Pvt Ltd/Ltd), stakeholder interviews" },
  { id: "risk_assessment", roman: "X", title: "RISK ASSESSMENT & MITIGATION", desc: "Business, industry, financial, transaction risks + mitigants" },
  { id: "visit_reference", roman: "XI", title: "VISIT REPORT, REFERENCE CHECKS, EXEC RECOMMENDATION", desc: "Site visit, reference checks (vendors, bankers, customers), exec recommendation" },
  { id: "product_specifics", roman: "XII", title: "SPECIFIC PRODUCT REQUIREMENTS & EXEMPTIONS", desc: "Product-rule application (PF/TF projections, PLS reporting, HL FOIR/LTV, etc.)" },
] as const;

export type ICSectionId = (typeof IC_SECTIONS)[number]["id"];

/** AI-Generated Draft watermark per BRD §CAS-MH-03 business rule */
export const AI_DRAFT_BANNER =
  "AI-GENERATED DRAFT — REQUIRES ANALYST REVIEW AND APPROVAL. NO CREDIT RECOMMENDATION IS MADE BY THE AI.";

/** Confidence buckets per BRD §CAS-MH-01 business rules */
export function confidenceBucket(score: number): "high" | "medium" | "low" {
  if (score >= 90) return "high";
  if (score >= 80) return "medium";
  return "low";
}

/** Standard line-item labels we expect to extract per statement type */
export const STANDARD_LINE_ITEMS: Record<StatementType, string[]> = {
  profit_loss: [
    "Turnover",
    "Cost of Goods Sold",
    "Gross Profit",
    "Operating Expenses",
    "EBITDA",
    "Depreciation",
    "EBIT",
    "Interest Expense",
    "Profit Before Tax",
    "Tax",
    "PAT",
  ],
  balance_sheet: [
    "Share Capital",
    "Reserves & Surplus",
    "Net Worth",
    "Long Term Borrowings",
    "Short Term Borrowings",
    "Total Debt",
    "Trade Payables",
    "Other Current Liabilities",
    "Current Liabilities",
    "Total Liabilities",
    "Fixed Assets (Net)",
    "Inventory",
    "Trade Receivables",
    "Cash & Bank",
    "Other Current Assets",
    "Current Assets",
    "Total Assets",
    "Capital Employed",
  ],
  cash_flow: [
    "Cash from Operations",
    "Cash from Investing",
    "Cash from Financing",
    "Net Change in Cash",
    "Opening Cash",
    "Closing Cash",
  ],
  projections: [
    "Projected Turnover",
    "Projected EBITDA",
    "Projected PAT",
    "Projected Net Worth",
    "Projected Total Debt",
  ],
  all_in_one: [],
};

export const RATIO_DISPLAY_NAMES: Record<string, string> = {
  // Liquidity
  current_ratio: "Current Ratio",
  quick_ratio: "Quick Ratio",
  cash_ratio: "Cash Ratio",
  working_capital: "Working Capital",
  // Solvency
  debt_to_equity: "Debt-to-Equity Ratio",
  debt_to_assets: "Debt-to-Assets Ratio",
  total_liab_to_networth: "Total Liab / Net Worth",
  interest_coverage: "Interest Coverage Ratio",
  // Coverage
  dscr: "DSCR",
  // Efficiency
  asset_turnover: "Asset Turnover Ratio",
  receivables_turnover: "Receivables Turnover Ratio",
  capital_employed_turnover: "Cap Employed Turnover",
  debtor_days: "Debtor Days",
  creditor_days: "Creditor Days",
  inventory_turnover: "Inventory Turnover Ratio",
  // Profitability
  gross_margin: "Gross Profit Margin",
  ebitda_margin: "EBITDA Margin",
  net_profit_margin: "Net Profit Margin",
  roa: "Return on Assets (ROA)",
  roe: "Return on Equity (ROE)",
  // Return
  roce: "Return on Capital Employed (ROCE)",
  roic: "Return on Invested Capital (ROIC)",
  ronw: "Return on Net Worth (RONW)",
  // R' Score
  r_score_wc_ta: "WC Cushion / Total Assets (×6)",
  r_score_re_ta: "Retained Earnings / Total Assets (×3)",
  r_score_ebitda_ta: "EBITDA / Total Assets (×7)",
  r_score_equity_ol: "Equity / Outside Liabilities (×1)",
  r_score_composite: "R' Score (Composite)",
};

const PCT_RATIOS = new Set([
  "gross_margin", "ebitda_margin", "net_profit_margin", "pat_margin",
  "roa", "roe", "roce", "roic", "ronw",
]);
const R_SCORE_RATIOS = new Set([
  "r_score_composite", "r_score_wc_ta", "r_score_re_ta", "r_score_ebitda_ta", "r_score_equity_ol",
]);

export function formatRatio(name: string, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  if (["debtor_days", "creditor_days"].includes(name)) return value.toFixed(0);
  if (name === "working_capital") return value.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  if (PCT_RATIOS.has(name)) return (value * 100).toFixed(1) + "%";
  if (R_SCORE_RATIOS.has(name)) return value.toFixed(2);
  return value.toFixed(2) + "x";
}
