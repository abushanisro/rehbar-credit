/**
 * Rehbar — Background Financial Analysis Task (Trigger.dev)
 *
 * Accepts all uploaded documents for a case, sends them to Claude in a single
 * multi-document pass, and writes structured financial data across all tabs
 * (P&L, Balance Sheet, Cash Flow, Projections, Ratios) to Supabase.
 *
 * Required Trigger.dev environment variables:
 *   SUPABASE_URL              — e.g. https://xxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — service role (write access)
 *   ANTHROPIC_API_KEY         — Claude API key
 */

import { task, logger } from "@trigger.dev/sdk/v3";
import { createClient }  from "@supabase/supabase-js";

// ── Types ─────────────────────────────────────────────────────────────────────

type StatementType = "profit_loss" | "balance_sheet" | "cash_flow" | "projections";

type FileRecord = {
  id: string;
  file_path: string;
  file_type: "pdf" | "image" | "excel";
  file_name: string;
  excel_text?: string | null;
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

// ── Constants ─────────────────────────────────────────────────────────────────

const CLAUDE_MODEL  = "claude-sonnet-4-6";
const CLAUDE_API    = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VER = "2023-06-01";

const STATEMENT_TYPES: StatementType[] = [
  "profit_loss", "balance_sheet", "cash_flow", "projections",
];

const STANDARD_LINE_ITEMS: Record<StatementType, string[]> = {
  profit_loss:   ["Turnover","Cost of Goods Sold","Gross Profit","Operating Expenses","EBITDA","Depreciation","EBIT","Interest Expense","Profit Before Tax","Tax","PAT"],
  balance_sheet: ["Share Capital","Reserves & Surplus","Net Worth","Long Term Borrowings","Short Term Borrowings","Total Debt","Trade Payables","Other Current Liabilities","Current Liabilities","Total Liabilities","Fixed Assets (Net)","Inventory","Trade Receivables","Cash & Bank","Other Current Assets","Current Assets","Total Assets","Capital Employed"],
  cash_flow:     ["Cash from Operations","Cash from Investing","Cash from Financing","Net Change in Cash","Opening Cash","Closing Cash"],
  projections:   ["Projected Turnover","Projected EBITDA","Projected PAT","Projected Net Worth","Projected Total Debt"],
};

// Key ratios to compute after extraction
const RATIO_FORMULAS = [
  { name: "current_ratio",        label: "Current Ratio",         fn: (v: Record<string, number>) => v["Current Assets"]   / v["Current Liabilities"] },
  { name: "debt_equity_ratio",    label: "Debt / Equity",         fn: (v: Record<string, number>) => v["Total Debt"]        / v["Net Worth"] },
  { name: "interest_coverage",    label: "Interest Coverage",     fn: (v: Record<string, number>) => v["EBIT"]              / v["Interest Expense"] },
  { name: "ebitda_margin_pct",    label: "EBITDA Margin %",       fn: (v: Record<string, number>) => (v["EBITDA"]           / v["Turnover"]) * 100 },
  { name: "pat_margin_pct",       label: "PAT Margin %",          fn: (v: Record<string, number>) => (v["PAT"]              / v["Turnover"]) * 100 },
  { name: "return_on_equity_pct", label: "Return on Equity %",    fn: (v: Record<string, number>) => (v["PAT"]              / v["Net Worth"]) * 100 },
  { name: "return_on_assets_pct", label: "Return on Assets %",    fn: (v: Record<string, number>) => (v["PAT"]              / v["Total Assets"]) * 100 },
  { name: "asset_turnover",       label: "Asset Turnover",        fn: (v: Record<string, number>) => v["Turnover"]          / v["Total Assets"] },
  { name: "total_debt_to_ebitda", label: "Total Debt / EBITDA",   fn: (v: Record<string, number>) => v["Total Debt"]        / v["EBITDA"] },
  { name: "net_working_capital",  label: "Net Working Capital",   fn: (v: Record<string, number>) => v["Current Assets"]   - v["Current Liabilities"] },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function imageMime(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif"))  return "image/gif";
  return "image/png";
}

async function downloadAsBase64(supabase: any, path: string) {
  const { data, error } = await (supabase.storage as any).from("case-files").download(path);
  if (error || !data) throw new Error(`Download failed: ${path} — ${error?.message}`);
  const buf = await (data as Blob).arrayBuffer();
  return Buffer.from(buf).toString("base64");
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
  | { type: "image";    source: { type: "base64"; media_type: string;             data: string } };

function buildBlock(f: FileRecord, base64: string): ContentBlock {
  if (f.file_type === "image") {
    return { type: "image", source: { type: "base64", media_type: imageMime(f.file_name), data: base64 } };
  }
  return { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } };
}

function computeRatiosForYear(
  stmts: StatementOut[],
  fy: number,
): Record<string, number | null> {
  // Flatten all line items for this FY into a lookup map
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

// ── Main task ─────────────────────────────────────────────────────────────────

export const analyzeFinancialDocuments = task({
  id: "analyze-financial-documents",
  maxDuration: 600, // 10 minutes — handles large document sets
  run: async (payload: {
    case_id: string;
    document_ids: string[];
    user_id: string;
    excel_texts?: Record<string, string>; // doc_id → pre-parsed TSV text
  }) => {
    const { case_id, document_ids, user_id, excel_texts = {} } = payload;

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured in Trigger.dev");

    logger.info("Starting analysis", { case_id, document_count: document_ids.length });

    // ── Mark all docs as running ────────────────────────────────────────────
    await supabase.from("financial_documents")
      .update({ extraction_status: "running" })
      .in("id", document_ids);

    // ── Fetch document records ──────────────────────────────────────────────
    const { data: docs, error: docsErr } = await supabase
      .from("financial_documents")
      .select("id,file_path,file_type,file_name")
      .in("id", document_ids);

    if (docsErr || !docs?.length) {
      throw new Error(`Failed to fetch documents: ${docsErr?.message}`);
    }

    // ── Build content blocks for Claude ────────────────────────────────────
    const contentBlocks: ContentBlock[] = [];
    const skipped: string[] = [];
    let docIndex = 0;

    for (const doc of docs as FileRecord[]) {
      docIndex++;
      logger.info("Processing document", { index: docIndex, name: doc.file_name, type: doc.file_type });

      if (doc.file_type === "excel") {
        const text = excel_texts[doc.id];
        if (!text) {
          logger.warn("No excel_text in payload for Excel doc; skipping", { id: doc.id });
          skipped.push(doc.id);
          continue;
        }
        contentBlocks.push({
          type: "text",
          text: `=== DOCUMENT ${docIndex}: "${doc.file_name}" (Excel/CSV) ===\n\n${text.slice(0, 150_000)}`,
        });
        continue;
      }

      try {
        const base64 = await downloadAsBase64(supabase, doc.file_path);
        const typeLabel = doc.file_type === "image" ? "Image" : "PDF";
        contentBlocks.push(
          { type: "text", text: `=== DOCUMENT ${docIndex}: "${doc.file_name}" (${typeLabel}) ===` },
          buildBlock(doc, base64),
        );
      } catch (e) {
        logger.error("Download failed", { id: doc.id, error: String(e) });
        skipped.push(doc.id);
      }
    }

    if (contentBlocks.length === 0) {
      throw new Error("No downloadable documents — all failed or are Excel-only");
    }

    logger.info("Sending to Claude", { blocks: contentBlocks.length, skipped: skipped.length });

    // ── Build standard line item list for prompt ────────────────────────────
    const itemsBlock = STATEMENT_TYPES.map(t =>
      `### ${t.toUpperCase()}\n${STANDARD_LINE_ITEMS[t].map(i => `- ${i}`).join("\n")}`
    ).join("\n\n");

    // ── Call Claude — single multi-document, multi-year extraction ──────────
    const requestBody = {
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      system: `You are a senior financial data extraction engine for Rehbar Financial Services (Islamic NBFC).
You will receive ${docIndex} financial document${docIndex > 1 ? "s" : ""} (${contentBlocks.length} content block${contentBlocks.length > 1 ? "s" : ""} total — PDFs, images, and Excel files). Each document is labelled with its filename and type.
Extract ALL financial statements across ALL fiscal years from ALL documents. Process each document according to its type: PDFs and images contain scanned/printed statements; Excel/CSV files contain tabular data.


EXTRACTION RULES:
1. Return ONE entry per (statement_type, fiscal_year) pair — never merge years.
2. Detect and capture EVERY fiscal year present across all documents (e.g. FY2021, FY2022, FY2023, FY2024).
3. Keep values in the SAME UNIT as the document. State the unit for the entire set (Crores / Lakhs / Thousands / USD).
4. Confidence 0–100 per line item (legibility, label match, computational consistency).
5. Never include PII — no PAN, CIBIL, phone numbers, addresses.
6. Map each line item to the closest standard label. If nothing fits, use the document's own label verbatim.
7. If a line item is genuinely absent, omit it — never invent zeros.
8. Validate computational consistency (Total Assets = Total Liabilities + Net Worth; Gross Profit = Turnover - COGS) and lower confidence where discrepancies exist.
9. Negative figures or values in parentheses must be returned as negative numbers.
10. When the same fiscal year appears in multiple documents, synthesise — prefer audited over provisional data.`,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `Extract the following financial statements for ALL fiscal years:\n\n${itemsBlock}\n\nFor Projections without an explicit FY, use the next fiscal year after the latest historical year.` },
          ...contentBlocks,
        ],
      }],
      tools: [{
        name: "submit_extraction",
        description: "Submit all extracted financial statements. One entry per (statement_type, fiscal_year) pair.",
        input_schema: {
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
      }],
      tool_choice: { type: "tool", name: "submit_extraction" },
    };

    let extracted: ExtractionResult | undefined;

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(CLAUDE_API, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VER,
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (res.status === 529 || res.status === 503) {
        logger.warn("Claude overloaded, retrying", { attempt });
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Claude API ${res.status}: ${txt.slice(0, 300)}`);
      }

      const json = await res.json();
      if (json.stop_reason === "max_tokens") throw new Error("Claude output truncated — increase maxTokens");

      const block = (json.content as { type: string; input?: unknown }[])
        ?.find(c => c.type === "tool_use");
      if (!block?.input) throw new Error(`No tool_use in Claude response (stop_reason: ${json.stop_reason})`);

      extracted = block.input as ExtractionResult;
      break;
    }

    if (!extracted) throw new Error("All Claude attempts failed — no extraction result");

    logger.info("Extraction complete", {
      unit: extracted.unit,
      statements: extracted.statements.length,
    });

    // ── Write extracted_financials to Supabase ──────────────────────────────
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
      }, { onConflict: "case_id,fiscal_year,statement_type" });

      if (error) {
        logger.error("Upsert failed", { fy: stmt.fiscal_year, type: stmt.statement_type, error: error.message });
      } else {
        totalRows++;
      }
    }

    logger.info("Financial data written", { rows: totalRows });

    // ── Compute & write financial ratios ────────────────────────────────────
    const allFiscalYears = [...new Set(extracted.statements.map(s => s.fiscal_year))].sort();

    for (const fy of allFiscalYears) {
      const ratios = computeRatiosForYear(extracted.statements, fy);
      const { error } = await supabase.from("financial_ratios").upsert({
        case_id, user_id, fiscal_year: fy, ...ratios,
      }, { onConflict: "case_id,fiscal_year" });
      if (error) logger.error("Ratio upsert failed", { fy, error: error.message });
    }

    logger.info("Ratios written", { fiscal_years: allFiscalYears });

    // ── Update document + case status ───────────────────────────────────────
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

    return {
      ok: true,
      unit: extracted.unit,
      statements_extracted: totalRows,
      ratios_computed: allFiscalYears.length,
      fiscal_years: allFiscalYears,
      documents_processed: document_ids.length - skipped.length,
      documents_skipped: skipped.length,
    };
  },
});
