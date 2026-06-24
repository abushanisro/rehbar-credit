/**
 * Rehbar — IC Note Generation
 * Generates a 12-section IC appraisal note draft using Claude Sonnet 4.6.
 * Sections V/VI/VII tables are pre-built server-side — AI adds bullet observations only.
 * Never includes a credit recommendation. PII excluded.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type SupabaseClientT = ReturnType<typeof createClient>;
import { callAI }       from "../_shared/ai-caller.ts";
import { getCorsHeaders, handleOptions } from "../_shared/cors.ts";

const SECTION_IDS = [
  "executive_summary","client_promoter","investment_structure","rehbar_funding_history",
  "historical_financial","projections","key_ratios","cash_flow","due_diligence",
  "risk_assessment","visit_reference","product_specifics",
];

const SECTION_QUERIES: Record<string, string> = {
  executive_summary:    "company overview industry revenue profit DSCR strategic rationale Rehbar rationale collateral security",
  client_promoter:      "legal constitution directors shareholders CIBIL score promoters DIN incorporation MCA company profile",
  investment_structure: "end use product lease EMI rental IRR collateral security deposit tenure finance structure",
  rehbar_funding_history: "prior funding history Rehbar facilities IRR repayment conduct existing loans credit history",
  historical_financial: "revenue turnover EBITDA PAT net worth total debt balance sheet P&L trends margin growth",
  projections:          "projected revenue EBITDA PAT growth assumptions DSCR coverage credibility order book",
  key_ratios:           "DSCR current ratio debt equity EBITDA margin ROE RONW working capital leverage R score",
  cash_flow:            "bank credits debits average balance bounce EMI outflows operating cash flow banking",
  due_diligence:        "GST compliance customer concentration circular transactions triangulation cross-check Accumn",
  risk_assessment:      "business risk financial risk transaction risk customer concentration leverage overdue",
  visit_reference:      "site visit reference check promoter banker vendor customer referral physical operations",
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

function buildTables(financials: FinRow[], ratios: RatioRow[]) {
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
    const plRows = ["Turnover","Gross Profit","EBITDA","PAT"].map(lb =>
      [lb, ...histYears.map(y => lv(fyMap.get(y)!, lb))]);
    sectionV  = `**P&L Summary (${ul})**\n${mdTable(["Item",...histYears.map(y=>`FY${y}`)], plRows)}\n\n`;
    const bsRows = ["Net Worth","Total Debt","Current Assets","Fixed Assets (Net)","Total Assets"].map(lb =>
      [lb, ...histYears.map(y => lv(fyMap.get(y)!, lb))]);
    sectionV += `**Balance Sheet (${ul})**\n${mdTable(["Item",...histYears.map(y=>`FY${y}`)], bsRows)}`;
  }

  // Section VI — Historical vs Projected
  let sectionVI = "";
  if (projYears.length > 0) {
    const pairs: [string, string][] = [
      ["Turnover",   "Projected Turnover"],
      ["EBITDA",     "Projected EBITDA"],
      ["PAT",        "Projected PAT"],
      ["Net Worth",  "Projected Net Worth"],
      ["Total Debt", "Projected Total Debt"],
    ];
    const actCols = histYears.slice(-2).map(y => ({ y, p: false }));
    const prjCols = projYears.map(y => ({ y, p: true }));
    const allCols = [...actCols, ...prjCols];
    const rows = pairs.map(([hl, pl]) => [
      hl,
      ...allCols.map(c =>
        c.p
          ? lvFirst(projMap.get(c.y) ?? [], ...(PROJ_ALIAS[pl] ?? [pl]))
          : lv(fyMap.get(c.y) ?? [], hl)
      ),
    ]);
    sectionVI = `**Historical vs Projected (${ul}) — A=Actual P=Projected**\n${mdTable(["Metric",...allCols.map(c=>`FY${c.y}${c.p?" (P)":" (A)"}`)], rows)}`;
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
      const status = ratios.filter(x => x.ratio_name === name)
        .sort((a,b) => b.fiscal_year - a.fiscal_year)[0]?.threshold_status ?? "na";
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
  const lines: string[] = ["**Perfios Triangulation Report (GST × BSA × ITR)**"];

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
  if (company?.mca_cin)               lines.push(`- CIN: ${company.mca_cin}`);
  if (company?.mca_pan)               lines.push(`- PAN: ${company.mca_pan}`);
  if (company?.mca_status)            lines.push(`- Status: ${company.mca_status}`);
  if (company?.mca_category)          lines.push(`- Category: ${company.mca_category}`);
  if (company?.mca_authorized_capital) lines.push(`- Authorised Capital: ₹${Number(company.mca_authorized_capital).toLocaleString("en-IN")}`);
  if (company?.mca_paid_up_capital)   lines.push(`- Paid-Up Capital: ₹${Number(company.mca_paid_up_capital).toLocaleString("en-IN")}`);
  if (company?.mca_sector)            lines.push(`- Sector: ${company.mca_sector}`);
  if (company?.mca_products_services) lines.push(`- Products / Services: ${company.mca_products_services}`);
  if (company?.mca_date_of_incorp)    lines.push(`- Date of Incorporation: ${company.mca_date_of_incorp}`);
  if (company?.mca_date_last_bs)      lines.push(`- Last Balance Sheet Filed: ${company.mca_date_last_bs}`);
  if (company?.mca_date_last_agm)     lines.push(`- Last AGM: ${company.mca_date_last_agm}`);
  if (company?.registered_address || company?.mca_email)
    lines.push(`- Contact: ${[company?.mca_email, company?.registered_address].filter(Boolean).join(" | ")}`);
  if (company?.mca_about) lines.push(`\n**Company Overview:**\n${company.mca_about.slice(0, 600)}`);
  if (cc["group_summary"]) lines.push(`\n**Group Summary:**\n${String(cc["group_summary"]).slice(0, 400)}`);
  if (cc["promoter_details"]) lines.push(`\n**Promoter Details:**\n${String(cc["promoter_details"]).slice(0, 300)}`);
  if (directors?.length) {
    lines.push("\n**Board of Directors / Partners:**");
    lines.push("| Name | Designation | DIN | Shareholding % | Appointed |");
    lines.push("|---|---|---|---|---|");
    for (const d of directors.slice(0, 8))
      lines.push(`| ${d.name} | ${d.designation ?? "—"} | ${d.din ?? "—"} | ${d.shareholding ?? "—"} | ${d.appointed_current ?? "—"} |`);
  }
  return lines.join("\n");
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
    const { case_id, analyst_notes_for_ic } = body as { case_id: string; analyst_notes_for_ic?: string };
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

    const tables     = buildTables((financials ?? []) as FinRow[], (ratios ?? []) as RatioRow[]);
    const bankTable  = buildBankSection((bankStatements ?? []) as BankRow[]).slice(0, 2_000);
    const gstTable   = buildGstSection((gstReturns ?? []) as GstRow[]).slice(0, 1_800);
    const accumnReport = (accumnRows as AccumnReportRow[] | null | undefined)?.[0]?.report_data ?? null;
    const accumnBlock  = buildAccumnSection(accumnReport).slice(0, 1_800);
    const cibilBlock   = buildCibilSection((cibilRows as CibilReportRow[] | null | undefined) ?? []);
    const triBlock     = buildTriangulationSection((triRows as TriangulationReportRow[] | null | undefined)?.[0]).slice(0, 1_400);
    const projBlock    = buildProjectionCredibility((financials ?? []) as FinRow[]);

    // Provisional data lives in ic_note.provisional on the case, not in extracted_financials
    const icNoteJson = (cc.ic_note ?? {}) as Record<string, unknown>;
    const provisionalPeriods = (icNoteJson["provisional"] ?? []) as ProvPeriod[];
    const provisionalBlock = buildProvisionalSection(provisionalPeriods).slice(0, 1_400);

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

    const args = await callAI({
      systemPrompt: `You are a Senior Credit Analyst at Rehbar Financial Services with 15+ years of NBFC credit appraisal experience. You are drafting a formal Investment Committee (IC) Credit Appraisal Note that will be presented to experienced IC members for a credit decision.

ABOUT REHBAR FINANCIAL SERVICES:
Rehbar is a Sharia-compliant NBFC. Its primary product is the Operating Lease (OL) where the asset is purchased and owned exclusively by RERL. Monthly OL rentals attract GST. Proforma invoices on Day 1–2; NACH mandates on 10th/15th; e-invoice post-payment.
- Finance Lease (FL): Structured as Term Loan. EMI split interest/principal. No GST on EMI.
- PLS (Profit & Loss Sharing): Fixed EMI; profit/interest split determined monthly from client P&L.
- Project Finance / Trade Finance: Structured as Inter-Corporate Loan.
- Home Loan: LTV ≤ 60%, FOIR ≤ 50%.

PROJECTION RULES (Rehbar SOP §XII):
- OL/FL: Projections NOT mandatory if cumulative deal < ₹100L OR if current-year DSCR covers proposed deal. State the waiver reason explicitly.
- PF/TF: Projections NOT required. PF: project working sheets + timelines mandatory. TF: repayment source justification mandatory.
- PLS/HL: Projections required.

WRITING STYLE — SENIOR ANALYST, CONCISE:
- BREVITY IS MANDATORY. Each section: exactly 2–3 analytical bullet points. Never write paragraphs. Never repeat data — write insights.
- Target 150–200 tokens per section. Risks: one row per risk, 8 risks max. CPs: one line each, 6 max. SWOT: 3 items per quadrant.
- If data is missing, write "Not provided — analyst to confirm". NEVER write <UNKNOWN>.
- NEVER fabricate numbers. ONLY use figures from data provided.
- NEVER include a credit recommendation (APPROVE / DECLINE / DEFER).
- Sections V, VI, VII: UI renders tables — write OBSERVATIONS ONLY, no tables in markdown.`,

      userText: `Draft the IC Appraisal Note for this case following the Rehbar SOP exactly.
${analyst_notes_for_ic ? `
━━━ ANALYST INSTRUCTIONS / FEEDBACK (HIGHEST PRIORITY — incorporate these directly into the note) ━━━
${analyst_notes_for_ic}
━━━ END ANALYST INSTRUCTIONS ━━━
` : ""}
━━━ DEAL & CLIENT DATA ━━━
${JSON.stringify(safeCase, null, 2)}${buildRagBlock("executive_summary")}

━━━ MCA / COMPANY PROFILE & DIRECTORS ━━━
${companyContext || "No linked company profile. Use case data above."}${buildRagBlock("client_promoter")}

━━━ FINANCIAL DATA FOR REFERENCE — DO NOT REPRODUCE TABLES IN MARKDOWN ━━━
The tables below are already rendered by the UI. Use the numbers to write observations only.

[SECTION V REFERENCE — Historical Financials]
${tables.sectionV || "No historical financial data extracted yet."}${buildRagBlock("historical_financial")}

[SECTION VI REFERENCE — Projections]
${tables.sectionVI || "No projection data. If product is OL/FL and deal < ₹100L or DSCR covers the deal, state waiver per SOP §XII explicitly."}${buildRagBlock("projections")}

${projBlock ? `━━━ PROJECTION CREDIBILITY ANALYSIS (MANDATORY — incorporate into Section VI observations) ━━━
${projBlock}
` : ""}
[SECTION VII REFERENCE — Key Ratios]
${tables.sectionVII || "No ratio data computed yet."}${buildRagBlock("key_ratios")}

━━━ PROVISIONAL / MIS FINANCIAL DATA — MOST RECENT UNAUDITED PERIOD (Section V supplementary) ━━━
${provisionalBlock || "No provisional financial data uploaded."}

━━━ BANK STATEMENT DATA (Section VIII) ━━━
${bankTable || "No bank statement data submitted. Note this in Section VIII and flag as a CP."}
${bankTrendNote}${buildRagBlock("cash_flow")}

━━━ GST RETURN DATA (Section IX) ━━━
${gstTable || "No GST return data available."}

━━━ ACCUMN GST ANALYTICAL REPORT (Section IX) ━━━
${accumnBlock || "No Accumn report available."}

━━━ CIBIL / CRIF REPORTS — ALL PROMOTERS (Section II & X) ━━━
${cibilBlock || "No CIBIL data available."}

━━━ PERFIOS TRIANGULATION REPORT (Section IX) ━━━
${triBlock || "No triangulation report available."}${buildRagBlock("due_diligence")}

━━━ INVESTMENT STRUCTURE & PRODUCT CONTEXT ━━━${buildRagBlock("investment_structure")}${buildRagBlock("product_specifics")}${buildRagBlock("risk_assessment")}

Write observations that demonstrate genuine credit analyst insight — not just data repetition. Flag all risks prominently. Use "Not provided — analyst to confirm" for missing fields. NEVER write <UNKNOWN>.`,
      toolName: "submit_ic_note",
      toolDescription: "Submit the complete IC Credit Appraisal Note. Each section must contain detailed analytical observations per Rehbar SOP. For sections V, VI, and VII the data tables are rendered by the UI — write only analytical observations in markdown (bullet points and prose, no tables). All other sections: full narrative with tables where needed.",
      toolSchema: {
        sections: {
          type: "object",
          properties: Object.fromEntries(SECTION_IDS.map(id => [id, {
            type: "object",
            properties: {
              markdown: {
                type: "string",
                description:
                  id === "executive_summary"      ? "Company overview, product/amount sought, reason for funds, key ratios snapshot (DSCR/CR/D:E/EBITDA%/ROE), collateral, strategic rationale (Sharia/multi-lender/last-resort), policy exceptions, 2–3 sentence analyst assessment." :
                  id === "client_promoter"         ? "Legal name, constitution, directors table (DIN/designation/shareholding from MCA), group companies, CRIF/CIBIL for EACH promoter (score/rank, active/overdue accounts, 24M inquiries, DPD flag), promoter background." :
                  id === "investment_structure"    ? "End use with validation, product SOP implications (OL: RERL-owned/GST on rentals/Proforma D1-D2/NACH; FL: EMI split; PLS: profit-share), tenure, monthly amount, IRR, collateral, repayment justification." :
                  id === "rehbar_funding_history"  ? "All prior Rehbar facilities (amount/product/expected IRR/actual IRR/repayment conduct). If new client: state new relationship and any credit references." :
                  id === "historical_financial"    ? "UI renders the tables — observations only. 4–6 bullets: revenue trajectory, margin trends (gross/EBITDA/net), debt quality (LT vs ST), working capital, capex intensity, balance sheet restructuring. Add 'Current Year (Provisional)' subsection if provisional data provided." :
                  id === "projections"             ? "UI renders the table — observations only. Credibility per year: >100% growth = AGGRESSIVE/JUSTIFICATION NEEDED; >1000% = NOT CREDIBLE. Conservative/moderate/aggressive classification. Projection waiver with SOP basis if applicable. DSCR coverage commentary." :
                  id === "key_ratios"              ? "UI renders the table — observations only. 4–6 bullets: liquidity trend, leverage vs Rehbar thresholds, efficiency ratios (debtor/creditor days, inventory), profitability sustainability, DSCR adequacy for proposed facility, R' Score interpretation." :
                  id === "cash_flow"               ? "Avg monthly credits vs proposed rental (coverage ratio), ABB adequacy for entity scale, bounce count and liquidity signal, visible EMI lenders from debit data. Flag: credits fell >50% first-to-second-half = CRITICAL REVENUE CONTRACTION; banking credits <40% of GST revenue = ROUTING RISK." :
                  id === "due_diligence"           ? "GST compliance: turnover vs P&L variance, late/not-filed pattern, ITC utilisation. Accumn: top 5 customers (name/%), top 5 suppliers, circular transactions with amounts. Triangulation: GST vs ITR vs banking cross-check, profile mismatches. Any other DD findings." :
                  id === "risk_assessment"         ? "Risk table | Category | Risk | Observation | Mitigant | Severity |. Min 8 risks covering business (concentration/entity age), financial (liquidity/leverage/R-score), transaction (circular/mismatches/missing docs), industry/macro. Severity: HIGH/MEDIUM/LOW." :
                  id === "visit_reference"         ? "Site visit: location, facilities, operations, headcount. Reference checks: banker/vendor/customer inputs. Executive team observations. Use 'Not provided — analyst to confirm' for any missing field." :
                  id === "product_specifics"       ? "All SOP rules for this product type (OL/FL/PLS/PF/TF/HL) — confirmed or excepted. Projection waiver with SOP §XII basis. Policy exceptions with justification. Product-specific compliance notes." :
                  "3–5 analytical observations per Rehbar SOP. Use 'Not provided — analyst to confirm' for missing data. Never write <UNKNOWN>.",
              },
            },
            required: ["markdown"],
            additionalProperties: false,
          }])),
          required: SECTION_IDS,
          additionalProperties: false,
        },
        risks: {
          type: "array",
          description: "Risk register — minimum 8 risks covering business, financial, transaction, and industry categories",
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
          description: "Conditions Precedent — minimum 5. Each should be a specific, actionable CP relevant to this deal (documentation, compliance, security creation, insurance, etc.).",
          items: { type: "string" },
        },
        swot: {
          type: "object",
          description: "SWOT analysis — 4–6 items per quadrant. Each item should be specific and data-driven (not generic).",
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
      maxTokens: 3500,
      retries: 0,        // no retry — each attempt can take 60–90s; 2× would exceed Supabase's 150s wall-clock limit
      timeoutMs: 110_000, // 3500 tok ÷ 40 tok/s (worst case) = 87.5s + 15s overhead = 102.5s; fits under 110s
    });

    const icNote = { ...args, generated_at: new Date().toISOString(), draft: true };

    // Save ic_note first — this is what matters
    const { error: noteErr } = await supabase.from("credit_cases").update({ ic_note: icNote }).eq("id", case_id);
    if (noteErr) throw new Error(`IC note save failed: ${noteErr.message}`);

    // Update status separately — ignore failure (status column has an enum trigger incompatible with REST)
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
