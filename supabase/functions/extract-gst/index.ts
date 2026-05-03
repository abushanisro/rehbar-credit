// Rehbar — GST Return Extraction
// Extracts period-wise GST data from GSTR-1 / GSTR-3B / GSTR-9 documents via Gemini 2.5 Flash.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json() as { case_id: string; document_id: string; excel_text?: string };
    const { case_id, document_id } = body;
    if (!case_id || !document_id) return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: doc } = await supabase.from("financial_documents").select("*").eq("id", document_id).eq("user_id", user.id).single();
    if (!doc) return new Response(JSON.stringify({ error: "Document not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    await supabase.from("financial_documents").update({ extraction_status: "running" }).eq("id", document_id);

    let userContent: unknown;
    if (doc.file_type === "excel") {
      const text = (body.excel_text ?? "").slice(0, 150_000);
      userContent = [{ type: "text", text: `GST RETURN DOCUMENT (TSV):\n\n${text}` }];
    } else {
      const { data: file } = await supabase.storage.from("case-files").download(doc.file_path);
      if (!file) throw new Error("File download failed");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let b64 = ""; const cs = 0x8000;
      for (let i = 0; i < bytes.length; i += cs) b64 += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + cs)));
      const mime = doc.file_type === "image" ? "image/png" : "application/pdf";
      userContent = [{ type: "image_url", image_url: { url: `data:${mime};base64,${btoa(b64)}` } }];
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) throw new Error("GEMINI_API_KEY not configured");

    const systemPrompt = `You are a GST expert extracting structured data from Indian GST return documents.
Extract period-wise data for EVERY month/quarter visible in the document.
Rules:
1. period format: "YYYY-MM" for monthly (e.g. "2024-01") or "Q1 FY2024" for quarterly.
2. return_type: detect from document — GSTR-1, GSTR-3B, or GSTR-9.
3. Extract GSTIN if visible.
4. taxable_turnover: total taxable supplies (excluding exempt/nil-rated).
5. exempt_turnover: exempt + nil-rated + non-GST supplies.
6. total_turnover = taxable + exempt.
7. output_tax: total GST liability (IGST+CGST+SGST).
8. itc_claimed: Input Tax Credit availed.
9. net_tax_paid = output_tax - itc_claimed.
10. filing_status: "filed", "not_filed", or "late".
11. Do NOT invent data — omit absent fields.`;

    const userMsg = {
      role: "user",
      content: [
        { type: "text", text: "Extract GST return data for every period in this document." },
        ...(Array.isArray(userContent) ? userContent : [userContent]),
      ],
    };

    const toolSchema = {
      type: "function",
      function: {
        name: "submit_gst_data",
        description: "Submit extracted GST return data.",
        parameters: {
          type: "object",
          properties: {
            gstin: { type: "string" },
            return_type: { type: "string" },
            periods: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  period: { type: "string" },
                  return_type: { type: "string" },
                  taxable_turnover: { type: ["number", "null"] },
                  exempt_turnover: { type: ["number", "null"] },
                  total_turnover: { type: ["number", "null"] },
                  output_tax: { type: ["number", "null"] },
                  itc_claimed: { type: ["number", "null"] },
                  net_tax_paid: { type: ["number", "null"] },
                  filing_date: { type: ["string", "null"] },
                  filing_status: { type: "string", enum: ["filed", "not_filed", "late"] },
                },
                required: ["period", "filing_status"],
                additionalProperties: false,
              },
            },
          },
          required: ["periods"],
          additionalProperties: false,
        },
      },
    };

    let aiRes: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      aiRes = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${geminiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          messages: [{ role: "system", content: systemPrompt }, userMsg],
          tools: [toolSchema],
          tool_choice: { type: "function", function: { name: "submit_gst_data" } },
        }),
      });
      if (aiRes.status !== 429) break;
      await new Promise(r => setTimeout(r, [5000, 15000, 30000][attempt] ?? 30000));
    }

    if (!aiRes!.ok) {
      const txt = await aiRes!.text();
      await supabase.from("financial_documents").update({ extraction_status: "failed", extraction_error: `AI error ${aiRes!.status}` }).eq("id", document_id);
      return new Response(JSON.stringify({ error: "AI extraction failed", detail: txt }), { status: aiRes!.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiJson = await aiRes!.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in AI response");
    const args = JSON.parse(toolCall.function.arguments);

    let inserted = 0;
    for (const p of args.periods ?? []) {
      if (!p.period) continue;
      await supabase.from("gst_return_data").upsert({
        case_id, user_id: user.id, document_id,
        period: p.period,
        return_type: p.return_type ?? args.return_type ?? null,
        gstin: args.gstin ?? null,
        taxable_turnover: p.taxable_turnover ?? null,
        exempt_turnover: p.exempt_turnover ?? null,
        total_turnover: p.total_turnover ?? null,
        output_tax: p.output_tax ?? null,
        itc_claimed: p.itc_claimed ?? null,
        net_tax_paid: p.net_tax_paid ?? null,
        filing_date: p.filing_date ?? null,
        filing_status: p.filing_status ?? "filed",
      }, { onConflict: "case_id,period,return_type" });
      inserted++;
    }

    if (inserted === 0) {
      await supabase.from("financial_documents").update({ extraction_status: "failed", extraction_error: "No GST period data detected" }).eq("id", document_id);
      return new Response(JSON.stringify({ error: "No data extracted" }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await supabase.from("financial_documents").update({ extraction_status: "extracted", extraction_error: null }).eq("id", document_id);
    return new Response(JSON.stringify({ ok: true, periods_extracted: inserted, gstin: args.gstin }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("extract-gst error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
