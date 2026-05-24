/**
 * Rehbar — Vector Embedding Microservice
 * Generates Google Gemini text-embedding-004 embeddings for document page chunks
 * and stores them in document_chunks (pgvector). Called fire-and-forget from
 * trigger-analysis after successful extraction.
 *
 * Requires: GEMINI_API_KEY secret in Supabase.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleOptions } from "../_shared/cors.ts";

declare const Deno: { env: { get(key: string): string | undefined } };

const GEMINI_EMBEDDING_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent";

type PageChunk = { pageNum: number; text: string };

async function generateEmbedding(text: string, apiKey: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${GEMINI_EMBEDDING_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/text-embedding-004",
        content: { parts: [{ text: text.slice(0, 8192) }] },
      }),
    });
    if (!res.ok) {
      console.warn("Gemini embedding failed:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const json = await res.json();
    return json.embedding?.values ?? null;
  } catch (e) {
    console.warn("Embedding error:", String(e));
    return null;
  }
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  const cors = getCorsHeaders(req);

  try {
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return new Response(JSON.stringify({ ok: false, reason: "GEMINI_API_KEY not set" }), {
        status: 200, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const body: {
      case_id: string;
      document_id: string;
      chunks: PageChunk[];
    } = await req.json();

    if (!body.case_id || !body.document_id || !body.chunks?.length) {
      return new Response(JSON.stringify({ error: "Missing fields" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Delete old chunks for this document before inserting fresh ones
    await supabase.from("document_chunks")
      .delete()
      .eq("document_id", body.document_id);

    let inserted = 0;
    for (let i = 0; i < body.chunks.length; i++) {
      const chunk = body.chunks[i];
      if (chunk.text.length < 30) continue;

      const embedding = await generateEmbedding(chunk.text, geminiKey);
      if (!embedding) continue;

      const { error } = await supabase.from("document_chunks").insert({
        case_id:     body.case_id,
        document_id: body.document_id,
        chunk_index: i,
        page_number: chunk.pageNum,
        content:     chunk.text.slice(0, 4000),
        embedding:   JSON.stringify(embedding),
      });

      if (error) console.warn("Chunk insert error:", error.message);
      else inserted++;
    }

    return new Response(JSON.stringify({ ok: true, inserted }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("generate-embeddings error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
