// Rehbar — Compute Ratios (BRD §CAS-MH-02)
// Pure-deterministic ratio engine. No AI involvement.
// DSCR formula fixed by Finance team (not analyst-overridable).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    const { case_id } = await req.json();
    if (!case_id) return new Response(JSON.stringify({ error: "case_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const { data: cc, error: ccErr } = await supabase.from("credit_cases").select("*").eq("id", case_id).eq("user_id", user.id).single();
    if (ccErr || !cc) return new Response(JSON.stringify({ error: "Case not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const { data: financials } = await supabase.from("extracted_financials").select("*").eq("case_id", case_id);
    const { data: thresholds } = await supabase.from("ratio_thresholds").select("*").eq("industry", "default");

    const tMap: Record<string, { green_min: number | null; amber_min: number | null; peer_median: number | null; higher_is_better: boolean }> = {};
    for (const t of thresholds ?? []) tMap[t.ratio_name] = t;

    // Group by year
    const yearMap = new Map<number, { pl: Record<string, number|null>; bs: Record<string, number|null>; cf: Record<string, number|null> }>();
    for (const f of financials ?? []) {
      const y = yearMap.get(f.fiscal_year) ?? { pl: {}, bs: {}, cf: {} };
      const dict = toDict(f.line_items as unknown as LineItem[]);
      if (f.statement_type === "profit_loss") y.pl = { ...y.pl, ...dict };
      if (f.statement_type === "balance_sheet") y.bs = { ...y.bs, ...dict };
      if (f.statement_type === "cash_flow") y.cf = { ...y.cf, ...dict };
      yearMap.set(f.fiscal_year, y);
    }

    if (yearMap.size === 0) {
      return new Response(JSON.stringify({ error: "No confirmed financials" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Estimate principal repayment per year from deal terms
    const principalPerYear =
      cc.deal_amount && cc.tenure_months ? Number(cc.deal_amount) / (Number(cc.tenure_months) / 12) : 0;

    // Wipe existing ratios for this case
    await supabase.from("financial_ratios").delete().eq("case_id", case_id);

    const rows: Array<{ case_id: string; user_id: string; fiscal_year: number; category: string; ratio_name: string; ratio_value: number | null; benchmark: number | null; threshold_status: string; formula_note: string }> = [];

    for (const [fy, fin] of Array.from(yearMap.entries()).sort((a, b) => a[0] - b[0])) {
      const pl = fin.pl, bs = fin.bs;
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
      const turnover = safe(pl["Turnover"]);
      const cogs = safe(pl["Cost of Goods Sold"]);
      const grossProfit = safe(pl["Gross Profit"]);
      const ebitda = safe(pl["EBITDA"]);
      const dep = safe(pl["Depreciation"]) ?? 0;
      const ebit = safe(pl["EBIT"]);
      const interest = safe(pl["Interest Expense"]) ?? 0;
      const pat = safe(pl["PAT"]);

      const calc: Array<[string, string, number | null, string]> = [
        ["liquidity","current_ratio", div(ca, cl), "Current Assets / Current Liabilities"],
        ["liquidity","quick_ratio", div(ca !== null ? ca - inv : null, cl), "(CA - Inventory) / CL"],
        ["liquidity","cash_ratio", div(cash, cl), "Cash / Current Liabilities"],
        ["liquidity","working_capital", ca !== null && cl !== null ? ca - cl : null, "CA - CL"],
        ["leverage","debt_to_equity", negEq ? null : div(totalDebt, networth), "Debt / Net Worth"],
        ["leverage","total_liab_to_networth", negEq ? null : div(totalLiab, networth), "Total Liab / Net Worth"],
        ["leverage","interest_coverage", div(ebit, interest || null), "EBIT / Interest"],
        ["coverage","dscr", div((pat ?? 0) + dep + interest, interest + (principalPerYear || 0) || null), "STANDARDISED: (PAT + Dep + Int) / (Int + Principal)"],
        ["efficiency","asset_turnover", div(turnover, totalAssets), "Turnover / Total Assets"],
        ["efficiency","capital_employed_turnover", div(turnover, capEmployed), "Turnover / Capital Employed"],
        ["efficiency","debtor_days", debtors !== null && turnover ? (debtors / turnover) * 365 : null, "(Debtors / Turnover) × 365"],
        ["efficiency","creditor_days", creditors !== null && cogs ? (creditors / cogs) * 365 : null, "(Creditors / COGS) × 365"],
        ["efficiency","inventory_turnover", div(cogs, inv || null), "COGS / Inventory"],
        ["profitability","gross_margin", div(grossProfit, turnover), "Gross Profit / Turnover"],
        ["profitability","ebitda_margin", div(ebitda, turnover), "EBITDA / Turnover"],
        ["profitability","pat_margin", div(pat, turnover), "PAT / Turnover"],
        ["profitability","roe", negEq ? null : div(pat, networth), "PAT / Net Worth"],
        ["profitability","roce", div(ebit, capEmployed), "EBIT / Capital Employed"],
      ];

      for (const [cat, name, val, formula] of calc) {
        const reviewRequired = negEq && ["debt_to_equity","total_liab_to_networth","roe"].includes(name);
        rows.push({
          case_id, user_id: user.id,
          fiscal_year: fy,
          category: cat,
          ratio_name: name,
          ratio_value: val,
          benchmark: tMap[name]?.peer_median ?? null,
          threshold_status: applyThreshold(val, tMap[name], reviewRequired),
          formula_note: formula,
        });
      }
    }

    if (rows.length) {
      const { error: insErr } = await supabase.from("financial_ratios").insert(rows);
      if (insErr) {
        console.error("insert ratios error", insErr);
        return new Response(JSON.stringify({ error: insErr.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    await supabase.from("credit_cases").update({ status: "analysis" }).eq("id", case_id);

    return new Response(JSON.stringify({ ok: true, count: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("compute-ratios error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
