/**
 * Rehbar — Web Company Enrichment
 * Fetches homepage + about/team pages + DuckDuckGo results,
 * then asks Claude to extract all intake form fields.
 */

import { callAI } from "../_shared/ai-caller.ts";
import { getCorsHeaders, handleOptions } from "../_shared/cors.ts";

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPage(url: string): Promise<string> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RehbarEnrichBot/1.0)" },
      signal: AbortSignal.timeout(7000),
      redirect: "follow",
    });
    if (!r.ok) return "";
    const html = await r.text();
    return stripHtml(html).slice(0, 8_000);
  } catch {
    return "";
  }
}

async function fetchSitePages(base: string): Promise<string> {
  const suffixes = ["", "/about", "/about-us", "/team", "/management", "/leadership", "/who-we-are"];
  const results = await Promise.all(suffixes.map(s => fetchPage(base + s)));
  const combined = results
    .map((text, i) => text.length > 100 ? `=== ${base}${suffixes[i] || "/"} ===\n${text}` : "")
    .filter(Boolean)
    .join("\n\n---\n\n");
  return combined.slice(0, 20_000);
}

async function duckDuckGo(query: string): Promise<string> {
  try {
    const r = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!r.ok) return "";
    const d = await r.json();
    const parts: string[] = [];
    if (d.AbstractText) parts.push(d.AbstractText);
    if (d.Answer)       parts.push(d.Answer);
    (d.RelatedTopics ?? []).slice(0, 8).forEach((t: { Text?: string }) => {
      if (t.Text) parts.push(t.Text);
    });
    return parts.join("\n").slice(0, 4_000);
  } catch {
    return "";
  }
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  const cors = getCorsHeaders(req);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });

    const { company_name, website } = await req.json();
    if (!company_name && !website) {
      return new Response(JSON.stringify({ error: "Provide company_name or website" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Normalise website URL
    let siteUrl = (website ?? "").trim();
    if (siteUrl && !siteUrl.match(/^https?:\/\//)) siteUrl = "https://" + siteUrl;

    // Fetch web context in parallel
    const [siteText, ddgGeneral, ddgPromoters] = await Promise.all([
      siteUrl      ? fetchSitePages(siteUrl) : Promise.resolve(""),
      company_name ? duckDuckGo(`${company_name} company India business profile`) : Promise.resolve(""),
      company_name ? duckDuckGo(`${company_name} directors founders promoters India`) : Promise.resolve(""),
    ]);

    const contextParts: string[] = [];
    if (siteText)       contextParts.push(`=== COMPANY WEBSITE ===\n${siteText}`);
    if (ddgGeneral)     contextParts.push(`=== WEB SEARCH: General ===\n${ddgGeneral}`);
    if (ddgPromoters)   contextParts.push(`=== WEB SEARCH: Promoters/Directors ===\n${ddgPromoters}`);
    if (!contextParts.length)
      contextParts.push(`Company: ${company_name ?? ""}\nWebsite: ${website ?? ""}`);

    const contextText = contextParts.join("\n\n---\n\n");

    const extracted = await callAI({
      systemPrompt: `You are a senior credit analyst at Rehbar Financial Services (Islamic NBFC, India).
Given web-gathered context about a company, extract ALL possible intake form fields.
Use the context AND your training knowledge. Infer where you are reasonably confident.

LEGAL CONSTITUTION (exact strings only): Pvt Ltd, Public Ltd, Partnership, LLP, Proprietorship, Individual
INDUSTRY (pick closest match): Agriculture & Food Processing, Automotive, Chemicals & Petrochemicals, Construction & Infrastructure, Education, Energy & Utilities, Financial Services, Healthcare & Pharmaceuticals, Hospitality & Tourism, IT & Technology, Logistics & Transportation, Manufacturing, Media & Entertainment, Real Estate, Retail & E-commerce, Telecom, Textile & Apparel, Trading, Other

Rules:
- promoter_details: full names, designation, founding story, shareholding % where available — be comprehensive
- year_established: integer year the company was founded/incorporated
- end_use: what the company would typically use financing for (machinery, working capital, expansion, etc.)
- collateral_summary: what assets the company likely holds (plant, machinery, property, receivables)
- strategic_rationale: why Rehbar (Islamic NBFC) would be a fit — Shariah compliance angle, asset-backed nature
- summary: 3-4 concise sentences about the business for a credit analyst
- confidence: 0-100 (0 = pure guess, 100 = clearly stated in source)
- Omit fields you truly cannot determine — do NOT invent financial figures (deal_amount, tenure, irr)`,
      userText: `Extract all company profile and intake fields from this web context:\n\n${contextText}`,
      toolName: "submit_company_profile",
      toolDescription: "Submit all extracted company profile and intake fields",
      toolSchema: {
        client_name:         { type: "string",  description: "Company legal name" },
        legal_constitution:  { type: "string",  enum: ["Pvt Ltd","Public Ltd","Partnership","LLP","Proprietorship","Individual"] },
        industry:            { type: "string" },
        year_established:    { type: "integer" },
        promoter_details:    { type: "string",  description: "Names, designation, shareholding, background" },
        website:             { type: "string" },
        end_use:             { type: "string",  description: "Likely end use of financing" },
        collateral_summary:  { type: "string",  description: "Likely assets available as collateral" },
        strategic_rationale: { type: "string",  description: "Why Rehbar / Islamic finance fits this company" },
        summary:             { type: "string",  description: "3-4 sentence business summary for credit analyst" },
        confidence:          { type: "integer", minimum: 0, maximum: 100 },
      },
      toolRequired: ["summary", "confidence"],
      maxTokens: 2048,
      retries: 1,
    });

    return new Response(JSON.stringify({ ok: true, extracted }), {
      status: 200, headers: { ...cors, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("web-enrich-company error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unexpected error" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
