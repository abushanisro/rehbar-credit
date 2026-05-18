/**
 * Rehbar — AI Credit Ratio Analysis
 * Calls Claude directly (no shared callAI wrapper) using simple messages API.
 * Returns plain JSON text — no tool_use, no schema validation issues.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleOptions } from "../_shared/cors.ts";

declare const Deno: { env: { get(k: string): string | undefined } };

const json = (body: unknown, status = 200, cors: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

type RatioRow = {
  fiscal_year: number; category: string; ratio_name: string;
  ratio_value: number | null; threshold_status: string; benchmark: number | null;
};

const KEY_RATIOS = [
  "ebitda_margin","net_profit_margin","gross_margin","roe","roce",
  "current_ratio","quick_ratio","cash_ratio",
  "interest_coverage","dscr","debt_to_equity","debt_to_ebitda",
  "asset_turnover","debtor_days","inventory_days","creditor_days","cash_conversion_cycle",
  "finance_cost_pct","employee_cost_pct","raw_material_pct","r_score_composite",
];

const LABEL: Record<string,string> = {
  ebitda_margin:"EBITDA Margin",net_profit_margin:"PAT Margin",gross_margin:"Gross Margin",
  roe:"ROE",roce:"ROCE",current_ratio:"Current Ratio",quick_ratio:"Quick Ratio",
  cash_ratio:"Cash Ratio",interest_coverage:"Interest Coverage",dscr:"DSCR",
  debt_to_equity:"Debt/Equity",debt_to_ebitda:"Debt/EBITDA",asset_turnover:"Asset Turnover",
  debtor_days:"Receivable Days",inventory_days:"Inventory Days",creditor_days:"Payable Days",
  cash_conversion_cycle:"CCC",finance_cost_pct:"Finance Cost%",
  employee_cost_pct:"Employee Cost%",raw_material_pct:"Raw Material%",
  r_score_composite:"R-Score",
};

const PCT  = new Set(["ebitda_margin","net_profit_margin","gross_margin","roe","roce","finance_cost_pct","employee_cost_pct","raw_material_pct"]);
const DAYS = new Set(["debtor_days","inventory_days","creditor_days","cash_conversion_cycle"]);

function fv(name: string, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "-";
  if (DAYS.has(name))               return `${Math.round(Number(v))}d`;
  if (name === "r_score_composite") return Number(v).toFixed(2);
  if (PCT.has(name))                return `${(Number(v)*100).toFixed(1)}%`;
  return `${Number(v).toFixed(2)}x`;
}

function buildContext(ratios: RatioRow[], cc: Record<string,unknown>): string {
  const allYrs = [...new Set(ratios.map(r=>r.fiscal_year))].sort();
  const yrs    = allYrs.slice(-4);
  const latFy  = yrs[yrs.length-1];

  const latMap = new Map<string,RatioRow>();
  for (const r of ratios) { const ex=latMap.get(r.ratio_name); if (!ex||r.fiscal_year>ex.fiscal_year) latMap.set(r.ratio_name,r); }
  const lat    = [...latMap.values()];
  const g = lat.filter(r=>r.threshold_status==="green").length;
  const a = lat.filter(r=>r.threshold_status==="amber").length;
  const rd= lat.filter(r=>r.threshold_status==="red").length;

  const anomalies: string[] = [];
  for (const name of KEY_RATIOS) {
    for (const fy of yrs) {
      const val = ratios.find(r=>r.ratio_name===name&&r.fiscal_year===fy)?.ratio_value;
      if (val==null||!Number.isFinite(Number(val))) continue;
      const others = yrs.filter(y=>y!==fy)
        .map(y=>ratios.find(r=>r.ratio_name===name&&r.fiscal_year===y)?.ratio_value)
        .filter((v): v is number => v!=null&&Number.isFinite(Number(v)));
      if (others.length<2) continue;
      const med = [...others].sort((a,b)=>a-b)[Math.floor(others.length/2)];
      if (Math.abs(med)<0.001) continue;
      if (Math.abs(Number(val)/med)>8)
        anomalies.push(`FY${fy} ${LABEL[name]??name}: ${fv(name,Number(val))} vs median ${fv(name,med)}`);
    }
  }

  let s = `CLIENT: ${cc.client_name} | INDUSTRY: ${cc.industry??'N/A'} | DEAL: Rs.${cc.deal_amount??'-'}Cr / ${cc.tenure_months??'-'}M / ${cc.expected_irr??'-'}% IRR\n`;
  s += `SCORECARD FY${latFy}: ${g} PASS / ${a} CAUTION / ${rd} FAIL\n\n`;
  s += `RATIO | ${yrs.map(y=>`FY${y}`).join(' | ')} | BENCHMARK | STATUS\n`;
  for (const name of KEY_RATIOS) {
    const vals = yrs.map(fy=>fv(name,ratios.find(r=>r.ratio_name===name&&r.fiscal_year===fy)?.ratio_value));
    const bm   = fv(name,ratios.find(r=>r.ratio_name===name)?.benchmark);
    const st   = (latMap.get(name)?.threshold_status??"na").toUpperCase();
    s += `${LABEL[name]??name} | ${vals.join(' | ')} | ${bm} | ${st}\n`;
  }
  if (anomalies.length) s += `\nANOMALIES DETECTED:\n${anomalies.join('\n')}\n`;
  return s;
}

const SYSTEM = `You are a senior credit analyst. Analyse the ratio table and return ONLY valid JSON — no markdown, no explanation, just the raw JSON object. Be CONCISE — each string max 60 words.

Return exactly this structure:
{
  "profitability_insight": "1-2 sentences on EBITDA/PAT margins and ROE/ROCE trend",
  "liquidity_insight": "1-2 sentences on current/quick/cash ratios",
  "solvency_insight": "1-2 sentences on debt/equity, ICR, DSCR",
  "efficiency_insight": "1-2 sentences on debtor days, inventory days, asset turnover",
  "expense_insight": "1 sentence on cost structure",
  "r_score_insight": "1 sentence on R-Score trend",
  "overall_observation": "2 sentences on overall financial trajectory",
  "risk_factors": [{"severity":"HIGH","category":"x","description":"max 20 words"}],
  "positive_factors": ["max 15 words each"],
  "data_accuracy_notes": ["max 15 words each"]
}

Rules: Quote specific values and fiscal years. Do NOT recommend approval or rejection. Maximum 4 risk_factors, 3 positive_factors, 2 data_accuracy_notes.`;

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  const cors = getCorsHeaders(req);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401, cors);

    const body = await req.json().catch(() => ({}));
    const { case_id } = body;
    if (!case_id) return json({ error: "case_id required" }, 400, cors);

    // Service role — bypasses RLS
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify user
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401, cors);

    const { data: cc, error: ccErr } = await admin
      .from("credit_cases")
      .select("client_name,industry,deal_amount,tenure_months,expected_irr,product_type")
      .eq("id", case_id)
      .single();
    if (ccErr || !cc) return json({ error: `Case not found: ${ccErr?.message??'null'}` }, 404, cors);

    const { data: ratios, error: rErr } = await admin
      .from("financial_ratios")
      .select("fiscal_year,category,ratio_name,ratio_value,threshold_status,benchmark")
      .eq("case_id", case_id)
      .order("fiscal_year");
    if (rErr) return json({ error: `Ratio query error: ${rErr.message}` }, 500, cors);
    if (!ratios?.length) return json({ error: "No ratios found — run ratio analysis first" }, 400, cors);

    const context = buildContext(ratios as RatioRow[], cc as Record<string,unknown>);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500, cors);

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
        "content-type":      "application/json",
      },
      body: JSON.stringify({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 2500,
        system:     SYSTEM,
        messages:   [{ role: "user", content: context }],
      }),
    });

    const aiBody = await aiRes.json();
    if (!aiRes.ok) return json({ error: `Claude API ${aiRes.status}: ${JSON.stringify(aiBody).slice(0,300)}` }, 500, cors);

    if (aiBody.stop_reason === "max_tokens")
      return json({ error: "Response truncated — max_tokens too low. Contact support." }, 500, cors);

    const textBlock = (aiBody.content as { type: string; text?: string }[] ?? []).find((b) => b.type === "text");
    const raw = (textBlock?.text ?? "{}").trim();
    const cleaned = raw.replace(/^```json\s*/,"").replace(/^```\s*/,"").replace(/\s*```$/,"");

    let analysis: unknown;
    try { analysis = JSON.parse(cleaned); }
    catch (pe) { return json({ error: `JSON parse failed: ${pe}. Raw (first 200): ${cleaned.slice(0,200)}` }, 500, cors); }

    const usage = {
      input_tokens:  aiBody.usage?.input_tokens  ?? 0,
      output_tokens: aiBody.usage?.output_tokens ?? 0,
      max_tokens:    2500,
      model:         aiBody.model ?? "claude-haiku-4-5-20251001",
    };

    return json({ analysis, usage }, 200, cors);
  } catch (e) {
    console.error("generate-credit-summary:", e);
    return json({ error: String(e) }, 500, cors);
  }
});
