/**
 * Rehbar — Projected Financial Statements PDF Extraction.
 * Extracts full P&L + Balance Sheet + Cash Flow for all fiscal years
 * from a projection document and stores as statement_type="projections"
 * in extracted_financials (one row per fiscal year).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAI }      from "../_shared/ai-caller.ts";
import { getCorsHeaders, handleOptions } from "../_shared/cors.ts";

const LABEL_MAP: Array<[string, string]> = [
  ["revenue",                  "Revenue"],
  ["other_income",             "Other Income"],
  ["total_income",             "Total Income"],
  ["cogs",                     "COGS"],
  ["gross_profit",             "Gross Profit"],
  ["employee_expense",         "Employee Expense"],
  ["finance_cost",             "Finance Cost"],
  ["depreciation",             "Depreciation"],
  ["other_expenses",           "Other Expenses"],
  ["total_indirect_exp",       "Total Indirect Exp"],
  ["pbt",                      "PBT"],
  ["income_tax",               "Income Tax"],
  ["pat",                      "PAT"],
  ["share_capital",            "Share Capital"],
  ["reserves_surplus",         "Reserves & Surplus"],
  ["net_worth",                "Net Worth"],
  ["lt_borrowings",            "LT Borrowings"],
  ["st_borrowings",            "ST Borrowings"],
  ["total_debt",               "Total Debt"],
  ["trade_payables",           "Trade Payables"],
  ["other_current_liabilities","Other Current Liabilities"],
  ["st_provisions",            "ST Provisions"],
  ["total_liabilities",        "Total Liabilities"],
  ["fixed_assets",             "Fixed Assets"],
  ["non_current_investments",  "Non-Current Investments"],
  ["lt_loans_advances",        "LT Loans & Advances"],
  ["total_non_current_assets", "Total Non-Current Assets"],
  ["inventories",              "Inventories"],
  ["trade_receivables",        "Trade Receivables"],
  ["cash_equivalents",         "Cash & Equivalents"],
  ["st_loans_advances",        "ST Loans & Advances"],
  ["other_current_assets",     "Other Current Assets"],
  ["total_current_assets",     "Total Current Assets"],
  ["total_assets",             "Total Assets"],
  ["cfo",                      "CFO"],
  ["cfi",                      "CFI"],
  ["cff",                      "CFF"],
  ["net_cash_change",          "Net Cash Change"],
  ["opening_cash",             "Opening Cash"],
  ["closing_cash",             "Closing Cash"],
];

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

    // ── Download PDF → base64 for native vision ────────────────────────────────
    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from("case-files")
      .download(doc.file_path);

    if (dlErr || !fileBlob) {
      throw new Error(`File download failed: ${dlErr?.message ?? "no blob"}`);
    }

    const bytes  = new Uint8Array(await fileBlob.arrayBuffer());
    // Convert to base64 in chunks to avoid call stack limits on large PDFs
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);
    console.log(`PDF downloaded: ${bytes.length} bytes → ${base64.length} base64 chars`);

    // ── Mark running ───────────────────────────────────────────────────────────
    await supabase
      .from("financial_documents")
      .update({ extraction_status: "running" })
      .eq("id", document_id);

    // ── Claude extraction call ─────────────────────────────────────────────────
    const fyItemSchema = {
      type: "object" as const,
      properties: {
        year:                     { type: "integer" },
        revenue:                  { type: ["number","null"] },
        other_income:             { type: ["number","null"] },
        total_income:             { type: ["number","null"] },
        cogs:                     { type: ["number","null"] },
        gross_profit:             { type: ["number","null"] },
        employee_expense:         { type: ["number","null"] },
        finance_cost:             { type: ["number","null"] },
        depreciation:             { type: ["number","null"] },
        other_expenses:           { type: ["number","null"] },
        total_indirect_exp:       { type: ["number","null"] },
        pbt:                      { type: ["number","null"] },
        income_tax:               { type: ["number","null"] },
        pat:                      { type: ["number","null"] },
        share_capital:            { type: ["number","null"] },
        reserves_surplus:         { type: ["number","null"] },
        net_worth:                { type: ["number","null"] },
        lt_borrowings:            { type: ["number","null"] },
        st_borrowings:            { type: ["number","null"] },
        total_debt:               { type: ["number","null"] },
        trade_payables:           { type: ["number","null"] },
        other_current_liabilities:{ type: ["number","null"] },
        st_provisions:            { type: ["number","null"] },
        total_liabilities:        { type: ["number","null"] },
        fixed_assets:             { type: ["number","null"] },
        non_current_investments:  { type: ["number","null"] },
        lt_loans_advances:        { type: ["number","null"] },
        total_non_current_assets: { type: ["number","null"] },
        inventories:              { type: ["number","null"] },
        trade_receivables:        { type: ["number","null"] },
        cash_equivalents:         { type: ["number","null"] },
        st_loans_advances:        { type: ["number","null"] },
        other_current_assets:     { type: ["number","null"] },
        total_current_assets:     { type: ["number","null"] },
        total_assets:             { type: ["number","null"] },
        cfo:                      { type: ["number","null"] },
        cfi:                      { type: ["number","null"] },
        cff:                      { type: ["number","null"] },
        net_cash_change:          { type: ["number","null"] },
        opening_cash:             { type: ["number","null"] },
        closing_cash:             { type: ["number","null"] },
      },
      required: ["year"],
      additionalProperties: false,
    };

    const args = await callAI({
      model: "claude-sonnet-4-6",
      maxTokens: 8192,
      timeoutMs: 180_000,
      retries: 1,
      systemPrompt:
        "You are a financial data extractor reading a projected financial statement PDF. " +
        "The document has a multi-column table layout with one column per fiscal year (e.g. FY 2025-26, FY 2026-27, FY 2027-28, FY 2028-29). " +
        "Read each column independently and carefully — DO NOT merge or concatenate numbers across columns. " +
        "Extract each figure exactly as printed for each fiscal year column. " +
        "Indian-format numbers like 30,91,77,733 are plain integers — strip commas (result: 309177733). " +
        "FY 2025-26 means year=2026, FY 2026-27 means year=2027, etc. " +
        "Do not invent values — omit fields not present. " +
        "Total Debt = LT Borrowings + ST Borrowings. Net Worth = Share Capital + Reserves & Surplus. " +
        "CFO = Cash from Operations, CFI = Cash from Investing, CFF = Cash from Financing.",
      userText:
        "Extract all P&L, Balance Sheet, and Cash Flow figures for every fiscal year column in this projected financial statement. " +
        "Each fiscal year is a separate column — read each column independently. " +
        "Return one entry per fiscal year with all available fields.",
      files: [{ type: "pdf", base64 }],
      toolName: "submit_projection_data",
      toolDescription: "Submit extracted projected financial data — one entry per fiscal year",
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
        JSON.stringify({ error: "No projection data extracted" }),
        { status: 422, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // ── Map to line_items and upsert per fiscal year ───────────────────────────
    let upserted = 0;
    for (const fyEntry of fiscalYears) {
      const year = fyEntry.year as number;
      if (!year) continue;

      const lineItems = LABEL_MAP
        .filter(([key]) => fyEntry[key] != null)
        .map(([key, label]) => ({
          label,
          value:         fyEntry[key] as number,
          confidence:    92,
          reviewed:      false,
          override_value: null,
          note:          "",
        }));

      if (lineItems.length === 0) continue;

      const { error: upsertErr } = await supabase.from("extracted_financials").upsert(
        {
          case_id,
          user_id,
          document_id,
          fiscal_year:    year,
          statement_type: "projections",
          line_items:     lineItems,
          confirmed:      false,
          unit:           (args.unit as string) ?? "INR",
        },
        { onConflict: "case_id,fiscal_year,statement_type" },
      );

      if (upsertErr) {
        console.error(`upsert error FY${year}:`, upsertErr.message);
        continue;
      }
      upserted++;
    }

    // ── Mark extracted ─────────────────────────────────────────────────────────
    await supabase
      .from("financial_documents")
      .update({ extraction_status: "extracted", extraction_error: null })
      .eq("id", document_id);

    return new Response(
      JSON.stringify({ ok: true, fiscal_years_extracted: upserted }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("extract-projections error:", msg);

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
