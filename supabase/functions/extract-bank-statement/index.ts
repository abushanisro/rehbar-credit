/**
 * Rehbar — Bank Statement Extraction
 * Extracts monthly bank metrics from PDF/Excel bank statements via Claude Sonnet 4.6.
 */

import { createClient }             from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAI, type FileContent } from "../_shared/ai-caller.ts";
import { getCorsHeaders, handleOptions } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  const cors = getCorsHeaders(req);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });

  // Parse body up-front so document_id is available in the catch block
  const body = await req.json().catch(() => ({})) as { case_id?: string; document_id?: string; excel_text?: string };
  const { case_id, document_id } = body;
  if (!case_id || !document_id) return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });

    const { data: doc } = await supabase.from("financial_documents").select("*").eq("id", document_id).single();
    if (!doc) return new Response(JSON.stringify({ error: "Document not found" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });

    await supabase.from("financial_documents").update({ extraction_status: "running" }).eq("id", document_id);

    let files: FileContent[];
    if (doc.file_type === "excel") {
      const text = (body.excel_text ?? "").slice(0, 150_000);
      files = [{ type: "text", text: `BANK STATEMENT (TSV):\n\n${text}` }];
    } else {
      const { data: file } = await supabase.storage.from("case-files").download(doc.file_path);
      if (!file) throw new Error("File download failed");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let b64 = ""; const cs = 0x8000;
      for (let i = 0; i < bytes.length; i += cs) b64 += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + cs)));
      const mime = doc.file_type === "image" ? "image/png" : "application/pdf";
      files = mime === "application/pdf"
        ? [{ type: "pdf", base64: btoa(b64) }]
        : [{ type: "image", base64: btoa(b64), mime }];
    }

    interface BankExtractionResult {
      bank_name?: string;
      account_number?: string;
      months: Array<{
        month: string;
        opening_balance?: number | null;
        closing_balance?: number | null;
        total_credits?: number | null;
        total_debits?: number | null;
        credit_count?: number | null;
        debit_count?: number | null;
        avg_balance?: number | null;
        min_balance?: number | null;
        max_balance?: number | null;
        bounce_inward?: number | null;
        bounce_outward?: number | null;
        emi_outflows?: number | null;
      }>;
    }

    const args = await callAI({
      systemPrompt: `You are a senior credit analyst extracting bank statement data for credit underwriting.
Extract monthly metrics for EVERY month visible in the statement.
Rules:
1. Return one entry per month (format YYYY-MM, e.g. "2024-01").
2. Total Credits = sum of all credit/inflow transactions that month.
3. Total Debits = sum of all debit/outflow transactions that month.
4. Bounce Inward = number of inward cheque return / bounce transactions.
5. EMI Outflows = total of recurring loan EMI / NACH debit transactions.
6. Average Balance = average of daily EOD balances if available, else estimate from opening+closing.
7. Extract bank name and account number if visible.
8. Do NOT invent data — if a field is absent, omit it.`,
      userText: "Extract monthly bank statement metrics for every month in this document.",
      files,
      toolName: "submit_bank_data",
      toolDescription: "Submit extracted bank statement data.",
      toolSchema: {
        bank_name: { type: "string" },
        account_number: { type: "string" },
        months: {
          type: "array",
          items: {
            type: "object",
            properties: {
              month: { type: "string" },
              opening_balance: { type: ["number", "null"] },
              closing_balance: { type: ["number", "null"] },
              total_credits: { type: ["number", "null"] },
              total_debits: { type: ["number", "null"] },
              credit_count: { type: ["integer", "null"] },
              debit_count: { type: ["integer", "null"] },
              avg_balance: { type: ["number", "null"] },
              min_balance: { type: ["number", "null"] },
              max_balance: { type: ["number", "null"] },
              bounce_inward: { type: ["integer", "null"] },
              bounce_outward: { type: ["integer", "null"] },
              emi_outflows: { type: ["number", "null"] },
            },
            required: ["month"],
            additionalProperties: false,
          },
        },
      },
      toolRequired: ["months"],
      // Bank statement output is small — monthly summaries don't need 8192 tokens
      maxTokens: 4096,
      retries: 2,
    }) as unknown as BankExtractionResult;

    let inserted = 0;
    for (const m of args.months ?? []) {
      if (!m.month) continue;
      await supabase.from("bank_statement_data").upsert({
        case_id, user_id: user.id, document_id,
        month: m.month,
        bank_name: args.bank_name ?? null,
        account_number: args.account_number ?? null,
        opening_balance: m.opening_balance ?? null,
        closing_balance: m.closing_balance ?? null,
        total_credits: m.total_credits ?? null,
        total_debits: m.total_debits ?? null,
        credit_count: m.credit_count ?? null,
        debit_count: m.debit_count ?? null,
        avg_balance: m.avg_balance ?? null,
        min_balance: m.min_balance ?? null,
        max_balance: m.max_balance ?? null,
        bounce_inward: m.bounce_inward ?? 0,
        bounce_outward: m.bounce_outward ?? 0,
        emi_outflows: m.emi_outflows ?? null,
      }, { onConflict: "case_id,month,bank_name" });
      inserted++;
    }

    if (inserted === 0) {
      await supabase.from("financial_documents").update({ extraction_status: "failed", extraction_error: "No monthly data detected" }).eq("id", document_id);
      return new Response(JSON.stringify({ error: "No data extracted" }), { status: 422, headers: { ...cors, "Content-Type": "application/json" } });
    }

    await supabase.from("financial_documents").update({ extraction_status: "extracted", extraction_error: null }).eq("id", document_id);
    return new Response(JSON.stringify({ ok: true, months_extracted: inserted, bank_name: args.bank_name }), { headers: { ...cors, "Content-Type": "application/json" } });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("extract-bank-statement error:", msg);
    // Always flip to failed so the document never stays stuck at "running"
    await supabase.from("financial_documents")
      .update({ extraction_status: "failed", extraction_error: msg })
      .eq("id", document_id);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
