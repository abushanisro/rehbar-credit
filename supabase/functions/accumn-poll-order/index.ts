/**
 * Rehbar — Accumn API: Poll Order Status
 * Checks status of one or all in-progress orders for a case.
 * On completion: downloads MRD JSON and maps to DB tables.
 * Returns 200 immediately; heavy work runs via EdgeRuntime.waitUntil.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleOptions } from "../_shared/cors.ts";
import {
  checkAccumnOrderStatus,
  getAccumnFileDetails,
  downloadAccumnMrd,
} from "../_shared/accumn-client.ts";
import { processMrd } from "../_shared/accumn-mrd-mapper.ts";

declare const Deno: { env: { get(k: string): string | undefined } };
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const json = (body: unknown, status = 200, cors: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

interface PollResult { order_id: string; status: string; rows_written?: number }

async function pollOrder(
  orderId: string,
  ffOrderId: string,
  productType: string,
  caseId: string,
  userId: string,
  serviceClient: ReturnType<typeof createClient>,
): Promise<PollResult> {
  try {
    const status = await checkAccumnOrderStatus(ffOrderId);

    if (status === "Completed") {
      const files  = await getAccumnFileDetails(ffOrderId);
      // Find JSON MRD file — prefer mime_type application/json, category MRD
      const mrdFile = files.find(f =>
        f.file_category === "MRD" && f.mime_type === "application/json"
      ) ?? files.find(f => f.mime_type === "application/json");

      let rowsWritten = 0;
      let reportData: unknown = {};

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

      return { order_id: orderId, status: "completed", rows_written: rowsWritten };
    }

    if (status === "Cancelled") {
      await serviceClient.from("accumn_api_orders").update({
        order_status: "cancelled",
        updated_at:   new Date().toISOString(),
      }).eq("id", orderId);
      return { order_id: orderId, status: "cancelled" };
    }

    return { order_id: orderId, status: "in_progress" };

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("pollOrder error", { orderId, error: msg });
    await serviceClient.from("accumn_api_orders").update({
      order_status:  "failed",
      error_message: msg.slice(0, 1000),
      updated_at:    new Date().toISOString(),
    }).eq("id", orderId);
    return { order_id: orderId, status: "failed" };
  }
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  const cors = getCorsHeaders(req);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401, cors);

    const body: { case_id: string; order_id?: string } = await req.json();
    if (!body.case_id) return json({ error: "case_id required" }, 400, cors);

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load target orders
    let query = serviceClient
      .from("accumn_api_orders")
      .select("id, ff_order_id, product_type, case_id, user_id")
      .eq("case_id", body.case_id)
      .eq("order_status", "in_progress");
    if (body.order_id) query = query.eq("id", body.order_id) as typeof query;

    const { data: orders } = await query;
    if (!orders?.length) return json({ results: [] }, 200, cors);

    // Return immediately — poll in background
    EdgeRuntime.waitUntil(
      Promise.all(
        orders.map(o =>
          pollOrder(
            (o as { id: string }).id,
            (o as { ff_order_id: string }).ff_order_id,
            (o as { product_type: string }).product_type,
            (o as { case_id: string }).case_id,
            (o as { user_id: string }).user_id,
            serviceClient,
          )
        )
      ).catch(e => console.error("poll batch error:", e instanceof Error ? e.message : e))
    );

    return json({ ok: true, polling: orders.map(o => (o as { id: string }).id) }, 200, cors);

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("accumn-poll-order:", msg);
    return json({ error: msg }, 500, cors);
  }
});

export {};
