/**
 * CORS helper — restricts edge function access to known origins only.
 * Any localhost origin is allowed for development (browser enforces CORS, not this list).
 */

const PROD_ORIGIN = "https://credit.rehbarfin.com";

function isAllowed(origin: string): boolean {
  if (origin === PROD_ORIGIN) return true;
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  return false;
}

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = isAllowed(origin) ? origin : PROD_ORIGIN;
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
