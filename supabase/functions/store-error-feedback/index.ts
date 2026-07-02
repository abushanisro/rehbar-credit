import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleOptions } from "../_shared/cors.ts";

declare const Deno: { env: { get(key: string): string | undefined } };

const SUPERMEMORY_API = "https://api.supermemory.ai/v3";

async function storeMemory(
  apiKey: string,
  content: string,
  containerTags: string[],
  metadata: Record<string, string>,
): Promise<string | null> {
  try {
    const res = await fetch(`${SUPERMEMORY_API}/memories`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ content, containerTags, metadata }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error("Supermemory store error:", res.status, body.slice(0, 200));
      return null;
    }
    const json = await res.json() as { id?: string };
    return json.id ?? null;
  } catch (e) {
    console.error("Supermemory store exception:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  const cors = getCorsHeaders(req);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const smKey       = Deno.env.get("SUPERMEMORY_API_KEY");
  const supabase    = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json() as {
      error_id:     string;
      verdict:      "confirmed" | "dismissed";
      analyst_note?: string;
      case_context?: {
        case_id:      string;
        client_name?: string;
        industry?:    string;
        product_type?: string;
        section_id:   string;
        error_type:   string;
        title:        string;
        detail:       string;
        suggested_fix?: string;
      };
    };

    const { error_id, verdict, analyst_note, case_context } = body;

    if (!error_id || !verdict) {
      return new Response(JSON.stringify({ error: "Missing required fields: error_id, verdict" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let supermemory_id: string | null = null;

    // Store in Supermemory only when analyst confirms the error
    if (verdict === "confirmed" && case_context && smKey) {
      const { section_id, error_type, title, detail, suggested_fix, client_name, industry, product_type, case_id } = case_context;

      const memoryContent = [
        `CONFIRMED IC ERROR — ${error_type} in section ${section_id}`,
        `Industry: ${industry ?? "unknown"} | Product: ${product_type ?? "unknown"}`,
        `Error: ${title}`,
        `Detail: ${detail}`,
        suggested_fix ? `Fix applied: ${suggested_fix}` : null,
        analyst_note  ? `Analyst note: ${analyst_note}` : null,
        `Case: ${client_name ?? "unknown"} (${case_id})`,
      ].filter(Boolean).join("\n");

      // Tags: global pool + case-specific pool (for per-case retrieval on regeneration)
      const containerTags = [
        "rehbar-ic-errors",
        section_id,
        error_type,
        `case-${case_context.case_id}`,
        ...(industry ? [industry.toLowerCase().replace(/\s+/g, "-")] : []),
      ];

      supermemory_id = await storeMemory(smKey, memoryContent, containerTags, {
        case_id:    case_context.case_id,
        section_id,
        error_type,
        confirmed_at: new Date().toISOString(),
      });
    }

    // Update the error record
    const updatePayload: Record<string, unknown> = { analyst_verdict: verdict };
    if (analyst_note) updatePayload.analyst_note = analyst_note;
    if (supermemory_id) updatePayload.supermemory_id = supermemory_id;

    const { error: dbErr } = await supabase
      .from("ic_ai_errors")
      .update(updatePayload)
      .eq("id", error_id);

    if (dbErr) {
      return new Response(JSON.stringify({ error: dbErr.message }), {
        status: 500, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, supermemory_id }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("store-error-feedback error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
