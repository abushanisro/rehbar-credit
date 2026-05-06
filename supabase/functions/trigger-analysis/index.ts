/**
 * Rehbar — Trigger Analysis Edge Function
 * Proxies a request to Trigger.dev to start the analyze-financial-documents task.
 * Required env vars: TRIGGER_SECRET_KEY
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
      document_ids: string[];
      user_id: string;
      excel_texts?: Record<string, string>;
    } = await req.json();

    if (!body.case_id || !body.document_ids?.length || !body.user_id) {
      return new Response(JSON.stringify({ error: "Missing required fields: case_id, document_ids, user_id" }), {
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
        taskIdentifier: "analyze-financial-documents",
        payload: {
          case_id: body.case_id,
          document_ids: body.document_ids,
          user_id: body.user_id,
          excel_texts: body.excel_texts ?? {},
        },
      }),
    });

    const json = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) {
      const errMsg = (json.message ?? json.error ?? `Trigger.dev returned HTTP ${res.status}`) as string;
      console.error("Trigger.dev error:", res.status, JSON.stringify(json));
      return new Response(JSON.stringify({ error: errMsg }), {
        status: res.status >= 500 ? 502 : res.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, run_id: json.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("trigger-analysis error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

export {};
