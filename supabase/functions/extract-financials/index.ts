// Rehbar — AI Data Extraction (BRD §CAS-MH-01)
// Supports PDF (vision), Image (vision, mime detected), Excel (text payload parsed client-side).
// Modes:
//   - Single statement extraction (profit_loss | balance_sheet | cash_flow | projections)
//   - all_in_one: extract every statement type detected in one document
// Projections: fiscal_year is OPTIONAL.
// PII excluded.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type StatementType = "profit_loss" | "balance_sheet" | "cash_flow" | "projections";

const STANDARD_LINE_ITEMS: Record<StatementType, string[]> = {
  profit_loss: ["Turnover","Cost of Goods Sold","Gross Profit","Operating Expenses","EBITDA","Depreciation","EBIT","Interest Expense","Profit Before Tax","Tax","PAT"],
  balance_sheet: ["Share Capital","Reserves & Surplus","Net Worth","Long Term Borrowings","Short Term Borrowings","Total Debt","Trade Payables","Other Current Liabilities","Current Liabilities","Total Liabilities","Fixed Assets (Net)","Inventory","Trade Receivables","Cash & Bank","Other Current Assets","Current Assets","Total Assets","Capital Employed"],
  cash_flow: ["Cash from Operations","Cash from Investing","Cash from Financing","Net Change in Cash","Opening Cash","Closing Cash"],
  projections: ["Projected Turnover","Projected EBITDA","Projected PAT","Projected Net Worth","Projected Total Debt"],
};

interface ExtractInput {
  case_id: string;
  document_id: string;
  statement_type: StatementType | "all_in_one";
  fiscal_year?: number | null;
  excel_text?: string; // optional pre-parsed sheet text from client
  unit_only?: boolean; // detect unit from doc without re-extracting line items
}

function imageMimeFromName(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif")) return "image/gif";
  return "image/png";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: ExtractInput = await req.json();
    const { case_id, document_id, statement_type, unit_only } = body;
    let { fiscal_year } = body;

    if (!case_id || !document_id || (!unit_only && !statement_type)) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Projections / all_in_one: FY optional → default to current year
    if (!fiscal_year) fiscal_year = new Date().getFullYear();

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
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: doc, error: docErr } = await supabase
      .from("financial_documents").select("*").eq("id", document_id).eq("user_id", user.id).single();
    if (docErr || !doc) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("financial_documents").update({ extraction_status: "running" }).eq("id", document_id);

    // Build the AI message content based on file type
    let userContent: unknown;

    if (doc.file_type === "excel") {
      if (!body.excel_text || body.excel_text.trim().length === 0) {
        await supabase.from("financial_documents").update({
          extraction_status: "failed", extraction_error: "Excel content not provided by client",
        }).eq("id", document_id);
        return new Response(JSON.stringify({ error: "Excel text payload missing" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Cap to ~150k chars to stay within token budget
      const text = body.excel_text.slice(0, 150_000);
      userContent = [{ type: "text", text: `EXCEL WORKBOOK CONTENT (TSV per sheet):\n\n${text}` }];
    } else {
      const { data: file, error: dlErr } = await supabase.storage.from("case-files").download(doc.file_path);
      if (dlErr || !file) {
        await supabase.from("financial_documents").update({
          extraction_status: "failed", extraction_error: dlErr?.message || "download failed",
        }).eq("id", document_id);
        return new Response(JSON.stringify({ error: "File download failed" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      let b64 = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        b64 += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
      }
      const base64 = btoa(b64);
      const mime = doc.file_type === "image" ? imageMimeFromName(doc.file_name) : "application/pdf";
      userContent = [{ type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } }];
    }

    // ── Unit-only mode: detect unit from doc, update all rows for this case ──
    if (unit_only) {
      const geminiKey = Deno.env.get("GEMINI_API_KEY");
      if (!geminiKey) throw new Error("GEMINI_API_KEY not configured");
      const unitBody = JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a financial document analyzer. Reply with ONLY a single unit name — no extra words." },
          { role: "user", content: [
            { type: "text", text: 'What unit are ALL the financial figures in this document? Reply with EXACTLY one of: "Crores", "Lakhs", "Thousands", "Millions", "USD Millions", "USD"' },
            ...(Array.isArray(userContent) ? userContent : [userContent]),
          ]},
        ],
        max_tokens: 10,
      });
      let unitRes: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        unitRes = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${geminiKey}`, "Content-Type": "application/json" },
          body: unitBody,
        });
        if (unitRes.status !== 429) break;
        await new Promise((r) => setTimeout(r, [5000, 15000, 30000][attempt] ?? 30000));
      }
      const unitJson = await unitRes!.json();
      const detectedUnit = (unitJson.choices?.[0]?.message?.content ?? "").trim().replace(/[^a-zA-Z ]/g, "") || null;
      if (detectedUnit) {
        await supabase.from("extracted_financials")
          .update({ unit: detectedUnit })
          .eq("case_id", case_id);
      }
      await supabase.from("financial_documents").update({ extraction_status: "done" }).eq("id", document_id);
      return new Response(JSON.stringify({ ok: true, unit: detectedUnit }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isAllInOne = statement_type === "all_in_one";
    const targetTypes: StatementType[] = isAllInOne
      ? ["profit_loss", "balance_sheet", "cash_flow", "projections"]
      : [statement_type as StatementType];

    const itemsBlock = targetTypes.map((t) =>
      `### ${t.toUpperCase()}\n${STANDARD_LINE_ITEMS[t].map((i) => `- ${i}`).join("\n")}`
    ).join("\n\n");

    const fyHint = isAllInOne
      ? `Detect EVERY fiscal year present in the document (e.g. 2022, 2023, 2024, 2025). Return one statements entry per (statement_type, fiscal_year) combination — do NOT merge multiple years into one. For projection rows where no specific FY is stated, use ${fiscal_year} as a placeholder.`
      : statement_type === "projections"
        ? `Projections may not be tied to a specific fiscal year — detect it from the document; if absent, use ${fiscal_year} as a placeholder.`
        : `Detect EVERY fiscal year present in the document for this statement type (look for headings, labels, dates, e.g. "FY 2024-25" = 2024, "Year ended March 2023" = 2023). Return one statements entry per fiscal year found — do NOT merge or skip any year. If the document has 3 years of data, return 3 separate entries.`;

    const systemPrompt = `You are a senior financial data extraction engine for Rehbar Financial Services.
You extract structured financial data from audited statements, projections, or workbooks.

CRITICAL RULES:
1. Return ONE entry per (statement_type, fiscal_year) pair — if a document has 3 years of P&L data, return 3 separate statements entries, one per year.
2. NEVER merge multiple fiscal years into a single entry. Extract ALL years visible in the document.
3. Keep values in the SAME UNIT as the document. State the unit (Lakhs / Crores / INR / USD).
4. For each field provide a confidence 0–100 (legibility, label match, computational consistency).
5. NEVER include personal info about promoters, directors, partners (no PAN, no CIBIL, no addresses, no phone numbers).
6. Map each document line item to the CLOSEST standard label from the provided list. If nothing fits, use the document's own label verbatim — never omit a line item just because its name differs slightly.
7. If a line item is genuinely absent from the document (not just differently named), omit it (do not invent zeros).
8. Validate computational consistency (e.g., Total Assets = Total Liabilities + Net Worth) and reflect issues in the confidence.`;

    const userPrompt = `Extract the following statements:\n\n${itemsBlock}\n\n${fyHint}\nNegative figures (or values in parentheses) must be returned as negative numbers.`;

    // Compose messages
    const userMsg = {
      role: "user",
      content: [
        { type: "text", text: userPrompt },
        ...(Array.isArray(userContent) ? userContent : [userContent]),
      ],
    };

    const preferredLabels = Array.from(new Set(targetTypes.flatMap((t) => STANDARD_LINE_ITEMS[t])));

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) throw new Error("GEMINI_API_KEY not configured");

    const geminiBody = JSON.stringify({
      model: "gemini-2.5-flash",
      messages: [{ role: "system", content: systemPrompt }, userMsg],
      tools: [{
        type: "function",
        function: {
          name: "submit_extraction",
          description: "Submit structured financial data extraction.",
          parameters: {
            type: "object",
            properties: {
              unit: { type: "string" },
              statements: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    statement_type: { type: "string", enum: targetTypes },
                    fiscal_year: { type: "integer" },
                    line_items: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          label: {
                            type: "string",
                            description: `Preferred labels: ${preferredLabels.join(", ")}. Use the closest match; if none fit, use the document's own label.`,
                          },
                          value: { type: ["number", "null"] },
                          confidence: { type: "number", minimum: 0, maximum: 100 },
                          note: { type: "string" },
                        },
                        required: ["label", "value", "confidence"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["statement_type", "fiscal_year", "line_items"],
                  additionalProperties: false,
                },
              },
            },
            required: ["unit", "statements"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "submit_extraction" } },
    });

    // Retry up to 3 times on 429 with exponential backoff (5s, 15s, 30s)
    let aiRes: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      aiRes = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${geminiKey}`, "Content-Type": "application/json" },
        body: geminiBody,
      });
      if (aiRes.status !== 429) break;
      const waitMs = [5000, 15000, 30000][attempt] ?? 30000;
      console.warn(`Gemini 429 on attempt ${attempt + 1}, retrying in ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }

    if (!aiRes!.ok) {
      const txt = await aiRes!.text();
      const isRateLimit = aiRes!.status === 429;
      console.error("AI gateway error", aiRes!.status, txt);
      await supabase.from("financial_documents").update({
        extraction_status: "failed",
        extraction_error: isRateLimit ? "Rate limited after retries — try again in a minute" : `AI error ${aiRes!.status}: ${txt.slice(0, 300)}`,
      }).eq("id", document_id);
      return new Response(JSON.stringify({ error: isRateLimit ? "Rate limit exceeded" : "Extraction failed", detail: txt }), {
        status: aiRes!.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes!.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in AI response");
    const args = JSON.parse(toolCall.function.arguments);

    let totalRows = 0;
    for (const stmt of args.statements ?? []) {
      const lineItems = (stmt.line_items ?? []).map((li: { label: string; value: number | null; confidence: number; note?: string }) => ({
        label: li.label,
        value: li.value,
        confidence: li.confidence,
        reviewed: li.confidence >= 90,
        override_value: null,
        note: li.note ?? "",
      }));
      if (lineItems.length === 0) continue;
      const fy = stmt.fiscal_year || fiscal_year!;
      const { error: upErr } = await supabase
        .from("extracted_financials")
        .upsert({
          case_id, user_id: user.id, document_id, fiscal_year: fy,
          statement_type: stmt.statement_type, line_items: lineItems, confirmed: false,
          unit: args.unit ?? null,
        }, { onConflict: "case_id,fiscal_year,statement_type" });
      if (upErr) {
        console.error("upsert error", upErr);
        continue;
      }
      totalRows++;
    }

    if (totalRows === 0) {
      await supabase.from("financial_documents").update({
        extraction_status: "failed", extraction_error: "No statements detected in document",
      }).eq("id", document_id);
      return new Response(JSON.stringify({ error: "No data extracted" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("financial_documents").update({
      extraction_status: "extracted", extraction_error: null,
    }).eq("id", document_id);
    await supabase.from("credit_cases").update({ status: "extracted" }).eq("id", case_id);

    return new Response(JSON.stringify({
      ok: true, unit: args.unit, statements_extracted: totalRows,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("extract-financials unhandled error:", msg, e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
