import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM = "Rehbar Credit Terminal <onboarding@resend.dev>";

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend error: ${await res.text()}`);
  return res.json();
}

function sessionId() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

function inviteEmailHtml(inviteLink: string, caseCode: string, clientName: string) {
  const sid = sessionId();
  const ts  = new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Rehbar Credit Terminal — Case Invite</title>
</head>
<body style="margin:0;padding:0;background:#060606;font-family:'Courier New',Courier,monospace;-webkit-text-size-adjust:100%;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#060606;padding:36px 16px;">
<tr><td align="center">

  <!-- ═══ OUTER SHELL ═══ -->
  <table width="580" cellpadding="0" cellspacing="0"
    style="max-width:580px;width:100%;
           border-top:1px solid #242424;
           border-right:1px solid #1a1a1a;
           border-bottom:1px solid #1a1a1a;
           border-left:3px solid #E8721C;
           background:#0a0a0a;">

    <!-- ── TOP CHROME ── -->
    <tr>
      <td style="background:#0d0d0d;border-bottom:1px solid #1e1e1e;padding:10px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td valign="middle">
            <span style="color:#E8721C;font-size:14px;line-height:1;">●</span>
            <span style="color:#E8721C;font-size:9px;font-weight:bold;letter-spacing:4px;"> REHBAR CREDIT TERMINAL</span>
            <span style="color:#2e2e2e;font-size:9px;letter-spacing:2px;">  v1.0.0</span>
          </td>
          <td align="right" valign="middle">
            <span style="color:#2a2a2a;font-size:8px;letter-spacing:1px;">SID:${sid}</span>
          </td>
        </tr></table>
      </td>
    </tr>

    <!-- ── BOOT LOG ── -->
    <tr>
      <td style="background:#070707;border-bottom:1px solid #161616;padding:14px 20px;">
        <div style="color:#2e2e2e;font-size:8px;letter-spacing:3px;margin-bottom:10px;"># SYSTEM INIT — ${ts}</div>
        <div style="color:#22c55e;font-size:9px;line-height:2;letter-spacing:0.5px;">CREDIT ANALYSIS ENGINE...............<span style="color:#16a34a;">[ONLINE]</span></div>
        <div style="color:#22c55e;font-size:9px;line-height:2;letter-spacing:0.5px;">FINANCIAL RATIO MATRIX...............<span style="color:#16a34a;">[LOADED]</span></div>
        <div style="color:#22c55e;font-size:9px;line-height:2;letter-spacing:0.5px;">DSCR COMPUTATION MODULE..............<span style="color:#16a34a;">[READY]</span></div>
        <div style="color:#22c55e;font-size:9px;line-height:2;letter-spacing:0.5px;">SHARIA COMPLIANCE ENGINE.............<span style="color:#16a34a;">[ACTIVE]</span></div>
        <div style="color:#22c55e;font-size:9px;line-height:2;letter-spacing:0.5px;">COLLABORATION PROTOCOL...............<span style="color:#16a34a;">[OPEN]</span></div>
        <div style="color:#E8721C;font-size:9px;line-height:2;letter-spacing:0.5px;">ANALYST INVITE DISPATCHED............<span style="color:#c2601a;">[PENDING ACCEPTANCE]</span></div>
      </td>
    </tr>

    <!-- ── MAIN BODY ── -->
    <tr>
      <td style="padding:28px 24px 20px 24px;">

        <!-- Section label -->
        <div style="color:#333;font-size:8px;letter-spacing:4px;margin-bottom:4px;">▶ INCOMING COLLABORATION REQUEST</div>
        <div style="height:1px;background:linear-gradient(to right,#2a2a2a,#111);margin-bottom:22px;"></div>

        <!-- Intro -->
        <p style="color:#bbb;font-size:12px;line-height:1.9;margin:0 0 22px 0;">
          You have been invited to join a credit analysis case on the
          <span style="color:#E8721C;font-weight:bold;">Rehbar Credit Terminal</span>.<br>
          Accept below to access the case workspace and collaborate in real time.
        </p>

        <!-- Case details panel -->
        <table width="100%" cellpadding="0" cellspacing="0"
          style="background:#070707;border:1px solid #1e1e1e;border-left:2px solid #E8721C;margin-bottom:24px;">
          <tr><td style="padding:16px 18px;">
            <div style="color:#2e2e2e;font-size:8px;letter-spacing:3px;margin-bottom:14px;">
              ─── CASE MANIFEST ──────────────────────────────
            </div>
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="color:#444;font-size:9px;letter-spacing:2px;padding-bottom:8px;padding-right:20px;">CASE CODE</td>
                <td style="font-size:9px;padding-bottom:8px;">
                  <span style="color:#555;">: </span>
                  <span style="color:#E8721C;font-weight:bold;letter-spacing:2px;">${caseCode}</span>
                </td>
              </tr>
              <tr>
                <td style="color:#444;font-size:9px;letter-spacing:2px;padding-bottom:8px;padding-right:20px;">CLIENT</td>
                <td style="font-size:9px;padding-bottom:8px;">
                  <span style="color:#555;">: </span>
                  <span style="color:#e0e0e0;letter-spacing:1px;">${clientName}</span>
                </td>
              </tr>
              <tr>
                <td style="color:#444;font-size:9px;letter-spacing:2px;padding-right:20px;">ACCESS</td>
                <td style="font-size:9px;">
                  <span style="color:#555;">: </span>
                  <span style="color:#22c55e;letter-spacing:1px;">FULL COLLABORATION</span>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>

        <!-- Prompt -->
        <p style="color:#555;font-size:10px;line-height:1.8;margin:0 0 22px 0;">
          &gt;_ Click the button below to accept your invite.<br>
          &gt;_ You will set your password and land directly on the case.
        </p>

        <!-- CTA -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
          <tr>
            <td style="background:#E8721C;text-align:center;">
              <a href="${inviteLink}"
                 style="display:block;color:#000;font-family:'Courier New',Courier,monospace;
                        font-size:11px;font-weight:bold;letter-spacing:5px;
                        text-decoration:none;padding:16px 20px;">
                &#91; ACCEPT INVITE &amp; OPEN CASE &#93;
              </a>
            </td>
          </tr>
          <tr>
            <td style="background:#120a00;border:1px solid #2a1500;border-top:none;
                       text-align:center;padding:8px 12px;">
              <span style="color:#4a3000;font-size:8px;letter-spacing:2px;">SECURE ONE-TIME LINK · EXPIRES IN 24H</span>
            </td>
          </tr>
        </table>

        <!-- Divider -->
        <div style="height:1px;background:#161616;margin-bottom:16px;"></div>

        <!-- Fallback -->
        <div style="color:#2a2a2a;font-size:8px;letter-spacing:2px;margin-bottom:6px;">&gt;_ FALLBACK URL:</div>
        <div style="color:#383838;font-size:8px;word-break:break-all;line-height:1.6;">${inviteLink}</div>

      </td>
    </tr>

    <!-- ── FOOTER ── -->
    <tr>
      <td style="background:#070707;border-top:1px solid #141414;padding:12px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><span style="color:#252525;font-size:8px;letter-spacing:2px;">REHBAR FINANCIAL SERVICES</span></td>
          <td align="right"><span style="color:#252525;font-size:8px;letter-spacing:1px;">rehbar.co.in · DO NOT REPLY</span></td>
        </tr></table>
      </td>
    </tr>

  </table>

</td></tr>
</table>

</body>
</html>`;
}

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

    const siteBase   = Deno.env.get("SITE_URL") ?? "https://rehbar-credit.vercel.app";
    const redirectTo = redirect_url ?? siteBase;

    // Step 1: create the user — supabase sends NO email with createUser
    const { error: createError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,           // skip email confirmation gate
      user_metadata: { invited_to_case: case_code, invited_client: client_name },
    });

    if (createError) {
      const msg = createError.message?.toLowerCase() ?? "";
      if (msg.includes("already been registered") || msg.includes("already registered")) {
        return new Response(JSON.stringify({
          ok: false,
          already_exists: true,
          error: "This email already has a Rehbar account — share the case link directly.",
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw createError;
    }

    // Step 2: generate a magic-link — supabase sends NO email with generateLink
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    if (linkError) throw linkError;

    await sendEmail(
      email,
      `[Rehbar] Case Invite: ${case_code} — ${client_name}`,
      inviteEmailHtml(linkData.properties.action_link, case_code ?? "", client_name ?? ""),
    );

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invite failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
