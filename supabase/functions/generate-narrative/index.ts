/**
 * Rehbar — IC Note Generation
 * Generates a 12-section IC appraisal note draft using Claude Sonnet 4.6.
 * Sections V/VI/VII tables are pre-built server-side — AI adds bullet observations only.
 * Never includes a credit recommendation. PII excluded.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type SupabaseClientT = ReturnType<typeof createClient>;
import { callAI, callAIText } from "../_shared/ai-caller.ts";
import { getCorsHeaders, handleOptions } from "../_shared/cors.ts";

const SECTION_IDS = [
  "executive_summary","client_promoter","investment_structure","rehbar_funding_history",
  "historical_financial","historical_pl_obs","historical_bs_obs",
  "projections","key_ratios","cash_flow","cash_flow_obs","due_diligence",
  "risk_assessment","visit_reference","exec_recommendation","product_specifics",
];

const SECTION_QUERIES: Record<string, string> = {
  executive_summary:    "company overview industry revenue profit DSCR strategic rationale Rehbar rationale collateral security",
  client_promoter:      "legal constitution directors shareholders CIBIL score promoters DIN incorporation MCA company profile",
  investment_structure: "end use product lease EMI rental IRR collateral security deposit tenure finance structure",
  rehbar_funding_history: "prior funding history Rehbar facilities IRR repayment conduct existing loans credit history",
  historical_financial: "revenue turnover EBITDA PAT net worth total debt balance sheet P&L trends margin growth",
  historical_pl_obs:    "revenue net sales gross profit EBITDA margin operating expenses PAT EAT cash profit net yield turnover growth",
  historical_bs_obs:    "share capital reserves surplus directors loan inside funding bank loans borrowings trade payables creditors provisions GST TDS",
  projections:          "projected revenue EBITDA PAT growth assumptions DSCR coverage credibility order book",
  key_ratios:           "DSCR current ratio debt equity EBITDA margin ROE RONW working capital leverage R score",
  cash_flow:            "bank credits debits average balance bounce EMI outflows operating cash flow banking",
  cash_flow_obs:        "operating activities investing activities financing activities CFO CFI CFF net cash position opening closing balance working capital cycle",
  due_diligence:        "GST compliance customer concentration circular transactions triangulation cross-check Accumn",
  risk_assessment:      "business risk financial risk transaction risk customer concentration leverage overdue",
  visit_reference:      "site visit reference check promoter banker vendor customer referral physical operations",
  exec_recommendation:  "executive team recommendation credit approval rationale deal strengths weaknesses final assessment IC committee",
  product_specifics:    "operating lease finance lease PLS projection waiver SOP product rules NACH GST e-invoice",
};

// ── RAG embedding helper ──────────────────────────────────────────────────────

async function generateEmbedding(text: string, apiKey: string): Promise<number[] | null> {
  if (!apiKey) return null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 5_000); // 5s per call max
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "models/text-embedding-004", content: { parts: [{ text }] } }),
        signal: abort.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const json = await res.json();
      return (json.embedding?.values as number[]) ?? null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

async function getRagContext(
  supabase: SupabaseClientT,
  case_id: string,
  sectionId: string,
  apiKey: string,
): Promise<string> {
  const embedding = await generateEmbedding(SECTION_QUERIES[sectionId] ?? sectionId, apiKey);
  if (!embedding) return "";
  try {
    const { data } = await supabase.rpc("match_document_chunks", {
      query_embedding: embedding,
      filter_case_id:  case_id,
      match_count:     6,
      match_threshold: 0.40,
    });
    if (!data?.length) return "";
    return (data as Array<{ content: string; chunk_type: string }>)
      .map((c) => `[${c.chunk_type.toUpperCase()}] ${c.content}`)
      .join("\n\n");
  } catch {
    return "";
  }
}

// ── Pre-built table helpers ───────────────────────────────────────────────────
// Tables are constructed from DB data so the AI never formats numbers.
// This is the primary safeguard against format non-compliance.

type LineItem = { label: string; value: number | null; override_value?: number | null };
type FinRow   = { fiscal_year: number; statement_type: string; line_items: unknown; unit?: string | null };
type RatioRow = { fiscal_year: number; ratio_name: string; ratio_value: number | null; threshold_status: string; benchmark: number | null };
type BankRow  = {
  month: string; bank_name: string | null; account_number: string | null;
  opening_balance: number | null; closing_balance: number | null;
  avg_balance: number | null; min_balance: number | null; max_balance: number | null;
  total_credits: number | null; total_debits: number | null;
  credit_count: number | null; debit_count: number | null;
  bounce_inward: number | null; bounce_outward: number | null; emi_outflows: number | null;
};
type GstRow = {
  period: string; return_type: string | null;
  taxable_turnover: number | null; exempt_turnover: number | null; total_turnover: number | null;
  output_tax: number | null; itc_claimed: number | null; net_tax_paid: number | null;
  filing_status: string | null; filing_date: string | null;
};
type AccumnConcentration = { period: string; rank: number; name: string; gstin?: string; amount: number; pct: number };
type AccumnCircular      = { entity: string; gstin?: string; sale_amount?: number|null; purchase_amount?: number|null };
type AccumnFlag          = { flag_name: string; severity: string; description: string };
type AccumnReport = {
  is_accumn?: boolean;
  flags?: AccumnFlag[];
  company_profile?: { name?: string; gstin?: string; constitution?: string; state?: string; business_type?: string };
  sales_summary?: Array<{ period: string; adjusted_revenue?: number|null; gross_margin_pct?: number|null; net_revenue?: number|null }>;
  customer_concentration?: AccumnConcentration[];
  supplier_concentration?: AccumnConcentration[];
  circular_transactions?: AccumnCircular[];
  geography?: Array<{ period: string; state: string; amount: number; pct: number }>;
  customer_categories?: Array<{ period: string; b2b?: number|null; b2c_small?: number|null; b2c_large?: number|null; total?: number|null }>;
};
type AccumnReportRow = { report_data: AccumnReport };
type CibilReportRow  = { cibil_rank?: string|null; total_outstanding?: number|null; borrower_name?: string|null; report_date?: string|null; report_data?: Record<string,unknown>|null };
type CompanyRow = {
  id?: string|null;
  name?: string|null;
  year_established?: number|string|null;
  legal_constitution?: string|null;
  mca_cin?: string|null; mca_pan?: string|null; mca_category?: string|null; mca_sub_category?: string|null;
  mca_type?: string|null; mca_authorized_capital?: string|null; mca_paid_up_capital?: string|null;
  mca_status?: string|null; mca_sector?: string|null; mca_products_services?: string|null;
  mca_email?: string|null; mca_telephone?: string|null; mca_date_of_incorp?: string|null;
  mca_date_last_bs?: string|null; mca_date_last_agm?: string|null; mca_about?: string|null;
  registered_address?: string|null; gstin?: string|null; website?: string|null;
  industry?: string|null; promoter_details?: string|null;
};
type DirectorRow = { name: string; designation?: string|null; din?: string|null; shareholding?: string|null; appointed_current?: string|null; remarks?: string|null };
type TriParty = { name: string; gstAmount: number|null; pctRevenue: number|null; activeMonths: number|null; trend: string; bankingAnnualized: number|null; realisation: number|null };
type TriCircular = { partyName: string; data: { period: string; gstRevenue: number|null; gstPurchase: number|null; bankingCredit: number|null; bankingDebit: number|null }[] };
type TriangulationReportRow = { report_data: {
  sourceDates?: { source: string; startDate: string; endDate: string }[];
  profileDetails?: { particular: string; result: string; values: Record<string,string> }[];
  bankingInfo?: { bankName: string; accountNumber: string; accountType: string; banking: string; itrAis: string }[];
  summary?: { periods: string[]; rows: { particular: string; values: (string|null)[] }[] };
  customers?: { period: string; parties: TriParty[]; subtotalGst: number|null; totalGst: number|null; subtotalBanking: number|null; totalBanking: number|null };
  suppliers?: { period: string; parties: TriParty[]; subtotalGst: number|null; subtotalBanking: number|null };
  circularParties?: TriCircular[];
  hasRelatedPartyData?: boolean;
}};

function lv(items: LineItem[], label: string): string {
  const it = items.find(i => i.label === label);
  if (!it) return "—";
  const v = it.override_value ?? it.value;
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "—";
  return Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

// Projection rows from extract-projections use labels like "Revenue", "PAT", "Net Worth"
// while some rows (direct import, legacy) use "Projected Turnover" etc.
// PROJ_ALIAS maps the canonical "Projected X" label → all known aliases in priority order.
const PROJ_ALIAS: Record<string, string[]> = {
  "Projected Turnover":   ["Projected Turnover", "Revenue", "Total Income", "Turnover"],
  "Projected EBITDA":     ["Projected EBITDA", "EBITDA", "Gross Profit"],
  "Projected PAT":        ["Projected PAT", "PAT", "PBT"],
  "Projected Net Worth":  ["Projected Net Worth", "Net Worth"],
  "Projected Total Debt": ["Projected Total Debt", "Total Debt"],
};

function lvFirst(items: LineItem[], ...labels: string[]): string {
  for (const lb of labels) {
    const v = lv(items, lb);
    if (v !== "—") return v;
  }
  return "—";
}

function mdTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---|").join("")}`,
    ...rows.map(r => `| ${r.join(" | ")} |`),
  ].join("\n");
}

// Re-evaluates a ratio's pass/fail status from its value using canonical thresholds.
// This bypasses stale `threshold_status` values in the DB that may have been written
// before threshold migrations were applied or before higher_is_better was corrected.
const INLINE_THRESHOLDS: Record<string, { g: number; a: number; hi: boolean }> = {
  dscr:               { g: 1.5,  a: 1.25, hi: true  },
  current_ratio:      { g: 1.5,  a: 1.0,  hi: true  },
  quick_ratio:        { g: 1.0,  a: 0.7,  hi: true  },
  cash_ratio:         { g: 0.5,  a: 0.2,  hi: true  },
  interest_coverage:  { g: 3.0,  a: 1.5,  hi: true  },
  debt_to_equity:     { g: 2.0,  a: 3.0,  hi: false },
  lt_debt_to_equity:  { g: 2.0,  a: 3.0,  hi: false },
  debt_to_assets:     { g: 0.60, a: 0.75, hi: false },
  debt_to_ebitda:     { g: 4.0,  a: 6.0,  hi: false },
  total_liab_to_networth: { g: 1.5, a: 3.0, hi: false },
  gross_margin:       { g: 0.30, a: 0.15, hi: true  },
  ebitda_margin:      { g: 0.15, a: 0.08, hi: true  },
  net_profit_margin:  { g: 0.10, a: 0.05, hi: true  },
  roa:                { g: 0.05, a: 0.02, hi: true  },
  roe:                { g: 0.15, a: 0.08, hi: true  },
  roce:               { g: 0.15, a: 0.08, hi: true  },
  roic:               { g: 0.12, a: 0.06, hi: true  },
  ronw:               { g: 0.12, a: 0.06, hi: true  },
  r_score_composite:  { g: 2.0,  a: 1.0,  hi: true  },
};
function freshStatus(name: string, value: number | null): "green" | "amber" | "red" | "na" {
  if (value === null || !Number.isFinite(value)) return "na";
  const t = INLINE_THRESHOLDS[name];
  if (!t) return "na";
  if (t.hi) return value >= t.g ? "green" : value >= t.a ? "amber" : "red";
  return value <= t.g ? "green" : value <= t.a ? "amber" : "red";
}

function buildTables(financials: FinRow[], ratios: RatioRow[], provisional?: ProvPeriod[]) {
  const unit = financials.find(f => f.unit)?.unit ?? "Lakhs";
  const ul   = `₹ ${unit}`;

  const fyMap   = new Map<number, LineItem[]>();
  const projMap = new Map<number, LineItem[]>();

  const currentFY = new Date().getFullYear() + (new Date().getMonth() >= 3 ? 1 : 0);
  for (const row of financials) {
    // Reject fiscal years that are clearly impossible (> 2 years ahead or before 2015)
    if (row.fiscal_year < 2015 || row.fiscal_year > currentFY + 5) continue;
    const items = (row.line_items as LineItem[]) ?? [];
    if (row.statement_type === "projections") {
      projMap.set(row.fiscal_year, items);
    } else {
      const existing = fyMap.get(row.fiscal_year) ?? [];
      const seen = new Set(existing.map(i => i.label));
      fyMap.set(row.fiscal_year, [...existing, ...items.filter(i => !seen.has(i.label))]);
    }
  }

  const histYears = [...fyMap.keys()].sort();
  const projYears = [...projMap.keys()].sort();

  // Section V — P&L + Balance Sheet summary
  let sectionV = "";
  if (histYears.length > 0) {
    const plRows = [
      "Turnover","Cost of Goods Sold","Gross Profit","Operating Expenses",
      "EBITDA","Depreciation","Interest Expense","Profit Before Tax","PAT",
    ].map(lb => [lb, ...histYears.map(y => lv(fyMap.get(y)!, lb))])
      .filter(r => r.slice(1).some(v => v !== "—")); // skip empty rows
    sectionV  = `**P&L Summary (${ul})**\n${mdTable(["Item",...histYears.map(y=>`FY${y}`)], plRows)}\n\n`;
    const bsRows = [
      "Net Worth","Long Term Borrowings","Short Term Borrowings","Total Debt",
      "Current Assets","Fixed Assets (Net)","Total Assets",
    ].map(lb => [lb, ...histYears.map(y => lv(fyMap.get(y)!, lb))])
      .filter(r => r.slice(1).some(v => v !== "—"));
    sectionV += `**Balance Sheet (${ul})**\n${mdTable(["Item",...histYears.map(y=>`FY${y}`)], bsRows)}`;
  }

  // Section VI — Historical vs Projected (includes provisional periods if available)
  let sectionVI = "";
  const provPeriods = (provisional ?? []).filter(p => (p.months_covered ?? 12) >= 12);
  if (projYears.length > 0 || provPeriods.length > 0) {
    const pairs: [string, string][] = [
      ["Turnover",   "Projected Turnover"],
      ["EBITDA",     "Projected EBITDA"],
      ["PAT",        "Projected PAT"],
      ["Net Worth",  "Projected Net Worth"],
      ["Total Debt", "Projected Total Debt"],
    ];
    const actCols  = histYears.slice(-2).map(y => ({ y, tag: "A" as const, provPeriod: null as ProvPeriod | null }));
    const provCols = provPeriods.map(p => ({ y: p.fiscal_year, tag: "Prov" as const, provPeriod: p }));
    const prjCols  = projYears.map(y => ({ y, tag: "P" as const, provPeriod: null as ProvPeriod | null }));
    const allCols  = [...actCols, ...provCols, ...prjCols];
    const rows = pairs.map(([hl, pl]) => [
      hl,
      ...allCols.map(c => {
        if (c.tag === "Prov" && c.provPeriod) {
          const items = c.provPeriod.pl ?? [];
          const it = items.find(i => i.label === hl);
          return it?.value != null ? String(Number(it.value).toLocaleString("en-IN", { maximumFractionDigits: 2 })) : "—";
        }
        if (c.tag === "P") return lvFirst(projMap.get(c.y) ?? [], ...(PROJ_ALIAS[pl] ?? [pl]));
        return lv(fyMap.get(c.y) ?? [], hl);
      }),
    ]);
    const colHeaders = allCols.map(c => `FY${c.y} (${c.tag})`);
    sectionVI = `**Historical vs Projected (${ul}) — A=Actual P=Projected Prov=Provisional**\n${mdTable(["Metric",...colHeaders], rows)}`;
  }

  // Section VII — Ratio matrix
  let sectionVII = "";
  if (ratios.length > 0) {
    const DISP: Record<string,string> = {
      current_ratio:"Current Ratio", quick_ratio:"Quick Ratio", cash_ratio:"Cash Ratio",
      working_capital:"Working Capital", debt_to_equity:"Debt/Equity", debt_to_assets:"Debt/Assets",
      total_liab_to_networth:"Liab/NW", interest_coverage:"Interest Coverage", dscr:"DSCR",
      asset_turnover:"Asset Turnover", receivables_turnover:"Recv Turnover",
      capital_employed_turnover:"CapEmp Turnover", debtor_days:"Debtor Days",
      creditor_days:"Creditor Days", inventory_turnover:"Inv Turnover",
      gross_margin:"Gross Margin", ebitda_margin:"EBITDA Margin",
      net_profit_margin:"Net Profit Margin", roa:"ROA", roe:"ROE",
      roce:"ROCE", roic:"ROIC", ronw:"RONW", r_score_composite:"R' Score",
    };
    const PCT = new Set(["gross_margin","ebitda_margin","net_profit_margin","roa","roe","roce","roic","ronw"]);
    const SL: Record<string,string> = { green:"PASS", amber:"CAUTION", red:"FAIL", na:"—" };
    const fmt = (n: string, v: number | null) => {
      if (v === null || !Number.isFinite(Number(v))) return "—";
      if (["debtor_days","creditor_days"].includes(n)) return String(Math.round(Number(v)));
      if (n === "working_capital") return Number(v).toLocaleString("en-IN",{maximumFractionDigits:0});
      if (PCT.has(n)) return (Number(v)*100).toFixed(1)+"%";
      return Number(v).toFixed(2)+"x";
    };
    const ratYears = [...new Set(ratios.map(r => r.fiscal_year))].sort();
    const ratNames = [...new Set(ratios.map(r => r.ratio_name))]
      .filter(n => !n.startsWith("r_score_") || n === "r_score_composite");
    const rows = ratNames.map(name => {
      const yCols = ratYears.map(fy => {
        const r = ratios.find(x => x.ratio_name === name && x.fiscal_year === fy);
        return r ? fmt(name, r.ratio_value) : "—";
      });
      const first = ratios.find(x => x.ratio_name === name);
      const bm = first?.benchmark != null ? fmt(name, first.benchmark) : "—";
      const latestRatio = ratios.filter(x => x.ratio_name === name)
        .sort((a,b) => b.fiscal_year - a.fiscal_year)[0];
      const latestVal = latestRatio?.ratio_value != null ? Number(latestRatio.ratio_value) : null;
      const computed = freshStatus(name, latestVal);
      const status = computed !== "na" ? computed : (latestRatio?.threshold_status ?? "na");
      return [DISP[name]||name, ...yCols, bm, SL[status]||"—"];
    });
    sectionVII = `**Key Financial Ratios**\n${mdTable(["Ratio",...ratYears.map(y=>`FY${y}`),"Benchmark","Status"], rows)}`;
  }

  return { sectionV, sectionVI, sectionVII };
}

function inr(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function buildBankSection(rows: BankRow[]): string {
  if (!rows.length) return "";
  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  const recent = sorted.slice(-12);
  const bankName = recent[0]?.bank_name ?? "Bank";

  const headers = ["Month", "Credits", "Debits", "Avg Bal", "Min Bal", "Bounces(In)", "EMI Out"];
  const tableRows = recent.map(r => [
    r.month, inr(r.total_credits), inr(r.total_debits),
    inr(r.avg_balance), inr(r.min_balance),
    r.bounce_inward != null ? String(r.bounce_inward) : "0",
    inr(r.emi_outflows),
  ]);

  const totalCredits  = recent.reduce((s, r) => s + (r.total_credits  ?? 0), 0);
  const totalDebits   = recent.reduce((s, r) => s + (r.total_debits   ?? 0), 0);
  const avgBal        = recent.reduce((s, r) => s + (r.avg_balance    ?? 0), 0) / recent.length;
  const totalBounceIn = recent.reduce((s, r) => s + (r.bounce_inward  ?? 0), 0);
  const totalBounceOut= recent.reduce((s, r) => s + (r.bounce_outward ?? 0), 0);
  const totalEmi      = recent.reduce((s, r) => s + (r.emi_outflows   ?? 0), 0);
  const minBal        = Math.min(...recent.map(r => r.min_balance ?? Infinity).filter(Number.isFinite));

  return `**Bank Statement — ${bankName} (${recent.length} months)**\n${mdTable(headers, tableRows)}\n\n` +
    `**Totals:** Credits ${inr(totalCredits)} | Debits ${inr(totalDebits)} | Avg Balance ${inr(avgBal)} | Min Balance ${minBal === Infinity ? "—" : inr(minBal)} | Bounce-In ${totalBounceIn} | Bounce-Out ${totalBounceOut} | EMI Outflows ${inr(totalEmi)}`;
}

function buildGstSection(rows: GstRow[]): string {
  if (!rows.length) return "";
  const sorted = [...rows].sort((a, b) => a.period.localeCompare(b.period));
  const recent = sorted.slice(-12);

  const headers = ["Period", "Type", "Turnover", "Output Tax", "ITC", "Net Tax", "Status"];
  const tableRows = recent.map(r => [
    r.period, r.return_type ?? "—",
    inr(r.total_turnover), inr(r.output_tax),
    inr(r.itc_claimed), inr(r.net_tax_paid),
    (r.filing_status ?? "—").toUpperCase(),
  ]);

  const totalTurnover = recent.reduce((s, r) => s + (r.total_turnover ?? 0), 0);
  const totalTax      = recent.reduce((s, r) => s + (r.net_tax_paid  ?? 0), 0);
  const totalItc      = recent.reduce((s, r) => s + (r.itc_claimed   ?? 0), 0);
  const lateCount     = recent.filter(r => r.filing_status === "late").length;
  const notFiledCount = recent.filter(r => r.filing_status === "not_filed").length;

  return `**GST Returns (${recent.length} periods)**\n${mdTable(headers, tableRows)}\n\n` +
    `**Totals:** GST Turnover ${inr(totalTurnover)} | Net Tax ${inr(totalTax)} | ITC ${inr(totalItc)} | Late: ${lateCount} | Not Filed: ${notFiledCount}`;
}

function buildAccumnSection(report: AccumnReport | null | undefined): string {
  if (!report?.is_accumn) return "";
  const lines: string[] = ["**Accumn GST Analytical Report**"];

  // Flags
  if (report.flags?.length) {
    lines.push("\n**GST Flags:**");
    for (const f of report.flags) lines.push(`- [${f.severity}] ${f.flag_name}: ${f.description}`);
  }

  // Sales summary
  if (report.sales_summary?.length) {
    const ss = report.sales_summary;
    lines.push(`\n**Revenue Summary (from GSTR data):**`);
    lines.push(mdTable(
      ["Period", "Adj. Revenue", "Gross Margin %", "Rev Growth %"],
      ss.map(s => [
        s.period,
        s.adjusted_revenue != null ? inr(s.adjusted_revenue) : "—",
        s.gross_margin_pct != null ? s.gross_margin_pct.toFixed(1)+"%" : "—",
        s.net_revenue != null ? s.net_revenue.toFixed(1)+"%" : "—",
      ]),
    ));
  }

  // Top 5 customers (latest FY)
  if (report.customer_concentration?.length) {
    const latestFy = report.customer_concentration.reduce((a, c) => (c.period > a ? c.period : a), "");
    const top5 = report.customer_concentration.filter(c => c.period === latestFy && c.rank <= 5)
      .sort((a,b) => a.rank - b.rank);
    if (top5.length) {
      lines.push(`\n**Top Customers (${latestFy}):**`);
      lines.push(mdTable(
        ["Rank","Name","Revenue","% Share"],
        top5.map(c => [String(c.rank), c.name, inr(c.amount), (c.pct * 100).toFixed(1)+"%"]),
      ));
    }
  }

  // Circular transactions
  if (report.circular_transactions?.length) {
    const active = report.circular_transactions.filter(c => c.sale_amount && c.purchase_amount);
    if (active.length) {
      lines.push(`\n**Circular Transactions (${active.length} entities — RISK FLAG):**`);
      lines.push(mdTable(
        ["Entity","Sales Amount","Purchase Amount"],
        active.slice(0, 8).map(c => [c.entity, inr(c.sale_amount ?? null), inr(c.purchase_amount ?? null)]),
      ));
    }
  }

  // Geography top 5 (FY 2024-25 or first period)
  if (report.geography?.length) {
    const geos = report.geography.filter(g => /FY 20\d{2}-\d{2}/.test(g.period));
    const firstFy = geos.reduce((a, g) => (g.period < a || !a ? g.period : a), "");
    const top5geo = geos.filter(g => g.period === firstFy).sort((a,b) => b.amount - a.amount).slice(0,5);
    if (top5geo.length) {
      lines.push(`\n**State-wise Revenue (${firstFy}, top states):**`);
      lines.push(mdTable(
        ["State","Revenue","% Share"],
        top5geo.map(g => [g.state, inr(g.amount), (g.pct * 100).toFixed(1)+"%"]),
      ));
    }
  }

  return lines.join("\n");
}

function buildCibilSection(rows: CibilReportRow[]): string {
  if (!rows.length) return "";
  const lines: string[] = ["**CIBIL / CRIF High Mark — Promoter & Entity Credit Reports**"];

  for (const row of rows) {
    const rd = (row.report_data ?? {}) as Record<string, unknown>;
    const isConsumer = rd.report_type === "consumer" || rd.perform_score != null;

    if (isConsumer) {
      const score = rd.perform_score as number | null | undefined;
      const totalAcc = (rd.total_accounts as number | null) ?? 0;
      const activeAcc = (rd.active_accounts as number | null) ?? 0;
      const overdueAcc = (rd.overdue_accounts as number | null) ?? 0;
      const inq24 = (rd.inquiries_24m as number | null) ?? 0;
      const outstanding = row.total_outstanding;
      const disbursed = rd.total_disbursed as number | null | undefined;
      lines.push(`\n**${row.borrower_name ?? "Promoter"} — CRIF Consumer Report (${row.report_date ?? "—"})**`);
      lines.push(mdTable(
        ["Field","Value"],
        [
          ["CRIF Perform Score", score != null ? String(score) + (score >= 750 ? " ✓ GOOD" : score >= 650 ? " ~ FAIR" : " ✗ WEAK") : "—"],
          ["Accounts", `${totalAcc} total · ${activeAcc} active · ${overdueAcc} overdue`],
          ["Current Outstanding", outstanding != null ? inr(outstanding) : "—"],
          ["Total Ever Disbursed", disbursed != null ? inr(disbursed as number) : "—"],
          ["Inquiries (24M)", String(inq24)],
          ["DPD / Delinquency", overdueAcc > 0 ? `${overdueAcc} OVERDUE ACCOUNTS — HIGH RISK` : "None — Clean record"],
        ],
      ));
      // Active accounts detail
      const accounts = (rd.accounts as Array<Record<string, unknown>> | undefined) ?? [];
      if (accounts.length > 0) {
        lines.push(`Active Accounts:`);
        for (const a of accounts.slice(0, 4)) {
          lines.push(`- ${(a.account_type as string) ?? "Account"} · ${(a.ownership as string) ?? "—"} · Bal ${a.current_balance != null ? inr(a.current_balance as number) : "—"} · Class: ${(a.asset_class as string) ?? "STD"}`);
        }
      }
    } else {
      // Commercial CIBIL / TransUnion
      lines.push(`\n**${row.borrower_name ?? "Entity"} — Commercial CIBIL (${row.report_date ?? "—"})**`);
      lines.push(mdTable(
        ["Field","Value"],
        [
          ["CIBIL Rank",         row.cibil_rank ?? "—"],
          ["Total Outstanding",  row.total_outstanding != null ? inr(row.total_outstanding) : "—"],
          ["Report Date",        row.report_date ?? "—"],
        ],
      ));
    }
  }
  return lines.join("\n");
}

function buildTriangulationSection(row: TriangulationReportRow | null | undefined): string {
  if (!row?.report_data) return "";
  const d = row.report_data;
  const lines: string[] = ["**Accumn Triangulation Report (GST × BSA × ITR)**"];

  // Profile mismatches
  const mismatches = (d.profileDetails ?? []).filter(p => p.result === "Mismatch");
  if (mismatches.length > 0) {
    lines.push("\n**Profile Verification Mismatches:**");
    for (const m of mismatches) lines.push(`- ${m.particular}: MISMATCH across sources — verify with borrower`);
  }

  // Summary key metrics
  if (d.summary?.rows?.length) {
    const periods = d.summary.periods.slice(0, 4);
    const keyRows = ["Revenue from Operations (ITR)","Adjusted Revenue (Total, GST)","Banking Credits","GST Revenue vis a vis Revenue from Operations","Banking Credits vis a vis GST Revenue"]
      .map(p => { const r = d.summary!.rows.find(x => x.particular === p); return r ? [p.length > 50 ? p.slice(0,47)+"…" : p, ...r.values.slice(0, periods.length).map(v => v ?? "—")] : null; })
      .filter(Boolean) as string[][];
    if (keyRows.length) lines.push(`\n**Financial Summary Cross-Check (${periods.join(" | ")}):**\n${mdTable(["Metric",...periods], keyRows)}`);
  }

  // Top customers
  if (d.customers?.parties?.length) {
    const top5 = d.customers.parties.slice(0, 5);
    const rows = top5.map(p => [p.name.slice(0, 30), p.gstAmount != null ? p.gstAmount.toLocaleString("en-IN",{maximumFractionDigits:0}) : "—", p.pctRevenue != null ? (Number(p.pctRevenue)>1?Number(p.pctRevenue).toFixed(1):( Number(p.pctRevenue)*100).toFixed(1))+"%" : "—", p.trend]);
    lines.push(`\n**Top Customer Concentration ${d.customers.period ? "("+d.customers.period+")" : ""}:**\n${mdTable(["Customer","GST Revenue","% Rev","Trend"], rows)}`);
  }

  // Top suppliers
  if (d.suppliers?.parties?.length) {
    const top5 = d.suppliers.parties.slice(0, 5);
    const rows = top5.map(p => [p.name.slice(0, 30), p.gstAmount != null ? p.gstAmount.toLocaleString("en-IN",{maximumFractionDigits:0}) : "—", p.pctRevenue != null ? (Number(p.pctRevenue)>1?Number(p.pctRevenue).toFixed(1):(Number(p.pctRevenue)*100).toFixed(1))+"%" : "—", p.trend]);
    lines.push(`\n**Top Supplier Concentration ${d.suppliers.period ? "("+d.suppliers.period+")" : ""}:**\n${mdTable(["Supplier","GST Expenses","% Rev","Trend"], rows)}`);
  }

  // Circular transactions
  if (d.circularParties?.length) {
    lines.push(`\n**Circular/Related Party Transactions: ${d.circularParties.length} entities flagged**`);
    for (const p of d.circularParties.slice(0, 5)) lines.push(`- ${p.partyName}: both buyer and seller — verify arms-length nature`);
  }

  return lines.join("\n");
}

function buildVisitReportSection(vr: Record<string, unknown> | undefined): string {
  if (!vr) return "No visit report data recorded.";
  const lines: string[] = [];

  const checklist = vr["checklist"] as Record<string, { status: string; source: string; notes: string }> | undefined;
  if (checklist) {
    lines.push("**Reference Checks:**");
    const CHECK_LABELS: Record<string, string> = {
      banker_reference:   "Banker Reference",
      vendor_check:       "Vendor / Supplier Check",
      customer_reference: "Customer Reference",
      site_visit:         "Site Visit",
    };
    for (const [key, label] of Object.entries(CHECK_LABELS)) {
      const item = checklist[key];
      if (!item) continue;
      const status = item.status === "done" ? "✓ DONE" : item.status === "na" ? "N/A" : "⏳ PENDING";
      lines.push(`- ${label} [${item.source || "—"}]: ${status}${item.notes ? ` — ${item.notes}` : ""}`);
    }
  }

  if (vr["overall_notes"]) lines.push(`\n**Site Visit Observations:** ${vr["overall_notes"]}`);
  if (vr["exec_recommendation"]) lines.push(`\n**Executive Recommendation:** ${vr["exec_recommendation"]}`);

  const atts = vr["attachments"] as unknown[] | undefined;
  if (atts?.length) lines.push(`\n${atts.length} facility photo/document attachment${atts.length > 1 ? "s" : ""} on record.`);

  return lines.length ? lines.join("\n") : "No visit report data recorded.";
}

function buildProjectionCredibility(financials: FinRow[]): string {
  const projRows = financials.filter(f => f.statement_type === "projections");
  if (!projRows.length) return "";
  const projYears = [...new Set(projRows.map(f => f.fiscal_year))].sort();
  if (projYears.length < 2) return "";

  const getFirstVal = (fy: number, ...labels: string[]): number | null => {
    const items = ((projRows.find(f => f.fiscal_year === fy)?.line_items) ?? []) as LineItem[];
    for (const label of labels) {
      const it = items.find(i => i.label === label);
      if (it) {
        const v = it.override_value ?? it.value;
        if (v != null && Number.isFinite(Number(v))) return Number(v);
      }
    }
    return null;
  };

  const lines = ["**⚠ PROJECTION CREDIBILITY CHECK (ANALYST MUST VALIDATE)**"];

  const METRICS: [string, string[]][] = [
    ["Turnover", ["Projected Turnover", "Revenue", "Total Income", "Turnover"]],
    ["EBITDA",   ["Projected EBITDA",   "EBITDA"]],
    ["PAT",      ["Projected PAT",      "PAT"]],
  ];

  for (let i = 1; i < projYears.length; i++) {
    const prevFy = projYears[i - 1];
    const thisFy = projYears[i];
    for (const [displayLabel, aliases] of METRICS) {
      const prev = getFirstVal(prevFy, ...aliases);
      const curr = getFirstVal(thisFy, ...aliases);
      if (prev && curr && prev > 0) {
        const growthPct = ((curr - prev) / prev) * 100;
        const flag = growthPct > 200 ? "EXTREMELY AGGRESSIVE (>200%)" :
                     growthPct > 100 ? "VERY AGGRESSIVE (>100%)" :
                     growthPct > 50  ? "AGGRESSIVE (>50%)" : "MODERATE";
        if (growthPct > 50) {
          lines.push(`- FY${prevFy}→FY${thisFy} ${displayLabel}: ${prev.toLocaleString("en-IN",{maximumFractionDigits:0})} → ${curr.toLocaleString("en-IN",{maximumFractionDigits:0})} (+${growthPct.toFixed(0)}%) — ${flag}`);
        }
      }
    }
  }
  if (lines.length === 1) lines.push("- Year-on-year projected growth within moderate range (<50%).");
  lines.push("\nANALYST NOTE: You MUST explicitly comment on projection credibility in Section VI. Flag any year with >100% growth as requiring justification from management.");
  return lines.join("\n");
}

type ProvLineItem = { label: string; value: number; confidence?: number };
type ProvPeriod   = { label: string; fiscal_year: number; months_covered?: number; unit?: string; pl?: ProvLineItem[]; bs?: ProvLineItem[]; cf?: ProvLineItem[] };

function buildProvisionalSection(periods: ProvPeriod[] | null | undefined): string {
  if (!periods?.length) return "";
  const lines: string[] = [`**Provisional / MIS Financial Data (Unaudited — ${periods.length} period${periods.length > 1 ? "s" : ""})**`];
  lines.push("*Note: Provisional figures are unaudited and must be cross-checked against bank credits and GST returns.*");

  for (const p of periods) {
    const ul = p.unit ? `₹ ${p.unit}` : "₹";
    lines.push(`\n**${p.label}${p.months_covered && p.months_covered < 12 ? ` (${p.months_covered}M)` : ""}** ${ul}`);

    const plLabels = ["Turnover","Cost of Goods Sold","Gross Profit","EBITDA","Depreciation","Interest Expense","Profit Before Tax","PAT"];
    const plRows = plLabels
      .map(lb => { const it = (p.pl ?? []).find(i => i.label === lb); const v = it ? (Number(it.value)).toLocaleString("en-IN",{maximumFractionDigits:2}) : "—"; return [lb, v]; })
      .filter(([, v]) => v !== "—");

    if (plRows.length > 0) {
      lines.push(`P&L:\n${mdTable(["Item", ul], plRows)}`);
    }

    const bsLabels = ["Net Worth","Total Debt","Current Assets","Fixed Assets (Net)","Total Assets"];
    const bsRows = bsLabels
      .map(lb => { const it = (p.bs ?? []).find(i => i.label === lb); const v = it ? (Number(it.value)).toLocaleString("en-IN",{maximumFractionDigits:2}) : "—"; return [lb, v]; })
      .filter(([, v]) => v !== "—");

    if (bsRows.length > 0) {
      lines.push(`Balance Sheet:\n${mdTable(["Item", ul], bsRows)}`);
    }
  }
  return lines.join("\n");
}

function buildCompanyContext(company: CompanyRow | null, directors: DirectorRow[] | null, cc: Record<string, unknown>): string {
  if (!company && !directors?.length) return "";
  const lines: string[] = ["**MCA / Corpository Company Profile**"];
  if (company?.name)                  lines.push(`- Company Name: ${company.name}`);
  if (company?.legal_constitution || cc["legal_constitution"])
    lines.push(`- Legal Constitution: ${company?.legal_constitution ?? cc["legal_constitution"]}`);
  // Year of establishment — company table first, then cc field
  const yearEst = company?.year_established ?? cc["year_established"];
  if (yearEst)                        lines.push(`- Year of Establishment: ${yearEst}`);
  if (company?.mca_cin)               lines.push(`- CIN: ${company.mca_cin}`);
  if (company?.mca_pan || cc["pan"])  lines.push(`- PAN: ${company.mca_pan ?? cc["pan"]}`);
  if (company?.mca_status)            lines.push(`- Status: ${company.mca_status}`);
  if (company?.mca_category)          lines.push(`- Category: ${company.mca_category}`);
  if (company?.mca_authorized_capital) lines.push(`- Authorised Capital: ₹${Number(company.mca_authorized_capital).toLocaleString("en-IN")}`);
  if (company?.mca_paid_up_capital)   lines.push(`- Paid-Up Capital: ₹${Number(company.mca_paid_up_capital).toLocaleString("en-IN")}`);
  const sector = company?.mca_sector ?? company?.industry ?? cc["industry"];
  if (sector)                         lines.push(`- Sector / Industry: ${sector}`);
  if (company?.mca_products_services) lines.push(`- Products / Services: ${company.mca_products_services}`);
  if (company?.mca_date_of_incorp)    lines.push(`- Date of Incorporation: ${company.mca_date_of_incorp}`);
  if (company?.mca_date_last_bs)      lines.push(`- Last Balance Sheet Filed: ${company.mca_date_last_bs}`);
  if (company?.mca_date_last_agm)     lines.push(`- Last AGM: ${company.mca_date_last_agm}`);
  if (company?.registered_address)    lines.push(`- Registered Address: ${company.registered_address}`);
  if (company?.gstin || cc["gstin"])  lines.push(`- GSTIN: ${company?.gstin ?? cc["gstin"]}`);
  if (company?.mca_email)             lines.push(`- Email: ${company.mca_email}`);
  if (company?.website || cc["website"]) lines.push(`- Website: ${company?.website ?? cc["website"]}`);
  if (company?.mca_about)             lines.push(`\n**Company Overview:**\n${company.mca_about.slice(0, 1500)}`);
  const promoterDetails = company?.promoter_details ?? cc["promoter_details"];
  if (promoterDetails)                lines.push(`\n**Promoter Details:**\n${String(promoterDetails).slice(0, 600)}`);
  if (cc["group_summary"])            lines.push(`\n**Group Summary:**\n${String(cc["group_summary"]).slice(0, 600)}`);
  if (directors?.length) {
    lines.push("\n**Board of Directors / Partners:**");
    lines.push("| Name | Designation | DIN | Shareholding % | Appointed |");
    lines.push("|---|---|---|---|---|");
    for (const d of directors.slice(0, 10))
      lines.push(`| ${d.name} | ${d.designation ?? "—"} | ${d.din ?? "—"} | ${d.shareholding ?? "—"} | ${d.appointed_current ?? "—"} |`);
  }
  return lines.join("\n");
}

// ── Section-specific row schemas (defines what labeled rows each section generates) ───
const SECTION_SCHEMAS: Record<string, { rowLabels: string[] }> = {
  historical_financial: {
    rowLabels: [
      "Revenue Trend",
      "Gross Profit & Margins",
      "EBITDA & Operating Performance",
      "PAT & Net Profitability",
      "Balance Sheet Snapshot",
      "Leverage & Debt Position",
      "Cash & Liquidity",
      "Analyst Observation",
    ],
  },
  executive_summary: {
    rowLabels: [
      "Company Overview",
      "History & Background",
      "Core Business Activity",
      "Operational Scale & Presence",
      "Revenue & Financial Snapshot",
      "Strategic Rationale for Funding",
    ],
  },
  client_promoter: {
    rowLabels: [
      "Company",
      "Registered Office",
      "Nature of Business",
      "Year of Establishment",
      "Group Companies / History",
      "Promoters & Directors",
      "Ownership",
    ],
  },
  investment_structure: {
    rowLabels: [
      "Product & Facility Amount",
      "Purpose / End Use",
      "Tenure",
      "IRR / Rate",
      "Collateral & Security",
      "Repayment Structure",
    ],
  },
  rehbar_funding_history: {
    rowLabels: [
      "Prior Exposure",
      "Facility Details (if any)",
      "Repayment Track Record",
      "Conduct of Account",
      "Analyst Observation",
    ],
  },
  historical_pl_obs: {
    rowLabels: [
      "Revenue & Sales Growth",
      "Gross Profit & Margin",
      "EBITDA & Operating Yield",
      "Administrative Cost Efficiency",
      "Finance & Interest Costs",
      "Net Profit (PAT / EAT) & Cash Profit",
      "Analyst Observation",
    ],
  },
  historical_bs_obs: {
    rowLabels: [
      "Share Capital & Promoter Equity",
      "Reserves & Surplus",
      "Director / Promoter Funding (Inside)",
      "Long-Term Bank Borrowings",
      "Short-Term Borrowings & Working Capital",
      "Trade Payables & Creditor Terms",
      "Provisions & Other Current Liabilities",
      "Balance Sheet Strength Assessment",
    ],
  },
  projections: {
    rowLabels: [
      "Revenue Projection",
      "EBITDA Projection",
      "PAT Projection",
      "DSCR Estimate",
      "Key Assumptions",
      "Credibility Assessment",
    ],
  },
  cash_flow: {
    rowLabels: [
      "Banking Overview",
      "Average Monthly Balance",
      "Monthly Credits (Avg)",
      "Monthly Debits (Avg)",
      "Bounce / Stress Events",
      "Cash Flow Adequacy for Repayment",
    ],
  },
  cash_flow_obs: {
    rowLabels: [
      "Operating Activities (CFO)",
      "Investing Activities (CFI)",
      "Financing Activities (CFF)",
      "Net Cash Position & Liquidity",
      "Opening & Closing Cash Balances",
      "Working Capital Cycle",
      "Cash Flow Adequacy",
      "Analyst Observation",
    ],
  },
  due_diligence: {
    rowLabels: [
      "GST Compliance",
      "Customer Concentration",
      "Supplier Concentration",
      "Circular / Related Party Transactions",
      "Triangulation Findings",
      "Overall Due Diligence Rating",
    ],
  },
  visit_reference: {
    rowLabels: [
      "Site Visit Status",
      "Premises Observation",
      "Banker Reference",
      "Customer / Vendor Reference",
      "Promoter Background Check",
      "Reference Summary",
    ],
  },
  exec_recommendation: {
    rowLabels: [
      "Recommendation",
      "Deal Strengths",
      "Key Concerns",
      "Mitigating Factors",
      "Suggested Conditions",
    ],
  },
  product_specifics: {
    rowLabels: [
      "Product Type & SOP Applicability",
      "Policy Exceptions Required",
      "GST / E-Invoice Requirements",
      "NACH / Repayment Mode",
      "Special Terms or Waivers",
    ],
  },
  triangulation_analysis: {
    rowLabels: [
      "Profile Verification",
      "Revenue Cross-Check (GST vs BSA vs ITR)",
      "Customer Concentration",
      "Supplier Concentration",
      "Circular / Related Party Flags",
      "Data Quality Assessment",
    ],
  },
  key_ratios: {
    rowLabels: [
      "Coverage – DSCR & ICR",
      "Liquidity – Current & Quick Ratio",
      "Solvency – Leverage & D/E",
      "Profitability – Margins & PAT",
      "Efficiency – Working Capital & Turnover",
      "Return Ratios – ROE / RONW",
      "R' Score Assessment",
      "Analyst Observation",
    ],
  },
  default: {
    rowLabels: [
      "Overview",
      "Key Details",
      "Financial Aspects",
      "Risks & Mitigants",
      "Analyst Observation",
    ],
  },
};

interface SectionContextOpts {
  company?: CompanyRow | null;
  directors?: DirectorRow[] | null;
  bankRows?: BankRow[];
  accumnReport?: AccumnReport | null;
  triRow?: TriangulationReportRow | null;
  gstRows?: GstRow[];
  cibilBlock?: string;
  visitReport?: Record<string, unknown> | null;
  provisionalBlock?: string;
}

function buildSectionContext(
  cc: Record<string, unknown> | null,
  financials: FinRow[],
  ratios: RatioRow[],
  sectionId: string,
  ragContext: string,
  opts?: SectionContextOpts,
): string {
  const parts: string[] = [];
  const { company, directors, bankRows = [], accumnReport, triRow, gstRows = [], cibilBlock, visitReport, provisionalBlock } = opts ?? {};

  // RAG context
  if (ragContext) parts.push(`DOCUMENT CONTEXT:\n${ragContext}`);

  // Analyst notes — highlighted block so Claude prioritises them
  if (cc?.analyst_notes) {
    parts.push(`ANALYST NOTES (priority — incorporate these observations into your analysis):\n${cc.analyst_notes}`);
  }

  // Case metadata — full set of fields
  if (cc) {
    const caseLines = [
      `Client: ${cc.client_name ?? "?"}`,
      `Case Code: ${cc.case_code ?? "?"}`,
      `Industry: ${cc.industry ?? "?"}`,
      `Legal Constitution: ${cc.legal_constitution ?? "?"}`,
    ];
    if (cc.year_established) caseLines.push(`Year Established: ${cc.year_established}`);
    if (cc.registered_address) caseLines.push(`Registered Address: ${cc.registered_address}`);
    if (cc.gstin) caseLines.push(`GSTIN: ${cc.gstin}`);
    if (cc.pan) caseLines.push(`PAN: ${cc.pan}`);
    caseLines.push(
      `Product: ${cc.product_type ?? "?"}`,
      `Amount: INR ${cc.deal_amount ?? "?"} Lakhs`,
      `Tenure: ${cc.tenure_months ?? "?"} months`,
      `IRR: ${cc.expected_irr ?? "?"}%`,
      `End Use: ${cc.end_use ?? "?"}`,
      `Collateral: ${cc.collateral_summary ?? "?"}`,
    );
    if (cc.promoter_details) caseLines.push(`Promoters: ${cc.promoter_details}`);
    if (cc.group_summary) caseLines.push(`Group Summary: ${cc.group_summary}`);
    if (cc.rehbar_history) caseLines.push(`Rehbar Funding History: ${cc.rehbar_history}`);
    parts.push(`CASE DATA:\n${caseLines.join("\n")}`);
  }

  // Company / directors data for client-facing sections
  if (["client_promoter", "executive_summary"].includes(sectionId) && (company || directors?.length)) {
    parts.push(buildCompanyContext(company ?? null, directors ?? null, cc ?? {}));
  }

  // Financial data for relevant sections
  if (["historical_financial", "historical_pl_obs", "historical_bs_obs", "executive_summary", "projections", "key_ratios", "cash_flow", "cash_flow_obs"].includes(sectionId)) {
    const fyMap = new Map<number, LineItem[]>();
    for (const row of financials.filter(r => r.statement_type !== "projections")) {
      const items = (row.line_items as LineItem[]) ?? [];
      const existing = fyMap.get(row.fiscal_year) ?? [];
      const seen = new Set(existing.map((i: LineItem) => i.label));
      fyMap.set(row.fiscal_year, [...existing, ...items.filter((i: LineItem) => !seen.has(i.label))]);
    }
    const histYears = [...fyMap.keys()].sort();
    const recentYears = histYears.slice(-3);

    if (recentYears.length > 0) {
      if (sectionId === "historical_pl_obs") {
        // Full P&L table for P&L observations
        const plLabels = ["Turnover","Cost of Goods Sold","Gross Profit","Operating Expenses","EBITDA","Depreciation","EBIT","Interest Expense","Profit Before Tax","Tax","PAT"];
        const plRows = plLabels.map(lb => `${lb}: ${recentYears.map(y => lv(fyMap.get(y)!, lb)).join(" / ")}`);
        parts.push(`FULL P&L (${recentYears.map(y=>`FY${y}`).join(" / ")}, ₹ Lakhs):\n${plRows.join("\n")}`);
      } else if (sectionId === "historical_bs_obs") {
        // Full Balance Sheet for BS observations
        const bsLabels = ["Share Capital","Reserves & Surplus","Net Worth","Long Term Borrowings","Short Term Borrowings","Total Debt","Trade Payables","Current Liabilities","Other Current Liabilities","Fixed Assets (Net)","Inventory","Trade Receivables","Cash & Bank","Current Assets","Total Assets"];
        const bsRows = bsLabels.map(lb => `${lb}: ${recentYears.map(y => lv(fyMap.get(y)!, lb)).join(" / ")}`);
        parts.push(`FULL BALANCE SHEET (${recentYears.map(y=>`FY${y}`).join(" / ")}, ₹ Lakhs):\n${bsRows.join("\n")}`);
      } else if (sectionId === "cash_flow_obs") {
        // Cash Flow Statement data — use actual CF rows if uploaded, else derive from BS+P&L
        const cfRows = financials.filter(r => r.statement_type === "cash_flow");
        if (cfRows.length > 0) {
          // Actual CF statement uploaded — pass all labels
          const cfYears = [...new Set(cfRows.map(r => r.fiscal_year))].sort().slice(-3);
          const cfFyMap = new Map<number, LineItem[]>();
          for (const row of cfRows) {
            const items = (row.line_items as LineItem[]) ?? [];
            cfFyMap.set(row.fiscal_year, items);
          }
          const cfSeen = new Set<string>();
          const cfLabels: string[] = [];
          for (const row of cfRows) {
            for (const item of (row.line_items as LineItem[]) ?? []) {
              if (item.label && !cfSeen.has(item.label)) { cfSeen.add(item.label); cfLabels.push(item.label); }
            }
          }
          const cfTableRows = cfLabels
            .filter(lb => cfYears.some(y => lv(cfFyMap.get(y) ?? [], lb) !== "—"))
            .map(lb => `${lb}: ${cfYears.map(y => lv(cfFyMap.get(y) ?? [], lb)).join(" / ")}`);
          parts.push(`CASH FLOW STATEMENT (${cfYears.map(y=>`FY${y}`).join(" / ")}, ₹ Lakhs):\n${cfTableRows.join("\n")}`);
        } else {
          // Derive CFO/CFI/CFF from BS + P&L
          const driveYears = recentYears.slice(1); // delta needs prior year
          if (driveYears.length > 0) {
            const dvRows: string[] = [`DERIVED CASH FLOW (${driveYears.map(y=>`FY${y}`).join(" / ")}, ₹ Lakhs — Indirect Method):`];
            const getLv = (fy: number, lb: string) => { const v = lv(fyMap.get(fy) ?? [], lb); return v !== "—" ? Number(v.replace(/,/g, "")) : null; };
            const delta = (lb: string, fy: number) => {
              const curr = getLv(fy, lb);
              const prev = getLv(recentYears[recentYears.indexOf(fy) - 1], lb);
              return curr !== null && prev !== null ? curr - prev : null;
            };
            const fmt2 = (v: number | null) => v !== null ? v.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—";
            for (const fy of driveYears) {
              const pat   = getLv(fy, "PAT");
              const depn  = getLv(fy, "Depreciation");
              const dAR   = delta("Trade Receivables", fy);
              const dInv  = delta("Inventory", fy);
              const dAP   = delta("Trade Payables", fy);
              const dOCL  = delta("Other Current Liabilities", fy);
              const cfoItems = [pat, depn, dAR !== null ? -dAR : null, dInv !== null ? -dInv : null, dAP, dOCL];
              const cfo = cfoItems.every(p => p === null) ? null : cfoItems.reduce<number>((s, v) => s + (v ?? 0), 0);
              const dFA  = delta("Fixed Assets (Net)", fy);
              const cfi  = dFA !== null && depn !== null ? -((dFA) + depn) : null;
              const dLT  = delta("Long Term Borrowings", fy);
              const dST  = delta("Short Term Borrowings", fy);
              const dNW  = delta("Net Worth", fy);
              const eq   = dNW !== null && pat !== null ? dNW - pat : null;
              const cffItems = [dLT, dST, eq];
              const cff = cffItems.every(p => p === null) ? null : cffItems.reduce<number>((s, v) => s + (v ?? 0), 0);
              const net  = (cfo !== null || cfi !== null || cff !== null) ? (cfo ?? 0) + (cfi ?? 0) + (cff ?? 0) : null;
              dvRows.push(`FY${fy}: CFO=${fmt2(cfo)} | CFI=${fmt2(cfi)} | CFF=${fmt2(cff)} | Net Change=${fmt2(net)}`);
              dvRows.push(`  PAT=${fmt2(pat)} | Depreciation=${fmt2(depn)} | ΔReceivables=${fmt2(dAR !== null ? -dAR : null)} | ΔInventory=${fmt2(dInv !== null ? -dInv : null)} | ΔPayables=${fmt2(dAP)} | ΔBorrowings(LT)=${fmt2(dLT)} | ΔBorrowings(ST)=${fmt2(dST)}`);
            }
            parts.push(dvRows.join("\n"));
          }
        }
        // Also add key BS items for opening/closing cash
        const cashLabels = ["Cash & Bank", "Cash & Cash Equivalents"];
        const cashRow = cashLabels.flatMap(lb => {
          const vals = recentYears.map(y => `FY${y}: ${lv(fyMap.get(y) ?? [], lb)}`).filter(v => !v.endsWith("—"));
          return vals.length ? [`${lb}: ${recentYears.map(y => lv(fyMap.get(y) ?? [], lb)).join(" / ")}`] : [];
        });
        if (cashRow.length > 0) parts.push(`CASH BALANCES:\n${cashRow.join("\n")}`);
      } else {
        // Full financials for historical_financial (V-d); key summary for others
        const isHistFin = sectionId === "historical_financial";
        const summaryLabels = isHistFin
          ? ["Turnover","Cost of Goods Sold","Gross Profit","EBITDA","Interest Expense","PAT","Net Worth","Long Term Borrowings","Short Term Borrowings","Total Debt","Cash & Bank","Total Assets"]
          : ["Turnover","Gross Profit","EBITDA","PAT","Net Worth","Total Debt"];
        const keyRows = summaryLabels
          .map(lb => `${lb}: ${recentYears.map(y => lv(fyMap.get(y)!, lb)).join(" / ")}`)
          .filter(r => !r.endsWith("— / — / —") && !r.endsWith("— / —") && !r.endsWith("—"));
        parts.push(`FINANCIAL SUMMARY (${recentYears.map(y=>`FY${y}`).join(" / ")}, ₹ Lakhs):\n${keyRows.join("\n")}`);
      }
    }

    if (ratios.length > 0 && !["historical_pl_obs","historical_bs_obs","cash_flow_obs"].includes(sectionId)) {
      // Only use years that have actual historical financial data — exclude projected-only years
      const histFYSet = new Set(financials.filter(r => r.statement_type !== "projections").map(r => r.fiscal_year));
      const ratYears = [...new Set(
        ratios.filter(r => histFYSet.has(r.fiscal_year)).map(r => r.fiscal_year)
      )].sort().slice(-3);
      const keyRatios = ["dscr","current_ratio","debt_to_equity","ebitda_margin","net_profit_margin"];
      const ratSummary = keyRatios.map(name => {
        // Build per-year values across all recent years (skip zero — stale bad-compute artifact)
        const perYear = ratYears.map(fy => {
          const candidates = ratios
            .filter(r => r.ratio_name === name && r.fiscal_year === fy)
            .sort((a, b) => (b.ratio_value != null ? 1 : 0) - (a.ratio_value != null ? 1 : 0));
          // Prefer a non-zero value for this FY
          const row = candidates.find(r => r.ratio_value != null && Number(r.ratio_value) !== 0) ?? candidates[0];
          if (!row || row.ratio_value == null) return `FY${fy}: —`;
          const val = Number(row.ratio_value);
          const PCT = new Set(["ebitda_margin","net_profit_margin","gross_margin","roa","roe","roce"]);
          const fmtV = PCT.has(name) ? `${(val*100).toFixed(1)}%` : `${val.toFixed(2)}x`;
          return `FY${fy}: ${fmtV}`;
        });
        // Use latest non-zero row for status
        const latestRow = ratios
          .filter(r => r.ratio_name === name && ratYears.includes(r.fiscal_year) && r.ratio_value != null && Number(r.ratio_value) !== 0)
          .sort((a, b) => b.fiscal_year - a.fiscal_year)[0];
        if (!latestRow && perYear.every(s => s.endsWith("—"))) return null;
        const latestVal = latestRow?.ratio_value != null ? Number(latestRow.ratio_value) : null;
        const computed = freshStatus(name, latestVal);
        const statusLabel = computed !== "na" ? computed : (latestRow?.threshold_status ?? "?");
        return `${name} [${perYear.join(" | ")}] — Status: ${statusLabel}`;
      }).filter(Boolean);
      if (ratSummary.length > 0) parts.push(`KEY RATIOS (recent years):\n${ratSummary.join("\n")}`);
    }
  }

  // Provisional financials for financial / projection sections
  if (["historical_financial","historical_pl_obs","historical_bs_obs","projections","key_ratios","executive_summary","cash_flow_obs"].includes(sectionId) && provisionalBlock) {
    parts.push(`PROVISIONAL / CURRENT-YEAR DATA:\n${provisionalBlock}`);
  }

  // Bank statement data for cash flow sections
  if (["cash_flow", "cash_flow_obs"].includes(sectionId) && bankRows.length > 0) {
    parts.push(buildBankSection(bankRows).slice(0, 1200));
  }

  // GST returns for compliance / triangulation / executive summary
  if (["due_diligence","triangulation_analysis","cash_flow","executive_summary"].includes(sectionId) && gstRows.length > 0) {
    parts.push(buildGstSection(gstRows).slice(0, 1_200));
  }

  // CIBIL / CRIF data for promoter and risk sections
  if (["client_promoter","executive_summary","risk_assessment","exec_recommendation"].includes(sectionId) && cibilBlock) {
    parts.push(cibilBlock.slice(0, 1_200));
  }

  // Accumn data for due diligence
  if (sectionId === "due_diligence" && accumnReport) {
    parts.push(buildAccumnSection(accumnReport).slice(0, 1200));
  }

  // Triangulation data for due diligence and triangulation_analysis
  if (["due_diligence", "triangulation_analysis"].includes(sectionId) && triRow) {
    parts.push(buildTriangulationSection(triRow).slice(0, 1500));
  }

  // Visit report for visit_reference and exec_recommendation
  if (["visit_reference","exec_recommendation"].includes(sectionId) && visitReport) {
    parts.push(buildVisitReportSection(visitReport).slice(0, 1_500));
  }

  return parts.join("\n\n");
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

    const body = await req.json();
    const { case_id, analyst_notes_for_ic, phase, prior_sections, section_ids } = body as {
      case_id: string;
      analyst_notes_for_ic?: string;
      phase?: 1 | 2;
      prior_sections?: Record<string, { markdown: string }>;
      section_ids?: string[];
    };
    if (!case_id) return new Response(JSON.stringify({ error: "case_id required" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });

    // Per-section generation for IC Deck tab
    if (section_ids && Array.isArray(section_ids) && section_ids.length > 0) {
      // Fetch case data plus all supplementary sources for rich context
      const [caseRes, finRes, ratioRes, bankRes, accumnRes, triRes, gstRes, cibilRes] = await Promise.all([
        supabase.from("credit_cases").select("*").eq("id", case_id).single(),
        supabase.from("extracted_financials").select("*").eq("case_id", case_id),
        supabase.from("financial_ratios").select("*").eq("case_id", case_id),
        supabase.from("bank_statement_data").select("*").eq("case_id", case_id).order("month"),
        supabase.from("gst_accumn_reports").select("report_data").eq("case_id", case_id).limit(1),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from("triangulation_data").select("report_data").eq("case_id", case_id).limit(1),
        supabase.from("gst_return_data").select("*").eq("case_id", case_id).order("period"),
        supabase.from("cibil_report_data").select("cibil_rank,total_outstanding,borrower_name,report_date,report_data").eq("case_id", case_id).order("created_at", { ascending: false }).limit(10),
      ]);
      const cc = caseRes.data as Record<string, unknown> | null;
      const financials = (finRes.data ?? []) as FinRow[];
      const ratios = (ratioRes.data ?? []) as RatioRow[];
      const bankRows = (bankRes.data ?? []) as BankRow[];
      const accumnReport = ((accumnRes.data ?? []) as AccumnReportRow[])[0]?.report_data ?? null;
      const triRow = ((triRes.data ?? []) as TriangulationReportRow[])[0] ?? null;
      const gstRows = (gstRes.data ?? []) as GstRow[];
      const cibilRows = (cibilRes.data ?? []) as CibilReportRow[];
      const cibilBlockDeck = buildCibilSection(cibilRows);
      const icNoteJsonDeck = (cc?.ic_note ?? {}) as Record<string, unknown>;
      const provisionalPeriodsDeck = (icNoteJsonDeck["provisional"] ?? []) as ProvPeriod[];
      const visitReportDeck = icNoteJsonDeck["visit_report"] as Record<string, unknown> | undefined;
      const provisionalBlockDeck = buildProvisionalSection(provisionalPeriodsDeck).slice(0, 1_400);

      // Fetch company profile and directors — by company_id if linked, otherwise by name
      let company: CompanyRow | null = null;
      let directors: DirectorRow[] | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      if (cc?.company_id) {
        const [companyRes, directorsRes] = await Promise.all([
          db.from("companies").select("*").eq("id", cc.company_id).single(),
          db.from("company_directors").select("name,designation,din,shareholding,appointed_current,remarks").eq("company_id", cc.company_id),
        ]);
        company  = (companyRes.data  ?? null) as CompanyRow | null;
        directors = (directorsRes.data ?? null) as DirectorRow[] | null;
      } else if (cc?.client_name) {
        // Fallback: find company by name (case-insensitive)
        const nameRes = await db.from("companies").select("*").ilike("name", `%${cc.client_name}%`).limit(1);
        if (nameRes.data?.length) {
          company = nameRes.data[0] as CompanyRow;
          const dirRes = await db.from("company_directors").select("name,designation,din,shareholding,appointed_current,remarks").eq("company_id", (company as CompanyRow & { id: string }).id);
          directors = (dirRes.data ?? null) as DirectorRow[] | null;
        }
      }

      const section_templates: Record<string, unknown> = {};

      for (const sectionId of section_ids) {
        const ragContext = await getRagContext(supabase, case_id, sectionId, Deno.env.get("GEMINI_API_KEY") ?? "");
        const sectionDataContext = buildSectionContext(cc, financials, ratios, sectionId, ragContext, {
          company, directors, bankRows, accumnReport, triRow,
          gstRows, cibilBlock: cibilBlockDeck, visitReport: visitReportDeck ?? null, provisionalBlock: provisionalBlockDeck,
        });

        // ── Special handler: risk_assessment → rich categorised format ──────────
        if (sectionId === "risk_assessment") {
          const riskPrompt = `You are a Senior Credit Analyst at an Islamic NBFC. Generate a comprehensive risk assessment for the Investment Committee note.

Case: ${cc?.client_name ?? "Unknown"} | Industry: ${cc?.industry ?? "?"} | Amount: INR ${cc?.deal_amount ?? "?"} Lakhs | Product: ${cc?.product_type ?? "?"}

${sectionDataContext}

Generate risks grouped by category. Return ONLY valid JSON (no markdown, no explanation):
{
  "categories": [
    {
      "category": "Business/Industry Risk",
      "intro": "One sentence describing this risk category and why it matters for this company.",
      "items": [
        {
          "title": "Short descriptive risk name (5-8 words)",
          "risk": "Specific risk description (2-3 sentences, include actual numbers where known).",
          "mitigation": "Concrete mitigation measures the company has or Rehbar can enforce (2-3 sentences).",
          "severity": "high"
        }
      ]
    },
    {
      "category": "Financial Risk",
      "intro": "One sentence describing financial risk exposure.",
      "items": [...]
    }
  ]
}

Categories to include: Business/Industry Risk (3-5 items), Financial Risk (3-5 items). Optionally add: Transaction Risk, Operational Risk if relevant.
Severity must be exactly "high", "medium", or "low".
Every risk and mitigation must be specific to this company — no generic statements.`;

          try {
            const text = await callAIText({
              systemPrompt: "You are a credit analyst writing an Investment Committee risk register. Return only valid JSON.",
              userText: riskPrompt,
              maxTokens: 2000,
            });
            const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
            const parsed = JSON.parse(cleaned);
            section_templates[sectionId] = {
              categories: parsed.categories ?? [],
              generated_at: new Date().toISOString(),
            };
          } catch {
            section_templates[sectionId] = {
              categories: [],
              generated_at: new Date().toISOString(),
            };
          }
          continue;
        }

        // ── Standard handler: structured rows + flags (PPTX table layout) ──────
        const sectionSchema = SECTION_SCHEMAS[sectionId] ?? SECTION_SCHEMAS["default"];
        const prompt = `You are a Senior Credit Analyst at Rehbar, an Islamic NBFC. Generate structured IC Deck content for the "${sectionId}" section.

Case: ${cc?.client_name ?? "Unknown"} | Amount: INR ${cc?.deal_amount ?? "?"} Lakhs | Product: ${cc?.product_type ?? "?"} | Industry: ${cc?.industry ?? "?"}

${sectionDataContext}

INSTRUCTIONS:
- BREVITY IS CRITICAL. Every row value must be a single short phrase or 1 sentence — max 20 words. IC deck slides, not prose.
- Use ONLY the data provided above. Do NOT say "not provided" if the information exists anywhere in the data above.
${["client_promoter","executive_summary"].includes(sectionId) ? `- For company identity fields (registered address, CIN, date of incorporation): look in the MCA/Corpository section and CASE DATA above.
- For year established: use "Year of Establishment" or "Date of Incorporation" or "year_established" from CASE DATA/MCA.
- For promoters & directors: use the Board of Directors table (names, DIN, shareholding). Also check cc.promoter_details.` : `- Focus on financial and operational data only. Do NOT mention missing company registry fields.`}
- For financial figures: state actual numbers only (e.g. "₹X Cr → ₹Y Cr, +Z%"). No narrative, no interpretation.
- Flags: one-line risks with specific numbers only. No vague statements.
- If data is truly absent: write "Not on file" (3 words, nothing more).

Generate the following labeled rows (key-value table format matching Rehbar IC Deck slides). Be specific — include actual names, numbers, dates, addresses from the data above.

${sectionSchema.rowLabels.map((l, i) => `Row ${i+1} label: "${l}"`).join("\n")}

Return ONLY valid JSON (no markdown, no explanation):
{
  "rows": [
    ${sectionSchema.rowLabels.map(l => `{ "label": "${l}", "text": "Key fact only — 1 short phrase or 1 sentence, max 20 words. Use actual numbers/names from the data." }`).join(",\n    ")}
  ],
  "flags": ["One-line risk with specific numbers. Empty array if no concerns."]
}`;

        try {
          const text = await callAIText({
            systemPrompt: "You are a credit analyst writing Investment Committee deck slides. Return only valid JSON. Each row value must be SHORT — one phrase or one sentence, max 20 words. Think slide bullet, not paragraph. Use actual data: names, numbers, dates. If absent: 'Not on file'. No explanations, no filler, no multi-sentence text.",
            userText: prompt,
            maxTokens: 1800,
          });

          const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const parsed = JSON.parse(cleaned);
          section_templates[sectionId] = {
            rows: parsed.rows ?? [],
            flags: parsed.flags ?? [],
            generated_at: new Date().toISOString(),
          };
        } catch {
          section_templates[sectionId] = {
            rows: [],
            flags: [],
            generated_at: new Date().toISOString(),
          };
        }
      }

      return new Response(
        JSON.stringify({ section_templates }),
        { headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const { data: cc } = await supabase.from("credit_cases").select("*").eq("id", case_id).single();
    if (!cc) return new Response(JSON.stringify({ error: "Case not found" }), {
      status: 404, headers: { ...cors, "Content-Type": "application/json" },
    });

    // Fetch all data in a single parallel round to minimise wall-clock time
    const safeQuery = async <T>(fn: () => PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> => {
      try { const { data } = await fn(); return data; } catch { return null; }
    };
    const [
      { data: financials }, { data: ratios }, { data: bankStatements }, { data: gstReturns },
      accumnRows, cibilRows, triRows, companyRow, directorsRows,
    ] = await Promise.all([
      supabase.from("extracted_financials").select("fiscal_year,statement_type,line_items,unit").eq("case_id", case_id),
      supabase.from("financial_ratios").select("fiscal_year,ratio_name,ratio_value,threshold_status,benchmark").eq("case_id", case_id),
      supabase.from("bank_statement_data").select("*").eq("case_id", case_id).order("month"),
      supabase.from("gst_return_data").select("*").eq("case_id", case_id).order("period"),
      safeQuery(() => supabase.from("gst_accumn_reports").select("report_data").eq("case_id", case_id).limit(1)),
      safeQuery(() => supabase.from("cibil_report_data").select("cibil_rank,total_outstanding,borrower_name,report_date,report_data").eq("case_id", case_id).order("created_at", { ascending: false }).limit(10)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      safeQuery(() => (supabase as any).from("triangulation_data").select("report_data").eq("case_id", case_id).limit(1)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cc.company_id ? safeQuery(() => (supabase as any).from("companies").select("*").eq("id", cc.company_id).single()) : Promise.resolve(null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cc.company_id ? safeQuery(() => (supabase as any).from("company_directors").select("name,designation,din,shareholding,appointed_current,remarks").eq("company_id", cc.company_id)) : Promise.resolve(null),
    ]);

    // ── RAG retrieval — parallel vector search for all 12 sections ──────────────
    // Runs after structured data is already in hand; each call is ~200ms so
    // 12 parallel calls add ~300–500ms total, well within the 150s budget.
    const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? Deno.env.get("GOOGLE_GENERATIVE_AI_API_KEY") ?? "";
    const ragContexts: Record<string, string> = {};
    if (geminiKey) {
      try {
        const ragPromise = Promise.all(
          SECTION_IDS.map((id) =>
            getRagContext(supabase, case_id, id, geminiKey)
              .then((ctx) => ({ id, ctx }))
              .catch(() => ({ id, ctx: "" })),
          ),
        );
        // Hard cap: RAG must finish within 12s or we skip it entirely
        const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000));
        const winner = await Promise.race([ragPromise, timeout]);
        if (winner) {
          for (const { id, ctx } of winner) ragContexts[id] = ctx;
        } else {
          console.warn("RAG phase timed out after 12s; continuing without vector context");
        }
      } catch {
        console.warn("RAG retrieval failed; continuing without vector context");
      }
    }

    const buildRagBlock = (sectionId: string): string => {
      const ctx = ragContexts[sectionId];
      if (!ctx) return "";
      return `\n\n[RAG: indexed context]\n${ctx.slice(0, 600)}`;
    };

    // Status update — fire-and-forget (enum trigger may reject via REST, that's ok)
    supabase.from("credit_cases").update({ status: "narrative" as never }).eq("id", case_id).then(
      ({ error }) => { if (error) console.warn("Pre-generate status update skipped:", error.message); }
    );

    const safeCase = {
      client_name:          cc.client_name,
      legal_constitution:   cc.legal_constitution,
      industry:             cc.industry || (companyRow as CompanyRow | null)?.mca_sector || "—",
      year_established:     cc.year_established,
      principal_borrower:   cc.principal_borrower,
      product_type:         cc.product_type,
      deal_amount:          cc.deal_amount ?? "Not provided",
      tenure_months:        cc.tenure_months ?? "Not provided",
      expected_irr:         cc.expected_irr ?? "Not provided",
      residual_value:       cc.residual_value ?? "Not provided",
      security_deposit:     cc.security_deposit ?? "Not provided",
      collateral_summary:   cc.collateral_summary ?? "Not provided — analyst to confirm",
      end_use:              cc.end_use ?? "Not provided — analyst to confirm",
      strategic_rationale:  cc.strategic_rationale ?? "Not provided — analyst to confirm",
      analyst_notes:        cc.analyst_notes ?? "",
      policy_exceptions:    cc.policy_exceptions ?? "None",
      website:              cc.website ?? (companyRow as CompanyRow | null)?.website ?? "—",
    };

    const companyContext = buildCompanyContext(
      companyRow as CompanyRow | null,
      directorsRows as DirectorRow[] | null,
      cc as Record<string, unknown>,
    );

    // Provisional data lives in ic_note.provisional on the case, not in extracted_financials
    const icNoteJson = (cc.ic_note ?? {}) as Record<string, unknown>;
    const provisionalPeriods = (icNoteJson["provisional"] ?? []) as ProvPeriod[];

    // Visit report data for Section XI
    const visitReport = icNoteJson["visit_report"] as Record<string, unknown> | undefined;
    const provisionalBlock = buildProvisionalSection(provisionalPeriods).slice(0, 1_400);

    const tables     = buildTables((financials ?? []) as FinRow[], (ratios ?? []) as RatioRow[], provisionalPeriods);
    const bankTable  = buildBankSection((bankStatements ?? []) as BankRow[]).slice(0, 2_000);
    const gstTable   = buildGstSection((gstReturns ?? []) as GstRow[]).slice(0, 1_800);
    const accumnReport = (accumnRows as AccumnReportRow[] | null | undefined)?.[0]?.report_data ?? null;
    const accumnBlock  = buildAccumnSection(accumnReport).slice(0, 1_800);
    const cibilBlock   = buildCibilSection((cibilRows as CibilReportRow[] | null | undefined) ?? []);
    const triBlock     = buildTriangulationSection((triRows as TriangulationReportRow[] | null | undefined)?.[0]).slice(0, 2_500);
    const projBlock    = buildProjectionCredibility((financials ?? []) as FinRow[]);

    // Bank trend analysis — detect sharp credit decline
    const bankRows = (bankStatements ?? []) as BankRow[];
    let bankTrendNote = "";
    if (bankRows.length >= 6) {
      const sorted = [...bankRows].sort((a, b) => a.month.localeCompare(b.month));
      const firstHalf  = sorted.slice(0, Math.floor(sorted.length / 2));
      const secondHalf = sorted.slice(Math.floor(sorted.length / 2));
      const avgFirst  = firstHalf.reduce((s, r) => s + (r.total_credits ?? 0), 0) / firstHalf.length;
      const avgSecond = secondHalf.reduce((s, r) => s + (r.total_credits ?? 0), 0) / secondHalf.length;
      if (avgFirst > 0 && avgSecond / avgFirst < 0.5) {
        bankTrendNote = `\n⚠ BANK CREDIT DECLINE ALERT: Average monthly credits fell from ₹${(avgFirst/1e5).toFixed(1)}L (first half) to ₹${(avgSecond/1e5).toFixed(1)}L (second half) — a ${(((avgFirst - avgSecond) / avgFirst) * 100).toFixed(0)}% decline. You MUST flag this in Section VIII.`;
      }
    }

    // ── Phase split ───────────────────────────────────────────────────────────
    // Phase 1: sections I–VI (client/financials). No DB save. Returns partial_sections.
    // Phase 2: sections VII–XII + risks + CPs + SWOT. Merges with prior_sections, saves.
    // Each phase targets ~2,500 tokens → ~40s at 60 tok/s → safe inside 115s.

    const PHASE1_IDS = ["executive_summary","client_promoter","investment_structure","rehbar_funding_history","historical_financial","projections"];
    const PHASE2_IDS = ["key_ratios","cash_flow","due_diligence","risk_assessment","visit_reference","exec_recommendation","product_specifics","triangulation_analysis"];

    const activeIds = (phase === 2) ? PHASE2_IDS : PHASE1_IDS;

    const SECTION_DESC: Record<string, string> = {
      executive_summary:     "Lead with company overview from MCA/Corpository profile (sector, incorporation date, registered address, about). Then: product/amount sought, reason for funds, key ratios snapshot (DSCR/CR/D:E/EBITDA%/ROE), collateral, strategic rationale, policy exceptions, 2–3 sentence assessment.",
      client_promoter:       "Legal name, CIN, PAN, constitution, incorporation date. Directors table (name/DIN/designation/shareholding%). Group companies. CIBIL per promoter (score, active/overdue accounts, 24M inquiries, DPD flag). Auditor and registered address if available in analyst notes.",
      investment_structure:  "End use validation, product SOP implications (OL: RERL-owned/GST/Proforma; FL: EMI split; PLS: profit-share), tenure, monthly amount, IRR, collateral, repayment justification.",
      rehbar_funding_history:"All prior Rehbar facilities (amount/product/IRR/repayment). If new client: state new relationship and credit references.",
      historical_financial:  "UI renders tables — observations only. 2–3 bullets: revenue trajectory, margin trends (gross/EBITDA/net), debt quality, working capital. Add 'Current Year (Provisional)' subsection if provisional data provided.",
      projections:           "UI renders table — observations only. Credibility per year: >100% = AGGRESSIVE; >1000% = NOT CREDIBLE. Projection waiver with SOP §XII basis if applicable.",
      key_ratios:            "UI renders table — observations only. 2–3 bullets: liquidity trend, leverage vs Rehbar thresholds, DSCR adequacy for proposed facility, R' Score interpretation.",
      cash_flow:             "Avg monthly credits vs proposed rental (coverage ratio), ABB adequacy, bounce signal, visible EMI lenders. Flag: >50% credit decline = REVENUE CONTRACTION; <40% banking vs GST = ROUTING RISK.",
      due_diligence:         "GST compliance: turnover vs P&L variance, late filings, ITC utilisation. Accumn: top customers/suppliers (name/%), circular transactions. Triangulation cross-check if available.",
      risk_assessment:       "Risk table: | Category | Risk | Observation | Mitigant | Severity |. Min 6 risks: business, financial, transaction. Severity: HIGH/MEDIUM/LOW.",
      visit_reference:       "Use the VISIT REPORT DATA block. Summarise: (1) site visit status + key observations; (2) reference check outcomes per type (Done/Pending/N/A) + any specific findings noted. Flag any Pending checks as pre-disbursement conditions. Use 'Not provided — analyst to confirm' for missing fields.",
      exec_recommendation:   "Executive Team's holistic recommendation for this deal. Summarise: company overview in 1 sentence, 3–4 key deal strengths (financial metrics, collateral quality, promoter credibility), any conditions or caveats, and the team's overall stance (supportive/conditional). Do NOT use the words 'Approve', 'Decline', or 'Defer'. Anchor every point in actual data from the case.",
      product_specifics:        "SOP rules for this product type — confirmed or excepted. Projection waiver with SOP §XII basis. Policy exceptions with justification.",
      triangulation_analysis:   "UI renders the full Accumn triangulation tables. Analyst observations only (no tables). Cover: (1) Profile verification — list any mismatches found (Name/DOB/Address) and their significance; (2) Financial cross-check — compare GST revenue vs ITR Revenue from Operations vs Banking Credits, flag divergence %; (3) Customer/supplier concentration — top 2 customers by % rev, any single-customer risk > 40%; (4) Circular/related-party transactions — count flagged, largest exposure, whether arms-length nature is confirmed; (5) Overall data quality — are the three sources consistent, any unexplained gaps. Flag: ROUTING RISK if banking credits < 30% of GST revenue.",
    };

    // ── RAG: past confirmed errors for this case + similar industry patterns ──
    let knownMistakesBlock = "";
    try {
      const smKey = Deno.env.get("SUPERMEMORY_API_KEY");

      // Track 1 — DB: confirmed errors on this specific case from previous runs
      const { data: caseErrors } = await supabase
        .from("ic_ai_errors")
        .select("section_id, error_type, title, detail, suggested_fix")
        .eq("case_id", case_id)
        .eq("analyst_verdict", "confirmed")
        .order("created_at", { ascending: false })
        .limit(10);

      const caseErrorLines = (caseErrors ?? []).map(
        (e: { section_id: string; error_type: string; title: string; detail: string; suggested_fix: string | null }) =>
          `[THIS CASE — ${e.section_id}] ${e.error_type.toUpperCase()}: ${e.title}. ${e.detail}` +
          (e.suggested_fix ? ` Fix: ${e.suggested_fix}` : "")
      );

      // Track 2 — Supermemory: case-specific memories (analyst notes from prior runs)
      const smCaseLines: string[] = [];
      if (smKey) {
        const caseRes = await fetch(
          `https://api.supermemory.ai/v3/search?q=${encodeURIComponent("IC errors " + cc.client_name)}&containerTags=${encodeURIComponent("case-" + case_id)}&limit=5`,
          { headers: { "Authorization": `Bearer ${smKey}` }, signal: AbortSignal.timeout(4_000) }
        ).catch(() => null);
        if (caseRes?.ok) {
          const j = await caseRes.json() as { results?: Array<{ content: string }> };
          smCaseLines.push(...(j.results ?? []).map(r => `[CASE MEMORY] ${r.content}`));
        }
      }

      // Track 3 — Supermemory: industry/product-type patterns across all cases
      const smIndustryLines: string[] = [];
      if (smKey) {
        const q = encodeURIComponent(`IC errors ${cc.industry ?? ""} ${cc.product_type ?? ""} credit analysis`);
        const indRes = await fetch(
          `https://api.supermemory.ai/v3/search?q=${q}&containerTags=rehbar-ic-errors&limit=8`,
          { headers: { "Authorization": `Bearer ${smKey}` }, signal: AbortSignal.timeout(4_000) }
        ).catch(() => null);
        if (indRes?.ok) {
          const j = await indRes.json() as { results?: Array<{ content: string }> };
          smIndustryLines.push(...(j.results ?? []).slice(0, 4).map(r => `[INDUSTRY PATTERN] ${r.content}`));
        }
      }

      const allLines = [...caseErrorLines, ...smCaseLines, ...smIndustryLines];
      if (allLines.length > 0) {
        knownMistakesBlock = `\n\nKNOWN ERRORS TO AVOID (confirmed by analyst from past generations of this and similar cases):\n` +
          allLines.map((l, i) => `${i + 1}. ${l}`).join("\n\n");
      }
    } catch { /* non-blocking — generation continues without memory context */ }

    const systemPrompt = `You are a Senior Credit Analyst at Rehbar Financial Services. Drafting an IC Credit Appraisal Note for experienced IC members.

ABOUT REHBAR:
Rehbar is a Sharia-compliant NBFC. OL: asset owned by RERL, rentals attract GST, Proforma D1-D2, NACH 10/15, e-invoice post-payment. FL: EMI = interest+principal, no GST. PLS: fixed EMI, profit-share monthly. PF/TF: inter-corporate loan. HL: LTV ≤ 60%, FOIR ≤ 50%.

PROJECTION RULES (SOP §XII): OL/FL — waive if deal < ₹100L or DSCR covers it (state waiver). PF/TF — not required. PLS/HL — required.

WRITING: STRICT TOKEN BUDGET — each section markdown ≤ 400 tokens. 2 bullets maximum per section. No paragraphs. Insights only — never repeat raw numbers. Missing data = "Not provided — analyst to confirm". No fabrication. No recommendation (APPROVE/DECLINE/DEFER). Sections V/VI/VII: UI renders tables, write observations only — no tables in markdown.${knownMistakesBlock}`;

    const userText = `Draft sections ${activeIds.map(id => id.replace(/_/g," ")).join(", ")} of the IC Appraisal Note.
${analyst_notes_for_ic ? `\nANALYST NOTES (highest priority — incorporate into every relevant section): ${analyst_notes_for_ic}\n` : ""}
${!analyst_notes_for_ic && safeCase.analyst_notes ? `\nANALYST NOTES (from case file — incorporate into every relevant section): ${safeCase.analyst_notes}\n` : ""}
━━━ CASE DATA ━━━
${JSON.stringify(safeCase, null, 2)}${buildRagBlock("executive_summary")}

━━━ MCA / COMPANY PROFILE ━━━
${companyContext || "No linked company profile."}${buildRagBlock("client_promoter")}

━━━ FINANCIAL REFERENCE (UI renders these tables — observations only) ━━━
[Financials] ${tables.sectionV || "No financial data."}${buildRagBlock("historical_financial")}
[Projections] ${tables.sectionVI || "No projections. State OL/FL waiver per SOP §XII if applicable."}${buildRagBlock("projections")}
${projBlock ? `[Projection Credibility] ${projBlock}` : ""}
[Ratios] ${tables.sectionVII || "No ratio data."}${buildRagBlock("key_ratios")}

━━━ PROVISIONAL DATA ━━━
${provisionalBlock || "None."}

━━━ BANK STATEMENT ━━━
${bankTable || "No bank statement. Flag as CP."}
${bankTrendNote}${buildRagBlock("cash_flow")}

━━━ GST RETURNS ━━━
${gstTable || "No GST data."}

━━━ ACCUMN REPORT ━━━
${accumnBlock || "No Accumn data."}${buildRagBlock("due_diligence")}

━━━ CIBIL / CRIF ━━━
${cibilBlock || "No CIBIL data."}

━━━ TRIANGULATION ━━━
${triBlock || "No triangulation data."}

━━━ VISIT REPORT DATA ━━━
${buildVisitReportSection(visitReport)}

━━━ PRODUCT CONTEXT ━━━${buildRagBlock("investment_structure")}${buildRagBlock("product_specifics")}${buildRagBlock("risk_assessment")}

Write insights, not data repetition. Use "Not provided — analyst to confirm" for missing fields.`;

    const sectionSchema = {
      type: "object",
      properties: Object.fromEntries(activeIds.map(id => [id, {
        type: "object",
        properties: { markdown: { type: "string", description: SECTION_DESC[id] ?? "2–3 analytical observations." } },
        required: ["markdown"],
        additionalProperties: false,
      }])),
      required: activeIds,
      additionalProperties: false,
    };

    // Phase 1: sections I–VI only
    if (phase !== 2) {
      const args = await callAI({
        systemPrompt,
        userText,
        toolName: "submit_ic_sections_phase1",
        toolDescription: "Submit IC note sections I–VI: executive summary, client profile, investment structure, Rehbar history, financials, projections.",
        toolSchema: { sections: sectionSchema },
        toolRequired: ["sections"],
        model: "claude-sonnet-4-6",
        maxTokens: 4000,   // 6 sections × ~500 tok avg = 3000 content + 1000 headroom; at 55 tok/s = 73s ✓
        retries: 0,
        timeoutMs: 110_000,
      });

      return new Response(JSON.stringify({ partial_sections: (args.sections as Record<string, unknown>) ?? {} }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Phase 2: sections VII–XII + risks + CPs + SWOT
    const args2 = await callAI({
      systemPrompt,
      userText,
      toolName: "submit_ic_sections_phase2",
      toolDescription: "Submit IC note sections VII–XII plus risk register, conditions precedent, and SWOT analysis.",
      toolSchema: {
        sections: sectionSchema,
        risks: {
          type: "array",
          description: "Risk register — 6–8 risks: business, financial, transaction categories. Severity: high/medium/low.",
          items: {
            type: "object",
            properties: {
              category: { type: "string", enum: ["business","industry","financial","transaction"] },
              risk:     { type: "string" },
              mitigant: { type: "string" },
              severity: { type: "string", enum: ["high","medium","low"] },
            },
            required: ["category","risk","mitigant","severity"],
            additionalProperties: false,
          },
        },
        conditions_precedent: {
          type: "array",
          description: "Conditions Precedent — 5–6 specific, actionable CPs for this deal.",
          items: { type: "string" },
        },
        swot: {
          type: "object",
          description: "SWOT — 3 items per quadrant, specific and data-driven.",
          properties: {
            strengths:     { type: "array", items: { type: "string" } },
            weaknesses:    { type: "array", items: { type: "string" } },
            opportunities: { type: "array", items: { type: "string" } },
            threats:       { type: "array", items: { type: "string" } },
          },
          required: ["strengths","weaknesses","opportunities","threats"],
          additionalProperties: false,
        },
      },
      toolRequired: ["sections","risks","conditions_precedent","swot"],
      model: "claude-sonnet-4-6",
      maxTokens: 4500,   // 6 sections ~3000 + risks/CPs/SWOT ~1000 + headroom 500; at 55 tok/s = 82s ✓
      retries: 0,
      timeoutMs: 110_000,
    });

    // Merge phase 1 sections (passed from frontend) with phase 2 sections
    const mergedSections = { ...(prior_sections ?? {}), ...(args2.sections as Record<string, unknown>) };
    // Spread existing ic_note first so provisional (and any other manually saved keys) survive regeneration
    const icNote = { ...icNoteJson, ...args2, sections: mergedSections, generated_at: new Date().toISOString(), draft: true };

    const { error: noteErr } = await supabase.from("credit_cases").update({ ic_note: icNote }).eq("id", case_id);
    if (noteErr) throw new Error(`IC note save failed: ${noteErr.message}`);

    await supabase.from("credit_cases").update({ status: "ic_review" as never }).eq("id", case_id).then(
      ({ error }) => { if (error) console.warn("Status update skipped:", error.message); }
    );

    return new Response(JSON.stringify({ ok: true, ic_note: icNote }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("generate-narrative error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
