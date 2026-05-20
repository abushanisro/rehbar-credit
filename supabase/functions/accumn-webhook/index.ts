/**
 * Rehbar — Accumn API: Webhook Receiver
 * Called by Accumn when an order completes or is cancelled.
 * Verifies webhook key, updates order status, processes MRD on completion.
 * No user JWT needed — server-to-server call authenticated by query param key.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  getAccumnFileDetails,
  downloadAccumnMrd,
} from "../_shared/accumn-client.ts";
import { processMrd } from "../_shared/accumn-mrd-mapper.ts";

declare const Deno: { env: { get(k: string): string | undefined } };
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function processCompletedOrder(
  ffOrderId: string,
  productType: string,
  caseId: string,
  userId: string,
  orderId: string,
  serviceClient: ReturnType<typeof createClient>,
): Promise<void> {
  try {
    const files   = await getAccumnFileDetails(ffOrderId);
    const mrdFile = files.find(f =>
      f.file_category === "MRD" && f.mime_type === "application/json"
    ) ?? files.find(f => f.mime_type === "application/json");

    let reportData: unknown = {};
    let rowsWritten = 0;

    if (mrdFile) {
      const mrdJson = await downloadAccumnMrd(mrdFile.download_url);
      reportData = mrdJson;
      rowsWritten = await processMrd(productType, mrdJson, caseId, userId, serviceClient);
    }

    await serviceClient.from("accumn_api_orders").update({
      order_status:   "completed",
      files_metadata: files,
      report_data:    reportData,
      updated_at:     new Date().toISOString(),
    }).eq("id", orderId);

    console.log("Webhook: order completed", { orderId, ffOrderId, rowsWritten });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Webhook processCompletedOrder error:", msg);
    await serviceClient.from("accumn_api_orders").update({
      order_status:  "failed",
      error_message: msg.slice(0, 1000),
      updated_at:    new Date().toISOString(),
    }).eq("id", orderId);
  }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);

  // Verify webhook key
  const keyVal     = new URL(req.url).searchParams.get("key");
  const expectedKey = Deno.env.get("ACCUMN_WEBHOOK_KEY_VALUE");
  if (!expectedKey || keyVal !== expectedKey) {
    return new Response("Forbidden", { status: 403 });
  }

  // Respond 200 immediately — process in background
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  EdgeRuntime.waitUntil((async () => {
    try {
      let payload: Record<string, unknown>;
      try {
        payload = await req.json() as Record<string, unknown>;
      } catch {
        console.error("Webhook: failed to parse body");
        return;
      }

      const ffOrderId   = String(payload.ffOrderId   ?? payload.ff_order_id   ?? "");
      const orderStatus = String(payload.order_status ?? payload.orderStatus   ?? "");

      if (!ffOrderId) { console.error("Webhook: no ffOrderId in payload"); return; }

      // Look up our tracking row
      const { data: orderRow } = await serviceClient
        .from("accumn_api_orders")
        .select("id, product_type, case_id, user_id, order_status")
        .eq("ff_order_id", ffOrderId)
        .maybeSingle();

      if (!orderRow) { console.warn("Webhook: no order found for ffOrderId", ffOrderId); return; }
      const o = orderRow as { id: string; product_type: string; case_id: string; user_id: string; order_status: string };

      if (orderStatus === "Completed") {
        await processCompletedOrder(ffOrderId, o.product_type, o.case_id, o.user_id, o.id, serviceClient);
      } else if (orderStatus === "Cancelled") {
        await serviceClient.from("accumn_api_orders").update({
          order_status: "cancelled",
          updated_at:   new Date().toISOString(),
        }).eq("id", o.id);
        console.log("Webhook: order cancelled", { orderId: o.id });
      } else {
        // In Progress or other — just log
        console.log("Webhook: order status update", { ffOrderId, orderStatus });
      }
    } catch (e) {
      console.error("Webhook background error:", e instanceof Error ? e.message : e);
    }
  })());

  return json({ ok: true }, 200);
});

export {};
