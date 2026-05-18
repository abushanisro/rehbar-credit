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

    // Verify caller is admin
    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user: callerUser } } = await caller.auth.getUser();
    if (!callerUser) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
    const { data: roleRow } = await caller.from("user_roles").select("role").eq("user_id", callerUser.id).single();
    if (roleRow?.role !== "admin") return new Response(JSON.stringify({ error: "Admin only" }), {
      status: 403, headers: { ...cors, "Content-Type": "application/json" },
    });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: { users }, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) throw listErr;

    const { data: roles }    = await admin.from("user_roles").select("user_id,role");
    const { data: profiles } = await admin.from("user_profiles").select("id,full_name");

    const roleMap    = Object.fromEntries((roles    ?? []).map(r => [r.user_id, r.role]));
    const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p.full_name]));

    const result = users.map(u => ({
      id:              u.id,
      email:           u.email ?? null,
      role:            roleMap[u.id] ?? null,
      full_name:       profileMap[u.id] ?? (u.user_metadata?.full_name as string) ?? null,
      created_at:      u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
    }));

    return new Response(JSON.stringify({ users: result }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
