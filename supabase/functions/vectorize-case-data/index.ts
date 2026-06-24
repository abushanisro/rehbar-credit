/**
 * Rehbar — Structured Data Vectorization
 * Converts all structured case data (financials, ratios, bank, GST, CIBIL,
 * triangulation, Accumn, MCA company profile) into text chunks, generates
 * Gemini text-embedding-004 embeddings, and upserts into document_chunks.
 *
 * Called after any extraction completes, or manually via "Re-index" button.
 * Deletes previous structured chunks before re-inserting (idempotent).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleOptions } from "../_shared/cors.ts";

declare const Deno: { env: { get(key: string): string | undefined } };

const GEMINI_EMBED_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent";

// ── Embedding helper ──────────────────────────────────────────────────────────

async function embed(text: string, apiKey: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${GEMINI_EMBED_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/text-embedding-004",
        content: { parts: [{ text: text.slice(0, 8192) }] },
      }),
    });
    if (!res.ok) {
      console.warn("Embed API", res.status, await res.text().catch(() => ""));
      return null;
    }
    const j = await res.json();
    return j.embedding?.values ?? null;
  } catch (e) {
    console.warn("Embed error:", String(e));
    return null;
  }
}

// ── Number formatters ─────────────────────────────────────────────────────────

function inr(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${(Number(v) * 100).toFixed(1)}%`;
}

function num(v: number | null | undefined, dec = 2): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toFixed(dec);
}

// ── Type definitions ──────────────────────────────────────────────────────────

type LineItem   = { label: string; value: number | null; override_value?: number | null };
type FinRow     = { fiscal_year: number; statement_type: string; line_items: unknown; unit?: string | null };
type RatioRow   = { fiscal_year: number; ratio_name: string; ratio_value: number | null; threshold_status: string; category: string };
type BankRow    = { month: string; bank_name: string | null; total_credits: number | null; total_debits: number | null; avg_balance: number | null; min_balance: number | null; bounce_inward: number | null; bounce_outward: number | null; emi_outflows: number | null };
type GstRow     = { period: string; return_type: string | null; total_turnover: number | null; output_tax: number | null; itc_claimed: number | null; net_tax_paid: number | null; filing_status: string | null };
type CibilRow   = { borrower_name: string | null; cibil_rank: string | null; total_outstanding: number | null; report_date: string | null; report_data: Record<string, unknown> | null };
type AccumnFlag = { flag_name: string; severity: string; description: string };
type AccumnConc = { period: string; rank: number; name: string; amount: number; pct: number };
type AccumnCirc = { entity: string; sale_amount?: number | null; purchase_amount?: number | null };
type AccumnReport = {
  is_accumn?: boolean;
  flags?: AccumnFlag[];
  company_profile?: { name?: string; constitution?: string; state?: string; business_type?: string };
  sales_summary?: Array<{ period: string; adjusted_revenue?: number | null; gross_margin_pct?: number | null }>;
  customer_concentration?: AccumnConc[];
  supplier_concentration?: AccumnConc[];
  circular_transactions?: AccumnCirc[];
};
type TriangData = {
  report_data?: {
    profileDetails?: Array<{ particular: string; result: string }>;
    summary?: { periods: string[]; rows: Array<{ particular: string; values: (string | null)[] }> };
    customers?: { period: string; parties: Array<{ name: string; gstAmount: number | null; pctRevenue: number | null; trend: string }> };
    circularParties?: Array<{ partyName: string }>;
  };
};
type DirectorRow = { name: string; designation?: string | null; din?: string | null; shareholding?: string | null };
type CompanyRow  = {
  mca_cin?: string | null; mca_pan?: string | null; mca_status?: string | null; mca_category?: string | null;
  mca_authorized_capital?: string | null; mca_paid_up_capital?: string | null; mca_sector?: string | null;
  mca_products_services?: string | null; mca_date_of_incorp?: string | null; mca_about?: string | null;
  registered_address?: string | null; industry?: string | null;
};

// ── Line-item lookup ──────────────────────────────────────────────────────────

function lv(items: LineItem[], label: string): number | null {
  const it = items.find(i => i.label === label);
  if (!it) return null;
  const v = it.override_value ?? it.value;
  return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
}

// ── Chunk builders ────────────────────────────────────────────────────────────

function buildFinancialChunks(financials: FinRow[], clientName: string): Array<{ content: string; chunk_type: string; metadata: Record<string, unknown> }> {
  const chunks: Array<{ content: string; chunk_type: string; metadata: Record<string, unknown> }> = [];
  const unit = financials.find(f => f.unit)?.unit ?? "Lakhs";

  const fyMap = new Map<number, LineItem[]>();
  const projMap = new Map<number, LineItem[]>();
  for (const row of financials) {
    const items = (row.line_items as LineItem[]) ?? [];
    if (row.statement_type === "projections") {
      const existing = projMap.get(row.fiscal_year) ?? [];
      const seen = new Set(existing.map(i => i.label));
      projMap.set(row.fiscal_year, [...existing, ...items.filter(i => !seen.has(i.label))]);
    } else {
      const existing = fyMap.get(row.fiscal_year) ?? [];
      const seen = new Set(existing.map(i => i.label));
      fyMap.set(row.fiscal_year, [...existing, ...items.filter(i => !seen.has(i.label))]);
    }
  }

  const histYears = [...fyMap.keys()].sort();
  const projYears = [...projMap.keys()].sort();

  for (const fy of histYears) {
    const items = fyMap.get(fy)!;
    const turnover = lv(items, "Turnover");
    const gp       = lv(items, "Gross Profit");
    const ebitda   = lv(items, "EBITDA");
    const pat      = lv(items, "PAT");
    const netWorth = lv(items, "Net Worth");
    const totalDebt= lv(items, "Total Debt");
    const currAssets = lv(items, "Current Assets");
    const fixedAssets = lv(items, "Fixed Assets (Net)");
    const totalAssets = lv(items, "Total Assets");
    const interest = lv(items, "Interest Expense");

    const gpPct   = turnover && gp   ? (gp   / turnover * 100).toFixed(1) : "—";
    const ebiPct  = turnover && ebitda? (ebitda/turnover * 100).toFixed(1) : "—";
    const patPct  = turnover && pat  ? (pat  / turnover * 100).toFixed(1) : "—";
    const de      = netWorth && totalDebt && netWorth !== 0 ? (totalDebt/netWorth).toFixed(2) : "—";

    const lines = [
      `[P&L AND BALANCE SHEET — FY${fy} — ${clientName}] (₹ ${unit})`,
      `Turnover: ${inr(turnover)} | Gross Profit: ${inr(gp)} (${gpPct}%) | EBITDA: ${inr(ebitda)} (${ebiPct}%)`,
      `PAT: ${inr(pat)} (${patPct}%) | Interest Expense: ${inr(interest)}`,
      `Net Worth: ${inr(netWorth)} | Total Debt: ${inr(totalDebt)} | D/E Ratio: ${de}x`,
      `Current Assets: ${inr(currAssets)} | Fixed Assets (Net): ${inr(fixedAssets)} | Total Assets: ${inr(totalAssets)}`,
    ];

    const cfLabels = ["Cash from Operations", "Cash from Investing", "Cash from Financing", "Net Change in Cash", "Closing Cash"];
    const cfParts = cfLabels.map(l => { const v = lv(items, l); return v != null ? `${l}: ${inr(v)}` : null; }).filter(Boolean);
    if (cfParts.length > 0) lines.push(`Cash Flow — ${cfParts.join(" | ")}`);

    chunks.push({ content: lines.join("\n"), chunk_type: "financials", metadata: { fiscal_year: fy, statement_type: "historical" } });
  }

  // Projections chunk
  if (projYears.length > 0) {
    const lines = [`[PROJECTIONS — ${projYears.join(", ")} — ${clientName}] (₹ ${unit})`];
    for (const fy of projYears) {
      const items = projMap.get(fy)!;
      const turn  = lv(items, "Projected Turnover") ?? lv(items, "Revenue") ?? lv(items, "Turnover");
      const ebda  = lv(items, "Projected EBITDA")   ?? lv(items, "EBITDA");
      const pt    = lv(items, "Projected PAT")       ?? lv(items, "PAT");
      const nw    = lv(items, "Projected Net Worth") ?? lv(items, "Net Worth");
      const td    = lv(items, "Projected Total Debt")?? lv(items, "Total Debt");
      lines.push(`FY${fy}: Turnover ${inr(turn)} | EBITDA ${inr(ebda)} | PAT ${inr(pt)} | Net Worth ${inr(nw)} | Total Debt ${inr(td)}`);
    }
    chunks.push({ content: lines.join("\n"), chunk_type: "financials", metadata: { statement_type: "projections" } });
  }

  return chunks;
}

function buildRatioChunks(ratios: RatioRow[], clientName: string): Array<{ content: string; chunk_type: string; metadata: Record<string, unknown> }> {
  const chunks: Array<{ content: string; chunk_type: string; metadata: Record<string, unknown> }> = [];
  const years = [...new Set(ratios.map(r => r.fiscal_year))].sort();

  const STATUS: Record<string, string> = { green: "PASS", amber: "CAUTION", red: "FAIL", na: "N/A" };
  const PCT_RATIOS = new Set(["gross_margin","ebitda_margin","net_profit_margin","roa","roe","roce","roic","ronw"]);

  for (const fy of years) {
    const fyRatios = ratios.filter(r => r.fiscal_year === fy);
    const fmt = (name: string, v: number | null) => {
      if (v == null || !Number.isFinite(v)) return "—";
      if (["debtor_days","creditor_days","inventory_days"].includes(name)) return `${Math.round(v)}d`;
      if (PCT_RATIOS.has(name)) return `${(v * 100).toFixed(1)}%`;
      return `${v.toFixed(2)}x`;
    };

    const lines = [`[KEY FINANCIAL RATIOS — FY${fy} — ${clientName}]`];
    for (const r of fyRatios) {
      lines.push(`${r.ratio_name.replace(/_/g," ").toUpperCase()}: ${fmt(r.ratio_name, r.ratio_value)} [${STATUS[r.threshold_status] ?? r.threshold_status}]`);
    }

    // Highlight critical ratios in a summary line
    const dscr = fyRatios.find(r => r.ratio_name === "dscr");
    const cr   = fyRatios.find(r => r.ratio_name === "current_ratio");
    const de   = fyRatios.find(r => r.ratio_name === "debt_to_equity");
    const em   = fyRatios.find(r => r.ratio_name === "ebitda_margin");
    lines.push(`SUMMARY: DSCR=${fmt("dscr", dscr?.ratio_value??null)} | CR=${fmt("current_ratio", cr?.ratio_value??null)} | D/E=${fmt("debt_to_equity", de?.ratio_value??null)} | EBITDA Margin=${fmt("ebitda_margin", em?.ratio_value??null)}`);

    const failRatios = fyRatios.filter(r => r.threshold_status === "red");
    if (failRatios.length > 0) {
      lines.push(`FAILING RATIOS: ${failRatios.map(r => r.ratio_name.replace(/_/g," ")).join(", ")}`);
    }

    chunks.push({ content: lines.join("\n"), chunk_type: "ratios", metadata: { fiscal_year: fy } });
  }
  return chunks;
}

function buildBankChunks(rows: BankRow[], clientName: string): Array<{ content: string; chunk_type: string; metadata: Record<string, unknown> }> {
  if (!rows.length) return [];
  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  const recent = sorted.slice(-12);
  const bankName = recent[0]?.bank_name ?? "Bank";

  const totalCredits  = recent.reduce((s, r) => s + (r.total_credits  ?? 0), 0);
  const totalDebits   = recent.reduce((s, r) => s + (r.total_debits   ?? 0), 0);
  const avgBal        = recent.reduce((s, r) => s + (r.avg_balance    ?? 0), 0) / recent.length;
  const totalBounceIn = recent.reduce((s, r) => s + (r.bounce_inward  ?? 0), 0);
  const totalBounceOut= recent.reduce((s, r) => s + (r.bounce_outward ?? 0), 0);
  const totalEmi      = recent.reduce((s, r) => s + (r.emi_outflows   ?? 0), 0);
  const minBal        = Math.min(...recent.map(r => r.min_balance ?? Infinity).filter(Number.isFinite));
  const avgMonthlyCredits = totalCredits / recent.length;

  const firstHalf  = recent.slice(0, Math.floor(recent.length / 2));
  const secondHalf = recent.slice(Math.floor(recent.length / 2));
  const avgFirst  = firstHalf.reduce((s, r) => s + (r.total_credits ?? 0), 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, r) => s + (r.total_credits ?? 0), 0) / secondHalf.length;
  const creditTrend = avgFirst > 0 ? ((avgSecond - avgFirst) / avgFirst * 100).toFixed(0) : "—";

  const lines = [
    `[BANK STATEMENT ANALYSIS — ${bankName} — ${recent.length} MONTHS — ${clientName}]`,
    `Total Credits: ${inr(totalCredits)} | Total Debits: ${inr(totalDebits)} | Avg Monthly Credits: ${inr(avgMonthlyCredits)}`,
    `Average Bank Balance (ABB): ${inr(avgBal)} | Minimum Balance: ${minBal === Infinity ? "—" : inr(minBal)}`,
    `Inward Bounces: ${totalBounceIn} | Outward Bounces: ${totalBounceOut} | EMI Outflows: ${inr(totalEmi)}`,
    `Credit Trend (First Half vs Second Half): ${creditTrend}% change`,
    `Months Covered: ${recent[0]?.month} to ${recent[recent.length - 1]?.month}`,
  ];

  if (Number(creditTrend) < -50) {
    lines.push(`ALERT: Credits declined >50% between first and second half — REVENUE CONTRACTION SIGNAL`);
  }
  if (avgBal < 5_000_000 && totalCredits > 100_000_000) {
    lines.push(`ALERT: ABB below ₹50L despite ₹${(totalCredits/1e7).toFixed(0)}Cr+ annual credits — LIQUIDITY CONCERN`);
  }

  // Monthly breakdown (last 6 months)
  for (const r of recent.slice(-6)) {
    lines.push(`${r.month}: Credits ${inr(r.total_credits)} | Debits ${inr(r.total_debits)} | Avg Bal ${inr(r.avg_balance)} | Bounces-In ${r.bounce_inward ?? 0}`);
  }

  return [{ content: lines.join("\n"), chunk_type: "bank", metadata: { bank_name: bankName, months: recent.length } }];
}

function buildGstChunks(rows: GstRow[], clientName: string): Array<{ content: string; chunk_type: string; metadata: Record<string, unknown> }> {
  if (!rows.length) return [];
  const sorted = [...rows].sort((a, b) => a.period.localeCompare(b.period));
  const recent = sorted.slice(-12);

  const totalTurnover = recent.reduce((s, r) => s + (r.total_turnover ?? 0), 0);
  const totalTax      = recent.reduce((s, r) => s + (r.net_tax_paid  ?? 0), 0);
  const totalItc      = recent.reduce((s, r) => s + (r.itc_claimed   ?? 0), 0);
  const lateCount     = recent.filter(r => r.filing_status === "late").length;
  const notFiledCount = recent.filter(r => r.filing_status === "not_filed").length;
  const itcRate       = (totalTurnover > 0 && totalItc > 0) ? (totalItc / totalTurnover * 100).toFixed(1) : "—";

  const lines = [
    `[GST COMPLIANCE SUMMARY — ${recent.length} PERIODS — ${clientName}]`,
    `Total GST Turnover: ${inr(totalTurnover)} | Net Tax Paid: ${inr(totalTax)} | ITC Claimed: ${inr(totalItc)}`,
    `ITC Utilisation Rate: ${itcRate}% | Late Filings: ${lateCount} | Not Filed: ${notFiledCount}`,
    `Period: ${recent[0]?.period} to ${recent[recent.length - 1]?.period}`,
  ];

  if (lateCount > 3) lines.push(`CONCERN: ${lateCount} late filings in ${recent.length} periods — GST COMPLIANCE RISK`);
  if (notFiledCount > 0) lines.push(`CONCERN: ${notFiledCount} periods with missing filings`);

  return [{ content: lines.join("\n"), chunk_type: "gst", metadata: { periods: recent.length, late: lateCount } }];
}

function buildCibilChunks(rows: CibilRow[], clientName: string): Array<{ content: string; chunk_type: string; metadata: Record<string, unknown> }> {
  const chunks: Array<{ content: string; chunk_type: string; metadata: Record<string, unknown> }> = [];
  for (const row of rows) {
    const rd = (row.report_data ?? {}) as Record<string, unknown>;
    const isConsumer = rd.report_type === "consumer" || rd.perform_score != null;

    if (isConsumer) {
      const score      = rd.perform_score as number | null;
      const totalAcc   = (rd.total_accounts  as number | null) ?? 0;
      const activeAcc  = (rd.active_accounts as number | null) ?? 0;
      const overdueAcc = (rd.overdue_accounts as number | null) ?? 0;
      const inq24      = (rd.inquiries_24m   as number | null) ?? 0;
      const scoreLabel = score == null ? "—" : score >= 750 ? `${score} (GOOD)` : score >= 650 ? `${score} (FAIR)` : `${score} (WEAK)`;
      const lines = [
        `[CRIF CONSUMER CREDIT REPORT — ${row.borrower_name ?? "Promoter"} — ${row.report_date ?? "—"} — ${clientName}]`,
        `CRIF Perform Score: ${scoreLabel} | Total Accounts: ${totalAcc} | Active: ${activeAcc} | Overdue: ${overdueAcc}`,
        `Total Outstanding: ${inr(row.total_outstanding)} | Inquiries (24M): ${inq24}`,
        overdueAcc > 0 ? `DPD STATUS: ${overdueAcc} OVERDUE ACCOUNTS — HIGH RISK` : "DPD Status: CLEAN — No overdue accounts",
      ];
      chunks.push({ content: lines.join("\n"), chunk_type: "cibil", metadata: { borrower_name: row.borrower_name, report_type: "consumer" } });
    } else {
      const lines = [
        `[COMMERCIAL CIBIL REPORT — ${row.borrower_name ?? "Entity"} — ${row.report_date ?? "—"} — ${clientName}]`,
        `CIBIL Rank: ${row.cibil_rank ?? "—"} | Total Outstanding: ${inr(row.total_outstanding)}`,
      ];
      chunks.push({ content: lines.join("\n"), chunk_type: "cibil", metadata: { borrower_name: row.borrower_name, report_type: "commercial" } });
    }
  }
  return chunks;
}

function buildAccumnChunks(report: AccumnReport | null | undefined, clientName: string): Array<{ content: string; chunk_type: string; metadata: Record<string, unknown> }> {
  if (!report?.is_accumn) return [];
  const chunks: Array<{ content: string; chunk_type: string; metadata: Record<string, unknown> }> = [];

  // Flags chunk
  if (report.flags?.length) {
    const lines = [
      `[ACCUMN GST ANALYTICAL REPORT — FLAGS — ${clientName}]`,
      ...report.flags.map(f => `[${f.severity.toUpperCase()}] ${f.flag_name}: ${f.description}`),
    ];
    chunks.push({ content: lines.join("\n"), chunk_type: "accumn", metadata: { sub_type: "flags" } });
  }

  // Customer concentration chunk
  if (report.customer_concentration?.length) {
    const latestFy = report.customer_concentration.reduce((a, c) => (c.period > a ? c.period : a), "");
    const top5 = report.customer_concentration.filter(c => c.period === latestFy && c.rank <= 5).sort((a, b) => a.rank - b.rank);
    if (top5.length) {
      const lines = [
        `[ACCUMN GST — CUSTOMER CONCENTRATION — ${latestFy} — ${clientName}]`,
        ...top5.map(c => `Rank ${c.rank}: ${c.name} — ${inr(c.amount)} (${(c.pct * 100).toFixed(1)}% of revenue)`),
      ];
      const top3pct = top5.slice(0, 3).reduce((s, c) => s + c.pct, 0);
      if (top3pct > 0.6) lines.push(`RISK: Top 3 customers account for ${(top3pct * 100).toFixed(0)}% of revenue — HIGH CONCENTRATION RISK`);
      chunks.push({ content: lines.join("\n"), chunk_type: "accumn", metadata: { sub_type: "customer_concentration" } });
    }
  }

  // Supplier concentration chunk
  if (report.supplier_concentration?.length) {
    const latestFy = report.supplier_concentration.reduce((a, c) => (c.period > a ? c.period : a), "");
    const top5 = report.supplier_concentration.filter(c => c.period === latestFy && c.rank <= 5).sort((a, b) => a.rank - b.rank);
    if (top5.length) {
      const lines = [
        `[ACCUMN GST — SUPPLIER CONCENTRATION — ${latestFy} — ${clientName}]`,
        ...top5.map(c => `Rank ${c.rank}: ${c.name} — ${inr(c.amount)} (${(c.pct * 100).toFixed(1)}%)`),
      ];
      chunks.push({ content: lines.join("\n"), chunk_type: "accumn", metadata: { sub_type: "supplier_concentration" } });
    }
  }

  // Circular transactions
  if (report.circular_transactions?.length) {
    const active = report.circular_transactions.filter(c => c.sale_amount && c.purchase_amount);
    if (active.length) {
      const lines = [
        `[ACCUMN GST — CIRCULAR TRANSACTIONS — ${clientName}] — ${active.length} ENTITIES FLAGGED`,
        `Circular transaction risk: entities appear as both buyers and sellers`,
        ...active.slice(0, 8).map(c => `${c.entity}: Sales ${inr(c.sale_amount ?? null)} | Purchases ${inr(c.purchase_amount ?? null)}`),
      ];
      chunks.push({ content: lines.join("\n"), chunk_type: "accumn", metadata: { sub_type: "circular_transactions", count: active.length } });
    }
  }

  // Sales summary
  if (report.sales_summary?.length) {
    const lines = [
      `[ACCUMN GST — REVENUE SUMMARY — ${clientName}]`,
      ...report.sales_summary.map(s => `${s.period}: Adj. Revenue ${inr(s.adjusted_revenue)} | Gross Margin ${s.gross_margin_pct != null ? (s.gross_margin_pct * 100).toFixed(1) + "%" : "—"}`),
    ];
    chunks.push({ content: lines.join("\n"), chunk_type: "accumn", metadata: { sub_type: "sales_summary" } });
  }

  return chunks;
}

function buildTriangulationChunks(data: TriangData | null | undefined, clientName: string): Array<{ content: string; chunk_type: string; metadata: Record<string, unknown> }> {
  if (!data?.report_data) return [];
  const d = data.report_data;
  const lines = [`[PERFIOS TRIANGULATION REPORT — GST × BSA × ITR — ${clientName}]`];

  // Profile mismatches
  const mismatches = (d.profileDetails ?? []).filter(p => p.result === "Mismatch");
  if (mismatches.length > 0) {
    lines.push(`Profile Mismatches (${mismatches.length}): ${mismatches.map(m => m.particular).join(", ")}`);
  } else {
    lines.push("Profile Verification: All fields MATCH across sources");
  }

  // Summary key metrics
  if (d.summary?.rows?.length) {
    const keyRows = ["Revenue from Operations (ITR)", "Adjusted Revenue (Total, GST)", "Banking Credits", "GST Revenue vis a vis Revenue from Operations", "Banking Credits vis a vis GST Revenue"];
    for (const particular of keyRows) {
      const r = d.summary.rows.find(x => x.particular === particular);
      if (r) {
        const vals = r.values.slice(0, 3).map(v => v ?? "—").join(" | ");
        lines.push(`${particular.slice(0, 50)}: ${vals}`);
      }
    }
  }

  // Top customers
  if (d.customers?.parties?.length) {
    const top3 = d.customers.parties.slice(0, 3);
    lines.push(`Top Customers (${d.customers.period ?? ""}): ${top3.map(p => `${p.name.slice(0, 25)} ${p.pctRevenue != null ? (Number(p.pctRevenue) > 1 ? Number(p.pctRevenue).toFixed(1) : (Number(p.pctRevenue) * 100).toFixed(1)) + "%" : ""}`).join(", ")}`);
  }

  // Circular parties
  if (d.circularParties?.length) {
    lines.push(`Circular Parties Flagged: ${d.circularParties.length} entities — ${d.circularParties.slice(0, 5).map(p => p.partyName).join(", ")}`);
  }

  return [{ content: lines.join("\n"), chunk_type: "triangulation", metadata: {} }];
}

function buildMcaChunks(company: CompanyRow | null, directors: DirectorRow[] | null, clientName: string): Array<{ content: string; chunk_type: string; metadata: Record<string, unknown> }> {
  if (!company && !directors?.length) return [];
  const lines = [`[MCA / CORPOSITORY COMPANY PROFILE — ${clientName}]`];

  if (company) {
    if (company.mca_cin)               lines.push(`CIN: ${company.mca_cin}`);
    if (company.mca_pan)               lines.push(`PAN: ${company.mca_pan}`);
    if (company.mca_status)            lines.push(`Status: ${company.mca_status}`);
    if (company.mca_category)          lines.push(`Category: ${company.mca_category}`);
    if (company.mca_sector || company.industry) lines.push(`Sector: ${company.mca_sector ?? company.industry}`);
    if (company.mca_products_services) lines.push(`Products/Services: ${company.mca_products_services.slice(0, 200)}`);
    if (company.mca_authorized_capital) lines.push(`Authorised Capital: ₹${Number(company.mca_authorized_capital).toLocaleString("en-IN")}`);
    if (company.mca_paid_up_capital)   lines.push(`Paid-Up Capital: ₹${Number(company.mca_paid_up_capital).toLocaleString("en-IN")}`);
    if (company.mca_date_of_incorp)    lines.push(`Incorporation Date: ${company.mca_date_of_incorp}`);
    if (company.registered_address)    lines.push(`Registered Address: ${company.registered_address}`);
    if (company.mca_about)             lines.push(`\nCompany Overview:\n${company.mca_about.slice(0, 1000)}`);
  }

  if (directors?.length) {
    lines.push(`\nBoard of Directors (${directors.length}):`);
    for (const d of directors.slice(0, 8)) {
      lines.push(`${d.name}${d.designation ? ` (${d.designation})` : ""}${d.din ? ` · DIN: ${d.din}` : ""}${d.shareholding ? ` · ${d.shareholding}% shareholding` : ""}`);
    }
  }

  return [{ content: lines.join("\n"), chunk_type: "mca", metadata: { client_name: clientName } }];
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  const cors = getCorsHeaders(req);

  try {
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) throw new Error("GEMINI_API_KEY not set");

    const { case_id } = await req.json() as { case_id: string };
    if (!case_id) throw new Error("case_id required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fetch case metadata
    const { data: cc } = await supabase.from("credit_cases").select("*").eq("id", case_id).single();
    if (!cc) throw new Error("Case not found");
    const clientName = cc.client_name ?? "Client";

    // Fetch all data in parallel
    const safeQ = async <T>(fn: () => PromiseLike<{ data: T | null }>): Promise<T | null> => {
      try { const { data } = await fn(); return data; } catch { return null; }
    };

    const [
      { data: financials },
      { data: ratios },
      { data: bankRows },
      { data: gstRows },
      cibilRows,
      accumnRows,
      triRow,
      companyRow,
      directorRows,
    ] = await Promise.all([
      supabase.from("extracted_financials").select("fiscal_year,statement_type,line_items,unit").eq("case_id", case_id),
      supabase.from("financial_ratios").select("fiscal_year,ratio_name,ratio_value,threshold_status,category").eq("case_id", case_id),
      supabase.from("bank_statement_data").select("*").eq("case_id", case_id),
      supabase.from("gst_return_data").select("*").eq("case_id", case_id),
      safeQ(() => supabase.from("cibil_report_data").select("cibil_rank,total_outstanding,borrower_name,report_date,report_data").eq("case_id", case_id).order("created_at", { ascending: false }).limit(10)),
      safeQ(() => supabase.from("gst_accumn_reports").select("report_data").eq("case_id", case_id).limit(1)),
      safeQ(() => (supabase as ReturnType<typeof createClient>).from("triangulation_data").select("report_data").eq("case_id", case_id).limit(1)),
      cc.company_id ? safeQ(() => (supabase as ReturnType<typeof createClient>).from("companies").select("*").eq("id", cc.company_id).single()) : Promise.resolve(null),
      cc.company_id ? safeQ(() => (supabase as ReturnType<typeof createClient>).from("company_directors").select("name,designation,din,shareholding").eq("company_id", cc.company_id)) : Promise.resolve(null),
    ]);

    // Build all text chunks
    const allChunks: Array<{ content: string; chunk_type: string; metadata: Record<string, unknown> }> = [
      ...buildFinancialChunks((financials ?? []) as FinRow[], clientName),
      ...buildRatioChunks((ratios ?? []) as RatioRow[], clientName),
      ...buildBankChunks((bankRows ?? []) as BankRow[], clientName),
      ...buildGstChunks((gstRows ?? []) as GstRow[], clientName),
      ...buildCibilChunks((cibilRows ?? []) as CibilRow[], clientName),
      ...buildAccumnChunks((accumnRows as Array<{ report_data: AccumnReport }> | null)?.[0]?.report_data, clientName),
      ...buildTriangulationChunks((triRow as TriangData[] | null)?.[0] ?? null, clientName),
      ...buildMcaChunks(companyRow as CompanyRow | null, directorRows as DirectorRow[] | null, clientName),
    ];

    // Delete existing structured chunks (keep PDF chunks intact)
    await supabase.from("document_chunks")
      .delete()
      .eq("case_id", case_id)
      .neq("chunk_type", "pdf");

    // Generate embeddings and insert
    let inserted = 0;
    let failed   = 0;
    for (let i = 0; i < allChunks.length; i++) {
      const chunk = allChunks[i];
      if (chunk.content.length < 20) continue;

      const embedding = await embed(chunk.content, geminiKey);
      if (!embedding) { failed++; continue; }

      const { error } = await supabase.from("document_chunks").insert({
        case_id,
        document_id:  null,
        chunk_index:  i,
        page_number:  null,
        content:      chunk.content.slice(0, 4000),
        embedding:    JSON.stringify(embedding),
        chunk_type:   chunk.chunk_type,
        metadata:     chunk.metadata,
      });

      if (error) { console.warn("Insert error:", error.message); failed++; }
      else inserted++;
    }

    console.log(`vectorize-case-data: ${inserted} chunks inserted, ${failed} failed for case ${case_id}`);

    return new Response(JSON.stringify({ ok: true, inserted, failed, total: allChunks.length }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("vectorize-case-data error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
