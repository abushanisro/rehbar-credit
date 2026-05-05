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

function verificationEmailHtml(confirmLink: string, fullName?: string, isResend = false) {
  const sid      = sessionId();
  const ts       = new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC";
  const opName   = fullName ? fullName.toUpperCase() : "OPERATOR";
  const headline = isResend
    ? "VERIFICATION LINK RE-ISSUED"
    : "OPERATOR ACCOUNT ACTIVATION";
  const subline  = isResend
    ? "A new verification link has been issued for your account."
    : `Welcome, <span style="color:#E8721C;font-weight:bold;">${opName}</span>. Your account has been created.`;
  const btnLabel = isResend
    ? "&#91; RE-VERIFY &amp; ACCESS TERMINAL &#93;"
    : "&#91; VERIFY EMAIL &amp; ACCESS TERMINAL &#93;";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Rehbar Credit Terminal — Verification</title>
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
        <div style="color:#2e2e2e;font-size:8px;letter-spacing:3px;margin-bottom:10px;"># SYSTEM BOOT — ${ts}</div>
        <div style="color:#22c55e;font-size:9px;line-height:2;letter-spacing:0.5px;">CREDIT ANALYSIS ENGINE...............<span style="color:#16a34a;">[ONLINE]</span></div>
        <div style="color:#22c55e;font-size:9px;line-height:2;letter-spacing:0.5px;">FINANCIAL RATIO MATRIX...............<span style="color:#16a34a;">[LOADED]</span></div>
        <div style="color:#22c55e;font-size:9px;line-height:2;letter-spacing:0.5px;">DSCR COMPUTATION MODULE..............<span style="color:#16a34a;">[READY]</span></div>
        <div style="color:#22c55e;font-size:9px;line-height:2;letter-spacing:0.5px;">CLAUDE SONNET AI ENGINE..............<span style="color:#16a34a;">[STANDBY]</span></div>
        <div style="color:#22c55e;font-size:9px;line-height:2;letter-spacing:0.5px;">SHARIA COMPLIANCE ENGINE.............<span style="color:#16a34a;">[ACTIVE]</span></div>
        <div style="color:#E8721C;font-size:9px;line-height:2;letter-spacing:0.5px;">AWAITING OPERATOR VERIFICATION.......<span style="color:#c2601a;">[PENDING]</span></div>
      </td>
    </tr>

    <!-- ── MAIN BODY ── -->
    <tr>
      <td style="padding:28px 24px 20px 24px;">

        <!-- Section label -->
        <div style="color:#333;font-size:8px;letter-spacing:4px;margin-bottom:4px;">▶ ${headline}</div>
        <div style="height:1px;background:linear-gradient(to right,#2a2a2a,#111);margin-bottom:22px;"></div>

        <!-- Intro -->
        <p style="color:#bbb;font-size:12px;line-height:1.9;margin:0 0 22px 0;">
          ${subline}<br>
          Verify your email address to unlock full access to the
          <span style="color:#E8721C;font-weight:bold;">Rehbar Credit Terminal</span>.
        </p>

        <!-- What you get panel -->
        <table width="100%" cellpadding="0" cellspacing="0"
          style="background:#070707;border:1px solid #1e1e1e;border-left:2px solid #E8721C;margin-bottom:24px;">
          <tr><td style="padding:16px 18px;">
            <div style="color:#2e2e2e;font-size:8px;letter-spacing:3px;margin-bottom:14px;">
              ─── TERMINAL ACCESS MODULES ────────────────────
            </div>
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding-bottom:7px;padding-right:12px;">
                  <span style="color:#E8721C;font-size:9px;">★</span>
                  <span style="color:#666;font-size:9px;letter-spacing:1px;"> FINANCIAL STATEMENT EXTRACTION</span>
                </td>
                <td style="padding-bottom:7px;">
                  <span style="color:#22c55e;font-size:8px;letter-spacing:2px;">[UNLOCKED]</span>
                </td>
              </tr>
              <tr>
                <td style="padding-bottom:7px;padding-right:12px;">
                  <span style="color:#E8721C;font-size:9px;">★</span>
                  <span style="color:#666;font-size:9px;letter-spacing:1px;"> RATIO &amp; DSCR ANALYSIS</span>
                </td>
                <td style="padding-bottom:7px;">
                  <span style="color:#22c55e;font-size:8px;letter-spacing:2px;">[UNLOCKED]</span>
                </td>
              </tr>
              <tr>
                <td style="padding-bottom:7px;padding-right:12px;">
                  <span style="color:#E8721C;font-size:9px;">★</span>
                  <span style="color:#666;font-size:9px;letter-spacing:1px;"> AI-POWERED IC NOTE GENERATION</span>
                </td>
                <td style="padding-bottom:7px;">
                  <span style="color:#22c55e;font-size:8px;letter-spacing:2px;">[UNLOCKED]</span>
                </td>
              </tr>
              <tr>
                <td style="padding-right:12px;">
                  <span style="color:#E8721C;font-size:9px;">★</span>
                  <span style="color:#666;font-size:9px;letter-spacing:1px;"> REAL-TIME COLLABORATION</span>
                </td>
                <td>
                  <span style="color:#22c55e;font-size:8px;letter-spacing:2px;">[UNLOCKED]</span>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>

        <!-- Prompt -->
        <p style="color:#555;font-size:10px;line-height:1.8;margin:0 0 22px 0;">
          &gt;_ Click the button below to verify your email address.<br>
          &gt;_ This link expires in <span style="color:#E8721C;">24 hours</span>.
        </p>

        <!-- CTA -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
          <tr>
            <td style="background:#E8721C;text-align:center;">
              <a href="${confirmLink}"
                 style="display:block;color:#000;font-family:'Courier New',Courier,monospace;
                        font-size:11px;font-weight:bold;letter-spacing:5px;
                        text-decoration:none;padding:16px 20px;">
                ${btnLabel}
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

        <!-- Benchmark strip -->
        <table width="100%" cellpadding="0" cellspacing="0"
          style="background:#070707;border:1px solid #141414;margin-bottom:22px;">
          <tr><td style="padding:10px 14px;">
            <div style="color:#222;font-size:8px;letter-spacing:2px;margin-bottom:8px;">── BENCHMARK THRESHOLDS ─────────────────────</div>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="color:#2a2a2a;font-size:8px;letter-spacing:1px;padding-bottom:3px;">CURRENT RATIO</td>
                <td style="color:#2a2a2a;font-size:8px;letter-spacing:1px;padding-bottom:3px;">DSCR</td>
                <td style="color:#2a2a2a;font-size:8px;letter-spacing:1px;padding-bottom:3px;">DEBT/EQUITY</td>
                <td style="color:#2a2a2a;font-size:8px;letter-spacing:1px;padding-bottom:3px;">EBITDA MARGIN</td>
              </tr>
              <tr>
                <td style="color:#333;font-size:9px;font-weight:bold;">1.60x</td>
                <td style="color:#333;font-size:9px;font-weight:bold;">1.60x</td>
                <td style="color:#333;font-size:9px;font-weight:bold;">1.20x</td>
                <td style="color:#333;font-size:9px;font-weight:bold;">18.0%</td>
              </tr>
            </table>
          </td></tr>
        </table>

        <!-- Divider -->
        <div style="height:1px;background:#161616;margin-bottom:16px;"></div>

        <!-- Fallback -->
        <div style="color:#2a2a2a;font-size:8px;letter-spacing:2px;margin-bottom:6px;">&gt;_ FALLBACK URL:</div>
        <div style="color:#383838;font-size:8px;word-break:break-all;line-height:1.6;">${confirmLink}</div>

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
    const { type, email, password, full_name, redirect_url } = await req.json();
    if (!email) return new Response(JSON.stringify({ error: "Email required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const siteBase   = Deno.env.get("SITE_URL") ?? "https://rehbar-credit.vercel.app";
    const redirectTo = redirect_url ?? `${siteBase}/auth`;

    if (type === "signup") {
      // createUser — supabase sends NO email
      const { error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: false,          // user must click our verification link
        user_metadata: { full_name: full_name ?? "" },
      });

      if (createError) {
        const msg = createError.message?.toLowerCase() ?? "";
        if (msg.includes("already registered") || msg.includes("already been registered")) {
          return new Response(JSON.stringify({ ok: false, already_exists: true }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw createError;
      }

      // generateLink({ type: "magiclink" }) — supabase sends NO email
      const { data, error: linkError } = await supabase.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo },
      });
      if (linkError) throw linkError;

      await sendEmail(
        email,
        "[Rehbar] Verify your Credit Terminal account",
        verificationEmailHtml(data.properties.action_link, full_name, false),
      );

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "resend") {
      const { data, error } = await supabase.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo },
      });
      if (error) throw error;

      await sendEmail(
        email,
        "[Rehbar] New verification link — Credit Terminal",
        verificationEmailHtml(data.properties.action_link, undefined, true),
      );

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid type" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
