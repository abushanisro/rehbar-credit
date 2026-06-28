// Rehbar — Compute Ratios (BRD §CAS-MH-02)
// Pure-deterministic ratio engine. No AI involvement.
// DSCR formula fixed by Finance team (not analyst-overridable).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleOptions } from "../_shared/cors.ts";

type LineItem = {
  label: string;
  value: number | null;
  confidence: number;
  override_value?: number | null;
};

const safe = (n: number | null | undefined): number | null =>
  n === null || n === undefined || !Number.isFinite(n) ? null : Number(n);

const div = (n: number | null, d: number | null): number | null => {
  const a = safe(n), b = safe(d);
  if (a === null || b === null || b === 0) return null;
  return a / b;
};

const resolve = (it?: LineItem): number | null => {
  if (!it) return null;
  if (it.override_value !== undefined && it.override_value !== null) return it.override_value;
  return it.value;
};

const toDict = (items: LineItem[] | null | undefined): Record<string, number | null> => {
  const d: Record<string, number | null> = {};
  for (const it of items ?? []) d[it.label] = resolve(it);
  return d;
};

/**
 * Normalize label variants and derive missing computed fields so the ratio
 * engine always sees consistent key names regardless of whether data came
 * from AI extraction, manual entry, or Accumn/Corpository Excel.
 */
function normalizeFinancials(
  pl: Record<string, number|null>,
  bs: Record<string, number|null>,
): { pl: Record<string, number|null>; bs: Record<string, number|null> } {
  const p = { ...pl };
  const b = { ...bs };

  // ── Balance Sheet aliases ──────────────────────────────────────────────────
  const bsAliases: [string, string[]][] = [
    ["Net Worth",            ["Networth","Net worth","NET WORTH","Shareholders Equity","Total Equity","Shareholders' Funds","Total Shareholders Funds"]],
    ["Total Assets",         ["TOTAL ASSETS","Total Asset","Total Assets (Net)"]],
    ["Current Assets",       ["Total Current Assets","CURRENT ASSETS","Total current assets"]],
    ["Current Liabilities",  ["Total Current Liabilities","CURRENT LIABILITIES","Total current liabilities"]],
    ["Fixed Assets (Net)",   ["Total Fixed Asset","Net Fixed Assets","Net Block","Net Block of Assets","Total Tangible Assets (Net)","Property Plant and Equipment (Net)"]],
    ["Long Term Borrowings", ["Long-term Borrowings","Long-Term Borrowings","LONG TERM BORROWINGS","Non-current Borrowings"]],
    ["Short Term Borrowings",["Total Short-term Borrowings","Short-term Borrowings","SHORT TERM BORROWINGS","Current Borrowings","Current Maturities of Long Term Debt"]],
    ["Inventory",            ["Inventories","INVENTORIES","Stock","Stocks"]],
    ["Cash & Bank",          ["Cash & Cash Equivalents","Cash and Cash Equivalents","CASH & CASH EQUIVALENTS","Cash and Bank","Cash & Bank Balances"]],
    ["Trade Receivables",    ["Trade and Other Receivables","Debtors","Trade Debtors","TRADE RECEIVABLES","Accounts Receivable","Sundry Debtors"]],
    ["Trade Payables",       ["Creditors","Trade Creditors","TRADE PAYABLES","Accounts Payable","Sundry Creditors"]],
    ["Reserves & Surplus",   ["Reserves & Surplus","Reserves and Surplus","Other Equity","Retained Earnings"]],
    ["Capital Employed",     ["Capital Employed"]],
  ];
  for (const [target, sources] of bsAliases) {
    if (b[target] == null) {
      for (const src of sources) {
        if (b[src] != null) { b[target] = b[src]; break; }
      }
    }
  }

  // ── BS: Derived computations ───────────────────────────────────────────────
  if (b["Total Debt"] == null) {
    const lt = safe(b["Long Term Borrowings"]);
    const st = safe(b["Short Term Borrowings"]);
    if (lt != null || st != null) b["Total Debt"] = (lt ?? 0) + (st ?? 0);
  }
  if (b["Capital Employed"] == null) {
    const nw = safe(b["Net Worth"]);
    const td = safe(b["Total Debt"]);
    if (nw != null && td != null) b["Capital Employed"] = nw + td;
  }
  if (b["Total Assets"] == null) {
    const fa = safe(b["Fixed Assets (Net)"]);
    const ca = safe(b["Current Assets"]);
    if (fa != null && ca != null) b["Total Assets"] = fa + ca;
  }
  if (b["Total Liabilities"] == null) {
    const ta = safe(b["Total Assets"]);
    const nw = safe(b["Net Worth"]);
    if (ta != null && nw != null) b["Total Liabilities"] = ta - nw;
  }

  // ── P&L aliases ────────────────────────────────────────────────────────────
  const plAliases: [string, string[]][] = [
    ["Turnover",                 ["Total Revenue from Operations","Net Revenue from Operations","Revenue from Operations","Net Sales","Revenue","Total Revenue","Gross Sales","Net Turnover"]],
    ["Interest Expense",         ["Finance Costs","Finance Cost","FINANCE COSTS","Interest & Finance Charges","Financial Charges","Borrowing Costs","Interest Cost","Interest and Finance Cost"]],
    ["PAT",                      ["Profit/(Loss)","Profit for the Year","Net Profit","NET PROFIT","Profit After Tax","Net Profit/(Loss)","Profit for the period","Net Income"]],
    ["Profit Before Tax",        ["Profit before Tax","PBT","Profit Before Taxation","Profit/(Loss) before Tax","Profit before Exceptional and Extraordinary Items and Tax","Profit before Extraordinary Items and Tax"]],
    ["EBITDA",                   ["EBITDA","Earnings Before Interest Tax Depreciation Amortization"]],
    ["Depreciation",             ["Total Depreciation, Depletion and Amortization Expense","Depreciation & Amortization","Depreciation and Amortization","Depreciation, Depletion and Amortization","D&A"]],
    ["Employee Benefit Expense", ["Total Employee Benefit Expense","Employee Benefits Expense","Employee Benefits","Personnel Expenses","Staff Cost","Staff Costs","Employee Costs"]],
    ["Other Expenses",           ["Total Other Expenses","Other Operating Expenses","Other Expenses (Net)","Miscellaneous Expenses"]],
    ["Cost of Goods Sold",       ["Cost of Material Consumed","Total Cost of Materials","Purchase of Stock in Trade","COGS","Direct Costs","Cost of Production"]],
    ["Cost of Materials Consumed",["Cost of Material Consumed","Raw Material Consumed","Material Cost"]],
    ["Gross Profit",             ["Gross Margin","Gross Profit/(Loss)"]],
  ];
  for (const [target, sources] of plAliases) {
    if (p[target] == null) {
      for (const src of sources) {
        if (p[src] != null) { p[target] = p[src]; break; }
      }
    }
  }

  // ── P&L: Derived computations ──────────────────────────────────────────────
  // EBIT = EBITDA − Depreciation (operating, preferred over PBT+Interest to exclude Other Income)
  if (p["EBIT"] == null) {
    const ebitda_ = safe(p["EBITDA"]);
    const dep_    = safe(p["Depreciation"]) ?? 0;
    if (ebitda_ != null) p["EBIT"] = ebitda_ - dep_;
    else {
      const pbt  = safe(p["Profit Before Tax"]);
      const int_ = safe(p["Interest Expense"]);
      if (pbt != null && int_ != null) p["EBIT"] = pbt + int_;
    }
  }
  // EBITDA = EBIT + Depreciation
  if (p["EBITDA"] == null && p["EBIT"] != null) {
    p["EBITDA"] = (safe(p["EBIT"]) ?? 0) + (safe(p["Depreciation"]) ?? 0);
  }
  // Gross Profit = Turnover - COGS
  if (p["Gross Profit"] == null && p["Turnover"] != null && p["Cost of Goods Sold"] != null) {
    p["Gross Profit"] = (safe(p["Turnover"]) ?? 0) - (safe(p["Cost of Goods Sold"]) ?? 0);
  }
  // Cost of Goods Sold fallback from Cost of Materials Consumed
  if (p["Cost of Goods Sold"] == null && p["Cost of Materials Consumed"] != null) {
    p["Cost of Goods Sold"] = p["Cost of Materials Consumed"];
  }

  return { pl: p, bs: b };
}

function applyThreshold(value: number | null, t: { green_min: number | null; amber_min: number | null; higher_is_better: boolean } | undefined, reviewRequired = false): "green"|"amber"|"red"|"na" {
  if (value === null || !t) return "na";
  if (reviewRequired) return "amber";
  const { green_min, amber_min, higher_is_better } = t;
  if (green_min === null || amber_min === null) return "na";
  if (higher_is_better) {
    if (value >= green_min) return "green";
    if (value >= amber_min) return "amber";
    return "red";
  }
  if (value <= green_min) return "green";
  if (value <= amber_min) return "amber";
  return "red";
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  const cors = getCorsHeaders(req);
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
    const { case_id } = await req.json();
    if (!case_id) return new Response(JSON.stringify({ error: "case_id required" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });

    const { data: cc, error: ccErr } = await supabase.from("credit_cases").select("*").eq("id", case_id).single();
    if (ccErr || !cc) return new Response(JSON.stringify({ error: "Case not found" }), {
      status: 404, headers: { ...cors, "Content-Type": "application/json" },
    });

    const { data: financials } = await supabase.from("extracted_financials").select("*").eq("case_id", case_id);

    // Fetch default thresholds + industry-specific overrides in one query
    const industry = cc.industry ?? "default";
    const { data: thresholds } = await supabase
      .from("ratio_thresholds")
      .select("*")
      .in("industry", ["default", industry]);

    const tMap: Record<string, { green_min: number | null; amber_min: number | null; peer_median: number | null; higher_is_better: boolean; formula_note: string | null }> = {};
    // Load defaults first, then overwrite with industry-specific values
    for (const t of (thresholds ?? []).filter((t) => t.industry === "default")) tMap[t.ratio_name] = t;
    if (industry !== "default") {
      for (const t of (thresholds ?? []).filter((t) => t.industry === industry)) tMap[t.ratio_name] = t;
    }

    // Group by year (historical + projections from extracted_financials)
    const yearMap = new Map<number, { pl: Record<string, number|null>; bs: Record<string, number|null>; cf: Record<string, number|null> }>();
    for (const f of financials ?? []) {
      const y = yearMap.get(f.fiscal_year) ?? { pl: {}, bs: {}, cf: {} };
      const dict = toDict(f.line_items as unknown as LineItem[]);
      if (f.statement_type === "profit_loss") y.pl = { ...y.pl, ...dict };
      if (f.statement_type === "balance_sheet") y.bs = { ...y.bs, ...dict };
      if (f.statement_type === "cash_flow") y.cf = { ...y.cf, ...dict };
      if (f.statement_type === "projections") {
        // Strip "Projected " prefix so normalizeFinancials sees canonical names
        const stripped: Record<string, number|null> = {};
        for (const [k, v] of Object.entries(dict)) stripped[k.replace(/^Projected\s+/i, "")] = v;
        y.pl = { ...y.pl, ...stripped };
        y.bs = { ...y.bs, ...stripped };
      }
      yearMap.set(f.fiscal_year, y);
    }

    // Add provisional periods from ic_note (annualize P&L flow items; BS is point-in-time)
    type ProvPeriod = { fiscal_year: number; months_covered: number; pl: LineItem[]; bs: LineItem[]; cf: LineItem[] };
    const provisional = (((cc.ic_note as Record<string, unknown>)?.provisional) ?? []) as ProvPeriod[];
    // Sort ascending by months_covered so the most complete period for a FY wins
    const provSorted = [...provisional].sort((a, b) => (a.months_covered ?? 12) - (b.months_covered ?? 12));
    for (const period of provSorted) {
      const fy = period.fiscal_year;
      if (!fy) continue;
      const mult = (period.months_covered ?? 12) > 0 ? 12 / (period.months_covered ?? 12) : 1;
      const existing = yearMap.get(fy) ?? { pl: {}, bs: {}, cf: {} };
      const provPl = toDict(period.pl);
      const annualPl: Record<string, number|null> = {};
      for (const [k, v] of Object.entries(provPl)) annualPl[k] = v !== null ? v * mult : null;
      yearMap.set(fy, {
        pl: { ...existing.pl, ...annualPl },
        bs: { ...existing.bs, ...toDict(period.bs) },
        cf: existing.cf,
      });
    }

    if (yearMap.size === 0) {
      return new Response(JSON.stringify({ error: "No financials found" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Estimate principal repayment per year from deal terms
    const principalPerYear =
      cc.deal_amount && cc.tenure_months ? Number(cc.deal_amount) / (Number(cc.tenure_months) / 12) : 0;

    // Wipe existing ratios for this case
    await supabase.from("financial_ratios").delete().eq("case_id", case_id);

    const rows: Array<{ case_id: string; user_id: string; fiscal_year: number; category: string; ratio_name: string; ratio_value: number | null; benchmark: number | null; threshold_status: string; formula_note: string }> = [];

    const sortedYears = Array.from(yearMap.entries()).sort((a, b) => a[0] - b[0]);
    let prevTurnover: number | null = null;

    for (const [fy, fin] of sortedYears) {
      const { pl, bs } = normalizeFinancials(fin.pl, fin.bs);
      const networth = safe(bs["Net Worth"]);
      const negEq = networth !== null && networth < 0;
      const totalDebt = safe(bs["Total Debt"]);
      const totalAssets = safe(bs["Total Assets"]);
      const totalLiab = safe(bs["Total Liabilities"]);
      const capEmployed = safe(bs["Capital Employed"]);
      const ca = safe(bs["Current Assets"]);
      const cl = safe(bs["Current Liabilities"]);
      const inv = safe(bs["Inventory"]) ?? 0;
      const cash = safe(bs["Cash & Bank"]);
      const debtors = safe(bs["Trade Receivables"]);
      const creditors = safe(bs["Trade Payables"]);
      const reservesSurplus = safe(bs["Reserves & Surplus"]);
      const ltBorrowings = safe(bs["Long Term Borrowings"]);
      const fixedAssets = safe(bs["Fixed Assets (Net)"]);
      const turnover = safe(pl["Turnover"]);
      const cogs = safe(pl["Cost of Goods Sold"]);
      const grossProfit = safe(pl["Gross Profit"]);
      const ebitda = safe(pl["EBITDA"]);
      const dep = safe(pl["Depreciation"]) ?? 0;
      const ebit = safe(pl["EBIT"]);
      const interest = safe(pl["Interest Expense"]) ?? 0;
      const pat = safe(pl["PAT"]);
      const pbt = safe(pl["Profit Before Tax"]);
      const empCost = safe(pl["Employee Benefit Expense"]);
      const otherExp = safe(pl["Other Expenses"]);
      const rawMat = safe(pl["Cost of Materials Consumed"]);

      // R' Score components (Rehbar's modified Altman model)
      const wc = ca !== null && cl !== null ? ca - cl : null;
      const outsideLiab = totalAssets !== null && networth !== null ? totalAssets - networth : null;
      const rsWcTa   = wc !== null && totalAssets !== null && totalAssets !== 0 ? wc / totalAssets : null;
      const rsReTa   = reservesSurplus !== null && totalAssets !== null && totalAssets !== 0 ? reservesSurplus / totalAssets : null;
      const rsEbitdaTa = ebitda !== null && totalAssets !== null && totalAssets !== 0 ? ebitda / totalAssets : null;
      const rsEquityOl = networth !== null && outsideLiab !== null && outsideLiab !== 0 ? networth / outsideLiab : null;
      const rsComposite =
        rsWcTa !== null && rsReTa !== null && rsEbitdaTa !== null && rsEquityOl !== null
          ? 6 * rsWcTa + 3 * rsReTa + 7 * rsEbitdaTa + rsEquityOl
          : null;

      // Cross-year growth
      const revenueGrowth = prevTurnover !== null && prevTurnover !== 0 && turnover !== null
        ? (turnover - prevTurnover) / Math.abs(prevTurnover)
        : null;

      // Pre-compute day values for CCC
      const invDays       = inv !== 0 && cogs ? (inv / cogs) * 365 : null;
      const debtorDaysVal = debtors !== null && turnover ? (debtors / turnover) * 365 : null;
      const credDaysVal   = creditors !== null && cogs ? (creditors / cogs) * 365 : null;
      const ccc           = invDays !== null && debtorDaysVal !== null && credDaysVal !== null
        ? invDays + debtorDaysVal - credDaysVal : null;

      const calc: Array<[string, string, number | null, string]> = [
        // ── Profitability ────────────────────────────────────────────────────
        ["profitability", "revenue_growth",          revenueGrowth,                                                                    "(Revenue_curr − Revenue_prev) / |Revenue_prev|"],
        ["profitability", "ebitda_margin",           div(ebitda, turnover),                                                            "EBITDA / Turnover"],
        ["profitability", "ebt_margin",              div(pbt, turnover),                                                               "Profit Before Tax / Turnover"],
        ["profitability", "net_profit_margin",       div(pat, turnover),                                                               "PAT / Turnover"],
        ["profitability", "roe",                     negEq ? null : div(pat, networth),                                                "PAT / Net Worth"],
        ["profitability", "return_on_fixed_assets",  div(pat, fixedAssets),                                                            "PAT / Fixed Assets (Net)"],
        ["profitability", "roce",                    negEq ? null : div(ebit, networth),                                           "EBIT / Net Worth"],
        ["profitability", "gross_margin",            div(grossProfit, turnover),                                                       "Gross Profit / Turnover"],
        ["profitability", "roa",                     div(pat, totalAssets),                                                            "PAT / Total Assets"],
        // ── Liquidity ────────────────────────────────────────────────────────
        ["liquidity",     "current_ratio",           div(ca, cl),                                                                      "Current Assets / Current Liabilities"],
        ["liquidity",     "quick_ratio",             div(ca !== null ? ca - inv : null, cl),                                           "(CA - Inventory) / CL"],
        ["liquidity",     "cash_ratio",              div(cash, cl),                                                                    "Cash / Current Liabilities"],
        ["liquidity",     "working_capital",         wc,                                                                               "CA - CL"],
        // ── Solvency ─────────────────────────────────────────────────────────
        ["solvency",      "interest_coverage",       div(ebit, interest || null),                                                      "EBIT / Interest Expense"],
        ["solvency",      "lt_debt_to_equity",       negEq ? null : div(ltBorrowings, networth),                                       "Long Term Borrowings / Net Worth"],
        ["solvency",      "total_assets_to_equity",  negEq ? null : div(totalAssets, networth),                                        "Total Assets / Net Worth"],
        ["solvency",      "debt_to_equity",          negEq ? null : div(totalDebt, networth),                                          "Total Debt / Net Worth"],
        ["solvency",      "debt_to_assets",          div(totalDebt, totalAssets),                                                      "Total Debt / Total Assets"],
        ["solvency",      "debt_to_ebitda",          div(totalDebt, ebitda),                                                           "Total Debt / EBITDA"],
        ["solvency",      "total_liab_to_networth",  negEq ? null : div(totalLiab, networth),                                          "Total Liabilities / Net Worth"],
        // ── Coverage ─────────────────────────────────────────────────────────
        ["coverage",      "dscr",                    div((pat ?? 0) + dep + interest, interest + (principalPerYear || 0) || null),     "STANDARDISED: (PAT + Dep + Int) / (Int + Principal)"],
        // ── Efficiency / Turnover ────────────────────────────────────────────
        ["efficiency",    "fixed_assets_turnover",   div(turnover, fixedAssets),                                                       "Turnover / Fixed Assets (Net)"],
        ["efficiency",    "asset_turnover",          div(turnover, totalAssets),                                                       "Turnover / Total Assets"],
        ["efficiency",    "working_capital_turnover",div(turnover, wc),                                                                "Turnover / Working Capital"],
        ["efficiency",    "inventory_days",          invDays,                                                                          "(Inventory / COGS) × 365"],
        ["efficiency",    "debtor_days",             debtorDaysVal,                                                                    "In the absence of credit sales details, calculated using Total Revenue from Operations. (Debtors / Turnover) × 365"],
        ["efficiency",    "creditor_days",           credDaysVal,                                                                      "In the absence of credit purchase details, calculated using COGS. (Creditors / COGS) × 365"],
        ["efficiency",    "cash_conversion_cycle",   ccc,                                                                              "Inventory Days + Receivables Days − Payable Days. Payable & Receivable Days use COGS & Total Revenue from Operations respectively."],
        ["efficiency",    "inventory_turnover",      div(cogs, inv || null),                                                           "COGS / Inventory"],
        ["efficiency",    "receivables_turnover",    div(turnover, debtors),                                                           "Turnover / Trade Receivables"],
        ["efficiency",    "capital_employed_turnover",div(turnover, capEmployed),                                                      "Turnover / Capital Employed"],
        // ── Expenses ─────────────────────────────────────────────────────────
        ["expenses",      "raw_material_pct",        div(rawMat, turnover),                                                            "Cost of Materials Consumed / Turnover"],
        ["expenses",      "employee_cost_pct",       div(empCost, turnover),                                                           "Employee Benefit Expense / Turnover"],
        ["expenses",      "finance_cost_pct",        turnover ? div(interest || null, turnover) : null,                                "Interest (Finance Cost) / Turnover"],
        ["expenses",      "other_expenses_pct",      div(otherExp, turnover),                                                          "Other Expenses / Turnover"],
        // ── Return ───────────────────────────────────────────────────────────
        ["return",        "roic",                    negEq ? null : div(pat, capEmployed),                                             "PAT / Capital Employed"],
        ["return",        "ronw",                    negEq ? null : div(pat, networth),                                                "PAT / Net Worth"],
        // ── R' Score ─────────────────────────────────────────────────────────
        ["r_score",       "r_score_wc_ta",           rsWcTa,                                                                           "Working Capital / Total Assets"],
        ["r_score",       "r_score_re_ta",           rsReTa,                                                                           "Retained Earnings / Total Assets"],
        ["r_score",       "r_score_ebitda_ta",       rsEbitdaTa,                                                                       "EBITDA / Total Assets"],
        ["r_score",       "r_score_equity_ol",       rsEquityOl,                                                                       "Equity / Outside Liabilities"],
        ["r_score",       "r_score_composite",       rsComposite,                                                                      "6×(WC/TA) + 3×(RE/TA) + 7×(EBITDA/TA) + Equity/OL"],
      ];

      for (const [cat, name, val, formula] of calc) {
        const reviewRequired = negEq && ["debt_to_equity","lt_debt_to_equity","total_liab_to_networth","total_assets_to_equity","roe","ronw"].includes(name);
        rows.push({
          case_id, user_id: user.id,
          fiscal_year: fy,
          category: cat,
          ratio_name: name,
          ratio_value: val,
          benchmark: tMap[name]?.peer_median ?? null,
          threshold_status: applyThreshold(val, tMap[name], reviewRequired),
          formula_note: tMap[name]?.formula_note ?? formula,
        });
      }

      prevTurnover = turnover;
    }

    if (rows.length) {
      const { error: insErr } = await supabase.from("financial_ratios").insert(rows);
      if (insErr) {
        console.error("insert ratios error", insErr);
        return new Response(JSON.stringify({ error: insErr.message }), {
          status: 500, headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    }

    await supabase.from("credit_cases").update({ status: "analysis" }).eq("id", case_id);

    return new Response(JSON.stringify({ ok: true, count: rows.length }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("compute-ratios error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
