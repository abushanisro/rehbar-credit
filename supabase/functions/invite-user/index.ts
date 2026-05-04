import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email, case_code, client_name, redirect_url } = await req.json();
    if (!email) return new Response(JSON.stringify({ error: "Email required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Use the site URL as base — case path appended so invite lands directly on the case
    const siteBase = Deno.env.get("SITE_URL") ?? "https://rehbar-credit.vercel.app";
    const redirectTo = redirect_url ?? siteBase;

    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { invited_to_case: case_code, invited_client: client_name },
    });

    if (error) {
      // User already has an account — not a real error, just tell the caller
      if (error.message?.toLowerCase().includes("already been registered") ||
          error.status === 422) {
        return new Response(JSON.stringify({
          ok: false,
          already_exists: true,
          error: "This email already has a Rehbar account — share the case link directly.",
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw error;
    }

    return new Response(JSON.stringify({ ok: true, user_id: data.user?.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invite failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
