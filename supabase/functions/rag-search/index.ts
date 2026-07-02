/**
 * Rehbar — RAG Knowledge Base proxy
 * Proxies Supermemory REST API + merges ic_ai_errors confirmed errors.
 * Actions: search | list | add | delete
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleOptions } from "../_shared/cors.ts";

declare const Deno: { env: { get(key: string): string | undefined } };

const SM_API = "https://api.supermemory.ai/v3";

function smHeaders(key: string) {
  return { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  const cors = getCorsHeaders(req);

  const smKey = Deno.env.get("SUPERMEMORY_API_KEY");
  if (!smKey) {
    return new Response(JSON.stringify({ error: "SUPERMEMORY_API_KEY not configured" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json() as {
      action:   "search" | "list" | "add" | "delete";
      query?:   string;
      tags?:    string[];
      limit?:   number;
      content?: string;
      metadata?: Record<string, string>;
      memory_id?: string;
    };

    const { action, query, tags, limit = 20, content, metadata, memory_id } = body;

    // ── SEARCH ───────────────────────────────────────────────────────────────
    if (action === "search") {
      const q = encodeURIComponent(query ?? "rehbar IC errors");
      const tagParam = (tags?.length ?? 0) > 0 ? `&containerTags=${encodeURIComponent(tags![0])}` : "&containerTags=rehbar-ic-errors";
      const res = await fetch(
        `${SM_API}/search?q=${q}${tagParam}&limit=${limit}`,
        { headers: smHeaders(smKey), signal: AbortSignal.timeout(8_000) },
      );
      if (!res.ok) {
        const t = await res.text();
        return new Response(JSON.stringify({ error: `Supermemory search ${res.status}: ${t.slice(0, 200)}` }), {
          status: 502, headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      const json = await res.json() as { results?: unknown[] };
      return new Response(JSON.stringify({ results: json.results ?? [] }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ── LIST ─────────────────────────────────────────────────────────────────
    if (action === "list") {
      // Fetch recent confirmed errors from DB
      const { data: dbErrors } = await sb
        .from("ic_ai_errors")
        .select("id, case_id, section_id, error_type, severity, title, detail, suggested_fix, analyst_verdict, analyst_note, supermemory_id, created_at")
        .eq("analyst_verdict", "confirmed")
        .order("created_at", { ascending: false })
        .limit(50);

      // Fetch recent memories from Supermemory
      const smRes = await fetch(
        `${SM_API}/search?q=rehbar+IC+credit+analysis&containerTags=rehbar-ic-errors&limit=${Math.min(limit, 30)}`,
        { headers: smHeaders(smKey), signal: AbortSignal.timeout(8_000) },
      ).catch(() => null);

      let smMemories: unknown[] = [];
      if (smRes?.ok) {
        const j = await smRes.json() as { results?: unknown[] };
        smMemories = j.results ?? [];
      }

      return new Response(JSON.stringify({
        db_errors:   dbErrors ?? [],
        sm_memories: smMemories,
        stats: {
          confirmed_errors: (dbErrors ?? []).length,
          sm_count:         smMemories.length,
        },
      }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ── ADD ──────────────────────────────────────────────────────────────────
    if (action === "add") {
      if (!content?.trim()) {
        return new Response(JSON.stringify({ error: "content is required" }), {
          status: 400, headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      const containerTags = (tags?.length ?? 0) > 0 ? tags! : ["rehbar-ic-errors", "manual"];
      const res = await fetch(`${SM_API}/memories`, {
        method: "POST",
        headers: smHeaders(smKey),
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          content,
          containerTags,
          metadata: { ...metadata, source: "manual", created_at: new Date().toISOString() },
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        return new Response(JSON.stringify({ error: `Supermemory add ${res.status}: ${t.slice(0, 200)}` }), {
          status: 502, headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      const json = await res.json() as { id?: string };
      return new Response(JSON.stringify({ ok: true, id: json.id }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ── DELETE ───────────────────────────────────────────────────────────────
    if (action === "delete") {
      if (!memory_id) {
        return new Response(JSON.stringify({ error: "memory_id is required" }), {
          status: 400, headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      const res = await fetch(`${SM_API}/memories/${memory_id}`, {
        method: "DELETE",
        headers: smHeaders(smKey),
        signal: AbortSignal.timeout(8_000),
      });
      return new Response(JSON.stringify({ ok: res.ok, status: res.status }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("rag-search error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
