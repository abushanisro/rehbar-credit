// Rehbar — Smart Narrative Generation (BRD §CAS-MH-03)
// Generates a 12-section IC Note draft using Gemini 2.5 Flash.
// Tables for sections V/VI/VII are pre-built server-side from DB data —
// the AI only adds bullet observations, eliminating format non-compliance.
// NEVER includes a credit recommendation. PII excluded.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

// ─── Pre-built table helpers ──────────────────────────────────────────────────
// We build markdown tables from raw DB data here so the AI never has to.
// This removes the #1 source of format non-compliance.

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
  const h = `| ${headers.join(" | ")} |`;
  const s = `|${headers.map(() => "---|").join("")}`;
  const b = rows.map(r => `| ${r.join(" | ")} |`).join("\n");
  return `${h}\n${s}\n${b}`;
}

function buildTables(financials: FinRow[], ratios: RatioRow[]): {
  sectionV: string; sectionVI: string; sectionVII: string;
} {
  const unit = financials.find(f => f.unit)?.unit ?? "Lakhs";
  const ul = `₹ ${unit}`;

  // Merge line items per fiscal year (all non-projection types)
  const fyMap = new Map<number, LineItem[]>();
  for (const row of financials) {
    if (row.statement_type === "projections") continue;
    const items = (row.line_items as LineItem[]) ?? [];
    const existing = fyMap.get(row.fiscal_year) ?? [];
    const seen = new Set(existing.map(i => i.label));
    fyMap.set(row.fiscal_year, [...existing, ...items.filter(i => !seen.has(i.label))]);
  }

  // Projection rows
  const projMap = new Map<number, LineItem[]>();
  for (const row of financials.filter(f => f.statement_type === "projections")) {
    projMap.set(row.fiscal_year, (row.line_items as LineItem[]) ?? []);
  }

  const histYears = [...fyMap.keys()].sort();
  const projYears = [...projMap.keys()].sort();

  // ── Section V: P&L + BS tables ────────────────────────────────────────────
  let sectionV = "";
  if (histYears.length > 0) {
    const plLabels = ["Turnover", "Gross Profit", "EBITDA", "PAT"];
    const plRows = plLabels.map(lb => [lb, ...histYears.map(y => lv(fyMap.get(y)!, lb))]);
    sectionV += `**P&L Summary (${ul})**\n${mdTable(["Item", ...histYears.map(y => `FY${y}`)], plRows)}\n\n`;

    const bsLabels = ["Net Worth", "Total Debt", "Current Assets", "Fixed Assets (Net)", "Total Assets"];
    const bsRows = bsLabels.map(lb => [lb, ...histYears.map(y => lv(fyMap.get(y)!, lb))]);
    sectionV += `**Balance Sheet (${ul})**\n${mdTable(["Item", ...histYears.map(y => `FY${y}`)], bsRows)}`;
  }

  // ── Section VI: Historical vs Projected comparison table ─────────────────
  let sectionVI = "";
  if (projYears.length > 0) {
    const pairs: [string, string][] = [
      ["Turnover",    "Projected Turnover"],
      ["EBITDA",      "Projected EBITDA"],
      ["PAT",         "Projected PAT"],
      ["Net Worth",   "Projected Net Worth"],
      ["Total Debt",  "Projected Total Debt"],
    ];
    const actCols = histYears.slice(-2).map(y => ({ y, p: false }));
    const prjCols = projYears.map(y => ({ y, p: true }));
    const allCols = [...actCols, ...prjCols];
    const headers = ["Metric", ...allCols.map(c => `FY${c.y}${c.p ? " (P)" : " (A)"}`)];
    const rows = pairs.map(([hl, pl]) => [
      hl,
      ...allCols.map(c => c.p ? lv(projMap.get(c.y)!, pl) : lv(fyMap.get(c.y) ?? [], hl)),
    ]);
    sectionVI = `**Historical vs Projected (${ul}) — A=Actual P=Projected**\n${mdTable(headers, rows)}`;
  }

  // ── Section VII: Full ratio table ─────────────────────────────────────────
  let sectionVII = "";
  if (ratios.length > 0) {
    const DISP: Record<string, string> = {
      current_ratio: "Current Ratio",       quick_ratio: "Quick Ratio",
      cash_ratio: "Cash Ratio",             working_capital: "Working Capital",
      debt_to_equity: "Debt/Equity",        debt_to_assets: "Debt/Assets",
      total_liab_to_networth: "Liab/NW",    interest_coverage: "Interest Coverage",
      dscr: "DSCR",                          asset_turnover: "Asset Turnover",
      receivables_turnover: "Recv Turnover", capital_employed_turnover: "CapEmp Turnover",
      debtor_days: "Debtor Days",            creditor_days: "Creditor Days",
      inventory_turnover: "Inv Turnover",    gross_margin: "Gross Margin",
      ebitda_margin: "EBITDA Margin",        net_profit_margin: "Net Profit Margin",
      roa: "ROA", roe: "ROE", roce: "ROCE", roic: "ROIC", ronw: "RONW",
      r_score_composite: "R' Score",
    };
    const PCT = new Set(["gross_margin","ebitda_margin","net_profit_margin","roa","roe","roce","roic","ronw"]);
    const SL: Record<string, string> = { green: "PASS", amber: "CAUTION", red: "FAIL", na: "—" };

    const fmtV = (n: string, v: number | null): string => {
      if (v === null || !Number.isFinite(Number(v))) return "—";
      if (["debtor_days","creditor_days"].includes(n)) return String(Math.round(Number(v)));
      if (n === "working_capital") return Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
      if (PCT.has(n)) return (Number(v) * 100).toFixed(1) + "%";
      return Number(v).toFixed(2) + "x";
    };

    const ratYears = [...new Set(ratios.map(r => r.fiscal_year))].sort();
    const ratNames = [...new Set(ratios.map(r => r.ratio_name))]
      .filter(n => !n.startsWith("r_score_") || n === "r_score_composite");

    const headers = ["Ratio", ...ratYears.map(y => `FY${y}`), "Benchmark", "Status"];
    const rows = ratNames.map(name => {
      const yCols = ratYears.map(fy => {
        const r = ratios.find(x => x.ratio_name === name && x.fiscal_year === fy);
        return r ? fmtV(name, r.ratio_value) : "—";
      });
      const first = ratios.find(x => x.ratio_name === name);
      const bm = first?.benchmark != null ? fmtV(name, first.benchmark) : "—";
      const latestStatus = ratios
        .filter(x => x.ratio_name === name)
        .sort((a, b) => b.fiscal_year - a.fiscal_year)[0]?.threshold_status ?? "na";
      return [DISP[name] || name, ...yCols, bm, SL[latestStatus] || "—"];
    });

    sectionVII = `**Key Financial Ratios**\n${mdTable(headers, rows)}`;
  }

  return { sectionV, sectionVI, sectionVII };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

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

    const { data: cc } = await supabase.from("credit_cases").select("*")
      .eq("id", case_id).eq("user_id", user.id).single();
    if (!cc) return new Response(JSON.stringify({ error: "Case not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    // Fetch with unit column
    const { data: financials } = await supabase
      .from("extracted_financials")
      .select("fiscal_year,statement_type,line_items,unit")
      .eq("case_id", case_id);
    const { data: ratios } = await supabase
      .from("financial_ratios")
      .select("fiscal_year,ratio_name,ratio_value,threshold_status,benchmark")
      .eq("case_id", case_id);

    await supabase.from("credit_cases").update({ status: "narrative" }).eq("id", case_id);

    // Strip PII
    const safeCase = {
      client_name: cc.client_name,
      legal_constitution: cc.legal_constitution,
      industry: cc.industry,
      year_established: cc.year_established,
      principal_borrower: cc.principal_borrower,
      product_type: cc.product_type,
      deal_amount: cc.deal_amount,
      tenure_months: cc.tenure_months,
      expected_irr: cc.expected_irr,
      residual_value: cc.residual_value,
      security_deposit: cc.security_deposit,
      collateral_summary: cc.collateral_summary,
      end_use: cc.end_use,
      strategic_rationale: cc.strategic_rationale,
      analyst_notes: cc.analyst_notes,
    };

    // Pre-build tables — AI must copy them verbatim
    const tables = buildTables(
      (financials ?? []) as FinRow[],
      (ratios ?? []) as RatioRow[],
    );

    const systemPrompt = `You are a senior credit analyst at Rehbar Financial Services writing a concise IC appraisal note.

NON-NEGOTIABLE RULES:
1. NEVER recommend Approve / Decline / Defer.
2. NEVER include PAN, CIBIL, addresses, phone numbers, or DOB.
3. ZERO PROSE PARAGRAPHS. Every line is a table row, a bullet ("- "), or a heading ("**...**").
4. Sections V, VI, VII: the user message contains pre-built tables. Copy them VERBATIM, then add ≤2 bullet observations below. Do not rewrite, reformat, or describe the numbers.
5. All other sections: snapshot table (item | value) + ≤3 bullets. No sentences.
6. Each bullet ≤ 12 words.
7. SWOT: 3–5 items per quadrant, ≤ 10 words each.
8. SOP rules for Section XII — PF/TF: projections waived; HL: LTV ≤ 60%, FOIR ≤ 50%; PLS: monthly P&L mandatory; OL/FL: projections waived if exposure < ₹100L or DSCR covers deal.`;

    const userPrompt = `Draft the IC Note for this case.

━━━ DEAL & CLIENT ━━━
${JSON.stringify(safeCase, null, 2)}

━━━ PRE-BUILT TABLES — COPY INTO SECTIONS VERBATIM ━━━

[SECTION V — historical_financial] Copy this exactly, then add ≤2 bullets:
${tables.sectionV || "No historical financial data extracted yet."}

[SECTION VI — projections] Copy this exactly, then add ≤2 bullets:
${tables.sectionVI || "No projection data extracted yet."}

[SECTION VII — key_ratios] Copy this exactly, then add ≤2 bullets:
${tables.sectionVII || "No ratio data computed yet."}

━━━ COMPUTED RATIOS (full detail — for bullet observations) ━━━
${JSON.stringify(ratios, null, 2)}

━━━ FULL FINANCIAL DATA (for cash flow section VIII and context) ━━━
${JSON.stringify(financials, null, 2)}`;

    const modelPref: string = (body as Record<string, unknown>).model_preference as string ?? "gemini";
    const useClaude = modelPref === "claude";

    let aiRes: Response;
    if (useClaude) {
      const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured");
      aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          tools: [{
            name: "submit_ic_note",
            description: "Submit the IC note. Sections V/VI/VII must start with the pre-built table from the user message, copied verbatim. Zero prose sentences anywhere.",
            input_schema: {
              type: "object",
              properties: {
                sections: {
                  type: "object",
                  properties: Object.fromEntries(
                    SECTION_IDS.map((id) => [id, {
                      type: "object",
                      properties: { markdown: { type: "string" } },
                      required: ["markdown"],
                      additionalProperties: false,
                    }])
                  ),
                  required: SECTION_IDS,
                  additionalProperties: false,
                },
                risks: {
                  type: "array",
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
                conditions_precedent: { type: "array", items: { type: "string" } },
                swot: {
                  type: "object",
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
              required: ["sections","risks","conditions_precedent","swot"],
              additionalProperties: false,
            },
          }],
          tool_choice: { type: "tool", name: "submit_ic_note" },
        }),
      });
    } else {
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) throw new Error("GEMINI_API_KEY not configured");

    aiRes = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${geminiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "submit_ic_note",
            description: "Submit the IC note. Sections V/VI/VII must start with the pre-built table from the user message, copied verbatim. Zero prose sentences anywhere.",
            parameters: {
              type: "object",
              properties: {
                sections: {
                  type: "object",
                  properties: Object.fromEntries(
                    SECTION_IDS.map((id) => [id, {
                      type: "object",
                      properties: {
                        markdown: {
                          type: "string",
                          description:
                            id === "historical_financial" ? "MUST start with the exact pre-built P&L and BS tables from the prompt, copied verbatim. Then ≤2 bullets." :
                            id === "projections"          ? "MUST start with the exact pre-built comparison table from the prompt, copied verbatim. Then ≤2 bullets." :
                            id === "key_ratios"           ? "MUST start with the exact pre-built ratios table from the prompt, copied verbatim. Then ≤2 bullets." :
                            "Markdown tables + bullet points only. No prose sentences.",
                        },
                      },
                      required: ["markdown"],
                      additionalProperties: false,
                    }]),
                  ),
                  required: SECTION_IDS,
                  additionalProperties: false,
                },
                risks: {
                  type: "array",
                  description: "Risk register — keep each risk and mitigant to 1 concise sentence",
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
                  description: "Suggested CPs for IC — each ≤ 15 words",
                  items: { type: "string" },
                },
                swot: {
                  type: "object",
                  description: "SWOT — 3-5 items per quadrant, each ≤ 10 words",
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
              required: ["sections","risks","conditions_precedent","swot"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "submit_ic_note" } },
      }),
    });
    } // end else gemini

    if (aiRes.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded — retry in a moment" }), {
      status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      console.error("AI gateway error", aiRes.status, txt);
      return new Response(JSON.stringify({ error: "Narrative generation failed", detail: txt.slice(0, 300) }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes.json();
    // Parse response — Claude uses content[].type=tool_use, Gemini uses choices[].message.tool_calls
    let args: Record<string, unknown>;
    if (useClaude) {
      const toolUse = aiJson.content?.find((c: { type: string }) => c.type === "tool_use");
      if (!toolUse) throw new Error("No tool_use in Claude response");
      args = toolUse.input;
    } else {
      const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) throw new Error("No tool call in AI response");
      args = JSON.parse(toolCall.function.arguments);
    }

    // If the AI didn't copy the tables (safety net): inject them directly
    if (tables.sectionV && !args.sections?.historical_financial?.markdown?.includes("|")) {
      args.sections.historical_financial.markdown = tables.sectionV + "\n" +
        (args.sections.historical_financial.markdown ?? "");
    }
    if (tables.sectionVI && !args.sections?.projections?.markdown?.includes("|")) {
      args.sections.projections.markdown = tables.sectionVI + "\n" +
        (args.sections.projections.markdown ?? "");
    }
    if (tables.sectionVII && !args.sections?.key_ratios?.markdown?.includes("|")) {
      args.sections.key_ratios.markdown = tables.sectionVII + "\n" +
        (args.sections.key_ratios.markdown ?? "");
    }

    await supabase.from("credit_cases").update({
      ic_note: { ...args, generated_at: new Date().toISOString(), draft: true },
      status: "ic_review",
    }).eq("id", case_id);

    return new Response(JSON.stringify({ ok: true, ic_note: args }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-narrative error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
