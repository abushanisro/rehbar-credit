import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

declare const Deno: { env: { get(k: string): string | undefined } };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM = "Rehbar Credit Terminal <onboarding@resend.dev>";

const ROLE_LABEL: Record<string, string> = {
  admin:              "ADMINISTRATOR",
  analyst:            "CREDIT ANALYST",
  business_development: "BUSINESS DEVELOPMENT",
  ic_member:          "IC MEMBER",
  credit_committee:   "CREDIT COMMITTEE",
  operations:         "OPERATIONS",
};

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

function sid() { return Math.random().toString(36).substring(2, 10).toUpperCase(); }

function inviteEmailHtml(opts: {
  inviteLink:    string;
  caseCode:      string;
  clientName:    string;
  role:          string;
  invitedByEmail: string;
  assigneeName:  string;
}) {
  const { inviteLink, caseCode, clientName, role, invitedByEmail, assigneeName } = opts;
  const roleLabel = ROLE_LABEL[role] ?? role.toUpperCase();
  const sessionId = sid();
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const greeting = assigneeName ? `Hello ${assigneeName},` : "Hello,";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Rehbar Credit Terminal — You've been assigned</title>
</head>
<body style="margin:0;padding:0;background:#060606;font-family:'Courier New',Courier,monospace;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#060606;padding:36px 16px;">
<tr><td align="center">

  <table width="580" cellpadding="0" cellspacing="0"
    style="max-width:580px;width:100%;
           border-top:1px solid #242424;
           border-right:1px solid #1a1a1a;
           border-bottom:1px solid #1a1a1a;
           border-left:3px solid #E8721C;
           background:#0a0a0a;">

    <!-- TOP CHROME -->
    <tr>
      <td style="background:#0d0d0d;border-bottom:1px solid #1e1e1e;padding:10px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td valign="middle">
            <span style="color:#E8721C;font-size:14px;">●</span>
            <span style="color:#E8721C;font-size:9px;font-weight:bold;letter-spacing:4px;"> REHBAR CREDIT TERMINAL</span>
            <span style="color:#2e2e2e;font-size:9px;letter-spacing:2px;"> v1.0.0</span>
          </td>
          <td align="right" valign="middle">
            <span style="color:#2a2a2a;font-size:8px;letter-spacing:1px;">SID:${sessionId}</span>
          </td>
        </tr></table>
      </td>
    </tr>

    <!-- BOOT LOG -->
    <tr>
      <td style="background:#070707;border-bottom:1px solid #161616;padding:14px 20px;">
        <div style="color:#2e2e2e;font-size:8px;letter-spacing:3px;margin-bottom:10px;"># SYSTEM INIT — ${ts}</div>
        <div style="color:#22c55e;font-size:9px;line-height:2;letter-spacing:0.5px;">CREDIT ANALYSIS ENGINE...............<span style="color:#16a34a;">[ONLINE]</span></div>
        <div style="color:#22c55e;font-size:9px;line-height:2;letter-spacing:0.5px;">ROLE ASSIGNMENT MODULE...............<span style="color:#16a34a;">[${roleLabel}]</span></div>
        <div style="color:#22c55e;font-size:9px;line-height:2;letter-spacing:0.5px;">COLLABORATION PROTOCOL...............<span style="color:#16a34a;">[OPEN]</span></div>
        <div style="color:#E8721C;font-size:9px;line-height:2;letter-spacing:0.5px;">CASE ASSIGNMENT DISPATCHED...........<span style="color:#c2601a;">[PENDING ACCEPTANCE]</span></div>
      </td>
    </tr>

    <!-- MAIN BODY -->
    <tr>
      <td style="padding:28px 24px 20px 24px;">

        <div style="color:#333;font-size:8px;letter-spacing:4px;margin-bottom:4px;">▶ CASE ASSIGNMENT NOTICE</div>
        <div style="height:1px;background:linear-gradient(to right,#2a2a2a,#111);margin-bottom:22px;"></div>

        <p style="color:#bbb;font-size:12px;line-height:1.9;margin:0 0 8px 0;">${greeting}</p>
        <p style="color:#bbb;font-size:12px;line-height:1.9;margin:0 0 22px 0;">
          <span style="color:#E8721C;font-weight:bold;">${invitedByEmail}</span> has assigned you to a credit case on
          <span style="color:#E8721C;font-weight:bold;">Rehbar Credit Terminal</span>
          as <span style="color:#E8721C;font-weight:bold;">${roleLabel}</span>.
        </p>

        <!-- Case details panel -->
        <table width="100%" cellpadding="0" cellspacing="0"
          style="background:#070707;border:1px solid #1e1e1e;border-left:2px solid #E8721C;margin-bottom:24px;">
          <tr><td style="padding:16px 18px;">
            <div style="color:#2e2e2e;font-size:8px;letter-spacing:3px;margin-bottom:14px;">─── CASE MANIFEST ──────────────────────────────</div>
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
                <td style="color:#444;font-size:9px;letter-spacing:2px;padding-bottom:8px;padding-right:20px;">YOUR ROLE</td>
                <td style="font-size:9px;padding-bottom:8px;">
                  <span style="color:#555;">: </span>
                  <span style="color:#E8721C;font-weight:bold;letter-spacing:1px;">${roleLabel}</span>
                </td>
              </tr>
              <tr>
                <td style="color:#444;font-size:9px;letter-spacing:2px;padding-right:20px;">ASSIGNED BY</td>
                <td style="font-size:9px;">
                  <span style="color:#555;">: </span>
                  <span style="color:#888;letter-spacing:1px;">${invitedByEmail}</span>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>

        <p style="color:#555;font-size:10px;line-height:1.8;margin:0 0 22px 0;">
          &gt;_ Click below to accept your invite and access the case workspace.<br>
          &gt;_ You will set your password on first login.
        </p>

        <!-- CTA -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
          <tr>
            <td style="background:#E8721C;text-align:center;">
              <a href="${inviteLink}"
                 style="display:block;color:#000;font-family:'Courier New',Courier,monospace;
                        font-size:11px;font-weight:bold;letter-spacing:5px;
                        text-decoration:none;padding:16px 20px;">
                &#91; ACCEPT &amp; OPEN CASE &#93;
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

        <div style="height:1px;background:#161616;margin-bottom:16px;"></div>
        <div style="color:#2a2a2a;font-size:8px;letter-spacing:2px;margin-bottom:6px;">&gt;_ FALLBACK URL:</div>
        <div style="color:#383838;font-size:8px;word-break:break-all;line-height:1.6;">${inviteLink}</div>

      </td>
    </tr>

    <!-- FOOTER -->
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
    const {
      email,
      name         = "",
      role         = "analyst",
      case_code    = "",
      client_name  = "",
      invited_by_email = "",
      redirect_url,
    } = await req.json();

    if (!email) return new Response(JSON.stringify({ error: "Email required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const siteBase   = Deno.env.get("SITE_URL") ?? "https://rehbar-credit.vercel.app";
    const redirectTo = redirect_url ?? siteBase;

    // Create the user (no Supabase email sent with createUser)
    const { data: userData, error: createError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        full_name:        name || null,
        role,
        invited_to_case:  case_code,
        invited_client:   client_name,
        invited_by_email,
      },
    });

    let alreadyExists = false;
    let userId: string | undefined;

    if (createError) {
      const msg = createError.message?.toLowerCase() ?? "";
      if (msg.includes("already been registered") || msg.includes("already registered")) {
        alreadyExists = true;
        // Look up existing user id so we can still assign role
        const { data: list } = await admin.auth.admin.listUsers();
        userId = list?.users?.find(u => u.email === email)?.id;
      } else {
        throw createError;
      }
    } else {
      userId = userData.user?.id;
    }

    // Assign (or update) role — remove any other roles then insert the desired one
    if (userId) {
      await admin.from("user_roles").delete().eq("user_id", userId);
      await admin.from("user_roles").insert({ user_id: userId, role });

      // Upsert display name into user_profiles if provided
      if (name) {
        await admin.from("user_profiles").upsert({ id: userId, full_name: name }, { onConflict: "id" });
      }
    }

    if (alreadyExists) {
      return new Response(JSON.stringify({
        ok: false,
        already_exists: true,
        error: "This email already has a Rehbar account — share the case link directly.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Generate magic link (no Supabase email sent with generateLink)
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    if (linkError) throw linkError;

    await sendEmail(
      email,
      `[Rehbar] You've been assigned: ${case_code} — ${client_name}`,
      inviteEmailHtml({
        inviteLink:     linkData.properties.action_link,
        caseCode:       case_code,
        clientName:     client_name,
        role,
        invitedByEmail: invited_by_email,
        assigneeName:   name,
      }),
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
