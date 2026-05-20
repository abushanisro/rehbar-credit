/**
 * Accumn API client — shared by accumn-create-order, accumn-poll-order, accumn-webhook.
 * Token is non-expiring; stored as ACCUMN_API_TOKEN secret.
 * Falls back to email+password login if secret is absent, retries once on 401.
 */

declare const Deno: { env: { get(k: string): string | undefined } };

// UAT: https://dev-unicore-api.accumn.co/los/api/v1/api-details
// Production: https://unicore-api.accumn.ai/los/api/v1/api-details
export const ACCUMN_BASE_URL = () =>
  Deno.env.get("ACCUMN_API_URL") ??
  "https://dev-unicore-api.accumn.co/los/api/v1/api-details";

export function getLenderInfo() {
  return {
    lender_name:   Deno.env.get("ACCUMN_LENDER_NAME") ?? "Rehbar Financial Services",
    lender_source: "los",
  };
}

export interface AccumnFileDetail {
  source: string;
  file_id: string | number;
  file_name: string;
  file_category: "REPORT" | "MRD" | "RAW" | "CAM_REPORT" | "BP_UPLOAD";
  mime_type: string;
  file_size_in_bytes?: number;
  download_url: string;
  url_expiry_time_epoch_ms?: number;
  key: string;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

async function loginFresh(): Promise<string> {
  const email    = Deno.env.get("ACCUMN_EMAIL");
  const password = Deno.env.get("ACCUMN_PASSWORD");
  if (!email || !password) throw new Error("ACCUMN_EMAIL / ACCUMN_PASSWORD not set");
  const res = await fetch(ACCUMN_BASE_URL(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request: "login", param: { emailId: email, password } }),
  });
  const json = await res.json() as { statusCode: number; data?: { api_auth_token: string }; msg?: string };
  if (json.statusCode !== 1 || !json.data?.api_auth_token)
    throw new Error(`Accumn login failed: ${json.msg ?? "unknown"}`);
  return json.data.api_auth_token;
}

let _cachedToken: string | null = null;

export async function getAccumnToken(): Promise<string> {
  if (_cachedToken) return _cachedToken;
  const envToken = Deno.env.get("ACCUMN_API_TOKEN");
  if (envToken) { _cachedToken = envToken; return envToken; }
  _cachedToken = await loginFresh();
  return _cachedToken!;
}

// ── Core HTTP helpers ────────────────────────────────────────────────────────

async function callWithToken<T>(body: unknown, token: string): Promise<T> {
  const res = await fetch(ACCUMN_BASE_URL(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "client-security-token": token,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Accumn HTTP ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function callAccumn<T = unknown>(body: unknown): Promise<T> {
  const token = await getAccumnToken();
  try {
    const resp = await callWithToken<{ statusCode?: number } & T>(body, token);
    return resp as T;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("401")) {
      // Re-authenticate once and retry
      _cachedToken = null;
      const freshToken = await loginFresh();
      _cachedToken = freshToken;
      return callWithToken<T>(body, freshToken);
    }
    throw e;
  }
}

export async function callAccumnMultipart<T = unknown>(formData: FormData): Promise<T> {
  const token = await getAccumnToken();
  const res = await fetch(ACCUMN_BASE_URL(), {
    method: "POST",
    headers: { "client-security-token": token },
    body: formData,
  });
  if (!res.ok) throw new Error(`Accumn multipart HTTP ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ── API operations ───────────────────────────────────────────────────────────

interface CreateOrderResponse {
  statusCode: number;
  data?: { ffOrderId?: string; consent_link?: string };
  msg?: string;
}

export async function createAccumnOrder(payload: Record<string, unknown>): Promise<{ ffOrderId: string; consentLink?: string; duplicate?: boolean }> {
  const resp = await callAccumn<CreateOrderResponse>(payload);
  // statusCode 1 = success, statusCode 2 = duplicate order (ffOrderId still valid)
  if ((resp.statusCode !== 1 && resp.statusCode !== 2) || !resp.data?.ffOrderId)
    throw new Error(`Accumn create-order failed: ${resp.msg ?? "no ffOrderId"}`);
  return { ffOrderId: resp.data.ffOrderId, consentLink: resp.data.consent_link, duplicate: resp.statusCode === 2 };
}

export async function createAccumnOrderMultipart(formData: FormData): Promise<{ ffOrderId: string; duplicate?: boolean }> {
  const resp = await callAccumnMultipart<CreateOrderResponse>(formData);
  if ((resp.statusCode !== 1 && resp.statusCode !== 2) || !resp.data?.ffOrderId)
    throw new Error(`Accumn BSA create-order failed: ${resp.msg ?? "no ffOrderId"}`);
  return { ffOrderId: resp.data.ffOrderId, duplicate: resp.statusCode === 2 };
}

interface StatusResponse {
  statusCode: number;
  data?: { ffOrderId?: string; order_status?: string; order_details?: Array<{ source: string; order_status: string; key?: string }> };
  msg?: string;
}

export async function checkAccumnOrderStatus(ffOrderId: string): Promise<"In Progress" | "Completed" | "Cancelled"> {
  const resp = await callAccumn<StatusResponse>({
    request: "check-order-status",
    param:   { ffOrderId },
  });
  const status = resp.data?.order_status ?? "";
  if (status === "Completed")  return "Completed";
  if (status === "Cancelled")  return "Cancelled";
  return "In Progress";
}

interface FileDetailsResponse {
  statusCode: number;
  data?: { file_details?: AccumnFileDetail[] };
  msg?: string;
}

export async function getAccumnFileDetails(ffOrderId: string): Promise<AccumnFileDetail[]> {
  const resp = await callAccumn<FileDetailsResponse>({
    request: "get-file-details",
    param:   { ffOrderId, incremental: false },
  });
  return resp.data?.file_details ?? [];
}

export async function downloadAccumnMrd(downloadUrl: string): Promise<unknown> {
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`MRD download HTTP ${res.status}`);
  return res.json();
}

// ── Webhook URL builder ──────────────────────────────────────────────────────

export function buildWebhookUrls(): Array<{ webhook_url: string; key_name: string; key_value: string }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const keyValue    = Deno.env.get("ACCUMN_WEBHOOK_KEY_VALUE") ?? "rehbar-accumn-webhook";
  return [{ webhook_url: `${supabaseUrl}/functions/v1/accumn-webhook?key=${keyValue}`, key_name: "key", key_value: keyValue }];
}
