/**
 * Rehbar — Bank Statement Batch Extraction
 * Processes all bank statement documents for a case in parallel via Claude.
 * Uses EdgeRuntime.waitUntil for background execution (no Trigger.dev).
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAI, type FileContent } from "../_shared/ai-caller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

type DocRecord = {
  id: string;
  file_path: string;
  file_type: "pdf" | "image" | "excel";
  file_name: string;
};

const BANK_TOOL_SCHEMA = {
  bank_name:      { type: "string" },
  account_number: { type: "string" },
  months: {
    type: "array",
    items: {
      type: "object",
      properties: {
        month:           { type: "string" },
        opening_balance: { type: ["number", "null"] },
        closing_balance: { type: ["number", "null"] },
        total_credits:   { type: ["number", "null"] },
        total_debits:    { type: ["number", "null"] },
        credit_count:    { type: ["integer", "null"] },
        debit_count:     { type: ["integer", "null"] },
        avg_balance:     { type: ["number", "null"] },
        min_balance:     { type: ["number", "null"] },
        max_balance:     { type: ["number", "null"] },
        bounce_inward:   { type: ["integer", "null"] },
        bounce_outward:  { type: ["integer", "null"] },
        emi_outflows:    { type: ["number", "null"] },
      },
      required: ["month"],
      additionalProperties: false,
    },
  },
};

async function extractSingleDoc(
  doc: DocRecord,
  excelText: string | undefined,
  supabase: any,
  case_id: string,
  user_id: string,
): Promise<number> {
  let files: FileContent[];

  if (doc.file_type === "excel") {
    if (!excelText) throw new Error("No excel_text provided for Excel doc");
    files = [{ type: "text", text: `BANK STATEMENT (TSV):\n\n${excelText.slice(0, 150_000)}` }];
  } else {
    const { data: blob, error } = await (supabase.storage as any).from("case-files").download(doc.file_path);
    if (error || !blob) throw new Error(`Download failed: ${error?.message}`);
    const bytes = new Uint8Array(await (blob as Blob).arrayBuffer());
    let b64 = "";
    const cs = 0x8000;
    for (let i = 0; i < bytes.length; i += cs)
      b64 += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + cs)));
    const base64 = btoa(b64);
    if (doc.file_type === "image") {
      const mime = doc.file_name.match(/\.(jpe?g|webp|gif)/i)
        ? `image/${doc.file_name.split(".").pop()!.replace("jpg", "jpeg")}`
        : "image/png";
      files = [{ type: "image", base64, mime }];
    } else {
      files = [{ type: "pdf", base64 }];
    }
  }

  const args = await callAI({
    systemPrompt: `You are a credit analyst extracting bank statement data for underwriting.
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
    userText: "Extract monthly metrics for every month in this bank statement.",
    files,
    toolName: "submit_bank_data",
    toolDescription: "Submit extracted bank statement data.",
    toolSchema: BANK_TOOL_SCHEMA,
    toolRequired: ["months"],
    maxTokens: 4096,
    retries: 2,
  }) as Record<string, unknown>;

  let inserted = 0;
  for (const m of (args.months as Record<string, unknown>[] ?? [])) {
    if (!m.month) continue;
    await (supabase as any).from("bank_statement_data").upsert({
      case_id, user_id, document_id: doc.id,
      month:           m.month,
      bank_name:       args.bank_name       ?? null,
      account_number:  args.account_number  ?? null,
      opening_balance: m.opening_balance ?? null,
      closing_balance: m.closing_balance ?? null,
      total_credits:   m.total_credits   ?? null,
      total_debits:    m.total_debits    ?? null,
      credit_count:    m.credit_count    ?? null,
      debit_count:     m.debit_count     ?? null,
      avg_balance:     m.avg_balance     ?? null,
      min_balance:     m.min_balance     ?? null,
      max_balance:     m.max_balance     ?? null,
      bounce_inward:   m.bounce_inward   ?? 0,
      bounce_outward:  m.bounce_outward  ?? 0,
      emi_outflows:    m.emi_outflows    ?? null,
    }, { onConflict: "case_id,month,bank_name" } as any);
    inserted++;
  }

  if (inserted === 0) throw new Error("No monthly data found in document");
  return inserted;
}

async function runBatchExtraction(
  case_id: string,
  user_id: string,
  document_ids: string[],
  excel_texts: Record<string, string>,
  supabase: any,
): Promise<void> {
  const { data: docs } = await (supabase as any)
    .from("financial_documents")
    .select("id,file_path,file_type,file_name")
    .in("id", document_ids);

  if (!docs?.length) {
    await (supabase as any).from("financial_documents")
      .update({ extraction_status: "failed", extraction_error: "Documents not found in database" })
      .in("id", document_ids);
    return;
  }

  const results = await Promise.allSettled(
    (docs as DocRecord[]).map(doc =>
      extractSingleDoc(doc, excel_texts[doc.id], supabase, case_id, user_id)
    )
  );

  for (let i = 0; i < (docs as DocRecord[]).length; i++) {
    const doc = (docs as DocRecord[])[i];
    const result = results[i];
    if (result.status === "fulfilled") {
      await (supabase as any).from("financial_documents")
        .update({ extraction_status: "extracted", extraction_error: null })
        .eq("id", doc.id);
      console.log("Extracted bank doc", { doc: doc.file_name, months: result.value });
    } else {
      const err = String(result.reason);
      await (supabase as any).from("financial_documents")
        .update({ extraction_status: "failed", extraction_error: err.slice(0, 500) })
        .eq("id", doc.id);
      console.error("Bank extraction failed", { doc: doc.file_name, error: err });
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const body: {
      case_id: string;
      user_id: string;
      document_ids: string[];
      excel_texts?: Record<string, string>;
    } = await req.json();

    if (!body.case_id || !body.user_id || !body.document_ids?.length) {
      return new Response(JSON.stringify({ error: "Missing required fields: case_id, user_id, document_ids" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Mark all as running synchronously so UI updates immediately
    await (supabase as any).from("financial_documents")
      .update({ extraction_status: "running", extraction_error: null })
      .in("id", body.document_ids);

    // Process all docs in parallel in background
    EdgeRuntime.waitUntil(
      runBatchExtraction(body.case_id, body.user_id, body.document_ids, body.excel_texts ?? {}, supabase)
    );

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("trigger-bank-extraction error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

export {};
