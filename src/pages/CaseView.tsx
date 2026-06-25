import { useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { RoomProvider } from "@/liveblocks.config";
import { CollabAvatarStack, TabPresenceDots, LiveCursors } from "@/components/collab/CollabPresence";
import { useMyPresence } from "@/components/collab/useMyPresence";
import { ShareDialog } from "@/components/collab/ShareDialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { TerminalLayout } from "@/components/terminal/TerminalLayout";
import { Panel } from "@/components/terminal/Panel";
import {
  PRODUCTS, CASE_STATUS_META, IC_SECTIONS, RATIO_DISPLAY_NAMES, STANDARD_LINE_ITEMS,
  formatRatio, AI_DRAFT_BANNER, type StatementType, type DocClass, type ProductType,
} from "@/features/credit/domain";

const CASE_INDUSTRIES = [
  "Agriculture & Food Processing","Automotive","Chemicals & Petrochemicals",
  "Construction & Infrastructure","Education","Energy & Utilities","EV Logistics & Transportation",
  "Financial Services","Healthcare & Pharmaceuticals","Hospitality & Tourism","IT & Technology",
  "Logistics & Transportation","Manufacturing","Media & Entertainment","Real Estate",
  "Retail & E-commerce","Telecom","Textile & Apparel","Trading","Other",
] as const;
import {
  ComposedChart, Bar, Line, LineChart, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, ReferenceLine, Legend, LabelList,
} from "recharts";
import type { Tables, Json } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { extractPdfText } from "@/lib/pdf-text-extractor";
import { parseAccumnExcel, mapToIndustry as _mapEditIndustry, mapToConstitution as _mapEditConstitution, type McaProfile as EditMcaProfile } from "@/lib/mca-parser";
import { ProjectionsTab } from "@/tabs/case/ProjectionsTab";
import { PartnerAnalysisTab } from "@/tabs/case/PartnerAnalysisTab";
import type { PartnerEntry } from "@/tabs/case/PartnerAnalysisTab";
import { ProvisionalTab } from "@/tabs/case/ProvisionalTab";
import type { ProvPeriod } from "@/tabs/case/ProvisionalTab";
import { AccumnBsaPanel } from "@/components/case/AccumnBsaPanel";
import { AccumnApiPanel } from "@/components/case/AccumnApiPanel";
import { CibilTab, type CibilReportRow } from "@/tabs/case/CibilTab";
import { DerivedCashFlowPanel } from "@/components/case/DerivedCashFlowPanel";
import { buildDerivedCashFlowSeries } from "@/features/case/derivedCashFlow";
import { runArticulationChecks, CHECK_RESULT_ROW } from "@/features/case/articulationChecks";
import type { ArticulationCheck } from "@/features/case/articulationChecks";
import { parseAccumnGstExcel } from "@/lib/gst-accumn-excel-parser";
import { parseBsaExcel, isBsaExcel, type BsaParseResult } from "@/lib/bsa-excel-parser";
import { UploadGrid as CompactUploadGrid } from "@/components/case/UploadGrid";
import { ICNoteDocument } from "@/tabs/case/ic/ICNoteDocument";
import type { IcNoteShape } from "@/tabs/case/ic/ICNoteDocument";
import { annotationsToSvgString } from "@/tabs/case/ic/ICAnnotationLayer";
import { buildIcNoteHtml as buildIcNoteHtmlFull, buildIcNotePrintCss } from "@/tabs/case/ic/buildIcNoteHtml";
import { TriangulationTab } from "@/tabs/case/TriangulationTab";
import { VisitReportTab } from "@/tabs/case/VisitReportTab";
import type { TriangulationData } from "@/lib/triangulation-excel-parser";

type CaseRow = Tables<"credit_cases">;
type DocRow = Tables<"financial_documents">;
type ExtractedRow = Tables<"extracted_financials">;
type RatioRow = Tables<"financial_ratios">;
interface BsaReportRow { id: string; case_id: string; document_id: string | null; report_data: BsaParseResult; company_name: string | null; period_covered: string | null; abb: number | null; created_at: string }

interface RatioRiskFactor { severity: "HIGH" | "MEDIUM" | "LOW"; category: string; description: string }
interface RatioAnalysisResult {
  profitability_insight: string;
  liquidity_insight: string;
  solvency_insight: string;
  efficiency_insight: string;
  expense_insight: string;
  r_score_insight: string;
  risk_factors: RatioRiskFactor[];
  positive_factors: string[];
  data_accuracy_notes: string[];
  overall_observation: string;
}
interface RatioAnalysisUsage {
  input_tokens: number;
  output_tokens: number;
  max_tokens: number;
  model: string;
}

interface LineItem {
  label: string; value: number | null; confidence: number;
  reviewed: boolean; override_value?: number | null; note?: string;
  is_section?: boolean; indent?: number; sort_order?: number;
  locked?: boolean; // user directly edited this derived field — formula skipped, value cascades downstream
}

// ── Accumn GST Analytical Report types ────────────────────────────────────────
interface AccumnFlag { flag_name: string; severity: "HIGH" | "MEDIUM" | "LOW"; description: string }
interface AccumnSalesSummary { period: string; adjusted_revenue?: number|null; net_revenue?: number|null; sales_return_pct?: number|null; advance_pct?: number|null; gross_margin_pct?: number|null; ebitda_pct?: number|null; pat_pct?: number|null }
interface AccumnConcentration { period: string; rank: number; name: string; gstin?: string; amount: number; pct: number }
interface AccumnGeography { period: string; state: string; amount: number; pct: number }
interface AccumnProduct { period: string; chapter?: string; hsn?: string; description: string; amount: number; pct: number }
interface AccumnTaxDetail { period: string; wc_investment?: number|null; output_tax?: number|null; igst?: number|null; cgst?: number|null; sgst?: number|null; itc_availed?: number|null; net_tax?: number|null }
interface AccumnGstrRow { period: string; gstr1_turnover?: number|null; gstr3b_turnover?: number|null; gstr9_turnover?: number|null; gstr1_tax?: number|null; gstr3b_tax?: number|null; difference?: number|null }
interface AccumnCircular { entity: string; gstin?: string; sale_amount?: number|null; purchase_amount?: number|null; note?: string }
interface AccumnCategoryRow { period: string; b2b?: number|null; b2c_small?: number|null; b2c_large?: number|null; export?: number|null; nil_rated?: number|null; total?: number|null }
interface AccumnReport {
  is_accumn: boolean;
  flags?: AccumnFlag[];
  company_profile?: { name?: string; gstin?: string; pan?: string; constitution?: string; state?: string; business_type?: string; registration_date?: string; report_date?: string };
  sales_summary?: AccumnSalesSummary[];
  customer_categories?: AccumnCategoryRow[];
  geography?: AccumnGeography[];
  customer_concentration?: AccumnConcentration[];
  supplier_concentration?: AccumnConcentration[];
  product_concentration?: AccumnProduct[];
  tax_details?: AccumnTaxDetail[];
  gstr_comparison?: AccumnGstrRow[];
  circular_transactions?: AccumnCircular[];
}

const STATEMENT_TYPES: StatementType[] = ["all_in_one", "profit_loss", "balance_sheet", "cash_flow", "projections"];

type QueueStatus = "pending" | "processing" | "done" | "error" | "duplicate";
type UploadQueueItem = {
  id: string; file: File; name: string; size: string;
  status: QueueStatus;
};
type FinQueueItem = UploadQueueItem & { stmtType: DocClass; fy: string };

type EditScanResult = {
  client_name?: string;
  product_type?: ProductType;
  product_type_custom?: string;
  legal_constitution?: string;
  industry?: string;
  year_established?: number;
  promoter_details?: string;
  deal_amount?: number;
  tenure_months?: number;
  expected_irr?: number;
  end_use?: string;
  collateral_summary?: string;
  strategic_rationale?: string;
  website?: string;
  summary?: string;
  confidence?: number;
};

type EditFileQueueItem = {
  id: string;
  name: string;
  size: string;
  fileType: "pdf" | "image" | "excel";
  status: "pending" | "uploading" | "done" | "error" | "duplicate";
  uploadPct: number;
  storagePath?: string;
};

const EDIT_SCANNABLE_FIELDS: { key: keyof EditScanResult; label: string }[] = [
  { key: "client_name",         label: "Client Name" },
  { key: "product_type",        label: "Product Type" },
  { key: "legal_constitution",  label: "Legal Constitution" },
  { key: "industry",            label: "Industry" },
  { key: "year_established",    label: "Year Established" },
  { key: "deal_amount",         label: "Deal Amount (Cr)" },
  { key: "tenure_months",       label: "Tenure (months)" },
  { key: "expected_irr",        label: "Expected IRR (%)" },
  { key: "promoter_details",    label: "Promoter Details" },
  { key: "end_use",             label: "End Use" },
  { key: "collateral_summary",  label: "Collateral" },
  { key: "strategic_rationale", label: "Strategic Rationale" },
  { key: "website",             label: "Website" },
];

// ── Financial auto-computation rules ──────────────────────────────────────────
// Each rule: [target, addComponents[], subtractComponents[]]
// Order matters — upstream totals must be computed before downstream ones.
// Covers both the simple AI-extraction labels AND the full Accumn Excel labels.

type Rule = [string, string[], string[]?];

const RULES: Record<string, Rule[]> = {
  balance_sheet: [
    // ── Simple / AI-extracted format ──
    ["Current Assets",      ["Inventory","Trade Receivables","Cash & Bank","Other Current Assets"]],
    ["Total Assets",        ["Fixed Assets (Net)","Current Assets"]],
    ["Net Worth",           ["Share Capital","Reserves & Surplus"]],
    ["Total Debt",          ["Long Term Borrowings","Short Term Borrowings"]],
    ["Current Liabilities", ["Trade Payables","Other Current Liabilities"]],
    ["Total Liabilities",   ["Net Worth","Total Debt","Current Liabilities"]],
    ["Capital Employed",    ["Net Worth","Total Debt"]],

    // ── Full Accumn / Corpository Excel format ──
    // Liabilities side (dependencies first)
    ["Networth",                   ["Share Capital","Reserves & Surplus","Money Received against Warrants","Share Application Money Pending Allotment","Deffered Government Grants","Minority Interest"]],
    ["Total Non Current Liabilities", ["Long-term Borrowings","Deferred Tax Liabilities","Other Non Current Liabilities","Long-term Provisions"]],
    ["Total Current Liabilities",  ["Total Short-term Borrowings","Trade Payables","Other Current Liabilities","Short-term Provisions"]],
    ["Total Equity & Liabilities", ["Networth","Total Non Current Liabilities","Total Current Liabilities","Other Equity & Liabilities"]],

    // Asset side
    ["Net Block of Assets",        ["Tangible Assets","Intangible Assets"]],
    ["Total Fixed Asset",          ["Net Block of Assets","Capital Work in Progress","Intangible Asset under Development"]],
    ["Total Non Current Assets",   ["Total Fixed Asset","Non Current Investment","Deferred Tax Assets (Net)","Long-term Loans & Advances","Other Non Current Assets"]],
    ["Total Current Assets",       ["Current Investment","Inventories","Trade Receivables","Cash & Cash Equivalents","Short-term Loans & Advances","Other Current Assets"]],
    ["TOTAL ASSETS",               ["Total Non Current Assets","Total Current Assets","Other Total Assets"]],

    // ── Canonical labels for ratio engine ──
    ["Net Worth",           ["Networth"]],
    ["Current Assets",      ["Total Current Assets"]],
    ["Current Liabilities", ["Total Current Liabilities"]],
    ["Fixed Assets (Net)",  ["Total Fixed Asset"]],
    ["Total Assets",        ["TOTAL ASSETS"]],
    ["Long Term Borrowings",["Long-term Borrowings"]],
    ["Short Term Borrowings",["Total Short-term Borrowings"]],
    ["Inventory",           ["Inventories"]],
    ["Cash & Bank",         ["Cash & Cash Equivalents"]],
    ["Total Debt",          ["Long Term Borrowings","Short Term Borrowings"]],
    ["Capital Employed",    ["Net Worth","Total Debt"]],
    ["Total Liabilities",   ["Net Worth","Total Debt","Current Liabilities"]],
  ],

  profit_loss: [
    // Revenue build-up
    ["Gross Sales",                   ["Revenue from Sale of Products","Revenue from Sale of Services","Other Operating Revenues"]],
    ["Total Revenue from Operations", ["Gross Sales"], ["Less:Duties"]],
    ["Total Revenue",                 ["Total Revenue from Operations","Other Income"]],
    // Canonical "Turnover" for ratio engine
    ["Turnover",                      ["Total Revenue from Operations"]],

    // EBITDA = Revenue from Ops - operating costs
    ["EBITDA", ["Total Revenue from Operations"],
               ["Cost of Materials Consumed","Purchases of Stock in Trade",
                "Changes in Inventories of Finished Goods, Work In Progress and Stock In Trade",
                "Total Employee Benefit Expense","Total Other Expenses"]],

    // Total Expenses (all costs incl finance & depreciation)
    ["Total Expenses", ["Cost of Materials Consumed","Purchases of Stock in Trade",
                        "Changes in Inventories of Finished Goods, Work In Progress and Stock In Trade",
                        "Total Employee Benefit Expense","Total Other Expenses",
                        "Finance Costs","Total Depreciation, Depletion and Amortization Expense"]],

    // Profit cascade
    ["Profit before Exceptional and Extraordinary Items and Tax", ["Total Revenue"], ["Total Expenses"]],
    ["Profit before Extraordinary Items and Tax",
      ["Profit before Exceptional and Extraordinary Items and Tax","Prior Period Items before Tax","Exceptional Items"]],
    ["Profit before Tax",
      ["Profit before Extraordinary Items and Tax","Extraordinary Items"]],
    ["Profit/(Loss) for the Period from Continuing Operations",
      ["Profit before Tax"], ["Current Tax","Deferred Tax",
       "Net Movement in Regulatory Deferral Account Balances related to Profit or Loss and the Related Deferred Tax Movement"]],
    ["Profit/(Loss)",
      ["Profit/(Loss) for the Period from Continuing Operations",
       "Profit/(Loss) from Discontinuing Operations (After Tax)"]],
    // Canonical labels for ratio engine
    ["PAT",               ["Profit/(Loss)"]],
    ["Interest Expense",  ["Finance Costs"]],
    ["Depreciation",      ["Total Depreciation, Depletion and Amortization Expense"]],
    ["Employee Benefit Expense", ["Total Employee Benefit Expense"]],
    ["Other Expenses",    ["Total Other Expenses"]],
    // EBIT = PBT + Interest
    ["EBIT",              ["Profit before Tax","Finance Costs"]],
    ["Gross Profit",      ["Total Revenue from Operations"],
                          ["Cost of Materials Consumed","Purchases of Stock in Trade",
                           "Changes in Inventories of Finished Goods, Work In Progress and Stock In Trade"]],
  ],

  cash_flow: [
    // Net increase in cash = operating + investing + financing
    ["Net increase (decrease) in cash and cash equivalents before effect of exchange rate changes",
      ["Net cash flows from (used in) operating activities",
       "Net cash flows from (used in) investing activities",
       "Net cash flows from (used in) financing activities"]],
    ["Net increase (decrease) in cash and cash equivalents",
      ["Net increase (decrease) in cash and cash equivalents before effect of exchange rate changes",
       "Effect of exchange rate changes on cash and cash equivalents"]],
    // Closing balance
    ["Cash and cash equivalents cash flow statement at end of period",
      ["Cash and cash equivalents cash flow statement at beginning of period",
       "Net increase (decrease) in cash and cash equivalents"]],
  ],
};

// All computed/total labels across all statement types
const COMPUTED_LABELS = new Set(
  Object.values(RULES).flat().map(([label]) => label)
);
// Simple P&L cascade targets not present in RULES (caps variant used by AI extraction)
COMPUTED_LABELS.add("Gross Profit");
COMPUTED_LABELS.add("Profit Before Tax");
COMPUTED_LABELS.add("PAT");

// Grand-total rows — strongest visual emphasis
const GRAND_TOTAL_LABELS = new Set([
  "TOTAL ASSETS","Total Assets","Total Equity & Liabilities","Total Liabilities",
  "Profit/(Loss)","Profit before Tax","Total Revenue","EBITDA",
  "Net increase (decrease) in cash and cash equivalents",
  "Net increase (decrease) in cash and cash equivalents before effect of exchange rate changes",
  "Cash and cash equivalents cash flow statement at end of period",
]);

// Section header name → the key total row that represents its value
const SECTION_TOTAL_MAP: Record<string, string> = {
  "SHAREHOLDERS FUND":              "Networth",
  "NON CURRENT LIABILITIES":        "Total Non Current Liabilities",
  "CURRENT LIABILITIES":            "Total Current Liabilities",
  "FIXED ASSET":                    "Total Fixed Asset",
  "NON CURRENT ASSETS":             "Total Non Current Assets",
  "CURRENT ASSETS":                 "Total Current Assets",
  "REVENUE":                        "Total Revenue",
  "EXPENSES":                       "Total Expenses",
  "TAX EXPENSE":                    "Profit/(Loss) for the Period from Continuing Operations",
  "Cash flows from used in operating activities":  "Net cash flows from (used in) operating activities",
  "Cash flows from used in investing activities":  "Net cash flows from (used in) investing activities",
  "Cash flows from used in financing activities":  "Net cash flows from (used in) financing activities",
};

// Aggregate label → bold row highlight (kept for backward compat)
const BS_TOTAL_LABELS = new Set(COMPUTED_LABELS);

function applyStatementRules(items: LineItem[], stmtType: string): LineItem[] {
  const rules = RULES[stmtType];
  if (!rules) return items;

  const result = items.map(i => ({ ...i }));

  const get = (label: string): number => {
    const it = result.find(i => i.label === label);
    return it != null ? (it.override_value ?? it.value ?? 0) : 0;
  };

  for (const [target, addCols, subCols = []] of rules) {
    // Skip user-locked fields — user directly edited this derived field; formula suspended
    const targetItem = result.find(i => i.label === target);
    if (targetItem?.locked) continue;

    // Skip if no component has data yet (avoids zeroing out rows with no data)
    const allCols = [...addCols, ...subCols];
    const hasData = allCols.some(c => result.some(i => i.label === c && (i.override_value ?? i.value) != null));
    if (!hasData) continue;

    const sum = addCols.reduce((acc, c) => acc + get(c), 0)
              - subCols.reduce((acc, c) => acc + get(c), 0);

    const idx = result.findIndex(i => i.label === target);
    if (idx === -1) {
      result.push({ label: target, value: parseFloat(sum.toFixed(2)), override_value: null, confidence: 100, reviewed: true, note: "auto-derived" });
    } else {
      result[idx] = { ...result[idx], override_value: parseFloat(sum.toFixed(2)) };
    }
  }

  // ── Simple P&L cascade (AI-extracted format: Turnover → Gross Profit → … → PAT) ──
  // Guarded by "Cost of Goods Sold" — only exists in simple AI-extracted format,
  // not in the detailed Accumn/Corpository format. Respects user locks at each step:
  // if a field is locked (user directly edited it), its value is used as input for
  // the next step but not overwritten — so cascade continues from wherever the user
  // broke the chain.
  if (stmtType === "profit_loss") {
    const hasAnyCOGS = result.some(
      i => (i.label === "Cost of Goods Sold" || i.label === "Cost of Sales" || i.label === "Cost of Goods") &&
           (i.override_value ?? i.value) != null
    );
    if (hasAnyCOGS) {
      const cogsLabel = ["Cost of Goods Sold","Cost of Sales","Cost of Goods"]
        .find(l => result.some(i => i.label === l && (i.override_value ?? i.value) != null))!;

      const setDerived = (label: string, value: number) => {
        const i = result.findIndex(r => r.label === label);
        if (i !== -1 && result[i].locked) return; // User pinned this field — skip formula, value already feeds next step via get()
        const rounded = parseFloat(value.toFixed(2));
        if (i === -1) result.push({ label, value: rounded, override_value: null, confidence: 100, reviewed: true, note: "auto-derived" });
        else result[i] = { ...result[i], override_value: rounded };
      };

      // Bottom-up cascade — each get() reads the current result (including locked overrides)
      setDerived("Gross Profit",      get("Turnover") - get(cogsLabel));
      setDerived("EBITDA",            get("Gross Profit") - get("Operating Expenses"));
      setDerived("EBIT",              get("EBITDA") - get("Depreciation"));
      setDerived("Profit Before Tax", get("EBIT")   - get("Interest Expense"));
      setDerived("PAT",               get("Profit Before Tax") - get("Tax"));
    }
  }

  return result;
}

// ── Poll financial_documents.extraction_status until done or failed ───────────
async function pollExtractionStatus(docId: string, signal: AbortSignal): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (signal.aborted) throw new Error("cancelled");
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 2000);
      signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("cancelled")); }, { once: true });
    });
    const { data } = await supabase
      .from("financial_documents")
      .select("extraction_status, extraction_error")
      .eq("id", docId)
      .single();
    if (data?.extraction_status === "extracted") return;
    if (data?.extraction_status === "failed")
      throw new Error(data.extraction_error ?? "Extraction failed");
  }
  throw new Error("Analysis timed out — check Supabase Edge Function logs");
}

// ── Convert provisional extracted_financials rows → ic_note.provisional ──────
async function convertExtractedToProvisional(caseId: string, documentId: string): Promise<void> {
  const { data: rows } = await supabase.from("extracted_financials")
    .select("id, statement_type, fiscal_year, line_items, unit")
    .eq("document_id", documentId);

  if (!rows?.length) return;

  type ProvData = { pl: LineItem[]; bs: LineItem[]; cf: LineItem[]; unit: string };
  const fyMap: Record<number, ProvData> = {};

  for (const row of rows) {
    const fy = row.fiscal_year as number;
    if (!fyMap[fy]) fyMap[fy] = { pl: [], bs: [], cf: [], unit: (row.unit as string | null) ?? "Lakhs" };
    const items = (row.line_items as unknown as LineItem[]).filter((i: LineItem) => i.label !== "__provisional");
    if (row.statement_type === "profit_loss")        fyMap[fy].pl = items;
    else if (row.statement_type === "balance_sheet") fyMap[fy].bs = items;
    else if (row.statement_type === "cash_flow")     fyMap[fy].cf = items;
  }

  const { data: freshCase } = await supabase.from("credit_cases")
    .select("ic_note").eq("id", caseId).single();
  const icNote = (freshCase?.ic_note ?? {}) as Record<string, unknown>;
  const existing = (icNote.provisional ?? []) as ProvPeriod[];
  const periodMap = new Map(existing.map(p => [p.label, { ...p }]));

  for (const [fyStr, data] of Object.entries(fyMap)) {
    const fy = Number(fyStr);
    const label = `FY${fy}`;
    periodMap.set(label, {
      id: periodMap.get(label)?.id ?? crypto.randomUUID(),
      label, period_type: "annual" as const,
      fiscal_year: fy, months_covered: 12, unit: data.unit,
      pl: data.pl, bs: data.bs, cf: data.cf,
    });
  }

  await supabase.from("credit_cases").update({
    ic_note: { ...icNote, provisional: Array.from(periodMap.values()) } as unknown as Json,
  }).eq("id", caseId);

  // Remove from main financial review — provisional data lives in the Provisional tab
  await supabase.from("extracted_financials").delete().eq("document_id", documentId);
}

// ── Wrapper: provides the Liveblocks room scoped to this case ─────────────────
const FINANCIAL_CLASSES_SET = new Set(["all_in_one", "profit_loss", "balance_sheet", "cash_flow", "projections", "provisional"]);
const FINANCIAL_CLASSES: DocClass[] = ["all_in_one", "profit_loss", "balance_sheet", "cash_flow", "projections", "provisional"];

export default function CaseView() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return (
    <RoomProvider id={`case-${id}`} initialPresence={{ name: "", email: "", color: "#E8721C", activeTab: "review", editingField: null, cursor: null }}>
      <CaseViewInner />
    </RoomProvider>
  );
}

function CaseViewInner() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTabRaw] = useState<"review" | "provisional" | "ratios" | "projections" | "ic_note" | "bank" | "gst" | "cibil" | "triangulation" | "visit_report" | "partner">("review");
  const [entity, setEntity] = useState<"main" | "partner">("main");
  const [partnerSubTab, setPartnerSubTab] = useState<"review" | "ratios" | "bank" | "gst">("review");
  const { setEditing } = useMyPresence(user?.user_metadata?.full_name ?? user?.email ?? "Analyst", user?.email ?? "", tab);
  const setTab = (t: typeof tab) => { setTabRaw(t); window.scrollTo({ top: 0 }); };
  const [cc, setCc] = useState<CaseRow | null>(null);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [extracted, setExtracted] = useState<ExtractedRow[]>([]);
  const [ratios, setRatios] = useState<RatioRow[]>([]);
  const [ratioAnalysis, setRatioAnalysis] = useState<RatioAnalysisResult | null>(null);
  const [ratioAnalysisUsage, setRatioAnalysisUsage] = useState<RatioAnalysisUsage | null>(null);
  const [ratioAnalysisLoading, setRatioAnalysisLoading] = useState(false);
  const [ratioAiProgress, setRatioAiProgress] = useState(0);
  const [ratioAiLabel, setRatioAiLabel] = useState("");
  const [bankData, setBankData]             = useState<Tables<"bank_statement_data">[]>([]);
  const [bsaData, setBsaData]               = useState<BsaReportRow | null>(null);
  const [triangulationData, setTriangulationData] = useState<{ id: string; case_id: string; report_data: TriangulationData; period_covered: string | null; created_at: string } | null>(null);
  const [gstData, setGstData]               = useState<Tables<"gst_return_data">[]>([]);
  const [cibilData, setCibilData]           = useState<CibilReportRow[]>([]);
  const [accumnData, setAccumnData]         = useState<AccumnReport | null>(null);
  const [accumnOrders, setAccumnOrders]     = useState<Tables<"accumn_api_orders">[]>([]);
  const [linkedCompany, setLinkedCompany]   = useState<Record<string, string | null> | null>(null);
  const [linkedDirs, setLinkedDirs]         = useState<Record<string, string | null>[]>([]);
  const [coDetailTab, setCoDetailTab]       = useState<"company" | "directors">("company");
  const [textPopover, setTextPopover]       = useState<{label:string;text:string}|null>(null);
  const [editCoOpen, setEditCoOpen]         = useState(false);
  const [editCoForm, setEditCoForm]         = useState<Record<string,string>>({});
  const [savingCo, setSavingCo]             = useState(false);
  const [editDirOpen, setEditDirOpen]       = useState(false);
  const [editDirId, setEditDirId]           = useState<string | null>(null);
  const [editDirForm, setEditDirForm]       = useState<Record<string,string>>({});
  const [savingDir, setSavingDir]           = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [extractError, setExtractError] = useState<{ title: string; detail?: string; action?: string } | null>(null);
  const [editingCell, setEditingCell] = useState<{ stmtType: string; fy: number; label: string; field: "label" | "value" } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editingHeader, setEditingHeader] = useState(false);
  const [addStmtForm, setAddStmtForm] = useState<{ type: StatementType; fy: string; unit: string } | null>(null);
  const [addingYearFor, setAddingYearFor] = useState<{ stmtType: string; fy: string } | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [undoStack, setUndoStack] = useState<Record<string, LineItem[]>[]>([]);
  const [redoStack, setRedoStack] = useState<Record<string, LineItem[]>[]>([]);
  const [ratiosOutdated, setRatiosOutdated] = useState(false);
  const [importingFinExcel, setImportingFinExcel] = useState(false);
  const [aiAlert, setAiAlert] = useState<string | null>(null);
  const autoCheckDoneRef = useRef(false);
  const finExcelInputRef = useRef<HTMLInputElement>(null);
  const reviewHeaderScrollRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const reviewBodyScrollRefs   = useRef<Record<string, HTMLDivElement | null>>({});
  const [icImportBusy, setIcImportBusy]       = useState(false);
  const [icImportProgress, setIcImportProgress] = useState(0);
  const [icImportLabel, setIcImportLabel]     = useState("");
  const icImportFileRef = useRef<HTMLInputElement>(null);

  // Sync sticky-header column widths to match the actual rendered body-table column widths
  useLayoutEffect(() => {
    for (const type of Object.keys(reviewBodyScrollRefs.current)) {
      const bodyDiv   = reviewBodyScrollRefs.current[type];
      const headerDiv = reviewHeaderScrollRefs.current[type];
      if (!bodyDiv || !headerDiv) continue;
      const bodyTable = bodyDiv.querySelector("table");
      if (!bodyTable) continue;
      const firstRow = bodyTable.querySelector("tbody tr") as HTMLTableRowElement | null;
      if (!firstRow) continue;
      const hcols = Array.from(headerDiv.querySelectorAll("[data-hcol]")) as HTMLElement[];
      Array.from(firstRow.cells).forEach((cell, i) => {
        if (!hcols[i]) return;
        const w = cell.getBoundingClientRect().width;
        Object.assign(hcols[i].style, { width: `${w}px`, minWidth: `${w}px`, maxWidth: `${w}px`, flexShrink: "0", flexGrow: "0", boxSizing: "border-box" });
      });
    }
  });
  const [dragRow, setDragRow] = useState<{ stmtType: string; label: string } | null>(null);
  const [dragOverRow, setDragOverRow] = useState<{ stmtType: string; label: string } | null>(null);
  const [hd, setHd] = useState({
    client_name: "", product_type: "operating_lease" as string, product_type_custom: "",
    industry: "", industry_custom: "", legal_constitution: "", year_established: "",
    principal_borrower: "", promoter_details: "", website: "",
    deal_amount: "", tenure_months: "", expected_irr: "",
    end_use: "", collateral_summary: "", analyst_notes: "", strategic_rationale: "",
    assign_email: "", assign_name: "", assign_role: "analyst",
    has_partner: false, partner_company_name: "",
  });
  type TeamMember = { id: string; email: string; full_name: string | null; role: string | null };
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [editScanFileQueue, setEditScanFileQueue] = useState<EditFileQueueItem[]>([]);
  const [editScanning, setEditScanning] = useState(false);
  const [editScanStage, setEditScanStage] = useState("");
  const [editScanPct, setEditScanPct] = useState(0);
  const [editScanResult, setEditScanResult] = useState<EditScanResult | null>(null);
  const [editWebEnriching, setEditWebEnriching] = useState(false);
  const [editWebEnrichPct, setEditWebEnrichPct] = useState(0);
  const [editDragOver, setEditDragOver] = useState(false);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const editCancelledRef = useRef(false);
  const [editMcaProfile, setEditMcaProfile] = useState<EditMcaProfile | null>(null);
  const [editMcaImporting, setEditMcaImporting] = useState(false);
  const editMcaFileInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    if (!id) return;
    const [c, d, e, r, bk, gs, ao, cr] = await Promise.all([
      supabase.from("credit_cases").select("*").eq("id", id).single(),
      supabase.from("financial_documents").select("*").eq("case_id", id).order("created_at"),
      supabase.from("extracted_financials").select("*").eq("case_id", id),
      supabase.from("financial_ratios").select("*").eq("case_id", id).order("fiscal_year"),
      supabase.from("bank_statement_data").select("*").eq("case_id", id).order("month"),
      supabase.from("gst_return_data").select("*").eq("case_id", id).order("period"),
      supabase.from("accumn_api_orders").select("*").eq("case_id", id).order("created_at", { ascending: false }),
      (supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> }).from("cibil_report_data").select("*").eq("case_id", id).order("created_at", { ascending: false }),
    ]);
    if (!c.data) { navigate("/", { replace: true }); return; }
    setCc(c.data);
    setDocs(d.data ?? []);
    setExtracted(e.data ?? []);
    setRatios(r.data ?? []);
    setBankData(bk.data ?? []);
    setGstData(gs.data ?? []);
    setAccumnOrders((ao.data ?? []) as Tables<"accumn_api_orders">[]);
    setCibilData((cr as { data: CibilReportRow[] | null }).data ?? []);

    // Load Accumn GST analytical report + BSA report (not in generated TS types)
    const dbRaw = supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> };
    const [{ data: accumnRow }, { data: bsaRow }, { data: triRow }] = await Promise.all([
      dbRaw.from("gst_accumn_reports").select("report_data").eq("case_id", id).maybeSingle() as Promise<{ data: { report_data: AccumnReport } | null }>,
      dbRaw.from("bsa_report_data").select("*").eq("case_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle() as Promise<{ data: BsaReportRow | null }>,
      dbRaw.from("triangulation_data").select("*").eq("case_id", id).maybeSingle() as Promise<{ data: { id: string; case_id: string; report_data: TriangulationData; period_covered: string | null; created_at: string } | null }>,
    ]);
    setAccumnData(accumnRow?.report_data ?? null);
    setBsaData(bsaRow ?? null);
    setTriangulationData(triRow ?? null);

    // Load linked company MCA profile + directors
    const companyId = (c.data as unknown as { company_id?: string }).company_id;
    if (companyId) {
      const db = supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> };
      const [{ data: co }, { data: dirs }] = await Promise.all([
        db.from("companies").select("*").eq("id", companyId).single(),
        db.from("company_directors").select("*").eq("company_id", companyId).order("name"),
      ]);
      setLinkedCompany(co as Record<string, string | null> ?? null);
      setLinkedDirs((dirs ?? []) as Record<string, string | null>[]);
    } else {
      setLinkedCompany(null);
      setLinkedDirs([]);
    }
  }, [id, navigate]);

  useEffect(() => {
    reload().then(() => {
      // Fire proactive AI check once per page session, in the background
      if (autoCheckDoneRef.current) return;
      autoCheckDoneRef.current = true;
      const dismissed = sessionStorage.getItem(`ai-alert-dismissed-${id}`);
      if (dismissed) return;
      (async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyst-chat`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${session?.access_token ?? ""}`,
                "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              },
              body: JSON.stringify({ case_id: id, auto_check: true }),
            },
          );
          const json = await res.json();
          if (json.alert) setAiAlert(json.alert as string);
        } catch { /* silent */ }
      })();
    });
  }, [reload]);

  const openEditCo = () => {
    if (!linkedCompany) return;
    setEditCoForm({
      name:                   String(linkedCompany.name ?? ""),
      registered_address:     String(linkedCompany.registered_address ?? ""),
      website:                String(linkedCompany.website ?? ""),
      mca_cin:                String(linkedCompany.mca_cin ?? ""),
      mca_pan:                String(linkedCompany.mca_pan ?? ""),
      mca_lei:                String(linkedCompany.mca_lei ?? ""),
      mca_category:           String(linkedCompany.mca_category ?? ""),
      mca_sub_category:       String(linkedCompany.mca_sub_category ?? ""),
      mca_type:               String(linkedCompany.mca_type ?? ""),
      mca_authorized_capital: String(linkedCompany.mca_authorized_capital ?? ""),
      mca_paid_up_capital:    String(linkedCompany.mca_paid_up_capital ?? ""),
      mca_status:             String(linkedCompany.mca_status ?? ""),
      mca_nse_sector:         String(linkedCompany.mca_nse_sector ?? ""),
      mca_sector:             String(linkedCompany.mca_sector ?? ""),
      mca_products_services:  String(linkedCompany.mca_products_services ?? ""),
      mca_email:              String(linkedCompany.mca_email ?? ""),
      mca_telephone:          String(linkedCompany.mca_telephone ?? ""),
      mca_date_of_incorp:     String(linkedCompany.mca_date_of_incorp ?? ""),
      mca_date_last_bs:       String(linkedCompany.mca_date_last_bs ?? ""),
      mca_date_last_agm:      String(linkedCompany.mca_date_last_agm ?? ""),
      mca_about:              String(linkedCompany.mca_about ?? ""),
    });
    setEditCoOpen(true);
  };

  const saveEditCo = async () => {
    if (!linkedCompany?.id) return;
    setSavingCo(true);
    try {
      const db = supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> };
      const update: Record<string, string | null> = {};
      Object.entries(editCoForm).forEach(([k, v]) => { update[k] = v.trim() || null; });
      await db.from("companies").update(update).eq("id", linkedCompany.id);
      await reload();
      setEditCoOpen(false);
      toast.success("Company details saved");
    } catch (e) {
      toast.error("Save failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingCo(false);
    }
  };

  const openEditDir = (dir?: Record<string, string | null>) => {
    if (dir) {
      setEditDirId(String(dir.id ?? ""));
      setEditDirForm({
        name:                 String(dir.name ?? ""),
        din:                  String(dir.din ?? ""),
        pan:                  String(dir.pan ?? ""),
        dob:                  String(dir.dob ?? ""),
        age:                  String(dir.age ?? ""),
        gender:               String(dir.gender ?? ""),
        nationality:          String(dir.nationality ?? ""),
        address:              String(dir.address ?? ""),
        designation:          String(dir.designation ?? ""),
        din_status:           String(dir.din_status ?? ""),
        dsc_status:           String(dir.dsc_status ?? ""),
        appointed_current:    String(dir.appointed_current ?? ""),
        originally_appointed: String(dir.originally_appointed ?? ""),
        cessation_date:       String(dir.cessation_date ?? ""),
        shareholding:         String(dir.shareholding ?? ""),
        email:                String(dir.email ?? ""),
        phone:                String(dir.phone ?? ""),
        remarks:              String(dir.remarks ?? ""),
      });
    } else {
      setEditDirId(null);
      setEditDirForm({ name:"",din:"",pan:"",dob:"",age:"",gender:"",nationality:"",address:"",designation:"",din_status:"",dsc_status:"",appointed_current:"",originally_appointed:"",cessation_date:"",shareholding:"",email:"",phone:"",remarks:"" });
    }
    setEditDirOpen(true);
  };

  const saveEditDir = async () => {
    if (!linkedCompany?.id || !editDirForm.name.trim()) { toast.error("Director name is required"); return; }
    setSavingDir(true);
    try {
      const db = supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> };
      const row: Record<string, string | null> = { company_id: String(linkedCompany.id) };
      Object.entries(editDirForm).forEach(([k, v]) => { row[k] = v.trim() || null; });
      if (editDirId) {
        await db.from("company_directors").update(row).eq("id", editDirId);
      } else {
        await db.from("company_directors").insert(row);
      }
      await reload();
      setEditDirOpen(false);
      toast.success(editDirId ? "Director updated" : "Director added");
    } catch (e) {
      toast.error("Save failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingDir(false);
    }
  };

  const deleteDir = async (dirId: string) => {
    if (!window.confirm("Delete this director?")) return;
    const db = supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> };
    await db.from("company_directors").delete().eq("id", dirId);
    await reload();
    toast.success("Director removed");
  };

  // Realtime: debounce so batch upserts (many rows at once) coalesce into one reload
  // rather than firing one fetch per row and exhausting the browser connection pool.
  const scheduleReload = useCallback(() => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(reload, 400);
  }, [reload]);

  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(`case-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "credit_cases", filter: `id=eq.${id}` }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "financial_documents", filter: `case_id=eq.${id}` }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "extracted_financials", filter: `case_id=eq.${id}` }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "financial_ratios", filter: `case_id=eq.${id}` }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "accumn_api_orders", filter: `case_id=eq.${id}` }, scheduleReload)
      .subscribe();
    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      supabase.removeChannel(ch);
    };
  }, [id, scheduleReload]);

  useEffect(() => {
    if (extractError) {
      const timer = setTimeout(() => setExtractError(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [extractError]);



  const handleRetry = useCallback(async (doc: DocRow) => {
    if (!user || !cc) return;
    try {
      // Reset this doc to pending immediately so the UI reacts
      await supabase.from("financial_documents")
        .update({ extraction_status: "pending", extraction_error: null })
        .eq("id", doc.id);

      if (doc.doc_class === "bank_statement") {
        // Collect all non-extracted bank statements for this case
        const { data: batchDocs } = await supabase.from("financial_documents")
          .select("id")
          .eq("case_id", cc.id)
          .eq("doc_class", "bank_statement")
          .neq("extraction_status", "extracted");
        const ids = (batchDocs ?? [{ id: doc.id }]).map((d: { id: string }) => d.id);

        await supabase.from("financial_documents")
          .update({ extraction_status: "running", extraction_error: null })
          .in("id", ids);

        // Use supabase.functions.invoke so auth is handled automatically
        const { error: triggerErr } = await supabase.functions.invoke("trigger-bank-extraction", {
          body: { case_id: cc.id, user_id: user.id, document_ids: ids },
        });

        if (triggerErr) {
          // Fallback: call extract-bank-statement for each doc; await all so errors surface
          const results = await Promise.allSettled(
            ids.map(id => supabase.functions.invoke("extract-bank-statement", {
              body: { case_id: cc.id, document_id: id },
            }))
          );
          const failed = results.filter(r => r.status === "rejected" || (r.status === "fulfilled" && r.value.error)).length;
          if (failed > 0) {
            toast.warning(`${ids.length - failed} extracted, ${failed} failed — check error column`);
          } else {
            toast.success(`${ids.length} bank statement${ids.length > 1 ? "s" : ""} extracted`);
          }
        } else {
          toast.success(`Re-running ${ids.length} bank statement${ids.length > 1 ? "s" : ""} in background`);
        }

      } else if (doc.doc_class === "gst_return") {
        await supabase.from("financial_documents")
          .update({ extraction_status: "running", extraction_error: null })
          .eq("id", doc.id);
        const { error } = await supabase.functions.invoke("extract-gst", {
          body: { case_id: cc.id, document_id: doc.id },
        });
        if (error) throw error;
        toast.success("GST re-extraction queued");

      } else if (doc.doc_class === "projections") {
        await supabase.from("financial_documents")
          .update({ extraction_status: "running", extraction_error: null })
          .eq("id", doc.id);
        const ext = doc.file_name.split(".").pop()?.toLowerCase() ?? "";
        const isExcelFile = ["xlsx", "xls", "csv"].includes(ext);
        if (isExcelFile) {
          const { data: { session: retrySession } } = await supabase.auth.getSession();
          const retryRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trigger-analysis`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${retrySession?.access_token ?? ""}`,
              "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify({ case_id: cc.id, user_id: user.id, document_ids: [doc.id] }),
          });
          if (!retryRes.ok) throw new Error(`trigger-analysis HTTP ${retryRes.status}`);
        } else {
          const { error } = await supabase.functions.invoke("extract-projections", {
            body: { case_id: cc.id, user_id: user.id, document_id: doc.id },
          });
          if (error) throw error;
        }
        toast.success("Projections re-extraction queued");

      } else if (doc.doc_class === "provisional") {
        await supabase.from("financial_documents")
          .update({ extraction_status: "running", extraction_error: null })
          .eq("id", doc.id);
        const ext = doc.file_name.split(".").pop()?.toLowerCase() ?? "";
        const isExcelFile = ["xlsx", "xls", "csv"].includes(ext);
        if (isExcelFile) {
          const { data: { session: retrySession } } = await supabase.auth.getSession();
          const retryRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trigger-analysis`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${retrySession?.access_token ?? ""}`,
              "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify({ case_id: cc.id, user_id: user.id, document_ids: [doc.id] }),
          });
          if (!retryRes.ok) throw new Error(`trigger-analysis HTTP ${retryRes.status}`);
        } else {
          // Fire and poll — conversion happens server-side inside the edge function
          supabase.functions.invoke("extract-provisional", {
            body: { case_id: cc.id, user_id: user.id, document_id: doc.id },
          }).catch(() => {});
        }
        await pollExtractionStatus(doc.id, new AbortController().signal);
        toast.success("Provisional re-extraction complete");

      } else if (FINANCIAL_CLASSES_SET.has(doc.doc_class)) {
        await supabase.from("financial_documents")
          .update({ extraction_status: "running", extraction_error: null })
          .eq("id", doc.id);
        const { data: { session: retrySession } } = await supabase.auth.getSession();
        const retryRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trigger-analysis`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${retrySession?.access_token ?? ""}`,
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ case_id: cc.id, user_id: user.id, document_ids: [doc.id] }),
        });
        if (!retryRes.ok) {
          const raw = await retryRes.text().catch(() => "");
          let errMsg = `trigger-analysis HTTP ${retryRes.status}`;
          try { const j = JSON.parse(raw); if (j.error) errMsg = j.error; } catch { /* HTML or empty body */ }
          throw new Error(errMsg);
        }

        toast.success("Analysis re-queued");
      }

      await reload();
    } catch (e) {
      toast.error("Retry failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }, [user, cc, reload]);

  // ── Undo / Redo (must be before early return) ─────────────────────────────
  const captureSnapshot = useCallback((rows: ExtractedRow[]): Record<string, LineItem[]> => {
    const snap: Record<string, LineItem[]> = {};
    for (const r of rows) snap[r.id] = (r.line_items as unknown as LineItem[]).map(i => ({ ...i }));
    return snap;
  }, []);

  const applySnapshot = useCallback(async (snap: Record<string, LineItem[]>) => {
    await Promise.all(
      Object.entries(snap).map(([id, items]) =>
        supabase.from("extracted_financials").update({ line_items: items as never }).eq("id", id)
      )
    );
    await reload();
  }, [reload]);

  const performUndo = useCallback(async () => {
    if (undoStack.length === 0) return;
    const snap = undoStack[undoStack.length - 1];
    const current = captureSnapshot(extracted);
    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev.slice(-49), current]);
    await applySnapshot(snap);
  }, [undoStack, extracted, captureSnapshot, applySnapshot]);

  const performRedo = useCallback(async () => {
    if (redoStack.length === 0) return;
    const snap = redoStack[redoStack.length - 1];
    const current = captureSnapshot(extracted);
    setRedoStack(prev => prev.slice(0, -1));
    setUndoStack(prev => [...prev.slice(-49), current]);
    await applySnapshot(snap);
  }, [redoStack, extracted, captureSnapshot, applySnapshot]);

  const performUndoRef = useRef(performUndo);
  const performRedoRef = useRef(performRedo);
  useEffect(() => { performUndoRef.current = performUndo; }, [performUndo]);
  useEffect(() => { performRedoRef.current = performRedo; }, [performRedo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "z" && !e.shiftKey) { e.preventDefault(); performUndoRef.current(); }
      if (e.key === "y" || (e.key === "z" && e.shiftKey)) { e.preventDefault(); performRedoRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const articulationChecks = useMemo(() => runArticulationChecks(extracted), [extracted]);
  const derivedCFSeries    = useMemo(() => buildDerivedCashFlowSeries(extracted), [extracted]);
  // Map "stmtType:label:fy" → worst failing check for inline row highlighting
  const checkByRowKey = useMemo(() => {
    const map = new Map<string, ArticulationCheck>();
    for (const check of articulationChecks) {
      if (check.status === "pass" || check.status === "skip" || check.fiscal_year === null) continue;
      for (const [prefix, target] of Object.entries(CHECK_RESULT_ROW)) {
        if (check.id.startsWith(prefix + "_")) {
          const key = `${target.stmtType}:${target.label}:${check.fiscal_year}`;
          const existing = map.get(key);
          if (!existing || (check.status === "fail" && existing.status !== "fail")) {
            map.set(key, check);
          }
        }
      }
    }
    return map;
  }, [articulationChecks]);

  if (!cc) return <TerminalLayout><div className="text-muted-foreground text-sm">Loading case…</div></TerminalLayout>;


  const product = PRODUCTS[cc.product_type];
  const statusMeta = CASE_STATUS_META[cc.status];

  const openHeaderEdit = () => {
    const ind = cc.industry ?? "";
    const knownIndustry = CASE_INDUSTRIES.includes(ind as typeof CASE_INDUSTRIES[number]);

    // Fetch team members for the assignee picker
    Promise.all([
      supabase.from("profiles").select("id,email,full_name"),
      supabase.from("user_roles").select("user_id,role"),
    ]).then(([{ data: profiles }, { data: roles }]) => {
      const roleMap = Object.fromEntries((roles ?? []).map(r => [r.user_id, r.role as string]));
      setTeamMembers(
        (profiles ?? [])
          .filter(p => p.email)
          .map(p => ({ id: p.id, email: p.email!, full_name: p.full_name ?? null, role: roleMap[p.id] ?? null }))
          .sort((a, b) => (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email))
      );
    });

    // Determine current assignee's role from team members (best-effort; may load async)
    const assigneeEmail = (cc as Record<string, unknown>).assigned_to_email as string | null ?? "";
    const assigneeName  = (cc as Record<string, unknown>).assigned_to_name  as string | null ?? "";

    const icNote = (cc.ic_note ?? {}) as Record<string, unknown>;
    setHd({
      client_name: cc.client_name,
      product_type: cc.product_type,
      product_type_custom: cc.product_type_custom ?? "",
      industry: knownIndustry ? ind : (ind ? "Other" : ""),
      industry_custom: knownIndustry ? "" : ind,
      legal_constitution: cc.legal_constitution ?? "Pvt Ltd",
      year_established: cc.year_established ? String(cc.year_established) : "",
      principal_borrower: cc.principal_borrower ?? "",
      promoter_details: cc.promoter_details ?? "",
      website: cc.website ?? "",
      deal_amount: cc.deal_amount != null ? String(cc.deal_amount) : "",
      tenure_months: cc.tenure_months != null ? String(cc.tenure_months) : "",
      expected_irr: cc.expected_irr != null ? String(cc.expected_irr) : "",
      end_use: cc.end_use ?? "",
      collateral_summary: cc.collateral_summary ?? "",
      analyst_notes: cc.analyst_notes ?? "",
      strategic_rationale: cc.strategic_rationale ?? "",
      assign_email: assigneeEmail,
      assign_name:  assigneeName,
      assign_role:  "analyst",
      has_partner: (icNote.has_partner as boolean) ?? false,
      partner_company_name: (icNote.partner_company_name as string) ?? "",
    });
    setEditingHeader(true);
  };

  const saveHeader = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedIndustry = hd.industry === "Other" ? hd.industry_custom : hd.industry;
    const assignEmail = (hd.assign_email && hd.assign_email !== "__new__") ? hd.assign_email.trim() : "";
    const assignName  = hd.assign_name.trim();

    await supabase.from("credit_cases").update({
      client_name: hd.client_name,
      product_type: hd.product_type as never,
      product_type_custom: hd.product_type === "other" ? hd.product_type_custom || null : null,
      industry: resolvedIndustry || null,
      legal_constitution: hd.legal_constitution || null,
      year_established: hd.year_established ? Number(hd.year_established) : null,
      principal_borrower: hd.principal_borrower || null,
      promoter_details: hd.promoter_details || null,
      website: hd.website || null,
      deal_amount: hd.deal_amount ? Number(hd.deal_amount) : null,
      tenure_months: hd.tenure_months ? Number(hd.tenure_months) : null,
      expected_irr: hd.expected_irr ? Number(hd.expected_irr) : null,
      end_use: hd.end_use || null,
      collateral_summary: hd.collateral_summary || null,
      analyst_notes: hd.analyst_notes || null,
      strategic_rationale: hd.strategic_rationale || null,
      assigned_to_email: assignEmail || null,
      assigned_to_name:  assignName  || null,
    } as never).eq("id", cc.id);

    // Send invite if assignee is new (not an existing team member)
    const prevAssignee = (cc as Record<string, unknown>).assigned_to_email as string | null ?? "";
    const isNewAssignee = assignEmail && assignEmail !== prevAssignee;
    const isExisting    = teamMembers.some(m => m.email === assignEmail);

    if (isNewAssignee && !isExisting) {
      const { error: invErr } = await supabase.functions.invoke("invite-user", {
        body: {
          email:            assignEmail,
          name:             assignName || undefined,
          role:             hd.assign_role,
          case_code:        cc.case_code,
          client_name:      cc.client_name,
          invited_by_email: user?.email ?? "",
        },
      });
      if (invErr) toast.error(`Case updated but invite failed: ${invErr.message}`);
      else toast.success("Case updated · invite sent to " + assignEmail);
    } else {
      toast.success("Case updated");
    }

    // Persist MCA data to linked company if imported
    const companyId = (cc as unknown as { company_id?: string }).company_id;
    if (editMcaProfile && companyId) {
      await supabase.from("companies").update({
        mca_cin: editMcaProfile.cin ?? null,
        mca_pan: editMcaProfile.pan ?? null,
        mca_lei: editMcaProfile.lei ?? null,
        mca_category: editMcaProfile.category ?? null,
        mca_sub_category: editMcaProfile.sub_category ?? null,
        mca_type: editMcaProfile.mca_type ?? null,
        mca_authorized_capital: editMcaProfile.authorized_capital ?? null,
        mca_paid_up_capital: editMcaProfile.paid_up_capital ?? null,
        mca_status: editMcaProfile.mca_status ?? null,
        mca_nse_sector: editMcaProfile.nse_sector ?? null,
        mca_sector: editMcaProfile.sector ?? null,
        mca_products_services: editMcaProfile.products_services ?? null,
        mca_email: editMcaProfile.email ?? null,
        mca_telephone: editMcaProfile.telephone ?? null,
        mca_date_of_incorp: editMcaProfile.date_of_incorporation ?? null,
        mca_date_last_bs: editMcaProfile.date_of_last_bs ?? null,
        mca_date_last_agm: editMcaProfile.date_of_last_agm ?? null,
        mca_about: editMcaProfile.about ?? null,
      } as never).eq("id", companyId);
      if (editMcaProfile.directors.length > 0) {
        await supabase.from("company_directors").delete().eq("company_id", companyId);
        await supabase.from("company_directors").insert(
          editMcaProfile.directors.map(d => ({ ...d, company_id: companyId }))
        );
      }
      setEditMcaProfile(null);
    }

    // Persist has_partner / partner_company_name into ic_note without overwriting other keys
    const baseIcNote = (cc.ic_note ?? {}) as Record<string, unknown>;
    await supabase.from("credit_cases").update({
      ic_note: {
        ...baseIcNote,
        has_partner: hd.has_partner,
        partner_company_name: hd.has_partner ? (hd.partner_company_name.trim() || null) : null,
      } as unknown as Json,
    }).eq("id", cc.id);

    setEditingHeader(false);
    await reload();
  };

  const runEditWebEnrich = async () => {
    if (!hd.client_name.trim() && !hd.website.trim()) return;
    setEditWebEnriching(true);
    setEditWebEnrichPct(5);
    setEditScanResult(null);
    const tick = setInterval(() => setEditWebEnrichPct(p => p < 88 ? p + 2 : p), 400);
    try {
      const { data, error } = await supabase.functions.invoke("web-enrich-company", {
        body: {
          company_name: hd.client_name.trim() || undefined,
          website: hd.website.trim() || undefined,
        },
      });
      clearInterval(tick);
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? "Enrichment failed");
      setEditWebEnrichPct(100);
      setEditScanResult(data.extracted as EditScanResult);
      toast.success("Company info found — review and apply");
    } catch (e) {
      clearInterval(tick);
      toast.error("Web search failed: " + (e instanceof Error ? e.message : "unknown"));
    } finally {
      setTimeout(() => { setEditWebEnriching(false); setEditWebEnrichPct(0); }, 400);
    }
  };

  const applyEditScanned = () => {
    if (!editScanResult) return;
    setHd(f => {
      const next = { ...f };
      // Fill client_name / website only when the field was blank (user typed the other one as the search seed)
      if (editScanResult.client_name && !f.client_name.trim()) next.client_name = editScanResult.client_name;
      if (editScanResult.website     && !f.website.trim())     next.website     = editScanResult.website;
      if (editScanResult.product_type)        next.product_type        = editScanResult.product_type;
      if (editScanResult.product_type_custom) next.product_type_custom = editScanResult.product_type_custom!;
      if (editScanResult.legal_constitution)  next.legal_constitution  = editScanResult.legal_constitution;
      if (editScanResult.year_established)    next.year_established    = String(editScanResult.year_established);
      if (editScanResult.deal_amount != null) next.deal_amount         = String(editScanResult.deal_amount);
      if (editScanResult.tenure_months != null) next.tenure_months     = String(editScanResult.tenure_months);
      if (editScanResult.expected_irr != null)  next.expected_irr      = String(editScanResult.expected_irr);
      if (editScanResult.promoter_details)    next.promoter_details    = editScanResult.promoter_details;
      if (editScanResult.end_use)             next.end_use             = editScanResult.end_use;
      if (editScanResult.collateral_summary)  next.collateral_summary  = editScanResult.collateral_summary;
      if (editScanResult.strategic_rationale) next.strategic_rationale = editScanResult.strategic_rationale;
      if (editScanResult.industry) {
        const match = CASE_INDUSTRIES.find(i => i.toLowerCase() === editScanResult.industry!.toLowerCase());
        if (match) {
          next.industry = match;
        } else {
          next.industry = "Other";
          next.industry_custom = editScanResult.industry;
        }
      }
      return next;
    });
    toast.success("Form filled from document");
    setEditScanResult(null);
  };

  const resetEditScan = () => {
    editCancelledRef.current = true;
    setEditScanning(false);
    setEditScanPct(0);
    setEditScanStage("");
    setEditScanFileQueue([]);
    setEditScanResult(null);
  };

  const handleEditMcaExcelImport = async (file: File) => {
    setEditMcaImporting(true);
    try {
      const { profile, companyName, websiteUrl } = await parseAccumnExcel(file);
      setEditMcaProfile(profile);

      const industry = _mapEditIndustry(profile.sector || profile.nse_sector || "");
      const constitution = _mapEditConstitution(profile.category || "", profile.mca_type || "");
      let yearEst = "";
      if (profile.date_of_incorporation) {
        const parts = profile.date_of_incorporation.split("/");
        const yr = parts.length === 3 ? parts[2] : parts[0];
        if (yr && yr.length === 4) yearEst = yr;
      }

      setHd(f => ({
        ...f,
        client_name: companyName || f.client_name,
        website: websiteUrl || f.website,
        year_established: yearEst || f.year_established,
        industry: industry && CASE_INDUSTRIES.includes(industry as typeof CASE_INDUSTRIES[number]) ? industry : f.industry,
        legal_constitution: constitution || f.legal_constitution,
      }));

      toast.success(
        `Imported: ${companyName || "Company"} · ${profile.directors.length} director${profile.directors.length !== 1 ? "s" : ""}`
      );
    } catch (err) {
      console.error(err);
      toast.error("Failed to parse Excel — check the file format");
    } finally {
      setEditMcaImporting(false);
      if (editMcaFileInputRef.current) editMcaFileInputRef.current.value = "";
    }
  };

  const handleEditScanFiles = async (rawFiles: File[]) => {
    if (!user || rawFiles.length === 0) return;
    editCancelledRef.current = false;

    const makeItem = (f: File): EditFileQueueItem => {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      const isImage = ["jpg","jpeg","png","webp","gif"].includes(ext);
      const isExcel = ["xlsx","xls","csv"].includes(ext);
      const size = f.size < 1_048_576
        ? `${(f.size / 1024).toFixed(1)} KB`
        : `${(f.size / 1_048_576).toFixed(2)} MB`;
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: f.name, size,
        fileType: isImage ? "image" : isExcel ? "excel" : "pdf",
        status: "pending", uploadPct: 0,
      };
    };

    const seenNames = new Set<string>();
    const initialQueue = rawFiles.map(f => {
      const item = makeItem(f);
      if (seenNames.has(f.name)) return { ...item, status: "duplicate" as const };
      seenNames.add(f.name);
      return item;
    });
    setEditScanFileQueue(initialQueue);
    setEditScanning(true); setEditScanPct(5); setEditScanStage("Preparing…"); setEditScanResult(null);

    const toUpload: Array<{ file_path: string; file_type: "pdf"|"image"|"excel"; file_name: string; excel_text?: string }> = [];

    for (let i = 0; i < rawFiles.length; i++) {
      if (editCancelledRef.current) return;
      const f    = rawFiles[i];
      const item = initialQueue[i];
      if (item.status === "duplicate") continue;

      let excelText: string | undefined;
      if (item.fileType === "excel") {
        setEditScanStage(`Parsing ${item.name}…`);
        const XLSX = await import("xlsx");
        const buf  = await f.arrayBuffer();
        const wb   = XLSX.read(buf, { type: "array" });
        excelText  = wb.SheetNames.map(n =>
          `=== SHEET: ${n} ===\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: "\t" })}`
        ).join("\n\n");
      }

      if (editCancelledRef.current) return;
      setEditScanFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, status: "uploading" } : qi));
      setEditScanStage(`Uploading ${i + 1} of ${rawFiles.length}…`);

      const path = `${user.id}/drafts/${Date.now()}-${f.name}`;
      try {
        await uploadWithProgress("case-files", path, f, (pct) => {
          setEditScanFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, uploadPct: pct } : qi));
          const perFile = 50 / rawFiles.length;
          setEditScanPct(Math.min(55, Math.round(5 + i * perFile + (pct / 100) * perFile)));
        });
        setEditScanFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, status: "done", uploadPct: 100, storagePath: path } : qi));
        toUpload.push({ file_path: path, file_type: item.fileType, file_name: item.name, excel_text: excelText });
      } catch (e) {
        if (editCancelledRef.current) return;
        setEditScanFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, status: "error" } : qi));
        toast.error(`Upload failed: ${item.name}`);
      }
    }

    if (editCancelledRef.current || toUpload.length === 0) { setEditScanning(false); return; }

    const docWord = toUpload.length === 1 ? "document" : `${toUpload.length} documents`;
    setEditScanStage(`Claude analysing ${docWord}…`);
    setEditScanPct(60);
    const tick = setInterval(() => {
      if (editCancelledRef.current) { clearInterval(tick); return; }
      setEditScanPct(p => p < 92 ? p + 1 : p);
    }, 500);

    try {
      const { data, error } = await supabase.functions.invoke("extract-case-meta", {
        body: { files: toUpload },
      });
      clearInterval(tick);
      if (editCancelledRef.current) return;

      let result = data;
      // The deployed function may be the old single-file version — auto-fallback
      if ((data as Record<string, unknown>)?.error === "Missing fields" && toUpload.length > 0) {
        const first = toUpload[0];
        const { data: legacyData, error: legacyErr } = await supabase.functions.invoke("extract-case-meta", {
          body: { file_path: first.file_path, file_type: first.file_type, file_name: first.file_name, excel_text: first.excel_text },
        });
        if (legacyErr || !legacyData?.ok) throw new Error((legacyData as Record<string, unknown>)?.error as string ?? legacyErr?.message ?? "Extraction failed");
        result = legacyData;
      } else if (error || !data?.ok) {
        throw new Error((data as Record<string, unknown>)?.error as string ?? error?.message ?? "Extraction failed");
      }

      setEditScanPct(100); setEditScanStage("Done");
      setEditScanResult(result.extracted as EditScanResult);
      toast.success(`${toUpload.length} document${toUpload.length > 1 ? "s" : ""} analysed — review and apply below`);
    } catch (e) {
      clearInterval(tick);
      if (!editCancelledRef.current) { toast.error(e instanceof Error ? e.message : "Analysis failed"); setEditScanStage(""); }
    } finally {
      setTimeout(() => { setEditScanning(false); setEditScanPct(0); setEditScanStage(""); }, 600);
    }
  };

  const handleCancelUpload = () => {
    if (!abortRef.current) return;
    abortRef.current.abort();
    // Immediately hide the progress bar; cleanup happens async in the catch block
    setBusy(false);
    setProgress(0);
    setProgressLabel("");
  };



  const handleUpload = async (file: File, doc_class: DocClass, fiscal_year: number | null) => {
    if (!user) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setBusy(true);
    setExtractError(null);
    setProgress(0);
    setProgressLabel("Preparing...");
    let uploadedPath: string | null = null;
    let uploadedDocId: string | null = null;
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
      const isImage = ["jpg","jpeg","png","webp","gif"].includes(ext);
      const isExcel = ext === "xlsx" || ext === "xls" || ext === "csv";
      const fileType = isImage ? "image" : isExcel ? "excel" : "pdf";

      // Warn on large scanned PDFs — Claude accepts up to ~32 MB per document
      const MAX_PDF_MB = 30;
      if (fileType === "pdf" && file.size > MAX_PDF_MB * 1024 * 1024) {
        const sizeMb = (file.size / 1024 / 1024).toFixed(1);
        toast.warning(`File is ${sizeMb} MB — large scanned PDFs may timeout or exceed Claude's limit. Consider compressing to under ${MAX_PDF_MB} MB.`);
      }

      // Stage 1: parse file client-side (0 → 15%)
      let excelText: string | undefined;
      let pageTexts: { pageNum: number; text: string }[] | undefined;

      if (isExcel) {
        setProgressLabel("Parsing Excel workbook");
        setProgress(5);
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        excelText = wb.SheetNames.map((name) => {
          const sheet = wb.Sheets[name];
          const tsv = XLSX.utils.sheet_to_csv(sheet, { FS: "\t" });
          return `=== SHEET: ${name} ===\n${tsv}`;
        }).join("\n\n");
        setProgress(15);
      } else if (fileType === "pdf") {
        setProgressLabel("Extracting PDF text...");
        setProgress(5);
        try {
          const { extractPdfPages, detectFinancialPages } = await import("../lib/pdf-text-extractor");
          const allPages = await extractPdfPages(file);
          const financialPageNums = new Set(detectFinancialPages(allPages));
          // For short docs include all pages; for long docs filter to financial pages
          const filtered = allPages.length <= 20
            ? allPages
            : allPages.filter(p => financialPageNums.has(p.pageNum));
          const hasText = filtered.some(p => p.text.length > 50);
          if (hasText) pageTexts = filtered;
        } catch {
          // fall back to vision — no text extracted
        }
        setProgress(15);
      }

      // Stage 2: upload to storage with real progress (15 → 60%)
      const pathPrefix = entity === "partner"
        ? `${user.id}/${cc.id}/partner`
        : `${user.id}/${cc.id}`;
      const path = `${pathPrefix}/${Date.now()}-${file.name}`;
      uploadedPath = path;
      setProgressLabel(`Uploading ${(file.size / 1024 / 1024).toFixed(2)} MB`);
      await uploadWithProgress("case-files", path, file, (pct) => {
        setProgress(15 + Math.round(pct * 0.45));
      }, abort.signal);
      if (abort.signal.aborted) throw new Error("cancelled");
      setProgress(60);

      // Stage 3: register document (60 → 70%)
      setProgressLabel("Registering document");
      const { data: doc, error: dErr } = await supabase.from("financial_documents").insert({
        case_id: cc.id, user_id: user.id, file_path: path, file_name: file.name,
        file_type: fileType, doc_class: doc_class as never,
        fiscal_year, extraction_status: "pending",
      }).select().single();
      if (dErr) throw dErr;
      uploadedDocId = doc.id;
      await supabase.from("credit_cases").update({ status: "extracting" }).eq("id", cc.id);
      setProgress(70);

      const { data: { session } } = await supabase.auth.getSession();
      const fnHeaders = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session?.access_token ?? ""}`,
        "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      };

      if (doc_class === "bank_statement") {
        // Stage 4: queue all bank statement docs (this + any existing failed/pending)
        setProgressLabel("Queuing bank statement extraction…");
        const { data: otherDocs } = await supabase.from("financial_documents")
          .select("id")
          .eq("case_id", cc.id)
          .eq("doc_class", "bank_statement")
          .neq("id", doc.id)
          .in("extraction_status", ["failed", "pending"]);
        const allIds = [doc.id, ...(otherDocs?.map((d: { id: string }) => d.id) ?? [])];
        const triggerRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trigger-bank-extraction`, {
          method: "POST", headers: fnHeaders, signal: abort.signal,
          body: JSON.stringify({
            case_id: cc.id, user_id: user.id, document_ids: allIds,
            ...(excelText ? { excel_texts: { [doc.id]: excelText } } : {}),
          }),
        });
        if (!triggerRes.ok) {
          const e = await triggerRes.json().catch(() => ({})) as Record<string, unknown>;
          throw new Error(String(e?.error ?? `Failed to queue extraction (HTTP ${triggerRes.status})`));
        }
        setProgress(75);
        setProgressLabel(`Extracting ${allIds.length} bank statement${allIds.length > 1 ? "s" : ""} in parallel…`);
        const tick = setInterval(() => setProgress((p) => (p < 95 ? p + 1 : p)), 800);
        try {
          await pollExtractionStatus(doc.id, abort.signal);
        } finally {
          clearInterval(tick);
        }
      } else if (doc_class === "gst_return") {
        // Stage 4: synchronous GST extraction
        setProgressLabel("Extracting GST return with AI...");
        const tick = setInterval(() => setProgress((p) => (p < 95 ? p + 1 : p)), 600);
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-gst`, {
          method: "POST", headers: fnHeaders, signal: abort.signal,
          body: JSON.stringify({ case_id: cc.id, document_id: doc.id, excel_text: excelText }),
        });
        clearInterval(tick);
        if (!res.ok) {
          const e = await res.json().catch(() => ({})) as Record<string, unknown>;
          throw new Error(String(e?.error ?? `GST extraction failed (HTTP ${res.status})`));
        }
      } else {
        // Stage 4: queue financial statement analysis (PDF, image, Excel all handled)
        setProgressLabel("Queuing AI analysis...");
        const triggerRes = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trigger-analysis`,
          {
            method: "POST", headers: fnHeaders, signal: abort.signal,
            body: JSON.stringify({
              case_id: cc.id, document_ids: [doc.id], user_id: user.id,
              ...(excelText ? { excel_texts: { [doc.id]: excelText } } : {}),
              ...(pageTexts ? { page_texts: { [doc.id]: pageTexts } } : {}),
            }),
          }
        );
        if (!triggerRes.ok) {
          const err = await triggerRes.json().catch(() => ({})) as Record<string, unknown>;
          throw new Error(String(err?.error ?? `Failed to queue analysis (HTTP ${triggerRes.status})`));
        }
        const triggerJson = await triggerRes.json().catch(() => ({})) as { job_ids?: string[] };
        const jobId = triggerJson.job_ids?.[0] ?? null;
        setProgress(75);

        // Stage 5: poll extraction_status + show real job stage from extraction_jobs
        setProgressLabel("Queued — waiting for extraction engine...");
        const tick = setInterval(async () => {
          setProgress((p) => (p < 95 ? p + 0.5 : p));
          if (jobId) {
            const { data: job } = await supabase.from("extraction_jobs").select("status").eq("id", jobId).single();
            if (job?.status === "running") setProgressLabel("Engine running — reading tables...");
            else if (job?.status === "completed" || job?.status === "failed") setProgressLabel("Finalising...");
          }
        }, 2000);
        try {
          await pollExtractionStatus(doc.id, abort.signal);
        } finally {
          clearInterval(tick);
        }

        // Stage 6: for provisional uploads, convert extracted rows → ProvPeriod and save to ic_note
        if (doc_class === "provisional") {
          setProgressLabel("Saving to provisional tab...");
          await convertExtractedToProvisional(cc.id, doc.id);
        }
      }

      setProgress(100);
      setProgressLabel("Complete");
      toast.success("Extraction complete");
      await reload();
      setTab(doc_class === "provisional" ? "provisional" : "review");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      if (msg === "cancelled" || msg === "The user aborted a request.") {
        setProgressLabel("Removing uploaded file…");
        if (uploadedDocId) await supabase.from("financial_documents").delete().eq("id", uploadedDocId);
        if (uploadedPath) await supabase.storage.from("case-files").remove([uploadedPath]);
        await reload();
        setProgressLabel("Cancelled");
      } else {
        if (uploadedDocId) {
          await supabase.from("financial_documents")
            .update({ extraction_status: "failed", extraction_error: msg.slice(0, 500) })
            .eq("id", uploadedDocId);
        }
        setExtractError({ title: "Extraction failed", detail: msg });
        await reload();
      }
    } finally {
      abortRef.current = null;
      setTimeout(() => { setBusy(false); setProgress(0); setProgressLabel(""); }, 800);
    }
  };


  const patchItems = async (rowId: string, items: LineItem[], _skipHistory = false) => {
    // Push snapshot of ALL rows before this mutation
    setUndoStack(prev => [...prev.slice(-49), captureSnapshot(extracted)]);
    setRedoStack([]);
    await supabase.from("extracted_financials").update({ line_items: items as never }).eq("id", rowId);
    setRatiosOutdated(true);
    await reload();
  };

  const updateCellValue = async (stmtType: string, fy: number, label: string, rawValue: string) => {
    const row = extracted.find(r => r.statement_type === stmtType && r.fiscal_year === fy);
    if (!row) return;
    let items = (row.line_items as unknown as LineItem[]).slice();
    const idx = items.findIndex(i => i.label === label);
    const v = rawValue === "" ? null : Number(rawValue);
    // Lock derived fields when the user explicitly types a value so the formula is
    // suspended for that field while downstream totals still cascade from it.
    // Clearing the value (empty string) unlocks — formula resumes.
    const isComputed = COMPUTED_LABELS.has(label);
    const locked = isComputed && v != null;
    if (idx === -1) items.push({ label, value: v, confidence: 100, reviewed: true, override_value: null, note: "manual", locked });
    else items[idx] = { ...items[idx], value: v, override_value: null, reviewed: true, locked };
    items = applyStatementRules(items, stmtType);
    await patchItems(row.id, items);
  };

  const updateCellLabel = async (stmtType: string, oldLabel: string, newLabel: string) => {
    if (!newLabel.trim() || newLabel.trim() === oldLabel) { setEditingCell(null); return; }
    setUndoStack(prev => [...prev.slice(-49), captureSnapshot(extracted)]);
    setRedoStack([]);
    const rows = extracted.filter(r => r.statement_type === stmtType);
    for (const row of rows) {
      const items = (row.line_items as unknown as LineItem[]).slice();
      const idx = items.findIndex(i => i.label === oldLabel);
      if (idx !== -1) {
        items[idx] = { ...items[idx], label: newLabel.trim() };
        await supabase.from("extracted_financials").update({ line_items: items as never }).eq("id", row.id);
      }
    }
    setEditingCell(null);
    await reload();
  };

  const updateRowNote = async (stmtType: string, fy: number, label: string, note: string) => {
    const row = extracted.find(r => r.statement_type === stmtType && r.fiscal_year === fy);
    if (!row) return;
    const items = (row.line_items as unknown as LineItem[]).slice();
    const idx = items.findIndex(i => i.label === label);
    if (idx !== -1) {
      items[idx] = { ...items[idx], note: note || undefined };
      await supabase.from("extracted_financials").update({ line_items: items as never }).eq("id", row.id);
    }
  };

  const addRowToType = async (stmtType: string) => {
    setUndoStack(prev => [...prev.slice(-49), captureSnapshot(extracted)]);
    setRedoStack([]);
    const rows = extracted.filter(r => r.statement_type === stmtType);
    const existing = new Set(rows.flatMap(r => (r.line_items as unknown as LineItem[]).map(i => i.label)));
    let newLabel = "New Item"; let n = 1;
    while (existing.has(newLabel)) { newLabel = `New Item ${++n}`; }
    for (const row of rows) {
      const items = (row.line_items as unknown as LineItem[]).slice();
      items.push({ label: newLabel, value: null, confidence: 100, reviewed: true, override_value: null, note: "manual" });
      await supabase.from("extracted_financials").update({ line_items: items as never }).eq("id", row.id);
    }
    await reload();
    const firstFy = rows.sort((a, b) => a.fiscal_year - b.fiscal_year)[0]?.fiscal_year;
    if (firstFy) setEditingCell({ stmtType, fy: firstFy, label: newLabel, field: "label" });
  };

  const deleteRowFromType = async (stmtType: string, label: string) => {
    setUndoStack(prev => [...prev.slice(-49), captureSnapshot(extracted)]);
    setRedoStack([]);
    const rows = extracted.filter(r => r.statement_type === stmtType);
    for (const row of rows) {
      const items = (row.line_items as unknown as LineItem[]).filter(i => i.label !== label);
      await supabase.from("extracted_financials").update({ line_items: items as never }).eq("id", row.id);
    }
    await reload();
  };

  const importFinancialExcel = async (file: File) => {
    if (!cc || !user) return;
    setImportingFinExcel(true);
    try {
      const { parseFinancialExcel } = await import("@/lib/financial-excel-parser");
      const statements = await parseFinancialExcel(file);
      if (statements.length === 0) { toast.error("No financial statements found in this Excel"); return; }
      for (const stmt of statements) {
        for (const fy of stmt.fiscal_years) {
          const existing = extracted.find(r => r.statement_type === stmt.stmt_type && r.fiscal_year === fy);
          const items = applyStatementRules(stmt.line_items_by_fy[fy] as unknown as LineItem[], stmt.stmt_type) as never;
          if (existing) {
            await supabase.from("extracted_financials").update({ line_items: items, unit: stmt.unit } as never).eq("id", existing.id);
          } else {
            await supabase.from("extracted_financials").insert({
              case_id: cc.id, user_id: user.id,
              statement_type: stmt.stmt_type as never,
              fiscal_year: fy,
              line_items: items,
              unit: stmt.unit,
              confirmed: false,
            } as never);
          }
        }
      }
      await reload();
      toast.success(`Imported ${statements.length} statement${statements.length > 1 ? "s" : ""} (${statements.map(s => s.fiscal_years.length + " years").join(", ")})`);
    } catch (e) {
      toast.error("Import failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setImportingFinExcel(false);
    }
  };

  const confirmExtraction = async (rowId: string) => {
    await supabase.from("extracted_financials").update({
      confirmed: true, confirmed_at: new Date().toISOString(),
    }).eq("id", rowId);
    toast.success("Extraction confirmed");
    await reload();
  };

  const toggleSection = (stmtType: string, label: string) => {
    const key = `${stmtType}:${label}`;
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const moveRow = async (stmtType: string, fromLabel: string, toLabel: string) => {
    setUndoStack(prev => [...prev.slice(-49), captureSnapshot(extracted)]);
    setRedoStack([]);
    const typeRows = extracted.filter(r => r.statement_type === stmtType);
    for (const row of typeRows) {
      const items = (row.line_items as unknown as LineItem[]).map(i => ({ ...i })); // deep copy
      const fromIdx = items.findIndex(i => i.label === fromLabel);
      const toIdx   = items.findIndex(i => i.label === toLabel);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) continue;
      const [moved] = items.splice(fromIdx, 1);
      // adjust target index after removal
      const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
      items.splice(insertAt, 0, moved);
      items.forEach((item, i) => { item.sort_order = i; });
      await supabase.from("extracted_financials").update({ line_items: items as never }).eq("id", row.id);
    }
    await reload();
  };

  const deleteExtractedRow = async (rowId: string) => {
    await supabase.from("extracted_financials").delete().eq("id", rowId);
    await reload();
  };

  const isProvisional = (row: ExtractedRow) =>
    (row.line_items as unknown as LineItem[]).some(i => i.label === "__provisional");

  const toggleProvisional = async (row: ExtractedRow) => {
    const items = row.line_items as unknown as LineItem[];
    const next  = isProvisional(row)
      ? items.filter(i => i.label !== "__provisional")
      : [...items, { label: "__provisional", value: 1, confidence: 100, reviewed: true } as LineItem];
    await supabase.from("extracted_financials").update({ line_items: next as never }).eq("id", row.id);
    await reload();
  };

  const createEmptyStatement = async (type: StatementType, fy: number, unit: string) => {
    if (!user) return;
    const exists = extracted.some(r => r.statement_type === type && r.fiscal_year === fy);
    if (exists) { toast.error(`${type.replace(/_/g," ").toUpperCase()} · FY${fy} already exists`); return; }
    const { error } = await supabase.from("extracted_financials").insert({
      case_id: cc.id, user_id: user.id,
      fiscal_year: fy, statement_type: type as never,
      line_items: [], confirmed: false, unit: unit || null,
    });
    if (error) { toast.error(error.message); return; }
    setAddStmtForm(null);
    toast.success(`${type.replace(/_/g," ").toUpperCase()} · FY${fy} created`);
    await reload();
  };

  const addYearColumn = async (stmtType: string, newFy: number) => {
    if (!user) return;
    const exists = extracted.some(r => r.statement_type === stmtType && r.fiscal_year === newFy);
    if (exists) { toast.error(`FY${newFy} already exists for this statement`); return; }
    const anyRow = extracted.find(r => r.statement_type === stmtType);
    const items = anyRow
      ? (anyRow.line_items as unknown as LineItem[]).map(li => ({ label: li.label, value: null, confidence: 100, reviewed: false, override_value: null, note: "manual" }))
      : [];
    const { error } = await supabase.from("extracted_financials").insert({
      case_id: cc.id, user_id: user.id,
      fiscal_year: newFy, statement_type: stmtType as never,
      line_items: items, confirmed: false, unit: anyRow?.unit || null,
    });
    if (error) { toast.error(error.message); return; }
    setAddingYearFor(null);
    toast.success(`FY${newFy} column added`);
    await reload();
  };

  const handleDeleteDoc = async (doc: DocRow) => {
    await supabase.storage.from("case-files").remove([doc.file_path]);
    await supabase.from("financial_documents").delete().eq("id", doc.id);
    toast.success(`${doc.file_name} removed`);
    await reload();
  };

  const handleEditDoc = async (id: string, doc_class: string, fiscal_year: number | null) => {
    await supabase.from("financial_documents").update({ doc_class: doc_class as never, fiscal_year }).eq("id", id);
    toast.success("Document updated");
    await reload();
  };

  const generateRatioAnalysis = async () => {
    if (!cc) return;
    setRatioAnalysisLoading(true);
    setRatioAiProgress(0);
    setRatioAiLabel("Preparing ratio data");
    const AI_LABELS = [
      "Preparing ratio data",
      "Reading financial trends",
      "Analysing category ratios",
      "Identifying risk factors",
      "Drafting AI insights",
    ];
    let p = 0;
    const tick = setInterval(() => {
      p = Math.min(p + 2, 88);
      setRatioAiProgress(p);
      setRatioAiLabel(AI_LABELS[Math.min(Math.floor(p / 20), AI_LABELS.length - 1)]);
    }, 150);
    try {
      window.dispatchEvent(new CustomEvent("ai-token-usage", {
        detail: { status: "loading", label: "Ratio Analysis", max_tokens: 2500 },
      }));
      const { data, error } = await supabase.functions.invoke("generate-credit-summary", {
        body: { case_id: cc.id },
      });
      clearInterval(tick);
      if (error) {
        // Extract actual error message from the 500 response body
        let msg = "Edge function error";
        try { const body = await (error as { context?: Response }).context?.json?.(); msg = body?.error ?? error.message ?? msg; } catch { msg = error.message ?? msg; }
        throw new Error(msg);
      }
      if (data?.analysis) {
        setRatioAiProgress(100);
        setRatioAiLabel("Complete");
        setRatioAnalysis(data.analysis as RatioAnalysisResult);
        if (data.usage) {
          setRatioAnalysisUsage(data.usage as RatioAnalysisUsage);
          window.dispatchEvent(new CustomEvent("ai-token-usage", {
            detail: {
              status:        "complete",
              input_tokens:  data.usage.input_tokens,
              output_tokens: data.usage.output_tokens,
              max_tokens:    data.usage.max_tokens,
              model:         data.usage.model,
              label:         "Ratio Analysis",
            },
          }));
        }
      } else throw new Error(data?.error ?? "No analysis returned");
    } catch (e) {
      clearInterval(tick);
      toast.error("AI analysis failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setTimeout(() => { setRatioAnalysisLoading(false); setRatioAiProgress(0); setRatioAiLabel(""); }, 600);
    }
  };

  const runRatios = async () => {
    if (!cc || !user) return;
    setBusy(true);
    try {
      // ── helpers ──────────────────────────────────────────────────────────
      const _safe = (n: unknown): number | null => {
        const v = Number(n);
        return n == null || !Number.isFinite(v) ? null : v;
      };
      const _div = (a: number | null, b: number | null): number | null =>
        a == null || b == null || b === 0 ? null : a / b;

      // ── normalize labels so the ratio engine sees consistent keys ────────
      const normalize = (
        pl: Record<string, number | null>,
        bs: Record<string, number | null>,
      ) => {
        const p = { ...pl }, b = { ...bs };

        // BS authoritative overrides: Accumn totals always win over stale derived values
        const bsAlways: [string, string[]][] = [
          ["Net Worth",            ["Networth","Net worth","Shareholders Equity","Total Equity","Shareholders' Funds","Total Shareholders Funds"]],
          ["Total Assets",         ["TOTAL ASSETS","Total Asset"]],
          ["Current Assets",       ["Total Current Assets"]],
          ["Current Liabilities",  ["Total Current Liabilities"]],
          ["Fixed Assets (Net)",   ["Total Fixed Asset","Net Block","Net Block of Assets","Net Fixed Assets"]],
        ];
        for (const [t, srcs] of bsAlways) {
          for (const s of srcs) { if (b[s] != null) { b[t] = b[s]; break; } }
        }
        // BS aliases (fill-only for non-authoritative fields)
        const bsAl: [string, string[]][] = [
          ["Long Term Borrowings", ["Long-term Borrowings","Long-Term Borrowings","Non-current Borrowings"]],
          ["Short Term Borrowings",["Total Short-term Borrowings","Short-term Borrowings","Current Borrowings"]],
          ["Inventory",            ["Inventories","Stock"]],
          ["Cash & Bank",          ["Cash & Cash Equivalents","Cash and Cash Equivalents","Cash and Bank"]],
          ["Trade Receivables",    ["Debtors","Trade Debtors","Accounts Receivable","Sundry Debtors"]],
          ["Trade Payables",       ["Creditors","Trade Creditors","Accounts Payable","Sundry Creditors"]],
          ["Reserves & Surplus",   ["Reserves and Surplus","Other Equity","Retained Earnings"]],
        ];
        for (const [t, srcs] of bsAl) {
          if (b[t] == null) for (const s of srcs) { if (b[s] != null) { b[t] = b[s]; break; } }
        }
        // Derived BS
        if (b["Total Debt"] == null) {
          const lt = _safe(b["Long Term Borrowings"]), st = _safe(b["Short Term Borrowings"]);
          if (lt != null || st != null) b["Total Debt"] = (lt ?? 0) + (st ?? 0);
        }
        if (b["Capital Employed"] == null) {
          const nw = _safe(b["Net Worth"]), td = _safe(b["Total Debt"]);
          if (nw != null && td != null) b["Capital Employed"] = nw + td;
        }
        if (b["Total Assets"] == null) {
          const fa = _safe(b["Fixed Assets (Net)"]), ca = _safe(b["Current Assets"]);
          if (fa != null && ca != null) b["Total Assets"] = fa + ca;
        }
        if (b["Total Liabilities"] == null) {
          const ta = _safe(b["Total Assets"]), nw = _safe(b["Net Worth"]);
          if (ta != null && nw != null) b["Total Liabilities"] = ta - nw;
        }

        // P&L aliases
        const plAl: [string, string[]][] = [
          ["Turnover",                  ["Total Revenue from Operations","Net Revenue from Operations","Revenue from Operations","Net Sales","Gross Sales","Revenue","Total Revenue"]],
          ["Interest Expense",          ["Finance Costs","Finance Cost","Interest & Finance Charges","Financial Charges","Borrowing Costs","Interest Cost"]],
          ["PAT",                       ["Profit/(Loss)","Profit for the Year","Net Profit","Profit After Tax","Net Profit/(Loss)","Profit for the period","Net Income"]],
          ["Profit Before Tax",         ["Profit before Tax","Profit Before Taxation","Profit/(Loss) before Tax","Profit before Exceptional and Extraordinary Items and Tax","Profit before Extraordinary Items and Tax"]],
          ["Depreciation",              ["Total Depreciation, Depletion and Amortization Expense","Depreciation & Amortization","Depreciation and Amortization","D&A"]],
          ["Employee Benefit Expense",  ["Total Employee Benefit Expense","Employee Benefits Expense","Employee Benefits","Personnel Expenses","Staff Cost","Staff Costs","Employee Costs"]],
          ["Other Expenses",            ["Total Other Expenses","Other Operating Expenses","Other Expenses (Net)","Miscellaneous Expenses"]],
          ["Cost of Materials Consumed",["Cost of Material Consumed","Raw Material Consumed","Material Cost"]],
          ["Gross Profit",              ["Gross Margin","Gross Profit/(Loss)"]],
        ];
        for (const [t, srcs] of plAl) {
          if (p[t] == null) for (const s of srcs) { if (p[s] != null) { p[t] = p[s]; break; } }
        }

        // Proper COGS = Materials + Purchases of Stock in Trade + Changes in Inventories
        // (matches Accumn methodology; used for Inventory Days, Payable Days, CCC, Raw Material %)
        const cogsProper =
          (_safe(p["Cost of Materials Consumed"]) ?? 0)
          + (_safe(p["Purchases of Stock in Trade"]) ?? 0)
          + (_safe(p["Changes in Inventories of Finished Goods, Work In Progress and Stock In Trade"]) ?? 0);
        if (cogsProper !== 0) {
          p["Cost of Goods Sold"] = cogsProper;
        } else if (p["Cost of Goods Sold"] == null) {
          // fallback: map from any single COGS alias
          for (const s of ["Cost of Material Consumed","Cost of Materials Consumed","Total Cost of Materials","COGS","Direct Costs"]) {
            if (p[s] != null) { p["Cost of Goods Sold"] = p[s]; break; }
          }
        }

        // Derived P&L
        // EBIT = EBITDA − Depreciation (operating, preferred) → fallback PBT + Interest
        if (p["EBIT"] == null) {
          const ebitda = _safe(p["EBITDA"]), dep = _safe(p["Depreciation"]) ?? 0;
          if (ebitda != null) p["EBIT"] = ebitda - dep;
          else {
            const pbt = _safe(p["Profit Before Tax"]), int_ = _safe(p["Interest Expense"]);
            if (pbt != null && int_ != null) p["EBIT"] = pbt + int_;
          }
        }
        if (p["EBITDA"] == null && p["EBIT"] != null) p["EBITDA"] = (_safe(p["EBIT"]) ?? 0) + (_safe(p["Depreciation"]) ?? 0);
        if (p["Gross Profit"] == null && p["Turnover"] != null && p["Cost of Goods Sold"] != null)
          p["Gross Profit"] = (_safe(p["Turnover"]) ?? 0) - (_safe(p["Cost of Goods Sold"]) ?? 0);

        return { pl: p, bs: b };
      };

      // ── fetch thresholds ─────────────────────────────────────────────────
      const industry = cc.industry ?? "default";
      const { data: threshData } = await supabase
        .from("ratio_thresholds").select("*").in("industry", ["default", industry]);
      const tMap: Record<string, { green_min: number|null; amber_min: number|null; peer_median: number|null; higher_is_better: boolean; formula_note: string|null }> = {};
      for (const t of (threshData ?? []).filter(t => t.industry === "default")) tMap[t.ratio_name] = t;
      for (const t of (threshData ?? []).filter(t => t.industry === industry)) tMap[t.ratio_name] = t;

      const thresh = (name: string, val: number | null): "green"|"amber"|"red"|"na" => {
        const t = tMap[name];
        if (val == null || !t) return "na";
        const { green_min, amber_min, higher_is_better } = t;
        if (green_min == null || amber_min == null) return "na";
        if (higher_is_better) return val >= green_min ? "green" : val >= amber_min ? "amber" : "red";
        return val <= green_min ? "green" : val <= amber_min ? "amber" : "red";
      };

      // ── build year map from extracted data ───────────────────────────────
      const yearMap = new Map<number, { pl: Record<string, number|null>; bs: Record<string, number|null>; cf: Record<string, number|null> }>();
      for (const row of extracted) {
        const y = yearMap.get(row.fiscal_year) ?? { pl: {}, bs: {}, cf: {} };
        const dict: Record<string, number|null> = {};
        for (const it of (row.line_items as unknown as LineItem[])) {
          if (it.label.startsWith("__")) continue;  // skip meta markers
          const v = it.override_value != null ? it.override_value : it.value;
          dict[it.label] = v;
        }
        if (row.statement_type === "profit_loss") y.pl = { ...y.pl, ...dict };
        if (row.statement_type === "balance_sheet") y.bs = { ...y.bs, ...dict };
        if (row.statement_type === "cash_flow") y.cf = { ...y.cf, ...dict };
        yearMap.set(row.fiscal_year, y);
      }
      if (yearMap.size === 0) { toast.error("No financial data found"); return; }

      const principalPerYear = cc.deal_amount && cc.tenure_months
        ? Number(cc.deal_amount) / (Number(cc.tenure_months) / 12) : 0;

      // ── compute ratios year by year ──────────────────────────────────────
      type RatioInsert = { case_id: string; user_id: string; fiscal_year: number; category: string; ratio_name: string; ratio_value: number|null; benchmark: number|null; threshold_status: string; formula_note: string };
      const rows: RatioInsert[] = [];
      const sortedYears = Array.from(yearMap.entries()).sort((a, b) => a[0] - b[0]);
      let prevTurnover: number | null = null;

      for (const [fy, fin] of sortedYears) {
        const { pl, bs } = normalize(fin.pl, fin.bs);

        const nw   = _safe(bs["Net Worth"]);
        const negEq = nw !== null && nw < 0;
        const td   = _safe(bs["Total Debt"]);
        const ta   = _safe(bs["Total Assets"]);
        const tl   = _safe(bs["Total Liabilities"]);
        const ce   = _safe(bs["Capital Employed"]);
        const ltB  = _safe(bs["Long Term Borrowings"]);
        const fa   = _safe(bs["Fixed Assets (Net)"]);
        const ca   = _safe(bs["Current Assets"]);
        const cl   = _safe(bs["Current Liabilities"]);
        const inv  = _safe(bs["Inventory"]) ?? 0;
        const cash = _safe(bs["Cash & Bank"]);
        const dbtr = _safe(bs["Trade Receivables"]);
        const cred = _safe(bs["Trade Payables"]);
        const resSurp = _safe(bs["Reserves & Surplus"]);
        const wc   = ca != null && cl != null ? ca - cl : null;

        const turn = _safe(pl["Turnover"]);
        const cogs = _safe(pl["Cost of Goods Sold"]);
        const gp   = _safe(pl["Gross Profit"]);
        const ebitda= _safe(pl["EBITDA"]);
        const dep  = _safe(pl["Depreciation"]) ?? 0;
        const ebit = _safe(pl["EBIT"]);
        const intE = _safe(pl["Interest Expense"]) ?? 0;
        const pat  = _safe(pl["PAT"]);
        const pbt  = _safe(pl["Profit Before Tax"]);
        const empC = _safe(pl["Employee Benefit Expense"]);
        const othE = _safe(pl["Other Expenses"]);
        const rawM = _safe(pl["Cost of Materials Consumed"]);

        const revGrowth = prevTurnover != null && prevTurnover !== 0 && turn != null
          ? (turn - prevTurnover) / Math.abs(prevTurnover) : null;

        const invDays  = inv !== 0 && cogs ? (inv / cogs) * 365 : null;
        const dDays    = dbtr != null && turn ? (dbtr / turn) * 365 : null;
        const cDays    = cred != null && cogs ? (cred / cogs) * 365 : null;
        const ccc      = invDays != null && dDays != null && cDays != null ? invDays + dDays - cDays : null;

        const outsideLiab = ta != null && nw != null ? ta - nw : null;
        const rsWcTa    = wc != null && ta != null && ta !== 0 ? wc / ta : null;
        const rsReTa    = resSurp != null && ta != null && ta !== 0 ? resSurp / ta : null;
        const rsEbTa    = ebitda != null && ta != null && ta !== 0 ? ebitda / ta : null;
        const rsEqOl    = nw != null && outsideLiab != null && outsideLiab !== 0 ? nw / outsideLiab : null;
        const rsComp    = rsWcTa != null && rsReTa != null && rsEbTa != null && rsEqOl != null
          ? 6*rsWcTa + 3*rsReTa + 7*rsEbTa + rsEqOl : null;

        const calc: [string, string, number|null, string][] = [
          ["profitability","revenue_growth",         revGrowth,                                                     "(Revenue_curr − Revenue_prev) / |Revenue_prev|"],
          ["profitability","ebitda_margin",          _div(ebitda, turn),                                            "EBITDA / Turnover"],
          ["profitability","ebt_margin",             _div(pbt, turn),                                               "Profit Before Tax / Turnover"],
          ["profitability","net_profit_margin",      _div(pat, turn),                                               "PAT / Turnover"],
          ["profitability","roe",                    negEq ? null : _div(pat, nw),                                  "PAT / Net Worth"],
          ["profitability","return_on_fixed_assets", _div(pat, fa),                                                 "PAT / Fixed Assets (Net)"],
          ["profitability","roce",                   _div(ebit, nw),                                                "EBIT / Net Worth"],
          ["profitability","gross_margin",           _div(gp, turn),                                                "Gross Profit / Turnover"],
          ["profitability","roa",                    _div(pat, ta),                                                 "PAT / Total Assets"],
          ["liquidity",    "current_ratio",          _div(ca, cl),                                                  "Current Assets / Current Liabilities"],
          ["liquidity",    "quick_ratio",            _div(ca != null ? ca - inv : null, cl),                        "(CA − Inventory) / CL"],
          ["liquidity",    "cash_ratio",             _div(cash, cl),                                                "Cash / Current Liabilities"],
          ["liquidity",    "working_capital",        wc,                                                            "CA − CL"],
          ["solvency",     "interest_coverage",      _div(ebit, intE || null),                                      "EBIT / Interest Expense"],
          ["solvency",     "lt_debt_to_equity",      negEq ? null : _div(ltB, nw),                                  "Long Term Borrowings / Net Worth"],
          ["solvency",     "total_assets_to_equity", negEq ? null : _div(ta, nw),                                   "Total Assets / Net Worth"],
          ["solvency",     "debt_to_equity",         negEq ? null : _div(td, nw),                                   "Total Debt / Net Worth"],
          ["solvency",     "debt_to_assets",         _div(td, ta),                                                  "Total Debt / Total Assets"],
          ["solvency",     "debt_to_ebitda",         _div(td, ebitda),                                              "Total Debt / EBITDA"],
          ["solvency",     "total_liab_to_networth", negEq ? null : _div(tl, nw),                                   "Total Liabilities / Net Worth"],
          ["coverage",     "dscr",                   _div((pat ?? 0) + dep + intE, intE + (principalPerYear||0) || null), "STANDARDISED: (PAT + Dep + Int) / (Int + Principal)"],
          ["efficiency",   "fixed_assets_turnover",  _div(turn, fa),                                                "Turnover / Fixed Assets (Net)"],
          ["efficiency",   "asset_turnover",         _div(turn, ta),                                                "Turnover / Total Assets"],
          ["efficiency",   "working_capital_turnover",_div(turn, wc),                                               "Turnover / Working Capital"],
          ["efficiency",   "inventory_days",         invDays,                                                       "(Inventory / COGS) × 365"],
          ["efficiency",   "debtor_days",            dDays,                                                         "In the absence of credit sales details, (Debtors / Turnover) × 365"],
          ["efficiency",   "creditor_days",          cDays,                                                         "In the absence of credit purchase details, (Creditors / COGS) × 365"],
          ["efficiency",   "cash_conversion_cycle",  ccc,                                                           "Inventory Days + Receivables Days − Payable Days"],
          ["efficiency",   "inventory_turnover",     _div(cogs, inv || null),                                       "COGS / Inventory"],
          ["efficiency",   "receivables_turnover",   _div(turn, dbtr),                                              "Turnover / Trade Receivables"],
          ["efficiency",   "capital_employed_turnover",_div(turn, ce),                                              "Turnover / Capital Employed"],
          ["expenses",     "raw_material_pct",       _div(rawM, turn),                                              "Cost of Materials Consumed / Turnover"],
          ["expenses",     "employee_cost_pct",      _div(empC, turn),                                              "Employee Benefit Expense / Turnover"],
          ["expenses",     "finance_cost_pct",       turn ? _div(intE || null, turn) : null,                        "Finance Cost / Turnover"],
          ["expenses",     "other_expenses_pct",     _div(othE, turn),                                              "Other Expenses / Turnover"],
          ["return",       "roic",                   negEq ? null : _div(pat, ce),                                  "PAT / Capital Employed"],
          ["return",       "ronw",                   negEq ? null : _div(pat, nw),                                  "PAT / Net Worth"],
          ["r_score",      "r_score_wc_ta",          rsWcTa,                                                        "Working Capital / Total Assets"],
          ["r_score",      "r_score_re_ta",          rsReTa,                                                        "Retained Earnings / Total Assets"],
          ["r_score",      "r_score_ebitda_ta",      rsEbTa,                                                        "EBITDA / Total Assets"],
          ["r_score",      "r_score_equity_ol",      rsEqOl,                                                        "Equity / Outside Liabilities"],
          ["r_score",      "r_score_composite",      rsComp,                                                        "6×(WC/TA)+3×(RE/TA)+7×(EBITDA/TA)+Equity/OL"],
        ];

        const negEqNames = ["debt_to_equity","lt_debt_to_equity","total_liab_to_networth","total_assets_to_equity","roe","ronw"];
        for (const [cat, name, val, formula] of calc) {
          const reviewReq = negEq && negEqNames.includes(name);
          rows.push({
            case_id: cc.id, user_id: user.id,
            fiscal_year: fy, category: cat, ratio_name: name,
            ratio_value: val,
            benchmark: tMap[name]?.peer_median ?? null,
            threshold_status: thresh(name, reviewReq ? null : val),
            formula_note: tMap[name]?.formula_note ?? formula,
          });
        }
        prevTurnover = turn;
      }

      // ── save to DB ───────────────────────────────────────────────────────
      await supabase.from("financial_ratios").delete().eq("case_id", cc.id);
      if (rows.length) {
        const { error: insErr } = await supabase.from("financial_ratios").insert(rows as never);
        if (insErr) throw insErr;
      }
      await supabase.from("credit_cases").update({ status: "analysis" }).eq("id", cc.id);

      toast.success(`${rows.length} ratio values computed across ${sortedYears.length} years`);
      setRatiosOutdated(false);
      await reload();
      setTab("ratios");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ratio computation failed");
    } finally { setBusy(false); }
  };

  const runNarrative = async (analystNotes?: string) => {
    // Capture user-entered data before edge function overwrites ic_note
    const preservedPartners       = (cc.ic_note as Record<string, unknown> | null)?.["partners"] as PartnerEntry[] | undefined;
    const preservedProjComment    = (cc.ic_note as Record<string, unknown> | null)?.["projections_comment"] as string | undefined;
    const preservedProvisional    = (cc.ic_note as Record<string, unknown> | null)?.["provisional"] as ProvPeriod[] | undefined;

    setBusy(true);
    setProgress(0);
    setProgressLabel("Preparing case data");
    const LABELS = [
      "Preparing case data",
      "Analysing financials",
      "Drafting sections",
      "Building tables",
      "Finalising note",
    ];
    let p = 0;
    const tick = setInterval(() => {
      p = Math.min(p + 1, 44);   // Phase 1 progress cap — phase 2 takes over at 50
      setProgress(p);
      setProgressLabel(LABELS[Math.min(Math.floor(p / 20), LABELS.length - 1)]);
    }, 700);

    const invokePhase = async (phase: 1 | 2, extra?: Record<string, unknown>) => {
      const { data, error } = await supabase.functions.invoke("generate-narrative", {
        body: { case_id: cc.id, phase, ...(analystNotes ? { analyst_notes_for_ic: analystNotes } : {}), ...extra },
      });
      if (error) {
        const ctx = (error as { context?: unknown }).context;
        if (ctx instanceof Response) {
          try {
            const body = await ctx.json() as { error?: string };
            if (body?.error) throw new Error(body.error);
          } catch (parseErr) {
            if (parseErr instanceof Error) throw parseErr;
          }
        }
        throw error;
      }
      return data as Record<string, unknown>;
    };

    try {
      window.dispatchEvent(new CustomEvent("ai-token-usage", {
        detail: { status: "loading", label: "IC Note", max_tokens: 6000 },
      }));
      supabase.functions.invoke("vectorize-case-data", { body: { case_id: cc.id } }).catch(() => {});

      // Phase 1 — sections I–VI
      setProgressLabel("Drafting executive summary, client profile & financials…");
      const p1 = await invokePhase(1);
      clearInterval(tick);

      // Phase 2 — sections VII–XII + risks + CPs + SWOT
      setProgress(50);
      setProgressLabel("Drafting ratios, cash flow, DD, risks & conditions…");
      let p2 = 50;
      const tick2 = setInterval(() => {
        p2 = Math.min(p2 + 1, 92);
        setProgress(p2);
      }, 700);
      const narData = await invokePhase(2, { prior_sections: p1.partial_sections ?? {} });
      clearInterval(tick2);

      setProgress(100);
      setProgressLabel("Complete");
      if (narData?.usage) {
        window.dispatchEvent(new CustomEvent("ai-token-usage", {
          detail: {
            status:        "complete",
            input_tokens:  narData.usage.input_tokens  ?? 0,
            output_tokens: narData.usage.output_tokens ?? 0,
            max_tokens:    narData.usage.max_tokens    ?? 8192,
            model:         narData.usage.model         ?? "claude-sonnet-4-6",
            label:         "IC Note",
          },
        }));
      }
      toast.success("IC Note draft generated");
      // Re-merge user-entered data that the edge function may have overwritten
      if (preservedPartners?.length || preservedProjComment || preservedProvisional?.length) {
        const mergedNote = {
          ...(narData?.ic_note as Record<string, unknown> ?? {}),
          ...(preservedPartners?.length     ? { partners:            preservedPartners   } : {}),
          ...(preservedProjComment          ? { projections_comment: preservedProjComment } : {}),
          ...(preservedProvisional?.length  ? { provisional:         preservedProvisional } : {}),
        };
        await supabase.from("credit_cases").update({ ic_note: mergedNote as Json }).eq("id", cc.id);
      }
      const { error: statusErr } = await supabase.from("credit_cases").update({ status: "ic_review" }).eq("id", cc.id);
      if (statusErr) throw new Error("Status update failed: " + statusErr.message);
      await reload();
      // Apply ic_note AFTER reload so this wins over any stale DB read
      if (narData?.ic_note) {
        setCc(prev => prev ? { ...prev, ic_note: narData.ic_note as Json, status: "ic_review" } : prev);
      }
      setTab("ic_note");
    } catch (e) {
      clearInterval(tick);
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setTimeout(() => { setBusy(false); setProgress(0); setProgressLabel(""); }, 800);
    }
  }; // end runNarrative

  const patchIcSection = async (sectionId: string, markdown: string) => {
    if (!cc) return;
    const current = (cc.ic_note as Record<string, unknown> | null) ?? {};
    const next = {
      ...current,
      sections: { ...((current.sections as Record<string, unknown>) ?? {}), [sectionId]: { markdown } },
    };
    await supabase.from("credit_cases").update({ ic_note: next as never }).eq("id", cc.id);
    setCc(prev => prev ? { ...prev, ic_note: next as never } : prev);
  };

  const addIcComment = async (sectionId: string, text: string) => {
    if (!cc || !user) return;
    const current = (cc.ic_note as Record<string, unknown> | null) ?? {};
    const existing = (current.comments as unknown[]) ?? [];
    const comment = {
      id: crypto.randomUUID(),
      section_id: sectionId,
      text,
      author_email: user.email ?? "",
      created_at: new Date().toISOString(),
      resolved: false,
    };
    const next = { ...current, comments: [...existing, comment] };
    await supabase.from("credit_cases").update({ ic_note: next as never }).eq("id", cc.id);
    setCc(prev => prev ? { ...prev, ic_note: next as never } : prev);
  };

  const resolveIcComment = async (commentId: string) => {
    if (!cc) return;
    const current = (cc.ic_note as Record<string, unknown> | null) ?? {};
    const existing = (current.comments as Array<Record<string, unknown>>) ?? [];
    const next = {
      ...current,
      comments: existing.map(c => c.id === commentId ? { ...c, resolved: true } : c),
    };
    await supabase.from("credit_cases").update({ ic_note: next as never }).eq("id", cc.id);
    setCc(prev => prev ? { ...prev, ic_note: next as never } : prev);
  };

  const saveAnnotations = async (annotations: unknown[]) => {
    if (!cc) return;
    const current = (cc.ic_note as Record<string, unknown> | null) ?? {};
    const next = { ...current, annotations };
    await supabase.from("credit_cases").update({ ic_note: next as never }).eq("id", cc.id);
    setCc(prev => prev ? { ...prev, ic_note: next as never } : prev);
  };

  const saveCellEdit = async (tableKey: string, rowLabel: string, fy: number, val: number | null) => {
    if (!cc) return;
    const current = (cc.ic_note as Record<string, unknown> | null) ?? {};
    const edits = (current.cell_edits as Record<string, Record<string, Record<number, number | null>>>) ?? {};
    const next = {
      ...current,
      cell_edits: {
        ...edits,
        [tableKey]: { ...(edits[tableKey] ?? {}), [rowLabel]: { ...((edits[tableKey]?.[rowLabel]) ?? {}), [fy]: val } },
      },
    };
    await supabase.from("credit_cases").update({ ic_note: next as never }).eq("id", cc.id);
    setCc(prev => prev ? { ...prev, ic_note: next as never } : prev);
  };

  const saveCustomRow = async (tableKey: string, label: string) => {
    if (!cc) return;
    const current = (cc.ic_note as Record<string, unknown> | null) ?? {};
    const rows = (current.custom_rows as Record<string, string[]>) ?? {};
    const next = { ...current, custom_rows: { ...rows, [tableKey]: [...(rows[tableKey] ?? []), label] } };
    await supabase.from("credit_cases").update({ ic_note: next as never }).eq("id", cc.id);
    setCc(prev => prev ? { ...prev, ic_note: next as never } : prev);
  };

  const saveCaseField = async (field: string, val: string | number | null) => {
    if (!cc) return;
    await supabase.from("credit_cases").update({ [field]: val } as never).eq("id", cc.id);
    setCc(prev => prev ? { ...prev, [field]: val } : prev);
  };

  const saveRatioField = async (ratioId: string, field: "ratio_value" | "benchmark", val: number | null) => {
    if (!cc) return;
    await supabase.from("financial_ratios").update({ [field]: val }).eq("id", ratioId);
    setRatios(prev => prev.map(r => r.id === ratioId ? { ...r, [field]: val } : r));
  };

  const handleIcNoteImport = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext !== "pdf") { toast.error("IC Note import only accepts PDF files"); return; }
    setIcImportBusy(true); setIcImportProgress(5); setIcImportLabel("Uploading PDF…");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const path = `${user!.id}/${cc!.id}/ic-note-${Date.now()}-${file.name}`;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/case-files/${path.split("/").map(encodeURIComponent).join("/")}`;
      await new Promise<void>((res, rej) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        xhr.setRequestHeader("Authorization", `Bearer ${session?.access_token}`);
        xhr.setRequestHeader("apikey", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
        xhr.setRequestHeader("x-upsert", "true");
        xhr.setRequestHeader("Content-Type", "application/pdf");
        xhr.upload.onprogress = e => { if (e.lengthComputable) setIcImportProgress(5 + Math.round((e.loaded / e.total) * 35)); };
        xhr.onload = () => xhr.status < 300 ? res() : rej(new Error(`Upload ${xhr.status}`));
        xhr.onerror = () => rej(new Error("Network error"));
        xhr.send(file);
      });
      setIcImportProgress(42); setIcImportLabel("Registering…");
      const { data: doc, error: dErr } = await supabase.from("financial_documents").insert({
        case_id: cc!.id, user_id: user!.id, file_path: path, file_name: file.name,
        file_type: "pdf" as never, doc_class: "ic_note_pdf" as never, extraction_status: "pending",
      }).select().single();
      if (dErr || !doc) throw new Error(dErr?.message ?? "Register failed");
      setIcImportProgress(48); setIcImportLabel("Extracting with Mistral OCR…");
      const tick = setInterval(() => setIcImportProgress(p => p < 94 ? p + 1 : p), 700);
      const { data: { session: s2 } } = await supabase.auth.getSession();
      const authH = { "Content-Type": "application/json", "Authorization": `Bearer ${s2?.access_token}`, "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY };
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-ic-note`, {
        method: "POST", headers: authH,
        body: JSON.stringify({ case_id: cc!.id, document_id: doc.id }),
      });
      clearInterval(tick);
      const result = await res.json().catch(() => ({})) as Record<string, unknown>;
      setIcImportProgress(100); setIcImportLabel("Done");
      if (!res.ok) throw new Error((result.error as string) ?? `HTTP ${res.status}`);
      toast.success(`IC Note extracted — ${result.sections_extracted ?? 0} sections, ${result.risks_extracted ?? 0} risks`);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "IC Note import failed");
    } finally {
      setTimeout(() => { setIcImportBusy(false); setIcImportProgress(0); setIcImportLabel(""); }, 800);
    }
  };

  const years = Array.from(new Set(ratios.map((r) => r.fiscal_year))).sort();
  const ratioGroups = Array.from(new Set(ratios.map((r) => r.category)));

  const statusColorClass: Record<string, string> = {
    green: "bg-success text-success-foreground",
    amber: "bg-warning text-warning-foreground",
    red: "bg-destructive text-destructive-foreground",
    na: "bg-muted text-muted-foreground",
  };
  const statusLabel: Record<string, string> = {
    green: "PASS", amber: "CAUTION", red: "FAIL", na: "—",
  };

  const inputCls = "w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors";
  const labelCls = "block text-sm font-medium text-foreground mb-1";
  const sHd = (k: keyof typeof hd) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setHd(p => ({ ...p, [k]: e.target.value }));

  const ic = (cc.ic_note as unknown) as null | {
    sections: Record<string, { markdown: string }>;
    risks: Array<{ category: string; risk: string; mitigant: string; severity: string }>;
    conditions_precedent: string[];
    swot?: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
    projections_comment?: string;
    partners?: PartnerEntry[];
    provisional?: ProvPeriod[];
    has_partner?: boolean;
    partner_company_name?: string;
  };

  const hasPartner = !!(ic?.has_partner);
  const partnerCompanyName = ic?.partner_company_name ?? "Partner Company";

  // Entity filtering — derived once, used across all tabs
  const partnerDocIds = new Set(docs.filter(d => d.file_path.includes(`/${cc.id}/partner/`)).map(d => d.id));
  const mainDocs      = docs.filter(d => !partnerDocIds.has(d.id));
  const partnerDocs   = docs.filter(d => partnerDocIds.has(d.id));
  const mainExtracted    = hasPartner ? extracted.filter(r => !r.document_id || !partnerDocIds.has(r.document_id)) : extracted;
  const partnerExtracted = hasPartner ? extracted.filter(r => r.document_id !== null && partnerDocIds.has(r.document_id)) : [];
  const activeExtracted  = (tab === "partner") ? partnerExtracted
    : (!hasPartner || entity === "main") ? mainExtracted : partnerExtracted;

  // Entity-isolated bank and GST data (linked via document_id like extracted_financials)
  const mainBankData    = bankData.filter(b => !b.document_id || !partnerDocIds.has(b.document_id));
  const partnerBankData = bankData.filter(b => !!b.document_id && partnerDocIds.has(b.document_id));
  const activeBankData  = tab === "partner" ? partnerBankData : mainBankData;

  const mainGstData    = gstData.filter(g => !g.document_id || !partnerDocIds.has(g.document_id));
  const partnerGstData = gstData.filter(g => !!g.document_id && partnerDocIds.has(g.document_id));
  const activeGstData  = tab === "partner" ? partnerGstData : mainGstData;

  // Reusable entity selector bar — rendered at top of any tab panel
  const entityBar = hasPartner ? (
    <div className="flex gap-1 bg-muted/30 rounded-lg p-1 -mx-1 mb-4 border border-border" style={{ marginTop: "-0.25rem" }}>
      {([
        ["main",    cc.client_name,     "Main Company"],
        ["partner", partnerCompanyName, "Partner Company"],
      ] as const).map(([k, name, label]) => (
        <button
          key={k}
          onClick={() => setEntity(k)}
          className={`flex-1 py-2 px-3 text-sm font-medium rounded-md flex flex-col items-center gap-0.5 transition-colors ${entity === k ? "bg-white text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground hover:bg-white/50"}`}
        >
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="truncate max-w-[220px] font-semibold">{name}</span>
        </button>
      ))}
    </div>
  ) : null;

  const icBase = () => (cc.ic_note as Record<string, unknown> | null) ?? {};

  const savePartners = async (partners: PartnerEntry[]) => {
    await supabase.from("credit_cases").update({ ic_note: { ...icBase(), partners } as unknown as Json }).eq("id", cc.id);
    await reload();
  };

  const saveProvisional = async (provisional: ProvPeriod[]) => {
    await supabase.from("credit_cases").update({ ic_note: { ...icBase(), provisional } as unknown as Json }).eq("id", cc.id);
    await reload();
  };

  const saveProjectionsComment = async (text: string) => {
    const base = icBase();
    if (base["sections"]) {
      await supabase.from("credit_cases").update({ ic_note: { ...base, projections_comment: text || null } as Json }).eq("id", cc.id);
    } else {
      // ic_note not yet generated — store comment in analyst_notes with a prefix so it's not lost
      const existing = cc.analyst_notes ?? "";
      const tag = "[PROJECTIONS COMMENT]\n";
      const stripped = existing.startsWith(tag) ? existing.slice(tag.length) : existing;
      await supabase.from("credit_cases").update({ analyst_notes: text ? `${tag}${text}` : stripped || null }).eq("id", cc.id);
    }
    await reload();
  };

  const handleDirectProjImport = async (data: { fiscal_year: number; line_items: LineItem[]; unit: string }[]) => {
    if (!user || !cc) return;
    for (const { fiscal_year, line_items, unit } of data) {
      const { error } = await supabase.from("extracted_financials").upsert({
        case_id: cc.id, user_id: user.id, document_id: null,
        fiscal_year, statement_type: "projections" as never,
        line_items: line_items as never, confirmed: false, unit,
      }, { onConflict: "case_id,fiscal_year,statement_type" } as never);
      if (error) throw new Error(error.message);
    }
    await reload();
  };

  // ── Excel template helpers ────────────────────────────────────────────────
  const tplCols = (fys: string[]) => ["Particulars", ...fys];
  const tplRows = (labels: string[], fys: string[]) =>
    labels.map(l => [l, ...fys.map(() => "")] as (string | number | null)[]);

  const downloadFinancialTemplate = async () => {
    const fys = ["FY2022", "FY2023", "FY2024", "FY2025"];
    const hdr = tplCols(fys);
    const blank = (label: string) => [label, ...fys.map(() => "")] as (string | number | null)[];

    const plRows: (string | number | null)[][] = [
      blank("── INCOME ──"),
      blank("Revenue from Operations"),
      blank("Other Income"),
      blank("Total Income"),
      blank("── EXPENSES ──"),
      blank("Raw Material / Cost of Goods Sold"),
      blank("Change in Stock / WIP"),
      blank("Employee Benefit Expenses"),
      blank("Manufacturing Expenses"),
      blank("Selling & Distribution Expenses"),
      blank("Administrative & General Expenses"),
      blank("Other Expenses"),
      blank("Total Operating Expenses"),
      blank("── KEY METRICS ──"),
      blank("Gross Profit"),
      blank("EBITDA"),
      blank("Depreciation & Amortization"),
      blank("EBIT"),
      blank("Interest & Finance Charges"),
      blank("Other Non-Operating Income / Expense"),
      blank("Profit Before Tax"),
      blank("Tax (Current + Deferred)"),
      blank("PAT (Net Profit After Tax)"),
      blank("Dividend Paid"),
      blank("Retained Profit"),
    ];

    const bsRows: (string | number | null)[][] = [
      blank("── EQUITY & LIABILITIES ──"),
      blank("Share Capital"),
      blank("Reserves & Surplus"),
      blank("Net Worth (Shareholders Equity)"),
      blank("── LONG-TERM LIABILITIES ──"),
      blank("Long Term Borrowings (Secured)"),
      blank("Long Term Borrowings (Unsecured)"),
      blank("Deferred Tax Liability"),
      blank("Long Term Provisions"),
      blank("Other Long Term Liabilities"),
      blank("── CURRENT LIABILITIES ──"),
      blank("Short Term Borrowings (CC / OD / WCDL)"),
      blank("Current Maturities of LT Debt"),
      blank("Trade Payables"),
      blank("Advance from Customers"),
      blank("Other Current Liabilities"),
      blank("Short Term Provisions"),
      blank("Current Liabilities"),
      blank("Total Liabilities (Equity + Liab)"),
      blank("── NON-CURRENT ASSETS ──"),
      blank("Gross Block (Tangible Fixed Assets)"),
      blank("Accumulated Depreciation"),
      blank("Fixed Assets (Net Block)"),
      blank("Capital Work in Progress (CWIP)"),
      blank("Intangible Assets (Net)"),
      blank("Non-Current Investments"),
      blank("Long Term Loans & Advances"),
      blank("Other Non-Current Assets"),
      blank("── CURRENT ASSETS ──"),
      blank("Inventory (Stock-in-Trade + WIP)"),
      blank("Trade Receivables"),
      blank("Cash & Bank Balances"),
      blank("Short Term Loans & Advances"),
      blank("Other Current Assets"),
      blank("Current Assets"),
      blank("Total Assets"),
      blank("── DERIVED ──"),
      blank("Capital Employed"),
      blank("Working Capital"),
      blank("Tangible Net Worth"),
    ];

    const cfRows: (string | number | null)[][] = [
      blank("── OPERATING ACTIVITIES ──"),
      blank("Net Profit (PAT)"),
      blank("Add: Depreciation & Amortization"),
      blank("Add: Interest Expenses"),
      blank("Changes in Inventories"),
      blank("Changes in Trade Receivables"),
      blank("Changes in Trade Payables"),
      blank("Changes in Other Working Capital"),
      blank("Income Tax Paid"),
      blank("Cash from Operations"),
      blank("── INVESTING ACTIVITIES ──"),
      blank("Capital Expenditure (Gross)"),
      blank("Proceeds from Sale of Fixed Assets"),
      blank("Investments Made"),
      blank("Investments Realised"),
      blank("Other Investing Cash Flows"),
      blank("Cash from Investing"),
      blank("── FINANCING ACTIVITIES ──"),
      blank("Proceeds from Long Term Borrowings"),
      blank("Repayment of Long Term Borrowings"),
      blank("Net Change in Short Term Borrowings"),
      blank("Interest Paid"),
      blank("Dividend Paid"),
      blank("Share Capital Raised"),
      blank("Cash from Financing"),
      blank("── NET CASH POSITION ──"),
      blank("Net Change in Cash"),
      blank("Opening Cash"),
      blank("Closing Cash"),
    ];

    await dlExcel([
      { name: "Profit & Loss",   rows: [["Profit & Loss Statement (Amount in Lakhs)"], hdr, ...plRows] },
      { name: "Balance Sheet",   rows: [["Balance Sheet (Amount in Lakhs)"], hdr, ...bsRows] },
      { name: "Cash Flow",       rows: [["Cash Flow Statement (Amount in Lakhs)"], hdr, ...cfRows] },
    ], `${cc.case_code}_financial_template.xlsx`);
  };

  const downloadProjectionsTemplate = async () => {
    const fys = ["FY2025", "FY2026", "FY2027"];
    const labels = [
      "Projected Turnover", "Projected EBITDA", "Projected PAT",
      "Projected Net Worth", "Projected Total Debt",
      "Projected Gross Profit", "Projected EBIT", "Projected Depreciation",
      "Projected Interest Expense", "Projected Operating Expenses", "Projected Total Assets",
    ];
    await dlExcel([
      { name: "Projections", rows: [tplCols(fys), ["// Same unit as historical data — import via DIRECT EXCEL IMPORT in Projections tab"], ...tplRows(labels, fys)] },
    ], `${cc.case_code}_projections_template.xlsx`);
  };

  const downloadBankTemplate = async () => {
    const months = ["Apr 2024","May 2024","Jun 2024","Jul 2024","Aug 2024","Sep 2024","Oct 2024","Nov 2024","Dec 2024","Jan 2025","Feb 2025","Mar 2025"];
    const hdr = ["Month","Bank Name","Account Number","Opening Balance","Closing Balance","Total Credits","Total Debits","Credit Count","Debit Count","Avg Balance","Min Balance","Max Balance","Inward Bounces","Outward Bounces","EMI Outflows","Remarks"];
    const note = ["// Month format: 'Apr 2024'. Balances in INR. Leave blank if unknown."];
    const rows = months.map(m => [m, "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    await dlExcel([{ name: "Bank Statement", rows: [hdr as (string|number|null)[], note as (string|number|null)[], ...rows] }], `${cc.case_code}_bank_template.xlsx`);
  };

  const downloadGstTemplate = async () => {
    const periods = ["Apr 2024","May 2024","Jun 2024","Jul 2024","Aug 2024","Sep 2024","Oct 2024","Nov 2024","Dec 2024","Jan 2025","Feb 2025","Mar 2025"];
    const hdr = ["Period","Return Type","GSTIN","Taxable Turnover","Exempt Turnover","Total Turnover","Output Tax","ITC Claimed","Net Tax Paid","Filing Date","Filing Status"];
    const note = ["// Period: 'Apr 2024'. Return Type: GSTR-3B / GSTR-1 / GSTR-9. Turnover in INR."];
    const rows = periods.map(p => [p, "GSTR-3B", "", "", "", "", "", "", "", "", "Filed"]);
    await dlExcel([{ name: "GST Returns", rows: [hdr as (string|number|null)[], note as (string|number|null)[], ...rows] }], `${cc.case_code}_gst_template.xlsx`);
  };

  const handleProjectionUpload = async (file: File, fiscalYear: number | null) => {
    if (!user) return;
    setBusy(true); setProgress(0); setProgressLabel("Uploading projection…");
    let uploadedDocId: string | null = null;
    let uploadedPath:  string | null = null;
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
      const isImage = ["jpg","jpeg","png","webp"].includes(ext);
      const isExcel = ["xlsx","xls","csv"].includes(ext);
      const fileType = isImage ? "image" : isExcel ? "excel" : "pdf";

      let excelText: string | undefined;
      if (isExcel) {
        setProgressLabel("Parsing Excel…"); setProgress(5);
        const XLSX = await import("xlsx");
        const buf  = await file.arrayBuffer();
        const wb   = XLSX.read(buf, { type: "array" });
        excelText  = wb.SheetNames.map(n => `=== SHEET: ${n} ===\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: "\t" })}`).join("\n\n");
        setProgress(15);
      }

      const path = `${user.id}/${cc.id}/${Date.now()}-${file.name}`;
      uploadedPath = path;
      setProgressLabel(`Uploading ${(file.size / 1024 / 1024).toFixed(2)} MB`);
      await uploadWithProgress("case-files", path, file, pct => setProgress(15 + Math.round(pct * 0.45)));
      setProgress(60);

      setProgressLabel("Registering document…");
      const { data: doc, error: dErr } = await supabase.from("financial_documents").insert({
        case_id: cc.id, user_id: user.id, file_path: path, file_name: file.name,
        file_type: fileType as never, doc_class: "projections" as never,
        fiscal_year: fiscalYear, extraction_status: "pending",
      }).select().single();
      if (dErr || !doc) throw new Error(dErr?.message ?? "Register failed");
      uploadedDocId = doc.id;
      setProgress(70);

      setProgressLabel("Queuing AI analysis…");
      if (isExcel) {
        const { data: { session } } = await supabase.auth.getSession();
        const fnH = {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token ?? ""}`,
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        };
        const triggerRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trigger-analysis`, {
          method: "POST", headers: fnH,
          body: JSON.stringify({
            case_id: cc.id, document_ids: [doc.id], user_id: user.id,
            ...(excelText ? { excel_texts: { [doc.id]: excelText } } : {}),
          }),
        });
        if (!triggerRes.ok) {
          const err = await triggerRes.json().catch(() => ({})) as Record<string, unknown>;
          throw new Error(String(err?.error ?? `Trigger failed HTTP ${triggerRes.status}`));
        }
      } else {
        const { error: fnErr } = await supabase.functions.invoke("extract-projections", {
          body: { case_id: cc.id, user_id: user.id, document_id: doc.id },
        });
        if (fnErr) throw new Error(fnErr.message);
      }
      setProgress(75); setProgressLabel("Extracting projections with AI…");
      const tick = setInterval(() => setProgress(p => p < 95 ? p + 1 : p), 800);
      const abort = new AbortController();
      try {
        await pollExtractionStatus(doc.id, abort.signal);
      } finally {
        clearInterval(tick);
      }
      setProgress(100); setProgressLabel("Done");
      toast.success("Projections extracted");
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      toast.error(msg);
      if (uploadedDocId) {
        await supabase.from("financial_documents")
          .update({ extraction_status: "failed", extraction_error: msg.slice(0, 500) })
          .eq("id", uploadedDocId);
      } else if (uploadedPath) {
        await supabase.storage.from("case-files").remove([uploadedPath]);
      }
      await reload();
    } finally {
      setTimeout(() => { setBusy(false); setProgress(0); setProgressLabel(""); }, 800);
    }
  };

  const handleProvisionalUpload = async (file: File) => {
    if (!user) return;
    setBusy(true); setProgress(0); setProgressLabel("Uploading provisional statement…");
    let uploadedDocId: string | null = null;
    let uploadedPath:  string | null = null;
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
      const isImage = ["jpg","jpeg","png","webp"].includes(ext);
      const fileType = isImage ? "image" : "pdf";

      const path = `${user.id}/${cc.id}/${Date.now()}-${file.name}`;
      uploadedPath = path;
      setProgressLabel(`Uploading ${(file.size / 1024 / 1024).toFixed(2)} MB`);
      await uploadWithProgress("case-files", path, file, pct => setProgress(Math.round(pct * 0.5)));
      setProgress(55);

      setProgressLabel("Registering document…");
      const { data: doc, error: dErr } = await supabase.from("financial_documents").insert({
        case_id: cc.id, user_id: user.id, file_path: path, file_name: file.name,
        file_type: fileType as never, doc_class: "provisional" as never,
        fiscal_year: null, extraction_status: "pending",
      }).select().single();
      if (dErr || !doc) throw new Error(dErr?.message ?? "Register failed");
      uploadedDocId = doc.id;
      setProgress(65);

      // Fire the edge function — it handles extraction + conversion server-side.
      // Do NOT await the invoke directly; instead poll for status so the client
      // stays alive even if the HTTP response takes longer than the gateway timeout.
      setProgress(70); setProgressLabel("Extracting provisional financials with AI…");
      supabase.functions.invoke("extract-provisional", {
        body: { case_id: cc.id, user_id: user.id, document_id: doc.id },
      }).catch(() => {}); // swallow invoke errors — status poll will surface failures

      const tick = setInterval(() => setProgress(p => p < 95 ? p + 1 : p), 800);
      const abort = new AbortController();
      try {
        await pollExtractionStatus(doc.id, abort.signal);
      } finally {
        clearInterval(tick);
      }

      setProgress(100); setProgressLabel("Done");
      toast.success("Provisional financials extracted");
      await reload();
      setTab("provisional");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      toast.error(msg);
      if (uploadedDocId) {
        await supabase.from("financial_documents")
          .update({ extraction_status: "failed", extraction_error: msg.slice(0, 500) })
          .eq("id", uploadedDocId);
      } else if (uploadedPath) {
        await supabase.storage.from("case-files").remove([uploadedPath]);
      }
      await reload();
    } finally {
      setTimeout(() => { setBusy(false); setProgress(0); setProgressLabel(""); }, 800);
    }
  };

  const topBar = (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
        <span className="text-primary font-semibold">{cc.case_code}</span>
        <span>·</span>
        <span className="truncate text-foreground">{cc.client_name}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <CollabAvatarStack />
        <ShareDialog caseCode={cc.case_code} clientName={cc.client_name} />
      </div>
    </div>
  );

  return (
    <TerminalLayout topBar={topBar}>
      <LiveCursors />
      {/* Header strip */}
      {editingHeader ? (
        <>
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 mb-3">
          <Panel title="Edit Case" ticker={cc.case_code} className="xl:col-span-8"
            actions={<button type="button" onClick={() => setEditingHeader(false)} className="text-sm text-muted-foreground hover:text-foreground border border-border rounded-md px-3 py-1.5 transition-colors">Cancel</button>}
          >
            <form onSubmit={saveHeader} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Product Type *</label>
                  <select className={inputCls} value={hd.product_type} onChange={sHd("product_type")}>
                    {Object.values(PRODUCTS).map(p => (
                      <option key={p.id} value={p.id}>{p.label}{p.isCore ? " ★ CORE" : ""}</option>
                    ))}
                  </select>
                  {hd.product_type === "other" && (
                    <input className={`${inputCls} mt-1`} placeholder="Specify product type…" value={hd.product_type_custom} onChange={sHd("product_type_custom")} />
                  )}
                </div>
                <div>
                  <label className={labelCls}>Client Name *</label>
                  <input required className={inputCls} value={hd.client_name} onChange={sHd("client_name")} />
                </div>
                <div>
                  <label className={labelCls}>Website</label>
                  <input className={inputCls} placeholder="example.com" value={hd.website} onChange={sHd("website")} />
                </div>
                <div className="col-span-2">
                  <button
                    type="button"
                    onClick={runEditWebEnrich}
                    disabled={editWebEnriching || (!hd.client_name.trim() && !hd.website.trim())}
                    className="w-full border border-primary/30 bg-primary/5 text-primary px-4 py-2 text-sm font-medium rounded-md hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  >
                    {editWebEnriching ? "Searching web and filling form…" : "Web Search & Auto-fill All Fields"}
                  </button>
                  {!hd.client_name.trim() && !hd.website.trim() && (
                    <p className="text-xs text-muted-foreground mt-1">Enter client name or website above first</p>
                  )}
                </div>

                {/* MCA / Corpository Excel import */}
                <div className="col-span-2">
                  <input
                    ref={editMcaFileInputRef}
                    type="file"
                    className="hidden"
                    accept=".xlsx,.xls,.csv"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) handleEditMcaExcelImport(f);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => editMcaFileInputRef.current?.click()}
                    disabled={editMcaImporting}
                    className="w-full border border-border bg-surface-2 text-muted-foreground px-4 py-2 text-xs tracking-widest font-bold hover:border-primary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  >
                    {editMcaImporting ? "Importing MCA Excel…" : "↑ Import Corpository / MCA Excel (auto-fills company + directors)"}
                  </button>
                  {editMcaProfile && (
                    <p className="text-[10px] text-success mt-1 tracking-wider">
                      ● MCA profile imported — {editMcaProfile.directors.length} director{editMcaProfile.directors.length !== 1 ? "s" : ""} · will save on update
                      {editMcaProfile.cin ? ` · CIN: ${editMcaProfile.cin}` : ""}
                      <button
                        type="button"
                        onClick={() => setEditMcaProfile(null)}
                        className="ml-2 text-destructive hover:opacity-70"
                      >
                        ✕ clear
                      </button>
                    </p>
                  )}
                </div>

                <div>
                  <label className={labelCls}>Legal Constitution</label>
                  <select className={inputCls} value={hd.legal_constitution} onChange={sHd("legal_constitution")}>
                    {["Pvt Ltd","Public Ltd","Partnership","LLP","Proprietorship","Individual"].map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Industry / Sector</label>
                  <select className={inputCls} value={hd.industry} onChange={sHd("industry")}>
                    <option value="">— Select Industry —</option>
                    {CASE_INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                  {hd.industry === "Other" && (
                    <input className={`${inputCls} mt-1`} placeholder="Specify industry…" value={hd.industry_custom} onChange={sHd("industry_custom")} />
                  )}
                </div>
                <div>
                  <label className={labelCls}>Year Established</label>
                  <input type="number" className={inputCls} value={hd.year_established} onChange={sHd("year_established")} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Promoter Details</label>
                  <textarea className={inputCls} rows={2} placeholder="Key promoters, directors, shareholding pattern…" value={hd.promoter_details} onChange={sHd("promoter_details")} />
                </div>
                <div>
                  <label className={labelCls}>Principal Borrower</label>
                  <input className={inputCls} value={hd.principal_borrower} onChange={sHd("principal_borrower")} />
                </div>
                <div>
                  <label className={labelCls}>Deal Amount (INR Crores)</label>
                  <input type="number" step="0.01" className={inputCls} value={hd.deal_amount} onChange={sHd("deal_amount")} />
                </div>
                <div>
                  <label className={labelCls}>Tenure (months)</label>
                  <input type="number" className={inputCls} value={hd.tenure_months} onChange={sHd("tenure_months")} />
                </div>
                <div>
                  <label className={labelCls}>Expected IRR (%)</label>
                  <input type="number" step="0.01" className={inputCls} value={hd.expected_irr} onChange={sHd("expected_irr")} />
                </div>
              </div>
              <div>
                <label className={labelCls}>End Use of Funds</label>
                <textarea className={inputCls} rows={2} value={hd.end_use} onChange={sHd("end_use")} />
              </div>
              <div>
                <label className={labelCls}>Strategic Rationale (Why Rehbar?)</label>
                <textarea className={inputCls} rows={2} placeholder="Shariya compliance / lender of last resort…" value={hd.strategic_rationale} onChange={sHd("strategic_rationale")} />
              </div>
              <div>
                <label className={labelCls}>Collateral Summary</label>
                <textarea className={inputCls} rows={2} value={hd.collateral_summary} onChange={sHd("collateral_summary")} />
              </div>
              <div>
                <label className={labelCls}>Analyst Notes</label>
                <textarea className={inputCls} rows={2} value={hd.analyst_notes} onChange={sHd("analyst_notes")} />
              </div>

              {/* ── Partner / Group Company ───────────────────────────── */}
              <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 space-y-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Partner / Group Company</div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setHd(h => ({ ...h, has_partner: !h.has_partner, partner_company_name: h.has_partner ? "" : h.partner_company_name }))}
                    className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${hd.has_partner ? "bg-primary" : "bg-border"}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${hd.has_partner ? "left-[22px]" : "left-0.5"}`} />
                  </button>
                  <span className="text-sm text-foreground">Does this deal involve a partner or group company?</span>
                </div>
                {hd.has_partner && (
                  <div>
                    <label className={labelCls}>Partner Company Name</label>
                    <input
                      className={inputCls}
                      placeholder="e.g. ABC Holdings Pvt Ltd"
                      value={hd.partner_company_name}
                      onChange={sHd("partner_company_name")}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Partner financials and analysis are available in the Partner tab.
                    </p>
                  </div>
                )}
              </div>

              {/* ── Assign To ─────────────────────────────────────────── */}
              <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 space-y-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Assign To</div>

                {teamMembers.length > 0 && (
                  <div>
                    <label className={labelCls}>Pick from team</label>
                    <select
                      className={inputCls}
                      value={hd.assign_email}
                      onChange={e => {
                        const picked = teamMembers.find(m => m.email === e.target.value);
                        if (picked) {
                          setHd(h => ({ ...h, assign_email: picked.email, assign_name: picked.full_name ?? "", assign_role: picked.role ?? "analyst" }));
                        } else if (e.target.value === "__new__") {
                          setHd(h => ({ ...h, assign_email: "__new__", assign_name: "", assign_role: "analyst" }));
                        } else {
                          setHd(h => ({ ...h, assign_email: "", assign_name: "", assign_role: "analyst" }));
                        }
                      }}
                    >
                      <option value="">— Select team member —</option>
                      {teamMembers.map(m => {
                        const rl: Record<string,string> = { admin:"ADM", analyst:"ANL", business_development:"BD", ic_member:"IC", credit_committee:"CC", operations:"OPS" };
                        return (
                          <option key={m.id} value={m.email}>
                            {m.full_name ? `${m.full_name} — ${m.email}` : m.email}{m.role ? ` [${rl[m.role] ?? m.role.toUpperCase()}]` : ""}
                          </option>
                        );
                      })}
                      <option value="__new__">+ Invite someone new…</option>
                    </select>
                  </div>
                )}

                {(teamMembers.length === 0 || hd.assign_email === "__new__" || (hd.assign_email && !teamMembers.find(m => m.email === hd.assign_email))) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className={labelCls}>Name (optional)</label>
                      <input type="text" className={inputCls} placeholder="Full name" value={hd.assign_name} onChange={sHd("assign_name")} />
                    </div>
                    <div>
                      <label className={labelCls}>Email</label>
                      <input type="email" className={inputCls} placeholder="analyst@rehbar.co.in"
                        value={hd.assign_email === "__new__" ? "" : hd.assign_email}
                        onChange={e => setHd(h => ({ ...h, assign_email: e.target.value }))}
                      />
                    </div>
                  </div>
                )}

                {hd.assign_email && hd.assign_email !== "__new__" && (
                  <div>
                    <label className={labelCls}>Role</label>
                    <select className={inputCls} value={hd.assign_role} onChange={sHd("assign_role")}>
                      <option value="analyst">Credit Analyst</option>
                      <option value="business_development">Business Development</option>
                      <option value="ic_member">IC Member</option>
                      <option value="credit_committee">Credit Committee</option>
                      <option value="operations">Operations</option>
                      <option value="admin">Administrator</option>
                    </select>
                  </div>
                )}

                {hd.assign_email && hd.assign_email !== "__new__" && (
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-muted-foreground">
                      Assigned to <span className="text-primary font-bold">{hd.assign_name || hd.assign_email}</span>
                      {!teamMembers.find(m => m.email === hd.assign_email) && " · invite will be sent on save"}
                    </p>
                    <button type="button" onClick={() => setHd(h => ({ ...h, assign_email: "", assign_name: "", assign_role: "analyst" }))}
                      className="text-xs text-muted-foreground hover:text-destructive transition-colors">Clear ×</button>
                  </div>
                )}
              </div>

              <button type="submit" className="bg-primary text-primary-foreground px-6 py-2.5 rounded-md text-sm font-semibold hover:bg-primary/90 transition-colors">
                Update Case
              </button>
            </form>
          </Panel>
          <div className="xl:col-span-4 flex flex-col gap-3">
            <Panel title="Product Rules" ticker={PRODUCTS[hd.product_type as ProductType]?.short ?? "—"} status="warn">
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Legal Nature</div>
                  <div className="text-sm text-foreground">{PRODUCTS[hd.product_type as ProductType]?.legalNature}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Return Mechanism</div>
                  <div className="text-sm text-foreground">{PRODUCTS[hd.product_type as ProductType]?.returnMechanism}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">SOP Rules</div>
                  <ul className="space-y-1.5">
                    {PRODUCTS[hd.product_type as ProductType]?.rules.map((r, i) => (
                      <li key={i} className="text-sm text-foreground flex gap-2"><span className="w-1.5 h-1.5 rounded-full bg-primary/60 mt-1.5 shrink-0" /><span>{r}</span></li>
                    ))}
                  </ul>
                </div>
              </div>
            </Panel>

            {/* AI Document Scan for edit case */}
            <Panel title="AI Document Scan" ticker="Claude 4.6" status="live">
              <div className="space-y-3 text-xs">
                <p className="text-foreground/60 leading-relaxed">
                  Upload a company profile, loan application, CMA, or any relevant document.
                  Claude will read it and auto-fill the edit form.
                </p>
                <div
                  className={`border-2 border-dashed transition-colors cursor-pointer ${
                    editDragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                  } ${editScanning ? "pointer-events-none opacity-50" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setEditDragOver(true); }}
                  onDragLeave={() => setEditDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setEditDragOver(false); const files = Array.from(e.dataTransfer.files); if (files.length) handleEditScanFiles(files); }}
                  onClick={() => editFileInputRef.current?.click()}
                >
                  <input
                    ref={editFileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.xlsx,.xls,.csv,.jpg,.jpeg,.png,.webp"
                    multiple
                    onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) handleEditScanFiles(files); e.target.value = ""; }}
                  />
                  {editScanFileQueue.length > 0 ? (
                    <div className="px-3 py-2">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs font-semibold text-foreground">
                          {editScanFileQueue.length} file{editScanFileQueue.length > 1 ? "s" : ""}
                        </span>
                        <span className="text-xs text-muted-foreground">· drop more to add</span>
                      </div>
                      <div className="space-y-1 max-h-28 overflow-y-auto">
                        {editScanFileQueue.map(item => (
                          <div key={item.id} className="flex items-center gap-1.5 text-xs">
                            <span className={
                              item.status === "done"      ? "text-green-500" :
                              item.status === "error"     ? "text-red-500"   :
                              item.status === "uploading" ? "text-primary"   :
                              item.status === "duplicate" ? "text-yellow-500": "text-muted-foreground/40"
                            }>
                              {item.status === "done" ? "●" : item.status === "error" ? "✗" : item.status === "uploading" ? "▶" : item.status === "duplicate" ? "◎" : "○"}
                            </span>
                            <span className="truncate flex-1 text-foreground">{item.name}</span>
                            <span className="text-muted-foreground shrink-0">{item.size}</span>
                            {item.status === "uploading" && (
                              <span className="text-primary shrink-0 w-8 text-right">{item.uploadPct}%</span>
                            )}
                            {item.status === "duplicate" && (
                              <span className="text-amber-500 shrink-0 text-xs">Duplicate</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="px-3 py-5 text-center">
                      <div className="text-muted-foreground text-2xl mb-2">⬆</div>
                      <div className="text-sm font-medium text-foreground">Drop files here or click to browse</div>
                      <div className="text-xs text-muted-foreground mt-1">PDF · Image · Multiple files OK</div>
                    </div>
                  )}
                </div>

                {editWebEnriching && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-foreground/60 text-xs">
                      <span>Searching web &amp; analysing…</span>
                      <span className="font-mono text-primary">{editWebEnrichPct}%</span>
                    </div>
                    <div className="w-full h-1 bg-border">
                      <div className="h-1 bg-primary transition-all duration-300" style={{ width: `${editWebEnrichPct}%` }} />
                    </div>
                  </div>
                )}

                {editScanning && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-foreground/60">
                      <span>{editScanStage}</span>
                      <span>{editScanPct}%</span>
                    </div>
                    <div className="w-full h-1 bg-border">
                      <div className="h-1 bg-primary transition-all duration-300" style={{ width: `${editScanPct}%` }} />
                    </div>
                    <button
                      type="button"
                      onClick={resetEditScan}
                      className="w-full border border-border text-muted-foreground py-1.5 text-sm rounded-md hover:border-red-300 hover:text-red-500 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {editScanResult && (
                  <div className="space-y-2">
                    {editScanResult.summary && (
                      <div className="rounded-lg border border-border p-3 bg-muted/20">
                        <div className="text-xs font-semibold text-muted-foreground mb-1.5">AI Summary</div>
                        <p className="text-foreground/80 leading-relaxed">{editScanResult.summary}</p>
                        {editScanResult.confidence != null && (
                          <div className="mt-1.5 flex items-center gap-2">
                            <div className="flex-1 h-0.5 bg-border">
                              <div
                                className={`h-0.5 ${editScanResult.confidence >= 70 ? "bg-green-500" : editScanResult.confidence >= 40 ? "bg-yellow-500" : "bg-red-500"}`}
                                style={{ width: `${editScanResult.confidence}%` }}
                              />
                            </div>
                            <span className="text-foreground/50">{editScanResult.confidence}% conf.</span>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="text-xs font-semibold text-muted-foreground mb-1">Extracted Fields</div>
                    <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                      {EDIT_SCANNABLE_FIELDS.map(({ key, label }) => {
                        const val = editScanResult[key];
                        if (val == null || val === "") return null;
                        return (
                          <div key={key} className="flex gap-2 text-sm">
                            <span className="text-muted-foreground shrink-0 w-28">{label}</span>
                            <span className="text-foreground truncate">{String(val)}</span>
                          </div>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={applyEditScanned}
                      className="w-full bg-primary text-primary-foreground py-2 rounded-md text-sm font-semibold hover:bg-primary/90 transition-colors"
                    >
                      Apply to Form
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditScanResult(null); setEditScanFileQueue([]); }}
                      className="w-full border border-border text-muted-foreground py-2 rounded-md text-sm hover:bg-muted/30 transition-colors"
                    >
                      Discard
                    </button>
                  </div>
                )}
              </div>
            </Panel>
          </div>
        </div>

        {/* MCA profile + directors — shown below grid when Excel imported */}
        {editMcaProfile && (
          <div className="space-y-3 mt-3">
            <Panel title="MCA / Corpository Profile" ticker={editMcaProfile.cin ?? "Imported"} status="live">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 text-xs">
                {[
                  { label: "CIN",                value: editMcaProfile.cin },
                  { label: "PAN",                value: editMcaProfile.pan },
                  { label: "LEI",                value: editMcaProfile.lei },
                  { label: "CATEGORY",           value: editMcaProfile.category },
                  { label: "SUB CATEGORY",       value: editMcaProfile.sub_category },
                  { label: "COMPANY TYPE",       value: editMcaProfile.mca_type },
                  { label: "AUTH. CAPITAL",      value: editMcaProfile.authorized_capital },
                  { label: "PAID UP CAPITAL",    value: editMcaProfile.paid_up_capital },
                  { label: "STATUS",             value: editMcaProfile.mca_status },
                  { label: "NSE SECTOR",         value: editMcaProfile.nse_sector },
                  { label: "SECTOR",             value: editMcaProfile.sector },
                  { label: "PRODUCTS/SERVICES",  value: editMcaProfile.products_services },
                  { label: "EMAIL",              value: editMcaProfile.email },
                  { label: "TELEPHONE",          value: editMcaProfile.telephone },
                  { label: "INCORPORATION DATE", value: editMcaProfile.date_of_incorporation },
                  { label: "LAST BALANCE SHEET", value: editMcaProfile.date_of_last_bs },
                  { label: "LAST AGM",           value: editMcaProfile.date_of_last_agm },
                ].filter(f => f.value).map(f => (
                  <div key={f.label}>
                    <div className="text-xs text-muted-foreground mb-0.5">{f.label}</div>
                    <div className="text-sm text-foreground font-mono">{f.value}</div>
                  </div>
                ))}
                {editMcaProfile.raw_address && (
                  <div className="col-span-2 sm:col-span-3 lg:col-span-5">
                    <div className="text-xs text-muted-foreground mb-0.5">Registered Address</div>
                    <div className="text-sm text-foreground">{editMcaProfile.raw_address}</div>
                  </div>
                )}
              </div>
            </Panel>

            {editMcaProfile.directors.length > 0 && (
              <Panel title="Directors" ticker={`${editMcaProfile.directors.length} directors`} status="live">
                <div className="overflow-x-auto">
                  <table className="text-xs font-mono border-collapse" style={{ minWidth: "2400px" }}>
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {["Name","DIN","PAN","DIN Status","DSC Status","DOB","Age","Gender","Nationality",
                          "Designation","Category","Appointed Current","Originally Appointed",
                          "Cessation","% Shareholding","Email","Phone","Remarks","Address"].map(h => (
                          <th key={h} className="text-left py-2 px-3 font-medium text-muted-foreground whitespace-nowrap border-r border-border/30">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {editMcaProfile.directors.map((d, i) => {
                        const dm = d.designation?.match(/^(.+?)\((.+?)\)$/);
                        const role = dm ? dm[1].trim() : (d.designation || "");
                        const cat  = dm ? dm[2].trim() : "";
                        return (
                          <tr key={i} className="border-b border-border/40 hover:bg-surface-2 transition-colors align-top">
                            <td className="py-2 px-3 whitespace-nowrap border-r border-border/20">
                              <div className="font-bold text-primary">{d.name}</div>
                            </td>
                            <td className="py-2 px-3 text-muted-foreground whitespace-nowrap border-r border-border/20">{d.din || "—"}</td>
                            <td className="py-2 px-3 text-muted-foreground whitespace-nowrap border-r border-border/20">{d.pan || "—"}</td>
                            <td className="py-2 px-3 whitespace-nowrap border-r border-border/20">
                              {d.din_status ? <span className={`text-xs font-medium ${d.din_status.toLowerCase() === "approved" ? "text-green-600" : "text-muted-foreground"}`}>{d.din_status}</span> : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="py-2 px-3 text-muted-foreground whitespace-nowrap border-r border-border/20">{d.dsc_status || "—"}</td>
                            <td className="py-2 px-3 text-muted-foreground whitespace-nowrap border-r border-border/20">{d.dob || "—"}</td>
                            <td className="py-2 px-3 text-muted-foreground whitespace-nowrap border-r border-border/20">{d.age || "—"}</td>
                            <td className="py-2 px-3 whitespace-nowrap border-r border-border/20">
                              {d.gender ? <span className={`text-xs font-medium ${d.gender.toLowerCase() === "female" ? "text-purple-600" : "text-foreground"}`}>{d.gender}</span> : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="py-2 px-3 text-muted-foreground whitespace-nowrap border-r border-border/20">{d.nationality || "—"}</td>
                            <td className="py-2 px-3 whitespace-nowrap border-r border-border/20 text-primary">{role || "—"}</td>
                            <td className="py-2 px-3 whitespace-nowrap border-r border-border/20">
                              {cat && cat !== "-" ? <span className="text-xs text-muted-foreground">{cat}</span> : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="py-2 px-3 text-muted-foreground whitespace-nowrap border-r border-border/20">{d.appointed_current || "—"}</td>
                            <td className="py-2 px-3 text-muted-foreground whitespace-nowrap border-r border-border/20">{d.originally_appointed || "—"}</td>
                            <td className="py-2 px-3 whitespace-nowrap border-r border-border/20">
                              {d.cessation_date && d.cessation_date !== "-"
                                ? <span className="text-xs font-medium text-red-600">{d.cessation_date}</span>
                                : <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 border border-green-200">Active</span>}
                            </td>
                            <td className="py-2 px-3 border-r border-border/20 whitespace-nowrap">
                              {d.shareholding ? <span className="text-muted-foreground">{d.shareholding}</span> : "—"}
                            </td>
                            <td className="py-2 px-3 text-muted-foreground whitespace-nowrap border-r border-border/20">{d.email || "—"}</td>
                            <td className="py-2 px-3 text-muted-foreground whitespace-nowrap border-r border-border/20">{d.phone || "—"}</td>
                            <td className="py-2 px-3 border-r border-border/20" style={{maxWidth:"180px"}}>
                              <div className="text-muted-foreground text-[10px] leading-snug line-clamp-2" style={{wordBreak:"break-word"}} title={d.remarks||""}>{d.remarks || "—"}</div>
                            </td>
                            <td className="py-2 px-3" style={{maxWidth:"200px"}}>
                              <div className="text-muted-foreground text-[10px] leading-snug line-clamp-2" style={{wordBreak:"break-word"}} title={d.address||""}>{d.address || "—"}</div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}
          </div>
        )}
        </>
      ) : (
        /* ── Header (always visible) + optional detail panel below ─────────── */
        <div className="space-y-3 mb-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-12 gap-3">
            <Panel title="Case" ticker={cc.case_code} className="sm:col-span-2 xl:col-span-4"
              actions={<button onClick={openHeaderEdit} className="text-sm text-muted-foreground hover:text-foreground transition-colors">Edit</button>}
            >
              <div className="text-2xl font-bold text-foreground">{cc.client_name}</div>
              <div className="text-sm text-muted-foreground mt-1">{product.label} · {cc.industry || "—"}</div>
              {(cc as unknown as { company_id?: string }).company_id ? (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => navigate(`/companies/${(cc as unknown as { company_id: string }).company_id}`)}
                    className="inline-flex items-center gap-1.5 text-xs border border-green-300 text-green-700 bg-green-50 px-2 py-1 rounded hover:bg-green-100 transition-colors"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    Master Data Linked
                  </button>
                  <button
                    onClick={async () => {
                      await supabase.from("credit_cases").update({ company_id: null } as never).eq("id", cc.id);
                      await reload();
                      toast.success("Company unlinked");
                    }}
                    className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                  >
                    Unlink
                  </button>
                </div>
              ) : (
                <div className="mt-2 text-xs text-muted-foreground/60">Not linked to master data</div>
              )}
            </Panel>
            <Panel title="Status" className="xl:col-span-3">
              <div className={`inline-block px-3 py-1.5 text-sm font-semibold rounded-md bg-${statusMeta.color}/10 text-${statusMeta.color}-700 border border-${statusMeta.color}/20`}>
                {statusMeta.label}
              </div>
              <div className="text-xs text-muted-foreground mt-2">Stage {statusMeta.pipeline} of 7</div>
            </Panel>
            <Panel title="Deal Terms" className="xl:col-span-5"
              actions={<button onClick={openHeaderEdit} className="text-sm text-muted-foreground hover:text-foreground transition-colors">Edit</button>}
            >
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Amount</div>
                  <div className="text-base font-semibold text-foreground">₹{Number(cc.deal_amount ?? 0).toLocaleString("en-IN")} Cr</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Tenure</div>
                  <div className="text-base font-semibold text-foreground">{cc.tenure_months ?? "—"} months</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">IRR</div>
                  <div className="text-base font-semibold text-foreground">{cc.expected_irr ?? "—"}%</div>
                </div>
              </div>
            </Panel>
          </div>

          <Panel
            title="Company Details"
            ticker={cc.case_code}
            actions={
              <div className="flex items-center gap-2">
                {coDetailTab === "company" && linkedCompany && (
                  <button onClick={openEditCo} className="text-sm text-muted-foreground hover:text-foreground transition-colors">Edit</button>
                )}
                {coDetailTab === "directors" && linkedCompany && (
                  <button onClick={() => openEditDir()} className="text-sm text-primary hover:text-primary/80 transition-colors font-medium">+ Add Director</button>
                )}
                <div className="flex rounded-md border border-border overflow-hidden">
                  <button
                    onClick={() => setCoDetailTab("company")}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${coDetailTab === "company" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
                  >
                    Company
                  </button>
                  {linkedCompany && (
                    <button
                      onClick={() => setCoDetailTab("directors")}
                      className={`px-3 py-1.5 text-xs font-medium border-l border-border transition-colors ${coDetailTab === "directors" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
                    >
                      Directors {linkedDirs.length > 0 ? `(${linkedDirs.length})` : ""}
                    </button>
                  )}
                </div>
              </div>
            }
          >
            {coDetailTab === "company" && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
                  {([
                    ["Legal Constitution",  cc.legal_constitution],
                    ["Industry / Sector",   cc.industry],
                    ["Year Established",    cc.year_established],
                    ["Principal Borrower",  cc.principal_borrower],
                    ["Website",             cc.website],
                  ] as const).map(([label, val]) => val != null && val !== "" ? (
                    <div key={label}>
                      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
                      <div className="text-sm text-foreground font-medium">{String(val)}</div>
                    </div>
                  ) : null)}
                </div>

                {linkedCompany && (linkedCompany.mca_cin || linkedCompany.mca_pan) && (
                  <div className="border-t border-border/40 mt-3 pt-3">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">MCA / Corpository Profile</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
                      {([
                        ["CIN",                  linkedCompany.mca_cin],
                        ["PAN",                  linkedCompany.mca_pan],
                        ["LEI",                  linkedCompany.mca_lei],
                        ["Category",             linkedCompany.mca_category],
                        ["Sub Category",         linkedCompany.mca_sub_category],
                        ["Company Type",         linkedCompany.mca_type],
                        ["Authorised Capital",   linkedCompany.mca_authorized_capital],
                        ["Paid Up Capital",      linkedCompany.mca_paid_up_capital],
                        ["Status",               linkedCompany.mca_status],
                        ["NSE Sector",           linkedCompany.mca_nse_sector],
                        ["Sector",               linkedCompany.mca_sector],
                        ["Products / Services",  linkedCompany.mca_products_services],
                        ["Email",                linkedCompany.mca_email],
                        ["Telephone",            linkedCompany.mca_telephone],
                        ["Incorporation Date",   linkedCompany.mca_date_of_incorp],
                        ["Last Balance Sheet",   linkedCompany.mca_date_last_bs],
                        ["Last AGM",             linkedCompany.mca_date_last_agm],
                      ] as const).filter(([, v]) => v).map(([label, val]) => (
                        <div key={label}>
                          <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
                          <div className="text-sm text-foreground font-medium font-mono">{val}</div>
                        </div>
                      ))}
                    </div>
                    {linkedCompany.mca_about && (
                      <div className="mt-3 text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap border-t border-border/30 pt-3">
                        {linkedCompany.mca_about}
                      </div>
                    )}
                  </div>
                )}

                {(cc.end_use || cc.collateral_summary || cc.strategic_rationale || cc.promoter_details || cc.analyst_notes) && (
                  <div className="border-t border-border/40 mt-4 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                    {([
                      ["End Use of Funds",    cc.end_use],
                      ["Collateral Summary",  cc.collateral_summary],
                      ["Strategic Rationale", cc.strategic_rationale],
                      ["Promoter Details",    cc.promoter_details],
                      ["Analyst Notes",       cc.analyst_notes],
                    ] as const).map(([label, val]) => val ? (
                      <div key={label}>
                        <div className="text-xs font-medium text-muted-foreground mb-1">{label}</div>
                        <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{val}</div>
                      </div>
                    ) : null)}
                  </div>
                )}
              </>
            )}

            {coDetailTab === "directors" && (
              <div className="overflow-x-auto">
                <table className="text-[11px] border-collapse" style={{ minWidth: "2200px" }}>
                  <thead>
                    <tr className="border-b border-border bg-surface/60">
                      {[
                        "","Name","DIN","PAN","DIN Status","DSC Status",
                        "DOB","Age","Gender","Nationality",
                        "Designation","Category","Appointed (Current)","Originally Appointed",
                        "Cessation","% Shareholding","Email","Phone","Remarks","Address",
                      ].map(h => (
                        <th key={h} className="text-left py-2 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap border-r border-border/30">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {linkedDirs.map((d, i) => (
                      <tr key={i} className="border-b border-border/20 hover:bg-surface/40 transition-colors align-top">
                        <td className="py-2 px-2 whitespace-nowrap border-r border-border/20">
                          <div className="flex gap-1">
                            <button onClick={() => openEditDir(d)} className="text-xs border border-border rounded text-muted-foreground hover:text-primary hover:border-primary/40 px-1.5 py-0.5 transition-colors">✎</button>
                            <button onClick={() => deleteDir(String(d.id))} className="text-xs border border-border rounded text-muted-foreground hover:text-destructive hover:border-destructive/40 px-1.5 py-0.5 transition-colors">✕</button>
                          </div>
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap border-r border-border/20">
                          <div className="text-primary font-medium">{d.name}</div>
                          {d.dob && <div className="text-muted-foreground text-xs mt-0.5">DOB: {d.dob}</div>}
                        </td>
                        <td className="py-2 px-3 font-mono text-primary/80 whitespace-nowrap border-r border-border/20">{d.din || "—"}</td>
                        <td className="py-2 px-3 font-mono text-primary/80 whitespace-nowrap border-r border-border/20">{d.pan || "—"}</td>
                        <td className="py-2 px-3 whitespace-nowrap border-r border-border/20">
                          <span className={d.din_status?.toLowerCase().includes("approved") ? "text-success" : "text-muted-foreground"}>
                            {d.din_status || "—"}
                          </span>
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap border-r border-border/20 text-muted-foreground">{d.dsc_status || "—"}</td>
                        <td className="py-2 px-3 whitespace-nowrap border-r border-border/20">{d.dob || "—"}</td>
                        <td className="py-2 px-3 whitespace-nowrap border-r border-border/20 text-center">{d.age || "—"}</td>
                        <td className="py-2 px-3 whitespace-nowrap border-r border-border/20">{d.gender || "—"}</td>
                        <td className="py-2 px-3 whitespace-nowrap border-r border-border/20">{d.nationality || "—"}</td>
                        {(() => {
                          const m = d.designation?.match(/^(.+?)\((.+?)\)$/);
                          const role = m ? m[1].trim() : (d.designation || "—");
                          const cat  = m ? m[2].trim() : "";
                          return (
                            <>
                              <td className="py-2 px-3 whitespace-nowrap border-r border-border/20 text-primary">{role}</td>
                              <td className="py-2 px-3 whitespace-nowrap border-r border-border/20">
                                {cat && cat !== "-" ? <span className="text-xs text-muted-foreground">{cat}</span> : <span className="text-muted-foreground">—</span>}
                              </td>
                            </>
                          );
                        })()}
                        <td className="py-2 px-3 whitespace-nowrap border-r border-border/20">{d.appointed_current || "—"}</td>
                        <td className="py-2 px-3 whitespace-nowrap border-r border-border/20">{d.originally_appointed || "—"}</td>
                        <td className="py-2 px-3 whitespace-nowrap border-r border-border/20">
                          {d.cessation_date && d.cessation_date !== "-"
                            ? <span className="text-destructive text-xs">{d.cessation_date}</span>
                            : <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 border border-green-200">Active</span>}
                        </td>
                        <td className="py-2 px-3 border-r border-border/20 whitespace-nowrap">
                          {d.shareholding ? (() => {
                            const m = String(d.shareholding).match(/^(.+?)\s*(\(.+\))$/);
                            return m ? <><div>{m[1].trim()}</div><div className="text-[8px] text-muted-foreground/50 mt-0.5">{m[2]}</div></> : <span>{d.shareholding}</span>;
                          })() : "—"}
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap border-r border-border/20 text-muted-foreground">{d.email || "—"}</td>
                        <td className="py-2 px-3 whitespace-nowrap border-r border-border/20 font-mono text-muted-foreground">{d.phone || "—"}</td>
                        <td className="py-2 px-3 border-r border-border/20" style={{maxWidth:"180px"}}>
                          {d.remarks && d.remarks !== "—" ? (
                            <div className="relative">
                              <div className="text-muted-foreground text-[10px] leading-snug line-clamp-2 pr-14" style={{wordBreak:"break-word"}}>{d.remarks}</div>
                              <button onClick={()=>setTextPopover({label:"REMARKS",text:String(d.remarks)})} className="absolute bottom-0 right-0 text-[8px] text-primary/60 hover:text-primary tracking-widest bg-card pl-1">read more</button>
                            </div>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-2 px-3" style={{maxWidth:"200px"}}>
                          {d.address && d.address !== "—" ? (
                            <div className="relative">
                              <div className="text-muted-foreground text-[10px] leading-snug line-clamp-2 pr-14" style={{wordBreak:"break-word"}}>{d.address}</div>
                              <button onClick={()=>setTextPopover({label:"ADDRESS",text:String(d.address)})} className="absolute bottom-0 right-0 text-[8px] text-primary/60 hover:text-primary tracking-widest bg-card pl-1">read more</button>
                            </div>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* AI proactive alert banner */}
      {aiAlert && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-3 text-sm">
          <svg className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span className="text-amber-800 flex-1 leading-snug font-medium">AI Notice:</span>
          <span className="text-amber-700 flex-1 leading-snug">{aiAlert}</span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => { window.dispatchEvent(new CustomEvent("toggle-analyst-chat")); }}
              className="text-xs font-medium border border-amber-300 text-amber-700 px-3 py-1 rounded hover:bg-amber-100 transition-colors"
            >Ask AI</button>
            <button
              onClick={() => { setAiAlert(null); sessionStorage.setItem(`ai-alert-dismissed-${id}`, "1"); }}
              className="text-amber-400 hover:text-amber-700 transition-colors text-lg leading-none px-1"
            >×</button>
          </div>
        </div>
      )}

      {/* Entity selector — shown only when deal has a partner company */}
      {/* Tabs */}
      <div className="sticky top-[132px] z-30 bg-background -mx-3 px-3">
        <div className="overflow-x-auto mb-3">
        <div className="flex gap-1 bg-muted/40 rounded-lg p-1 min-w-max border border-border">
          {([
            ["review",      "Review"],
            ["provisional", "Provisional"],
            ["ratios",      "Ratios"],
            ["projections", "Projections"],
            ["bank",           "Bank"],
            ["gst",            "GST"],
            ["cibil",          "CIBIL"],
            ["triangulation",  "Triangulation"],
            ["visit_report",   "Visit Report"],
            ["ic_note",        "IC Note"],
          ] as const).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-3 sm:px-4 py-2 text-sm font-medium rounded-md whitespace-nowrap flex items-center gap-1.5 transition-colors ${tab === k ? "bg-white text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground hover:bg-white/50"}`}
            >{l}<TabPresenceDots tabKey={k} /></button>
          ))}
          {hasPartner && (
            <button
              onClick={() => { setTabRaw("partner"); window.scrollTo({ top: 0 }); }}
              className={`px-3 sm:px-4 py-2 text-sm font-medium rounded-md whitespace-nowrap flex items-center gap-1.5 transition-colors ${tab === "partner" ? "bg-amber-500 text-white shadow-sm" : "text-amber-600 hover:bg-amber-50"}`}
            >Partner</button>
          )}
        </div>
        </div>
        {/* Partner sub-tab bar — visible only when PARTNER tab is active */}
        {tab === "partner" && (
          <div className="overflow-x-auto mb-3">
            <div className="flex items-center gap-1 bg-amber-50 rounded-lg p-1 border border-amber-200 min-w-max">
              <div className="px-3 py-1.5 text-xs font-semibold text-amber-700 border-r border-amber-200 flex items-center shrink-0 max-w-[200px] truncate mr-1">
                {partnerCompanyName}
              </div>
              {(["review", "ratios", "bank", "gst"] as const).map(k => (
                <button
                  key={k}
                  onClick={() => setPartnerSubTab(k)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors capitalize ${
                    partnerSubTab === k ? "bg-amber-500 text-white shadow-sm" : "text-amber-600 hover:bg-amber-100"
                  }`}
                >{k === "ic_note" ? "IC Note" : k.charAt(0).toUpperCase() + k.slice(1)}</button>
              ))}
            </div>
          </div>
        )}
      </div>


      {(tab === "review" || (tab === "partner" && partnerSubTab === "review")) && (
        <div className="space-y-3">
          {/* Upload panel — always visible at top of Review tab */}
          {(() => {
            const activeDocs = (tab === "partner") ? partnerDocs : (!hasPartner || entity === "main") ? mainDocs : partnerDocs;
            return (
              <Panel title="Upload Financial Statements" ticker="PDF / XLSX / Image">
                {hasPartner && tab !== "partner" && entityBar}
                {extractError && (
                  <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-red-700 font-semibold text-sm">{extractError.title}</span>
                      <button onClick={() => setExtractError(null)} className="text-red-400 hover:text-red-700 text-lg leading-none px-1 transition-colors">×</button>
                    </div>
                    {extractError.detail && <div className="text-red-600 text-sm">{extractError.detail}</div>}
                    {extractError.action && <div className="text-amber-700 text-xs">↳ {extractError.action}</div>}
                  </div>
                )}
                <UploadGrid onUpload={(f, cls, fy) => handleUpload(f, cls, fy)} onCancel={handleCancelUpload} onDelete={handleDeleteDoc} onEdit={handleEditDoc} onRetry={handleRetry} busy={busy} docs={activeDocs} extracted={extracted} progress={progress} progressLabel={progressLabel} />
              </Panel>
            );
          })()}

          <div className="flex items-center gap-2 sticky top-[168px] z-20 bg-background -mx-3 px-3 pt-1 pb-2 border-b border-border/30">
            <input ref={finExcelInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importFinancialExcel(f); e.target.value = ""; }} />
            <button
              onClick={() => finExcelInputRef.current?.click()}
              disabled={importingFinExcel}
              className="text-xs border border-primary/40 rounded text-primary hover:bg-primary/10 px-3 py-1.5 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
            >{importingFinExcel ? "Importing…" : "⬆ Import Financial Excel"}</button>
            <button
              onClick={downloadFinancialTemplate}
              className="text-xs border border-border rounded text-muted-foreground px-3 py-1.5 hover:text-foreground hover:border-primary/50 flex items-center gap-1 transition-colors"
            >⬇ Template</button>
            <span className="text-xs text-muted-foreground">Supports Balance Sheet · P&L · Cash Flow sheets</span>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={performUndo}
                disabled={undoStack.length === 0}
                title="Undo (Ctrl+Z)"
                className="text-xs border border-border rounded px-2 py-1 text-muted-foreground hover:text-foreground hover:border-primary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >↩ Undo {undoStack.length > 0 && <span className="text-[10px] opacity-60">({undoStack.length})</span>}</button>
              <button
                onClick={performRedo}
                disabled={redoStack.length === 0}
                title="Redo (Ctrl+Y)"
                className="text-xs border border-border rounded px-2 py-1 text-muted-foreground hover:text-foreground hover:border-primary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >↪ Redo {redoStack.length > 0 && <span className="text-[10px] opacity-60">({redoStack.length})</span>}</button>
            </div>
          </div>

          {hasPartner && tab !== "partner" && entityBar}

          {(() => {
            const viewExtracted = activeExtracted;

            if ((tab === "partner" || (hasPartner && entity === "partner")) && partnerExtracted.length === 0) {
              return (
                <PartnerAnalysisTab
                  cc={cc}
                  partners={ic?.partners ?? []}
                  onSave={savePartners}
                />
              );
            }

            const hasFinancialDocs = mainDocs.some(d =>
              ["all_in_one","profit_loss","balance_sheet","cash_flow","provisional"].includes(d.doc_class ?? "")
            );
            const reviewEmptyState = (
              <div className="flex flex-col items-center justify-center gap-4 py-12">
                {hasFinancialDocs ? (
                  <div className="flex flex-col items-center gap-3 text-center max-w-sm">
                    <span className="text-xl text-warning">⚠</span>
                    <span className="text-sm font-semibold text-amber-700">No Financial Tables Detected</span>
                    <span className="text-sm text-muted-foreground leading-relaxed">
                      A file was uploaded but no Balance Sheet, P&amp;L, or Cash Flow tables were found.
                      Make sure you upload the <strong>audited financial statements</strong> PDF — not a proposal, pitch deck, or cover letter.
                    </span>
                    <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="text-sm text-primary border border-primary/40 rounded hover:bg-primary/10 px-3 py-1.5 transition-colors mt-1">
                      ↑ Upload Correct File
                    </button>
                  </div>
                ) : (
                  <>
                    <label
                      onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("!border-primary","bg-primary/5"); }}
                      onDragLeave={e => { e.currentTarget.classList.remove("!border-primary","bg-primary/5"); }}
                      onDrop={e => {
                        e.preventDefault();
                        e.currentTarget.classList.remove("!border-primary","bg-primary/5");
                        const f = e.dataTransfer.files[0];
                        if (f) handleUpload(f, "all_in_one" as DocClass, null);
                      }}
                      className="flex flex-col items-center justify-center gap-3 w-full max-w-md border-2 border-dashed border-border rounded px-8 py-10 cursor-pointer transition-colors hover:border-primary/50 hover:bg-surface"
                    >
                      <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f, "all_in_one" as DocClass, null); e.target.value = ""; }} />
                      <span className="text-2xl text-muted-foreground">⬆</span>
                      <span className="text-sm font-semibold text-foreground">Drop PDF or Excel here</span>
                      <span className="text-xs text-muted-foreground">or click to browse · auto-detects all statement types</span>
                    </label>
                    <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="text-sm text-muted-foreground hover:text-primary border border-border rounded hover:border-primary/50 px-3 py-1.5 transition-colors">
                      ↑ Scroll to Upload
                    </button>
                  </>
                )}
              </div>
            );
            const extracted = viewExtracted.filter(r => r.statement_type !== "projections");
            if (extracted.length === 0) return reviewEmptyState;
            // Standard label order per type for consistent row ordering
            const AUTOFIX_TARGET: Record<string, { stmtType: string; label: string }> = {
              pl_gross:   { stmtType: "profit_loss",   label: "Gross Profit" },
              pl_ebitda:  { stmtType: "profit_loss",   label: "EBITDA" },
              pl_ebit:    { stmtType: "profit_loss",   label: "EBIT" },
              pl_pbt:     { stmtType: "profit_loss",   label: "Profit Before Tax" },
              pl_pat:     { stmtType: "profit_loss",   label: "PAT" },
              bs_balance: { stmtType: "balance_sheet", label: "Total Assets" },
              cf_net:     { stmtType: "cash_flow",     label: "Net Change in Cash" },
              cf_close:   { stmtType: "cash_flow",     label: "Closing Cash" },
            };
            const STD_ORDER: Record<string, string[]> = {
              profit_loss: ["Turnover","Cost of Goods Sold","Gross Profit","Operating Expenses","EBITDA","Depreciation","EBIT","Interest Expense","Profit Before Tax","Tax","PAT"],
              balance_sheet: ["Share Capital","Reserves & Surplus","Net Worth","Long Term Borrowings","Short Term Borrowings","Total Debt","Trade Payables","Other Current Liabilities","Current Liabilities","Total Liabilities","Fixed Assets (Net)","Inventory","Trade Receivables","Cash & Bank","Other Current Assets","Current Assets","Total Assets","Capital Employed"],
              cash_flow: [
                "Net Profit Before Tax","Depreciation & Amortisation","Profit/Loss on Asset Sale",
                "Profit/Loss on Investments","Interest/Investment Income","Interest Expense",
                "Operating Profit Before WC Changes",
                "Change in Trade Payables","Change in Short-term Borrowings","Change in Provisions",
                "Change in Other Current Liabilities","Change in ST Loans & Advances",
                "Change in Other Current Assets","Change in Trade Receivables","Change in Inventories",
                "Cash from Operations","Taxes Paid","Net Cash from Operations",
                "Purchase of Fixed Assets","Change in LT Loans & Advances","Change in Non-Current Investments",
                "Change in Fixed Deposits","Proceeds from Equity","Dividends/Interest Received",
                "Cash from Investing","Interest Paid","Funds Borrowed","Dividend Paid","Cash from Financing",
                "Net Change in Cash","Opening Cash","Closing Cash",
              ],
              projections: ["Projected Turnover","Projected EBITDA","Projected PAT","Projected Net Worth","Projected Total Debt"],
            };
            const stmtTypes = Array.from(new Set(extracted.map(r => r.statement_type))).filter(t => t !== "projections");
            return stmtTypes.map(type => {
              const typeRows = extracted.filter(r => r.statement_type === type).sort((a, b) => a.fiscal_year - b.fiscal_year);
              const years = typeRows.map(r => r.fiscal_year);
              const unit = typeRows.find(r => r.unit)?.unit;
              const abbr = unitAbbr(unit);
              const allConfirmed = typeRows.every(r => r.confirmed);
              const anyLow = typeRows.some(r => (r.line_items as unknown as LineItem[]).some(i => i.confidence < 80 && !i.label.startsWith("__")));
              const stmtIssues = articulationChecks.filter(c => {
                if (c.status === "pass" || c.status === "skip") return false;
                return (type === "balance_sheet" && (c.category === "within_bs" || c.category === "cross_stmt")) ||
                       (type === "profit_loss"   && c.category === "within_pl") ||
                       (type === "cash_flow"     && c.category === "within_cf");
              });
              const stmtHasFail = stmtIssues.some(c => c.status === "fail");
              // Build ordered union of labels, respecting sort_order if present
              const allItems = typeRows[0] ? (typeRows[0].line_items as unknown as LineItem[]).filter(i => !i.label.startsWith("__")) : [];
              const hasOrder = allItems.some(i => i.sort_order !== undefined);
              let labels: string[];
              if (hasOrder) {
                const sorted = [...allItems].sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));
                const seen = new Set<string>();
                labels = sorted.map(i => i.label).filter(l => { if (seen.has(l)) return false; seen.add(l); return true; });
                for (const row of typeRows)
                  for (const it of (row.line_items as unknown as LineItem[]))
                    if (!it.label.startsWith("__") && !seen.has(it.label)) { seen.add(it.label); labels.push(it.label); }
              } else {
                const std = STD_ORDER[type] ?? [];
                const seen = new Set<string>(std.filter(l => typeRows.some(r => (r.line_items as unknown as LineItem[]).some(i => i.label === l))));
                for (const row of typeRows)
                  for (const it of (row.line_items as unknown as LineItem[]))
                    if (!it.label.startsWith("__") && !seen.has(it.label)) { seen.add(it.label); }
                labels = [...seen];
              }

              const sectionLabel = type === "profit_loss" ? "P&L" : type === "balance_sheet" ? "BALANCE SHEET" : type === "cash_flow" ? "CASH FLOW" : type.replace(/_/g," ").toUpperCase();
              return (
                <div key={type} className="space-y-0">
                  {/* ── Sticky year header — outside Panel so overflow-hidden doesn't block sticky ── */}
                  <div
                    ref={el => { reviewHeaderScrollRefs.current[type] = el; }}
                    onScroll={e => { const b = reviewBodyScrollRefs.current[type]; if (b) b.scrollLeft = e.currentTarget.scrollLeft; }}
                    className="overflow-x-auto sticky top-[208px] z-20 bg-card border border-border/60 -mx-3 px-3"
                    style={{ scrollbarWidth: "none", overflowY: "hidden" }}
                  >
                    <div className="flex items-center text-xs text-muted-foreground">
                      {/* col 0 — LINE ITEM */}
                      <div data-hcol="0" className="min-w-[160px] pr-3 py-1.5 flex items-center gap-2 overflow-hidden">
                        <span className="text-[9px] font-bold tracking-widest text-primary/70 border border-primary/30 px-1.5 py-0.5 bg-primary/5 shrink-0">{sectionLabel}</span>
                        <span className="text-[9px] text-muted-foreground/50 truncate">LINE ITEM</span>
                      </div>
                      {/* year columns */}
                      {years.map((fy, yi) => {
                        const fyRow = typeRows.find(r => r.fiscal_year === fy)!;
                        const prov  = isProvisional(fyRow);
                        return (
                          <div key={fy} data-hcol={yi + 1} className="min-w-[100px] text-right pr-2 py-1.5 flex items-center justify-end gap-1 overflow-hidden">
                            <span className="font-bold text-foreground shrink-0">FY{fy}</span>
                            {prov && <span className="text-[7px] font-bold text-warning tracking-widest shrink-0">(P)</span>}
                            {!fyRow.confirmed
                              ? <button onClick={() => confirmExtraction(fyRow.id)} className="text-[8px] text-primary/60 hover:text-primary px-0.5 shrink-0" title="Confirm this year">✓</button>
                              : <span className="text-[8px] text-success shrink-0">✓</span>
                            }
                            <button
                              onClick={() => toggleProvisional(fyRow)}
                              className={`text-[7px] px-0.5 tracking-widest shrink-0 ${prov ? "text-warning hover:text-warning/60" : "text-muted-foreground/30 hover:text-warning"}`}
                              title={prov ? "Unmark as provisional" : "Mark as provisional (unaudited)"}
                            >P</button>
                            <button
                              onClick={() => { if (window.confirm(`Delete FY${fy}?`)) deleteExtractedRow(fyRow.id); }}
                              className="text-[8px] text-destructive/40 hover:text-destructive px-0.5 shrink-0"
                              title="Delete this year column"
                            >✕</button>
                          </div>
                        );
                      })}
                      {/* col — + YEAR */}
                      <div data-hcol={years.length + 1} className="min-w-[90px] text-right pr-2 py-1.5 overflow-hidden">
                        {addingYearFor?.stmtType === type ? (
                          <div className="flex gap-1 items-center justify-end">
                            <input
                              type="number"
                              autoFocus
                              placeholder="e.g. 2023"
                              value={addingYearFor.fy}
                              onChange={e => setAddingYearFor({ stmtType: type, fy: e.target.value })}
                              onKeyDown={e => { if (e.key === "Enter" && addingYearFor.fy) addYearColumn(type, Number(addingYearFor.fy)); if (e.key === "Escape") setAddingYearFor(null); }}
                              className="bg-input border border-accent/60 px-1 py-0.5 text-[10px] text-primary w-20 focus:outline-none"
                            />
                            <button onClick={() => addingYearFor.fy && addYearColumn(type, Number(addingYearFor.fy))} className="text-[9px] text-accent hover:text-accent/80">ADD</button>
                            <button onClick={() => setAddingYearFor(null)} className="text-[9px] text-foreground/40 hover:text-foreground">✕</button>
                          </div>
                        ) : (
                          <button onClick={() => setAddingYearFor({ stmtType: type, fy: "" })} className="text-[9px] text-accent/60 hover:text-accent tracking-widest">+ YEAR</button>
                        )}
                      </div>
                      {/* col — NOTE */}
                      <div data-hcol={years.length + 2} className="min-w-[140px] pl-3 py-1.5 text-[9px] tracking-widest overflow-hidden">NOTE</div>
                      {/* col — action */}
                      <div data-hcol={years.length + 3} className="w-5 shrink-0" />
                    </div>
                  </div>

                  {/* ── Panel with table body only ───────────────────────────── */}
                  <Panel
                    title={`${type.replace(/_/g," ").toUpperCase()}${unit ? `  ·  ${fmtUnit(unit)}` : ""}`}
                    status={stmtHasFail ? "idle" : stmtIssues.length > 0 ? "warn" : anyLow ? "warn" : allConfirmed ? "live" : "idle"}
                    ticker={stmtIssues.length > 0
                      ? `${stmtIssues.length} issue${stmtIssues.length > 1 ? "s" : ""}`
                      : allConfirmed ? "ALL CONFIRMED" : `${years.length} YEAR${years.length !== 1 ? "S" : ""}`}
                    actions={
                      <div className="flex gap-1.5 items-center">
                        {stmtIssues.length > 0 && (
                          <span className={`text-[10px] font-semibold ${stmtHasFail ? "text-destructive" : "text-warning"}`}>
                            {stmtHasFail ? `✗ ${stmtIssues.filter(c => c.status === "fail").length} hard` : `△ ${stmtIssues.length} warn`}
                          </span>
                        )}
                        {!allConfirmed && (
                          <button
                            onClick={() => Promise.all(typeRows.filter(r => !r.confirmed).map(r => confirmExtraction(r.id)))}
                            className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 hover:opacity-90 tracking-widest"
                          >[CONFIRM ALL]</button>
                        )}
                        <button
                          onClick={() => { if (window.confirm(`Delete ALL ${type.replace(/_/g," ").toUpperCase()} data (${years.length} year${years.length !== 1 ? "s" : ""})?`)) Promise.all(typeRows.map(r => deleteExtractedRow(r.id))); }}
                          className="text-xs border border-red-200 rounded text-red-500 px-2 py-0.5 hover:bg-red-50 hover:text-red-700 transition-colors"
                        >Delete</button>
                      </div>
                    }
                  >
                  {/* ── Scrollable table body ─────────────────────────────────── */}
                  <div
                    ref={el => { reviewBodyScrollRefs.current[type] = el; }}
                    onScroll={e => { const h = reviewHeaderScrollRefs.current[type]; if (h) h.scrollLeft = e.currentTarget.scrollLeft; }}
                    className="overflow-x-auto"
                  >
                    <table className="w-full text-xs min-w-max">
                      <colgroup>
                        <col style={{ minWidth: "160px" }} />
                        {years.map(fy => <col key={fy} style={{ minWidth: "100px" }} />)}
                        <col style={{ minWidth: "90px" }} />
                        <col style={{ minWidth: "140px" }} />
                        <col style={{ width: "20px" }} />
                      </colgroup>
                      <tbody>
                        {(() => {
                          // Track which section we're in for collapse filtering
                          let currentSection: string | null = null;
                          return labels.map(label => {
                            const anyItem = typeRows.map(r => (r.line_items as unknown as LineItem[]).find(i => i.label === label)).find(Boolean);
                            const isSection = anyItem?.is_section ?? false;

                            if (isSection) currentSection = label;
                            const sectionKey = `${type}:${currentSection}`;
                            const isHidden = !isSection && currentSection !== null && collapsedSections.has(sectionKey);
                            if (isHidden) return null;

                            const isCollapsed = isSection && collapsedSections.has(`${type}:${label}`);
                            const isEditingLabel = editingCell?.field === "label" && editingCell.stmtType === type && editingCell.label === label;
                            const bestNote = [...typeRows].reverse().reduce<string>((found, row) => {
                              if (found) return found;
                              const it = (row.line_items as unknown as LineItem[]).find(i => i.label === label);
                              const n = it?.note ?? "";
                              return (n && n !== "manual" && n !== "auto-derived") ? n : "";
                            }, "");

                            const isDragTarget = dragOverRow?.stmtType === type && dragOverRow?.label === label;

                            // ── Row type classification ──────────────────────
                            const isGrandTotal  = GRAND_TOTAL_LABELS.has(label);
                            const isSubTotal    = !isGrandTotal && COMPUTED_LABELS.has(label);
                            const isLeaf        = !isSection && !isGrandTotal && !isSubTotal;

                            // ── Articulation check status for this row ───────
                            const rowIssue: "fail" | "warn" | null = (() => {
                              const hits = years.map(fy => checkByRowKey.get(`${type}:${label}:${fy}`)).filter(Boolean) as ArticulationCheck[];
                              if (hits.some(c => c.status === "fail")) return "fail";
                              if (hits.some(c => c.status === "warn")) return "warn";
                              return null;
                            })();

                            const isDragging = dragRow?.stmtType === type && dragRow?.label === label;

                            const dragProps = {
                              draggable: true,
                              onDragStart: (e: React.DragEvent) => {
                                setDragRow({ stmtType: type, label });
                                e.dataTransfer.effectAllowed = "move";
                              },
                              onDragOver:  (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverRow({ stmtType: type, label }); },
                              onDrop:      (e: React.DragEvent) => { e.preventDefault(); if (dragRow && dragRow.stmtType === type && dragRow.label !== label) moveRow(type, dragRow.label, label); setDragRow(null); setDragOverRow(null); },
                              onDragEnd:   () => { setDragRow(null); setDragOverRow(null); },
                              style: {
                                opacity: isDragging ? 0.35 : 1,
                                ...(isDragTarget ? { borderTop: "2px solid hsl(var(--primary))" } : {}),
                              },
                            };

                            if (isSection) {
                              // Look up the section's representative total for each year
                              const totalRowLabel = SECTION_TOTAL_MAP[label];
                              return (
                                <tr key={label} {...dragProps}
                                  className="border-t-2 border-border/60 bg-surface select-none group"
                                >
                                  <td className="py-1.5 pr-3 pl-1">
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        onClick={() => toggleSection(type, label)}
                                        className="w-4 h-4 flex items-center justify-center border border-primary/40 text-primary/60 hover:bg-primary/10 hover:border-primary text-[10px] font-bold flex-shrink-0 transition-colors"
                                      >{isCollapsed ? "+" : "−"}</button>
                                      <span className="text-[10px] font-bold tracking-widest text-foreground uppercase">{label}</span>
                                    </div>
                                  </td>
                                  {years.map(fy => {
                                    const fyRow = typeRows.find(r => r.fiscal_year === fy);
                                    const items = fyRow ? (fyRow.line_items as unknown as LineItem[]) : [];
                                    const totalItem = totalRowLabel ? items.find(i => i.label === totalRowLabel) : null;
                                    const totalVal = totalItem ? (totalItem.override_value ?? totalItem.value) : null;
                                    return (
                                      <td key={fy} className="text-right pr-2 tabular-nums font-bold text-primary/70 text-[11px]">
                                        {totalVal != null ? totalVal.toLocaleString("en-IN") : ""}
                                        {abbr && totalVal != null && <span className="text-[8px] text-muted-foreground ml-0.5">{abbr}</span>}
                                      </td>
                                    );
                                  })}
                                  <td /><td />
                                  <td className="text-center">
                                    <button
                                      onClick={() => deleteRowFromType(type, label)}
                                      className="opacity-0 group-hover:opacity-100 text-destructive/60 hover:text-destructive text-[10px] px-1"
                                      title="Remove this row from all years"
                                    >✕</button>
                                  </td>
                                </tr>
                              );
                            }

                            // ── Grand total row ──────────────────────────────
                            if (isGrandTotal) {
                              return (
                                <tr key={label} {...dragProps}
                                  className={`border-t-2 group ${rowIssue === "fail" ? "border-destructive/50 bg-destructive/5" : rowIssue === "warn" ? "border-warning/50 bg-warning/5" : "border-primary/40 bg-primary/5"}`}
                                >
                                  <td className="py-1.5 pr-3 pl-2 font-bold text-primary tracking-wide">
                                    <span className="flex items-center gap-1.5">
                                      {label}
                                      {rowIssue && (
                                        <span className={`text-[9px] font-bold ${rowIssue === "fail" ? "text-destructive" : "text-warning"}`}>
                                          {rowIssue === "fail" ? "✗" : "△"}
                                        </span>
                                      )}
                                    </span>
                                  </td>
                                  {years.map(fy => {
                                    const fyRow = typeRows.find(r => r.fiscal_year === fy);
                                    const item = fyRow ? (fyRow.line_items as unknown as LineItem[]).find(i => i.label === label) : undefined;
                                    const val = item ? (item.override_value ?? item.value) : null;
                                    const isEditingVal = editingCell?.field === "value" && editingCell.stmtType === type && editingCell.fy === fy && editingCell.label === label;
                                    const cellChk = checkByRowKey.get(`${type}:${label}:${fy}`);
                                    return (
                                      <td key={fy} className={`text-right tabular-nums pr-2 font-bold text-[12px] ${cellChk ? (cellChk.status === "fail" ? "text-destructive" : "text-warning") : "text-primary"}`}>
                                        {isEditingVal ? (
                                          <input autoFocus type="number" defaultValue={val ?? ""} step={unitStep(unit)}
                                            onBlur={e => { setEditingCell(null); setEditing(null); updateCellValue(type, fy, label, e.target.value); }}
                                            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingCell(null); if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); const inp = e.target as HTMLInputElement; const cur = parseFloat(inp.value) || 0; const s = unitStep(unit); inp.value = String(parseFloat((cur + (e.key === "ArrowUp" ? s : -s)).toFixed(6))); } }}
                                            className="w-24 bg-input border border-primary px-1 text-right text-primary text-xs"
                                          />
                                        ) : (
                                          <span className="cursor-pointer hover:opacity-70"
                                            title={cellChk ? cellChk.hint : undefined}
                                            onClick={() => { setEditingCell({ stmtType: type, fy, label, field: "value" }); setEditing(`${type}.${fy}.${label}`); }}>
                                            {val != null ? val.toLocaleString("en-IN") : <span className="text-muted-foreground font-normal">—</span>}
                                            {abbr && val != null && <span className="text-[9px] opacity-50 ml-0.5 font-normal">{abbr}</span>}
                                          </span>
                                        )}
                                      </td>
                                    );
                                  })}
                                  <td /><td className="pl-3 text-[10px] text-muted-foreground/50 italic">auto</td><td />
                                </tr>
                              );
                            }

                            // ── Sub-total row ────────────────────────────────
                            if (isSubTotal) {
                              // Is this field user-locked in ANY year?
                              const isLockedAny = years.some(fy => {
                                const fyRow = typeRows.find(r => r.fiscal_year === fy);
                                return !!(fyRow ? (fyRow.line_items as unknown as LineItem[]).find(i => i.label === label) : undefined)?.locked;
                              });
                              return (
                                <tr key={label} {...dragProps}
                                  className={`border-b group font-semibold ${rowIssue === "fail" ? "border-destructive/40 bg-destructive/5" : rowIssue === "warn" ? "border-warning/40 bg-warning/5" : "border-border/50 bg-surface/50"} ${isLockedAny ? "ring-1 ring-inset ring-accent/30" : ""}`}
                                >
                                  <td className={`py-1 pr-3 pl-4 border-l-2 ${rowIssue === "fail" ? "border-destructive/60 text-destructive" : rowIssue === "warn" ? "border-warning/60 text-warning" : "border-primary/30 text-foreground/80"}`}>
                                    <span className="text-muted-foreground/40 mr-1 cursor-grab text-[9px]">⠿</span>
                                    {isEditingLabel ? (
                                      <input autoFocus defaultValue={label}
                                        onBlur={e => updateCellLabel(type, label, e.target.value)}
                                        onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingCell(null); }}
                                        className="w-full bg-input border border-primary px-1 text-primary text-xs"
                                      />
                                    ) : (
                                      <span className="cursor-pointer hover:text-primary inline-flex items-center gap-1.5"
                                        onClick={() => setEditingCell({ stmtType: type, fy: years[0] ?? 0, label, field: "label" })}>
                                        {label}
                                        {rowIssue && (
                                          <span className={`text-[9px] font-bold ${rowIssue === "fail" ? "text-destructive" : "text-warning"}`}>
                                            {rowIssue === "fail" ? "✗" : "△"}
                                          </span>
                                        )}
                                      </span>
                                    )}
                                  </td>
                                  {years.map(fy => {
                                    const fyRow = typeRows.find(r => r.fiscal_year === fy);
                                    const item = fyRow ? (fyRow.line_items as unknown as LineItem[]).find(i => i.label === label) : undefined;
                                    const val = item ? (item.override_value ?? item.value) : null;
                                    const isLocked = !!item?.locked;
                                    const isEditingVal = editingCell?.field === "value" && editingCell.stmtType === type && editingCell.fy === fy && editingCell.label === label;
                                    const cellChk = checkByRowKey.get(`${type}:${label}:${fy}`);
                                    return (
                                      <td key={fy} className={`text-right tabular-nums pr-2 ${cellChk ? (cellChk.status === "fail" ? "text-destructive font-bold" : "text-warning font-semibold") : "text-foreground/90"}`}>
                                        {isEditingVal ? (
                                          <input autoFocus type="number" defaultValue={val ?? ""} step={unitStep(unit)}
                                            onBlur={e => { setEditingCell(null); setEditing(null); updateCellValue(type, fy, label, e.target.value); }}
                                            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingCell(null); if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); const inp = e.target as HTMLInputElement; const cur = parseFloat(inp.value) || 0; const s = unitStep(unit); inp.value = String(parseFloat((cur + (e.key === "ArrowUp" ? s : -s)).toFixed(6))); } }}
                                            className="w-24 bg-input border border-primary px-1 text-right text-primary text-xs"
                                          />
                                        ) : (
                                          <span className={`cursor-pointer hover:text-primary italic ${isLocked ? "text-accent" : ""}`}
                                            title={cellChk ? cellChk.hint : isLocked ? "Pinned — formula suspended. Clear value to restore auto-calculation." : "auto-calculated — click to override"}
                                            onClick={() => { setEditingCell({ stmtType: type, fy, label, field: "value" }); setEditing(`${type}.${fy}.${label}`); }}>
                                            {isLocked && <span className="text-[9px] mr-0.5 opacity-60">⚑</span>}
                                            {val != null ? val.toLocaleString("en-IN") : <span className="text-muted-foreground font-normal">—</span>}
                                            {abbr && val != null && <span className="text-[9px] text-muted-foreground ml-0.5 font-normal">{abbr}</span>}
                                          </span>
                                        )}
                                      </td>
                                    );
                                  })}
                                  <td />
                                  <td className="pl-3 text-[9px] italic">
                                    {isLockedAny
                                      ? <span className="text-accent/70">⚑ pinned</span>
                                      : <span className="text-muted-foreground/40">auto</span>}
                                  </td>
                                  <td />
                                </tr>
                              );
                            }

                            // ── Leaf (input) row ─────────────────────────────
                            return (
                              <tr key={label} {...dragProps}
                                className="border-b border-border/20 group hover:bg-surface/30 transition-colors"
                              >
                                <td className="py-0.5 pr-3 pl-8">
                                  <span className="text-muted-foreground/30 mr-1 cursor-grab text-[9px]">⠿</span>
                                  {isEditingLabel ? (
                                    <input autoFocus defaultValue={label}
                                      onBlur={e => updateCellLabel(type, label, e.target.value)}
                                      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingCell(null); }}
                                      className="w-full bg-input border border-primary px-1 text-primary text-xs"
                                    />
                                  ) : (
                                    <span className="cursor-pointer hover:text-primary text-foreground/75"
                                      title="Click to rename"
                                      onClick={() => setEditingCell({ stmtType: type, fy: years[0] ?? 0, label, field: "label" })}>{label}</span>
                                  )}
                                </td>
                                {years.map(fy => {
                                  const fyRow = typeRows.find(r => r.fiscal_year === fy);
                                  const item = fyRow ? (fyRow.line_items as unknown as LineItem[]).find(i => i.label === label) : undefined;
                                  const val = item ? (item.override_value ?? item.value) : null;
                                  const conf = item?.confidence ?? 100;
                                  const confCls = conf >= 90 ? "text-foreground/80" : conf >= 80 ? "text-warning" : "text-destructive";
                                  const isEditingVal = editingCell?.field === "value" && editingCell.stmtType === type && editingCell.fy === fy && editingCell.label === label;
                                  return (
                                    <td key={fy} className="text-right tabular-nums pr-2">
                                      {isEditingVal ? (
                                        <input autoFocus type="number" defaultValue={val ?? ""} step={unitStep(unit)}
                                          onBlur={e => { setEditingCell(null); setEditing(null); updateCellValue(type, fy, label, e.target.value); }}
                                          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingCell(null); if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); const inp = e.target as HTMLInputElement; const cur = parseFloat(inp.value) || 0; const s = unitStep(unit); inp.value = String(parseFloat((cur + (e.key === "ArrowUp" ? s : -s)).toFixed(6))); } }}
                                          className="w-24 bg-input border border-primary px-1 text-right text-primary text-xs"
                                        />
                                      ) : (
                                        <span className={`cursor-pointer hover:text-primary ${confCls}`}
                                          title="Click to edit"
                                          onClick={() => { setEditingCell({ stmtType: type, fy, label, field: "value" }); setEditing(`${type}.${fy}.${label}`); }}>
                                          {val != null ? val.toLocaleString("en-IN") : <span className="text-muted-foreground/40">—</span>}
                                          {abbr && val != null && <span className="text-[9px] text-muted-foreground ml-0.5">{abbr}</span>}
                                        </span>
                                      )}
                                    </td>
                                  );
                                })}
                                <td />{/* spacer */}
                                <td className="pl-3">
                                  <input
                                    type="text"
                                    key={`${type}-${label}-note`}
                                    defaultValue={bestNote}
                                    placeholder="add note…"
                                    onBlur={async e => {
                                      const v = e.target.value;
                                      await Promise.all(typeRows.map(row => updateRowNote(type, row.fiscal_year, label, v)));
                                      await reload();
                                    }}
                                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                    className="w-full bg-transparent border-b border-border/40 focus:border-primary px-0 text-muted-foreground focus:text-primary text-xs outline-none placeholder:text-border/60"
                                  />
                                </td>
                                <td className="text-center">
                                  <button
                                    onClick={() => deleteRowFromType(type, label)}
                                    className="opacity-0 group-hover:opacity-100 text-destructive/60 hover:text-destructive text-[10px] px-1"
                                    title="Remove this row from all years"
                                  >✕</button>
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                  <button
                    onClick={() => addRowToType(type)}
                    className="mt-2 text-[10px] border border-dashed border-border/60 text-muted-foreground hover:border-primary hover:text-primary px-3 py-1 w-full tracking-widest"
                  >+ ADD ROW</button>

                  {/* ── Validation issues detail panel ──────────────────── */}
                  {stmtIssues.length > 0 && (() => {
                    const fmtChk = (v: number | null) => v == null ? "—" : `${v.toLocaleString("en-IN")}${abbr ? ` ${abbr}` : ""}`;
                    return (
                      <div className="mt-3 border border-border/50 divide-y divide-border/20">
                        <div className="px-3 py-1.5 bg-surface/60 flex items-center gap-2">
                          <span className="text-[8px] tracking-widest font-bold text-muted-foreground">VALIDATION ISSUES</span>
                          {stmtIssues.some(c => c.status === "fail") && (
                            <span className="text-[9px] text-destructive font-bold bg-destructive/10 px-1.5 py-0.5">
                              ✗ {stmtIssues.filter(c => c.status === "fail").length} HARD
                            </span>
                          )}
                          {stmtIssues.some(c => c.status === "warn") && (
                            <span className="text-[9px] text-warning font-bold bg-warning/10 px-1.5 py-0.5">
                              △ {stmtIssues.filter(c => c.status === "warn").length} WARN
                            </span>
                          )}
                        </div>
                        {stmtIssues.map(check => {
                          const prefix = Object.keys(AUTOFIX_TARGET).find(p => check.id.startsWith(p + "_"));
                          const target = prefix ? AUTOFIX_TARGET[prefix] : null;
                          const canFix = !!target && check.expected != null && check.fiscal_year != null;
                          return (
                            <div key={check.id}
                              className={`px-3 py-2.5 ${check.status === "fail" ? "border-l-2 border-destructive" : "border-l-2 border-warning"}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                                    <span className={`text-[8px] font-bold tracking-widest px-1.5 py-0.5 ${check.status === "fail" ? "text-destructive bg-destructive/10" : "text-warning bg-warning/10"}`}>
                                      {check.status === "fail" ? "✗ HARD" : "△ WARN"}
                                    </span>
                                    {check.fiscal_year && (
                                      <span className="text-[9px] text-muted-foreground border border-border px-1.5 py-0.5">FY{check.fiscal_year}</span>
                                    )}
                                    <span className="text-[10px] font-semibold text-foreground">{check.name}</span>
                                  </div>
                                  <div className="grid grid-cols-3 gap-x-4 mb-1.5 text-[10px] font-mono">
                                    <div>
                                      <div className="text-[8px] tracking-widest text-muted-foreground mb-0.5">EXPECTED</div>
                                      <div className="text-foreground font-semibold">{fmtChk(check.expected)}</div>
                                    </div>
                                    <div>
                                      <div className="text-[8px] tracking-widest text-muted-foreground mb-0.5">EXTRACTED</div>
                                      <div className={`font-semibold ${check.status === "fail" ? "text-destructive" : "text-warning"}`}>{fmtChk(check.actual)}</div>
                                    </div>
                                    <div>
                                      <div className="text-[8px] tracking-widest text-muted-foreground mb-0.5">GAP</div>
                                      <div className={`font-bold ${(check.gap ?? 0) > 0 ? "text-warning" : "text-destructive"}`}>
                                        {check.gap != null ? `${check.gap > 0 ? "+" : ""}${check.gap.toLocaleString("en-IN")}${abbr ? ` ${abbr}` : ""}` : "—"}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="text-[9px] text-muted-foreground/60 italic leading-snug">{check.hint}</div>
                                </div>
                                {canFix && target && (
                                  <button
                                    onClick={() => updateCellValue(target.stmtType, check.fiscal_year!, target.label, String(check.expected!))}
                                    className="shrink-0 mt-0.5 text-[9px] tracking-widest border border-primary/50 text-primary hover:bg-primary/10 px-2 py-1 font-bold transition-colors"
                                    title={`Set ${target.label} = ${fmtChk(check.expected)}`}
                                  >AUTO-FIX</button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* ── Balance sheet imbalance detail ──────────────────── */}
                  {type === "balance_sheet" && (() => {
                    const imbalances = years.flatMap(fy => {
                      const fyRow = typeRows.find(r => r.fiscal_year === fy);
                      if (!fyRow) return [];
                      const items = fyRow.line_items as unknown as LineItem[];
                      const gv = (lbl: string) => { const lo = lbl.toLowerCase(); const it = items.find(i => i.label.toLowerCase() === lo); return it ? (it.override_value ?? it.value) : null; };
                      const assets    = gv("Total Assets") ?? gv("Assets Total") ?? gv("Grand Total Assets");
                      const netWorth  = gv("Net Worth");
                      const totalDebt = gv("Total Debt");
                      const currLiab  = gv("Current Liabilities");
                      const liabSide  = (netWorth ?? 0) + (totalDebt ?? 0) + (currLiab ?? 0);
                      if (assets == null) return [];
                      const diff = assets - liabSide;
                      if (Math.abs(diff) < 0.01) return [];
                      return [{ fy, diff, assets, netWorth, totalDebt, currLiab, liabSide }];
                    });
                    if (imbalances.length === 0) return null;
                    const fmtN = (v: number | null) => v == null ? "—" : `${v.toLocaleString("en-IN")}${abbr ? ` ${abbr}` : ""}`;
                    return (
                      <div className="mt-3 border border-destructive/40 divide-y divide-destructive/10">
                        <div className="px-3 py-1.5 flex items-center gap-2 border-b border-destructive/20">
                          <span className="text-[9px] tracking-widest text-destructive font-bold">✗ BALANCE SHEET NOT BALANCING</span>
                        </div>
                        {imbalances.map(({ fy, diff, assets, netWorth, totalDebt, currLiab, liabSide }) => (
                          <div key={fy} className="px-3 py-2.5">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] border border-destructive/40 text-destructive px-1.5 py-0.5 font-bold">FY{fy}</span>
                                <span className={`text-[9px] font-bold ${diff > 0 ? "text-warning" : "text-destructive"}`}>
                                  GAP: {diff > 0 ? "+" : ""}{fmtN(diff)}
                                </span>
                              </div>
                              <button
                                onClick={() => updateCellValue("balance_sheet", fy, "Total Assets", String(liabSide))}
                                className="text-[9px] tracking-widest border border-primary/50 text-primary hover:bg-primary/10 px-2 py-0.5 font-bold transition-colors"
                                title={`Set Total Assets = Net Worth + Total Debt + Current Liabilities = ${fmtN(liabSide)}`}
                              >AUTO-FIX</button>
                            </div>
                            <div className="text-[10px] font-mono space-y-0.5">
                              <div className="flex justify-between py-0.5 border-b border-border/30">
                                <span className={`font-semibold ${diff !== 0 ? "text-destructive" : "text-foreground"}`}>Total Assets</span>
                                <span className={`font-semibold tabular-nums ${diff !== 0 ? "text-destructive" : "text-foreground"}`}>{fmtN(assets)}</span>
                              </div>
                              <div className="text-[8px] tracking-widest text-muted-foreground/50 pt-1 pb-0.5">EQUITY + LIABILITIES</div>
                              {netWorth != null && (
                                <div className="flex justify-between pl-2 text-muted-foreground">
                                  <span>Net Worth</span><span className="tabular-nums text-foreground">{fmtN(netWorth)}</span>
                                </div>
                              )}
                              {totalDebt != null && (
                                <div className="flex justify-between pl-2 text-muted-foreground">
                                  <span>+ Total Debt</span><span className="tabular-nums text-foreground">{fmtN(totalDebt)}</span>
                                </div>
                              )}
                              {currLiab != null && (
                                <div className="flex justify-between pl-2 text-muted-foreground">
                                  <span>+ Current Liabilities</span><span className="tabular-nums text-foreground">{fmtN(currLiab)}</span>
                                </div>
                              )}
                              <div className="flex justify-between pt-0.5 border-t border-border/40 font-semibold">
                                <span className="text-muted-foreground">Sum (E+L)</span>
                                <span className="tabular-nums text-foreground">{fmtN(liabSide)}</span>
                              </div>
                            </div>
                            <div className="mt-1.5 text-[9px] text-muted-foreground/60 italic">
                              AUTO-FIX sets Total Assets = {fmtN(liabSide)} to close the gap.
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                </Panel>
                </div>
              );
            });
          })()}
          {/* ── Add Statement Box ──────────────────────────────────────────── */}
          {addStmtForm ? (
            <Panel title="Manual Entry" ticker="New Statement" status="warn">
              <div className="flex gap-3 items-end flex-wrap">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Statement Type</label>
                  <select
                    value={addStmtForm.type}
                    onChange={e => setAddStmtForm(f => f && ({ ...f, type: e.target.value as StatementType }))}
                    className="bg-input border border-border px-2 py-1.5 text-sm text-primary focus:outline-none focus:border-primary"
                  >
                    {(["profit_loss","balance_sheet","cash_flow","projections"] as StatementType[]).map(t => (
                      <option key={t} value={t}>{t.replace(/_/g," ").toUpperCase()}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Fiscal Year</label>
                  <input
                    type="number"
                    autoFocus
                    placeholder="e.g. 2023"
                    value={addStmtForm.fy}
                    onChange={e => setAddStmtForm(f => f && ({ ...f, fy: e.target.value }))}
                    onKeyDown={e => {
                      if (e.key === "Enter" && addStmtForm.fy) createEmptyStatement(addStmtForm.type, Number(addStmtForm.fy), addStmtForm.unit);
                      if (e.key === "Escape") setAddStmtForm(null);
                    }}
                    className="bg-input border border-border px-2 py-1.5 text-sm text-primary w-28 focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Unit</label>
                  <input
                    placeholder="e.g. Crores"
                    value={addStmtForm.unit}
                    onChange={e => setAddStmtForm(f => f && ({ ...f, unit: e.target.value }))}
                    className="bg-input border border-border px-2 py-1.5 text-sm text-primary w-28 focus:outline-none focus:border-primary"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={!addStmtForm.fy}
                    onClick={() => addStmtForm.fy && createEmptyStatement(addStmtForm.type, Number(addStmtForm.fy), addStmtForm.unit)}
                    className="bg-primary text-primary-foreground px-4 py-1.5 text-xs tracking-widest font-bold hover:opacity-90 disabled:opacity-40"
                  >[CREATE]</button>
                  <button
                    onClick={() => setAddStmtForm(null)}
                    className="border border-border text-foreground/50 px-3 py-1.5 text-xs tracking-widest hover:text-foreground"
                  >[CANCEL]</button>
                </div>
              </div>
            </Panel>
          ) : (
            <button
              onClick={() => setAddStmtForm({ type: "profit_loss", fy: "", unit: extracted.find(r => r.unit)?.unit ?? "" })}
              className="w-full text-[10px] border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary py-2.5 tracking-widest"
            >+ ADD STATEMENT BOX</button>
          )}
          {derivedCFSeries.length > 0 && !extracted.some(r => r.statement_type === "cash_flow") && (
            <DerivedCashFlowPanel series={derivedCFSeries} unit={extracted.find(r => r.unit)?.unit ?? null} />
          )}

          {extracted.some((r) => r.confirmed) && (
            <div className="flex flex-col gap-1.5">
              {ratiosOutdated && (
                <div className="border-l-2 border-warning bg-warning/10 px-3 py-2 flex items-center gap-3 text-[10px] text-warning tracking-widest font-bold">
                  ↻ FIGURES CHANGED — RATIOS ARE STALE
                  <span className="font-normal text-warning/70 text-[9px] tracking-wide">Ratios do not update automatically — click below to refresh.</span>
                </div>
              )}
              <button
                onClick={runRatios}
                disabled={busy}
                className={`px-5 py-2.5 rounded-md text-sm font-semibold disabled:opacity-50 transition-colors ${ratiosOutdated ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
              >
                {busy ? "Computing…" : ratiosOutdated ? "↻ Data Changed — Re-run Ratios" : "Generate Ratio Analysis"}
              </button>
            </div>
          )}
          {/* Auto-derived fields panel */}
          {extracted.length > 0 && (() => {
            const histYears = Array.from(new Set(extracted.filter(r => r.statement_type !== "projections").map(r => r.fiscal_year))).sort();
            // pivot: label → { fy → value }
            const pivot: Record<string, Record<number, number>> = {};
            const labelOrder: string[] = [];
            for (const fy of histYears) {
              const raw: LineItem[] = [];
              const seen = new Set<string>();
              for (const row of extracted.filter(r => r.fiscal_year === fy && r.statement_type !== "projections"))
                for (const it of (row.line_items as unknown as LineItem[]) ?? [])
                  if (!seen.has(it.label)) { raw.push(it); seen.add(it.label); }
              for (const it of deriveFinancialItems(raw)) {
                if (it.note === "auto-derived" && it.value !== null && Number.isFinite(Number(it.value))) {
                  if (!pivot[it.label]) { pivot[it.label] = {}; labelOrder.push(it.label); }
                  pivot[it.label][fy] = Number(it.value);
                }
              }
            }
            if (labelOrder.length === 0) return null;
            return (
              <Panel title="Auto-derived Fields" ticker="Calculated" status="warn">
                <div className="text-[9px] text-warning/80 mb-2 tracking-wider">
                  ▸ Not in uploaded documents — auto-calculated from extracted data. Review before use.
                </div>
                <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground border-b border-border">
                    <tr>
                      <th className="text-left py-0.5 pr-4">LINE ITEM</th>
                      {histYears.map(fy => (
                        <th key={fy} className="text-right py-0.5 px-2 tabular-nums">FY{fy}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {labelOrder.map(label => (
                      <tr key={label} className="border-b border-border/30">
                        <td className="py-0.5 pr-4 text-warning/90">{label}</td>
                        {histYears.map(fy => (
                          <td key={fy} className="text-right px-2 tabular-nums text-warning">
                            {pivot[label][fy] !== undefined
                              ? pivot[label][fy].toLocaleString("en-IN", { maximumFractionDigits: 2 })
                              : <span className="text-muted-foreground/40">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </Panel>
            );
          })()}
          {/* Provisional data teaser */}
          {ic?.provisional && ic.provisional.length > 0 && (
            <div className="border border-accent/30 bg-accent/5 px-3 py-2 flex items-center gap-3">
              <span className="text-[9px] font-bold text-accent tracking-widest">◈ PROVISIONAL DATA</span>
              <span className="text-[10px] text-muted-foreground flex-1">
                {ic.provisional.length} period{ic.provisional.length !== 1 ? "s" : ""} loaded: {ic.provisional.map(p => p.label).join(" · ")}
              </span>
              <button onClick={() => setTab("provisional")} className="text-[9px] border border-accent/40 text-accent px-2 py-0.5 hover:bg-accent/10 tracking-widest">
                VIEW PROVISIONAL →
              </button>
            </div>
          )}

          {extracted.length > 0 ? (
            <DownloadBar onTemplate={downloadFinancialTemplate} onExcel={async () => {
              const stmtTypes = Array.from(new Set(extracted.map(r => r.statement_type))).filter(t => t !== "projections");
              const sheets = stmtTypes.map(type => {
                const rows: (string | number | null)[][] = [["FY", "Unit", "Line Item", "Extracted Value", "Override Value", "Confidence", "Reviewed"]];
                for (const row of extracted.filter(r => r.statement_type === type)) {
                  for (const it of (row.line_items as unknown as LineItem[]) ?? []) {
                    rows.push([row.fiscal_year ?? "—", row.unit ?? "", it.label, it.value ?? "", it.override_value ?? "", it.confidence, it.reviewed ? "Yes" : "No"]);
                  }
                }
                return { name: type.replace(/_/g, " "), rows };
              });
              await dlExcel(sheets, `${cc.case_code}_extraction.xlsx`);
            }} />
          ) : (
            <DownloadBar onTemplate={downloadFinancialTemplate} />
          )}
        </div>
      )}

      {tab === "ratios" && (
        <div className="space-y-3">
          {hasPartner && (
            <Panel title="Company" ticker="Entity">
              {entityBar}
            </Panel>
          )}
          {ratios.length === 0 ? (
            <Panel title="No Ratios"><div className="text-muted-foreground text-sm">Confirm extracted financials and run ratio analysis.</div></Panel>
          ) : (
            <>
              {ratioGroups.map((cat) => (
                <Panel key={cat} title={cat.toUpperCase()} ticker="RATIOS">
                  <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[400px]">
                    <thead className="text-muted-foreground border-b border-border">
                      <tr>
                        <th className="text-left py-1">RATIO</th>
                        {years.map((y) => {
                          const provRow = extracted.find(r => r.fiscal_year === y && (r.statement_type === "profit_loss" || r.statement_type === "balance_sheet"));
                          const prov = provRow ? isProvisional(provRow) : false;
                          return (
                            <th key={y} className="text-right pr-1">
                              FY{y}{prov && <span className="text-[7px] text-warning ml-0.5">(P)</span>}
                            </th>
                          );
                        })}
                        <th className="text-right">BENCHMARK</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(new Set(ratios.filter((r) => r.category === cat).map((r) => r.ratio_name))).map((name) => (
                        <tr key={name} className="border-b border-border/30">
                          <td className="py-1 text-foreground/90">{RATIO_DISPLAY_NAMES[name] ?? name}</td>
                          {years.map((y) => {
                            const r = ratios.find((x) => x.ratio_name === name && x.fiscal_year === y);
                            const status = r?.threshold_status ?? "na";
                            const val = r?.ratio_value !== null && r?.ratio_value !== undefined ? Number(r.ratio_value) : null;
                            return (
                              <td key={y} className="text-right pr-1">
                                <div className="inline-flex items-center gap-1.5 justify-end">
                                  <span className="tabular-nums text-foreground/90">{formatRatio(name, val)}</span>
                                  <span className={`px-1.5 py-0 text-[9px] tracking-widest font-bold leading-5 ${statusColorClass[status]}`}>
                                    {statusLabel[status]}
                                  </span>
                                </div>
                              </td>
                            );
                          })}
                          <td className="text-right text-accent tabular-nums">
                            {(() => {
                              const bm = ratios.find((x) => x.ratio_name === name)?.benchmark;
                              return bm != null ? formatRatio(name, Number(bm)) : "—";
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </Panel>
              ))}
              {/* ── AI Credit Analysis ─────────────────────────────────────── */}
              <Panel title="AI Credit Analysis" ticker="Insights" status={ratioAnalysisLoading ? "warn" : ratioAnalysis ? "live" : "idle"}>
                {!ratioAnalysis && !ratioAnalysisLoading && (
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      Generate an AI-powered analysis covering profitability, liquidity, solvency, efficiency,
                      risk factors, data accuracy notes, and overall financial health.
                    </p>
                    <button
                      onClick={generateRatioAnalysis}
                      className="shrink-0 bg-primary text-primary-foreground px-5 py-2.5 rounded-md text-sm font-semibold hover:bg-primary/90 transition-colors"
                    >
                      Generate AI Analysis
                    </button>
                  </div>
                )}
                {ratioAnalysisLoading && (
                  <div className="space-y-3 py-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-primary">▸ {ratioAiLabel || "Analysing…"}</span>
                      <span className="text-primary font-semibold tabular-nums">{ratioAiProgress}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${ratioAiProgress}%` }}
                      />
                    </div>
                    <div className="grid grid-cols-5 gap-1 text-[10px] text-muted-foreground">
                      {["Ratio Data","Trends","Categories","Risk Flags","Drafting"].map((s, i) => (
                        <div key={s} className={`text-center py-1 rounded border border-border/30 ${ratioAiProgress >= (i + 1) * 20 ? "text-primary border-primary/40 bg-primary/5 font-medium" : ""}`}>{s}</div>
                      ))}
                    </div>
                  </div>
                )}
                {ratioAnalysis && (
                  <div className="space-y-5">
                    <div className="text-[9px] text-warning/80 tracking-wider border border-warning/30 bg-warning/5 px-2 py-1.5">
                      ⚠ AI-ASSISTED ANALYSIS · VERIFY BEFORE RELYING ON · NOT A CREDIT RECOMMENDATION
                    </div>

                    {/* Overall observation */}
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Overall Financial Health</div>
                      <p className="text-sm text-foreground leading-relaxed">{ratioAnalysis.overall_observation}</p>
                    </div>

                    {/* Category insights */}
                    <div className="grid grid-cols-1 gap-3">
                      {[
                        { key: "profitability_insight", label: "Profitability" },
                        { key: "liquidity_insight",     label: "Liquidity" },
                        { key: "solvency_insight",      label: "Solvency & Coverage" },
                        { key: "efficiency_insight",    label: "Efficiency & Turnover" },
                        { key: "expense_insight",       label: "Cost Structure" },
                        { key: "r_score_insight",       label: "R-Score (Distress Risk)" },
                      ].map(({ key, label }) => {
                        const text = ratioAnalysis[key as keyof RatioAnalysisResult] as string;
                        if (!text) return null;
                        return (
                          <div key={key} className="border-l-2 border-border/60 pl-3">
                            <div className="text-xs font-medium text-muted-foreground mb-0.5">{label}</div>
                            <p className="text-sm text-foreground leading-relaxed">{text}</p>
                          </div>
                        );
                      })}
                    </div>

                    {/* Risk factors */}
                    {ratioAnalysis.risk_factors?.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Risk Factors</div>
                        <div className="space-y-2">
                          {ratioAnalysis.risk_factors.map((rf, i) => (
                            <div key={i} className="flex gap-3 items-start rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                              <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded ${
                                rf.severity === "HIGH"   ? "bg-red-50 text-red-700 border border-red-200" :
                                rf.severity === "MEDIUM" ? "bg-amber-50 text-amber-700 border border-amber-200" :
                                                           "bg-muted text-muted-foreground border border-border"
                              }`}>{rf.severity === "HIGH" ? "High" : rf.severity === "MEDIUM" ? "Medium" : "Low"}</span>
                              <div>
                                <div className="text-xs text-muted-foreground mb-0.5">{rf.category}</div>
                                <p className="text-sm text-foreground leading-relaxed">{rf.description}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Positive factors */}
                    {ratioAnalysis.positive_factors?.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Positive Indicators</div>
                        <div className="space-y-1.5">
                          {ratioAnalysis.positive_factors.map((pf, i) => (
                            <div key={i} className="flex gap-2 text-sm">
                              <span className="text-green-600 shrink-0 mt-0.5">✓</span>
                              <span className="text-foreground leading-relaxed">{pf}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Data accuracy notes */}
                    {ratioAnalysis.data_accuracy_notes?.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Data Accuracy Notes</div>
                        <div className="space-y-1.5">
                          {ratioAnalysis.data_accuracy_notes.map((note, i) => (
                            <div key={i} className="flex gap-2 text-sm">
                              <span className="text-amber-500 shrink-0 mt-0.5">▲</span>
                              <span className="text-foreground leading-relaxed">{note}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <button
                      onClick={() => { setRatioAnalysis(null); generateRatioAnalysis(); }}
                      disabled={ratioAnalysisLoading}
                      className="text-sm text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                    >
                      Regenerate
                    </button>
                  </div>
                )}
              </Panel>

              <div className="border border-border/40 bg-surface/50 px-4 py-3 text-[10px] text-muted-foreground/70 space-y-1 leading-relaxed">
                <div><span className="text-foreground/50 font-bold">*Receivables Days:</span> In the absence of details about credit sales, calculated using Total Revenue from Operations. (Debtors / Turnover) × 365.</div>
                <div><span className="text-foreground/50 font-bold">*Payable Days:</span> In the absence of details about credit purchases, calculated using COGS. (Creditors / COGS) × 365.</div>
                <div><span className="text-foreground/50 font-bold">*Cash Conversion Cycle:</span> In the absence of details about credit purchases &amp; credit sales, Payable Days and Receivable Days are calculated using COGS &amp; Total Revenue from Operations respectively.</div>
              </div>
              <button onClick={() => setTab("projections")} className="bg-surface border border-border text-primary px-4 py-2 text-xs tracking-widest font-bold hover:bg-primary/10">
                [VIEW PROJECTIONS &amp; ANALYTICS →]
              </button>
              <DownloadBar
                onExcel={async () => {
                  const hdr: (string|number|null)[] = ["Category", "Ratio", ...years.map(y => `FY${y}`), "Benchmark", "Status"];
                  const rows: (string|number|null)[][] = [hdr];
                  for (const cat of ratioGroups) {
                    for (const name of Array.from(new Set(ratios.filter(r => r.category === cat).map(r => r.ratio_name)))) {
                      const latest = ratios.filter(r => r.ratio_name === name).sort((a,b) => b.fiscal_year - a.fiscal_year)[0];
                      rows.push([cat, RATIO_DISPLAY_NAMES[name] ?? name,
                        ...years.map(y => { const r = ratios.find(x => x.ratio_name === name && x.fiscal_year === y); return r?.ratio_value != null ? formatRatio(name, Number(r.ratio_value)) : "—"; }),
                        latest?.benchmark != null ? formatRatio(name, Number(latest.benchmark)) : "—",
                        latest?.threshold_status?.toUpperCase() ?? "—",
                      ]);
                    }
                  }
                  await dlExcel([{ name: "Ratios", rows }], `${cc.case_code}_ratios.xlsx`);
                }}
                onPdf={() => {
                  let html = `<h1>${cc.client_name} — Financial Ratio Matrix</h1>
<div class="meta"><div class="mi"><div class="lbl">Case</div><div class="val">${cc.case_code}</div></div><div class="mi"><div class="lbl">Amount</div><div class="val">₹${cc.deal_amount ?? "—"} Cr</div></div><div class="mi"><div class="lbl">Tenure</div><div class="val">${cc.tenure_months ?? "—"}M</div></div><div class="mi"><div class="lbl">IRR</div><div class="val">${cc.expected_irr ?? "—"}%</div></div></div>`;
                  for (const cat of ratioGroups) {
                    html += `<div class="sec"><h2>${cat}</h2><table><thead><tr><th>Ratio</th>${years.map(y=>`<th>FY${y}</th>`).join("")}<th>Benchmark</th><th>Status</th></tr></thead><tbody>`;
                    for (const name of Array.from(new Set(ratios.filter(r=>r.category===cat).map(r=>r.ratio_name)))) {
                      const latest = ratios.filter(r=>r.ratio_name===name).sort((a,b)=>b.fiscal_year-a.fiscal_year)[0];
                      const s = latest?.threshold_status ?? "na";
                      const cls = s==="green"?"pass":s==="red"?"fail":s==="amber"?"caution":"";
                      html += `<tr><td>${RATIO_DISPLAY_NAMES[name]??name}</td>${years.map(y=>{const r=ratios.find(x=>x.ratio_name===name&&x.fiscal_year===y);return`<td>${r?.ratio_value!=null?formatRatio(name,Number(r.ratio_value)):"—"}</td>`;}).join("")}<td>${latest?.benchmark!=null?formatRatio(name,Number(latest.benchmark)):"—"}</td><td class="${cls}">${s.toUpperCase()}</td></tr>`;
                    }
                    html += `</tbody></table></div>`;
                  }
                  dlPdf(html, `${cc.case_code} Ratios`);
                }}
              />
            </>
          )}
        </div>
      )}

      {tab === "projections" && (
        <div className="space-y-3">
          {hasPartner && (
            <Panel title="Company" ticker="Entity">
              {entityBar}
            </Panel>
          )}
          <ProjectionsTab
            extracted={activeExtracted}
            cc={cc}
            busy={busy}
            progress={progress}
            progressLabel={progressLabel}
            onGenerateNote={runNarrative}
            onUpload={handleProjectionUpload}
            onDirectImport={handleDirectProjImport}
            docs={docs.filter(d => d.doc_class === "projections")}
            onDelete={handleDeleteDoc}
            onRetry={handleRetry}
          />
          {extracted.some(r => r.statement_type === "projections") ? (
            <DownloadBar onTemplate={downloadProjectionsTemplate} onExcel={async () => {
              const projRows = extracted.filter(r => r.statement_type === "projections");
              const histRows = extracted.filter(r => r.statement_type !== "projections");
              const projYears = Array.from(new Set(projRows.map(r => r.fiscal_year))).sort();
              const liVal = (items: LineItem[], label: string) => { const it = items.find(i=>i.label===label); if(!it) return null; return it.override_value??it.value; };
              const getHist = (fy: number): LineItem[] => { const r: LineItem[] = []; const s = new Set<string>(); for (const row of histRows.filter(x=>x.fiscal_year===fy)) for (const it of (row.line_items as unknown as LineItem[])??[]) if(!s.has(it.label)){r.push(it);s.add(it.label);} return r; };
              const PROJ_EXCEL_ALIAS: Record<string, string[]> = {
                "Projected Turnover":   ["Projected Turnover", "Revenue", "Total Income", "Turnover"],
                "Projected EBITDA":     ["Projected EBITDA", "EBITDA"],
                "Projected PAT":        ["Projected PAT", "PAT"],
                "Projected Net Worth":  ["Projected Net Worth", "Net Worth"],
                "Projected Total Debt": ["Projected Total Debt", "Total Debt"],
              };
              const projLabels = ["Projected Turnover","Projected EBITDA","Projected PAT","Projected Net Worth","Projected Total Debt"];
              const liValAliased = (items: LineItem[], aliases: string[]): number | null => {
                for (const lb of aliases) { const v = liVal(items, lb); if (v !== null) return v; }
                return null;
              };
              const hdr: (string|number|null)[] = ["Metric", ...projYears.map(y=>`FY${y} (P)`)];
              const rows: (string|number|null)[][] = [hdr];
              for (const lb of projLabels) rows.push([lb, ...projYears.map(y => liValAliased((projRows.find(r=>r.fiscal_year===y)?.line_items??[]) as unknown as LineItem[], PROJ_EXCEL_ALIAS[lb] ?? [lb]) ?? "—")]);
              const unit = extracted.find(r=>r.unit)?.unit ?? "";
              await dlExcel([{ name: "Projections", rows }, { name: "Meta", rows: [["Unit", unit], ["Case", cc.case_code], ["Client", cc.client_name]] }], `${cc.case_code}_projections.xlsx`);
            }} />
          ) : (
            <DownloadBar onTemplate={downloadProjectionsTemplate} />
          )}
        </div>
      )}

      {tab === "provisional" && (
        <>
          {hasPartner && (
            <Panel title="Company" ticker="Entity">
              {entityBar}
            </Panel>
          )}
          <Panel title="Provisional Document Upload" ticker="PDF · MIS" status="idle">
            <CompactUploadGrid
              onUpload={(f) => handleProvisionalUpload(f)}
              onDelete={handleDeleteDoc}
              onRetry={handleRetry}
              busy={busy}
              docs={docs.filter(d => d.doc_class === "provisional")}
              progress={progress}
              progressLabel={progressLabel}
              showClass={false}
              showFy={false}
              hint={["Upload provisional / MIS financial statement PDF", "P&L and Balance Sheet will be extracted automatically"]}
            />
          </Panel>
          <ProvisionalTab
            cc={cc}
            periods={ic?.provisional ?? []}
            extracted={activeExtracted}
            onSave={saveProvisional}
          />
        </>
      )}

      {tab === "ic_note" && (
        <div className="space-y-3">
          {/* Combined entity notice */}
          {hasPartner && (
            <div className="flex items-center gap-3 border border-primary/30 bg-primary/5 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-[9px] tracking-widest text-muted-foreground mb-0.5">COMBINED ANALYSIS</div>
                <div className="text-xs font-bold text-primary tracking-widest flex items-center gap-2 flex-wrap">
                  <span>{cc.client_name.toUpperCase()}</span>
                  <span className="text-muted-foreground font-normal">+</span>
                  <span>{partnerCompanyName.toUpperCase()}</span>
                </div>
              </div>
              <span className="text-[9px] tracking-widest text-primary/60 border border-primary/30 px-2 py-1 shrink-0">FINAL OUTPUT</span>
            </div>
          )}
          {/* ── IC Note PDF import ─────────────────────────────────────────── */}
          <input ref={icImportFileRef} type="file" className="hidden" accept=".pdf"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleIcNoteImport(f); e.target.value = ""; }} />
          <Panel title="IC Note PDF Import" ticker="OCR · Optional" status="idle">
            <div className="space-y-2">
              <div className="text-[10px] text-muted-foreground tracking-wide">
                Upload an existing IC appraisal / credit assessment PDF — Mistral will extract all sections, risks, CPs and SWOT automatically.
              </div>
              {icImportBusy ? (
                <div className="space-y-1">
                  <div className="h-1.5 bg-border rounded-full overflow-hidden">
                    <div className="h-full bg-primary transition-all duration-300" style={{ width: `${icImportProgress}%` }} />
                  </div>
                  <div className="text-[10px] text-muted-foreground tracking-widest">{icImportLabel} {icImportProgress}%</div>
                </div>
              ) : (
                <button
                  onClick={() => icImportFileRef.current?.click()}
                  className="text-sm border border-border rounded px-3 py-1.5 hover:border-primary hover:text-primary transition-colors"
                >
                  ⬆ Import IC Note PDF
                </button>
              )}
            </div>
          </Panel>

          {/* Generate progress (shown while busy) */}
          {busy && (
            <div className="border border-border px-4 py-3 space-y-1">
              <div className="h-1.5 bg-border rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>
              <div className="text-[10px] text-muted-foreground tracking-widest">{progressLabel} {progress}%</div>
            </div>
          )}

          {/* ── IC Note Document ────────────────────────────────────────────── */}
          <ICNoteDocument
            cc={cc}
            extracted={activeExtracted}
            ratios={ratios}
            ic={(ic ?? {}) as IcNoteShape}
            userEmail={user?.email ?? ""}
            busy={busy}
            progress={progress}
            progressLabel={progressLabel}
            docs={docs.filter(d => d.doc_class === "projections")}
            allDocs={mainDocs}
            onGenerate={(notes) => runNarrative(notes)}
            onUpload={(f, cls, fy) => handleUpload(f, cls, fy)}
            onCancel={handleCancelUpload}
            onEdit={handleEditDoc}
            onDelete={handleDeleteDoc}
            onRetry={handleRetry}
            onPatchSection={patchIcSection}
            onAddComment={addIcComment}
            onResolveComment={resolveIcComment}
            onAnnotationsChange={saveAnnotations}
            onCellEdit={saveCellEdit}
            onAddRow={saveCustomRow}
            onCasePatch={saveCaseField}
            onRatioPatch={saveRatioField}
            company={linkedCompany}
            directors={linkedDirs}
            triangulationData={triangulationData?.report_data ?? null}
          />

          {/* PDF download (only when note exists) */}
          {ic?.sections && (
            <>
              <ICFinalRecommendation cc={cc} ratios={ratios} extracted={extracted} ic={ic!} />
              <DownloadBar onPdf={() => {
                const docEl = document.getElementById("ic-note-doc");
                if (!docEl) return;

                // Capture all page styles so Tailwind + CSS vars work in the print window
                const inlineStyles = Array.from(document.styleSheets)
                  .map(ss => { try { return Array.from(ss.cssRules).map(r => r.cssText).join("\n"); } catch { return ""; } })
                  .join("\n");
                const linkTags = Array.from(document.styleSheets)
                  .filter(ss => ss.href && !ss.href.startsWith(window.location.origin))
                  .map(ss => `<link rel="stylesheet" href="${ss.href}">`)
                  .join("\n");

                const win = window.open("", "_blank", "width=1100,height=900");
                if (!win) return;
                win.document.write(`<!DOCTYPE html><html><head>
                  <title>${cc.case_code ?? "IC Note"}</title>
                  ${linkTags}
                  <style>
                    ${inlineStyles}
                    *{box-sizing:border-box}
                    body{background:#FAFAF6;-webkit-print-color-adjust:exact;print-color-adjust:exact;margin:0;padding:0}
                    @page{size:A4;margin:8mm}
                    [data-no-print]{display:none!important}
                    button,input[type="range"],textarea{display:none!important}
                    /* Unlock all flex/overflow constraints so content fully expands */
                    #ic-note-doc{height:auto!important;min-height:0!important;border:none!important;display:flex!important;flex-direction:column!important}
                    #ic-note-body-row{overflow:visible!important;flex:none!important;height:auto!important;min-height:0!important}
                    #ic-note-scroll{overflow:visible!important;max-height:none!important;flex:1!important;height:auto!important;min-height:0!important}
                    /* Remove page-level overflow clipping */
                    html,body{overflow:visible!important;height:auto!important}
                  </style>
                </head><body>${docEl.outerHTML}</body></html>`);
                win.document.close();
                setTimeout(() => win.print(), 1500);
              }} />
            </>
          )}
        </div>
      )}
      {tab === "partner" && partnerSubTab === "ratios" && (() => {
        const pYears = Array.from(new Set(partnerExtracted.map(r => r.fiscal_year))).sort();
        const getItems = (fy: number, types: string[]) => {
          const out: LineItem[] = []; const seen = new Set<string>();
          for (const row of partnerExtracted.filter(r => r.fiscal_year === fy && types.includes(r.statement_type)))
            for (const it of (row.line_items as unknown as LineItem[]) ?? [])
              if (!seen.has(it.label)) { out.push(it); seen.add(it.label); }
          return out;
        };
        const gv = (items: LineItem[], ...labels: string[]) => {
          for (const l of labels) { const it = items.find(i => i.label === l); if (it) return it.override_value ?? it.value; }
          return null;
        };
        type PRatio = { label: string; fmt: (v: number) => string; good: (v: number) => boolean; bench: string };
        const PRATIOS: PRatio[] = [
          { label: "Current Ratio",     fmt: v => v.toFixed(2) + "x", good: v => v >= 1.5,  bench: "≥ 1.5x" },
          { label: "Debt / Equity",     fmt: v => v.toFixed(2) + "x", good: v => v <= 2.0,  bench: "≤ 2.0x" },
          { label: "Net Profit Margin", fmt: v => v.toFixed(1) + "%", good: v => v >= 8,    bench: "≥ 8%" },
          { label: "EBITDA Margin",     fmt: v => v.toFixed(1) + "%", good: v => v >= 15,   bench: "≥ 15%" },
          { label: "Interest Coverage", fmt: v => v.toFixed(2) + "x", good: v => v >= 2.0,  bench: "≥ 2.0x" },
        ];
        const data = pYears.map(fy => {
          const pl = getItems(fy, ["profit_loss", "all_in_one"]);
          const bs = getItems(fy, ["balance_sheet", "all_in_one"]);
          const rev  = gv(pl, "Turnover", "Revenue", "Net Revenue", "Total Revenue");
          const pat  = gv(pl, "PAT", "Net Profit", "Profit After Tax");
          const ebit = gv(pl, "EBITDA");
          const intr = gv(pl, "Interest Expense", "Finance Cost");
          const ca   = gv(bs, "Current Assets", "Total Current Assets");
          const cl   = gv(bs, "Current Liabilities", "Total Current Liabilities");
          const debt = gv(bs, "Total Debt", "Total Borrowings");
          const nw   = gv(bs, "Net Worth", "Networth", "Equity");
          return {
            fy,
            "Current Ratio":     ca != null && cl != null && cl !== 0 ? ca / cl : null,
            "Debt / Equity":     debt != null && nw != null && nw !== 0 ? debt / nw : null,
            "Net Profit Margin": rev != null && pat != null && rev !== 0 ? (pat / rev) * 100 : null,
            "EBITDA Margin":     rev != null && ebit != null && rev !== 0 ? (ebit / rev) * 100 : null,
            "Interest Coverage": ebit != null && intr != null && intr !== 0 ? ebit / intr : null,
          };
        });
        return (
          <Panel title={`RATIOS — ${partnerCompanyName.toUpperCase()}`} ticker="COMPUTED FROM FINANCIALS">
            {partnerExtracted.length === 0 ? (
              <div className="text-muted-foreground text-xs">Upload and confirm partner financials first to compute ratios.</div>
            ) : pYears.length === 0 ? (
              <div className="text-muted-foreground text-xs">No fiscal years found in partner extracted data.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[360px]">
                  <thead className="text-muted-foreground border-b border-border">
                    <tr>
                      <th className="text-left py-1">RATIO</th>
                      {pYears.map(y => <th key={y} className="text-right pr-1">FY{y}</th>)}
                      <th className="text-right">BENCHMARK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PRATIOS.map(({ label, fmt, good, bench }) => (
                      <tr key={label} className="border-b border-border/30">
                        <td className="py-1 text-foreground/90">{label}</td>
                        {pYears.map(y => {
                          const row = data.find(d => d.fy === y);
                          const val = row ? (row as Record<string, number | null>)[label] : null;
                          return (
                            <td key={y} className="text-right pr-1">
                              {val == null ? <span className="text-muted-foreground">—</span> : (
                                <div className="inline-flex items-center gap-1.5 justify-end">
                                  <span className="tabular-nums">{fmt(val)}</span>
                                  <span className={`px-1.5 py-0 text-[9px] tracking-widest font-bold leading-5 ${good(val) ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
                                    {good(val) ? "OK" : "WEAK"}
                                  </span>
                                </div>
                              )}
                            </td>
                          );
                        })}
                        <td className="text-right text-muted-foreground tabular-nums text-[11px]">{bench}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        );
      })()}

      {(tab === "bank" || (tab === "partner" && partnerSubTab === "bank")) && (
        <>
          {tab === "bank" && (
            <AccumnBsaPanel
              caseId={cc.id}
              docs={docs}
              orders={accumnOrders.filter(o => o.product_type === "BSA")}
              user={user!}
              onReload={reload}
            />
          )}
          <BankStatementTab
            cc={cc}
            data={activeBankData}
            docs={tab === "partner" ? partnerDocs : docs}
            user={user!}
            bsaData={bsaData}
            onReload={reload}
          />
          {tab === "bank" && <DownloadBar onTemplate={downloadBankTemplate} />}
        </>
      )}
      {(tab === "gst" || (tab === "partner" && partnerSubTab === "gst")) && (
        <>
          {tab === "gst" && (
            <AccumnApiPanel
              caseId={cc.id}
              casePan={(cc as unknown as Record<string, string>).principal_borrower_pan ?? undefined}
              caseGstin={(cc as unknown as Record<string, string>).gstin ?? undefined}
              orders={accumnOrders.filter(o => o.product_type !== "BSA")}
              onReload={reload}
            />
          )}
          <GstTab
            cc={cc}
            data={activeGstData}
            extracted={activeExtracted}
            user={user!}
            onReload={reload}
            docs={tab === "partner" ? partnerDocs : docs}
            accumnData={tab === "partner" ? null : accumnData}
          />
          {tab === "gst" && <DownloadBar onTemplate={downloadGstTemplate} />}
        </>
      )}

      {tab === "cibil" && (
        <CibilTab
          cc={cc}
          data={docs}
          cibilData={cibilData}
          user={user!}
          onReload={reload}
        />
      )}

      {tab === "triangulation" && (
        <TriangulationTab
          cc={cc}
          data={triangulationData}
          user={user!}
          onReload={reload}
        />
      )}

      {tab === "visit_report" && (
        <VisitReportTab
          cc={cc}
          user={user!}
          onReload={reload}
        />
      )}

      {/* ── Text viewer popover ────────────────────────────────────────── */}
      {textPopover && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm" onClick={()=>setTextPopover(null)}>
          <div className="bg-card border border-border w-full max-w-sm mx-4" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface/60">
              <span className="text-[9px] tracking-widest text-muted-foreground">{textPopover.label}</span>
              <button onClick={()=>setTextPopover(null)} className="text-muted-foreground hover:text-primary text-sm leading-none">✕</button>
            </div>
            <div className="px-4 py-3 text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto">{textPopover.text}</div>
          </div>
        </div>
      )}

      {/* ── Company Edit Modal ─────────────────────────────────────────── */}
      {editCoOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/80 backdrop-blur-sm overflow-y-auto py-8" onClick={e => { if (e.target === e.currentTarget) setEditCoOpen(false); }}>
          <div className="bg-card border border-border w-full max-w-2xl mx-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface/60">
              <div className="text-[10px] tracking-widest text-muted-foreground">EDIT COMPANY DETAILS</div>
              <button onClick={() => setEditCoOpen(false)} className="text-muted-foreground hover:text-primary text-sm leading-none">✕</button>
            </div>
            <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
              <div>
                <div className="text-[9px] tracking-widest text-muted-foreground mb-2 border-b border-border/30 pb-1">BASIC</div>
                <div className="grid grid-cols-2 gap-3">
                  {([["name","Company Name"],["website","Website"]] as const).map(([k,l]) => (
                    <label key={k} className="flex flex-col gap-1">
                      <span className="text-[9px] tracking-widest text-muted-foreground">{l}</span>
                      <input value={editCoForm[k]??""} onChange={e=>setEditCoForm(f=>({...f,[k]:e.target.value}))} className="bg-surface border border-border px-2 py-1 text-xs text-primary font-mono focus:outline-none focus:border-primary/60 w-full" />
                    </label>
                  ))}
                  <label className="flex flex-col gap-1 col-span-2">
                    <span className="text-[9px] tracking-widest text-muted-foreground">Registered Address</span>
                    <input value={editCoForm.registered_address??""} onChange={e=>setEditCoForm(f=>({...f,registered_address:e.target.value}))} className="bg-surface border border-border px-2 py-1 text-xs text-primary font-mono focus:outline-none focus:border-primary/60 w-full" />
                  </label>
                </div>
              </div>
              <div>
                <div className="text-[9px] tracking-widest text-muted-foreground mb-2 border-b border-border/30 pb-1">MCA / CORPOSITORY</div>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    ["mca_cin","CIN"],["mca_pan","PAN"],["mca_lei","LEI"],
                    ["mca_category","Category"],["mca_sub_category","Sub Category"],["mca_type","Company Type"],
                    ["mca_authorized_capital","Auth. Capital"],["mca_paid_up_capital","Paid Up Capital"],["mca_status","Status"],
                    ["mca_nse_sector","NSE Sector"],["mca_sector","Sector"],
                    ["mca_email","Email"],["mca_telephone","Telephone"],
                    ["mca_date_of_incorp","Incorporation Date"],["mca_date_last_bs","Last Balance Sheet"],["mca_date_last_agm","Last AGM"],
                  ] as const).map(([k,l]) => (
                    <label key={k} className="flex flex-col gap-1">
                      <span className="text-[9px] tracking-widest text-muted-foreground">{l}</span>
                      <input value={editCoForm[k]??""} onChange={e=>setEditCoForm(f=>({...f,[k]:e.target.value}))} className="bg-surface border border-border px-2 py-1 text-xs text-primary font-mono focus:outline-none focus:border-primary/60 w-full" />
                    </label>
                  ))}
                  <label className="flex flex-col gap-1 col-span-2">
                    <span className="text-[9px] tracking-widest text-muted-foreground">Products / Services</span>
                    <input value={editCoForm.mca_products_services??""} onChange={e=>setEditCoForm(f=>({...f,mca_products_services:e.target.value}))} className="bg-surface border border-border px-2 py-1 text-xs text-primary font-mono focus:outline-none focus:border-primary/60 w-full" />
                  </label>
                  <label className="flex flex-col gap-1 col-span-2">
                    <span className="text-[9px] tracking-widest text-muted-foreground">About the Company</span>
                    <textarea rows={4} value={editCoForm.mca_about??""} onChange={e=>setEditCoForm(f=>({...f,mca_about:e.target.value}))} className="bg-surface border border-border px-2 py-1 text-xs text-primary font-mono focus:outline-none focus:border-primary/60 resize-none w-full" />
                  </label>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
              <button onClick={() => setEditCoOpen(false)} className="text-[10px] tracking-widest text-muted-foreground border border-border px-3 py-1.5 hover:bg-surface">CANCEL</button>
              <button onClick={saveEditCo} disabled={savingCo} className="text-[10px] tracking-widest bg-primary text-primary-foreground px-3 py-1.5 hover:bg-primary/90 disabled:opacity-50">{savingCo ? "SAVING…" : "SAVE"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Director Add / Edit Modal ───────────────────────────────────── */}
      {editDirOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/80 backdrop-blur-sm overflow-y-auto py-8" onClick={e => { if (e.target === e.currentTarget) setEditDirOpen(false); }}>
          <div className="bg-card border border-border w-full max-w-2xl mx-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface/60">
              <div className="text-[10px] tracking-widest text-muted-foreground">{editDirId ? "EDIT DIRECTOR" : "ADD DIRECTOR"}</div>
              <button onClick={() => setEditDirOpen(false)} className="text-muted-foreground hover:text-primary text-sm leading-none">✕</button>
            </div>
            <div className="p-4 max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                {([
                  ["name","Name *"],["din","DIN"],["pan","PAN"],["dob","DOB"],["age","Age"],
                  ["gender","Gender"],["nationality","Nationality"],
                  ["din_status","DIN Status"],["dsc_status","DSC Status"],
                  ["designation","Designation (CATEGORY)"],
                  ["appointed_current","Appointed Current"],["originally_appointed","Originally Appointed"],
                  ["cessation_date","Cessation Date"],["shareholding","% Shareholding"],
                  ["email","Email"],["phone","Phone"],["remarks","Remarks"],
                ] as const).map(([k,l]) => (
                  <label key={k} className="flex flex-col gap-1">
                    <span className="text-[9px] tracking-widest text-muted-foreground">{l}</span>
                    <input value={editDirForm[k]??""} onChange={e=>setEditDirForm(f=>({...f,[k]:e.target.value}))} className="bg-surface border border-border px-2 py-1 text-xs text-primary font-mono focus:outline-none focus:border-primary/60 w-full" />
                  </label>
                ))}
                <label className="flex flex-col gap-1 col-span-2">
                  <span className="text-[9px] tracking-widest text-muted-foreground">Address</span>
                  <textarea rows={3} value={editDirForm.address??""} onChange={e=>setEditDirForm(f=>({...f,address:e.target.value}))} className="bg-surface border border-border px-2 py-1 text-xs text-primary font-mono focus:outline-none focus:border-primary/60 resize-none w-full" />
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
              <button onClick={() => setEditDirOpen(false)} className="text-[10px] tracking-widest text-muted-foreground border border-border px-3 py-1.5 hover:bg-surface">CANCEL</button>
              <button onClick={saveEditDir} disabled={savingDir} className="text-[10px] tracking-widest bg-primary text-primary-foreground px-3 py-1.5 hover:bg-primary/90 disabled:opacity-50">{savingDir ? "SAVING…" : "SAVE"}</button>
            </div>
          </div>
        </div>
      )}

    </TerminalLayout>
  );
}

// ─── Bank Statement Tab ───────────────────────────────────────────────────────
function BankStatementTab({ cc, data, docs, user, bsaData, onReload }: { cc: CaseRow; data: Tables<"bank_statement_data">[]; docs: DocRow[]; user: { id: string }; bsaData: BsaReportRow | null; onReload: () => Promise<void> }) {
  const [busy, setBusy]         = useState(false);
  const [progress, setProgress] = useState(0);
  const [label, setLabel]       = useState("");
  const [editCell, setEditCell] = useState<{ id: string; field: string; value: string } | null>(null);
  const [bsaBusy, setBsaBusy]   = useState(false);

  const fmt = (v: number | null) => v == null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const fmtN = (v: number | null) => v == null ? null : v.toLocaleString("en-IN", { maximumFractionDigits: 0 });

  const commitBankEdit = async () => {
    if (!editCell) return;
    const snap = editCell;
    setEditCell(null);
    const raw = snap.value.trim().replace(/,/g, "");
    const num = raw === "" ? null : parseFloat(raw);
    if (raw !== "" && (isNaN(num!) || !isFinite(num!))) return;
    await supabase.from("bank_statement_data").update({ [snap.field]: num } as never).eq("id", snap.id);
    await onReload();
  };

  const bankNumCell = (id: string, field: string, val: number | null) => {
    if (editCell?.id === id && editCell?.field === field) return (
      <input autoFocus
        className="w-full bg-transparent border-b border-primary text-right tabular-nums outline-none"
        style={{ fontSize: "inherit", fontFamily: "inherit", minWidth: "3rem" }}
        value={editCell.value}
        onChange={e => setEditCell(ec => ec ? { ...ec, value: e.target.value } : ec)}
        onBlur={commitBankEdit}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitBankEdit(); } if (e.key === "Escape") setEditCell(null); }}
      />
    );
    return (
      <span className="cursor-pointer hover:text-primary transition-colors"
        onClick={() => setEditCell({ id, field, value: val == null ? "" : String(val) })}>
        {fmt(val)}
      </span>
    );
  };

  const creditData  = data.filter(r => r.total_credits != null);
  const avgCredits  = creditData.length ? creditData.reduce((s, r) => s + r.total_credits!, 0) / creditData.length : null;
  const debitData   = data.filter(r => r.total_debits != null);
  const avgDebits   = debitData.length ? debitData.reduce((s, r) => s + r.total_debits!, 0) / debitData.length : null;
  const balData     = data.filter(r => r.avg_balance != null);
  const avgBalance  = balData.length ? balData.reduce((s, r) => s + r.avg_balance!, 0) / balData.length : null;
  const totalBounce = data.reduce((s, r) => s + (r.bounce_inward ?? 0), 0);
  const bounceRate  = data.length && totalBounce ? ((totalBounce / data.length)).toFixed(1) : null;
  const bankName    = data[0]?.bank_name;

  const handleUpload = async (file: File) => {
    setBusy(true); setProgress(5); setLabel("Reading file…");
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const isExcel = ["xlsx","xls","csv"].includes(ext);
      let excelText: string | undefined;
      if (isExcel) {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        excelText = wb.SheetNames.map(n => `=== SHEET: ${n} ===\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: "\t" })}`).join("\n\n");
      }
      setProgress(20); setLabel("Uploading…");
      const path = `${user.id}/${cc.id}/bank-${Date.now()}-${file.name}`;
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/case-files/${path.split("/").map(encodeURIComponent).join("/")}`;
      await new Promise<void>((res, rej) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        xhr.setRequestHeader("Authorization", `Bearer ${session?.access_token}`);
        xhr.setRequestHeader("apikey", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
        xhr.setRequestHeader("x-upsert", "false");
        if (file.type) xhr.setRequestHeader("Content-Type", file.type);
        xhr.upload.onprogress = e => { if (e.lengthComputable) setProgress(20 + Math.round((e.loaded/e.total)*40)); };
        xhr.onload = () => xhr.status < 300 ? res() : rej(new Error(`Upload ${xhr.status}`));
        xhr.onerror = () => rej(new Error("Network error"));
        xhr.send(file);
      });
      setProgress(65); setLabel("Registering document…");
      const fileType = isExcel ? "excel" : ["jpg","jpeg","png","webp"].includes(ext) ? "image" : "pdf";
      const { data: doc, error: dErr } = await supabase.from("financial_documents").insert({
        case_id: cc.id, user_id: user.id, file_path: path, file_name: file.name,
        file_type: fileType as never, doc_class: "bank_statement" as never, extraction_status: "pending",
      }).select().single();
      if (dErr || !doc) throw new Error(dErr?.message ?? "Register failed");
      setProgress(70); setLabel("Queuing extraction…");
      const { data: { session: s2 } } = await supabase.auth.getSession();
      const fnHeaders = { "Content-Type": "application/json", "Authorization": `Bearer ${s2?.access_token}`, "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY };

      // Include any other failed/pending bank statements so they all run together
      const { data: otherDocs } = await supabase.from("financial_documents")
        .select("id")
        .eq("case_id", cc.id)
        .eq("doc_class", "bank_statement")
        .neq("id", doc.id)
        .in("extraction_status", ["failed", "pending"]);
      const allIds = [doc.id, ...(otherDocs?.map((d: { id: string }) => d.id) ?? [])];

      const queueRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trigger-bank-extraction`, {
        method: "POST", headers: fnHeaders,
        body: JSON.stringify({
          case_id: cc.id, user_id: user.id, document_ids: allIds,
          ...(excelText ? { excel_texts: { [doc.id]: excelText } } : {}),
        }),
      });
      if (!queueRes.ok) { const j = await queueRes.json().catch(() => ({})); throw new Error(j.error ?? `Queue failed HTTP ${queueRes.status}`); }

      setProgress(75); setLabel(`Extracting ${allIds.length} statement${allIds.length > 1 ? "s" : ""} in parallel…`);
      const tick = setInterval(() => setProgress(p => p < 94 ? p + 1 : p), 700);
      // Poll the newly registered doc until it completes
      const abort = new AbortController();
      try {
        await pollExtractionStatus(doc.id, abort.signal);
      } finally {
        clearInterval(tick);
      }
      setProgress(100); setLabel("Done");
      toast.success("Bank statements extracted");
      await onReload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setTimeout(() => { setBusy(false); setProgress(0); setLabel(""); }, 600);
    }
  };

  const failedDocs = docs.filter(d => d.doc_class === "bank_statement" && d.extraction_status === "failed");

  const retryFailed = async () => {
    if (!failedDocs.length) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token}`, "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY };
      const ids = failedDocs.map(d => d.id);
      await supabase.from("financial_documents").update({ extraction_status: "running", extraction_error: null }).in("id", ids);
      const { error: triggerErr } = await supabase.functions.invoke("trigger-bank-extraction", {
        body: { case_id: cc.id, user_id: user.id, document_ids: ids },
      });
      if (triggerErr) {
        ids.forEach(id => {
          supabase.functions.invoke("extract-bank-statement", {
            body: { case_id: cc.id, document_id: id },
          });
        });
      }
      toast.success(`Re-running ${ids.length} statement${ids.length > 1 ? "s" : ""}`);
      await onReload();
    } catch (e) {
      toast.error("Retry failed: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const deleteDoc = async (doc: DocRow) => {
    await supabase.from("financial_documents").delete().eq("id", doc.id);
    await onReload();
  };

  const retryDoc = async (doc: DocRow) => {
    await supabase.from("financial_documents").update({ extraction_status: "pending", extraction_error: null }).eq("id", doc.id);
    const { data: { session } } = await supabase.auth.getSession();
    const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token}`, "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY };
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trigger-bank-extraction`, {
      method: "POST", headers,
      body: JSON.stringify({ case_id: cc.id, user_id: user.id, document_ids: [doc.id] }),
    });
    toast.success("Re-running extraction");
    await onReload();
  };

  const deleteAll = async () => {
    if (!window.confirm("Delete all bank statement data for this case?")) return;
    await supabase.from("bank_statement_data").delete().eq("case_id", cc.id);
    await onReload();
    toast.success("Bank statement data deleted");
  };

  const handleBsaUpload = async (file: File) => {
    setBsaBusy(true);
    try {
      const parsed = await parseBsaExcel(file);
      const path = `${user.id}/${cc.id}/bsa-${Date.now()}-${file.name}`;
      const { data: { session } } = await supabase.auth.getSession();
      const uploadUrl = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/case-files/${path.split("/").map(encodeURIComponent).join("/")}`;
      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Authorization": `Bearer ${session?.access_token}`, "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!uploadRes.ok) throw new Error(`Upload failed HTTP ${uploadRes.status}`);
      const { data: docRow, error: docErr } = await supabase.from("financial_documents").insert({
        case_id: cc.id, user_id: user.id, file_path: path, file_name: file.name,
        file_type: "excel" as never, doc_class: "bank_statement" as never, extraction_status: "extracted",
      }).select().single();
      if (docErr || !docRow) throw new Error(docErr?.message ?? "Doc register failed");
      const dbRaw = supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> };
      const { error: upsertErr } = await (dbRaw.from("bsa_report_data").upsert({
        case_id: cc.id, document_id: docRow.id, user_id: user.id,
        report_data: parsed,
        company_name: parsed.exec_summary.company_name,
        period_covered: parsed.exec_summary.period_covered,
        bank_names: parsed.exec_summary.accounts.map(a => a.bank),
        abb: parsed.exec_summary.abb,
        total_net_credits: parsed.exec_summary.total_net_credits,
        total_net_debits: parsed.exec_summary.total_net_debits,
      }, { onConflict: "case_id,document_id" }) as Promise<{ error: Error | null }>);
      if (upsertErr) throw new Error("BSA upsert failed: " + upsertErr.message);
      toast.success("BSA report imported");
      await onReload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "BSA import failed");
    } finally {
      setBsaBusy(false);
    }
  };

  const deleteBsa = async () => {
    if (!bsaData || !window.confirm("Delete BSA report data?")) return;
    const dbRaw = supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> };
    await (dbRaw.from("bsa_report_data").delete().eq("id", bsaData.id) as Promise<unknown>);
    toast.success("BSA report deleted");
    await onReload();
  };

  const bankDocs = docs.filter(d => d.doc_class === "bank_statement");

  return (
    <div className="space-y-3">
      {/* Upload */}
      <Panel title="Bank Statement Upload" ticker="AI Extraction" status={data.length > 0 ? "live" : "idle"}
        actions={
          <div className="flex gap-2">
            {failedDocs.length > 0 && (
              <button onClick={retryFailed} className="text-sm text-amber-600 hover:text-amber-800 border border-amber-200 rounded px-2 py-1 hover:bg-amber-50 transition-colors">
                Retry {failedDocs.length} failed
              </button>
            )}
            {data.length > 0 && <button onClick={deleteAll} className="text-sm text-red-500 hover:text-red-700 border border-red-200 rounded px-2 py-1 hover:bg-red-50 transition-colors">Delete All</button>}
          </div>
        }
      >
        <UploadGrid
          onUpload={(f) => handleUpload(f)}
          onDelete={deleteDoc}
          onRetry={retryDoc}
          busy={busy}
          docs={bankDocs}
          progress={progress}
          progressLabel={label}
          lockedClass="bank_statement"
          hint={["Multiple months OK — drop all at once to extract in parallel", "PDF, Excel, or image formats supported"]}
        />
      </Panel>

      {data.length > 0 && (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Panel title="Avg Monthly Credits" ticker={bankName ?? "Bank"}>
              <div className="text-xl font-bold text-success">₹{fmt(avgCredits)}</div>
              <div className="text-xs text-muted-foreground mt-1">per month</div>
            </Panel>
            <Panel title="Avg Monthly Debits">
              <div className="text-xl font-bold text-destructive">₹{fmt(avgDebits)}</div>
              <div className="text-xs text-muted-foreground mt-1">per month</div>
            </Panel>
            <Panel title="Avg Balance (AMB)" status={avgBalance && avgBalance > 0 ? "live" : "idle"}>
              <div className="text-xl font-bold text-primary">₹{fmt(avgBalance)}</div>
              <div className="text-xs text-muted-foreground mt-1">average monthly balance</div>
            </Panel>
            <Panel title="Inward Bounces" status={totalBounce > 0 ? "idle" : "live"}>
              <div className={`text-xl font-bold ${totalBounce > 0 ? "text-destructive" : "text-success"}`}>{totalBounce}</div>
              <div className="text-xs text-muted-foreground mt-1">{bounceRate ? `${bounceRate}/month avg` : "nil"}</div>
            </Panel>
          </div>

          {/* Monthly table */}
          <Panel title="Monthly Bank Analysis" ticker={`${data.length} months`}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-1 pr-2">MONTH</th>
                    <th className="text-right pr-2">OPENING</th>
                    <th className="text-right pr-2">CREDITS</th>
                    <th className="text-right pr-2">DEBITS</th>
                    <th className="text-right pr-2">CLOSING</th>
                    <th className="text-right pr-2">AVG BAL</th>
                    <th className="text-right pr-2">EMI OUTFLOW</th>
                    <th className="text-center pr-2">BNCE↓</th>
                    <th className="text-center pr-2">BNCE↑</th>
                    <th className="text-right">NET FLOW</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map(row => {
                    const net = row.total_credits != null && row.total_debits != null ? row.total_credits - row.total_debits : null;
                    const bi = row.bounce_inward ?? 0;
                    const bo = row.bounce_outward ?? 0;
                    return (
                      <tr key={row.id} className="border-b border-border/30">
                        <td className="py-1 pr-2 font-medium">{row.month}</td>
                        <td className="text-right pr-2 tabular-nums text-muted-foreground">{bankNumCell(row.id, "opening_balance", row.opening_balance)}</td>
                        <td className="text-right pr-2 tabular-nums text-success">{bankNumCell(row.id, "total_credits", row.total_credits)}</td>
                        <td className="text-right pr-2 tabular-nums text-destructive">{bankNumCell(row.id, "total_debits", row.total_debits)}</td>
                        <td className="text-right pr-2 tabular-nums font-medium">{bankNumCell(row.id, "closing_balance", row.closing_balance)}</td>
                        <td className="text-right pr-2 tabular-nums text-accent">{bankNumCell(row.id, "avg_balance", row.avg_balance)}</td>
                        <td className="text-right pr-2 tabular-nums text-warning">{bankNumCell(row.id, "emi_outflows", row.emi_outflows)}</td>
                        <td className={`text-center pr-2 font-bold ${bi > 0 ? "text-destructive" : "text-muted-foreground"}`}>{bankNumCell(row.id, "bounce_inward", row.bounce_inward)}</td>
                        <td className={`text-center pr-2 font-bold ${bo > 0 ? "text-warning" : "text-muted-foreground"}`}>{bankNumCell(row.id, "bounce_outward", row.bounce_outward)}</td>
                        <td className={`text-right tabular-nums font-bold ${net == null ? "text-muted-foreground" : net >= 0 ? "text-success" : "text-destructive"}`}>{net == null ? "—" : (net >= 0 ? "+" : "") + fmt(net)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Chart */}
          {data.length >= 2 && (
            <Panel title="Credits vs Debits Trend" ticker="Monthly Cash Flow">
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.map(r => ({ month: r.month.slice(5), credits: r.total_credits, debits: r.total_debits, balance: r.avg_balance }))} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="month" tick={{ fill: "#6b7280", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} width={54} tickFormatter={v => Math.abs(v) >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} />
                    <RTooltip contentStyle={{ background: "#0f172a", border: "1px solid #1f2937", fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 10, color: "#9ca3af" }} />
                    <Bar dataKey="credits" name="Credits" fill="#22c55e" opacity={0.8} radius={[2,2,0,0]} />
                    <Bar dataKey="debits" name="Debits" fill="#ef4444" opacity={0.8} radius={[2,2,0,0]} />
                    <Line type="monotone" dataKey="balance" name="Avg Balance" stroke="#60a5fa" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          )}

          {/* Insights */}
          {(() => {
            const obs: { text: string; cls: string }[] = [];
            if (totalBounce > 2) obs.push({ text: `${totalBounce} inward bounces detected across ${data.length} months — signals payment stress`, cls: "text-destructive" });
            else if (totalBounce === 0) obs.push({ text: "Zero inward bounces — clean repayment track record", cls: "text-success" });
            if (avgCredits && avgDebits) {
              const util = avgDebits / avgCredits * 100;
              if (util > 90) obs.push({ text: `High fund utilisation: ${util.toFixed(0)}% of credits consumed as debits — limited buffer`, cls: "text-warning" });
              else obs.push({ text: `Fund utilisation: ${util.toFixed(0)}% of credits consumed — healthy operating buffer`, cls: "text-success" });
            }
            if (avgBalance && avgBalance < 0) obs.push({ text: "Negative average balance detected — possible overdraft usage", cls: "text-destructive" });
            return obs.length > 0 ? (
              <Panel title="Bank Analysis Insights" ticker="Auto">
                <div className="space-y-1.5">
                  {obs.map((o, i) => <div key={i} className={`text-xs flex gap-2 ${o.cls}`}><span>▸</span><span>{o.text}</span></div>)}
                </div>
              </Panel>
            ) : null;
          })()}
        </>
      )}

      {/* ── BSA Import (Accumn Consolidated Excel) ── */}
      <Panel
        title="Bank Statement Analysis (BSA)" ticker="Accumn Excel"
        status={bsaData ? "live" : "idle"}
        actions={bsaData ? (
          <button onClick={deleteBsa} className="text-[9px] tracking-widest text-destructive/70 border border-destructive/30 px-2 py-0.5 hover:bg-destructive/10">
            DELETE BSA
          </button>
        ) : undefined}
      >
        {!bsaData ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Import an Accumn Consolidated BSA Excel (.xlsx) to display pre-computed banking analytics.</p>
            <label className={`flex items-center gap-2 text-[10px] tracking-widest px-3 py-1.5 border transition-colors cursor-pointer ${bsaBusy ? "border-muted text-muted-foreground opacity-40 cursor-not-allowed" : "border-primary text-primary hover:bg-primary hover:text-primary-foreground"}`}>
              <input type="file" accept=".xlsx,.xls" className="hidden" disabled={bsaBusy}
                onChange={async e => { const f = e.target.files?.[0]; if (f) { e.target.value = ""; await handleBsaUpload(f); } }} />
              {bsaBusy ? "IMPORTING…" : "↑ IMPORT BSA EXCEL"}
            </label>
            <p className="text-[9px] text-muted-foreground/60">Expects sheets: Exec Summary, Flags, CAM Analysis, Trade Credits, Trade Debits, Irregularity Indicators</p>
          </div>
        ) : (() => {
          const bsa = bsaData.report_data;
          const es = bsa.exec_summary;
          const fmtC = (v: number | null | undefined) => v == null ? "—" : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
          const fmtL = (v: number | null | undefined) => v == null ? "—" : `₹${(v / 100000).toLocaleString("en-IN", { maximumFractionDigits: 2 })}L`;

          return (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex flex-wrap gap-4 items-start">
                <div>
                  <div className="text-[9px] tracking-widest text-muted-foreground">COMPANY</div>
                  <div className="text-sm font-semibold">{es.company_name || "—"}</div>
                  <div className="text-[9px] text-muted-foreground mt-0.5">{es.period_covered}</div>
                </div>
                <div>
                  <div className="text-[9px] tracking-widest text-muted-foreground">ACCOUNTS</div>
                  {es.accounts.map((a, i) => (
                    <div key={i} className="text-xs text-muted-foreground">{a.bank} · {a.account_no}</div>
                  ))}
                </div>
              </div>

              {/* KPI Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="border border-border/40 p-2">
                  <div className="text-[9px] tracking-widest text-muted-foreground">ABB</div>
                  <div className="text-lg font-bold text-primary">{fmtL(es.abb)}</div>
                  <div className="text-[9px] text-muted-foreground">avg bank balance</div>
                </div>
                <div className="border border-border/40 p-2">
                  <div className="text-[9px] tracking-widest text-muted-foreground">NET CREDITS</div>
                  <div className="text-lg font-bold text-success">{fmtL(es.total_net_credits)}</div>
                  <div className="text-[9px] text-muted-foreground">{es.months_analyzed} months</div>
                </div>
                <div className="border border-border/40 p-2">
                  <div className="text-[9px] tracking-widest text-muted-foreground">NET DEBITS</div>
                  <div className="text-lg font-bold text-destructive">{fmtL(es.total_net_debits)}</div>
                  <div className="text-[9px] text-muted-foreground">{es.months_analyzed} months</div>
                </div>
                <div className="border border-border/40 p-2">
                  <div className="text-[9px] tracking-widest text-muted-foreground">BOUNCES</div>
                  <div className={`text-lg font-bold ${es.total_bounces > 0 ? "text-destructive" : "text-success"}`}>{es.total_bounces}</div>
                  <div className="text-[9px] text-muted-foreground">{es.irregularity_count} irregularities</div>
                </div>
              </div>

              {/* Flags */}
              {bsa.flags.length > 0 && (
                <div>
                  <div className="text-[9px] tracking-widest text-muted-foreground mb-1.5">FLAGS · {bsa.flags.length}</div>
                  <div className="space-y-1">
                    {bsa.flags.map(f => (
                      <div key={f.sn} className="flex gap-2 text-xs border border-warning/30 bg-warning/5 p-1.5">
                        <span className="text-warning font-bold shrink-0">{f.sn}.</span>
                        <div>
                          <span className="font-medium text-warning/90">{f.flag}</span>
                          {f.description && <span className="text-muted-foreground ml-1">— {f.description}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Monthly BSA table */}
              {bsa.monthly_data.length > 0 && (
                <div>
                  <div className="text-[9px] tracking-widest text-muted-foreground mb-1.5">MONTHLY SUMMARY · {bsa.monthly_data.length} MONTHS</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground border-b border-border">
                        <tr>
                          <th className="text-left py-1 pr-3">MONTH</th>
                          <th className="text-right pr-3">NET CREDITS</th>
                          <th className="text-right pr-3">NET DEBITS</th>
                          <th className="text-right pr-3">AVG BALANCE</th>
                          <th className="text-right pr-3">MIN BAL</th>
                          <th className="text-right pr-3">MAX BAL</th>
                          <th className="text-center">BOUNCES</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bsa.monthly_data.map(m => {
                          const net = m.net_credits != null && m.net_debits != null ? m.net_credits - m.net_debits : null;
                          return (
                            <tr key={m.month} className="border-b border-border/30">
                              <td className="py-0.5 pr-3 font-medium">{m.month}</td>
                              <td className="text-right pr-3 tabular-nums text-success">{m.net_credits != null ? fmtC(m.net_credits) : "—"}</td>
                              <td className="text-right pr-3 tabular-nums text-destructive">{m.net_debits != null ? fmtC(m.net_debits) : "—"}</td>
                              <td className="text-right pr-3 tabular-nums text-primary">{fmtC(m.avg_eod_balance)}</td>
                              <td className="text-right pr-3 tabular-nums text-muted-foreground">{fmtC(m.min_eod_balance)}</td>
                              <td className="text-right pr-3 tabular-nums text-muted-foreground">{fmtC(m.max_eod_balance)}</td>
                              <td className={`text-center font-bold ${m.inward_bounces > 0 ? "text-destructive" : "text-muted-foreground"}`}>{m.inward_bounces || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* BSA Chart */}
              {bsa.monthly_data.filter(m => m.net_credits != null).length >= 2 && (
                <div className="h-48">
                  <div className="text-[9px] tracking-widest text-muted-foreground mb-1">CREDITS vs DEBITS · BSA</div>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={bsa.monthly_data.map(m => ({ month: m.month.slice(0, 3), credits: m.net_credits, debits: m.net_debits, balance: m.avg_eod_balance }))} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="month" tick={{ fill: "#6b7280", fontSize: 9 }} />
                      <YAxis tick={{ fill: "#6b7280", fontSize: 9 }} width={54} tickFormatter={v => `${(v/100000).toFixed(0)}L`} />
                      <RTooltip contentStyle={{ background: "#0f172a", border: "1px solid #1f2937", fontSize: 10 }} formatter={(v: number) => [`₹${(v/100000).toFixed(2)}L`, ""]} />
                      <Bar dataKey="credits" name="Net Credits" fill="#22c55e" opacity={0.8} radius={[2,2,0,0]} />
                      <Bar dataKey="debits" name="Net Debits" fill="#ef4444" opacity={0.8} radius={[2,2,0,0]} />
                      <Line type="monotone" dataKey="balance" name="Avg Balance" stroke="#60a5fa" strokeWidth={1.5} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Trade Credits / Debits */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {bsa.trade_credits.length > 0 && (
                  <div>
                    <div className="text-[9px] tracking-widest text-muted-foreground mb-1.5">TOP CREDIT PARTIES</div>
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground border-b border-border">
                        <tr>
                          <th className="text-left py-0.5 pr-2">#</th>
                          <th className="text-left pr-2">PARTY</th>
                          <th className="text-right">AMOUNT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bsa.trade_credits.slice(0, 10).map(p => (
                          <tr key={p.rank} className="border-b border-border/20">
                            <td className="py-0.5 pr-2 text-muted-foreground">{p.rank}</td>
                            <td className="pr-2 truncate max-w-[120px]" title={p.name}>{p.name}</td>
                            <td className="text-right text-success tabular-nums">{fmtL(p.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {bsa.trade_debits.length > 0 && (
                  <div>
                    <div className="text-[9px] tracking-widest text-muted-foreground mb-1.5">TOP DEBIT PARTIES</div>
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground border-b border-border">
                        <tr>
                          <th className="text-left py-0.5 pr-2">#</th>
                          <th className="text-left pr-2">PARTY</th>
                          <th className="text-right">AMOUNT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bsa.trade_debits.slice(0, 10).map(p => (
                          <tr key={p.rank} className="border-b border-border/20">
                            <td className="py-0.5 pr-2 text-muted-foreground">{p.rank}</td>
                            <td className="pr-2 truncate max-w-[120px]" title={p.name}>{p.name}</td>
                            <td className="text-right text-destructive tabular-nums">{fmtL(p.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Irregularity Indicators */}
              {bsa.irregularities.filter(i => i.identified).length > 0 && (
                <div>
                  <div className="text-[9px] tracking-widest text-muted-foreground mb-1.5">IRREGULARITY INDICATORS (TRIGGERED)</div>
                  <div className="space-y-1">
                    {bsa.irregularities.filter(i => i.identified).map(i => (
                      <div key={i.sn} className="flex gap-2 text-xs border border-destructive/30 bg-destructive/5 p-1.5">
                        <span className="text-destructive font-bold shrink-0">{i.sn}.</span>
                        <div>
                          <span className="font-medium text-destructive/90">{i.indicator}</span>
                          {i.triggers != null && <span className="text-muted-foreground ml-1">({i.triggers} triggers)</span>}
                          {i.description && <div className="text-muted-foreground text-[10px]">{i.description}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </Panel>
    </div>
  );
}

// ─── Accumn GST Analytical Dashboard ─────────────────────────────────────────
function AccumnDashboard({ data, onClear }: { data: AccumnReport; onClear?: () => void }) {
  const [concTab, setConcTab] = useState<"customer" | "supplier">("customer");
  const [concPeriod, setConcPeriod] = useState<string>("");

  const fmt = (v: number | null | undefined) =>
    v == null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const pct = (v: number | null | undefined) => v == null ? "—" : `${Number(v).toFixed(1)}%`;
  const avgMon = (revenue: number | null | undefined, period: string): string => {
    if (revenue == null) return "—";
    let months = 12;
    if (!/^TTM/i.test(period)) {
      const m = period.match(/Till\s+([A-Za-z]{3})-\d{2}/i);
      if (m) {
        const names: Record<string, number> = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
        const mn = names[m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()];
        if (mn) months = mn >= 4 ? mn - 3 : mn + 9;
      }
    }
    return (revenue / months).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  };
  const sevCls = (s: string) =>
    s === "HIGH" ? "text-destructive border-destructive/30 bg-destructive/5"
    : s === "MEDIUM" ? "text-warning border-warning/30 bg-warning/5"
    : "text-success border-success/30 bg-success/5";

  const concPeriods = Array.from(new Set([
    ...(data.customer_concentration?.map(r => r.period) ?? []),
    ...(data.supplier_concentration?.map(r => r.period) ?? []),
  ])).sort();
  const activePeriod = concPeriod || concPeriods[concPeriods.length - 1] || "";
  const topCustomers = (data.customer_concentration ?? []).filter(r => r.period === activePeriod).sort((a,b) => a.rank - b.rank);
  const topSuppliers = (data.supplier_concentration ?? []).filter(r => r.period === activePeriod).sort((a,b) => a.rank - b.rank);

  const hasFlags       = (data.flags?.length ?? 0) > 0;
  const hasConc        = (data.customer_concentration?.length ?? 0) > 0 || (data.supplier_concentration?.length ?? 0) > 0;
  const highFlags      = data.flags?.filter(f => f.severity === "HIGH").length ?? 0;
  const mediumFlags    = data.flags?.filter(f => f.severity === "MEDIUM").length ?? 0;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-primary border border-primary/40 rounded px-2 py-0.5">Accumn</span>
          <span className="text-sm font-medium text-foreground">GST Analytical Report</span>
          {data.company_profile?.gstin && (
            <span className="text-xs text-muted-foreground font-mono">{data.company_profile.gstin}</span>
          )}
          {hasFlags && (
            <span className={`text-[9px] font-bold tracking-widest ${highFlags > 0 ? "text-destructive" : "text-warning"}`}>
              {highFlags > 0 ? `▲ ${highFlags} HIGH` : `△ ${mediumFlags} MEDIUM`}
            </span>
          )}
        </div>
        {onClear && (
          <button onClick={onClear} className="text-xs border border-border rounded text-muted-foreground px-2 py-1 hover:text-foreground hover:border-foreground/40 transition-colors">
            Re-extract
          </button>
        )}
      </div>

      {/* Flags */}
      {hasFlags && (
        <Panel title={`FLAGS · ${data.flags!.length} ALERTS`} ticker="RISK INDICATORS"
          status={highFlags > 0 ? "idle" : mediumFlags > 0 ? "warn" : "live"}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {data.flags!.map((flag, i) => (
              <div key={i} className={`border p-2.5 space-y-1 ${sevCls(flag.severity)}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-[8px] font-bold tracking-[0.15em] px-1.5 py-0.5 border ${sevCls(flag.severity)}`}>{flag.severity}</span>
                  <span className="text-xs font-bold leading-tight">{flag.flag_name}</span>
                </div>
                <div className="text-[10px] text-muted-foreground leading-relaxed">{flag.description}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Company Profile */}
      {data.company_profile && Object.values(data.company_profile).some(Boolean) && (
        <Panel title="Company Profile" ticker="GST Details">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs">
            {data.company_profile.name && (<div><div className="text-xs text-muted-foreground mb-0.5">Company</div><div className="text-sm font-medium">{data.company_profile.name}</div></div>)}
            {data.company_profile.gstin && (<div><div className="text-xs text-muted-foreground mb-0.5">GSTIN</div><div className="font-mono text-sm font-medium text-primary">{data.company_profile.gstin}</div></div>)}
            {data.company_profile.pan && (<div><div className="text-xs text-muted-foreground mb-0.5">PAN</div><div className="font-mono text-sm font-medium">{data.company_profile.pan}</div></div>)}
            {data.company_profile.state && (<div><div className="text-xs text-muted-foreground mb-0.5">State</div><div className="text-sm font-medium">{data.company_profile.state}</div></div>)}
            {data.company_profile.constitution && (<div><div className="text-xs text-muted-foreground mb-0.5">Constitution</div><div className="text-sm font-medium">{data.company_profile.constitution}</div></div>)}
            {data.company_profile.business_type && (<div><div className="text-xs text-muted-foreground mb-0.5">Business Type</div><div className="text-sm font-medium">{data.company_profile.business_type}</div></div>)}
            {data.company_profile.registration_date && (<div><div className="text-xs text-muted-foreground mb-0.5">Registration Date</div><div className="text-sm font-medium">{data.company_profile.registration_date}</div></div>)}
            {data.company_profile.report_date && (<div><div className="text-xs text-muted-foreground mb-0.5">Report Date</div><div className="text-sm font-medium">{data.company_profile.report_date}</div></div>)}
          </div>
        </Panel>
      )}

      {/* Sales Summary */}
      {(data.sales_summary?.length ?? 0) > 0 && (
        <Panel title="Sales Summary" ticker="Adjusted Revenue + Margins">
          <div className="space-y-3">
            {/* Transposed table — periods as columns, metrics as rows */}
            <div className="overflow-x-auto">
              <div className="text-[9px] text-muted-foreground/50 tracking-wide text-right mb-1">in ₹ Lakhs</div>
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-1 pr-4 font-normal">PARTICULARS</th>
                    {data.sales_summary!.map((row, i) => (
                      <th key={i} className="text-right pr-3 font-normal whitespace-nowrap">{row.period}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {([
                    { label: "Adjusted Revenue (Total)", getValue: (r: AccumnSalesSummary) => fmt(r.adjusted_revenue), bold: true },
                    { label: "Adjusted Revenue Per Month", getValue: (r: AccumnSalesSummary) => avgMon(r.adjusted_revenue, r.period), bold: true },
                    { label: "Net Revenue", getValue: (r: AccumnSalesSummary) => fmt(r.net_revenue) },
                    { label: "Sales Return %", getValue: (r: AccumnSalesSummary) => pct(r.sales_return_pct), muted: true },
                    { label: "Gross Margin %", getValue: (r: AccumnSalesSummary) => pct(r.gross_margin_pct) },
                    { label: "EBITDA %", getValue: (r: AccumnSalesSummary) => pct(r.ebitda_pct), muted: true },
                    { label: "PAT %", getValue: (r: AccumnSalesSummary) => pct(r.pat_pct), muted: true },
                  ] as { label: string; getValue: (r: AccumnSalesSummary) => string; bold?: boolean; muted?: boolean }[]).map(({ label, getValue, bold, muted }) => (
                    <tr key={label} className="border-b border-border/30">
                      <td className={`py-1.5 pr-4 ${bold ? "font-bold text-foreground" : "text-muted-foreground"}`}>{label}</td>
                      {data.sales_summary!.map((row, i) => (
                        <td key={i} className={`text-right pr-3 tabular-nums ${bold ? "text-primary font-bold" : muted ? "text-muted-foreground" : ""}`}>
                          {getValue(row)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(data.sales_summary!.length >= 2) && (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.sales_summary} margin={{ top: 24, right: 44, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="period" tick={{ fill: "#6b7280", fontSize: 9 }} />
                    <YAxis yAxisId="rev" tick={{ fill: "#6b7280", fontSize: 9 }} width={58}
                      tickFormatter={v => Math.abs(v) >= 100 ? `${(v/100).toFixed(0)}Cr` : `${v}L`} />
                    <YAxis yAxisId="pct" orientation="right" tick={{ fill: "#6b7280", fontSize: 9 }} width={44}
                      tickFormatter={v => `${v}%`} />
                    <RTooltip contentStyle={{ background: "#0f172a", border: "1px solid #1f2937", fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 10, color: "#9ca3af" }} />
                    <Bar yAxisId="rev" dataKey="adjusted_revenue" name="Adj. Revenue" fill="#14b8a6" opacity={0.85} radius={[2,2,0,0]}>
                      <LabelList dataKey="adjusted_revenue" position="top" style={{ fontSize: 9, fill: "#9ca3af" }}
                        formatter={(v: number) => v != null ? (Math.abs(v) >= 100 ? `${(v/100).toFixed(2)}Cr` : `${Number(v).toFixed(2)}L`) : ""} />
                    </Bar>
                    <Line yAxisId="pct" type="monotone" dataKey="gross_margin_pct" name="Gross Mgn%" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: "#0f172a", strokeWidth: 2 }}>
                      <LabelList dataKey="gross_margin_pct" position="top" style={{ fontSize: 9, fill: "#f59e0b" }}
                        formatter={(v: number) => v != null ? `${Number(v).toFixed(1)}%` : ""} />
                    </Line>
                    <Line yAxisId="pct" type="monotone" dataKey="ebitda_pct" name="EBITDA%" stroke="#60a5fa" strokeWidth={2} dot={{ r: 2.5 }} />
                    <Line yAxisId="pct" type="monotone" dataKey="pat_pct" name="PAT%" stroke="#a78bfa" strokeWidth={2} dot={{ r: 2.5 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </Panel>
      )}

      {/* Customer Category Breakup */}
      {(data.customer_categories?.length ?? 0) > 0 && (
        <Panel title="Customer Category Breakup" ticker="B2B / B2C / Export">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-1 pr-3">PERIOD</th>
                  <th className="text-right pr-3">B2B</th>
                  <th className="text-right pr-3">B2C SMALL</th>
                  <th className="text-right pr-3">B2C LARGE</th>
                  <th className="text-right pr-3">EXPORT</th>
                  <th className="text-right pr-3">NIL RATED</th>
                  <th className="text-right font-bold text-primary">TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {data.customer_categories!.map((row, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="py-1 pr-3 font-bold text-accent">{row.period}</td>
                    <td className="text-right pr-3 tabular-nums text-primary">{fmt(row.b2b)}</td>
                    <td className="text-right pr-3 tabular-nums">{fmt(row.b2c_small)}</td>
                    <td className="text-right pr-3 tabular-nums">{fmt(row.b2c_large)}</td>
                    <td className="text-right pr-3 tabular-nums text-accent">{fmt(row.export)}</td>
                    <td className="text-right pr-3 tabular-nums text-muted-foreground">{fmt(row.nil_rated)}</td>
                    <td className="text-right tabular-nums font-bold">{fmt(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* Customer / Supplier Concentration */}
      {hasConc && (
        <Panel title="Concentration Analysis" ticker="Top Customers / Suppliers">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex gap-0">
                <button onClick={() => setConcTab("customer")}
                  className={`text-[10px] px-3 py-0.5 border tracking-widest font-bold transition-colors ${concTab === "customer" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  CUSTOMERS
                </button>
                <button onClick={() => setConcTab("supplier")}
                  className={`text-[10px] px-3 py-0.5 border tracking-widest font-bold transition-colors ${concTab === "supplier" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  SUPPLIERS
                </button>
              </div>
              {concPeriods.length > 1 && (
                <div className="flex gap-1">
                  {concPeriods.map(p => (
                    <button key={p} onClick={() => setConcPeriod(p)}
                      className={`text-[9px] px-2 py-0.5 border tracking-widest transition-colors ${p === activePeriod ? "border-accent text-accent" : "border-border text-muted-foreground hover:text-foreground"}`}>
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-center py-1 pr-2 w-8">#</th>
                    <th className="text-left pr-3">NAME</th>
                    <th className="text-left pr-3">GSTIN</th>
                    <th className="text-right pr-3">AMOUNT</th>
                    <th className="text-right">SHARE</th>
                  </tr>
                </thead>
                <tbody>
                  {(concTab === "customer" ? topCustomers : topSuppliers).map((row, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="text-center py-1 pr-2 text-muted-foreground/60 text-[10px]">{row.rank}</td>
                      <td className="pr-3 font-medium max-w-[160px] truncate">{row.name}</td>
                      <td className="pr-3 font-mono text-[10px] text-muted-foreground">{row.gstin ?? "—"}</td>
                      <td className="text-right pr-3 tabular-nums text-primary font-medium">{fmt(row.amount)}</td>
                      <td className="text-right tabular-nums">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="w-10 h-1.5 bg-border/40 rounded-sm overflow-hidden hidden sm:block">
                            <div className="h-full rounded-sm bg-primary/60" style={{ width: `${Math.min(100, row.pct)}%` }} />
                          </div>
                          <span className={`font-bold text-[11px] ${row.pct >= 30 ? "text-destructive" : row.pct >= 15 ? "text-warning" : "text-foreground/70"}`}>
                            {pct(row.pct)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {(concTab === "customer" ? topCustomers : topSuppliers).length === 0 && (
                    <tr><td colSpan={5} className="py-3 text-center text-muted-foreground text-[10px]">No data for selected period</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Panel>
      )}

      {/* Geography */}
      {(data.geography?.length ?? 0) > 0 && (() => {
        const geoPeriods = Array.from(new Set(data.geography!.map(r => r.period))).sort();
        const latPeriod = geoPeriods[geoPeriods.length - 1];
        const geoRows = data.geography!.filter(r => r.period === latPeriod).sort((a,b) => b.amount - a.amount);
        return (
          <Panel title="Geography Breakup" ticker={`State-wise Sales · ${latPeriod}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-1 pr-3">STATE</th>
                    <th className="text-right pr-3">AMOUNT</th>
                    <th className="text-right">SHARE%</th>
                  </tr>
                </thead>
                <tbody>
                  {geoRows.map((row, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-1 pr-3 font-medium">{row.state}</td>
                      <td className="text-right pr-3 tabular-nums text-primary">{fmt(row.amount)}</td>
                      <td className="text-right tabular-nums">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="w-14 h-1.5 bg-border/40 rounded-sm overflow-hidden hidden sm:block">
                            <div className="h-full rounded-sm bg-accent/60" style={{ width: `${Math.min(100, row.pct)}%` }} />
                          </div>
                          <span>{pct(row.pct)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        );
      })()}

      {/* Product Concentration */}
      {(data.product_concentration?.length ?? 0) > 0 && (() => {
        const prodPeriods = Array.from(new Set(data.product_concentration!.map(r => r.period))).sort();
        const latPeriod = prodPeriods[prodPeriods.length - 1];
        const prodRows = data.product_concentration!.filter(r => r.period === latPeriod).sort((a,b) => b.amount - a.amount);
        return (
          <Panel title="Product Concentration" ticker={`HSN / Chapter Wise · ${latPeriod}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-1 pr-3">PRODUCT / DESCRIPTION</th>
                    <th className="text-left pr-3">HSN</th>
                    <th className="text-left pr-3">CHAPTER</th>
                    <th className="text-right pr-3">AMOUNT</th>
                    <th className="text-right font-bold">SHARE%</th>
                  </tr>
                </thead>
                <tbody>
                  {prodRows.slice(0, 20).map((row, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-1 pr-3 font-medium">{row.description}</td>
                      <td className="pr-3 font-mono text-[10px] text-muted-foreground">{row.hsn ?? "—"}</td>
                      <td className="pr-3 text-muted-foreground">{row.chapter ?? "—"}</td>
                      <td className="text-right pr-3 tabular-nums text-primary">{fmt(row.amount)}</td>
                      <td className="text-right tabular-nums font-bold">{pct(row.pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        );
      })()}

      {/* Tax Details */}
      {(data.tax_details?.length ?? 0) > 0 && (
        <Panel title="Tax Details" ticker="Output Tax · ITC Analysis">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-1 pr-3">PERIOD</th>
                  <th className="text-right pr-3">WC INVEST.</th>
                  <th className="text-right pr-3">OUTPUT TAX</th>
                  <th className="text-right pr-3">IGST</th>
                  <th className="text-right pr-3">CGST</th>
                  <th className="text-right pr-3">SGST</th>
                  <th className="text-right pr-3">ITC AVAILED</th>
                  <th className="text-right font-bold">NET TAX</th>
                </tr>
              </thead>
              <tbody>
                {data.tax_details!.map((row, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="py-1 pr-3 font-bold text-accent">{row.period}</td>
                    <td className="text-right pr-3 tabular-nums">{fmt(row.wc_investment)}</td>
                    <td className="text-right pr-3 tabular-nums text-warning">{fmt(row.output_tax)}</td>
                    <td className="text-right pr-3 tabular-nums text-muted-foreground">{fmt(row.igst)}</td>
                    <td className="text-right pr-3 tabular-nums text-muted-foreground">{fmt(row.cgst)}</td>
                    <td className="text-right pr-3 tabular-nums text-muted-foreground">{fmt(row.sgst)}</td>
                    <td className="text-right pr-3 tabular-nums text-accent">{fmt(row.itc_availed)}</td>
                    <td className="text-right tabular-nums font-bold text-primary">{fmt(row.net_tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* GSTR Comparison */}
      {(data.gstr_comparison?.length ?? 0) > 0 && (
        <Panel title="GSTR-1 vs GSTR-3B vs GSTR-9" ticker="Return Reconciliation">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-1 pr-3">PERIOD</th>
                  <th className="text-right pr-3">GSTR-1 T/O</th>
                  <th className="text-right pr-3">GSTR-3B T/O</th>
                  <th className="text-right pr-3">GSTR-9 T/O</th>
                  <th className="text-right pr-3">GSTR-1 TAX</th>
                  <th className="text-right pr-3">GSTR-3B TAX</th>
                  <th className="text-right">DIFF</th>
                </tr>
              </thead>
              <tbody>
                {data.gstr_comparison!.map((row, i) => {
                  const hasDiff = row.difference != null && row.difference !== 0;
                  return (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-1 pr-3 font-bold text-accent">{row.period}</td>
                      <td className="text-right pr-3 tabular-nums">{fmt(row.gstr1_turnover)}</td>
                      <td className="text-right pr-3 tabular-nums">{fmt(row.gstr3b_turnover)}</td>
                      <td className="text-right pr-3 tabular-nums text-muted-foreground">{fmt(row.gstr9_turnover)}</td>
                      <td className="text-right pr-3 tabular-nums">{fmt(row.gstr1_tax)}</td>
                      <td className="text-right pr-3 tabular-nums">{fmt(row.gstr3b_tax)}</td>
                      <td className={`text-right tabular-nums font-bold ${hasDiff ? "text-warning" : "text-success"}`}>
                        {row.difference == null ? "—" : `${row.difference >= 0 ? "+" : ""}${fmt(row.difference)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* Circular Transactions */}
      {(data.circular_transactions?.length ?? 0) > 0 && (
        <Panel title={`CIRCULAR TRANSACTIONS · ${data.circular_transactions!.length} FLAGGED`} ticker="POTENTIAL RISK" status="idle">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-1 pr-3">ENTITY</th>
                  <th className="text-left pr-3">GSTIN</th>
                  <th className="text-right pr-3">SALES TO</th>
                  <th className="text-right pr-3">PURCHASES FROM</th>
                  <th className="text-left">NOTE</th>
                </tr>
              </thead>
              <tbody>
                {data.circular_transactions!.map((row, i) => (
                  <tr key={i} className="border-b border-border/30 text-warning/90">
                    <td className="py-1 pr-3 font-medium">{row.entity}</td>
                    <td className="pr-3 font-mono text-[10px] text-muted-foreground">{row.gstin ?? "—"}</td>
                    <td className="text-right pr-3 tabular-nums">{fmt(row.sale_amount)}</td>
                    <td className="text-right pr-3 tabular-nums">{fmt(row.purchase_amount)}</td>
                    <td className="text-[10px] text-muted-foreground">{row.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

// ─── GST Tab ─────────────────────────────────────────────────────────────────
function GstTab({ cc, data, extracted, user, onReload, docs, accumnData }: { cc: CaseRow; data: Tables<"gst_return_data">[]; extracted: ExtractedRow[]; user: { id: string }; onReload: () => Promise<void>; docs: DocRow[]; accumnData: AccumnReport | null }) {
  const [busy, setBusy]           = useState(false);
  const [progress, setProgress]   = useState(0);
  const [label, setLabel]         = useState("");
  const [editCell, setEditCell]   = useState<{ id: string; field: string; value: string } | null>(null);

  // ── Accumn-specific import state ──────────────────────────────────────────
  const [accumnBusy, setAccumnBusy]       = useState(false);
  const [accumnProgress, setAccumnProgress] = useState(0);
  const [accumnLabel, setAccumnLabel]     = useState("");

  const accumnFileRef                     = useRef<HTMLInputElement>(null);

  // ── Accumn Excel direct import state ─────────────────────────────────────
  const [xlsBusy, setXlsBusy]       = useState(false);
  const [xlsProgress, setXlsProgress] = useState(0);
  const [xlsLabel, setXlsLabel]     = useState("");
  const xlsFileRef                  = useRef<HTMLInputElement>(null);

  const fmt = (v: number | null) => v == null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: 2 });

  const commitGstNum = async () => {
    if (!editCell) return;
    const snap = editCell;
    setEditCell(null);
    const raw = snap.value.trim().replace(/,/g, "");
    const num = raw === "" ? null : parseFloat(raw);
    if (raw !== "" && (isNaN(num!) || !isFinite(num!))) return;

    const row = data.find(r => r.id === snap.id);
    const patch: Record<string, number | null> = { [snap.field]: num };

    if (snap.field === "taxable_turnover")
      patch.total_turnover = (num ?? 0) + (row?.exempt_turnover ?? 0);
    else if (snap.field === "exempt_turnover")
      patch.total_turnover = (row?.taxable_turnover ?? 0) + (num ?? 0);
    else if (snap.field === "output_tax")
      patch.net_tax_paid = (num ?? 0) - (row?.itc_claimed ?? 0);
    else if (snap.field === "itc_claimed")
      patch.net_tax_paid = (row?.output_tax ?? 0) - (num ?? 0);

    await supabase.from("gst_return_data").update(patch as never).eq("id", snap.id);
    await onReload();
  };

  const commitGstText = async () => {
    if (!editCell) return;
    const snap = editCell;
    setEditCell(null);
    const val = snap.value.trim() || null;
    await supabase.from("gst_return_data").update({ [snap.field]: val } as never).eq("id", snap.id);
    await onReload();
  };

  const addGstRow = async () => {
    await supabase.from("gst_return_data").insert({
      case_id: cc.id, user_id: user.id,
      period: "", filing_status: "filed",
    } as never);
    await onReload();
  };

  const deleteGstRow = async (id: string) => {
    await supabase.from("gst_return_data").delete().eq("id", id);
    await onReload();
  };

  const gstNumCell = (id: string, field: string, val: number | null) => {
    if (editCell?.id === id && editCell?.field === field) return (
      <input autoFocus
        className="w-full bg-transparent border-b border-primary text-right tabular-nums outline-none"
        style={{ fontSize: "inherit", fontFamily: "inherit", minWidth: "3rem" }}
        value={editCell.value}
        onChange={e => setEditCell(ec => ec ? { ...ec, value: e.target.value } : ec)}
        onBlur={commitGstNum}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitGstNum(); } if (e.key === "Escape") setEditCell(null); }}
      />
    );
    return (
      <span className="cursor-pointer group inline-flex items-center gap-0.5 justify-end w-full"
        onClick={() => setEditCell({ id, field, value: val == null ? "" : String(val) })}>
        <span className="border-b border-dotted border-transparent group-hover:border-primary/50 group-hover:text-primary transition-colors">{fmt(val)}</span>
        <span className="opacity-0 group-hover:opacity-30 text-[8px] text-primary">✎</span>
      </span>
    );
  };

  const gstTxtCell = (id: string, field: string, val: string | null, cls = "") => {
    if (editCell?.id === id && editCell?.field === field) return (
      <input autoFocus
        className="w-full bg-transparent border-b border-primary outline-none"
        style={{ fontSize: "inherit", fontFamily: "inherit", minWidth: "3rem" }}
        value={editCell.value}
        onChange={e => setEditCell(ec => ec ? { ...ec, value: e.target.value } : ec)}
        onBlur={commitGstText}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitGstText(); } if (e.key === "Escape") setEditCell(null); }}
      />
    );
    return (
      <span className={`cursor-pointer group inline-flex items-center gap-0.5 ${cls}`}
        onClick={() => setEditCell({ id, field, value: val ?? "" })}>
        <span className="border-b border-dotted border-transparent group-hover:border-primary/50 group-hover:text-primary transition-colors">{val ?? "—"}</span>
        <span className="opacity-0 group-hover:opacity-30 text-[8px] text-primary">✎</span>
      </span>
    );
  };

  const gstStatusCell = (id: string, val: string) => {
    if (editCell?.id === id && editCell?.field === "filing_status") return (
      <select autoFocus
        className="bg-background border border-primary text-[9px] font-bold tracking-widest outline-none cursor-pointer"
        value={editCell.value}
        onChange={async e => {
          const snap = { id, value: e.target.value };
          setEditCell(null);
          await supabase.from("gst_return_data").update({ filing_status: snap.value }).eq("id", snap.id);
          await onReload();
        }}
        onBlur={() => setEditCell(null)}
      >
        <option value="filed">FILED</option>
        <option value="late">LATE</option>
        <option value="not_filed">NOT FILED</option>
      </select>
    );
    return (
      <span className={`cursor-pointer group inline-flex items-center gap-0.5 text-[9px] font-bold tracking-widest ${statusCls(val)}`}
        onClick={() => setEditCell({ id, field: "filing_status", value: val })}>
        <span className="border-b border-dotted border-transparent group-hover:border-current">{val.toUpperCase().replace("_", " ")}</span>
        <span className="opacity-0 group-hover:opacity-30 text-[8px]">✎</span>
      </span>
    );
  };

  const totalTurnover = data.reduce((s, r) => s + (r.total_turnover ?? 0), 0);
  const totalTax      = data.reduce((s, r) => s + (r.net_tax_paid ?? 0), 0);
  const totalItc      = data.reduce((s, r) => s + (r.itc_claimed ?? 0), 0);
  const lateCount     = data.filter(r => r.filing_status === "late").length;
  const notFiledCount = data.filter(r => r.filing_status === "not_filed").length;
  const gstin         = data[0]?.gstin;

  // Declared P&L turnover for comparison
  const plTurnover = (() => {
    const years = Array.from(new Set(extracted.filter(r => r.statement_type === "profit_loss").map(r => r.fiscal_year))).sort();
    const latestFy = years[years.length - 1];
    if (!latestFy) return null;
    const row = extracted.find(r => r.statement_type === "profit_loss" && r.fiscal_year === latestFy);
    const it = (row?.line_items as { label: string; value: number | null }[] | undefined)?.find(i => i.label === "Turnover");
    return it?.value ?? null;
  })();

  const handleUpload = async (file: File) => {
    setBusy(true); setProgress(5); setLabel("Reading file…");
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const isExcel = ["xlsx","xls","csv"].includes(ext);
      let excelText: string | undefined;
      let pdfText: string | undefined;
      if (isExcel) {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        excelText = wb.SheetNames.map(n => `=== SHEET: ${n} ===\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: "\t" })}`).join("\n\n");
      } else if (ext === "pdf") {
        setLabel("Reading PDF text…");
        pdfText = await extractPdfText(file);
      }
      setProgress(20); setLabel("Uploading…");
      const path = `${user.id}/${cc.id}/gst-${Date.now()}-${file.name}`;
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/case-files/${path.split("/").map(encodeURIComponent).join("/")}`;
      await new Promise<void>((res, rej) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        xhr.setRequestHeader("Authorization", `Bearer ${session?.access_token}`);
        xhr.setRequestHeader("apikey", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
        xhr.setRequestHeader("x-upsert", "false");
        if (file.type) xhr.setRequestHeader("Content-Type", file.type);
        xhr.upload.onprogress = e => { if (e.lengthComputable) setProgress(20 + Math.round((e.loaded/e.total)*40)); };
        xhr.onload = () => xhr.status < 300 ? res() : rej(new Error(`Upload ${xhr.status}`));
        xhr.onerror = () => rej(new Error("Network error"));
        xhr.send(file);
      });
      setProgress(65); setLabel("Registering document…");
      const fileType = isExcel ? "excel" : ["jpg","jpeg","png","webp"].includes(ext) ? "image" : "pdf";
      const { data: doc, error: dErr } = await supabase.from("financial_documents").insert({
        case_id: cc.id, user_id: user.id, file_path: path, file_name: file.name,
        file_type: fileType as never, doc_class: "gst_return" as never, extraction_status: "pending",
      }).select().single();
      if (dErr || !doc) throw new Error(dErr?.message ?? "Register failed");

      setProgress(70); setLabel("Extracting with AI…");
      const tick = setInterval(() => setProgress(p => p < 94 ? p + 1 : p), 700);
      const { data: { session: s2 } } = await supabase.auth.getSession();
      const authH = { "Content-Type": "application/json", "Authorization": `Bearer ${s2?.access_token}`, "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY };
      const base = import.meta.env.VITE_SUPABASE_URL;

      // Run basic GST + Accumn extraction in parallel (Accumn only for PDFs)
      const [gstRes, accumnRes] = await Promise.all([
        fetch(`${base}/functions/v1/extract-gst`, {
          method: "POST", headers: authH,
          body: JSON.stringify({ case_id: cc.id, document_id: doc.id, excel_text: excelText }),
        }),
        fileType === "pdf"
          ? fetch(`${base}/functions/v1/extract-gst-accumn`, {
              method: "POST", headers: authH,
              body: JSON.stringify({ case_id: cc.id, document_id: doc.id, pdf_text: pdfText }),
            }).catch(() => null)
          : Promise.resolve(null),
      ]);
      clearInterval(tick);

      const gstResult  = await gstRes.json().catch(() => ({})) as Record<string,unknown>;
      const accumnResult = accumnRes ? await accumnRes.json().catch(() => ({})) as Record<string,unknown> : null;
      const isAccumn = Boolean(accumnResult?.is_accumn);

      setProgress(100); setLabel("Done");

      if (!gstRes.ok && !isAccumn) {
        throw new Error((gstResult.error as string) ?? `HTTP ${gstRes.status}`);
      }
      if (gstRes.ok && (gstResult.periods_extracted as number) > 0) {
        toast.success(`GST data extracted — ${gstResult.periods_extracted} periods${gstResult.gstin ? ` · GSTIN: ${gstResult.gstin}` : ""}`);
      }
      if (isAccumn) {
        toast.success("Accumn GST analytical report extracted");
      }
      await onReload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setTimeout(() => { setBusy(false); setProgress(0); setLabel(""); }, 600);
    }
  };

  const deleteGstDoc = async (doc: DocRow) => {
    await supabase.from("financial_documents").delete().eq("id", doc.id);
    await onReload();
  };

  const retryGstDoc = async (doc: DocRow) => {
    await supabase.from("financial_documents").update({ extraction_status: "pending", extraction_error: null }).eq("id", doc.id);
    const { data: { session } } = await supabase.auth.getSession();
    const authH = { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token}`, "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY };
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-gst`, {
      method: "POST", headers: authH,
      body: JSON.stringify({ case_id: cc.id, document_id: doc.id }),
    });
    toast.success("Re-running GST extraction");
    await onReload();
  };

  const deleteAll = async () => {
    if (!window.confirm("Delete all GST return data for this case?")) return;
    await supabase.from("gst_return_data").delete().eq("case_id", cc.id);
    await onReload();
    toast.success("GST data deleted");
  };

  const clearAccumn = async () => {
    if (!window.confirm("Delete the Accumn analytical report for this case?")) return;
    const dbRaw = supabase as unknown as { from: (t: string) => { delete: () => { eq: (c: string, v: string) => Promise<unknown> } } };
    await dbRaw.from("gst_accumn_reports").delete().eq("case_id", cc.id);
    await onReload();
    toast.success("Accumn report cleared");
  };

  const handleAccumnImport = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext !== "pdf") { toast.error("Accumn import only accepts PDF files"); return; }
    setAccumnBusy(true); setAccumnProgress(5); setAccumnLabel("Reading PDF text…");
    try {
      const pdfText = await extractPdfText(file);
      setAccumnProgress(20); setAccumnLabel("Uploading…");

      const path = `${user.id}/${cc.id}/accumn-${Date.now()}-${file.name}`;
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/case-files/${path.split("/").map(encodeURIComponent).join("/")}`;
      await new Promise<void>((res, rej) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        xhr.setRequestHeader("Authorization", `Bearer ${session?.access_token}`);
        xhr.setRequestHeader("apikey", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
        xhr.setRequestHeader("x-upsert", "true");
        xhr.setRequestHeader("Content-Type", "application/pdf");
        xhr.upload.onprogress = e => { if (e.lengthComputable) setAccumnProgress(20 + Math.round((e.loaded / e.total) * 30)); };
        xhr.onload = () => xhr.status < 300 ? res() : rej(new Error(`Upload ${xhr.status}`));
        xhr.onerror = () => rej(new Error("Network error"));
        xhr.send(file);
      });

      setAccumnProgress(55); setAccumnLabel("Registering…");
      const { data: doc, error: dErr } = await supabase.from("financial_documents").insert({
        case_id: cc.id, user_id: user.id, file_path: path, file_name: file.name,
        file_type: "pdf" as never, doc_class: "gst_return" as never, extraction_status: "pending",
      }).select().single();
      if (dErr || !doc) throw new Error(dErr?.message ?? "Register failed");

      setAccumnProgress(60); setAccumnLabel("Extracting with AI…");
      const tick = setInterval(() => setAccumnProgress(p => p < 94 ? p + 1 : p), 800);
      const { data: { session: s2 } } = await supabase.auth.getSession();
      const authH = { "Content-Type": "application/json", "Authorization": `Bearer ${s2?.access_token}`, "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY };
      const base = import.meta.env.VITE_SUPABASE_URL;

      const res = await fetch(`${base}/functions/v1/extract-gst-accumn`, {
        method: "POST", headers: authH,
        body: JSON.stringify({ case_id: cc.id, document_id: doc.id, pdf_text: pdfText }),
      });
      clearInterval(tick);

      const result = await res.json().catch(() => ({})) as Record<string, unknown>;
      setAccumnProgress(100); setAccumnLabel("Done");

      if (!res.ok) throw new Error((result.error as string) ?? `HTTP ${res.status}`);
      if (!result.is_accumn) {
        toast.warning("This PDF was not recognised as an Accumn GST analytical report");
      } else {
        toast.success("Accumn GST report extracted successfully");
      }
      await onReload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setTimeout(() => { setAccumnBusy(false); setAccumnProgress(0); setAccumnLabel(""); }, 600);
    }
  };

  const handleAccumnExcelImport = async (file: File) => {
    setXlsBusy(true); setXlsProgress(5); setXlsLabel("Reading Excel…");
    try {
      setXlsProgress(15); setXlsLabel("Parsing Accumn report…");
      const result = await parseAccumnGstExcel(file);

      setXlsProgress(35); setXlsLabel(`Parsed ${result.periods.length} periods · saving return data…`);

      // Save periodic return rows
      const rows = result.periods.map(p => ({
        case_id: cc.id,
        user_id: user.id,
        period: p.period,
        return_type: p.return_type,
        gstin: p.gstin,
        taxable_turnover: p.taxable_turnover,
        exempt_turnover: p.exempt_turnover,
        total_turnover: p.total_turnover,
        output_tax: p.output_tax,
        itc_claimed: p.itc_claimed,
        net_tax_paid: p.net_tax_paid,
        filing_date: p.filing_date,
        filing_status: p.filing_status,
      }));

      const BATCH = 50;
      let inserted = 0;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const { error } = await supabase.from("gst_return_data").upsert(batch as never, { onConflict: "case_id,period,return_type" });
        if (error) throw new Error(error.message);
        inserted += batch.length;
        setXlsProgress(35 + Math.round((inserted / rows.length) * 50));
        setXlsLabel(`Saving return data… ${inserted}/${rows.length}`);
      }

      // Save full AccumnReport to gst_accumn_reports
      setXlsProgress(88); setXlsLabel("Saving full Accumn report…");
      const dbRaw = supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> };
      const { error: rptErr } = await (dbRaw.from("gst_accumn_reports") as unknown as {
        upsert: (d: unknown, o: unknown) => Promise<{ error: { message: string } | null }>;
      }).upsert(
        { case_id: cc.id, user_id: user.id, report_data: result.report },
        { onConflict: "case_id" },
      );
      if (rptErr) throw new Error(rptErr.message);

      setXlsProgress(100); setXlsLabel("Done");
      toast.success(
        `Accumn Excel imported — ${result.periods.length} periods` +
        (result.report.flags && result.report.flags.length > 0 ? ` · ${result.report.flags.length} flag(s)` : "") +
        (result.company_name ? ` · ${result.company_name}` : "")
      );
      await onReload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Excel import failed");
    } finally {
      setTimeout(() => { setXlsBusy(false); setXlsProgress(0); setXlsLabel(""); }, 800);
    }
  };

  const statusCls = (s: string) => s === "filed" ? "text-success" : s === "late" ? "text-warning" : "text-destructive";

  const gstDocs = docs.filter(d => d.doc_class === "gst_return");

  return (
    <div className="space-y-3">
      {/* Upload */}
      <Panel title="GST Returns" ticker="GSTR-1 / GSTR-3B / GSTR-9" status={data.length > 0 ? "live" : "idle"}
        actions={data.length > 0 ? <button onClick={deleteAll} className="text-sm border border-red-200 rounded text-red-500 px-2 py-1 hover:bg-red-50 transition-colors">Delete All</button> : undefined}
      >
        <UploadGrid
          onUpload={(f) => handleUpload(f)}
          onDelete={deleteGstDoc}
          onRetry={retryGstDoc}
          busy={busy}
          docs={gstDocs}
          progress={progress}
          progressLabel={label}
          lockedClass="gst_return"
          hint={["GSTR-1 / GSTR-3B / GSTR-9 · Multiple files OK", "PDF, Excel, or image formats supported"]}
        />
        {gstin && <div className="text-xs text-accent mt-2">GSTIN: {gstin}</div>}

        {/* Accumn Excel direct import — no AI, instant */}
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/30">
          <input ref={xlsFileRef} type="file" className="hidden" accept=".xlsx,.xls"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleAccumnExcelImport(f); e.target.value = ""; }} />
          <button
            onClick={() => xlsFileRef.current?.click()}
            disabled={xlsBusy || busy}
            className="text-sm border border-accent/40 rounded text-accent hover:bg-accent/10 px-3 py-1.5 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
          >{xlsBusy ? "Importing…" : "⬆ Import Accumn Excel"}</button>
          <span className="text-xs text-muted-foreground">Accumn GST Analytical Report · .xlsx · direct import, no AI needed</span>
        </div>
        {xlsBusy && (
          <div className="space-y-1 mt-2">
            <div className="flex justify-between text-xs text-muted-foreground"><span>{xlsLabel}</span><span>{xlsProgress}%</span></div>
            <div className="h-1.5 bg-border rounded"><div className="h-full bg-accent rounded transition-all" style={{ width: `${xlsProgress}%` }} /></div>
          </div>
        )}
      </Panel>

      {/* ── Accumn PDF Import ─────────────────────────────────────────────── */}
      <Panel
        title="Accumn Analytical Report"
        ticker="GST Advisory PDF · AI Extraction"
        status={accumnData?.is_accumn ? "live" : "idle"}
        actions={accumnData?.is_accumn ? (
          <button onClick={clearAccumn} className="text-sm border border-red-200 rounded text-red-500 px-2 py-0.5 hover:bg-red-50 transition-colors">Clear</button>
        ) : undefined}
      >
        <div className="flex items-center gap-2">
          <input ref={accumnFileRef} type="file" className="hidden" accept=".pdf"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleAccumnImport(f); e.target.value = ""; }} />
          <button
            onClick={() => accumnFileRef.current?.click()}
            disabled={accumnBusy}
            className="text-sm border border-primary/40 rounded text-primary hover:bg-primary/10 px-3 py-1.5 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
          >{accumnBusy ? "Importing…" : "⬆ Import Accumn PDF"}</button>
          <span className="text-xs text-muted-foreground">Accumn GST Advisory Report · PDF only</span>
          {accumnData?.is_accumn && !accumnBusy && (
            <span className="flex items-center gap-1.5 ml-2">
              <span className="text-green-500 text-xs">●</span>
              <span className="text-foreground font-medium text-sm">{accumnData.company_profile?.name ?? "Accumn Report"} loaded</span>
              {accumnData.company_profile?.gstin && (
                <span className="text-muted-foreground font-mono text-[10px]">{accumnData.company_profile.gstin}</span>
              )}
            </span>
          )}
        </div>

        {accumnBusy && (
          <div className="space-y-1 mt-2">
            <div className="flex justify-between text-[10px] text-muted-foreground"><span>{accumnLabel}</span><span>{accumnProgress}%</span></div>
            <div className="h-1.5 bg-border"><div className="h-full bg-accent transition-all" style={{ width: `${accumnProgress}%` }} /></div>
          </div>
        )}
      </Panel>

      {data.length > 0 && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Panel title="Total GST Turnover" ticker={`${data.length} periods`}>
              <div className="text-xl font-bold text-primary">₹{fmt(totalTurnover)}</div>
              <div className="text-xs text-muted-foreground mt-1">all periods combined</div>
            </Panel>
            <Panel title="Net Tax Paid">
              <div className="text-xl font-bold text-warning">₹{fmt(totalTax)}</div>
              <div className="text-xs text-muted-foreground mt-1">after ITC utilisation</div>
            </Panel>
            <Panel title="ITC Claimed">
              <div className="text-xl font-bold text-accent">₹{fmt(totalItc)}</div>
              <div className="text-xs text-muted-foreground mt-1">input tax credit</div>
            </Panel>
            <Panel title="Filing Compliance" status={notFiledCount > 0 ? "idle" : lateCount > 0 ? "warn" : "live"}>
              <div className={`text-xl font-bold ${notFiledCount > 0 ? "text-destructive" : lateCount > 0 ? "text-warning" : "text-success"}`}>
                {notFiledCount > 0 ? `${notFiledCount} NOT FILED` : lateCount > 0 ? `${lateCount} LATE` : "COMPLIANT"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">{data.length} returns checked</div>
            </Panel>
          </div>

          {/* P&L vs GST comparison */}
          {plTurnover && totalTurnover > 0 && (
            <Panel title="GST Turnover vs P&L Declared Turnover" ticker="Consistency Check" status={Math.abs(totalTurnover - plTurnover) / plTurnover > 0.15 ? "warn" : "live"}>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">GST Turnover</div>
                  <div className="text-foreground font-bold text-lg mt-1">₹{fmt(totalTurnover)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">P&L Declared (latest FY)</div>
                  <div className="text-foreground font-bold text-lg mt-1">₹{fmt(plTurnover)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Variance</div>
                  {(() => {
                    const diff = totalTurnover - plTurnover;
                    const pct = (diff / plTurnover * 100).toFixed(1);
                    const cls = Math.abs(diff/plTurnover) > 0.15 ? "text-destructive" : "text-success";
                    return <div className={`font-bold text-lg mt-1 ${cls}`}>{diff >= 0 ? "+" : ""}{fmt(diff)} ({pct}%)</div>;
                  })()}
                </div>
              </div>
              {Math.abs(totalTurnover - plTurnover) / plTurnover > 0.15 && (
                <div className="mt-2 text-[10px] text-warning tracking-wider">
                  ▲ Variance exceeds 15% — reconcile GST returns with audited financials before credit decision
                </div>
              )}
            </Panel>
          )}

          {/* Period table */}
          <Panel title="GST Period-wise Details" ticker="All Returns"
            actions={
              <button onClick={addGstRow}
                className="text-[10px] tracking-widest border border-primary/40 text-primary/70 hover:bg-primary/10 px-2 py-0.5">
                + ADD ROW
              </button>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-1 pr-2">PERIOD</th>
                    <th className="text-left pr-2">TYPE</th>
                    <th className="text-left pr-2">GSTIN</th>
                    <th className="text-right pr-2">TAXABLE</th>
                    <th className="text-right pr-2">EXEMPT</th>
                    <th className="text-right pr-2">TOTAL TURNOVER</th>
                    <th className="text-right pr-2">OUTPUT TAX</th>
                    <th className="text-right pr-2">ITC</th>
                    <th className="text-right pr-2">NET TAX</th>
                    <th className="text-center pr-2">STATUS</th>
                    <th className="text-left pr-2">FILED ON</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.map(row => (
                    <tr key={row.id} className="border-b border-border/30 group/row">
                      <td className="py-1 pr-2 font-medium">{gstTxtCell(row.id, "period", row.period)}</td>
                      <td className="pr-2 text-accent text-[10px]">{gstTxtCell(row.id, "return_type", row.return_type)}</td>
                      <td className="pr-2 font-mono text-[10px] text-muted-foreground">{gstTxtCell(row.id, "gstin", row.gstin)}</td>
                      <td className="text-right pr-2 tabular-nums">{gstNumCell(row.id, "taxable_turnover", row.taxable_turnover)}</td>
                      <td className="text-right pr-2 tabular-nums text-muted-foreground">{gstNumCell(row.id, "exempt_turnover", row.exempt_turnover)}</td>
                      <td className="text-right pr-2 tabular-nums font-medium">{gstNumCell(row.id, "total_turnover", row.total_turnover)}</td>
                      <td className="text-right pr-2 tabular-nums text-warning">{gstNumCell(row.id, "output_tax", row.output_tax)}</td>
                      <td className="text-right pr-2 tabular-nums text-accent">{gstNumCell(row.id, "itc_claimed", row.itc_claimed)}</td>
                      <td className="text-right pr-2 tabular-nums font-bold">{gstNumCell(row.id, "net_tax_paid", row.net_tax_paid)}</td>
                      <td className="text-center pr-2">{gstStatusCell(row.id, row.filing_status)}</td>
                      <td className="text-muted-foreground text-[10px] pr-2">{gstTxtCell(row.id, "filing_date", row.filing_date ?? null)}</td>
                      <td className="w-4">
                        <button
                          onClick={() => deleteGstRow(row.id)}
                          className="opacity-0 group-hover/row:opacity-60 hover:!opacity-100 text-destructive text-[10px] transition-opacity"
                          title="Delete row"
                        >✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Turnover chart */}
          {data.length >= 2 && (
            <Panel title="GST Turnover Trend" ticker="Period-wise">
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.map(r => ({ period: r.period.length > 7 ? r.period : r.period.slice(5), taxable: r.taxable_turnover, tax: r.net_tax_paid }))} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="period" tick={{ fill: "#6b7280", fontSize: 9 }} />
                    <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} width={54} tickFormatter={v => Math.abs(v) >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} />
                    <RTooltip contentStyle={{ background: "#0f172a", border: "1px solid #1f2937", fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 10, color: "#9ca3af" }} />
                    <Bar dataKey="taxable" name="Taxable Turnover" fill="#22c55e" opacity={0.85} radius={[2,2,0,0]} />
                    <Line type="monotone" dataKey="tax" name="Net Tax Paid" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          )}
        </>
      )}

      {/* Accumn Analytical Report Dashboard */}
      {accumnData?.is_accumn && (
        <AccumnDashboard data={accumnData} onClear={clearAccumn} />
      )}
    </div>
  );
}

// ─── Download helpers ────────────────────────────────────────────────────────

async function dlExcel(
  sheets: { name: string; rows: (string | number | null | undefined)[][] }[],
  filename: string,
) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

function dlPdfIc(html: string, title: string) {
  const win = window.open("", "_blank", "width=1100,height=900");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>${title}</title><style>${buildIcNotePrintCss()}</style></head><body>${html}</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 800);
}

function dlPdf(html: string, title: string) {
  const win = window.open("", "_blank", "width=1100,height=900");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>${title}</title><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#111;background:#fff;padding:28px 36px}

    /* ── Cover letterhead ───────────────────── */
    .letterhead{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #1a1a2e;padding-bottom:10px;margin-bottom:6px}
    .lh-brand{line-height:1.2}
    .lh-org{font-size:18px;font-weight:900;letter-spacing:3px;text-transform:uppercase;color:#1a1a2e}
    .lh-sub{font-size:8px;letter-spacing:2px;text-transform:uppercase;color:#555;margin-top:2px}
    .lh-right{text-align:right;font-size:8px;color:#555;letter-spacing:0.5px}
    .doc-title{font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#1a1a2e;margin-bottom:4px}
    .doc-title-bar{background:#1a1a2e;color:#fff;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;padding:5px 12px;margin-bottom:14px;font-weight:700}

    /* ── Client banner ──────────────────────── */
    .client-banner{background:#f0f4ff;border-left:4px solid #1a1a2e;padding:8px 14px;margin-bottom:12px}
    .cb-name{font-size:15px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#1a1a2e}
    .cb-case{font-size:8px;letter-spacing:1px;text-transform:uppercase;color:#666;margin-top:2px}

    /* ── Deal meta strip ────────────────────── */
    .meta{display:flex;gap:0;margin-bottom:16px;border:1px solid #ddd;border-radius:2px;overflow:hidden}
    .mi{flex:1;padding:6px 10px;border-right:1px solid #ddd}
    .mi:last-child{border-right:none}
    .mi .lbl{font-size:7px;text-transform:uppercase;color:#888;letter-spacing:0.8px;margin-bottom:2px}
    .mi .val{font-weight:700;font-size:11px;color:#1a1a2e}

    /* ── Section headings ───────────────────── */
    h2{font-size:10px;font-weight:700;margin:20px 0 6px;padding:5px 10px;background:#1a1a2e;color:#fff;letter-spacing:1.2px;text-transform:uppercase;border-radius:1px}
    h3{font-size:9.5px;font-weight:700;margin:10px 0 4px;text-transform:uppercase;letter-spacing:0.8px;color:#1a1a2e;border-bottom:1px solid #cce;padding-bottom:2px}

    /* ── Tables ─────────────────────────────── */
    table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:8.5px}
    th{text-align:left;background:#f5f5f5;border-bottom:2px solid #1a1a2e;border-top:1px solid #ddd;padding:4px 8px;font-weight:700;text-transform:uppercase;font-size:7.5px;letter-spacing:0.5px;color:#1a1a2e}
    td{border-bottom:1px solid #eee;padding:4px 8px;vertical-align:top}
    tr:last-child td{border-bottom:none}
    .lbl{font-size:7.5px;text-transform:uppercase;color:#888;letter-spacing:0.5px;font-weight:600;background:#fafafa}

    /* ── Status badges ──────────────────────── */
    .pass{color:#16a34a;font-weight:700}
    .fail{color:#dc2626;font-weight:700}
    .caution{color:#d97706;font-weight:700}

    /* ── Bullets ────────────────────────────── */
    ul{list-style:none;padding:0;margin:4px 0 6px}
    li{margin-bottom:3px;padding-left:16px;position:relative;font-size:9px;line-height:1.5}
    li::before{content:"▸";position:absolute;left:0;color:#1a1a2e;font-size:8px}

    /* ── SWOT grid ──────────────────────────── */
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;margin-bottom:8px}
    .swot-box{border:1px solid #ddd;padding:8px 10px;border-radius:2px}
    .swot-box h3{border:none;padding:0 0 4px 0}

    /* ── Footer ─────────────────────────────── */
    .disc{font-size:7.5px;color:#aaa;border-top:1px solid #ddd;margin-top:24px;padding-top:8px;font-style:italic;display:flex;justify-content:space-between}
    .sec{margin-bottom:14px;page-break-inside:avoid}
    .draft-banner{background:#fff8e1;border:1px solid #f59e0b;color:#92400e;font-size:8px;font-weight:700;letter-spacing:1px;text-align:center;padding:5px;margin-bottom:14px;text-transform:uppercase}

    @media print{body{padding:12px 16px} h2{-webkit-print-color-adjust:exact;print-color-adjust:exact} .meta{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body>${html}
  <div class="disc">
    <span>AI-GENERATED DRAFT — REQUIRES ANALYST REVIEW AND APPROVAL BEFORE SUBMISSION TO IC</span>
    <span>© REHBAR FIN SERVICES · CONFIDENTIAL</span>
  </div>
  </body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 400);
}

function DownloadBar({ onExcel, onPdf }: { onExcel?: () => void; onPdf?: () => void }) {
  return (
    <div className="flex items-center gap-2 pt-3 mt-1 border-t border-border/40">
      <span className="text-[10px] text-muted-foreground tracking-widest">↓ DOWNLOAD</span>
      {onExcel && (
        <button onClick={onExcel} className="text-[10px] border border-border text-primary px-3 py-1 hover:bg-primary/10 tracking-widest font-bold">
          [EXCEL]
        </button>
      )}
      {onPdf && (
        <button onClick={onPdf} className="text-[10px] border border-border text-primary px-3 py-1 hover:bg-primary/10 tracking-widest font-bold">
          [PDF]
        </button>
      )}
    </div>
  );
}

// ─── ICFinalRecommendation ───────────────────────────────────────────────────
function ICFinalRecommendation({ cc, ratios, extracted, ic }: {
  cc: CaseRow;
  ratios: RatioRow[];
  extracted: ExtractedRow[];
  ic: { sections: Record<string, { markdown: string }>; risks: Array<{ category: string; risk: string; mitigant: string; severity: string }>; conditions_precedent: string[]; swot?: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] } };
}) {
  const histYears = Array.from(new Set(extracted.filter(r => r.statement_type !== "projections").map(r => r.fiscal_year))).sort();
  const lastFy = histYears[histYears.length - 1];
  const unit = extracted.find(r => r.unit)?.unit ?? "";
  const abbr = unitAbbr(unit);

  const getVal = (fy: number, label: string): number | null => {
    for (const row of extracted.filter(r => r.fiscal_year === fy && r.statement_type !== "projections")) {
      const it = (row.line_items as unknown as LineItem[]).find(i => i.label === label);
      if (it) { const v = it.override_value ?? it.value; return v !== null && Number.isFinite(Number(v)) ? Number(v) : null; }
    }
    return null;
  };

  const fmt = (v: number | null) => v === null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const pct = (v: number | null) => v === null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1) + "%";

  // Ratio scorecard
  const latestRatioMap = new Map<string, RatioRow>();
  for (const r of ratios) {
    const existing = latestRatioMap.get(r.ratio_name);
    if (!existing || r.fiscal_year > existing.fiscal_year) latestRatioMap.set(r.ratio_name, r);
  }
  const latestRatios = Array.from(latestRatioMap.values());
  const greenCount = latestRatios.filter(r => r.threshold_status === "green").length;
  const amberCount = latestRatios.filter(r => r.threshold_status === "amber").length;
  const redCount   = latestRatios.filter(r => r.threshold_status === "red").length;
  const total = greenCount + amberCount + redCount;

  const verdict = total === 0
    ? "AWAITING RATIO ANALYSIS"
    : redCount >= 3 ? "NOT RECOMMENDED"
    : redCount >= 1 || amberCount >= 3 ? "CONDITIONAL APPROVAL"
    : "RECOMMEND APPROVAL";

  const verdictColor = verdict === "NOT RECOMMENDED" ? "text-destructive border-destructive/40 bg-destructive/5"
    : verdict === "CONDITIONAL APPROVAL" ? "text-warning border-warning/40 bg-warning/5"
    : verdict === "RECOMMEND APPROVAL" ? "text-success border-success/40 bg-success/5"
    : "text-muted-foreground border-border bg-muted/10";

  // Key financial snapshot (latest year)
  const turnover = lastFy ? getVal(lastFy, "Turnover") : null;
  const ebitda   = lastFy ? getVal(lastFy, "EBITDA") : null;
  const pat      = lastFy ? getVal(lastFy, "PAT") : null;
  const nw       = lastFy ? getVal(lastFy, "Net Worth") : null;
  const td       = lastFy ? getVal(lastFy, "Total Debt") : null;
  const ebitdaMgn = turnover && ebitda ? (ebitda / turnover) * 100 : null;
  const patMgn    = turnover && pat    ? (pat    / turnover) * 100 : null;
  const de        = nw && nw !== 0 && td ? td / nw : null;
  const intExp    = lastFy ? getVal(lastFy, "Interest Expense") : null;
  const icr       = ebitda && intExp && intExp > 0 ? ebitda / intExp : null;

  // Revenue CAGR
  const firstFy = histYears[0];
  const rev0 = firstFy ? getVal(firstFy, "Turnover") : null;
  const revN = lastFy  ? getVal(lastFy,  "Turnover") : null;
  const nYrs = histYears.length - 1;
  const revCAGR = rev0 && revN && nYrs > 0 && rev0 > 0 ? (Math.pow(revN / rev0, 1 / nYrs) - 1) * 100 : null;

  // Strengths & concerns from ratios
  const strengths = latestRatios.filter(r => r.threshold_status === "green").map(r => RATIO_DISPLAY_NAMES[r.ratio_name] ?? r.ratio_name);
  const concerns  = latestRatios.filter(r => r.threshold_status === "red").map(r => RATIO_DISPLAY_NAMES[r.ratio_name] ?? r.ratio_name);
  const cautions  = latestRatios.filter(r => r.threshold_status === "amber").map(r => RATIO_DISPLAY_NAMES[r.ratio_name] ?? r.ratio_name);

  // AI exec recommendation from visit_reference section
  const execAi = ic.sections["visit_reference"]?.markdown ?? "";

  const metricRow = (label: string, value: string | null, note?: string) =>
    value ? (
      <div key={label} className="flex items-baseline justify-between gap-2 py-0.5 border-b border-border/20">
        <span className="text-foreground/60 text-[10px]">{label}</span>
        <div className="text-right">
          <span className="text-primary tabular-nums text-xs font-medium">{value}</span>
          {note && <span className="text-muted-foreground text-[9px] ml-1.5">{note}</span>}
        </div>
      </div>
    ) : null;

  return (
    <Panel title="Final Credit Recommendation" ticker="IC Decision" status={redCount >= 3 ? "idle" : amberCount >= 3 || redCount >= 1 ? "warn" : "live"}>
      <div className="space-y-4">
        {/* Disclaimer */}
        <div className="text-[9px] text-warning/80 tracking-wider border border-warning/30 bg-warning/5 px-2 py-1.5">
          ⚠ AI-ASSISTED ANALYSIS · FINAL DECISION RESTS WITH INVESTMENT COMMITTEE · NOT A SUBSTITUTE FOR ANALYST JUDGEMENT
        </div>

        {/* Verdict */}
        <div className={`border px-4 py-3 text-center ${verdictColor}`}>
          <div className="text-xl font-bold tracking-widest">{verdict}</div>
          <div className="text-[10px] mt-1 opacity-70">{cc.client_name} · {cc.product_type.replace(/_/g, " ").toUpperCase()} · ₹{cc.deal_amount ?? "—"} Cr · {cc.tenure_months ?? "—"}M · {cc.expected_irr ?? "—"}% IRR</div>
        </div>

        {/* Ratio scorecard */}
        {total > 0 && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="border border-success/30 bg-success/5 py-2">
              <div className="text-xl font-bold text-success">{greenCount}</div>
              <div className="text-[8px] text-success/70 tracking-widest">RATIOS PASS</div>
            </div>
            <div className="border border-warning/30 bg-warning/5 py-2">
              <div className="text-xl font-bold text-warning">{amberCount}</div>
              <div className="text-[8px] text-warning/70 tracking-widest">RATIOS CAUTION</div>
            </div>
            <div className="border border-destructive/30 bg-destructive/5 py-2">
              <div className="text-xl font-bold text-destructive">{redCount}</div>
              <div className="text-[8px] text-destructive/70 tracking-widest">RATIOS FAIL</div>
            </div>
          </div>
        )}

        {/* Financial snapshot */}
        {lastFy && (
          <div>
            <div className="text-[9px] text-muted-foreground tracking-widest mb-1.5">KEY FINANCIAL SNAPSHOT · FY{lastFy}{unit ? ` · ₹ ${unit}` : ""}</div>
            <div className="space-y-0">
              {metricRow("Revenue (Turnover)", turnover ? fmt(turnover) + (abbr ? ` ${abbr}` : "") : null)}
              {metricRow("EBITDA Margin", ebitdaMgn ? pct(ebitdaMgn) : null, ebitda ? `(${fmt(ebitda)}${abbr ? ` ${abbr}` : ""})` : undefined)}
              {metricRow("PAT Margin", patMgn ? pct(patMgn) : null, pat ? `(${fmt(pat)}${abbr ? ` ${abbr}` : ""})` : undefined)}
              {metricRow("Debt / Equity", de ? de.toFixed(2) + "x" : null, de !== null ? (de <= 1.5 ? "Conservative" : de <= 3 ? "Moderate" : "High leverage") : undefined)}
              {metricRow("Interest Coverage", icr ? icr.toFixed(2) + "x" : null, icr !== null ? (icr >= 3 ? "Comfortable" : icr >= 1.5 ? "Adequate" : "Tight") : undefined)}
              {metricRow("Revenue CAGR", revCAGR !== null ? pct(revCAGR) : null, histYears.length >= 2 ? `FY${firstFy}–FY${lastFy}` : undefined)}
            </div>
          </div>
        )}

        {/* Strengths & Concerns */}
        <div className="grid grid-cols-2 gap-3">
          {strengths.length > 0 && (
            <div>
              <div className="text-[9px] text-success tracking-widest mb-1.5">+ FINANCIAL STRENGTHS</div>
              <div className="space-y-1">
                {strengths.map((s, i) => (
                  <div key={i} className="flex gap-1.5 text-[10px]">
                    <span className="text-success shrink-0">✓</span>
                    <span className="text-foreground/80">{s}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(concerns.length > 0 || cautions.length > 0) && (
            <div>
              {concerns.length > 0 && (
                <>
                  <div className="text-[9px] text-destructive tracking-widest mb-1.5">✕ RED FLAGS</div>
                  <div className="space-y-1 mb-2">
                    {concerns.map((c, i) => (
                      <div key={i} className="flex gap-1.5 text-[10px]">
                        <span className="text-destructive shrink-0">✕</span>
                        <span className="text-foreground/80">{c}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {cautions.length > 0 && (
                <>
                  <div className="text-[9px] text-warning tracking-widest mb-1.5">▲ WATCH ITEMS</div>
                  <div className="space-y-1">
                    {cautions.map((c, i) => (
                      <div key={i} className="flex gap-1.5 text-[10px]">
                        <span className="text-warning shrink-0">▲</span>
                        <span className="text-foreground/80">{c}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Conditions Precedent */}
        {ic.conditions_precedent?.length > 0 && (
          <div>
            <div className="text-[9px] text-muted-foreground tracking-widest mb-1.5">CONDITIONS PRECEDENT</div>
            <div className="space-y-0.5">
              {ic.conditions_precedent.map((c, i) => (
                <div key={i} className="flex gap-1.5 text-[10px]">
                  <span className="text-accent shrink-0">▸</span>
                  <span className="text-foreground/80">{c}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI exec text from visit_reference */}
        {execAi && (
          <div>
            <div className="text-[9px] text-muted-foreground tracking-widest mb-1.5">ANALYST OBSERVATIONS</div>
            <BulletOnlyMd text={execAi} />
          </div>
        )}
      </div>
    </Panel>
  );
}

function buildIcNoteHtml(
  cc: CaseRow,
  extracted: ExtractedRow[],
  ratios: RatioRow[],
  ic: { sections: Record<string,{markdown:string}>; risks: Array<{category:string;risk:string;mitigant:string;severity:string}>; conditions_precedent: string[]; swot?: {strengths:string[];weaknesses:string[];opportunities:string[];threats:string[]} },
): string {
  const product = PRODUCTS[cc.product_type];
  const fyYears = Array.from(new Set(ratios.map(r => r.fiscal_year))).sort();
  const ratioGroups = Array.from(new Set(ratios.map(r => r.category)));
  const histExtracted = extracted.filter(r => r.statement_type !== "projections");
  const histYears = Array.from(new Set(histExtracted.map(r => r.fiscal_year))).sort();
  const projRows = extracted.filter(r => r.statement_type === "projections");
  const projYears = Array.from(new Set(projRows.map(r => r.fiscal_year))).sort();
  const unit = extracted.find(r => r.unit)?.unit ?? "";
  const ul = unit ? `₹ ${unit}` : "₹";

  const bul = (md: string) => {
    const items = md.split("\n").filter(l => /^[-*]\s/.test(l.trim())).map(l => l.trim().replace(/^[-*]\s+/,""));
    return items.length ? `<ul>${items.map(b=>`<li>${b}</li>`).join("")}</ul>` : "";
  };
  const tblRow = (label: string, ...vals: (string|number|null|undefined)[]) =>
    `<tr><td class="lbl">${label}</td>${vals.map(v=>`<td>${v??'—'}</td>`).join("")}</tr>`;
  const dataTable = (headers: string[], rows: (string|number|null|undefined)[][], caption?: string) =>
    `${caption?`<h3>${caption}</h3>`:""}<table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c??'—'}</td>`).join("")}</tr>`).join("")}</tbody></table>`;

  const KEY_RATIOS = ["dscr","current_ratio","debt_to_equity","interest_coverage","ebitda_margin","roe"];
  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });

  let h = `
<div class="letterhead">
  <div class="lh-brand">
    <div class="lh-org">Rehbar Fin Services</div>
    <div class="lh-sub">Ethical Finance · Sharia-Compliant NBFC</div>
  </div>
  <div class="lh-right">
    <div style="font-weight:700;font-size:9px;text-transform:uppercase;letter-spacing:1px">Investment Committee</div>
    <div>Credit Appraisal Note</div>
    <div style="margin-top:2px">Date: ${today}</div>
    <div>Case: ${cc.case_code}</div>
  </div>
</div>
<div class="doc-title-bar">Standard Operating Procedure: IC Credit Appraisal Note</div>

<div class="draft-banner">⚠ AI-Generated Draft — Requires Analyst Review and IC Approval Before Circulation</div>

<div class="client-banner">
  <div class="cb-name">${cc.client_name}</div>
  <div class="cb-case">${cc.legal_constitution ?? ""} · ${cc.industry ?? "—"} · Est. ${cc.year_established ?? "—"}</div>
</div>

<div class="meta">
  <div class="mi"><div class="lbl">Product</div><div class="val">${product.label}</div></div>
  <div class="mi"><div class="lbl">Amount</div><div class="val">₹${cc.deal_amount??'—'} Cr</div></div>
  <div class="mi"><div class="lbl">Tenure</div><div class="val">${cc.tenure_months??'—'} Months</div></div>
  <div class="mi"><div class="lbl">Expected IRR</div><div class="val">${cc.expected_irr??'—'}%</div></div>
  <div class="mi"><div class="lbl">Legal Nature</div><div class="val">${product.legalNature??'—'}</div></div>
  <div class="mi"><div class="lbl">Collection</div><div class="val">${product.returnMechanism??'—'}</div></div>
</div>`;

  // ── I. Executive Summary ──────────────────────────────────────────────────
  h += `<div class="sec"><h2>I. Executive Summary</h2>`;
  h += `<table><tbody>
    ${tblRow("Client", cc.client_name, "Product", product.label)}
    ${tblRow("Amount", `₹${cc.deal_amount??'—'} Cr`, "Tenure", `${cc.tenure_months??'—'}M`)}
    ${tblRow("IRR", `${cc.expected_irr??'—'}%`, "Industry", cc.industry)}
    ${cc.end_use?tblRow("End Use","<i>"+cc.end_use+"</i>"):""}
  </tbody></table>`;
  if (fyYears.length > 0 && KEY_RATIOS.some(n => ratios.find(r=>r.ratio_name===n))) {
    h += dataTable(["Ratio",...fyYears.map(y=>`FY${y}`),"Benchmark","Status"],
      KEY_RATIOS.flatMap(name => {
        const rows = ratios.filter(r=>r.ratio_name===name);
        if (!rows.length) return [];
        const latest = rows.sort((a,b)=>b.fiscal_year-a.fiscal_year)[0];
        const s = latest.threshold_status??"na";
        const cls = s==="green"?"✓":s==="red"?"✗":s==="amber"?"~":"—";
        return [[`${RATIO_DISPLAY_NAMES[name]??name} ${cls}`,...fyYears.map(y=>{const r=ratios.find(x=>x.ratio_name===name&&x.fiscal_year===y);return r?.ratio_value!=null?formatRatio(name,Number(r.ratio_value)):"—";}),latest.benchmark!=null?formatRatio(name,Number(latest.benchmark)):"—",s.toUpperCase()]];
      }), "Key Ratio Snapshot");
  }
  h += bul(ic.sections["executive_summary"]?.markdown??"");
  h += `</div>`;

  // ── II. Client & Promoter ─────────────────────────────────────────────────
  h += `<div class="sec"><h2>II. Client &amp; Promoter Profile</h2>`;
  h += `<table><tbody>
    ${tblRow("Legal Name", cc.client_name)}
    ${tblRow("Legal Constitution", cc.legal_constitution, "Year Established", cc.year_established)}
    ${tblRow("Industry / Sector", cc.industry, "Website", cc.website ?? "—")}
    ${tblRow("Principal Borrower Entity", cc.principal_borrower)}
    ${cc.mca_cin ? tblRow("CIN (MCA)", cc.mca_cin, "MCA Status", cc.mca_status ?? "—") : ""}
    ${cc.mca_authorized_capital ? tblRow("Authorised Capital", `₹${cc.mca_authorized_capital}`, "Paid-Up Capital", `₹${cc.mca_paid_up_capital ?? "—"}`) : ""}
  </tbody></table>`;
  if (cc.promoter_details) h += `<h3>Promoter / Director Profile</h3><p style="font-size:9px;line-height:1.6;margin-bottom:6px">${cc.promoter_details}</p>`;
  if ((cc as Record<string,unknown>).group_summary) h += `<h3>Group Company Summary</h3><p style="font-size:9px;line-height:1.6;margin-bottom:6px">${(cc as Record<string,unknown>).group_summary}</p>`;
  h += bul(ic.sections["client_promoter"]?.markdown??"");
  h += `</div>`;

  // ── III. Investment Structure ─────────────────────────────────────────────
  h += `<div class="sec"><h2>III. Proposed Investment Structure</h2>`;
  h += `<table><tbody>
    ${tblRow("Product", product.label, "Legal Nature", product.legalNature)}
    ${tblRow("Proposed Amount", `₹${cc.deal_amount??'—'} Crores`, "Tenure", `${cc.tenure_months??'—'} Months`)}
    ${tblRow("Expected IRR", `${cc.expected_irr??'—'}%`, "Return Mechanism", product.returnMechanism)}
    ${cc.residual_value!=null?tblRow("Residual Value (OL)",`₹${cc.residual_value}`):""}
    ${cc.security_deposit!=null?tblRow("Security Deposit (OL)",`₹${cc.security_deposit}`):""}
  </tbody></table>`;
  if (cc.end_use) h += `<h3>End Use of Funds</h3><p style="font-size:9px;line-height:1.6;margin-bottom:6px">${cc.end_use}</p>`;
  if (cc.collateral_summary) h += `<h3>Collateral &amp; Security</h3><p style="font-size:9px;line-height:1.6;margin-bottom:6px">${cc.collateral_summary}</p>`;
  if ((cc as Record<string,unknown>).strategic_rationale) h += `<h3>Strategic Rationale for Rehbar Funding</h3><p style="font-size:9px;line-height:1.6;margin-bottom:6px">${(cc as Record<string,unknown>).strategic_rationale}</p>`;
  h += `<h3>Rehbar Product Framework</h3>`;
  h += `<table><thead><tr><th>Feature</th><th>Operating Lease (Core)</th><th>Finance Lease / TF / PF</th><th>Profit &amp; Loss Sharing</th></tr></thead><tbody>
    <tr><td>Legal Nature</td><td>Asset rental; RERL retains ownership</td><td>Structured as Term Loan / Inter-Corporate Loan</td><td>Loan with variable return based on performance</td></tr>
    <tr><td>Taxation</td><td>Monthly rentals attract GST; RERL claims depreciation</td><td>Interest accounting; no GST on EMI principal/interest</td><td>Interest recorded per profit-share calculations</td></tr>
    <tr><td>Collection</td><td>Proforma (Day 1-2); NACH (10th/15th); e-Invoice post-payment</td><td>Fixed EMI or defined repayment schedule</td><td>Fixed EMI; NACH (10th/15th)</td></tr>
    <tr><td>Return Mechanism</td><td>Fixed Rental</td><td>Milestone Basis / Monthly EMI</td><td>X% of Gross / Adjusted Net Profit</td></tr>
  </tbody></table>`;
  h += bul(ic.sections["investment_structure"]?.markdown??"");
  h += `</div>`;

  // ── IV. Rehbar Funding History ────────────────────────────────────────────
  h += `<div class="sec"><h2>IV. Rehbar Funding History</h2>`;
  h += `<table><tbody>
    ${tblRow("Funder", "Rehbar Financial Services")}
    ${tblRow("Business Model", "Sharia-compliant NBFC — asset financing & structured credit")}
    ${tblRow("Core Products", "Operating Lease · Finance Lease · PLS · Project Finance · Trade Finance · Home Loan")}
    ${tblRow("Prior Exposure", `No prior Rehbar funding history on record for ${cc.client_name}. New relationship.`)}
  </tbody></table>`;
  h += bul(ic.sections["rehbar_funding_history"]?.markdown??"");
  h += `</div>`;

  // ── V. Historical Financials ──────────────────────────────────────────────
  h += `<div class="sec"><h2>V. Historical Financial Analysis</h2>`;
  if (histYears.length > 0) {
    const fyItems = histYears.map(y => icGetItems(extracted, y));
    const yoyPct = (vals: (number|null)[]) => {
      const l = vals[vals.length-1], p = vals.length>=2?vals[vals.length-2]:null;
      return (l!==null&&p!==null&&p!==0) ? ((l!-p!)/Math.abs(p!)*100).toFixed(1)+"%" : "—";
    };
    for (const [labels, caption] of [
      [["Turnover","Gross Profit","EBITDA","EBIT","Interest Expense","PAT"], `P&L Summary (${ul})`],
      [["Net Worth","Total Debt","Current Assets","Fixed Assets (Net)","Total Assets","Capital Employed"], `Balance Sheet (${ul})`],
    ] as [string[], string][]) {
      h += dataTable(
        ["Item",...histYears.map(y=>`FY${y}`),...(histYears.length>=2?["YoY%"]:[])],
        labels.map(label => {
          const vals = fyItems.map(items => icLiVal(items, label));
          return [label, ...vals.map(v=>icFmt(v)), ...(histYears.length>=2?[yoyPct(vals)]:[])];
        }),
        caption,
      );
    }
  }
  h += bul(ic.sections["historical_financial"]?.markdown??"");
  h += `</div>`;

  // ── VI. Projections ───────────────────────────────────────────────────────
  h += `<div class="sec"><h2>VI. Projections &amp; Estimates</h2>`;
  if (projRows.length > 0) {
    const actCols = histYears;
    const pairs: [string,string][] = [
      ["Turnover","Projected Turnover"],["EBITDA","Projected EBITDA"],["PAT","Projected PAT"],
      ["Net Worth","Projected Net Worth"],["Total Debt","Projected Total Debt"],
    ];
    h += dataTable(
      ["Metric",...actCols.map(y=>`FY${y}(A)`),...projYears.map(y=>`FY${y}(P)`)],
      pairs.map(([hl,pl]) => [
        hl,
        ...actCols.map(y=>icFmt(icLiVal(icGetItems(extracted,y),hl))),
        ...projYears.map(y=>icFmt(icLiVal((projRows.find(r=>r.fiscal_year===y)?.line_items??[]) as unknown as LineItem[],pl))),
      ]),
      `Historical vs Projected (${ul})`,
    );
  }
  h += bul(ic.sections["projections"]?.markdown??"");
  h += `</div>`;

  // ── VII. Key Financial Ratios ─────────────────────────────────────────────
  h += `<div class="sec"><h2>VII. Key Financial Ratios</h2>`;
  for (const cat of ratioGroups) {
    const names = Array.from(new Set(ratios.filter(r=>r.category===cat).map(r=>r.ratio_name)));
    h += dataTable(
      ["Ratio",...fyYears.map(y=>`FY${y}`),"Benchmark","Status"],
      names.map(name => {
        const latest = ratios.filter(r=>r.ratio_name===name).sort((a,b)=>b.fiscal_year-a.fiscal_year)[0];
        const s = latest?.threshold_status??"na";
        return [
          RATIO_DISPLAY_NAMES[name]??name,
          ...fyYears.map(y=>{const r=ratios.find(x=>x.ratio_name===name&&x.fiscal_year===y);return r?.ratio_value!=null?formatRatio(name,Number(r.ratio_value)):"—";}),
          latest?.benchmark!=null?formatRatio(name,Number(latest.benchmark)):"—",
          s.toUpperCase(),
        ];
      }),
      cat,
    );
  }
  h += `</div>`;

  // ── VIII. Cash Flow ───────────────────────────────────────────────────────
  h += `<div class="sec"><h2>VIII. Cash Flow Statement</h2>`;
  if (histYears.length > 0) {
    const fyItems = histYears.map(y => icGetItems(extracted, y));
    const cfLabels = ["Cash from Operations","Cash from Investing","Cash from Financing","Net Change in Cash","Opening Cash","Closing Cash"];
    const cfRows = cfLabels
      .map(label => ({ label, vals: fyItems.map(items => icLiVal(items, label)) }))
      .filter(({ vals }) => vals.some(v => v !== null));
    if (cfRows.length) {
      h += dataTable(["Item",...histYears.map(y=>`FY${y}`)], cfRows.map(({label,vals})=>[label,...vals.map(v=>icFmt(v))]), `Cash Flow (${ul})`);
    }
  }
  h += bul(ic.sections["cash_flow"]?.markdown??"");
  h += `</div>`;

  // ── IX. Due Diligence ─────────────────────────────────────────────────────
  h += `<div class="sec"><h2>IX. Due Diligence Excerpts</h2>`;
  h += bul(ic.sections["due_diligence"]?.markdown??"") || `<p style="color:#999;font-style:italic">Analyst to complete.</p>`;
  h += `</div>`;

  // ── X. Risk Assessment ────────────────────────────────────────────────────
  h += `<div class="sec"><h2>X. Risk Assessment &amp; Mitigation</h2>`;
  h += bul(ic.sections["risk_assessment"]?.markdown??"");
  h += `</div>`;

  // ── XI. Visit & Reference ─────────────────────────────────────────────────
  h += `<div class="sec"><h2>XI. Visit Report, Reference Checks &amp; Exec Recommendation</h2>`;
  if (cc.analyst_notes) h += `<p><b>Analyst Notes:</b><br>${cc.analyst_notes}</p>`;
  h += bul(ic.sections["visit_reference"]?.markdown??"");
  h += dataTable(["Check Type","Source","Status"],[
    ["Banker Reference","Principal Bank","Pending"],
    ["Vendor / Supplier Check","Key Suppliers","Pending"],
    ["Customer Reference","Major Clients","Pending"],
    ["Site Visit","Business Premises","Pending"],
  ], "Reference Check Template");
  h += `</div>`;

  // ── XII. Product Specifics ────────────────────────────────────────────────
  h += `<div class="sec"><h2>XII. Specific Product Requirements &amp; Exemptions</h2>`;
  h += `<table><tbody>
    ${tblRow("Applied Product", product.label)}
    ${tblRow("Legal Nature", product.legalNature)}
    ${tblRow("Return Mechanism", product.returnMechanism)}
  </tbody></table>`;
  h += `<h3>Product-Specific SOP Requirements</h3>`;
  h += `<ul>${product.rules.map(r=>`<li>${r}</li>`).join("")}</ul>`;
  h += `<h3>SOP Reference — All Products</h3>`;
  h += `<table><thead><tr><th>Product</th><th>Projections</th><th>DSCR Rule</th><th>Special Requirements</th></tr></thead><tbody>
    <tr><td>Operating Lease / Finance Lease</td><td>Waived if cumulative deal &lt; ₹100L</td><td>If current-year DSCR covers deal, projections optional</td><td>Employee Car Lease: salary slip + PF/ESI compliance</td></tr>
    <tr><td>Project Finance (PF)</td><td>Not required</td><td>—</td><td>Project working sheets &amp; timelines mandatory</td></tr>
    <tr><td>Trade Finance (TF)</td><td>Not required</td><td>—</td><td>Repayment source / liquidity justification mandatory</td></tr>
    <tr><td>Profit &amp; Loss Sharing (PLS)</td><td>Required</td><td>—</td><td>Client must submit monthly P&amp;L for EMI bifurcation</td></tr>
    <tr><td>Home Loan (HL)</td><td>Required</td><td>—</td><td>Max LTV 60%; FOIR ≤ 50%</td></tr>
  </tbody></table>`;
  if (cc.policy_exceptions) h += `<h3>Policy Exceptions for This Case</h3><p style="font-size:9px;line-height:1.6">${cc.policy_exceptions}</p>`;
  h += bul(ic.sections["product_specifics"]?.markdown??"");
  h += `</div>`;

  // ── Risk Register ─────────────────────────────────────────────────────────
  if (ic.risks?.length) {
    h += `<div class="sec"><h2>Risk Register</h2>
    <table><thead><tr><th>Category</th><th>Risk</th><th>Mitigant</th><th>Severity</th></tr></thead><tbody>`;
    ic.risks.forEach(r => {
      const cls = r.severity==="high"?"fail":r.severity==="medium"?"caution":"pass";
      h += `<tr><td>${r.category}</td><td>${r.risk}</td><td>${r.mitigant}</td><td class="${cls}">${r.severity?.toUpperCase()}</td></tr>`;
    });
    h += `</tbody></table></div>`;
  }

  // ── Conditions Precedent ──────────────────────────────────────────────────
  if (ic.conditions_precedent?.length) {
    h += `<div class="sec"><h2>Conditions Precedent</h2><ul>${ic.conditions_precedent.map(c=>`<li>${c}</li>`).join("")}</ul></div>`;
  }

  // ── SWOT ──────────────────────────────────────────────────────────────────
  if (ic.swot) {
    h += `<div class="sec"><h2>SWOT Analysis</h2><div class="grid2">`;
    ([["Strengths",ic.swot.strengths],["Weaknesses",ic.swot.weaknesses],["Opportunities",ic.swot.opportunities],["Threats",ic.swot.threats]] as [string,string[]][]).forEach(([label,items]) => {
      h += `<div><h3>${label}</h3><ul>${items.map(i=>`<li>${i}</li>`).join("")}</ul></div>`;
    });
    h += `</div></div>`;
  }

  // ── Analyst Notes Appendix ────────────────────────────────────────────────
  const icAny = ic as Record<string, unknown>;
  const comments = (icAny.comments as Array<{id:string;section_id:string;text:string;author_email:string;resolved:boolean}>) ?? [];
  const openComments = comments.filter(c => !c.resolved);
  if (openComments.length > 0) {
    h += `<div class="sec"><h2>◈ Analyst Notes</h2><ul>`;
    openComments.forEach(c => {
      const sLabel = IC_SECTIONS.find(s => s.id === c.section_id)?.title ?? c.section_id;
      h += `<li><b style="color:#444">${sLabel}:</b> ${c.text} <span style="color:#999;font-size:8px"> — ${c.author_email}</span></li>`;
    });
    h += `</ul></div>`;
  }

  return h;
}


// XHR-based upload to Supabase Storage so we get a real progress event stream.
async function uploadWithProgress(bucket: string, path: string, file: File, onPct: (pct: number) => void, signal?: AbortSignal): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/${bucket}/${encodedPath}`;
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
    xhr.setRequestHeader("x-upsert", "false");
    if (file.type) xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("cancelled"));
    if (signal) {
      if (signal.aborted) { xhr.abort(); return; }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });
}

function UploadGrid({ onUpload, onCancel, onDelete, onEdit, onRetry, busy, docs, extracted = [], progress, progressLabel, lockedClass, hint }: {
  onUpload: (f: File, cls: DocClass, fy: number | null) => void;
  onCancel?: () => void;
  onDelete: (doc: DocRow) => void;
  onEdit?: (id: string, doc_class: string, fiscal_year: number | null) => void;
  onRetry: (doc: DocRow) => void;
  busy: boolean; docs: DocRow[]; extracted?: ExtractedRow[]; progress: number; progressLabel: string;
  lockedClass?: DocClass; hint?: string[];
}) {
  const DOC_CLASSES: { value: DocClass; label: string }[] = [
    { value: "all_in_one",     label: "ALL-IN-ONE (BS + P&L + CF + PROJ)" },
    { value: "bank_statement", label: "BANK STATEMENT" },
    { value: "gst_return",     label: "GST RETURN" },
    { value: "profit_loss",    label: "PROFIT & LOSS" },
    { value: "balance_sheet",  label: "BALANCE SHEET" },
    { value: "cash_flow",      label: "CASH FLOW" },
    { value: "projections",    label: "PROJECTIONS" },
  ];

  const [globalCls, setGlobalCls]   = useState<DocClass>("all_in_one");
  const [globalFy, setGlobalFy]     = useState("");
  const [fileQueue, setFileQueue]   = useState<FinQueueItem[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);
  const [dragOver, setDragOver]     = useState(false);
  const fileInputRef                = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editClass, setEditClass]   = useState("");
  const [editFy, setEditFy]         = useState("");

  function autoDetect(filename: string): DocClass {
    if (lockedClass) return lockedClass;
    const n = filename.toLowerCase().replace(/[\s_\-.]/g, "");
    if (/bank|stmt|statement/.test(n))             return "bank_statement";
    if (/gst|gstin|gstr/.test(n))                  return "gst_return";
    if (/balancesheet|bsheet|bs\d/.test(n))        return "balance_sheet";
    if (/profitloss|pandl|pnl|incomestat/.test(n)) return "profit_loss";
    if (/cashflow|cfs/.test(n))                    return "cash_flow";
    if (/proj|forecast|forcast/.test(n))           return "projections";
    return "all_in_one";
  }

  function makeSize(f: File) {
    return f.size < 1_048_576 ? `${(f.size / 1024).toFixed(1)} KB` : `${(f.size / 1_048_576).toFixed(2)} MB`;
  }

  const addToQueue = (files: File[]) => {
    setFileQueue(q => {
      const existingNames = new Set([...q.map(i => i.name), ...docs.map(d => d.file_name)]);
      return [
        ...q,
        ...files.map(f => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file: f, name: f.name, size: makeSize(f),
          stmtType: autoDetect(f.name),
          fy: globalFy,
          status: (existingNames.has(f.name) ? "duplicate" : "pending") as QueueStatus,
        })),
      ];
    });
  };

  const processAll = async () => {
    const pending = fileQueue.filter(i => i.status === "pending");
    if (!pending.length) return;
    setQueueRunning(true);
    for (const item of pending) {
      setFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, status: "processing" } : qi));
      await (onUpload(item.file, item.stmtType, item.fy ? Number(item.fy) : null) as unknown as Promise<void>);
      setFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, status: "done" } : qi));
    }
    setQueueRunning(false);
  };

  const startEdit = (d: DocRow) => { setEditingId(d.id); setEditClass(d.doc_class); setEditFy(d.fiscal_year ? String(d.fiscal_year) : ""); };
  const saveEdit  = (id: string) => { onEdit?.(id, editClass, editFy ? Number(editFy) : null); setEditingId(null); };

  const handleDownloadDoc = async (d: DocRow) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { toast.error("Not authenticated"); return; }
    try {
      const encodedPath = d.file_path.split("/").map(encodeURIComponent).join("/");
      const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/authenticated/case-files/${encodedPath}`;
      const res = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      });
      if (!res.ok) { const body = await res.text().catch(() => ""); throw new Error(`${res.status}: ${body}`); }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = d.file_name;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      toast.error("Download failed: " + (e instanceof Error ? e.message : "unknown error"));
    }
  };

  const pendingCount = fileQueue.filter(i => i.status === "pending").length;
  const cellCls = "bg-input border border-border text-primary px-1 py-0.5 text-xs";

  return (
    <div className="space-y-3">

      {/* ── Controls row ─────────────────────────────────────────────────── */}
      <div className="flex gap-3 items-end flex-wrap">
        {!lockedClass && (
          <>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Statement Type</label>
              <select value={globalCls} onChange={e => setGlobalCls(e.target.value as DocClass)}
                className="bg-input border border-border px-2 py-1.5 text-sm text-primary">
                {DOC_CLASSES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Fiscal Year (optional)</label>
              <input type="number" placeholder="e.g. 2025" value={globalFy} onChange={e => setGlobalFy(e.target.value)}
                className="bg-input border border-border px-2 py-1.5 text-sm text-primary w-28" />
            </div>
          </>
        )}
        <div className="flex-1 min-w-[200px]">
          {!lockedClass && <label className="block text-sm font-medium text-foreground mb-1">File (PDF / Image / Excel)</label>}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const files = Array.from(e.dataTransfer.files); if (files.length) addToQueue(files); }}
            onClick={() => !(busy || queueRunning) && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg cursor-pointer px-4 py-4 text-center text-sm transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"} ${busy || queueRunning ? "pointer-events-none opacity-40" : ""}`}
          >
            <input ref={fileInputRef} type="file" className="hidden" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv"
              onChange={e => { const files = Array.from(e.target.files ?? []); if (files.length) addToQueue(files); e.target.value = ""; }} />
            <div className="text-muted-foreground">Drop files here or <span className="text-primary font-medium">click to browse</span></div>
            <div className="text-xs text-muted-foreground/60 mt-1">PDF · Excel · Image · Multiple files OK</div>
          </div>
        </div>
      </div>

      {/* ── File queue ───────────────────────────────────────────────────── */}
      {fileQueue.length > 0 && (
        <div className="border border-border">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60 bg-surface/40">
            <span className="text-xs font-medium text-foreground">
              {fileQueue.length} file{fileQueue.length > 1 ? "s" : ""} queued
              {pendingCount > 0 && ` · ${pendingCount} pending`}
            </span>
            <div className="flex gap-2">
              {pendingCount > 0 && !busy && !queueRunning && (
                <button onClick={processAll}
                  className="bg-primary text-primary-foreground rounded px-3 py-1 text-xs font-medium hover:bg-primary/90 transition-colors">
                  Extract {pendingCount} file{pendingCount > 1 ? "s" : ""}
                </button>
              )}
              <button onClick={() => setFileQueue([])}
                className="text-xs border border-border rounded text-muted-foreground px-2 py-1 hover:text-foreground transition-colors">
                Clear All
              </button>
            </div>
          </div>
          <div className="divide-y divide-border/30">
            {fileQueue.map(item => (
              <div key={item.id} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
                <span className={
                  item.status === "done"       ? "text-success shrink-0" :
                  item.status === "error"      ? "text-destructive shrink-0" :
                  item.status === "processing" ? "text-primary shrink-0 animate-pulse" :
                  item.status === "duplicate"  ? "text-warning shrink-0" :
                                                 "text-muted-foreground shrink-0"
                }>
                  {item.status === "done" ? "●" : item.status === "error" ? "✗" : item.status === "processing" ? "▶" : item.status === "duplicate" ? "◎" : "○"}
                </span>
                <span className="truncate flex-1 text-primary min-w-0" title={item.name}>{item.name}</span>
                <span className="text-foreground/40 shrink-0 hidden sm:block">{item.size}</span>
                {item.status === "duplicate" ? (
                  <span className="text-amber-500 text-[10px] shrink-0 border border-amber-200 rounded px-1.5 py-0.5">Already exists</span>
                ) : !lockedClass ? (
                  <>
                    <select
                      value={item.stmtType}
                      disabled={item.status !== "pending"}
                      onChange={e => setFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, stmtType: e.target.value as DocClass } : qi))}
                      className="bg-input border border-border/60 text-[9px] text-primary px-1 py-0.5 shrink-0 disabled:opacity-40"
                    >
                      {DOC_CLASSES.map(d => (
                        <option key={d.value} value={d.value}>{d.value === "all_in_one" ? "AUTO" : d.value.replace(/_/g, " ").toUpperCase()}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      value={item.fy}
                      disabled={item.status !== "pending"}
                      onChange={e => setFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, fy: e.target.value } : qi))}
                      placeholder="FY"
                      className="bg-input border border-border/60 text-[9px] text-primary px-1 py-0.5 w-12 shrink-0 disabled:opacity-40"
                    />
                  </>
                ) : null}
                {item.status !== "processing" && (
                  <button onClick={() => setFileQueue(q => q.filter(qi => qi.id !== item.id))}
                    className="text-foreground/40 hover:text-destructive hover:bg-destructive/10 px-1.5 py-0.5 border border-transparent hover:border-destructive/20 text-[10px] shrink-0 transition-colors"
                    title="Remove from queue">✕</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Progress bar ─────────────────────────────────────────────────── */}
      {busy && (
        <div className="border border-border rounded-lg bg-muted/20 p-3 space-y-2">
          <div className="flex justify-between items-center text-sm">
            <span className="text-foreground">▸ {progressLabel || "Working…"}</span>
            <div className="flex items-center gap-3">
              <span className="text-primary font-bold tabular-nums">{progress}%</span>
              {onCancel && (
                <button onClick={onCancel}
                  className="text-xs border border-destructive/60 text-destructive rounded px-2 py-0.5 hover:bg-destructive/10">
                  Cancel
                </button>
              )}
            </div>
          </div>
          <div className="h-1.5 bg-border rounded-full overflow-hidden">
            <div className="h-full bg-primary transition-all duration-300 ease-out rounded-full"
              style={{ width: `${progress}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Parse</span><span>Upload</span><span>Register</span><span>Extract</span><span>Done</span>
          </div>
        </div>
      )}

      <div className="text-xs text-muted-foreground space-y-0.5">
        {hint ? hint.map((h, i) => <div key={i}>· {h}</div>) : (
          <>
            <div>· ALL-IN-ONE (AUTO) detects every statement type and all fiscal years inside one document.</div>
            <div>· Statement type is auto-detected from filename — review and override per file before extracting.</div>
            <div>· Projections do not require a fiscal year. Excel parsed locally — PDF/Image via vision model.</div>
          </>
        )}
      </div>

      {/* ── Uploaded documents table ──────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs min-w-[400px]">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th className="text-left py-2 px-3">File</th>
              <th className="px-2">Type</th>
              {!lockedClass && <th className="px-2">Class</th>}
              {!lockedClass && <th className="px-2">FY</th>}
              <th className="px-2">Status</th>
              <th className="px-2"></th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 ? (
              <tr><td colSpan={lockedClass ? 4 : 6} className="text-center text-muted-foreground py-6">No documents uploaded yet</td></tr>
            ) : docs.map(d => {
              const isEditing = editingId === d.id;
              const staleExtracted = d.extraction_status === "extracted"
                && FINANCIAL_CLASSES_SET.has(d.doc_class)
                && !extracted.some(e => e.document_id === d.id);
              const statusText = staleExtracted ? "Done ⚠" : d.extraction_status === "extracted" ? "Done" : d.extraction_status === "failed" ? "Failed" : d.extraction_status === "running" ? "Running…" : "Pending";
              const statusCls = staleExtracted ? "text-warning" : d.extraction_status === "extracted" ? "text-success" : d.extraction_status === "failed" ? "text-destructive" : d.extraction_status === "running" ? "text-warning animate-pulse" : "text-muted-foreground";
              return (
                <tr key={d.id} className="border-t border-border/30">
                  <td className="py-1.5 px-3 max-w-[180px] truncate"><button type="button" onClick={() => handleDownloadDoc(d)} title="Click to download" className="text-primary hover:underline hover:text-accent cursor-pointer text-left truncate max-w-full">{d.file_name}</button></td>
                  <td className="text-center text-accent px-2">{d.file_type.toUpperCase()}</td>
                  {!lockedClass && (
                    <td className="text-center text-foreground/80 px-2">
                      {isEditing ? (
                        <select value={editClass} onChange={e => setEditClass(e.target.value)} className={cellCls}>
                          {DOC_CLASSES.map(dc => <option key={dc.value} value={dc.value}>{dc.value}</option>)}
                        </select>
                      ) : d.doc_class}
                    </td>
                  )}
                  {!lockedClass && (
                    <td className="text-center px-2">
                      {isEditing
                        ? <input type="number" value={editFy} onChange={e => setEditFy(e.target.value)} placeholder="auto" className={`${cellCls} w-16`} />
                        : (d.fiscal_year ?? "—")}
                    </td>
                  )}
                  <td className={`text-center px-2 ${statusCls}`}>
                    <span title={staleExtracted ? "No financial records found — click ▶ to retry." : (d as DocRow & { extraction_error?: string }).extraction_error ?? ""}>
                      {statusText}
                    </span>
                    {(d as DocRow & { extraction_error?: string }).extraction_error && d.extraction_status === "failed" && (
                      <div className="text-[9px] text-destructive/60 max-w-[140px] truncate" title={(d as DocRow & { extraction_error?: string }).extraction_error!}>
                        {(d as DocRow & { extraction_error?: string }).extraction_error}
                      </div>
                    )}
                  </td>
                  <td className="text-center px-2 whitespace-nowrap">
                    {isEditing ? (
                      <>
                        <button type="button" onClick={() => saveEdit(d.id)} className="text-green-400 hover:text-green-300 mr-2">✓</button>
                        <button type="button" onClick={() => setEditingId(null)} className="text-foreground/40 hover:text-foreground">✕</button>
                      </>
                    ) : (
                      <>
                        {d.extraction_status !== "running" && (
                          <button type="button" onClick={() => onRetry(d)} disabled={busy} title="Re-run extraction" className="text-warning/70 hover:text-warning mr-2 disabled:pointer-events-none text-base leading-none">▶</button>
                        )}
                        {onEdit && <button type="button" onClick={() => startEdit(d)} disabled={busy} className="text-foreground/40 hover:text-primary mr-2 disabled:pointer-events-none">✎</button>}
                        <button type="button" onClick={() => onDelete(d)} disabled={busy} className="text-foreground/40 hover:text-red-400 disabled:pointer-events-none">✕</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Unit helpers (shared across tabs) ──────────────────────────────────────

/** Abbreviated unit label: "Lakhs" → "L", "Crores" → "Cr", etc. */
function unitAbbr(unit: string | null | undefined): string {
  if (!unit) return "";
  const u = unit.toLowerCase();
  if (u.includes("crore")) return "Cr";
  if (u.includes("lakh"))  return "L";
  if (u.includes("million")) return "M";
  if (u.includes("thousand")) return "K";
  return "";
}

/** Step size for number inputs so ↑/↓ increments by 1 Lakh in the stored unit */
function unitStep(unit: string | null | undefined): number {
  if (!unit) return 100000;
  const u = unit.toLowerCase();
  if (u.includes("crore"))    return 0.01;
  if (u.includes("lakh"))     return 1;
  if (u.includes("million"))  return 0.1;
  if (u.includes("thousand")) return 100;
  return 100000;
}

/** Full normalised unit label for panel tickers: "Lakhs" → "₹ Lakhs", "USD Millions" → "USD Millions" */
function fmtUnit(unit: string | null | undefined): string {
  if (!unit) return "";
  const u = unit.trim();
  if (/^inr/i.test(u)) return "₹ " + u.replace(/^inr\s*/i, "").trim();
  if (/lakh|crore|thousand/i.test(u)) return "₹ " + u;
  return u;
}

// ─── Markdown Renderer ───────────────────────────────────────────────────────

function inlineMd(raw: string): string {
  return raw
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`(.*?)`/g, '<code style="background:rgba(255,255,255,0.06);padding:0 3px;border-radius:2px">$1</code>');
}

const isSeparator = (line: string) => /^\|[\s|:-]+\|$/.test(line.trim());

function MdTable({ lines }: { lines: string[] }) {
  const dataLines = lines.filter((l) => !isSeparator(l));
  if (dataLines.length === 0) return null;
  const parse = (l: string) =>
    l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const [header, ...body] = dataLines;
  const heads = parse(header);
  return (
    <div className="overflow-x-auto my-1">
      <table className="w-full text-xs border-t border-border">
        <thead className="text-muted-foreground border-b border-border">
          <tr>
            {heads.map((h, i) => (
              <th key={i} className={`py-1 font-semibold tracking-wide ${i === 0 ? "text-left" : "text-right"}`}
                dangerouslySetInnerHTML={{ __html: inlineMd(h) }}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => {
            const cells = parse(row);
            return (
              <tr key={ri} className="border-b border-border/30 hover:bg-surface/30">
                {cells.map((cell, ci) => {
                  const isStatus = /^(PASS|FAIL|CAUTION)$/i.test(cell.trim());
                  const statusCls = isStatus
                    ? /pass/i.test(cell) ? "text-success font-bold"
                    : /fail/i.test(cell) ? "text-destructive font-bold"
                    : "text-warning font-bold"
                    : "";
                  return (
                    <td key={ci}
                      className={`py-1 ${ci === 0 ? "text-left text-foreground/90" : "text-right tabular-nums text-primary"} ${statusCls}`}
                      dangerouslySetInnerHTML={{ __html: inlineMd(cell) }}
                    />
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── IC Note Data-Driven Override Components ────────────────────────────────

const IC_S_CLS: Record<string, string> = {
  green: "text-success", amber: "text-warning", red: "text-destructive", na: "text-muted-foreground",
};
const IC_B_CLS: Record<string, string> = {
  green: "bg-success text-success-foreground",
  amber: "bg-warning text-warning-foreground",
  red: "bg-destructive text-destructive-foreground",
  na: "bg-muted text-muted-foreground",
};

function ICSummaryPanel({ cc, ratios }: { cc: CaseRow; ratios: RatioRow[] }) {
  const product = PRODUCTS[cc.product_type];
  const years = Array.from(new Set(ratios.map(r => r.fiscal_year))).sort();
  const KEY = ["dscr", "current_ratio", "debt_to_equity", "interest_coverage", "ebitda_margin", "roe"];
  return (
    <div className="space-y-2 text-xs">
      <table className="w-full">
        <tbody>
          <tr className="border-b border-border/30">
            <td className="py-0.5 w-28 text-muted-foreground">Client</td>
            <td className="text-primary font-medium">{cc.client_name}</td>
            <td className="w-24 text-muted-foreground">Product</td>
            <td className="text-primary">{product.short}</td>
          </tr>
          <tr className="border-b border-border/30">
            <td className="py-0.5 text-muted-foreground">Amount</td>
            <td className="text-primary">₹{Number(cc.deal_amount ?? 0).toLocaleString("en-IN")} Cr</td>
            <td className="text-muted-foreground">Tenure</td>
            <td className="text-primary">{cc.tenure_months ?? "—"}M</td>
          </tr>
          <tr className="border-b border-border/30">
            <td className="py-0.5 text-muted-foreground">IRR</td>
            <td className="text-primary">{cc.expected_irr ?? "—"}%</td>
            <td className="text-muted-foreground">Industry</td>
            <td className="text-primary">{cc.industry ?? "—"}</td>
          </tr>
          {cc.end_use && (
            <tr className="border-b border-border/30">
              <td className="py-0.5 text-muted-foreground">End Use</td>
              <td colSpan={3} className="text-foreground/90">{cc.end_use}</td>
            </tr>
          )}
        </tbody>
      </table>
      {ratios.length > 0 && years.length > 0 && (
        <>
          <div className="text-[10px] text-accent font-bold tracking-widest pt-1">KEY RATIO SNAPSHOT</div>
          <table className="w-full">
            <thead className="text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left py-0.5">RATIO</th>
                {years.map(y => <th key={y} className="text-right">FY{y}</th>)}
                <th className="text-right">BMK</th>
                <th className="text-right">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {KEY.map(name => {
                const rows = ratios.filter(r => r.ratio_name === name);
                if (rows.length === 0) return null;
                const latest = rows.sort((a, b) => b.fiscal_year - a.fiscal_year)[0];
                const s = latest.threshold_status ?? "na";
                return (
                  <tr key={name} className="border-b border-border/30">
                    <td className="py-0.5 text-foreground/90">{RATIO_DISPLAY_NAMES[name] ?? name}</td>
                    {years.map(y => {
                      const r = ratios.find(x => x.ratio_name === name && x.fiscal_year === y);
                      return (
                        <td key={y} className="text-right tabular-nums text-primary">
                          {formatRatio(name, r?.ratio_value != null ? Number(r.ratio_value) : null)}
                        </td>
                      );
                    })}
                    <td className="text-right tabular-nums text-muted-foreground">
                      {latest.benchmark != null ? formatRatio(name, Number(latest.benchmark)) : "—"}
                    </td>
                    <td className={`text-right font-bold text-[10px] ${IC_S_CLS[s]}`}>
                      {s === "green" ? "PASS" : s === "red" ? "FAIL" : s === "amber" ? "CAU" : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function icGetItems(extracted: ExtractedRow[], fy: number): LineItem[] {
  const raw: LineItem[] = [];
  const seen = new Set<string>();
  for (const row of extracted.filter(r => r.fiscal_year === fy && r.statement_type !== "projections")) {
    for (const it of (row.line_items as unknown as LineItem[]) ?? []) {
      if (!seen.has(it.label)) { raw.push(it); seen.add(it.label); }
    }
  }
  return deriveFinancialItems(raw);
}

function deriveFinancialItems(items: LineItem[]): LineItem[] {
  const result = [...items];

  const get = (label: string): number | null => {
    const it = result.find(i => i.label === label);
    if (!it) return null;
    const v = it.override_value !== undefined && it.override_value !== null ? it.override_value : it.value;
    return v !== null && Number.isFinite(Number(v)) ? Number(v) : null;
  };

  const add = (label: string, value: number) => {
    if (result.find(i => i.label === label)) return;
    result.push({ label, value, confidence: 70, reviewed: false, note: "auto-derived", override_value: null });
  };

  // ── P&L derivations ────────────────────────────────────────────────────
  const turnover     = get("Turnover");
  const cogs         = get("Cost of Goods Sold");
  const grossProfit  = get("Gross Profit");
  const opEx         = get("Operating Expenses");
  const ebitda       = get("EBITDA");
  const depn         = get("Depreciation");
  const ebit         = get("EBIT");
  const interest     = get("Interest Expense");
  const pbt          = get("Profit Before Tax");
  const tax          = get("Tax");
  const pat          = get("PAT");

  if (grossProfit === null && turnover !== null && cogs !== null)
    add("Gross Profit", turnover - cogs);
  const gp = grossProfit ?? get("Gross Profit");
  if (ebitda === null && gp !== null && opEx !== null)
    add("EBITDA", gp - opEx);
  const eb = ebitda ?? get("EBITDA");
  if (ebit === null && eb !== null && depn !== null)
    add("EBIT", eb - depn);
  const ei = ebit ?? get("EBIT");
  if (pbt === null && ei !== null && interest !== null)
    add("Profit Before Tax", ei - interest);
  const pb = pbt ?? get("Profit Before Tax");
  if (pat === null && pb !== null && tax !== null)
    add("PAT", pb - tax);
  if (pat === null && pb !== null && tax === null)
    add("PAT", pb);

  // ── Balance Sheet derivations ──────────────────────────────────────────
  const shareCapital = get("Share Capital");
  const reserves     = get("Reserves & Surplus");
  const netWorth     = get("Net Worth");
  const ltBorrow     = get("Long Term Borrowings");
  const stBorrow     = get("Short Term Borrowings");
  const totalDebt    = get("Total Debt");
  const inventory    = get("Inventory");
  const receivables  = get("Trade Receivables");
  const cash         = get("Cash & Bank");
  const otherCA      = get("Other Current Assets");
  const currentAssets= get("Current Assets");
  const tradePay     = get("Trade Payables");
  const otherCL      = get("Other Current Liabilities");
  const currentLiab  = get("Current Liabilities");
  const fixedAssets  = get("Fixed Assets (Net)");
  const totalAssets  = get("Total Assets");

  if (netWorth === null && shareCapital !== null && reserves !== null)
    add("Net Worth", shareCapital + reserves);

  if (totalDebt === null) {
    const lt = ltBorrow ?? 0;
    const st = stBorrow ?? 0;
    if (ltBorrow !== null || stBorrow !== null)
      add("Total Debt", lt + st);
  }

  const nw = netWorth ?? get("Net Worth");
  const lt = ltBorrow ?? 0;
  if (get("Capital Employed") === null && nw !== null)
    add("Capital Employed", nw + lt);

  if (currentAssets === null) {
    const parts = [inventory, receivables, cash, otherCA].filter((v): v is number => v !== null);
    if (parts.length >= 2) add("Current Assets", parts.reduce((a, b) => a + b, 0));
  }

  if (get("Current Liabilities") === null) {
    const stB = stBorrow ?? 0;
    const tp  = tradePay ?? 0;
    const cl  = otherCL  ?? 0;
    if (stBorrow !== null || tradePay !== null || otherCL !== null)
      add("Current Liabilities", stB + tp + cl);
  }

  const ca = currentAssets ?? get("Current Assets");
  const cl = currentLiab  ?? get("Current Liabilities");
  if (get("Working Capital") === null && ca !== null && cl !== null)
    add("Working Capital", ca - cl);

  if (totalAssets === null && fixedAssets !== null && ca !== null)
    add("Total Assets", fixedAssets + ca);

  return result;
}

function icLiVal(items: LineItem[], label: string): number | null {
  const it = items.find(i => i.label === label);
  if (!it) return null;
  return it.override_value !== undefined && it.override_value !== null ? it.override_value : it.value;
}

function icFmt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function FV({ v, abbr, calc }: { v: number | null | undefined; abbr: string; calc?: boolean }) {
  if (v === null || v === undefined || !Number.isFinite(v as number))
    return <span className="text-muted-foreground">—</span>;
  return (
    <span className={calc ? "text-warning/80" : "text-primary"}>
      {icFmt(v)}{abbr && <span className="text-[9px] text-muted-foreground ml-0.5">{abbr}</span>}
    </span>
  );
}

function ICHistoricalTables({ extracted }: { extracted: ExtractedRow[] }) {
  const years = Array.from(new Set(
    extracted.filter(r => r.statement_type !== "projections").map(r => r.fiscal_year)
  )).sort();
  if (years.length === 0) return <div className="text-muted-foreground text-xs">No historical data extracted.</div>;

  const unit = extracted.find(r => r.unit)?.unit;
  const unitLabel = unit ? `₹ ${unit}` : "₹";
  const abbr = unitAbbr(unit);
  const fyItems = years.map(y => icGetItems(extracted, y));

  const isCalc = (items: LineItem[], label: string) =>
    items.find(i => i.label === label)?.note === "auto-derived";

  const plLabels = ["Turnover", "Cost of Goods Sold", "Gross Profit", "Operating Expenses", "EBITDA", "Depreciation", "EBIT", "Interest Expense", "Profit Before Tax", "Tax", "PAT"];
  const bsLabels = ["Share Capital", "Reserves & Surplus", "Net Worth", "Long Term Borrowings", "Short Term Borrowings", "Total Debt", "Trade Payables", "Other Current Liabilities", "Current Liabilities", "Inventory", "Trade Receivables", "Cash & Bank", "Other Current Assets", "Current Assets", "Fixed Assets (Net)", "Total Assets", "Capital Employed", "Working Capital"];
  const cfLabels = ["Cash from Operations", "Cash from Investing", "Cash from Financing", "Net Change in Cash", "Opening Cash", "Closing Cash"];

  const renderTable = (allLabels: string[], title: string) => {
    // Only show rows where at least one year has a value
    const activeLabels = allLabels.filter(label =>
      fyItems.some(items => icLiVal(items, label) !== null)
    );
    if (activeLabels.length === 0) return null;
    return (
      <div>
        <div className="text-[10px] text-accent font-bold tracking-widest mb-1">{title} · {unitLabel}</div>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left py-0.5">ITEM</th>
              {years.map(y => <th key={y} className="text-right">FY{y}</th>)}
              {years.length >= 2 && <th className="text-right text-accent">YOY%</th>}
            </tr>
          </thead>
          <tbody>
            {activeLabels.map(label => {
              const vals = fyItems.map(items => icLiVal(items, label));
              const calcFlags = fyItems.map(items => isCalc(items, label));
              const last = vals[vals.length - 1];
              const prev = vals.length >= 2 ? vals[vals.length - 2] : null;
              const yoyPct = (last !== null && prev !== null && prev !== 0)
                ? ((last - prev) / Math.abs(prev)) * 100 : null;
              const anyCalc = calcFlags.some(Boolean);
              return (
                <tr key={label} className="border-b border-border/30">
                  <td className="py-0.5">
                    <span className={anyCalc ? "text-warning/90" : "text-foreground/90"}>{label}</span>
                    {anyCalc && <span className="ml-1 text-[8px] text-warning/70 tracking-widest">CALC</span>}
                  </td>
                  {vals.map((v, i) => (
                    <td key={i} className="text-right tabular-nums">
                      <FV v={v} abbr={abbr} calc={calcFlags[i]} />
                    </td>
                  ))}
                  {years.length >= 2 && (
                    <td className={`text-right tabular-nums text-[11px] ${yoyPct !== null ? (yoyPct > 0 ? "text-success" : yoyPct < 0 ? "text-destructive" : "text-muted-foreground") : "text-muted-foreground"}`}>
                      {yoyPct !== null ? (yoyPct > 0 ? "+" : "") + yoyPct.toFixed(1) + "%" : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const hasCF = fyItems.some(items => cfLabels.some(l => icLiVal(items, l) !== null));

  return (
    <div className="space-y-3">
      {renderTable(plLabels, "P&L SUMMARY")}
      {renderTable(bsLabels, "BALANCE SHEET")}
      {hasCF && renderTable(cfLabels, "CASH FLOW STATEMENT")}
      <div className="text-[9px] text-warning/70 tracking-wider">
        ▸ <span className="text-warning/70">CALC</span> = auto-derived from available data · all other values extracted from source documents
      </div>
    </div>
  );
}

function ICProjectionsTable({ extracted }: { extracted: ExtractedRow[] }) {
  const projRows = extracted.filter(r => r.statement_type === "projections");
  if (projRows.length === 0) return <div className="text-muted-foreground text-xs">No projection data extracted.</div>;

  const unit = extracted.find(r => r.unit)?.unit;
  const unitLabel = unit ? `₹ ${unit}` : "₹";
  const abbr = unitAbbr(unit);
  const histYears = Array.from(new Set(
    extracted.filter(r => r.statement_type !== "projections").map(r => r.fiscal_year)
  )).sort();
  const projYears = Array.from(new Set(projRows.map(r => r.fiscal_year))).sort();
  const pairs: [string, string][] = [
    ["Turnover", "Projected Turnover"],
    ["EBITDA", "Projected EBITDA"],
    ["PAT", "Projected PAT"],
    ["Net Worth", "Projected Net Worth"],
    ["Total Debt", "Projected Total Debt"],
  ];

  return (
    <div>
      <div className="text-[9px] text-muted-foreground mb-1 tracking-wider">{unitLabel} · (A) Actual · (P) Projected</div>
      <table className="w-full text-xs">
        <thead className="text-muted-foreground border-b border-border">
          <tr>
            <th className="text-left py-0.5">METRIC</th>
            {histYears.map(y => <th key={y} className="text-right">FY{y}<span className="text-[9px] opacity-60">(A)</span></th>)}
            {projYears.map(y => <th key={y} className="text-right text-accent">FY{y}<span className="text-[9px] opacity-60">(P)</span></th>)}
          </tr>
        </thead>
        <tbody>
          {pairs.map(([histLabel, projLabel]) => (
            <tr key={histLabel} className="border-b border-border/30">
              <td className="py-0.5 text-foreground/90">{histLabel}</td>
              {histYears.map(y => <td key={y} className="text-right tabular-nums"><FV v={icLiVal(icGetItems(extracted, y), histLabel)} abbr={abbr} /></td>)}
              {projYears.map(y => {
                const items = (projRows.find(r => r.fiscal_year === y)?.line_items ?? []) as unknown as LineItem[];
                return <td key={y} className="text-right tabular-nums"><FV v={icLiVal(items, projLabel)} abbr={abbr} /></td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ICRatioTable({ ratios }: { ratios: RatioRow[] }) {
  if (ratios.length === 0) return <div className="text-muted-foreground text-xs">No ratios computed. Run ratio analysis first.</div>;
  const years = Array.from(new Set(ratios.map(r => r.fiscal_year))).sort();
  const categories = Array.from(new Set(ratios.map(r => r.category)));

  return (
    <div className="space-y-3">
      {categories.map(cat => {
        const names = Array.from(new Set(ratios.filter(r => r.category === cat).map(r => r.ratio_name)));
        return (
          <div key={cat}>
            <div className="text-[10px] text-accent font-bold tracking-widest mb-1">{cat.toUpperCase()}</div>
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-0.5">RATIO</th>
                  {years.map(y => <th key={y} className="text-right">FY{y}</th>)}
                  <th className="text-right">BMK</th>
                </tr>
              </thead>
              <tbody>
                {names.map(name => {
                  const latest = ratios.filter(r => r.ratio_name === name).sort((a, b) => b.fiscal_year - a.fiscal_year)[0];
                  const latestStatus = latest?.threshold_status ?? "na";
                  return (
                    <tr key={name} className="border-b border-border/30">
                      <td className="py-0.5 text-foreground/90">{RATIO_DISPLAY_NAMES[name] ?? name}</td>
                      {years.map(y => {
                        const r = ratios.find(x => x.ratio_name === name && x.fiscal_year === y);
                        const val = r?.ratio_value != null ? Number(r.ratio_value) : null;
                        const s = r?.threshold_status ?? "na";
                        return (
                          <td key={y} className="text-right pr-1">
                            <span className="tabular-nums text-foreground/90 mr-1">{formatRatio(name, val)}</span>
                            <span className={`px-1 text-[9px] font-bold tracking-widest ${IC_B_CLS[s]}`}>
                              {s === "green" ? "✓" : s === "red" ? "✗" : s === "amber" ? "~" : "—"}
                            </span>
                          </td>
                        );
                      })}
                      <td className="text-right tabular-nums text-muted-foreground">
                        {latest?.benchmark != null ? formatRatio(name, Number(latest.benchmark)) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function ICRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <tr className="border-b border-border/40">
      <td className="py-2 w-44 text-muted-foreground text-sm">{label}</td>
      <td className="py-2 text-foreground text-sm">{String(value)}</td>
    </tr>
  );
}

function ICClientProfile({ cc }: { cc: CaseRow }) {
  const product = PRODUCTS[cc.product_type];
  return (
    <div className="space-y-4">
      <table className="w-full">
        <tbody>
          <ICRow label="Client Name" value={cc.client_name} />
          <ICRow label="Legal Constitution" value={cc.legal_constitution} />
          <ICRow label="Industry / Sector" value={cc.industry} />
          <ICRow label="Year Established" value={cc.year_established} />
          <ICRow label="Product Applied For" value={product.label} />
          <ICRow label="Principal Borrower" value={cc.principal_borrower} />
          <ICRow label="Website" value={cc.website} />
        </tbody>
      </table>
      {cc.promoter_details && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Promoter Details</div>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{cc.promoter_details}</p>
        </div>
      )}
      {cc.group_summary && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Group Summary</div>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{cc.group_summary}</p>
        </div>
      )}
    </div>
  );
}

function ICInvestmentStructure({ cc }: { cc: CaseRow }) {
  const product = PRODUCTS[cc.product_type];
  return (
    <div className="space-y-4">
      <table className="w-full">
        <tbody>
          <ICRow label="Product / Facility Type" value={product.label} />
          <ICRow label="Legal Nature" value={product.legalNature} />
          <ICRow label="Return Mechanism" value={product.returnMechanism} />
          <ICRow label="Proposed Amount" value={cc.deal_amount != null ? `₹${Number(cc.deal_amount).toLocaleString("en-IN")} Crores` : null} />
          <ICRow label="Tenure" value={cc.tenure_months != null ? `${cc.tenure_months} Months` : null} />
          <ICRow label="Expected IRR" value={cc.expected_irr != null ? `${cc.expected_irr}%` : null} />
          <ICRow label="Residual Value" value={cc.residual_value != null ? `₹${Number(cc.residual_value).toLocaleString("en-IN")}` : null} />
          <ICRow label="Security Deposit" value={cc.security_deposit != null ? `₹${Number(cc.security_deposit).toLocaleString("en-IN")}` : null} />
        </tbody>
      </table>
      {cc.end_use && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">End Use of Funds</div>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{cc.end_use}</p>
        </div>
      )}
      {cc.collateral_summary && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Collateral / Security</div>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{cc.collateral_summary}</p>
        </div>
      )}
    </div>
  );
}

function ICRehbarHistory({ cc }: { cc: CaseRow }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Rehbar Financial Services — Funder Profile</div>
        <table className="w-full">
          <tbody>
            <ICRow label="Legal Entity" value="Rehbar Financial Services" />
            <ICRow label="Business Model" value="Sharia-compliant NBFC — asset financing & structured credit" />
            <ICRow label="Core Products" value="Operating Lease · Finance Lease · PLS · Project Finance · Trade Finance · Home Loan" />
            <ICRow label="Return Framework" value="Fixed rental / IRR / profit-share depending on product" />
            <ICRow label="Website" value="rehbar.co.in" />
          </tbody>
        </table>
      </div>
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Prior Exposure to {cc.client_name}</div>
        <p className="text-sm text-muted-foreground italic">No prior Rehbar funding history on record for this client. This appears to be a new relationship.</p>
      </div>
    </div>
  );
}

function ICVisitReference({ cc }: { cc: CaseRow }) {
  return (
    <div className="space-y-4">
      {cc.analyst_notes ? (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Analyst Notes / Site Visit Observations</div>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{cc.analyst_notes}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">No analyst notes recorded. Add visit report, reference check findings, and executive recommendation via Edit on the case header.</p>
      )}
      <div className="border-t border-border/40 pt-4">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Reference Check Status</div>
        <table className="w-full text-sm">
          <thead className="text-muted-foreground border-b border-border">
            <tr><th className="text-left py-1.5 font-medium">Check Type</th><th className="text-left font-medium">Source</th><th className="text-left font-medium">Status</th></tr>
          </thead>
          <tbody>
            {[["Banker Reference","Principal Bank","Pending"],["Vendor / Supplier Check","Key Suppliers","Pending"],["Customer Reference","Major Clients","Pending"],["Site Visit","Business Premises","Pending"]].map(([t,s,st]) => (
              <tr key={t} className="border-b border-border/30">
                <td className="py-1.5 text-foreground">{t}</td>
                <td className="text-muted-foreground">{s}</td>
                <td><span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">{st}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ICProductSpecifics({ cc }: { cc: CaseRow }) {
  const product = PRODUCTS[cc.product_type];
  return (
    <div className="space-y-4">
      <table className="w-full">
        <tbody>
          <ICRow label="Product" value={product.label} />
          <ICRow label="Short Code" value={product.short} />
          <ICRow label="Legal Nature" value={product.legalNature} />
          <ICRow label="Return Mechanism" value={product.returnMechanism} />
        </tbody>
      </table>
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">SOP Rules for {product.short}</div>
        <ul className="space-y-1.5">
          {product.rules.map((r, i) => (
            <li key={i} className="flex gap-2.5 text-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-primary/60 mt-1.5 shrink-0" />
              <span className="text-foreground">{r}</span>
            </li>
          ))}
        </ul>
      </div>
      {cc.policy_exceptions && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Policy Exceptions</div>
          <p className="text-sm text-amber-700 whitespace-pre-wrap">{cc.policy_exceptions}</p>
        </div>
      )}
    </div>
  );
}

function BulletOnlyMd({ text }: { text: string }) {
  if (!text) return null;
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trim = line.trim();
    if (trim.startsWith("|")) {
      const block: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { block.push(lines[i]); i++; }
      out.push(<MdTable key={`t-${i}`} lines={block} />);
      continue;
    }
    if (/^[-*]\s/.test(trim)) {
      const bullets: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        bullets.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      out.push(
        <ul key={`ul-${i}`} className="space-y-0.5 my-1">
          {bullets.map((b, bi) => (
            <li key={bi} className="flex gap-2 text-xs">
              <span className="text-warning shrink-0 mt-0.5">▸</span>
              <span className="text-foreground/90" dangerouslySetInnerHTML={{ __html: inlineMd(b) }} />
            </li>
          ))}
        </ul>
      );
      continue;
    }
    if (trim.startsWith("### ")) {
      out.push(<div key={`h3-${i}`} className="text-[10px] font-bold text-accent tracking-widest mt-2 mb-0.5 uppercase">{trim.slice(4)}</div>);
      i++; continue;
    }
    if (trim.startsWith("## ") || trim.startsWith("# ")) {
      out.push(<div key={`h-${i}`} className="text-xs font-bold text-primary mt-2 mb-0.5">{trim.replace(/^#+\s+/, "")}</div>);
      i++; continue;
    }
    i++; // skip prose paragraphs
  }
  if (out.length === 0) return null;
  return <div className="space-y-1 text-xs mt-2">{out}</div>;
}

function MdRenderer({ text }: { text: string }) {
  if (!text) return <div className="text-muted-foreground text-xs italic">(empty)</div>;

  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trim = line.trim();

    // Table block
    if (trim.startsWith("|")) {
      const block: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        block.push(lines[i]);
        i++;
      }
      out.push(<MdTable key={`t-${i}`} lines={block} />);
      continue;
    }

    // Bullet list block
    if (/^[-*]\s/.test(trim)) {
      const bullets: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        bullets.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      out.push(
        <ul key={`ul-${i}`} className="space-y-0.5 my-1">
          {bullets.map((b, bi) => (
            <li key={bi} className="flex gap-2 text-xs">
              <span className="text-warning shrink-0 mt-0.5">▸</span>
              <span className="text-foreground/90" dangerouslySetInnerHTML={{ __html: inlineMd(b) }} />
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Headings
    if (trim.startsWith("### ")) {
      out.push(<div key={`h3-${i}`} className="text-[10px] font-bold text-accent tracking-widest mt-2 mb-0.5 uppercase">{trim.slice(4)}</div>);
      i++; continue;
    }
    if (trim.startsWith("## ") || trim.startsWith("# ")) {
      const t = trim.replace(/^#+\s+/, "");
      out.push(<div key={`h-${i}`} className="text-xs font-bold text-primary mt-2 mb-0.5">{t}</div>);
      i++; continue;
    }

    // Empty line — small gap
    if (trim === "") { i++; continue; }

    // Regular line
    out.push(
      <p key={`p-${i}`} className="text-xs text-foreground/90 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: inlineMd(trim) }}
      />
    );
    i++;
  }

  return <div className="space-y-1 text-xs">{out}</div>;
}
