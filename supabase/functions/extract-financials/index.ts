/**
 * Rehbar — Financial Statement Extraction
 * Supports: PDF (vision), Image (vision), Excel (text).
 * Modes: single statement type | all_in_one (detects all types in one pass).
 * Unit detection: separate lightweight Claude call, updates all rows for the case.
 */

import { createClient }           from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAI, callAIText, type FileContent } from "../_shared/ai-caller.ts";
import { getCorsHeaders, handleOptions } from "../_shared/cors.ts";

type StatementType = "profit_loss" | "balance_sheet" | "cash_flow" | "projections";

const STANDARD_LINE_ITEMS: Record<StatementType, string[]> = {
  profit_loss:   ["Turnover","Cost of Goods Sold","Gross Profit","Operating Expenses","EBITDA","Depreciation","EBIT","Interest Expense","Profit Before Tax","Tax","PAT"],
  balance_sheet: ["Share Capital","Reserves & Surplus","Net Worth","Long Term Borrowings","Short Term Borrowings","Total Debt","Trade Payables","Other Current Liabilities","Current Liabilities","Total Liabilities","Fixed Assets (Net)","Inventory","Trade Receivables","Cash & Bank","Other Current Assets","Current Assets","Total Assets","Capital Employed"],
  cash_flow:     ["Cash from Operations","Cash from Investing","Cash from Financing","Net Change in Cash","Opening Cash","Closing Cash"],
  projections:   ["Projected Turnover","Projected EBITDA","Projected PAT","Projected Net Worth","Projected Total Debt"],
};

function imageMime(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif"))  return "image/gif";
  return "image/png";
}

async function downloadAsFile(
  supabase: any,
  filePath: string,
  fileType: string,
  fileName: string,
): Promise<FileContent> {
  const { data: file, error } = await supabase.storage.from("case-files").download(filePath);
  if (error || !file) throw new Error("File download failed: " + error?.message);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let b64 = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    b64 += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  const base64 = btoa(b64);
  return fileType === "image"
    ? { type: "image", base64, mime: imageMime(fileName) }
    : { type: "pdf",   base64 };
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  const cors = getCorsHeaders(req);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });

    const body: {
      case_id: string; document_id: string;
      statement_type: StatementType | "all_in_one";
      fiscal_year?: number | null;
      excel_text?: string;
      unit_only?: boolean;
    } = await req.json();

    const { case_id, document_id, statement_type, fiscal_year, excel_text, unit_only } = body;
    if (!case_id || !document_id) return new Response(JSON.stringify({ error: "Missing fields" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });

    const supabase    = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient  = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });

    const { data: doc } = await supabase.from("financial_documents").select("*").eq("id", document_id).single();
    if (!doc) return new Response(JSON.stringify({ error: "Document not found" }), {
      status: 404, headers: { ...cors, "Content-Type": "application/json" },
    });

    // Build file content — Excel arrives as pre-parsed text, PDF/image downloaded from storage
    const files: FileContent[] = doc.file_type === "excel"
      ? [{ type: "text", text: `DOCUMENT (Excel, TSV):\n\n${(excel_text ?? "").slice(0, 150_000)}` }]
      : [await downloadAsFile(supabase, doc.file_path, doc.file_type, doc.file_name)];

    // ── Unit-only mode ─────────────────────────────────────────────────────────
    if (unit_only) {
      const unit = await callAIText({
        systemPrompt: "You are a financial document analyser. Reply with ONLY a single unit name — no extra words.",
        userText: 'What unit are ALL financial figures in this document? Reply with EXACTLY one of: "Crores", "Lakhs", "Thousands", "Millions", "USD Millions", "USD"',
        files,
        maxTokens: 10,
      });
      const cleaned = unit.replace(/[^a-zA-Z ]/g, "").trim() || null;
      if (cleaned) await supabase.from("extracted_financials").update({ unit: cleaned }).eq("case_id", case_id);
      await supabase.from("financial_documents").update({ extraction_status: "done" }).eq("id", document_id);
      return new Response(JSON.stringify({ ok: true, unit: cleaned }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ── Full extraction ────────────────────────────────────────────────────────
    await supabase.from("financial_documents").update({ extraction_status: "running" }).eq("id", document_id);

    const isAllInOne   = statement_type === "all_in_one";
    const targetTypes: StatementType[] = isAllInOne
      ? ["profit_loss", "balance_sheet", "cash_flow", "projections"]
      : [statement_type as StatementType];

    const preferredLabels = Array.from(new Set(targetTypes.flatMap(t => STANDARD_LINE_ITEMS[t])));

    const itemsBlock = targetTypes.map(t =>
      `### ${t.toUpperCase()}\n${STANDARD_LINE_ITEMS[t].map(i => `- ${i}`).join("\n")}`
    ).join("\n\n");

    const fyHint = isAllInOne
      ? `Detect EVERY fiscal year present (e.g. 2022, 2023, 2024). Return one entry per (statement_type, fiscal_year) — never merge years. For projections without a stated FY use ${fiscal_year} as placeholder.`
      : statement_type === "projections"
        ? `Detect the fiscal year from the document; if absent use ${fiscal_year} as placeholder.`
        : `Detect EVERY fiscal year for this statement type. Return one entry per year — never skip or merge years.`;

    const args = await callAI({
      systemPrompt: `You are a senior financial data extraction engine for Rehbar Financial Services.
Extract structured financial data from audited statements, projections, or workbooks.

CRITICAL RULES:
1. Return ONE entry per (statement_type, fiscal_year) pair — never merge years.
2. Keep values in the SAME UNIT as the document. State the unit (Lakhs / Crores / INR / USD).
3. Confidence 0–100 per line item (legibility, label match, computational consistency).
4. Never include PII — no PAN, CIBIL, phone numbers, addresses.
5. Map each line item to the closest standard label from the preferred list. If nothing fits, use the document's own label verbatim.
6. If a line item is genuinely absent, omit it — never invent zeros.
7. Validate computational consistency (e.g. Total Assets = Total Liabilities + Net Worth) and reflect issues in confidence.`,
      userText: `Extract the following statements:\n\n${itemsBlock}\n\n${fyHint}\nNegative figures (or values in parentheses) must be returned as negative numbers.`,
      files,
      toolName: "submit_extraction",
      toolDescription: "Submit structured financial data. One entry per (statement_type, fiscal_year).",
      toolSchema: {
        unit: { type: "string", description: "Unit of all figures: Crores, Lakhs, Thousands, Millions, USD Millions, USD" },
        statements: {
          type: "array",
          items: {
            type: "object",
            properties: {
              statement_type: { type: "string", enum: targetTypes },
              fiscal_year:    { type: "integer" },
              line_items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label:      { type: "string", description: `Preferred: ${preferredLabels.join(", ")}` },
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
      toolRequired: ["unit", "statements"],
      maxTokens: 8192,
      retries: 2,
    });

    let totalRows = 0;
    for (const stmt of (args.statements as { statement_type: string; fiscal_year: number; line_items: { label: string; value: number | null; confidence: number; note?: string }[] }[]) ?? []) {
      const lineItems = stmt.line_items.map(li => ({
        label: li.label, value: li.value, confidence: li.confidence,
        reviewed: li.confidence >= 90, override_value: null, note: li.note ?? "",
      }));
      if (lineItems.length === 0) continue;
      const fy = stmt.fiscal_year || fiscal_year!;
      const { error } = await supabase.from("extracted_financials").upsert({
        case_id, user_id: user.id, document_id,
        fiscal_year: fy, statement_type: stmt.statement_type,
        line_items: lineItems, confirmed: false, unit: (args.unit as string) ?? null,
      }, { onConflict: "case_id,fiscal_year,statement_type" });
      if (error) { console.error("upsert error", error); continue; }
      totalRows++;
    }

    if (totalRows === 0) {
      await supabase.from("financial_documents").update({
        extraction_status: "failed", extraction_error: "No statements detected",
      }).eq("id", document_id);
      return new Response(JSON.stringify({ error: "No data extracted" }), {
        status: 422, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    await supabase.from("financial_documents").update({ extraction_status: "extracted", extraction_error: null }).eq("id", document_id);
    await supabase.from("credit_cases").update({ status: "extracted" }).eq("id", case_id);
    return new Response(JSON.stringify({ ok: true, unit: args.unit, statements_extracted: totalRows }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("extract-financials error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
