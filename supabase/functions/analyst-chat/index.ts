/**
 * Rehbar — AI Financial Analyst Chat
 * Global mode: no case_id — loads pipeline / company overview.
 * Case mode:   case_id present — loads full single-case data.
 * Stateless: caller sends full message history each turn.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleOptions } from "../_shared/cors.ts";

interface ChatMessage { role: "user" | "assistant"; content: string }
type LineItem = { label: string; value: number | null; override_value?: number | null };
interface CaseOverview {
  client_name?: string;
  product_type?: string;
  product_type_custom?: string;
  industry?: string;
  legal_constitution?: string;
  year_established?: number;
  principal_borrower?: string;
  deal_amount?: number;
  tenure_months?: number;
  expected_irr?: number;
  end_use?: string;
  collateral_summary?: string;
  analyst_notes?: string;
  status?: string;
}
interface CaseRecord {
  id: string;
  case_code: string;
  client_name: string;
  product_type: string;
  product_type_custom: string | null;
  industry: string | null;
  status: string;
  deal_amount: number | null;
  tenure_months: number | null;
  expected_irr: number | null;
  created_at: string;
}
interface CompanyRecord {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  created_at: string;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function rv(item: LineItem): number | null {
  if (item.override_value !== undefined && item.override_value !== null) return item.override_value;
  return item.value;
}

function fmt(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function fmtRatio(name: string, v: number | null): string {
  if (v === null || !Number.isFinite(Number(v))) return "—";
  const PCT = new Set(["gross_margin","ebitda_margin","net_profit_margin","pat_margin","roa","roe","roce","roic","ronw"]);
  if (["debtor_days","creditor_days"].includes(name)) return String(Math.round(Number(v))) + " days";
  if (PCT.has(name)) return (Number(v) * 100).toFixed(1) + "%";
  return Number(v).toFixed(2) + "x";
}

// ── Case-level context builders ───────────────────────────────────────────────

function buildFinancialContext(
  financials: { fiscal_year: number; statement_type: string; line_items: unknown; unit?: string | null }[],
  unit: string,
): string {
  const byYear = new Map<number, Record<string, number | null>>();
  for (const row of financials) {
    if (row.statement_type === "projections") continue;
    const items = (row.line_items as LineItem[]) ?? [];
    const existing = byYear.get(row.fiscal_year) ?? {};
    for (const item of items) {
      if (!(item.label in existing)) existing[item.label] = rv(item);
    }
    byYear.set(row.fiscal_year, existing);
  }
  if (byYear.size === 0) return "No historical financials extracted yet.";
  const years = [...byYear.keys()].sort();
  const allLabels = [...new Set(years.flatMap(y => Object.keys(byYear.get(y)!)))];
  const lines: string[] = [`(${unit})`];
  for (const label of allLabels) {
    const vals = years.map(y => `FY${y}: ${fmt(byYear.get(y)![label] ?? null)}`).join("  |  ");
    lines.push(`  ${label}: ${vals}`);
  }
  return lines.join("\n");
}

function buildRatioContext(
  ratios: { fiscal_year: number; ratio_name: string; ratio_value: number | null; threshold_status: string; benchmark: number | null }[],
): string {
  if (!ratios.length) return "No ratios computed yet.";
  const byName = new Map<string, typeof ratios>();
  for (const r of ratios) {
    if (!byName.has(r.ratio_name)) byName.set(r.ratio_name, []);
    byName.get(r.ratio_name)!.push(r);
  }
  const lines: string[] = [];
  for (const [name, rows] of byName) {
    const sorted = [...rows].sort((a, b) => a.fiscal_year - b.fiscal_year);
    const vals = sorted.map(r => `FY${r.fiscal_year}: ${fmtRatio(name, r.ratio_value)} [${r.threshold_status.toUpperCase()}]`).join("  |  ");
    const bm = sorted[0]?.benchmark != null ? `  benchmark: ${fmtRatio(name, sorted[0].benchmark)}` : "";
    lines.push(`  ${name}: ${vals}${bm}`);
  }
  return lines.join("\n");
}

function buildBankContext(
  bank: { month: string; bank_name?: string | null; total_credits?: number | null; total_debits?: number | null; avg_balance?: number | null; bounce_inward?: number | null; bounce_outward?: number | null; emi_outflows?: number | null }[],
): string {
  if (!bank.length) return "No bank statement data.";
  return bank.map(b =>
    `  ${b.month} | ${b.bank_name ?? "—"} | credits: ${fmt(b.total_credits ?? null)} | debits: ${fmt(b.total_debits ?? null)} | avg_bal: ${fmt(b.avg_balance ?? null)} | bounces_in: ${b.bounce_inward ?? 0} | bounces_out: ${b.bounce_outward ?? 0} | emi_out: ${fmt(b.emi_outflows ?? null)}`
  ).join("\n");
}

function buildGstContext(
  gst: { period: string; return_type?: string | null; total_turnover?: number | null; taxable_turnover?: number | null; net_tax_paid?: number | null; filing_status?: string | null }[],
): string {
  if (!gst.length) return "No GST return data.";
  return gst.map(g =>
    `  ${g.period} | ${g.return_type ?? "—"} | turnover: ${fmt(g.total_turnover ?? null)} | taxable: ${fmt(g.taxable_turnover ?? null)} | net_tax: ${fmt(g.net_tax_paid ?? null)} | status: ${g.filing_status ?? "—"}`
  ).join("\n");
}

function buildEmiContext(
  emi: { emi_number: number; due_date: string; emi_amount: number; status: string; paid_amount?: number | null; outstanding_balance: number }[],
): string {
  if (!emi.length) return "No EMI schedule.";
  const overdue = emi.filter(e => e.status === "overdue").length;
  const partial = emi.filter(e => e.status === "partial").length;
  const paid    = emi.filter(e => e.status === "paid").length;
  const pending = emi.filter(e => e.status === "pending").length;
  const summary = `  Total: ${emi.length} | Paid: ${paid} | Pending: ${pending} | Overdue: ${overdue} | Partial: ${partial}`;
  const details = emi.slice(0, 24).map(e =>
    `  EMI#${e.emi_number} | ${e.due_date} | ₹${fmt(e.emi_amount)} | ${e.status.toUpperCase()} | outstanding: ${fmt(e.outstanding_balance)}`
  );
  return [summary, ...details].join("\n");
}

// ── System prompt builders ────────────────────────────────────────────────────

const ANALYST_RULES = `You are Rehbar — a senior credit analyst AI embedded in Rehbar Financial Services' credit appraisal platform.
You speak directly to analysts. Be concise, precise, and analytical — like a senior colleague, not a chatbot.

RULES:
- Never recommend Approve / Decline / Defer. Your role is analysis and insight only.
- Flag anomalies, trends, and risks proactively when relevant.
- Keep answers short. Use bullets where helpful. No filler phrases.
- Always state the unit (Lakhs / Crores) when quoting financial figures.
- You know what page the analyst is currently viewing — use that context.`;

async function buildCaseSystemPrompt(
  sb: SupabaseClient,
  caseId: string,
  pageName: string,
): Promise<string> {
  const [ccRes, finRes, ratRes, bkRes, gstRes, emiRes] = await Promise.all([
    sb.from("credit_cases").select("*").eq("id", caseId).single(),
    sb.from("extracted_financials").select("fiscal_year,statement_type,line_items,unit").eq("case_id", caseId),
    sb.from("financial_ratios").select("fiscal_year,ratio_name,ratio_value,threshold_status,benchmark").eq("case_id", caseId).order("fiscal_year"),
    sb.from("bank_statement_data").select("month,bank_name,total_credits,total_debits,avg_balance,bounce_inward,bounce_outward,emi_outflows").eq("case_id", caseId).order("month"),
    sb.from("gst_return_data").select("period,return_type,total_turnover,taxable_turnover,net_tax_paid,filing_status").eq("case_id", caseId).order("period"),
    sb.from("emi_payments").select("emi_number,due_date,emi_amount,status,paid_amount,outstanding_balance").eq("case_id", caseId).order("emi_number"),
  ]);

  const cc         = ccRes.data as CaseOverview | null;
  const financials = (finRes.data ?? []) as { fiscal_year: number; statement_type: string; line_items: unknown; unit?: string | null }[];
  const ratios     = (ratRes.data ?? []) as { fiscal_year: number; ratio_name: string; ratio_value: number | null; threshold_status: string; benchmark: number | null }[];
  const bank       = (bkRes.data ?? []) as { month: string; bank_name?: string | null; total_credits?: number | null; total_debits?: number | null; avg_balance?: number | null; bounce_inward?: number | null; bounce_outward?: number | null; emi_outflows?: number | null }[];
  const gst        = (gstRes.data ?? []) as { period: string; return_type?: string | null; total_turnover?: number | null; taxable_turnover?: number | null; net_tax_paid?: number | null; filing_status?: string | null }[];
  const emi        = (emiRes.data ?? []) as { emi_number: number; due_date: string; emi_amount: number; status: string; paid_amount?: number | null; outstanding_balance: number }[];
  const unit       = financials.find(f => f.unit)?.unit ?? "Lakhs";

  return `${ANALYST_RULES}

CURRENT PAGE: ${pageName} (single case view)

━━━ CASE OVERVIEW ━━━
Client:             ${cc?.client_name ?? "—"}
Product:            ${cc?.product_type ?? "—"}${cc?.product_type_custom ? ` (${cc.product_type_custom})` : ""}
Industry:           ${cc?.industry ?? "—"}
Constitution:       ${cc?.legal_constitution ?? "—"}
Year Established:   ${cc?.year_established ?? "—"}
Principal Borrower: ${cc?.principal_borrower ?? "—"}
Deal Amount:        ₹${fmt(cc?.deal_amount ?? null)} ${unit}
Tenure:             ${cc?.tenure_months ?? "—"} months
Expected IRR:       ${cc?.expected_irr ?? "—"}%
End Use:            ${cc?.end_use ?? "—"}
Collateral:         ${cc?.collateral_summary ?? "—"}
Analyst Notes:      ${cc?.analyst_notes ?? "—"}
Case Status:        ${cc?.status ?? "—"}

━━━ EXTRACTED FINANCIALS ━━━
${buildFinancialContext(financials, unit)}

━━━ KEY FINANCIAL RATIOS ━━━
(value [traffic-light: GREEN/AMBER/RED])
${buildRatioContext(ratios)}

━━━ BANK STATEMENT DATA (monthly) ━━━
${buildBankContext(bank)}

━━━ GST RETURN DATA ━━━
${buildGstContext(gst)}

━━━ EMI SCHEDULE ━━━
${buildEmiContext(emi)}`;
}

async function buildGlobalSystemPrompt(
  sb: SupabaseClient,
  pageName: string,
  currentPath: string,
): Promise<string> {
  const [casesRes, companiesRes] = await Promise.all([
    sb.from("credit_cases").select("id,case_code,client_name,product_type,product_type_custom,industry,status,deal_amount,tenure_months,expected_irr,created_at").order("created_at", { ascending: false }),
    sb.from("companies").select("id,name,industry,website,created_at").order("created_at", { ascending: false }).limit(100),
  ]);

  const cases     = (casesRes.data as CaseRecord[])    ?? [];
  const companies = (companiesRes.data as CompanyRecord[]) ?? [];

  // Aggregate pipeline stats
  const statusCounts: Record<string, number> = {};
  let totalDeal = 0;
  for (const c of cases) {
    statusCounts[c.status] = (statusCounts[c.status] ?? 0) + 1;
    if (c.deal_amount) totalDeal += Number(c.deal_amount);
  }

  const pipelineSummary = Object.entries(statusCounts)
    .map(([status, count]) => `  ${status}: ${count} deal${count > 1 ? "s" : ""}`)
    .join("\n");

  const caseList = cases.slice(0, 50).map(c =>
    `  ${c.case_code} | ${c.client_name} | ${c.product_type}${c.product_type_custom ? ` (${c.product_type_custom})` : ""} | ${c.industry ?? "—"} | ₹${fmt(c.deal_amount)} Lakhs | ${c.status} | created: ${c.created_at?.slice(0,10)}`
  ).join("\n");

  const companyList = companies.slice(0, 30).map(c =>
    `  ${c.name} | ${c.industry ?? "—"} | ${c.website ?? "—"}`
  ).join("\n");

  return `${ANALYST_RULES}

CURRENT PAGE: ${pageName} (${currentPath})

━━━ PIPELINE OVERVIEW ━━━
Total cases: ${cases.length}
Total deal value: ₹${fmt(totalDeal)} Lakhs

Pipeline by status:
${pipelineSummary || "  No cases yet."}

━━━ ALL CASES (most recent first) ━━━
${caseList || "  No cases yet."}

━━━ COMPANIES ━━━
Total: ${companies.length}
${companyList || "  No companies yet."}`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  const cors = getCorsHeaders(req);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });

    const body = await req.json() as {
      case_id?: string | null;
      page_name?: string;
      current_path?: string;
      messages: ChatMessage[];
    };

    const { case_id, page_name = "Unknown", current_path = "/", messages } = body;

    if (!messages?.length) return new Response(JSON.stringify({ error: "messages required" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });

    const systemPrompt = case_id
      ? await buildCaseSystemPrompt(sb, case_id, page_name)
      : await buildGlobalSystemPrompt(sb, page_name, current_path);

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) throw new Error("ANTHROPIC_API_KEY not set");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key":         key,
        "anthropic-version": "2023-06-01",
        "content-type":      "application/json",
      },
      body: JSON.stringify({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system:     systemPrompt,
        messages,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Claude API ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = await res.json();
    const textBlock = (json.content as { type: string; text?: string }[] ?? []).find(b => b.type === "text");
    const reply = (textBlock?.text ?? "").trim();

    return new Response(JSON.stringify({ reply }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("analyst-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
