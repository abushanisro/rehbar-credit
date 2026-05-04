/**
 * Rehbar — Case Metadata Extraction
 * Claude reads the full document and extracts all intake fields in a single pass.
 */

import { createClient }             from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAI, type FileContent } from "../_shared/ai-caller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function imageMime(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif"))  return "image/gif";
  return "image/png";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

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
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const body: {
      file_path: string;
      file_type: "pdf" | "image" | "excel";
      file_name: string;
      excel_text?: string;
    } = await req.json();
    const { file_path, file_type, file_name, excel_text } = body;

    if (!file_path || !file_type || !file_name) return new Response(JSON.stringify({ error: "Missing fields" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    // ── Build file content ─────────────────────────────────────────────────────
    let files: FileContent[];
    if (file_type === "excel") {
      if (!excel_text?.trim()) return new Response(JSON.stringify({ error: "Excel text payload missing" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
      files = [{ type: "text", text: `DOCUMENT (Excel, TSV):\n\n${excel_text.slice(0, 150_000)}` }];
    } else {
      const { data: file, error: dlErr } = await supabase.storage.from("case-files").download(file_path);
      if (dlErr || !file) return new Response(JSON.stringify({ error: "File download failed: " + dlErr?.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
      const bytes = new Uint8Array(await file.arrayBuffer());
      let b64 = "";
      for (let i = 0; i < bytes.length; i += 0x8000)
        b64 += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
      const base64 = btoa(b64);
      files = file_type === "image"
        ? [{ type: "image", base64, mime: imageMime(file_name) }]
        : [{ type: "pdf", base64 }];
    }

    // ── Extract all fields (Claude) ────────────────────────────────────────────
    const extracted = await callAI({
      systemPrompt: `You are a senior credit analyst at Rehbar Financial Services (Islamic finance / NBFC).
Read and analyse the ENTIRE document. Extract every piece of information relevant to a credit case intake form.
Use context and inference — derive fields even when not explicitly labelled.

PRODUCT TYPE (use exact keys): operating_lease, finance_lease, project_finance, trade_finance, pls, home_loan, employee_car_lease, other
LEGAL CONSTITUTION (exact strings): Pvt Ltd, Public Ltd, Partnership, LLP, Proprietorship, Individual
INDUSTRY (pick closest): Agriculture & Food Processing, Automotive, Chemicals & Petrochemicals, Construction & Infrastructure, Education, Energy & Utilities, Financial Services, Healthcare & Pharmaceuticals, Hospitality & Tourism, IT & Technology, Logistics & Transportation, Manufacturing, Media & Entertainment, Real Estate, Retail & E-commerce, Telecom, Textile & Apparel, Trading, Other

RULES:
1. deal_amount in INR Crores (if Lakhs: divide by 100).
2. tenure_months as integer.
3. expected_irr as percentage number (e.g. 18 for 18%).
4. promoter_details: names, designation, shareholding %, background.
5. summary: 3-5 sentences on the document and financial health.
6. If product_type is unclear, omit it entirely — do NOT default to "other".
7. For website, industry, year_established: infer from document context and company name if not explicit.`,
      userText: "Analyse this document completely and extract all case intake fields. Be thorough — read every page.",
      files,
      toolName: "submit_case_fields",
      toolDescription: "Submit all extracted case intake fields.",
      toolSchema: {
        client_name:         { type: "string" },
        product_type:        { type: "string", enum: ["operating_lease","finance_lease","project_finance","trade_finance","pls","home_loan","employee_car_lease"] },
        product_type_custom: { type: "string" },
        legal_constitution:  { type: "string", enum: ["Pvt Ltd","Public Ltd","Partnership","LLP","Proprietorship","Individual"] },
        industry:            { type: "string" },
        year_established:    { type: "integer" },
        promoter_details:    { type: "string" },
        deal_amount:         { type: "number", description: "INR Crores" },
        tenure_months:       { type: "integer" },
        expected_irr:        { type: "number", description: "Percentage, e.g. 18" },
        end_use:             { type: "string" },
        collateral_summary:  { type: "string" },
        strategic_rationale: { type: "string" },
        website:             { type: "string" },
        summary:             { type: "string" },
        confidence:          { type: "integer", minimum: 0, maximum: 100 },
      },
      toolRequired: ["summary", "confidence"],
      maxTokens: 4096,
      retries: 1,
    });

    return new Response(JSON.stringify({ ok: true, extracted }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("extract-case-meta error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unexpected error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
