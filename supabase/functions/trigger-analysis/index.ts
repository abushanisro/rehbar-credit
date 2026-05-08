/**
 * Rehbar — Document Analysis Edge Function
 * Downloads uploaded financial documents, sends them to Mistral for extraction,
 * and writes structured data to extracted_financials + financial_ratios.
 * Uses EdgeRuntime.waitUntil so the caller gets an immediate response while
 * extraction runs in the background. No Trigger.dev dependency.
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MISTRAL_API_KEY
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Types ─────────────────────────────────────────────────────────────────────

type StatementType = "profit_loss" | "balance_sheet" | "cash_flow" | "projections";

type FileRecord = {
  id: string;
  file_path: string;
  file_type: "pdf" | "image" | "excel";
  file_name: string;
};

type LineItemIn = {
  label: string;
  value: number | null;
  confidence: number;
  note?: string;
};

type StatementOut = {
  statement_type: StatementType;
  fiscal_year: number;
  line_items: LineItemIn[];
};

type ExtractionResult = {
  unit: string;
  statements: StatementOut[];
};

type ContentBlock =
  | { type: "text";      text: string }
  | { type: "image_url"; image_url: { url: string } };

// ── Constants ─────────────────────────────────────────────────────────────────

const MISTRAL_API    = "https://api.mistral.ai/v1";
const MODEL_VISION   = "pixtral-large-latest";
const MODEL_TEXT     = "mistral-large-latest";

const STATEMENT_TYPES: StatementType[] = [
  "profit_loss", "balance_sheet", "cash_flow", "projections",
];

const STANDARD_LINE_ITEMS: Record<StatementType, string[]> = {
  profit_loss:   ["Turnover","Cost of Goods Sold","Gross Profit","Operating Expenses","EBITDA","Depreciation","EBIT","Interest Expense","Profit Before Tax","Tax","PAT"],
  balance_sheet: ["Share Capital","Reserves & Surplus","Net Worth","Long Term Borrowings","Short Term Borrowings","Total Debt","Trade Payables","Other Current Liabilities","Current Liabilities","Total Liabilities","Fixed Assets (Net)","Inventory","Trade Receivables","Cash & Bank","Other Current Assets","Current Assets","Total Assets","Capital Employed"],
  cash_flow:     ["Cash from Operations","Cash from Investing","Cash from Financing","Net Change in Cash","Opening Cash","Closing Cash"],
  projections:   ["Projected Turnover","Projected EBITDA","Projected PAT","Projected Net Worth","Projected Total Debt"],
};

const RATIO_FORMULAS = [
  { name: "current_ratio",        fn: (v: Record<string, number>) => v["Current Assets"]   / v["Current Liabilities"] },
  { name: "debt_equity_ratio",    fn: (v: Record<string, number>) => v["Total Debt"]        / v["Net Worth"] },
  { name: "interest_coverage",    fn: (v: Record<string, number>) => v["EBIT"]              / v["Interest Expense"] },
  { name: "ebitda_margin_pct",    fn: (v: Record<string, number>) => (v["EBITDA"]           / v["Turnover"]) * 100 },
  { name: "pat_margin_pct",       fn: (v: Record<string, number>) => (v["PAT"]              / v["Turnover"]) * 100 },
  { name: "return_on_equity_pct", fn: (v: Record<string, number>) => (v["PAT"]              / v["Net Worth"]) * 100 },
  { name: "return_on_assets_pct", fn: (v: Record<string, number>) => (v["PAT"]              / v["Total Assets"]) * 100 },
  { name: "asset_turnover",       fn: (v: Record<string, number>) => v["Turnover"]          / v["Total Assets"] },
  { name: "total_debt_to_ebitda", fn: (v: Record<string, number>) => v["Total Debt"]        / v["EBITDA"] },
  { name: "net_working_capital",  fn: (v: Record<string, number>) => v["Current Assets"]   - v["Current Liabilities"] },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

function imageMime(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif"))  return "image/gif";
  return "image/png";
}

function encodeBase64(data: Uint8Array): string {
  let binary = "";
  const cs = 0x8000;
  for (let i = 0; i < data.length; i += cs)
    binary += String.fromCharCode.apply(null, Array.from(data.subarray(i, i + cs)));
  return btoa(binary);
}

async function downloadAsBase64(supabase: any, path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("case-files").download(path);
  if (error || !data) throw new Error(`Download failed: ${path} — ${error?.message}`);
  const buf = await (data as Blob).arrayBuffer();
  return encodeBase64(new Uint8Array(buf));
}

async function ocrPdf(base64: string, apiKey: string): Promise<string> {
  const res = await fetch(`${MISTRAL_API}/ocr`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model:    "mistral-ocr-latest",
      document: { type: "document_url", document_url: `data:application/pdf;base64,${base64}` },
    }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Mistral OCR ${res.status}: ${t.slice(0,200)}`); }
  const json = await res.json();
  return (json.pages as { markdown?: string }[] ?? []).map(p => p.markdown ?? "").join("\n\n");
}

function buildImageBlock(f: FileRecord, base64: string): ContentBlock {
  return { type: "image_url", image_url: { url: `data:${imageMime(f.file_name)};base64,${base64}` } };
}

function computeRatiosForYear(stmts: StatementOut[], fy: number): Record<string, number | null> {
  const vals: Record<string, number> = {};
  for (const stmt of stmts) {
    if (stmt.fiscal_year !== fy) continue;
    for (const li of stmt.line_items) {
      if (li.value != null) vals[li.label] = li.value;
    }
  }
  const result: Record<string, number | null> = {};
  for (const ratio of RATIO_FORMULAS) {
    try {
      const v = ratio.fn(vals);
      result[ratio.name] = isFinite(v) ? parseFloat(v.toFixed(4)) : null;
    } catch {
      result[ratio.name] = null;
    }
  }
  return result;
}

// ── Background analysis ───────────────────────────────────────────────────────

async function runAnalysis(
  case_id: string,
  document_ids: string[],
  user_id: string,
  excel_texts: Record<string, string>,
  apiKey: string,
  supabase: any,
): Promise<void> {
  try {
    const { data: docs, error: docsErr } = await supabase
      .from("financial_documents")
      .select("id,file_path,file_type,file_name")
      .in("id", document_ids);

    if (docsErr || !docs?.length) {
      throw new Error(`Failed to fetch documents: ${docsErr?.message}`);
    }

    const contentBlocks: ContentBlock[] = [];
    const skipped: string[] = [];
    let docIndex = 0;
    let hasImage = false;

    for (const doc of docs as FileRecord[]) {
      docIndex++;
      if (doc.file_type === "excel") {
        const text = excel_texts[doc.id];
        if (!text) { skipped.push(doc.id); continue; }
        contentBlocks.push({
          type: "text",
          text: `=== DOCUMENT ${docIndex}: "${doc.file_name}" (Excel/CSV) ===\n\n${text.slice(0, 150_000)}`,
        });
        continue;
      }
      try {
        const base64 = await downloadAsBase64(supabase, doc.file_path);
        if (doc.file_type === "image") {
          hasImage = true;
          contentBlocks.push(
            { type: "text", text: `=== DOCUMENT ${docIndex}: "${doc.file_name}" (Image) ===` },
            buildImageBlock(doc, base64),
          );
        } else {
          // PDF — extract text via OCR, include as text
          const ocrText = await ocrPdf(base64, apiKey);
          contentBlocks.push({
            type: "text",
            text: `=== DOCUMENT ${docIndex}: "${doc.file_name}" (PDF) ===\n\n${ocrText}`,
          });
        }
      } catch (e) {
        console.error("Download/OCR failed", doc.id, String(e));
        skipped.push(doc.id);
      }
    }

    if (contentBlocks.length === 0) {
      throw new Error("No downloadable documents — all failed or are Excel-only without text");
    }

    const model = hasImage ? MODEL_VISION : MODEL_TEXT;

    const itemsBlock = STATEMENT_TYPES.map(t =>
      `### ${t.toUpperCase()}\n${STANDARD_LINE_ITEMS[t].map(i => `- ${i}`).join("\n")}`
    ).join("\n\n");

    const systemPrompt = `You are a senior financial data extraction engine for Rehbar Financial Services (Islamic NBFC).
You will receive ${docIndex} financial document${docIndex > 1 ? "s" : ""} (PDFs, images, and Excel files). Each document is labelled with its filename and type.
Extract ALL financial statements across ALL fiscal years from ALL documents.

EXTRACTION RULES:
1. Return ONE entry per (statement_type, fiscal_year) pair — never merge years.
2. Detect and capture EVERY fiscal year present across all documents.
3. Keep values in the SAME UNIT as the document. State the unit for the entire set (Crores / Lakhs / Thousands / USD).
4. Confidence 0–100 per line item (legibility, label match, computational consistency).
5. Never include PII — no PAN, CIBIL, phone numbers, addresses.
6. Map each line item to the closest standard label. If nothing fits, use the document's own label verbatim.
7. If a line item is genuinely absent, omit it — never invent zeros.
8. Validate computational consistency and lower confidence where discrepancies exist.
9. Negative figures or values in parentheses must be returned as negative numbers.
10. When the same fiscal year appears in multiple documents, synthesise — prefer audited over provisional data.`;

    const tools = [{
      type: "function",
      function: {
        name: "submit_extraction",
        description: "Submit all extracted financial statements. One entry per (statement_type, fiscal_year) pair.",
        parameters: {
          type: "object",
          properties: {
            unit: { type: "string", description: "Unit of all figures: Crores, Lakhs, Thousands, Millions, USD Millions, USD" },
            statements: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  statement_type: { type: "string", enum: STATEMENT_TYPES },
                  fiscal_year:    { type: "integer" },
                  line_items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        label:      { type: "string" },
                        value:      { type: ["number", "null"] },
                        confidence: { type: "number", minimum: 0, maximum: 100 },
                        note:       { type: "string" },
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
    }];

    let extracted: ExtractionResult | undefined;

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${MISTRAL_API}/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(120_000),
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 16000,
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                { type: "text", text: `Extract the following financial statements for ALL fiscal years:\n\n${itemsBlock}\n\nFor Projections without an explicit FY, use the next fiscal year after the latest historical year.` },
                ...contentBlocks,
              ],
            },
          ],
          tools,
          tool_choice: "any",
        }),
      });

      if (res.status === 529 || res.status === 503) {
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Mistral API ${res.status}: ${txt.slice(0, 300)}`);
      }

      const json = await res.json();
      const choice = json.choices?.[0];
      if (choice?.finish_reason === "length") throw new Error("Mistral output truncated — increase max_tokens");

      const toolCall = choice?.message?.tool_calls?.[0];
      if (!toolCall?.function?.arguments)
        throw new Error(`No tool_call in Mistral response (finish_reason: ${choice?.finish_reason})`);

      extracted = (typeof toolCall.function.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments) as ExtractionResult;
      break;
    }

    if (!extracted) throw new Error("All Mistral attempts failed — no extraction result");

    // ── Write extracted_financials ────────────────────────────────────────────
    let totalRows = 0;
    const primaryDocId = document_ids[0];

    for (const stmt of extracted.statements) {
      const lineItems = stmt.line_items.map(li => ({
        label: li.label, value: li.value, confidence: li.confidence,
        reviewed: li.confidence >= 90, override_value: null, note: li.note ?? "",
      }));
      if (lineItems.length === 0) continue;

      const { error } = await supabase.from("extracted_financials").upsert({
        case_id, user_id, document_id: primaryDocId,
        fiscal_year: stmt.fiscal_year, statement_type: stmt.statement_type,
        line_items: lineItems, confirmed: false, unit: extracted.unit,
      }, { onConflict: "case_id,fiscal_year,statement_type" } as any);

      if (error) {
        console.error("Upsert failed", stmt.fiscal_year, stmt.statement_type, error.message);
      } else {
        totalRows++;
      }
    }

    // ── Write financial_ratios ────────────────────────────────────────────────
    const allFiscalYears = [...new Set(extracted.statements.map(s => s.fiscal_year))].sort();

    for (const fy of allFiscalYears) {
      const ratios = computeRatiosForYear(extracted.statements, fy);
      await supabase.from("financial_ratios").upsert(
        { case_id, user_id, fiscal_year: fy, ...ratios },
        { onConflict: "case_id,fiscal_year" } as any,
      );
    }

    // ── Update document + case status ─────────────────────────────────────────
    const successIds = document_ids.filter(id => !skipped.includes(id));
    if (successIds.length) {
      await supabase.from("financial_documents")
        .update({ extraction_status: "extracted", extraction_error: null })
        .in("id", successIds);
    }
    if (skipped.length) {
      await supabase.from("financial_documents")
        .update({ extraction_status: "failed", extraction_error: "Download or parse failed" })
        .in("id", skipped);
    }

    await supabase.from("credit_cases")
      .update({ status: totalRows > 0 ? "extracted" : "draft" })
      .eq("id", case_id);

    console.log("Analysis complete", { case_id, statements: totalRows, fiscal_years: allFiscalYears });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("runAnalysis failed:", msg);
    await supabase.from("financial_documents")
      .update({ extraction_status: "failed", extraction_error: msg.slice(0, 500) })
      .in("id", document_ids);
    await supabase.from("credit_cases")
      .update({ status: "draft" })
      .eq("id", case_id);
  }
}

// ── Request handler ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const apiKey = Deno.env.get("MISTRAL_API_KEY");
    if (!apiKey) return new Response(JSON.stringify({ error: "MISTRAL_API_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const body: {
      case_id: string;
      document_ids: string[];
      user_id: string;
      excel_texts?: Record<string, string>;
    } = await req.json();

    if (!body.case_id || !body.document_ids?.length || !body.user_id) {
      return new Response(JSON.stringify({ error: "Missing required fields: case_id, document_ids, user_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Mark as running synchronously before returning, so UI updates immediately
    await supabase.from("financial_documents")
      .update({ extraction_status: "running", extraction_error: null })
      .in("id", body.document_ids);

    // Run the heavy work in background — race against 130 s so our catch block
    // always fires before Supabase's hard 150 s kill, leaving no stuck "running" docs.
    const analysisWithTimeout = Promise.race([
      runAnalysis(body.case_id, body.document_ids, body.user_id, body.excel_texts ?? {}, apiKey, supabase),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("Analysis timed out (130 s) — document may be too large; try splitting into smaller files")), 130_000)
      ),
    ]).catch(async (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Analysis race failed:", msg);
      await supabase.from("financial_documents")
        .update({ extraction_status: "failed", extraction_error: msg.slice(0, 500) })
        .in("id", body.document_ids);
      await supabase.from("credit_cases")
        .update({ status: "draft" })
        .eq("id", body.case_id);
    });
    EdgeRuntime.waitUntil(analysisWithTimeout);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("trigger-analysis error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

export {};
