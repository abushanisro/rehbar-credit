/**
 * CORS helper — restricts edge function access to known origins only.
 * Wildcard (*) is intentionally NOT used; any unlisted origin is denied.
 */

const ALLOWED_ORIGINS = [
  "https://credit.rehbarfin.com",
  // Development origins — harmless in prod (browser enforces CORS, not this list)
  "http://localhost:5173",
  "http://localhost:3000",
];

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : "https://credit.rehbarfin.com";
  return {
    "Access-Control-Allow-Origin":  allowed,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Max-Age":       "86400",
    "Vary":                         "Origin",
  };
}

export function handleOptions(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: getCorsHeaders(req) });
}
