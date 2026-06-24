/**
 * Rehbar — CIBIL / CRIF Credit Report Extraction via Claude Sonnet.
 * Handles both:
 *   • Consumer CRIF High Mark PERFORM reports (individual, score 300–900)
 *   • Commercial TransUnion CIBIL reports (company, CMR rank)
 * Auto-detects report type with a first AI pass, then runs full extraction.
 */

import { createClient }                  from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getDocumentProxy, extractText } from "npm:unpdf@0.11.0";
import { callAI }                        from "../_shared/ai-caller.ts";
import { getCorsHeaders, handleOptions } from "../_shared/cors.ts";

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

    // ── Download PDF → extract text (bypasses Claude's XFA/PDF parser) ────────
    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from("case-files")
      .download(doc.file_path);

    if (dlErr || !fileBlob) {
      throw new Error(`File download failed: ${dlErr?.message ?? "no blob"}`);
    }

    const bytes = new Uint8Array(await fileBlob.arrayBuffer());
    const pdfDoc = await getDocumentProxy(bytes);
    const { text: pdfText } = await extractText(pdfDoc, { mergePages: true });
    if (!pdfText || pdfText.trim().length < 50) {
      throw new Error("PDF text extraction returned empty content — PDF may be scanned/image-only.");
    }
    console.log(`PDF text extracted: ${pdfText.length} chars`);

    // ── Mark running ───────────────────────────────────────────────────────────
    await supabase
      .from("financial_documents")
      .update({ extraction_status: "running" })
      .eq("id", document_id);

    // ── Call A: Detect report type ─────────────────────────────────────────────
    const typeResult = await callAI({
      model: "claude-sonnet-4-6",
      maxTokens: 256,
      timeoutMs: 30_000,
      retries: 1,
      systemPrompt:
        "You are a credit report classifier. Identify whether the PDF is a " +
        "consumer individual credit report (CRIF High Mark PERFORM, individual borrower, numeric score 300–900) " +
        "or a commercial business credit report (TransUnion CIBIL commercial, company entity, CMR rank like CMR-2).",
      userText: "Classify this credit report as consumer or commercial.",
      files: [{ type: "text", text: pdfText }],
      toolName: "classify_report",
      toolDescription: "Classify the credit report type",
      toolRequired: ["report_type"],
      toolSchema: {
        report_type: { type: "string", enum: ["consumer", "commercial"] },
      },
    });

    const reportType = (typeResult.report_type as string) === "commercial" ? "commercial" : "consumer";

    // ── Call B: Full extraction ────────────────────────────────────────────────
    let args: Record<string, unknown>;

    if (reportType === "consumer") {
      args = await callAI({
        model: "claude-sonnet-4-6",
        maxTokens: 8192,
        timeoutMs: 120_000,
        retries: 1,
        systemPrompt:
          "You are a financial data extractor. Extract all information from this CRIF High Mark Consumer PERFORM Credit Report exactly as shown. " +
          "Parse all Indian-format numbers (e.g. 12,53,42,720) as plain integers in INR. " +
          "For payment history codes: 000=current, 900+=days past due. " +
          "Mark has_delinquency=true if any account shows SUB/DBT/LOS asset class or overdue_amount>0.",
        userText: "Extract all data from this CRIF High Mark Consumer PERFORM Credit Report.",
        files: [{ type: "text", text: pdfText }],
        toolName: "submit_consumer_cibil",
        toolDescription: "Extract all data from this CRIF High Mark Consumer Credit Report",
        toolRequired: ["report_type", "borrower_name", "total_accounts", "active_accounts", "overdue_accounts", "accounts"],
        toolSchema: {
          report_type:      { type: "string", enum: ["consumer"] },
          borrower_name:    { type: "string" },
          chm_ref:          { type: "string" },
          report_date:      { type: "string", description: "DD-MM-YYYY" },
          pan:              { type: "string" },
          phone:            { type: "string" },
          dob:              { type: "string" },
          father_name:      { type: "string" },
          address:          { type: "string" },
          perform_score:    { type: ["integer", "null"], description: "CRIF PERFORM CONSUMER score 300-900" },
          score_factors:    { type: "array", items: { type: "string" } },
          total_accounts:   { type: "integer" },
          active_accounts:  { type: "integer" },
          overdue_accounts: { type: "integer" },
          current_balance:  { type: ["number", "null"], description: "Total current balance INR" },
          total_disbursed:  { type: ["number", "null"], description: "Total Amt Disbd/High Credit INR" },
          inquiries_24m:    { type: "integer" },
          new_accounts_6m:  { type: "integer" },
          accounts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                seq:                { type: "integer" },
                account_type:       { type: "string" },
                status:             { type: "string", enum: ["ACTIVE", "CLOSED"] },
                ownership:          { type: "string", enum: ["INDIVIDUAL", "JOINT", "GUARANTOR"] },
                disbursed_date:     { type: "string" },
                disbursed_amount:   { type: ["number", "null"] },
                current_balance:    { type: ["number", "null"] },
                overdue_amount:     { type: ["number", "null"] },
                tenure_months:      { type: ["integer", "null"] },
                installment_amount: { type: ["number", "null"] },
                last_payment_date:  { type: "string" },
                has_delinquency:    { type: "boolean" },
                suit_filed:         { type: "boolean" },
                writeoff_amount:    { type: ["number", "null"] },
                asset_class:        { type: "string", description: "Worst asset class: STD, SUB, DBT, LOS" },
              },
              additionalProperties: false,
            },
          },
        },
      });

    } else {
      // commercial
      args = await callAI({
        model: "claude-sonnet-4-6",
        maxTokens: 8192,
        timeoutMs: 120_000,
        retries: 1,
        systemPrompt:
          "You are a financial data extractor. Extract all information from this TransUnion CIBIL Commercial Credit Report exactly as shown. " +
          "Parse all Indian-format numbers (e.g. 17,25,91,065) as plain integers in INR. " +
          "The CIBIL Rank is a CMR rank like CMR-1 through CMR-10 (lower number = better credit). " +
          "Extract all credit facilities from Section 10 and outstanding by lender type from Section 4.",
        userText: "Extract all data from this TransUnion CIBIL Commercial Credit Report.",
        files: [{ type: "text", text: pdfText }],
        toolName: "submit_commercial_cibil",
        toolDescription: "Extract all data from this TransUnion CIBIL Commercial Credit Report",
        toolRequired: ["report_type", "entity_name", "cibil_rank"],
        toolSchema: {
          report_type:          { type: "string", enum: ["commercial"] },
          entity_name:          { type: "string" },
          pan:                  { type: "string" },
          cin:                  { type: "string" },
          legal_constitution:   { type: "string" },
          industry_type:        { type: "string" },
          incorporation_date:   { type: "string" },
          bureau_ref_no:        { type: "string" },
          report_order_no:      { type: "string" },
          report_date:          { type: "string", description: "DD-MM-YYYY or DD-MON-YYYY" },
          cibil_rank:           { type: "string", description: "e.g. CMR-2" },
          rank_exclusion_reasons: { type: "array", items: { type: "string" } },
          total_lenders:           { type: "integer" },
          total_credit_facilities: { type: "integer" },
          open_credit_facilities:  { type: "integer" },
          total_outstanding:       { type: ["number", "null"], description: "Total outstanding INR across all lenders" },
          delinquent_borrower_cf:  { type: "integer" },
          delinquent_outstanding:  { type: ["number", "null"] },
          enquiries: {
            type: "object",
            properties: {
              last_30d:      { type: "integer" },
              last_31_90d:   { type: "integer" },
              last_91_180d:  { type: "integer" },
              last_181_365d: { type: "integer" },
              gt_365d:       { type: "integer" },
            },
          },
          outstanding_by_type: {
            type: "array",
            items: {
              type: "object",
              properties: {
                lender_type:   { type: "string" },
                outstanding:   { type: ["number", "null"] },
                open_cf:       { type: "integer" },
                delinquent_cf: { type: "integer" },
              },
              additionalProperties: false,
            },
          },
          credit_facilities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                lender:            { type: "string" },
                facility_type:     { type: "string" },
                sanctioned_amount: { type: ["number", "null"] },
                outstanding:       { type: ["number", "null"] },
                overdue:           { type: ["number", "null"] },
                asset_class:       { type: "string" },
                opened_date:       { type: "string" },
                status:            { type: "string" },
                dpd_worst:         { type: ["integer", "null"] },
              },
              additionalProperties: false,
            },
          },
        },
      });
    }

    // ── Normalise report_date → YYYY-MM-DD ────────────────────────────────────
    const rawDate = (args.report_date as string | undefined) ?? null;
    let pgDate: string | null = null;
    if (rawDate) {
      if (/^\d{2}-\d{2}-\d{4}$/.test(rawDate)) {
        const [dd, mm, yyyy] = rawDate.split("-");
        pgDate = `${yyyy}-${mm}-${dd}`;
      }
      const monMap: Record<string, string> = {
        JAN:"01",FEB:"02",MAR:"03",APR:"04",MAY:"05",JUN:"06",
        JUL:"07",AUG:"08",SEP:"09",OCT:"10",NOV:"11",DEC:"12",
      };
      const monMatch = rawDate.match(/^(\d{2})-([A-Z]{3})-(\d{4})$/);
      if (monMatch) {
        pgDate = `${monMatch[3]}-${monMap[monMatch[2]] ?? "01"}-${monMatch[1]}`;
      }
    }

    // ── Upsert into cibil_report_data ─────────────────────────────────────────
    const dbRaw = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>;
    };

    const borrowerName = reportType === "commercial"
      ? (args.entity_name as string | undefined) ?? null
      : (args.borrower_name as string | undefined) ?? null;

    const rankStr = reportType === "commercial"
      ? (args.cibil_rank as string | undefined) ?? null
      : args.perform_score != null ? String(args.perform_score) : null;

    const totalOutstanding = reportType === "commercial"
      ? (args.total_outstanding as number | null) ?? null
      : (args.current_balance as number | null) ?? null;

    const { error: upsertErr } = await dbRaw.from("cibil_report_data").upsert(
      {
        case_id,
        document_id,
        user_id,
        report_data:       args,
        borrower_name:     borrowerName,
        report_date:       pgDate,
        cibil_rank:        rankStr,
        total_outstanding: totalOutstanding,
      },
      { onConflict: "case_id,document_id" },
    );

    if (upsertErr) throw new Error(`cibil_report_data upsert failed: ${upsertErr.message}`);

    // ── Mark extracted ─────────────────────────────────────────────────────────
    await supabase
      .from("financial_documents")
      .update({ extraction_status: "extracted", extraction_error: null })
      .eq("id", document_id);

    return new Response(
      JSON.stringify({ ok: true, report_type: reportType, report: args }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("extract-cibil error:", msg);

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
