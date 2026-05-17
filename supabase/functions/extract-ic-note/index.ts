/**
 * Rehbar — IC Note Extraction from PDF
 * Reads an uploaded IC appraisal / credit assessment PDF via Mistral OCR,
 * extracts all sections, risks, CPs, and SWOT, then saves to credit_cases.ic_note.
 */

import { createClient }           from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAI, type FileContent } from "../_shared/ai-caller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SECTION_IDS = [
  "executive_summary",
  "client_promoter",
  "investment_structure",
  "rehbar_funding_history",
  "historical_financial",
  "projections",
  "key_ratios",
  "cash_flow",
  "due_diligence",
  "risk_assessment",
  "visit_reference",
  "product_specifics",
] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json() as { case_id: string; document_id: string };
    const { case_id, document_id } = body;
    if (!case_id || !document_id) return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: doc } = await supabase.from("financial_documents").select("*").eq("id", document_id).single();
    if (!doc) return new Response(JSON.stringify({ error: "Document not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    await supabase.from("financial_documents").update({ extraction_status: "running" }).eq("id", document_id);

    // Download PDF and send natively as document block — Claude processes it directly
    const { data: pdfBlob, error: dlErr } = await supabase.storage.from("case-files").download(doc.file_path);
    if (!pdfBlob || dlErr) throw new Error("File download failed");
    const bytes = new Uint8Array(await (pdfBlob as Blob).arrayBuffer());
    let b64 = ""; const cs = 0x8000;
    for (let i = 0; i < bytes.length; i += cs) b64 += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + cs)));

    const files: FileContent[] = [{ type: "pdf", base64: btoa(b64) }];

    const sectionProps: Record<string, unknown> = {};
    for (const id of SECTION_IDS) {
      sectionProps[id] = { type: "string", description: `Extracted markdown bullet points for section: ${id}` };
    }

    const args = await callAI({
      systemPrompt: `You are extracting structured content from an IC (Investment Committee) appraisal note, credit assessment report, or credit memorandum.

Extract each section as concise markdown bullet points (use "- " prefix). Map the document's content to the section IDs below. If a section is absent, leave it as an empty string.

Section IDs and what to extract:
- executive_summary: Deal overview, purpose, key highlights, credit recommendation summary
- client_promoter: Company background, promoter profile, business description, industry context
- investment_structure: Deal structure, loan terms, security, collateral, tenure, pricing/IRR
- rehbar_funding_history: Previous funding by Rehbar/lender, repayment track record
- historical_financial: P&L trends, balance sheet highlights, revenue/EBITDA/PAT figures
- projections: Projected financials, revenue growth assumptions, future outlook
- key_ratios: DSCR, current ratio, D/E, interest coverage, margins, leverage ratios
- cash_flow: Operating/investing/financing cash flows, net change in cash, working capital
- due_diligence: DD findings, legal/regulatory compliance, audit observations, site visit
- risk_assessment: Key risks, concentration risk, market risk, management risk, mitigants
- visit_reference: Site visit date, observations, management meeting notes, references
- product_specifics: Product features, covenants, conditions precedent, special clauses

For risks, extract a structured risk register.
For conditions precedent, list each CP as a separate item.
For SWOT, extract strengths/weaknesses/opportunities/threats if present.`,
      userText: "Extract the complete IC note structure from this appraisal document.",
      files,
      toolName: "submit_ic_note",
      toolDescription: "Submit the extracted IC note structure.",
      toolSchema: {
        sections: {
          type: "object",
          description: "IC note sections keyed by section ID. Empty string if section not present.",
          properties: sectionProps,
          additionalProperties: false,
        },
        risks: {
          type: "array",
          description: "Structured risk register extracted from the document",
          items: {
            type: "object",
            properties: {
              category: { type: "string", description: "Risk category e.g. Credit, Market, Operational, Legal" },
              risk:     { type: "string", description: "Description of the risk" },
              mitigant: { type: "string", description: "Mitigating factor or control" },
              severity: { type: "string", enum: ["low", "medium", "high"] },
            },
            required: ["category", "risk", "mitigant", "severity"],
            additionalProperties: false,
          },
        },
        conditions_precedent: {
          type: "array",
          description: "List of conditions precedent (one per item)",
          items: { type: "string" },
        },
        swot: {
          type: "object",
          description: "SWOT analysis if present in the document",
          properties: {
            strengths:     { type: "array", items: { type: "string" } },
            weaknesses:    { type: "array", items: { type: "string" } },
            opportunities: { type: "array", items: { type: "string" } },
            threats:       { type: "array", items: { type: "string" } },
          },
          additionalProperties: false,
        },
      },
      toolRequired: ["sections"],
      maxTokens: 8192,
      retries: 1,
      timeoutMs: 60_000,
    });

    // Build ic_note structure — only include sections that have content
    const sections: Record<string, { markdown: string }> = {};
    const rawSections = (args.sections as Record<string, string>) ?? {};
    for (const id of SECTION_IDS) {
      const md = rawSections[id]?.trim() ?? "";
      if (md) sections[id] = { markdown: md };
    }

    const risks               = (args.risks               as Array<{ category: string; risk: string; mitigant: string; severity: string }>)  ?? [];
    const conditions_precedent = (args.conditions_precedent as string[]) ?? [];
    const swot                = args.swot as { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] } | undefined;

    const sectionsExtracted = Object.keys(sections).length;
    if (sectionsExtracted === 0 && risks.length === 0) {
      await supabase.from("financial_documents").update({
        extraction_status: "failed",
        extraction_error:  "No IC note content detected in this PDF",
      }).eq("id", document_id);
      return new Response(JSON.stringify({ error: "No IC note content detected" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Merge into existing ic_note (preserve partners, provisional, projections_comment)
    const { data: caseRow } = await supabase.from("credit_cases").select("ic_note").eq("id", case_id).single();
    const existing = (caseRow?.ic_note as Record<string, unknown>) ?? {};

    const updatedIcNote: Record<string, unknown> = {
      ...existing,
      sections,
      risks,
      conditions_precedent,
    };
    if (swot) updatedIcNote.swot = swot;

    await supabase.from("credit_cases").update({ ic_note: updatedIcNote }).eq("id", case_id);
    await supabase.from("financial_documents").update({
      extraction_status: "extracted",
      extraction_error:  null,
    }).eq("id", document_id);

    return new Response(
      JSON.stringify({ ok: true, sections_extracted: sectionsExtracted, risks_extracted: risks.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("extract-ic-note error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
