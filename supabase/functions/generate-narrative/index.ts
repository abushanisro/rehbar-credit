// Rehbar — Smart Narrative Generation (BRD §CAS-MH-03)
// Generates a 12-section IC Note draft using Gemini 2.5 Pro.
// IMPORTANT: NEVER includes a credit recommendation (BUY/HOLD/DECLINE) — that judgment is the analyst's.
// PII excluded from prompt.

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

    const { data: cc } = await supabase.from("credit_cases").select("*").eq("id", case_id).eq("user_id", user.id).single();
    if (!cc) return new Response(JSON.stringify({ error: "Case not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const { data: financials } = await supabase.from("extracted_financials").select("fiscal_year,statement_type,line_items").eq("case_id", case_id);
    const { data: ratios } = await supabase.from("financial_ratios").select("fiscal_year,ratio_name,ratio_value,threshold_status,benchmark").eq("case_id", case_id);

    await supabase.from("credit_cases").update({ status: "narrative" }).eq("id", case_id);

    // Strip PII before sending to LLM
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

    const systemPrompt = `You are a senior credit analyst at Rehbar Financial Services drafting an Investment Committee (IC) appraisal note.
Rehbar's primary product is Operating Lease (asset rental, RERL retains ownership).

CRITICAL RULES — VIOLATIONS WILL CAUSE DOCUMENT REJECTION:
1. NEVER recommend Approve / Decline / Defer. The recommendation is the analyst's judgment alone.
2. NEVER include personal information (PAN, CIBIL scores, addresses, phone, DOB) in any section.
3. Cite source whenever you reference industry data (e.g., "Source: IBEF, Apr 2026").
4. Mark every section as a draft — your tone is "the data shows X" not "the company is Y".
5. Use INR Lakhs/Crores consistent with the source data.
6. For the Executive Summary, include: company overview, product+amount, reason for funds, key ratios summary, collateral, competitive landscape, strategic rationale.
7. Section XII must apply the SOP product rules (e.g. PF: projections waived, project working sheet mandatory; HL: LTV ≤ 60%, FOIR ≤ 50%; PLS: monthly P&L reporting; OL/FL: projections waived if exposure < INR 100L OR current DSCR covers deal).
8. Output STRUCTURED via the submit_ic_note tool — no free-form text outside the tool call.`;

    const userPrompt = `Draft IC Note for the following credit case:

DEAL & CLIENT
${JSON.stringify(safeCase, null, 2)}

EXTRACTED FINANCIAL DATA (by year and statement)
${JSON.stringify(financials, null, 2)}

COMPUTED RATIOS (with traffic-light status)
${JSON.stringify(ratios, null, 2)}

Generate all 12 sections. Each section content should be 150–400 words of professional, evidence-based prose. NO credit recommendation.`;

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) throw new Error("GEMINI_API_KEY not configured");

    const aiRes = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${geminiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "submit_ic_note",
            description: "Submit a 12-section IC appraisal note draft",
            parameters: {
              type: "object",
              properties: {
                sections: {
                  type: "object",
                  properties: Object.fromEntries(
                    SECTION_IDS.map((id) => [id, {
                      type: "object",
                      properties: {
                        markdown: { type: "string", description: "Section content in markdown" },
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
                  description: "Risk register: each entry is a risk with mitigant",
                  items: {
                    type: "object",
                    properties: {
                      category: { type: "string", enum: ["business","industry","financial","transaction"] },
                      risk: { type: "string" },
                      mitigant: { type: "string" },
                      severity: { type: "string", enum: ["high","medium","low"] },
                    },
                    required: ["category","risk","mitigant","severity"],
                    additionalProperties: false,
                  },
                },
                conditions_precedent: {
                  type: "array",
                  description: "Suggested CPs for IC (analyst can edit)",
                  items: { type: "string" },
                },
              },
              required: ["sections","risks","conditions_precedent"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "submit_ic_note" } },
      }),
    });

    if (aiRes.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded — retry in a moment" }), {
      status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      console.error("AI gateway error", aiRes.status, txt);
      return new Response(JSON.stringify({ error: "Narrative generation failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in AI response");
    const args = JSON.parse(toolCall.function.arguments);

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
