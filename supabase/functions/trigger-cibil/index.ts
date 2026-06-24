import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleOptions } from "../_shared/cors.ts";

declare const Deno: { env: { get(k: string): string | undefined } };

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
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const body: { case_id: string; user_id: string; document_id: string; file_type?: string } = await req.json();

    if (!body.case_id || !body.user_id || !body.document_id) {
      return new Response(JSON.stringify({ error: "Missing required fields: case_id, user_id, document_id" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: inserted, error: jobErr } = await supabase
      .from("extraction_jobs")
      .insert({
        case_id:     body.case_id,
        document_id: body.document_id,
        user_id:     body.user_id,
        job_type:    "cibil",
        payload:     { file_type: body.file_type ?? "pdf" },
      })
      .select("id")
      .single();

    if (jobErr) throw jobErr;

    await supabase
      .from("financial_documents")
      .update({ extraction_status: "pending", extraction_error: null })
      .eq("id", body.document_id);

    return new Response(JSON.stringify({ ok: true, job_id: inserted.id }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "trigger-cibil failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
