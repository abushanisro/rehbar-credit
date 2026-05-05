/**
 * Rehbar — Trigger Bank Extraction
 * Queues the extract-bank-statements Trigger.dev task and returns immediately.
 * Frontend polls financial_documents.extraction_status for progress.
 * Required env: TRIGGER_SECRET_KEY
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const triggerKey = Deno.env.get("TRIGGER_SECRET_KEY");
    if (!triggerKey) return new Response(JSON.stringify({ error: "TRIGGER_SECRET_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
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

    const res = await fetch("https://api.trigger.dev/api/v3/runs", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${triggerKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        taskIdentifier: "extract-bank-statements",
        payload: {
          case_id:      body.case_id,
          user_id:      body.user_id,
          document_ids: body.document_ids,
          excel_texts:  body.excel_texts ?? {},
        },
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Trigger.dev error:", JSON.stringify(json));
      return new Response(JSON.stringify({ error: (json as Record<string, unknown>).message ?? "Trigger.dev error" }), {
        status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, run_id: (json as Record<string, unknown>).id }), {
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
