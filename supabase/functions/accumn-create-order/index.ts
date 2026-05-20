/**
 * Rehbar — Accumn API: Create Order
 * Supports BSA (bank statement analysis), INSIGHTS (company financials), ITR_GST.
 * Returns 200 immediately; Accumn processing is async (poll or webhook).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleOptions } from "../_shared/cors.ts";
import {
  getLenderInfo,
  createAccumnOrder,
  createAccumnOrderMultipart,
  buildWebhookUrls,
} from "../_shared/accumn-client.ts";

declare const Deno: { env: { get(k: string): string | undefined } };

const json = (body: unknown, status = 200, cors: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

interface RequestBody {
  case_id: string;
  product_type: "INSIGHTS" | "BSA" | "ITR_GST";
  // INSIGHTS
  identifier_type?: "PAN" | "CIN";
  identifier_value?: string;
  // BSA
  bank_document_ids?: string[];
  poa_from_date?: string;
  poa_to_date?: string;
  sanction_limit?: number;
  // ITR_GST
  entity_type?: "individual" | "corporate";
  pan?: string;
  gstin?: string;
  borrower_doib?: string;
  borrower_email?: string;
  borrower_phone?: string;
  borrower_language?: string;
  redirect_url_success?: string;
  redirect_url_fail?: string;
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  const cors = getCorsHeaders(req);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401, cors);

    const body: RequestBody = await req.json();
    if (!body.case_id || !body.product_type) return json({ error: "case_id and product_type required" }, 400, cors);

    const supabaseUrl    = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient  = createClient(supabaseUrl, serviceRoleKey);

    // Get user identity from bearer token
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient  = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401, cors);

    // Load case + user profile for lender/requestor info
    const [{ data: cc }, { data: profile }] = await Promise.all([
      serviceClient.from("credit_cases").select("case_code, client_name").eq("id", body.case_id).single(),
      serviceClient.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle(),
    ]);
    if (!cc) return json({ error: "Case not found" }, 404, cors);

    const requestorName  = profile?.full_name ?? user.email ?? "Analyst";
    const requestorEmail = profile?.email     ?? user.email ?? "";

    const lenderInfo = {
      ...getLenderInfo(),
      lender_referenceNumber: cc.case_code,
    };
    const requestorInfo = {
      requestor_name:     requestorName,
      requestor_email:    requestorEmail,
      requestor_division: Deno.env.get("ACCUMN_REQUESTOR_DIVISION") ?? "Credit",
      requestor_branch:   "HQ",
      requestor_phone:    "",
    };
    const borrowerInfo = { borrower_name: cc.client_name };

    // Insert tracking row
    const { data: orderRow, error: insertErr } = await serviceClient
      .from("accumn_api_orders")
      .insert({
        case_id:      body.case_id,
        user_id:      user.id,
        product_type: body.product_type,
        order_status: "submitting",
        identifier:   body.identifier_value ?? body.pan ?? body.gstin ?? null,
      })
      .select("id")
      .single();
    if (insertErr || !orderRow) return json({ error: insertErr?.message ?? "Insert failed" }, 500, cors);

    const orderId = (orderRow as { id: string }).id;

    try {
      let ffOrderId: string;
      let consentLink: string | undefined;
      let duplicate = false;

      if (body.product_type === "INSIGHTS") {
        const result = await createAccumnOrder({
          request: "create-order",
          param: {
            lenderInfo,
            requestorInfo,
            borrowerInfo,
            dataRelatedInfo: {
              insightsInfo: { identifier: body.identifier_type ?? "PAN", value: body.identifier_value ?? "" },
            },
            orderInfo:    { product_name: "INSIGHTS" },
            webhook_urls: buildWebhookUrls(),
          },
        });
        ffOrderId = result.ffOrderId;
        duplicate = result.duplicate ?? false;

      } else if (body.product_type === "BSA") {
        // Build multipart form — JSON params as single "param" field, files as "bsaFiles"
        const form = new FormData();
        form.append("request", "create-order");
        form.append("param", JSON.stringify({
          lenderInfo,
          requestorInfo,
          borrowerInfo: {
            ...borrowerInfo,
            borrower_pan: body.pan ?? null,
          },
          dataRelatedInfo: {
            bsaInfo: {
              poa_from_date: body.poa_from_date ?? "",
              poa_to_date:   body.poa_to_date   ?? "",
              account_wise_sanction_limit: body.sanction_limit
                ? [{ bank_account_number: "default", sanction_limit: body.sanction_limit }]
                : [],
              passwords: [],
            },
          },
          orderInfo:    { product_name: "BSA" },
          webhook_urls: buildWebhookUrls(),
        }));

        // Download and attach bank statement PDFs
        const docIds = body.bank_document_ids ?? [];
        for (const docId of docIds) {
          const { data: docMeta } = await serviceClient
            .from("financial_documents")
            .select("file_path, file_name")
            .eq("id", docId)
            .single();
          if (!docMeta) continue;
          const { data: blob } = await serviceClient.storage.from("case-files").download(docMeta.file_path);
          if (!blob) continue;
          form.append("bsaFiles", new Blob([await (blob as Blob).arrayBuffer()], { type: "application/pdf" }), docMeta.file_name);
        }

        const result = await createAccumnOrderMultipart(form);
        ffOrderId = result.ffOrderId;
        duplicate = result.duplicate ?? false;

      } else {
        // ITR_GST
        const result = await createAccumnOrder({
          request: "create-order",
          param: {
            lenderInfo,
            requestorInfo,
            borrowerInfo: {
              ...borrowerInfo,
              borrower_pan:      body.pan              ?? null,
              borrower_DOIB:     body.borrower_doib    ?? "",
              borrower_email:    body.borrower_email   ?? "",
              borrower_phone:    body.borrower_phone   ?? "",
              borrower_language: body.borrower_language ?? "English",
            },
            dataRelatedInfo: {
              itrInfo: body.pan   ? [body.pan]   : [],
              gstInfo: body.gstin ? [body.gstin] : [],
            },
            orderInfo:    {
              product_name: body.entity_type === "corporate"
                ? "E-Financials(Corporate)"
                : "GST, E-Financials(Self Employed Individuals)",
              assistanceBy: "Lender Assisted",
            },
            otherInfo:    {
              send_consent_borrower: true,
              redirect_url_success:  body.redirect_url_success ?? "",
              redirect_url_fail:     body.redirect_url_fail    ?? "",
            },
            webhook_urls: buildWebhookUrls(),
          },
        });
        ffOrderId   = result.ffOrderId;
        consentLink = result.consentLink;
        duplicate   = result.duplicate ?? false;
      }

      // Update tracking row with Accumn's order ID
      await serviceClient
        .from("accumn_api_orders")
        .update({ ff_order_id: ffOrderId, order_status: "in_progress", consent_link: consentLink ?? null, updated_at: new Date().toISOString() })
        .eq("id", orderId);

      return json({ ok: true, order_id: orderId, ff_order_id: ffOrderId, consent_link: consentLink ?? null, duplicate }, 200, cors);

    } catch (apiErr) {
      const msg = apiErr instanceof Error ? apiErr.message : String(apiErr);
      await serviceClient
        .from("accumn_api_orders")
        .update({ order_status: "failed", error_message: msg.slice(0, 1000), updated_at: new Date().toISOString() })
        .eq("id", orderId);
      return json({ error: msg }, 500, cors);
    }

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("accumn-create-order:", msg);
    return json({ error: msg }, 500, cors);
  }
});

export {};
