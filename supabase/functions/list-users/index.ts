import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

declare const Deno: { env: { get(k: string): string | undefined } };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
