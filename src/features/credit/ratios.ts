/**
 * Pure-TS ratio computation engine.
 * Reads confirmed financials (P&L + Balance Sheet) and emits ratios.
 * No AI involvement — deterministic per Rehbar Finance standardisation.
 *
 * DSCR formula is fixed by Finance team per BRD business rule:
 *   (PAT + Depreciation + Interest) / (Interest + Principal Repayment)
 */

import { ThresholdStatus } from "./domain";

export interface LineItem {
  label: string;
  value: number | null;
  confidence: number;
  reviewed: boolean;
  override_value?: number | null;
  note?: string;
}

export interface YearFinancials {
  fiscal_year: number;
  pl: Record<string, number | null>;
  bs: Record<string, number | null>;
  cf?: Record<string, number | null>;
}

export interface RatioRow {
  fiscal_year: number;
  category: string;
  ratio_name: string;
  ratio_value: number | null;
  benchmark: number | null;
  threshold_status: ThresholdStatus;
  formula_note: string;
}

export interface RatioThreshold {
  ratio_name: string;
  category: string;
  green_min: number | null;
  amber_min: number | null;
  peer_median: number | null;
  higher_is_better: boolean;
  formula_note: string | null;
}

/**
 * Resolve a confirmed value: prefer override, fall back to extracted value.
 */
export function resolveValue(item: LineItem | undefined): number | null {
  if (!item) return null;
  if (item.override_value !== undefined && item.override_value !== null) {
    return item.override_value;
  }
  return item.value;
}

/**
 * Build a flat dict from the line_items JSON of an extracted_financials row.
 */
export function lineItemsToDict(items: LineItem[]): Record<string, number | null> {
  const dict: Record<string, number | null> = {};
  for (const item of items) {
    dict[item.label] = resolveValue(item);
  }
  return dict;
}

const safe = (n: number | null | undefined): number | null =>
  n === null || n === undefined || !Number.isFinite(n) ? null : n;

const div = (num: number | null, den: number | null): number | null => {
  const n = safe(num);
  const d = safe(den);
  if (n === null || d === null || d === 0) return null;
  return n / d;
};

/**
 * Apply traffic-light thresholds.
 * higher_is_better=true:  >= green_min → green; >= amber_min → amber; else red
 * higher_is_better=false: <= green_min → green; <= amber_min → amber; else red
 * Negative denominators in source flagged 'amber' (review required) per BRD edge cases.
 */
export function applyThreshold(
  value: number | null,
  threshold: RatioThreshold | undefined,
  reviewRequired = false,
): ThresholdStatus {
  if (value === null || !threshold) return "na";
  if (reviewRequired) return "amber";
  const { green_min, amber_min, higher_is_better } = threshold;
  if (green_min === null || amber_min === null) return "na";

  if (higher_is_better) {
    if (value >= green_min) return "green";
    if (value >= amber_min) return "amber";
    return "red";
  } else {
    if (value <= green_min) return "green";
    if (value <= amber_min) return "amber";
    return "red";
  }
}

/**
 * Compute all ratios for one fiscal year.
 * `principalRepayment` is a deal-level input (we approximate from deal_amount/tenure unless overridden).
 */
export function computeYearRatios(
  fy: YearFinancials,
  thresholds: Record<string, RatioThreshold>,
  principalRepayment: number = 0,
): RatioRow[] {
  const pl = fy.pl;
  const bs = fy.bs;

  // Equity / leverage
  const networth = safe(bs["Net Worth"]);
  const negativeEquity = networth !== null && networth < 0;
  const totalDebt = safe(bs["Total Debt"]);
  const totalAssets = safe(bs["Total Assets"]);
  const totalLiab = safe(bs["Total Liabilities"]);
  const capEmployed = safe(bs["Capital Employed"]);

  // Liquidity
  const currentAssets = safe(bs["Current Assets"]);
  const currentLiab = safe(bs["Current Liabilities"]);
  const inventory = safe(bs["Inventory"]) ?? 0;
  const cash = safe(bs["Cash & Bank"]);
  const debtors = safe(bs["Trade Receivables"]);
  const creditors = safe(bs["Trade Payables"]);

  // P&L
  const turnover = safe(pl["Turnover"]);
  const cogs = safe(pl["Cost of Goods Sold"]);
  const grossProfit = safe(pl["Gross Profit"]);
  const ebitda = safe(pl["EBITDA"]);
  const depreciation = safe(pl["Depreciation"]) ?? 0;
  const ebit = safe(pl["EBIT"]);
  const interest = safe(pl["Interest Expense"]) ?? 0;
  const pat = safe(pl["PAT"]);

  const out: Array<Omit<RatioRow, "benchmark" | "threshold_status">> = [
    {
      fiscal_year: fy.fiscal_year,
      category: "liquidity",
      ratio_name: "current_ratio",
      ratio_value: div(currentAssets, currentLiab),
      formula_note: "Current Assets / Current Liabilities",
    },
    {
      fiscal_year: fy.fiscal_year,
      category: "liquidity",
      ratio_name: "quick_ratio",
      ratio_value: div(
        currentAssets !== null ? currentAssets - inventory : null,
        currentLiab,
      ),
      formula_note: "(Current Assets - Inventory) / Current Liabilities",
    },
    {
      fiscal_year: fy.fiscal_year,
      category: "liquidity",
      ratio_name: "cash_ratio",
      ratio_value: div(cash, currentLiab),
      formula_note: "Cash / Current Liabilities",
    },
    {
      fiscal_year: fy.fiscal_year,
      category: "liquidity",
      ratio_name: "working_capital",
      ratio_value:
        currentAssets !== null && currentLiab !== null ? currentAssets - currentLiab : null,
      formula_note: "Current Assets - Current Liabilities",
    },
    {
      fiscal_year: fy.fiscal_year,
      category: "leverage",
      ratio_name: "debt_to_equity",
      ratio_value: negativeEquity ? null : div(totalDebt, networth),
      formula_note: "Total Debt / Net Worth",
    },
    {
      fiscal_year: fy.fiscal_year,
      category: "leverage",
      ratio_name: "total_liab_to_networth",
      ratio_value: negativeEquity ? null : div(totalLiab, networth),
      formula_note: "Total Liabilities / Net Worth",
    },
    {
      fiscal_year: fy.fiscal_year,
      category: "leverage",
      ratio_name: "interest_coverage",
      ratio_value: div(ebit, interest || null),
      formula_note: "EBIT / Interest Expense",
    },
    {
      fiscal_year: fy.fiscal_year,
      category: "coverage",
      ratio_name: "dscr",
      ratio_value: div(
        (pat ?? 0) + depreciation + interest,
        interest + (principalRepayment || 0) || null,
      ),
      formula_note:
        "STANDARDISED (Finance): (PAT + Depreciation + Interest) / (Interest + Principal Repayment)",
    },
    {
      fiscal_year: fy.fiscal_year,
      category: "efficiency",
      ratio_name: "asset_turnover",
      ratio_value: div(turnover, totalAssets),
      formula_note: "Turnover / Total Assets",
    },
    {
      fiscal_year: fy.fiscal_year,
      category: "efficiency",
      ratio_name: "capital_employed_turnover",
      ratio_value: div(turnover, capEmployed),
      formula_note: "Turnover / Capital Employed",
    },
    {
      fiscal_year: fy.fiscal_year,
      category: "efficiency",
      ratio_name: "debtor_days",
      ratio_value:
        debtors !== null && turnover ? (debtors / turnover) * 365 : null,
      formula_note: "(Debtors / Turnover) × 365",
    },
    {
      fiscal_year: fy.fiscal_year,
      category: "efficiency",
      ratio_name: "creditor_days",
      ratio_value:
        creditors !== null && cogs ? (creditors / cogs) * 365 : null,
      formula_note: "(Creditors / COGS) × 365",
    },
    {
      fiscal_year: fy.fiscal_year,
      category: "efficiency",
      ratio_name: "inventory_turnover",
      ratio_value: div(cogs, inventory || null),
      formula_note: "COGS / Inventory",
    },
    {
      fiscal_year: fy.fiscal_year,
      category: "profitability",
      ratio_name: "gross_margin",
      ratio_value: div(grossProfit, turnover),
      formula_note: "Gross Profit / Turnover",
    },
    {
      fiscal_year: fy.fiscal_year,
      category: "profitability",
      ratio_name: "ebitda_margin",
      ratio_value: div(ebitda, turnover),
      formula_note: "EBITDA / Turnover",
    },
    {
      fiscal_year: fy.fiscal_year,
      category: "profitability",
      ratio_name: "pat_margin",
      ratio_value: div(pat, turnover),
      formula_note: "PAT / Turnover",
    },
    {
      fiscal_year: fy.fiscal_year,
      category: "profitability",
      ratio_name: "roe",
      ratio_value: negativeEquity ? null : div(pat, networth),
      formula_note: "PAT / Net Worth",
    },
    {
      fiscal_year: fy.fiscal_year,
      category: "profitability",
      ratio_name: "roce",
      ratio_value: div(ebit, capEmployed),
      formula_note: "EBIT / Capital Employed",
    },
  ];

  return out.map((r) => {
    const threshold = thresholds[r.ratio_name];
    return {
      ...r,
      benchmark: threshold?.peer_median ?? null,
      threshold_status: applyThreshold(
        r.ratio_value,
        threshold,
        negativeEquity && ["debt_to_equity", "total_liab_to_networth", "roe"].includes(r.ratio_name),
      ),
    };
  });
}
