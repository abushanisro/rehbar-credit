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

    // Verify caller is admin using their JWT
    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user: callerUser } } = await caller.auth.getUser();
    if (!callerUser) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });

    const { data: roleRow } = await caller.from("user_roles")
      .select("role").eq("user_id", callerUser.id).single();
    if (roleRow?.role !== "admin") return new Response(JSON.stringify({ error: "Admin only" }), {
      status: 403, headers: { ...cors, "Content-Type": "application/json" },
    });

    const { user_id } = await req.json();
    if (!user_id) return new Response(JSON.stringify({ error: "user_id required" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });

    // Prevent self-deletion
    if (user_id === callerUser.id) return new Response(JSON.stringify({ error: "Cannot delete your own account" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { error } = await admin.auth.admin.deleteUser(user_id);
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Delete failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
