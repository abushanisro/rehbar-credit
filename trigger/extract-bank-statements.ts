/**
 * Rehbar — Bank Statement Batch Extraction (Trigger.dev)
 *
 * Processes ALL bank statement documents for a case IN PARALLEL.
 * Each doc gets its own Claude call running concurrently — so 6 docs
 * finish in ~60 s instead of 6 × 60 s = 360 s.
 *
 * Uses claude-haiku for speed (pure table extraction, no deep reasoning needed).
 *
 * Required env vars (same as analyze-financial-documents):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
 */

import { task, logger } from "@trigger.dev/sdk/v3";
import { createClient }  from "@supabase/supabase-js";

const CLAUDE_MODEL  = "claude-haiku-4-5-20251001";
const CLAUDE_API    = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VER = "2023-06-01";

type DocRecord = {
  id: string;
  file_path: string;
  file_type: "pdf" | "image" | "excel";
  file_name: string;
};

async function downloadAsBase64(supabase: ReturnType<typeof createClient>, path: string): Promise<string> {
  const { data, error } = await (supabase.storage as any).from("case-files").download(path);
  if (error || !data) throw new Error(`Download failed: ${path} — ${error?.message}`);
  const buf = await (data as Blob).arrayBuffer();
  return Buffer.from(buf).toString("base64");
}

const BANK_TOOL_SCHEMA = {
  type: "object",
  properties: {
    bank_name:      { type: "string" },
    account_number: { type: "string" },
    months: {
      type: "array",
      items: {
        type: "object",
        properties: {
          month:            { type: "string" },
          opening_balance:  { type: ["number", "null"] },
          closing_balance:  { type: ["number", "null"] },
          total_credits:    { type: ["number", "null"] },
          total_debits:     { type: ["number", "null"] },
          credit_count:     { type: ["integer", "null"] },
          debit_count:      { type: ["integer", "null"] },
          avg_balance:      { type: ["number", "null"] },
          min_balance:      { type: ["number", "null"] },
          max_balance:      { type: ["number", "null"] },
          bounce_inward:    { type: ["integer", "null"] },
          bounce_outward:   { type: ["integer", "null"] },
          emi_outflows:     { type: ["number", "null"] },
        },
        required: ["month"],
        additionalProperties: false,
      },
    },
  },
  required: ["months"],
  additionalProperties: false,
};

async function extractSingleDoc(
  doc: DocRecord,
  excelText: string | undefined,
  apiKey: string,
  supabase: ReturnType<typeof createClient>,
  case_id: string,
  user_id: string,
): Promise<{ months: number }> {
  let content: unknown[];

  if (doc.file_type === "excel") {
    if (!excelText) throw new Error("No excel_text provided for Excel doc");
    content = [{ type: "text", text: `BANK STATEMENT (TSV):\n\n${excelText.slice(0, 150_000)}` }];
  } else {
    const base64 = await downloadAsBase64(supabase, doc.file_path);
    if (doc.file_type === "image") {
      const mime = doc.file_name.match(/\.(jpe?g|webp|gif)/i) ? `image/${doc.file_name.split(".").pop()!.replace("jpg","jpeg")}` : "image/png";
      content = [{ type: "image", source: { type: "base64", media_type: mime, data: base64 } }];
    } else {
      content = [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }];
    }
  }

  const res = await fetch(CLAUDE_API, {
    method: "POST",
    signal: AbortSignal.timeout(90_000),
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VER,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: `You are a credit analyst extracting bank statement data for underwriting.
Extract monthly metrics for EVERY month visible in the document.
Rules:
1. Format months as YYYY-MM (e.g. "2024-07").
2. Total Credits = sum of all inflow/credit transactions that month.
3. Total Debits = sum of all outflow/debit transactions that month.
4. Bounce Inward = count of inward cheque return/ECS bounce transactions.
5. EMI Outflows = total of recurring NACH/EMI debit transactions.
6. Average Balance = average of daily EOD balances; estimate from (opening+closing)/2 if unavailable.
7. Extract bank name and account number if visible.
8. Do NOT invent data — omit fields that are absent.`,
      messages: [{ role: "user", content: [{ type: "text", text: "Extract monthly metrics for every month in this bank statement." }, ...content] }],
      tools: [{ name: "submit_bank_data", description: "Submit extracted bank statement data.", input_schema: BANK_TOOL_SCHEMA }],
      tool_choice: { type: "tool", name: "submit_bank_data" },
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Claude API ${res.status}: ${txt.slice(0, 200)}`);
  }

  const json = await res.json();
  const block = (json.content as { type: string; input?: unknown }[])?.find(c => c.type === "tool_use");
  if (!block?.input) throw new Error(`No tool_use in Claude response (stop_reason: ${json.stop_reason})`);

  const args = block.input as { bank_name?: string; account_number?: string; months?: { month: string; [k: string]: unknown }[] };
  let inserted = 0;
  for (const m of args.months ?? []) {
    if (!m.month) continue;
    await (supabase as any).from("bank_statement_data").upsert({
      case_id, user_id, document_id: doc.id,
      month: m.month,
      bank_name:        args.bank_name        ?? null,
      account_number:   args.account_number   ?? null,
      opening_balance:  (m.opening_balance  as number) ?? null,
      closing_balance:  (m.closing_balance  as number) ?? null,
      total_credits:    (m.total_credits    as number) ?? null,
      total_debits:     (m.total_debits     as number) ?? null,
      credit_count:     (m.credit_count     as number) ?? null,
      debit_count:      (m.debit_count      as number) ?? null,
      avg_balance:      (m.avg_balance      as number) ?? null,
      min_balance:      (m.min_balance      as number) ?? null,
      max_balance:      (m.max_balance      as number) ?? null,
      bounce_inward:    (m.bounce_inward    as number) ?? 0,
      bounce_outward:   (m.bounce_outward   as number) ?? 0,
      emi_outflows:     (m.emi_outflows     as number) ?? null,
    }, { onConflict: "case_id,month,bank_name" });
    inserted++;
  }

  if (inserted === 0) throw new Error("No monthly data found in document");
  return { months: inserted };
}

export const extractBankStatements = task({
  id: "extract-bank-statements",
  maxDuration: 300,
  run: async (payload: {
    case_id: string;
    user_id: string;
    document_ids: string[];
    excel_texts?: Record<string, string>;
  }) => {
    const { case_id, user_id, document_ids, excel_texts = {} } = payload;

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const apiKey = process.env.ANTHROPIC_API_KEY!;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

    logger.info("Bank statement batch extraction started", { case_id, docs: document_ids.length });

    // Mark all as running and increment retry_count
    await (supabase as any).from("financial_documents")
      .update({ extraction_status: "running", extraction_error: null })
      .in("id", document_ids);

    await (supabase as any).rpc("increment_retry_count", { doc_ids: document_ids }).maybeSingle();

    const { data: docs } = await (supabase as any)
      .from("financial_documents")
      .select("id,file_path,file_type,file_name")
      .in("id", document_ids);

    if (!docs?.length) throw new Error("No documents found");

    // Run ALL docs in parallel — main speed gain vs sequential edge-fn calls
    const results = await Promise.allSettled(
      (docs as DocRecord[]).map(doc =>
        extractSingleDoc(doc, excel_texts[doc.id], apiKey, supabase, case_id, user_id)
      )
    );

    let totalMonths = 0;
    for (let i = 0; i < docs.length; i++) {
      const doc = (docs as DocRecord[])[i];
      const result = results[i];
      if (result.status === "fulfilled") {
        totalMonths += result.value.months;
        await (supabase as any).from("financial_documents")
          .update({ extraction_status: "extracted", extraction_error: null })
          .eq("id", doc.id);
        logger.info("Extracted", { doc: doc.file_name, months: result.value.months });
      } else {
        const err = String(result.reason);
        await (supabase as any).from("financial_documents")
          .update({ extraction_status: "failed", extraction_error: err })
          .eq("id", doc.id);
        logger.error("Failed", { doc: doc.file_name, error: err });
      }
    }

    const failed = results.filter(r => r.status === "rejected").length;
    logger.info("Batch complete", { totalMonths, failed });

    return { ok: true, documents: docs.length, total_months: totalMonths, failed };
  },
});
