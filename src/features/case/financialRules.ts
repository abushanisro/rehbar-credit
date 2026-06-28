import type { LineItem } from "./types";

// Each rule: [target, addComponents[], subtractComponents[]]
// Order matters — upstream totals must be computed before downstream ones.
type Rule = [string, string[], string[]?];

export const RULES: Record<string, Rule[]> = {
  balance_sheet: [
    // ── Simple / AI-extracted format ──
    ["Current Assets",      ["Inventory","Trade Receivables","Cash & Bank","Other Current Assets"]],
    ["Total Assets",        ["Fixed Assets (Net)","Current Assets"]],
    ["Net Worth",           ["Share Capital","Reserves & Surplus"]],
    ["Total Debt",          ["Long Term Borrowings","Short Term Borrowings"]],
    ["Current Liabilities", ["Trade Payables","Other Current Liabilities"]],
    ["Total Liabilities",   ["Net Worth","Total Debt","Current Liabilities"]],
    ["Capital Employed",    ["Net Worth","Total Debt"]],

    // ── Full Accumn / Corpository Excel format ──
    // Liabilities side (dependencies first)
    ["Networth",                   ["Share Capital","Reserves & Surplus","Money Received against Warrants","Share Application Money Pending Allotment","Deffered Government Grants","Minority Interest"]],
    ["Total Non Current Liabilities", ["Long-term Borrowings","Deferred Tax Liabilities","Other Non Current Liabilities","Long-term Provisions"]],
    ["Total Current Liabilities",  ["Total Short-term Borrowings","Short-term Borrowings","Trade Payables","Other Current Liabilities","Short-term Provisions"]],
    ["Total Equity & Liabilities", ["Networth","Total Non Current Liabilities","Total Current Liabilities","Other Equity & Liabilities"]],

    // Asset side
    ["Net Block of Assets",        ["Tangible Assets","Intangible Assets"]],
    ["Total Fixed Asset",          ["Net Block of Assets","Capital Work in Progress","Intangible Asset under Development"]],
    ["Total Non Current Assets",   ["Total Fixed Asset","Non Current Investment","Deferred Tax Assets (Net)","Long-term Loans & Advances","Other Non Current Assets"]],
    ["Total Current Assets",       ["Current Investment","Inventories","Trade Receivables","Cash & Cash Equivalents","Short-term Loans & Advances","Other Current Assets"]],
    ["TOTAL ASSETS",               ["Total Non Current Assets","Total Current Assets","Other Total Assets"]],

    // ── Canonical labels for ratio engine ──
    ["Net Worth",           ["Networth"]],
    ["Current Assets",      ["Total Current Assets"]],
    ["Current Liabilities", ["Total Current Liabilities"]],
    ["Fixed Assets (Net)",  ["Total Fixed Asset"]],
    ["Total Assets",        ["TOTAL ASSETS"]],
    ["Long Term Borrowings",["Long-term Borrowings"]],
    ["Short Term Borrowings",["Total Short-term Borrowings","Short-term Borrowings"]],
    ["Inventory",           ["Inventories"]],
    ["Cash & Bank",         ["Cash & Cash Equivalents"]],
    ["Total Debt",          ["Long Term Borrowings","Short Term Borrowings"]],
    ["Capital Employed",    ["Net Worth","Total Debt"]],
    ["Total Liabilities",   ["Net Worth","Total Debt","Current Liabilities"]],
  ],

  profit_loss: [
    // Revenue build-up
    ["Gross Sales",                   ["Revenue from Sale of Products","Revenue from Sale of Services","Other Operating Revenues"]],
    ["Total Revenue from Operations", ["Gross Sales"], ["Less:Duties"]],
    ["Total Revenue",                 ["Total Revenue from Operations","Other Income"]],
    // Canonical "Turnover" for ratio engine
    ["Turnover",                      ["Total Revenue from Operations"]],

    // EBITDA = Revenue from Ops - operating costs
    ["EBITDA", ["Total Revenue from Operations"],
               ["Cost of Materials Consumed","Purchases of Stock in Trade",
                "Changes in Inventories of Finished Goods, Work In Progress and Stock In Trade",
                "Total Employee Benefit Expense","Total Other Expenses"]],

    // Total Expenses (all costs incl finance & depreciation)
    ["Total Expenses", ["Cost of Materials Consumed","Purchases of Stock in Trade",
                        "Changes in Inventories of Finished Goods, Work In Progress and Stock In Trade",
                        "Total Employee Benefit Expense","Total Other Expenses",
                        "Finance Costs","Total Depreciation, Depletion and Amortization Expense"]],

    // Profit cascade
    ["Profit before Exceptional and Extraordinary Items and Tax", ["Total Revenue"], ["Total Expenses"]],
    ["Profit before Extraordinary Items and Tax",
      ["Profit before Exceptional and Extraordinary Items and Tax","Prior Period Items before Tax","Exceptional Items"]],
    ["Profit before Tax",
      ["Profit before Extraordinary Items and Tax","Extraordinary Items"]],
    ["Profit/(Loss) for the Period from Continuing Operations",
      ["Profit before Tax"], ["Current Tax","Deferred Tax",
       "Net Movement in Regulatory Deferral Account Balances related to Profit or Loss and the Related Deferred Tax Movement"]],
    ["Profit/(Loss)",
      ["Profit/(Loss) for the Period from Continuing Operations",
       "Profit/(Loss) from Discontinuing Operations (After Tax)"]],
    // Canonical labels for ratio engine
    ["PAT",               ["Profit/(Loss)"]],
    ["Interest Expense",  ["Finance Costs"]],
    ["Depreciation",      ["Total Depreciation, Depletion and Amortization Expense"]],
    ["Employee Benefit Expense", ["Total Employee Benefit Expense"]],
    ["Other Expenses",    ["Total Other Expenses"]],
    // EBIT = PBT + Interest
    ["EBIT",              ["Profit before Tax","Finance Costs"]],
    ["Gross Profit",      ["Total Revenue from Operations"],
                          ["Cost of Materials Consumed","Purchases of Stock in Trade",
                           "Changes in Inventories of Finished Goods, Work In Progress and Stock In Trade"]],
  ],

  cash_flow: [
    // Net increase in cash = operating + investing + financing
    ["Net increase (decrease) in cash and cash equivalents before effect of exchange rate changes",
      ["Net cash flows from (used in) operating activities",
       "Net cash flows from (used in) investing activities",
       "Net cash flows from (used in) financing activities"]],
    ["Net increase (decrease) in cash and cash equivalents",
      ["Net increase (decrease) in cash and cash equivalents before effect of exchange rate changes",
       "Effect of exchange rate changes on cash and cash equivalents"]],
    // Closing balance
    ["Cash and cash equivalents cash flow statement at end of period",
      ["Cash and cash equivalents cash flow statement at beginning of period",
       "Net increase (decrease) in cash and cash equivalents"]],
  ],
};

// All computed/total labels across all statement types
export const COMPUTED_LABELS = new Set(
  Object.values(RULES).flat().map(([label]) => label)
);

// Grand-total rows — strongest visual emphasis
export const GRAND_TOTAL_LABELS = new Set([
  "TOTAL ASSETS","Total Assets","Total Equity & Liabilities","Total Liabilities",
  "Profit/(Loss)","Profit before Tax","Total Revenue","EBITDA",
  "Net increase (decrease) in cash and cash equivalents",
  "Net increase (decrease) in cash and cash equivalents before effect of exchange rate changes",
  "Cash and cash equivalents cash flow statement at end of period",
]);

// Section header name → the key total row that represents its value
export const SECTION_TOTAL_MAP: Record<string, string> = {
  "SHAREHOLDERS FUND":              "Networth",
  "NON CURRENT LIABILITIES":        "Total Non Current Liabilities",
  "CURRENT LIABILITIES":            "Total Current Liabilities",
  "FIXED ASSET":                    "Total Fixed Asset",
  "NON CURRENT ASSETS":             "Total Non Current Assets",
  "CURRENT ASSETS":                 "Total Current Assets",
  "REVENUE":                        "Total Revenue",
  "EXPENSES":                       "Total Expenses",
  "TAX EXPENSE":                    "Profit/(Loss) for the Period from Continuing Operations",
  "Cash flows from used in operating activities":  "Net cash flows from (used in) operating activities",
  "Cash flows from used in investing activities":  "Net cash flows from (used in) investing activities",
  "Cash flows from used in financing activities":  "Net cash flows from (used in) financing activities",
};

// Aggregate label → bold row highlight (kept for backward compat)
export const BS_TOTAL_LABELS = new Set(COMPUTED_LABELS);

export function applyStatementRules(items: LineItem[], stmtType: string): LineItem[] {
  const rules = RULES[stmtType];
  if (!rules) return items;

  const result = items.map(i => ({ ...i }));

  const get = (label: string): number => {
    const it = result.find(i => i.label === label);
    return it != null ? (it.override_value ?? it.value ?? 0) : 0;
  };

  for (const [target, addCols, subCols = []] of rules) {
    // Skip if no component has data yet (avoids zeroing out rows with no data)
    const allCols = [...addCols, ...subCols];
    const hasData = allCols.some(c => result.some(i => i.label === c && (i.override_value ?? i.value) != null));
    if (!hasData) continue;

    const sum = addCols.reduce((acc, c) => acc + get(c), 0)
              - subCols.reduce((acc, c) => acc + get(c), 0);

    const idx = result.findIndex(i => i.label === target);
    if (idx === -1) {
      // Create the computed row if it doesn't exist yet
      result.push({ label: target, value: parseFloat(sum.toFixed(2)), override_value: null, confidence: 100, reviewed: true, note: "auto-derived" });
    } else {
      result[idx] = { ...result[idx], override_value: parseFloat(sum.toFixed(2)) };
    }
  }
  return result;
}
