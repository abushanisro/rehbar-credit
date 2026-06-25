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
  | "docs_received"
  | "on_hold"
  | "uploading"
  | "extracting"
  | "extracted"
  | "analysis"
  | "narrative"
  | "recommended_ic"
  | "ic_review"
  | "approved"
  | "conditionally_approved"
  | "declined"
  | "queries_resubmission";

export type StatementType = "profit_loss" | "balance_sheet" | "cash_flow" | "projections" | "all_in_one";
export type DocClass = StatementType | "bank_statement" | "gst_return" | "cibil_report" | "provisional" | "other";
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
  draft:                  { label: "CASE CREATED",         color: "muted",        pipeline: 1  },
  docs_received:          { label: "DOCS RECEIVED",         color: "primary",      pipeline: 2  },
  on_hold:                { label: "ON HOLD",               color: "warning",      pipeline: 3  },
  uploading:              { label: "UPLOADING",             color: "warning",      pipeline: 2  },
  extracting:             { label: "EXTRACTING",            color: "warning",      pipeline: 2  },
  extracted:              { label: "REVIEW EXTRACTION",     color: "warning",      pipeline: 2  },
  analysis:               { label: "ANALYSIS IN PROCESS",   color: "accent",       pipeline: 4  },
  narrative:              { label: "NARRATIVE DRAFT",       color: "accent",       pipeline: 5  },
  recommended_ic:         { label: "RECOMMENDED FOR IC",    color: "accent",       pipeline: 5  },
  ic_review:              { label: "SUBMITTED TO IC",       color: "primary",      pipeline: 6  },
  approved:               { label: "APPROVED BY IC",        color: "success",      pipeline: 7  },
  conditionally_approved: { label: "COND. APPROVED BY IC",  color: "success",      pipeline: 8  },
  declined:               { label: "REJECTED BY IC",        color: "destructive",  pipeline: 9  },
  queries_resubmission:   { label: "QUERIES RESUBMISSION",  color: "warning",      pipeline: 10 },
};

/**
 * 12 IC Note sections per SOP §4.
 * Each section is rendered as its own panel in the IC Note editor.
 */
export const IC_SECTIONS = [
  { id: "executive_summary",    roman: "I",    title: "EXECUTIVE SUMMARY",                                    short: "Exec Summary",      desc: "Overview, fund amount, reason, key ratios, strategic rationale, policy exceptions, conditions precedent" },
  { id: "client_promoter",      roman: "II",   title: "CLIENT & PROMOTER PROFILE",                           short: "Client Profile",    desc: "Legal name, constitution, year established, principal borrower, group summary, promoter CIBIL" },
  { id: "investment_structure", roman: "III",  title: "PROPOSED INVESTMENT STRUCTURE",                       short: "Investment",        desc: "End use, facility details, IRR, collateral, short-term stress" },
  { id: "rehbar_funding_history",roman: "IV",  title: "REHBAR FUNDING HISTORY",                              short: "Funding History",   desc: "Historical funding to client / Non-Rehbar history for new clients" },
  { id: "historical_financial", roman: "V",    title: "HISTORICAL FINANCIAL ANALYSIS (3Y)",                  short: "Financials",        desc: "P&L YoY, BS YoY (reconstructed if needed), qualitative observations" },
  { id: "projections",          roman: "VI",   title: "PROJECTIONS & ESTIMATES",                             short: "Projections",       desc: "P&L and BS projections (3Y), assumption justification" },
  { id: "key_ratios",           roman: "VII",  title: "KEY FINANCIAL RATIOS",                                short: "Key Ratios",        desc: "Liquidity, Leverage, Efficiency, Profitability, Coverage — historical & projected" },
  { id: "cash_flow",            roman: "VIII", title: "CASH FLOW STATEMENT",                                 short: "Cash Flow",         desc: "Operating, investing, financing analysis for repayment capacity" },
  { id: "due_diligence",        roman: "IX",   title: "DUE DILIGENCE EXCERPTS",                              short: "Due Diligence",     desc: "External DD findings (mandatory for Pvt Ltd/Ltd), stakeholder interviews" },
  { id: "risk_assessment",      roman: "X",    title: "RISK ASSESSMENT & MITIGATION",                        short: "Risk Assessment",   desc: "Business, industry, financial, transaction risks + mitigants" },
  { id: "visit_reference",      roman: "XI",   title: "VISIT REPORT & EXEC RECOMMENDATION",                  short: "Visit Report",      desc: "Site visit, reference checks (vendors, bankers, customers), exec recommendation" },
  { id: "product_specifics",    roman: "XII",  title: "SPECIFIC PRODUCT REQUIREMENTS & EXEMPTIONS",          short: "Product Reqs",      desc: "Product-rule application (PF/TF projections, PLS reporting, HL FOIR/LTV, etc.)" },
  { id: "triangulation_analysis", roman: "XIII", title: "TRIANGULATION ANALYSIS (GST × BSA × ITR)",           short: "Triangulation",     desc: "Accumn cross-source verification: profile match/mismatch, financial summary cross-check, customer/supplier concentration, circular/related party transactions. AI feedback on data quality and key flags." },
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
  // Profitability
  revenue_growth: "Revenue Growth (%)",
  ebitda_margin: "EBITDA Margins (%)",
  ebt_margin: "EBT Margins (%)",
  net_profit_margin: "PAT Margins (%)",
  roe: "Return on Equity (%)",
  return_on_fixed_assets: "Return on Fixed Assets (%)",
  roce: "Return on Capital Employed (%)",
  gross_margin: "Gross Profit Margin (%)",
  roa: "Return on Assets (%)",
  // Liquidity
  current_ratio: "Current Ratio",
  quick_ratio: "Quick Ratio",
  cash_ratio: "Cash Ratio",
  working_capital: "Working Capital",
  // Solvency
  interest_coverage: "Interest Coverage Ratio",
  lt_debt_to_equity: "Long-term Debt / Equity",
  total_assets_to_equity: "Total Assets / Equity",
  debt_to_equity: "Total Debt / Equity",
  debt_to_assets: "Total Debt / Total Assets",
  debt_to_ebitda: "Total Debt / EBITDA",
  total_liab_to_networth: "Total Liab / Net Worth",
  // Coverage
  dscr: "DSCR",
  // Efficiency / Turnover
  fixed_assets_turnover: "Fixed Assets Turnover",
  asset_turnover: "Total Asset Turnover",
  working_capital_turnover: "Working Capital Turnover",
  inventory_days: "Inventory Days",
  debtor_days: "Receivables Days*",
  creditor_days: "Payable Days*",
  cash_conversion_cycle: "Cash Conversion Cycle*",
  inventory_turnover: "Inventory Turnover",
  receivables_turnover: "Receivables Turnover",
  capital_employed_turnover: "Cap Employed Turnover",
  // Expenses
  raw_material_pct: "Raw Material Consumption (% of Sales)",
  employee_cost_pct: "Total Employee Cost (% of Sales)",
  finance_cost_pct: "Finance Cost (% of Sales)",
  other_expenses_pct: "Total Other Expenses (% of Sales)",
  // Return
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
  "gross_margin", "ebitda_margin", "ebt_margin", "net_profit_margin",
  "roa", "roe", "roce", "roic", "ronw",
  "revenue_growth", "return_on_fixed_assets",
  "raw_material_pct", "employee_cost_pct", "finance_cost_pct", "other_expenses_pct",
]);
const DAYS_RATIOS = new Set([
  "debtor_days", "creditor_days", "inventory_days", "cash_conversion_cycle",
]);
const R_SCORE_RATIOS = new Set([
  "r_score_composite", "r_score_wc_ta", "r_score_re_ta", "r_score_ebitda_ta", "r_score_equity_ol",
]);

export function formatRatio(name: string, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (DAYS_RATIOS.has(name)) return Math.round(value).toLocaleString("en-IN");
  if (name === "working_capital") return value.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  if (PCT_RATIOS.has(name)) return (value * 100).toFixed(2) + "%";
  if (R_SCORE_RATIOS.has(name)) return value.toFixed(2);
  return value.toFixed(2) + "x";
}
