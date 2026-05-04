/**
 * Rehbar — IC Note Generation
 * Generates a 12-section IC appraisal note draft using Claude Sonnet 4.6.
 * Sections V/VI/VII tables are pre-built server-side — AI adds bullet observations only.
 * Never includes a credit recommendation. PII excluded.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAI }       from "../_shared/ai-caller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SECTION_IDS = [
  "executive_summary","client_promoter","investment_structure","rehbar_funding_history",
  "historical_financial","projections","key_ratios","cash_flow","due_diligence",
  "risk_assessment","visit_reference","product_specifics",
];

// ── Pre-built table helpers ───────────────────────────────────────────────────
// Tables are constructed from DB data so the AI never formats numbers.
// This is the primary safeguard against format non-compliance.

type LineItem = { label: string; value: number | null; override_value?: number | null };
type FinRow   = { fiscal_year: number; statement_type: string; line_items: unknown; unit?: string | null };
type RatioRow = { fiscal_year: number; ratio_name: string; ratio_value: number | null; threshold_status: string; benchmark: number | null };

function lv(items: LineItem[], label: string): string {
  const it = items.find(i => i.label === label);
  if (!it) return "—";
  const v = it.override_value ?? it.value;
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "—";
  return Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function mdTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---|").join("")}`,
    ...rows.map(r => `| ${r.join(" | ")} |`),
  ].join("\n");
}

function buildTables(financials: FinRow[], ratios: RatioRow[]) {
  const unit = financials.find(f => f.unit)?.unit ?? "Lakhs";
  const ul   = `₹ ${unit}`;

  const fyMap   = new Map<number, LineItem[]>();
  const projMap = new Map<number, LineItem[]>();

  for (const row of financials) {
    const items = (row.line_items as LineItem[]) ?? [];
    if (row.statement_type === "projections") {
      projMap.set(row.fiscal_year, items);
    } else {
      const existing = fyMap.get(row.fiscal_year) ?? [];
      const seen = new Set(existing.map(i => i.label));
      fyMap.set(row.fiscal_year, [...existing, ...items.filter(i => !seen.has(i.label))]);
    }
  }

  const histYears = [...fyMap.keys()].sort();
  const projYears = [...projMap.keys()].sort();

  // Section V — P&L + Balance Sheet summary
  let sectionV = "";
  if (histYears.length > 0) {
    const plRows = ["Turnover","Gross Profit","EBITDA","PAT"].map(lb =>
      [lb, ...histYears.map(y => lv(fyMap.get(y)!, lb))]);
    sectionV  = `**P&L Summary (${ul})**\n${mdTable(["Item",...histYears.map(y=>`FY${y}`)], plRows)}\n\n`;
    const bsRows = ["Net Worth","Total Debt","Current Assets","Fixed Assets (Net)","Total Assets"].map(lb =>
      [lb, ...histYears.map(y => lv(fyMap.get(y)!, lb))]);
    sectionV += `**Balance Sheet (${ul})**\n${mdTable(["Item",...histYears.map(y=>`FY${y}`)], bsRows)}`;
  }

  // Section VI — Historical vs Projected
  let sectionVI = "";
  if (projYears.length > 0) {
    const pairs: [string,string][] = [
      ["Turnover","Projected Turnover"],["EBITDA","Projected EBITDA"],
      ["PAT","Projected PAT"],["Net Worth","Projected Net Worth"],["Total Debt","Projected Total Debt"],
    ];
    const actCols = histYears.slice(-2).map(y => ({ y, p: false }));
    const prjCols = projYears.map(y => ({ y, p: true }));
    const allCols = [...actCols, ...prjCols];
    const rows = pairs.map(([hl,pl]) => [hl, ...allCols.map(c =>
      c.p ? lv(projMap.get(c.y)!, pl) : lv(fyMap.get(c.y) ?? [], hl))]);
    sectionVI = `**Historical vs Projected (${ul}) — A=Actual P=Projected**\n${mdTable(["Metric",...allCols.map(c=>`FY${c.y}${c.p?" (P)":" (A)"}`)], rows)}`;
  }

  // Section VII — Ratio matrix
  let sectionVII = "";
  if (ratios.length > 0) {
    const DISP: Record<string,string> = {
      current_ratio:"Current Ratio", quick_ratio:"Quick Ratio", cash_ratio:"Cash Ratio",
      working_capital:"Working Capital", debt_to_equity:"Debt/Equity", debt_to_assets:"Debt/Assets",
      total_liab_to_networth:"Liab/NW", interest_coverage:"Interest Coverage", dscr:"DSCR",
      asset_turnover:"Asset Turnover", receivables_turnover:"Recv Turnover",
      capital_employed_turnover:"CapEmp Turnover", debtor_days:"Debtor Days",
      creditor_days:"Creditor Days", inventory_turnover:"Inv Turnover",
      gross_margin:"Gross Margin", ebitda_margin:"EBITDA Margin",
      net_profit_margin:"Net Profit Margin", roa:"ROA", roe:"ROE",
      roce:"ROCE", roic:"ROIC", ronw:"RONW", r_score_composite:"R' Score",
    };
    const PCT = new Set(["gross_margin","ebitda_margin","net_profit_margin","roa","roe","roce","roic","ronw"]);
    const SL: Record<string,string> = { green:"PASS", amber:"CAUTION", red:"FAIL", na:"—" };
    const fmt = (n: string, v: number | null) => {
      if (v === null || !Number.isFinite(Number(v))) return "—";
      if (["debtor_days","creditor_days"].includes(n)) return String(Math.round(Number(v)));
      if (n === "working_capital") return Number(v).toLocaleString("en-IN",{maximumFractionDigits:0});
      if (PCT.has(n)) return (Number(v)*100).toFixed(1)+"%";
      return Number(v).toFixed(2)+"x";
    };
    const ratYears = [...new Set(ratios.map(r => r.fiscal_year))].sort();
    const ratNames = [...new Set(ratios.map(r => r.ratio_name))]
      .filter(n => !n.startsWith("r_score_") || n === "r_score_composite");
    const rows = ratNames.map(name => {
      const yCols = ratYears.map(fy => {
        const r = ratios.find(x => x.ratio_name === name && x.fiscal_year === fy);
        return r ? fmt(name, r.ratio_value) : "—";
      });
      const first = ratios.find(x => x.ratio_name === name);
      const bm = first?.benchmark != null ? fmt(name, first.benchmark) : "—";
      const status = ratios.filter(x => x.ratio_name === name)
        .sort((a,b) => b.fiscal_year - a.fiscal_year)[0]?.threshold_status ?? "na";
      return [DISP[name]||name, ...yCols, bm, SL[status]||"—"];
    });
    sectionVII = `**Key Financial Ratios**\n${mdTable(["Ratio",...ratYears.map(y=>`FY${y}`),"Benchmark","Status"], rows)}`;
  }

  return { sectionV, sectionVI, sectionVII };
}

// ── Main handler ──────────────────────────────────────────────────────────────

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

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const { data: cc } = await supabase.from("credit_cases").select("*").eq("id", case_id).single();
    if (!cc) return new Response(JSON.stringify({ error: "Case not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const [{ data: financials }, { data: ratios }] = await Promise.all([
      supabase.from("extracted_financials").select("fiscal_year,statement_type,line_items,unit").eq("case_id", case_id),
      supabase.from("financial_ratios").select("fiscal_year,ratio_name,ratio_value,threshold_status,benchmark").eq("case_id", case_id),
    ]);

    await supabase.from("credit_cases").update({ status: "narrative" }).eq("id", case_id);

    const safeCase = {
      client_name: cc.client_name, legal_constitution: cc.legal_constitution,
      industry: cc.industry, year_established: cc.year_established,
      principal_borrower: cc.principal_borrower, product_type: cc.product_type,
      deal_amount: cc.deal_amount, tenure_months: cc.tenure_months,
      expected_irr: cc.expected_irr, residual_value: cc.residual_value,
      security_deposit: cc.security_deposit, collateral_summary: cc.collateral_summary,
      end_use: cc.end_use, strategic_rationale: cc.strategic_rationale,
      analyst_notes: cc.analyst_notes,
    };

    const tables = buildTables((financials ?? []) as FinRow[], (ratios ?? []) as RatioRow[]);

    const args = await callAI({
      systemPrompt: `You are a senior credit analyst at Rehbar Financial Services writing a concise IC appraisal note.

NON-NEGOTIABLE RULES:
1. NEVER recommend Approve / Decline / Defer.
2. NEVER include PAN, CIBIL, addresses, phone numbers, or DOB.
3. ZERO PROSE PARAGRAPHS. Every line is a table row, a bullet ("- "), or a heading ("**...**").
4. Sections V, VI, VII: copy the pre-built tables VERBATIM, then add ≤2 bullet observations below.
5. All other sections: snapshot table (item | value) + ≤3 bullets. No sentences.
6. Each bullet ≤ 12 words.
7. SWOT: 3–5 items per quadrant, ≤ 10 words each.
8. SOP: PF/TF — projections waived; HL — LTV ≤ 60%, FOIR ≤ 50%; PLS — monthly P&L mandatory; OL/FL — projections waived if exposure < ₹100L or DSCR covers deal.`,
      userText: `Draft the IC Note for this case.

━━━ DEAL & CLIENT ━━━
${JSON.stringify(safeCase, null, 2)}

━━━ PRE-BUILT TABLES — COPY INTO SECTIONS VERBATIM ━━━

[SECTION V — historical_financial]
${tables.sectionV || "No historical financial data extracted yet."}

[SECTION VI — projections]
${tables.sectionVI || "No projection data extracted yet."}

[SECTION VII — key_ratios]
${tables.sectionVII || "No ratio data computed yet."}

━━━ COMPUTED RATIOS (full detail — for bullet observations) ━━━
${JSON.stringify(ratios, null, 2)}

━━━ FULL FINANCIAL DATA (for cash flow section VIII and context) ━━━
${JSON.stringify(financials, null, 2)}`,
      toolName: "submit_ic_note",
      toolDescription: "Submit the IC note. Sections V/VI/VII must start with the pre-built table copied verbatim. Zero prose sentences.",
      toolSchema: {
        sections: {
          type: "object",
          properties: Object.fromEntries(SECTION_IDS.map(id => [id, {
            type: "object",
            properties: {
              markdown: {
                type: "string",
                description:
                  id === "historical_financial" ? "MUST start with Section V pre-built tables verbatim. Then ≤2 bullets." :
                  id === "projections"           ? "MUST start with Section VI pre-built table verbatim. Then ≤2 bullets." :
                  id === "key_ratios"            ? "MUST start with Section VII pre-built table verbatim. Then ≤2 bullets." :
                  "Snapshot table + ≤3 bullets. No prose.",
              },
            },
            required: ["markdown"],
            additionalProperties: false,
          }])),
          required: SECTION_IDS,
          additionalProperties: false,
        },
        risks: {
          type: "array",
          description: "Risk register — 1 concise sentence each",
          items: {
            type: "object",
            properties: {
              category: { type: "string", enum: ["business","industry","financial","transaction"] },
              risk:     { type: "string" },
              mitigant: { type: "string" },
              severity: { type: "string", enum: ["high","medium","low"] },
            },
            required: ["category","risk","mitigant","severity"],
            additionalProperties: false,
          },
        },
        conditions_precedent: {
          type: "array",
          description: "Suggested CPs — each ≤ 15 words",
          items: { type: "string" },
        },
        swot: {
          type: "object",
          description: "SWOT — 3-5 items per quadrant, ≤ 10 words each",
          properties: {
            strengths:     { type: "array", items: { type: "string" } },
            weaknesses:    { type: "array", items: { type: "string" } },
            opportunities: { type: "array", items: { type: "string" } },
            threats:       { type: "array", items: { type: "string" } },
          },
          required: ["strengths","weaknesses","opportunities","threats"],
          additionalProperties: false,
        },
      },
      toolRequired: ["sections","risks","conditions_precedent","swot"],
      maxTokens: 16000,
      retries: 2,
    });

    // Safety net: if Claude didn't copy the pre-built tables, inject them
    const sections = args.sections as Record<string, { markdown: string }>;
    if (tables.sectionV   && !sections.historical_financial?.markdown?.includes("|"))
      sections.historical_financial.markdown = tables.sectionV   + "\n" + (sections.historical_financial.markdown ?? "");
    if (tables.sectionVI  && !sections.projections?.markdown?.includes("|"))
      sections.projections.markdown          = tables.sectionVI  + "\n" + (sections.projections.markdown ?? "");
    if (tables.sectionVII && !sections.key_ratios?.markdown?.includes("|"))
      sections.key_ratios.markdown           = tables.sectionVII + "\n" + (sections.key_ratios.markdown ?? "");

    const icNote = { ...args, generated_at: new Date().toISOString(), draft: true };
    await supabase.from("credit_cases").update({ ic_note: icNote, status: "ic_review" }).eq("id", case_id);

    return new Response(JSON.stringify({ ok: true, ic_note: args }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("generate-narrative error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
