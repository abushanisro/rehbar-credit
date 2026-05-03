// Rehbar — AI Case Metadata Extraction
// Phase 1: Reads the FULL document and extracts every form field.
// Phase 2: If company name found, searches the web (Google Search grounding)
//          to fill gaps — website, industry, year established, business context.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ExtractInput {
  file_path: string;
  file_type: "pdf" | "image" | "excel";
  file_name: string;
  excel_text?: string;
}

interface ExtractedFields {
  client_name?: string;
  product_type?: string;
  product_type_custom?: string;
  legal_constitution?: string;
  industry?: string;
  year_established?: number;
  promoter_details?: string;
  deal_amount?: number;
  tenure_months?: number;
  expected_irr?: number;
  end_use?: string;
  collateral_summary?: string;
  strategic_rationale?: string;
  website?: string;
  summary?: string;
  confidence?: number;
}

function imageMimeFromName(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif")) return "image/gif";
  return "image/png";
}

// Phase 2: Google Search grounding via native Gemini API
async function webResearch(clientName: string, geminiKey: string): Promise<Partial<ExtractedFields>> {
  try {
    const prompt = `Search the web and find information about the Indian company named "${clientName}".

Return a JSON object with these exact keys (use null for anything not found):
{
  "website": "official website URL or null",
  "industry": "one of: Agriculture & Food Processing, Automotive, Chemicals & Petrochemicals, Construction & Infrastructure, Education, Energy & Utilities, Financial Services, Healthcare & Pharmaceuticals, Hospitality & Tourism, IT & Technology, Logistics & Transportation, Manufacturing, Media & Entertainment, Real Estate, Retail & E-commerce, Telecom, Textile & Apparel, Trading, Other — or null",
  "year_established": "integer year or null",
  "end_use": "what the company does / its main business activity in 1-2 sentences or null",
  "strategic_rationale": "why this company might seek Islamic / Shariya-compliant financing, or any financing rationale found online, or null"
}

Return ONLY the JSON object, no markdown, no explanation.`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.1 },
        }),
      }
    );

    if (!res.ok) {
      console.warn("web research failed", res.status, await res.text());
      return {};
    }

    const json = await res.json();
    const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Strip markdown fences if present
    const clean = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    // Extract the first JSON object in the response
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) return {};

    const parsed = JSON.parse(match[0]);

    return {
      website:             parsed.website            || undefined,
      industry:            parsed.industry           || undefined,
      year_established:    parsed.year_established   ? Number(parsed.year_established) : undefined,
      end_use:             parsed.end_use             || undefined,
      strategic_rationale: parsed.strategic_rationale || undefined,
    };
  } catch (e) {
    console.warn("webResearch error:", e);
    return {};
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: ExtractInput = await req.json();
    const { file_path, file_type, file_name, excel_text } = body;

    if (!file_path || !file_type || !file_name) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) throw new Error("GEMINI_API_KEY not configured");

    // ── Phase 1: Document analysis ──────────────────────────────────────────
    let userContent: unknown[];

    if (file_type === "excel") {
      if (!excel_text || excel_text.trim().length === 0) {
        return new Response(JSON.stringify({ error: "Excel text payload missing" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text = excel_text.slice(0, 150_000);
      userContent = [{ type: "text", text: `DOCUMENT CONTENT (Excel workbook, TSV per sheet):\n\n${text}` }];
    } else {
      const { data: file, error: dlErr } = await supabase.storage.from("case-files").download(file_path);
      if (dlErr || !file) {
        return new Response(JSON.stringify({ error: "File download failed: " + dlErr?.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      let b64 = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        b64 += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
      }
      const base64 = btoa(b64);
      const mime = file_type === "image" ? imageMimeFromName(file_name) : "application/pdf";
      userContent = [{ type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } }];
    }

    const systemPrompt = `You are a senior credit analyst at Rehbar Financial Services (an Islamic finance / NBFC).
You are given a document — it may be a company profile, loan/lease application, business plan, CMA data,
bank statement, balance sheet, or any related document.

YOUR JOB: Read and analyse the ENTIRE document from start to finish. Extract every piece of information
that is relevant to a credit case intake form. Use context and inference — even if a field is not explicitly
labelled, derive it from what you read. For example:
- "The company was incorporated in 2015" → year_established = 2015
- "Mr. Ali Shah holds 70% stake" → goes into promoter_details
- "We require INR 5 crore for 36 months" → deal_amount = 5, tenure_months = 36
- "The asset will be placed as collateral" → collateral_summary
- Brand names, registered names, letterhead → client_name

PRODUCT TYPE MAPPING (use these exact keys):
- operating_lease: asset rental, lease, equipment leasing
- finance_lease: term loan, ICL, inter-corporate loan, EMI-based financing
- project_finance: project funding, milestone-based, construction finance
- trade_finance: trade, working capital, invoice discounting
- pls: profit & loss sharing, mudaraba, musharaka
- home_loan: housing loan, property purchase, mortgage
- employee_car_lease: car lease to employee, vehicle lease
- other: anything else or if this is purely financial statements with no deal request

LEGAL CONSTITUTION MAPPING (use these exact strings):
Pvt Ltd, Public Ltd, Partnership, LLP, Proprietorship, Individual

INDUSTRY — pick the best match from this list or leave blank if unclear:
Agriculture & Food Processing, Automotive, Chemicals & Petrochemicals,
Construction & Infrastructure, Education, Energy & Utilities, Financial Services,
Healthcare & Pharmaceuticals, Hospitality & Tourism, IT & Technology,
Logistics & Transportation, Manufacturing, Media & Entertainment, Real Estate,
Retail & E-commerce, Telecom, Textile & Apparel, Trading, Other

RULES:
1. deal_amount must be in INR Crores (convert if given in Lakhs: divide by 100)
2. tenure_months must be an integer
3. expected_irr must be a percentage number (e.g. 18 for 18%)
4. For promoter_details: include names, designation, shareholding %, background
5. Write summary as 3-5 sentences. If this is financial statements only, say so and describe the financial health.
6. If product_type cannot be determined from the document, omit it entirely — do NOT set it to "other".`;

    const userPrompt = `Analyse this document completely and extract all case intake fields.
Be thorough — read every page, every paragraph. Fill as many fields as you can from the document.
If this is a financial statement document with no explicit deal/loan application, still extract company identity, promoter info, and financial context.`;

    const aiRes = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${geminiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              ...userContent,
            ],
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "submit_case_fields",
            description: "Submit all extracted case intake fields.",
            parameters: {
              type: "object",
              properties: {
                client_name:         { type: "string",  description: "Legal name of the borrowing entity" },
                product_type:        { type: "string",  enum: ["operating_lease","finance_lease","project_finance","trade_finance","pls","home_loan","employee_car_lease"] },
                product_type_custom: { type: "string",  description: "Only set if product cannot be classified" },
                legal_constitution:  { type: "string",  enum: ["Pvt Ltd","Public Ltd","Partnership","LLP","Proprietorship","Individual"] },
                industry:            { type: "string",  description: "Industry / sector from the allowed list" },
                year_established:    { type: "integer", description: "Year company was incorporated / established" },
                promoter_details:    { type: "string",  description: "Key promoters, directors, shareholding pattern, backgrounds" },
                deal_amount:         { type: "number",  description: "Deal / loan / lease amount in INR Crores" },
                tenure_months:       { type: "integer", description: "Tenure in months" },
                expected_irr:        { type: "number",  description: "Expected IRR or interest rate as a percentage" },
                end_use:             { type: "string",  description: "Purpose / end use of the funds" },
                collateral_summary:  { type: "string",  description: "Security / collateral offered" },
                strategic_rationale: { type: "string",  description: "Why this deal / why Rehbar" },
                website:             { type: "string",  description: "Company website URL if explicitly mentioned in document" },
                summary:             { type: "string",  description: "3-5 sentence AI summary of the document" },
                confidence:          { type: "integer", description: "Overall extraction confidence 0-100", minimum: 0, maximum: 100 },
              },
              required: ["summary", "confidence"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "submit_case_fields" } },
      }),
    });

    if (aiRes.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded — retry in a moment" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      return new Response(JSON.stringify({ error: `AI error ${aiRes.status}`, detail: txt.slice(0, 300) }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in AI response");
    const docExtracted: ExtractedFields = JSON.parse(toolCall.function.arguments);

    // ── Phase 2: Web research to fill gaps ──────────────────────────────────
    let webData: Partial<ExtractedFields> = {};
    if (docExtracted.client_name) {
      webData = await webResearch(docExtracted.client_name, geminiKey);
    }

    // Merge: document fields take priority; web fills only empty slots
    const merged: ExtractedFields = { ...docExtracted };
    for (const key of Object.keys(webData) as (keyof ExtractedFields)[]) {
      const docVal = merged[key];
      const isEmpty = docVal === undefined || docVal === null || docVal === "";
      if (isEmpty && webData[key] != null) {
        (merged as Record<string, unknown>)[key] = webData[key];
      }
    }

    // Annotate summary with web research note
    if (Object.keys(webData).length > 0) {
      merged.summary = (merged.summary ?? "") +
        "\n\n[Web research used to supplement: " +
        Object.keys(webData).join(", ") + "]";
    }

    return new Response(JSON.stringify({ ok: true, extracted: merged }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("extract-case-meta error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unexpected error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
