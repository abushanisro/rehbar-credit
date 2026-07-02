import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI } from "../_shared/ai-caller.ts";
import { getCorsHeaders, handleOptions } from "../_shared/cors.ts";

declare const Deno: { env: { get(key: string): string | undefined } };

const SONNET = "claude-sonnet-4-6";

const INLINE_THRESHOLDS: Record<string, { g: number; a: number; hi: boolean }> = {
  dscr:              { g: 1.5,  a: 1.25, hi: true  },
  current_ratio:     { g: 1.5,  a: 1.0,  hi: true  },
  debt_to_equity:    { g: 2.0,  a: 3.0,  hi: false },
  ebitda_margin:     { g: 0.15, a: 0.08, hi: true  },
  net_profit_margin: { g: 0.10, a: 0.05, hi: true  },
};

function ratioStatus(name: string, value: number): "GREEN" | "AMBER" | "RED" {
  const t = INLINE_THRESHOLDS[name];
  if (!t) return "GREEN";
  const ok = t.hi ? value >= t.g : value <= t.g;
  const mid = t.hi ? value >= t.a : value <= t.a;
  return ok ? "GREEN" : mid ? "AMBER" : "RED";
}

function buildGroundTruth(
  financials: Record<string, unknown>[],
  ratios: Record<string, unknown>[],
  deal: Record<string, unknown>,
): string {
  const lines: string[] = ["=== GROUND TRUTH — use this as the only source of truth ==="];

  lines.push(`\n[DEAL] client_name=${deal.client_name}, deal_amount=${deal.deal_amount} lakhs, product_type=${deal.product_type}`);

  const plRows = financials.filter(r => r.statement_type === "profit_loss");
  if (plRows.length > 0) {
    lines.push("\n[P&L — all values in lakhs]");
    for (const row of plRows) {
      const items = Array.isArray(row.line_items) ? row.line_items as { label: string; value: number | null; override_value?: number | null }[] : [];
      const vals = items.map(i => `${i.label}=${i.override_value ?? i.value}`).join(", ");
      lines.push(`  FY${row.fiscal_year}: ${vals}`);
    }
  }

  const bsRows = financials.filter(r => r.statement_type === "balance_sheet");
  if (bsRows.length > 0) {
    lines.push("\n[Balance Sheet — all values in lakhs]");
    for (const row of bsRows) {
      const items = Array.isArray(row.line_items) ? row.line_items as { label: string; value: number | null; override_value?: number | null }[] : [];
      const vals = items.map(i => `${i.label}=${i.override_value ?? i.value}`).join(", ");
      lines.push(`  FY${row.fiscal_year}: ${vals}`);
    }
  }

  if (ratios.length > 0) {
    lines.push("\n[Financial Ratios — ground truth thresholds]");
    for (const r of ratios) {
      const name = String(r.ratio_name ?? "");
      const val  = Number(r.ratio_value ?? 0);
      const status = r.threshold_status ?? ratioStatus(name, val);
      lines.push(`  ${name}=${val} (status: ${status})`);
    }
  }

  return lines.join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  const cors = getCorsHeaders(req);

  const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase     = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json() as {
      case_id:        string;
      generation_run: string;
      ic_note:        Record<string, unknown>;
      financials:     Record<string, unknown>[];
      ratios:         Record<string, unknown>[];
      deal:           Record<string, unknown>;
    };

    const { case_id, generation_run, ic_note, financials = [], ratios = [], deal } = body;

    if (!case_id || !generation_run || !ic_note) {
      return new Response(JSON.stringify({ error: "Missing required fields: case_id, generation_run, ic_note" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Build ground truth block from actual DB data
    const groundTruth = buildGroundTruth(financials, ratios, deal ?? {});

    // Extract sections from ic_note
    const sections = (ic_note.section_templates ?? ic_note.sections ?? {}) as Record<string, unknown>;
    const sectionText = Object.entries(sections)
      .map(([id, val]) => {
        const md = typeof val === "object" && val !== null
          ? ((val as Record<string, unknown>).markdown ?? JSON.stringify(val))
          : String(val ?? "");
        return `[SECTION: ${id}]\n${md}`;
      })
      .join("\n\n");

    if (!sectionText.trim()) {
      return new Response(JSON.stringify({ errors: [], count: 0, generation_run }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are a credit quality auditor reviewing AI-generated IC Appraisal Notes for an Islamic NBFC (Rehbar Financial Services).

Your job is to find factual and logical errors in the AI-generated narrative text — not to rewrite it.

ERROR TYPES:
- hallucination: AI states a specific number or fact not present anywhere in the ground truth data
- unit_error: a number is stated in the wrong unit (e.g. crores vs lakhs — a 100× mismatch)
- cross_section_mismatch: two different sections state contradictory figures for the same metric (e.g. Section I says revenue ₹50Cr but Section V table header says ₹500L)
- missing_data: a required analytical field is empty, says "analyst to confirm", or contains only placeholder text
- illogical_narrative: the narrative text uses positive language ("adequate", "comfortable", "strong") for a metric whose ground truth status is RED or AMBER
- template_gap: an entire section was generated but contains no substantive analysis (just boilerplate or filler)

GROUND TRUTH — you must only validate against these numbers:
${groundTruth}

RULES:
- Only flag things you are confident are errors against the ground truth
- Do not flag missing optional context (like industry comparisons or peer data)
- Severity "hard" = materially wrong fact or metric, likely to mislead IC decision; "warn" = unclear, inconsistent, or weak analysis
- Return 0 errors if the note is accurate — do not invent issues
- The detail field must quote the exact erroneous text from the section`;

    const userText = `Review these IC note sections for errors against the ground truth above:\n\n${sectionText}`;

    const result = await callAI({
      systemPrompt,
      userText,
      toolName: "report_ic_errors",
      toolDescription: "Report all factual and logical errors found in the IC note sections.",
      toolSchema: {
        errors: {
          type: "array",
          description: "List of errors found. Empty array if note is accurate.",
          items: {
            type: "object",
            properties: {
              section_id:    { type: "string", description: "The section ID where the error occurs (e.g. 'executive_summary')" },
              error_type:    { type: "string", enum: ["hallucination","unit_error","cross_section_mismatch","missing_data","illogical_narrative","template_gap"] },
              severity:      { type: "string", enum: ["hard","warn"] },
              title:         { type: "string", description: "Short title of the error (max 10 words)" },
              detail:        { type: "string", description: "Explain the error and quote the erroneous text" },
              suggested_fix: { type: "string", description: "Specific correction to apply" },
            },
            required: ["section_id","error_type","severity","title","detail"],
            additionalProperties: false,
          },
        },
      },
      toolRequired: ["errors"],
      model: SONNET,
      maxTokens: 3000,
      retries: 1,
      timeoutMs: 90_000,
    });

    const errors = (result.errors as Record<string, unknown>[] ?? []).filter(
      e => typeof e.section_id === "string" && typeof e.error_type === "string"
    );

    // Persist to DB
    if (errors.length > 0) {
      const rows = errors.map(e => ({
        case_id,
        generation_run,
        section_id:    String(e.section_id),
        error_type:    String(e.error_type),
        severity:      String(e.severity ?? "warn"),
        title:         String(e.title ?? "").slice(0, 200),
        detail:        String(e.detail ?? "").slice(0, 1000),
        suggested_fix: e.suggested_fix ? String(e.suggested_fix).slice(0, 500) : null,
      }));

      const { error: dbErr } = await supabase.from("ic_ai_errors").insert(rows);
      if (dbErr) console.error("ic_ai_errors insert error:", dbErr.message);
    }

    return new Response(JSON.stringify({ errors, count: errors.length, generation_run }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("validate-ic-analysis error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
