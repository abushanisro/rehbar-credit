/**
 * Rehbar — Case Metadata Extraction
 * Claude reads all uploaded documents in a single pass and extracts intake fields.
 * Accepts either:
 *   { files: FileSpec[] }           — multi-file (new)
 *   { file_path, file_type, ... }   — single file (legacy compat)
 */

import { createClient }             from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAI, type FileContent } from "../_shared/ai-caller.ts";
import { getCorsHeaders, handleOptions } from "../_shared/cors.ts";

type FileSpec = {
  file_path: string;
  file_type: "pdf" | "image" | "excel";
  file_name: string;
  excel_text?: string;
};

function imageMime(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif"))  return "image/gif";
  return "image/png";
}

async function specToContent(supabase: ReturnType<typeof createClient>, spec: FileSpec): Promise<FileContent | null> {
  if (spec.file_type === "excel") {
    if (!spec.excel_text?.trim()) return null;
    return { type: "text", text: `[Document: ${spec.file_name}]\n${spec.excel_text.slice(0, 150_000)}` };
  }
  const { data: file, error } = await (supabase.storage as any).from("case-files").download(spec.file_path);
  if (error || !file) {
    console.error("Download failed:", spec.file_name, error?.message);
    return null;
  }
  const bytes = new Uint8Array(await (file as Blob).arrayBuffer());
  let b64 = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    b64 += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  const base64 = btoa(b64);
  return spec.file_type === "image"
    ? { type: "image", base64, mime: imageMime(spec.file_name) }
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
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });

    // ── Normalise payload to a file list ──────────────────────────────────────
    const body = await req.json();
    let fileSpecs: FileSpec[];

    if (Array.isArray(body.files) && body.files.length > 0) {
      fileSpecs = body.files as FileSpec[];
    } else if (body.file_path && body.file_type && body.file_name) {
      // Legacy single-file format
      fileSpecs = [{ file_path: body.file_path, file_type: body.file_type, file_name: body.file_name, excel_text: body.excel_text }];
    } else {
      return new Response(JSON.stringify({ error: "Provide files[] array or legacy file_path/file_type/file_name" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ── Build FileContent[] for Claude ────────────────────────────────────────
    const files: FileContent[] = [];
    for (const spec of fileSpecs) {
      const content = await specToContent(supabase, spec);
      if (content) files.push(content);
    }

    if (files.length === 0) {
      return new Response(JSON.stringify({ error: "No valid files could be loaded" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ── Extract all fields (single Claude pass across all documents) ──────────
    const docCount = files.length;
    const extracted = await callAI({
      systemPrompt: `You are a senior credit analyst at Rehbar Financial Services (Islamic finance / NBFC).
You will receive ${docCount} document${docCount > 1 ? "s" : ""}. Read and analyse ALL of them end-to-end.
Extract every piece of information relevant to a credit case intake form.
When multiple documents are provided, synthesise — later documents may supplement or correct earlier ones.
Use context and inference — derive fields even when not explicitly labelled.

PRODUCT TYPE (use exact keys): operating_lease, finance_lease, project_finance, trade_finance, pls, home_loan, employee_car_lease, other
LEGAL CONSTITUTION (exact strings): Pvt Ltd, Public Ltd, Partnership, LLP, Proprietorship, Individual
INDUSTRY (pick closest): Agriculture & Food Processing, Automotive, Chemicals & Petrochemicals, Construction & Infrastructure, Education, Energy & Utilities, Financial Services, Healthcare & Pharmaceuticals, Hospitality & Tourism, IT & Technology, Logistics & Transportation, Manufacturing, Media & Entertainment, Real Estate, Retail & E-commerce, Telecom, Textile & Apparel, Trading, Other

RULES:
1. deal_amount in INR Crores (if Lakhs: divide by 100).
2. tenure_months as integer.
3. expected_irr as percentage number (e.g. 18 for 18%).
4. promoter_details: names, designation, shareholding %, background.
5. summary: 3-5 sentences on the business and financial position synthesised across all documents.
6. If product_type is unclear, omit it entirely — do NOT default to "other".
7. For website, industry, year_established: infer from document context and company name if not explicit.`,
      userText: `Analyse ${docCount > 1 ? "all " + docCount + " documents" : "this document"} completely and extract all case intake fields. Be thorough — read every page of every document.`,
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
      status: 200, headers: { ...cors, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("extract-case-meta error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unexpected error" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
