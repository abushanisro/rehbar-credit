/**
 * Rehbar — Provisional Financial Statements PDF Extraction.
 * Extracts P&L + Balance Sheet + Cash Flow from a provisional (MIS/internal)
 * financial statement and writes directly to ic_note.provisional — bypassing
 * extracted_financials to avoid clobbering audited data sharing the same
 * UNIQUE (case_id, fiscal_year, statement_type) key.
 */

import { createClient }                  from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { encodeBase64 }                  from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { getDocumentProxy, extractText } from "npm:unpdf@0.11.0";
import { callAI, type FileContent }      from "../_shared/ai-caller.ts";
import { getCorsHeaders, handleOptions } from "../_shared/cors.ts";

function imageMime(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  return "image/png";
}

async function prepareFile(bytes: Uint8Array, fileType: string, fileName: string): Promise<FileContent> {
  if (fileType === "image") {
    return { type: "image", base64: encodeBase64(bytes), mime: imageMime(fileName) };
  }
  // PDF: try text extraction first; fall back to base64 vision for scanned docs
  try {
    const pdfDoc = await getDocumentProxy(bytes);
    const { text } = await extractText(pdfDoc, { mergePages: true });
    if (text && text.trim().length > 200) {
      console.log(`PDF text extracted: ${text.length} chars`);
      return { type: "text", text: `PROVISIONAL FINANCIAL STATEMENT:\n\n${text.slice(0, 150_000)}` };
    }
  } catch (e) {
    console.warn("unpdf extraction failed, falling back to PDF vision:", e);
  }
  console.log("Sending PDF as base64 vision document");
  return { type: "pdf", base64: encodeBase64(bytes) };
}

// Label mappings: schema key → ProvisionalTab display label

const PL_MAP: Array<[string, string]> = [
  ["turnover",          "Turnover"],
  ["cogs",              "Cost of Goods Sold"],
  ["gross_profit",      "Gross Profit"],
  ["operating_expenses","Operating Expenses"],
  ["ebitda",            "EBITDA"],
  ["depreciation",      "Depreciation"],
  ["ebit",              "EBIT"],
  ["interest_expense",  "Interest Expense"],
  ["profit_before_tax", "Profit Before Tax"],
  ["tax",               "Tax"],
  ["pat",               "PAT"],
];

const BS_MAP: Array<[string, string]> = [
  ["share_capital",            "Share Capital"],
  ["reserves_surplus",         "Reserves & Surplus"],
  ["net_worth",                "Net Worth"],
  ["lt_borrowings",            "Long Term Borrowings"],
  ["st_borrowings",            "Short Term Borrowings"],
  ["total_debt",               "Total Debt"],
  ["trade_payables",           "Trade Payables"],
  ["other_current_liabilities","Other Current Liabilities"],
  ["current_liabilities",      "Current Liabilities"],
  ["total_liabilities",        "Total Liabilities"],
  ["fixed_assets_net",         "Fixed Assets (Net)"],
  ["inventory",                "Inventory"],
  ["trade_receivables",        "Trade Receivables"],
  ["cash_bank",                "Cash & Bank"],
  ["other_current_assets",     "Other Current Assets"],
  ["current_assets",           "Current Assets"],
  ["total_assets",             "Total Assets"],
];

const CF_MAP: Array<[string, string]> = [
  ["cfo",              "Cash from Operations"],
  ["cfi",              "Cash from Investing"],
  ["cff",              "Cash from Financing"],
  ["net_change_cash",  "Net Change in Cash"],
  ["opening_cash",     "Opening Cash"],
  ["closing_cash",     "Closing Cash"],
];

const numField = { type: ["number", "null"] as const };

const plSchema = {
  type: "object" as const,
  properties: {
    turnover:           numField,
    cogs:               numField,
    gross_profit:       numField,
    operating_expenses: numField,
    ebitda:             numField,
    depreciation:       numField,
    ebit:               numField,
    interest_expense:   numField,
    profit_before_tax:  numField,
    tax:                numField,
    pat:                numField,
  },
  additionalProperties: false,
};

const bsSchema = {
  type: "object" as const,
  properties: {
    share_capital:             numField,
    reserves_surplus:          numField,
    net_worth:                 numField,
    lt_borrowings:             numField,
    st_borrowings:             numField,
    total_debt:                numField,
    trade_payables:            numField,
    other_current_liabilities: numField,
    current_liabilities:       numField,
    total_liabilities:         numField,
    fixed_assets_net:          numField,
    inventory:                 numField,
    trade_receivables:         numField,
    cash_bank:                 numField,
    other_current_assets:      numField,
    current_assets:            numField,
    total_assets:              numField,
  },
  additionalProperties: false,
};

const cfSchema = {
  type: "object" as const,
  properties: {
    cfo:             numField,
    cfi:             numField,
    cff:             numField,
    net_change_cash: numField,
    opening_cash:    numField,
    closing_cash:    numField,
  },
  additionalProperties: false,
};

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  const cors = getCorsHeaders(req);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const body = await req.json().catch(() => ({})) as {
    case_id?: string;
    user_id?: string;
    document_id?: string;
  };
  const { case_id, user_id, document_id } = body;

  if (!case_id || !user_id || !document_id) {
    return new Response(
      JSON.stringify({ error: "Missing required fields: case_id, user_id, document_id" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // ── Auth check ─────────────────────────────────────────────────────────────
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // ── Fetch document row ─────────────────────────────────────────────────────
    const { data: doc, error: docErr } = await supabase
      .from("financial_documents")
      .select("*")
      .eq("id", document_id)
      .single();

    if (docErr || !doc) {
      return new Response(
        JSON.stringify({ error: "Document not found" }),
        { status: 404, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // ── Download file + prepare for Claude (text or base64 PDF/image) ─────────
    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from("case-files")
      .download(doc.file_path);

    if (dlErr || !fileBlob) {
      throw new Error(`File download failed: ${dlErr?.message ?? "no blob"}`);
    }

    const bytes       = new Uint8Array(await fileBlob.arrayBuffer());
    const fileContent = await prepareFile(bytes, (doc.file_type as string) ?? "pdf", doc.file_name as string);

    // ── Mark running ───────────────────────────────────────────────────────────
    await supabase
      .from("financial_documents")
      .update({ extraction_status: "running" })
      .eq("id", document_id);

    // ── Claude extraction call ─────────────────────────────────────────────────
    const fyItemSchema = {
      type: "object" as const,
      properties: {
        year:           { type: "integer" },
        label:          { type: "string", description: "e.g. FY2025 or H1FY25" },
        months_covered: { type: "integer", description: "Number of months this period covers (1-12)" },
        pl: plSchema,
        bs: bsSchema,
        cf: cfSchema,
      },
      required: ["year", "pl", "bs"],
      additionalProperties: false,
    };

    const args = await callAI({
      model: "claude-haiku-4-5-20251001",
      maxTokens: 8192,
      timeoutMs: 120_000,
      retries: 1,
      systemPrompt:
        "You are a financial data extractor for Indian companies. " +
        "Extract all figures EXACTLY as stated in the document — do not convert units. " +
        "Return numbers in the document's native unit (Lakhs, Crores, INR, or Thousands). " +
        "Set the 'unit' field to match: use 'Lakhs' if figures are in lakhs, 'Crores' if in crores, 'INR' if in actual rupees. " +
        "Remove commas from Indian-format numbers (e.g. 1,23,45,678 → 12345678) but keep the value in the document's unit. " +
        "The fiscal year label FY25 or FY2024-25 means year=2025 (ending year). " +
        "Do not invent values — set fields to null if not present. " +
        "For P&L: Turnover = Revenue from operations; COGS = Cost of materials/goods consumed; " +
        "Gross Profit = Turnover - COGS; Operating Expenses = all expenses excluding COGS, depreciation, and finance costs " +
        "(e.g. employee benefits, other expenses); EBITDA = Gross Profit - Operating Expenses; " +
        "EBIT = EBITDA - Depreciation; Interest Expense = Finance costs; " +
        "Profit Before Tax = PBT; Tax = income tax expense; PAT = net profit for the year. " +
        "For Balance Sheet: Net Worth = Share Capital + Reserves & Surplus; " +
        "Total Debt = Long Term Borrowings + Short Term Borrowings; " +
        "Current Liabilities = Trade Payables + Other Current Liabilities + ST provisions; " +
        "Total Liabilities = Net Worth + Total Debt + Current Liabilities + other non-current; " +
        "Fixed Assets (Net) = tangible + intangible assets net of depreciation; " +
        "Inventory = inventories/stock; Current Assets = Inventory + Trade Receivables + Cash & Bank + Other Current Assets; " +
        "Total Assets = Non-current Assets + Current Assets.",
      userText:
        "Extract all P&L, Balance Sheet, and Cash Flow figures for every fiscal year or period present in this provisional financial statement. " +
        "Return one entry per fiscal year/period with all available fields.",
      files: [fileContent],
      toolName: "submit_provisional_data",
      toolDescription: "Submit extracted provisional financial data — one entry per fiscal year/period",
      toolRequired: ["unit", "fiscal_years"],
      toolSchema: {
        unit:         { type: "string", description: "Unit of figures: INR, Lakhs, Crores, Thousands" },
        fiscal_years: { type: "array", items: fyItemSchema },
      },
    });

    const fiscalYears = (args.fiscal_years as Record<string, unknown>[]) ?? [];
    if (fiscalYears.length === 0) {
      await supabase.from("financial_documents").update({
        extraction_status: "failed",
        extraction_error:  "No fiscal year data extracted",
      }).eq("id", document_id);
      return new Response(
        JSON.stringify({ error: "No provisional data extracted" }),
        { status: 422, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const unit = (args.unit as string) ?? "INR";

    // ── Build provisional periods directly from in-memory Claude output ────────
    // We intentionally skip extracted_financials to avoid the UNIQUE
    // (case_id, fiscal_year, statement_type) constraint clobbering audited rows.
    type LineItemData = { label: string; value: number; confidence: number; reviewed: boolean; override_value: null; note: string };
    type ProvPeriod   = { id: string; label: string; period_type: string; fiscal_year: number; months_covered: number; unit: string; pl: LineItemData[]; bs: LineItemData[]; cf: LineItemData[] };

    const newPeriods: ProvPeriod[] = [];

    for (const fyEntry of fiscalYears) {
      const year = fyEntry.year as number;
      if (!year) continue;

      const pl = fyEntry.pl as Record<string, unknown> | undefined;
      const bs = fyEntry.bs as Record<string, unknown> | undefined;
      const cf = fyEntry.cf as Record<string, unknown> | undefined;

      const plItems: LineItemData[] = pl
        ? PL_MAP.filter(([key]) => pl[key] != null).map(([key, label]) => ({
            label, value: pl[key] as number, confidence: 92, reviewed: false, override_value: null, note: "",
          }))
        : [];

      const bsItems: LineItemData[] = bs
        ? BS_MAP.filter(([key]) => bs[key] != null).map(([key, label]) => ({
            label, value: bs[key] as number, confidence: 92, reviewed: false, override_value: null, note: "",
          }))
        : [];

      const cfItems: LineItemData[] = cf
        ? CF_MAP.filter(([key]) => cf[key] != null).map(([key, label]) => ({
            label, value: cf[key] as number, confidence: 92, reviewed: false, override_value: null, note: "",
          }))
        : [];

      if (plItems.length === 0 && bsItems.length === 0) continue;

      const fyLabel      = (fyEntry.label as string | undefined) ?? `FY${year}`;
      const monthsCovered = (fyEntry.months_covered as number | undefined) ?? 12;

      newPeriods.push({
        id:             crypto.randomUUID(),
        label:          fyLabel,
        period_type:    "annual",
        fiscal_year:    year,
        months_covered: monthsCovered,
        unit,
        pl:             plItems,
        bs:             bsItems,
        cf:             cfItems,
      });
    }

    if (newPeriods.length === 0) {
      await supabase.from("financial_documents").update({
        extraction_status: "failed",
        extraction_error:  "AI extracted data but all values were null — check PDF readability",
      }).eq("id", document_id);
      return new Response(
        JSON.stringify({ error: "No financial values could be extracted from the document" }),
        { status: 422, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // ── Merge into ic_note.provisional (preserve existing periods by label) ────
    const { data: freshCase } = await supabase
      .from("credit_cases")
      .select("ic_note")
      .eq("id", case_id)
      .single();
    const icNote   = (freshCase?.ic_note ?? {}) as Record<string, unknown>;
    const existing = (icNote["provisional"] ?? []) as ProvPeriod[];
    const periodMap = new Map(existing.map((p: ProvPeriod) => [p.label, { ...p }]));

    for (const period of newPeriods) {
      const prev = periodMap.get(period.label);
      periodMap.set(period.label, { ...period, id: prev?.id ?? period.id });
    }

    await supabase.from("credit_cases").update({
      ic_note: { ...icNote, provisional: Array.from(periodMap.values()) },
    }).eq("id", case_id);

    // ── Mark extracted ─────────────────────────────────────────────────────────
    await supabase
      .from("financial_documents")
      .update({ extraction_status: "extracted", extraction_error: null })
      .eq("id", document_id);

    return new Response(
      JSON.stringify({ ok: true, periods_saved: newPeriods.length }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("extract-provisional error:", msg);

    await supabase
      .from("financial_documents")
      .update({ extraction_status: "failed", extraction_error: msg.slice(0, 500) })
      .eq("id", document_id);

    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
